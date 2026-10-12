from io import BytesIO
from types import SimpleNamespace
import os
import zipfile
from PIL import Image
from app.services import report_pdf, report_pdf_jobs as jobs


def test_large_report_parts_keep_all_tables_in_order_and_only_needed_images(tmp_path):
    from lxml import etree
    w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    source = tmp_path / 'large.docx'
    tables = ''.join(f'<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Finding {i}</w:t><w:drawing r:embed="img{i}"/></w:r></w:p></w:tc></w:tr></w:tbl>' for i in range(125))
    document = f'<w:document xmlns:w="{w}" xmlns:r="{r}"><w:body><w:p><w:r><w:t>Summary</w:t></w:r></w:p>{tables}<w:sectPr/></w:body></w:document>'
    relationships = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="img{i}" Type="{r}/image" Target="media/photo{i}.png"/>' for i in range(125)) + '</Relationships>'
    with zipfile.ZipFile(source, 'w') as package:
        package.writestr('word/document.xml', document)
        package.writestr('word/_rels/document.xml.rels', relationships)
        package.writestr('word/styles.xml', '<styles/>')
        for i in range(125):
            package.writestr(f'word/media/photo{i}.png', b'photo')
    before = source.read_bytes()
    parts = report_pdf._conversion_parts(source, tmp_path)
    assert len(parts) == 4
    found = []
    for part in parts:
        with zipfile.ZipFile(part) as package:
            tree = etree.fromstring(package.read('word/document.xml'))
            found.extend(tree.xpath('//w:t/text()', namespaces={'w': w}))
            assert len(tree.xpath('//w:tbl', namespaces={'w': w})) <= 40
            assert len(tree.xpath('//w:sectPr', namespaces={'w': w})) == 1
            refs = etree.fromstring(package.read('word/_rels/document.xml.rels'))
            media = {n for n in package.namelist() if n.startswith('word/media/')}
            assert media == {'word/' + item.get('Target') for item in refs}
            assert package.read('word/styles.xml') == b'<styles/>'
    assert found == ['Summary'] + [f'Finding {i}' for i in range(125)]
    assert source.read_bytes() == before


def test_conversion_copy_preserves_document_and_source(tmp_path):
    photo = BytesIO()
    Image.new('RGB', (3200, 2600), 'red').save(photo, 'PNG')
    source = tmp_path / 'issued.docx'
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_STORED) as archive:
        archive.writestr('word/document.xml', b'<document>saved report</document>')
        archive.writestr('word/media/photo.png', photo.getvalue())
        archive.writestr('padding', os.urandom(21 * 1024 * 1024))
    original = source.read_bytes()
    folder = tmp_path / 'conversion'; folder.mkdir()
    copy = report_pdf._conversion_document(source, folder)
    assert copy != source and source.read_bytes() == original
    with zipfile.ZipFile(copy) as archive:
        assert archive.read('word/document.xml') == b'<document>saved report</document>'
        with Image.open(BytesIO(archive.read('word/media/photo.png'))) as image:
            assert max(image.size) == 2200


def setup_record(tmp_path, monkeypatch):
    monkeypatch.setattr(report_pdf.settings, 'reports_dir', tmp_path)
    (tmp_path / 'saved.docx').write_bytes(b'saved-word')
    monkeypatch.setattr(report_pdf.shutil, 'which', lambda _: '/usr/bin/libreoffice')
    return SimpleNamespace(id=1, file_path='saved.docx')


def test_jobs_deduplicate_and_recover_interruption(tmp_path, monkeypatch):
    record = setup_record(tmp_path, monkeypatch)
    submissions = []
    class Pool:
        def submit(self, fn, *args):
            submissions.append((fn, args))
    monkeypatch.setattr(jobs, 'pool', Pool())
    monkeypatch.setattr(jobs, '_heartbeat', lambda *args: None)
    assert jobs.start(record)['status'] == 'queued'
    assert jobs.start(record)['status'] == 'queued'
    assert len(submissions) == 1
    target = report_pdf.pdf_file(record)
    with jobs.connect(target) as conn:
        conn.execute('UPDATE jobs SET updated=0')
    assert jobs.status(record)['status'] == 'failed'
    assert jobs.start(record)['status'] == 'queued'
    assert len(submissions) == 2


def test_background_failure_is_visible(tmp_path, monkeypatch):
    record = setup_record(tmp_path, monkeypatch)
    target = report_pdf.pdf_file(record)
    with jobs.connect(target) as conn:
        conn.execute("INSERT INTO jobs VALUES (?, 'queued', NULL, ?)", (target.name, jobs.time.time()))
    def fail(record, progress=None):
        raise RuntimeError('conversion failed')
    monkeypatch.setattr(jobs, 'prepare_pdf', fail)
    stopped = jobs.threading.Event()
    jobs._run(record, target, stopped)
    assert stopped.is_set()
    assert jobs.status(record)['status'] == 'failed'
    assert jobs.status(record)['pdf_bytes'] is None


def test_background_success_reuses_cache(tmp_path, monkeypatch):
    record = setup_record(tmp_path, monkeypatch)
    target = report_pdf.pdf_file(record)
    with jobs.connect(target) as conn:
        conn.execute("INSERT INTO jobs VALUES (?, 'queued', NULL, ?)", (target.name, jobs.time.time()))
    monkeypatch.setattr(jobs, 'prepare_pdf', lambda _, progress=None: target.write_bytes(b'%PDF-valid'))
    jobs._run(record, target, jobs.threading.Event())
    assert jobs.status(record)['status'] == 'complete'
    assert jobs.start(record)['pdf_bytes'] == 10


def test_real_progress_is_persisted_for_other_requests(tmp_path, monkeypatch):
    record = setup_record(tmp_path, monkeypatch)
    target = report_pdf.pdf_file(record)
    with jobs.connect(target) as conn:
        conn.execute("INSERT INTO jobs VALUES (?, 'queued', NULL, ?)", (target.name, jobs.time.time()))
    def convert(record, progress):
        progress('converting', 2, 4)
        state = jobs.status(record)
        assert state['percent'] == 50 and state['completed'] == 2 and state['total'] == 4
        progress('combining', 4, 4)
        assert jobs.status(record)['percent'] is None
        target.write_bytes(b'%PDF-valid')
    monkeypatch.setattr(jobs, 'prepare_pdf', convert)
    jobs._run(record, target, jobs.threading.Event())
    assert jobs.status(record)['percent'] == 100
