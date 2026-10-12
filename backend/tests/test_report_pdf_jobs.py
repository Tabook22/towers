from io import BytesIO
from types import SimpleNamespace
import os
import zipfile
from PIL import Image
from app.services import report_pdf, report_pdf_jobs as jobs


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
    def fail(record):
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
    monkeypatch.setattr(jobs, 'prepare_pdf', lambda _: target.write_bytes(b'%PDF-valid'))
    jobs._run(record, target, jobs.threading.Event())
    assert jobs.status(record)['status'] == 'complete'
    assert jobs.start(record)['pdf_bytes'] == 10
