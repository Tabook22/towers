from types import SimpleNamespace
from pathlib import Path
import pytest
from fastapi import HTTPException
from app.services import report_pdf


@pytest.fixture
def report(tmp_path, monkeypatch):
    monkeypatch.setattr(report_pdf.settings, 'reports_dir', tmp_path)
    path = tmp_path / 'issued.docx'
    path.write_bytes(b'archived-word')
    return SimpleNamespace(id=1, file_path='issued.docx')


def test_sizes_are_actual_and_pdf_cached_without_changing_archived_word(report, monkeypatch):
    monkeypatch.setattr(report_pdf.shutil, 'which', lambda _: 'libreoffice')
    calls = []
    def convert(args, **kwargs):
        calls.append(args)
        folder = Path(args[args.index('--outdir') + 1])
        (folder / 'issued.pdf').write_bytes(b'%PDF-1.4\nconverted')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(report_pdf, '_run_converter', convert)
    assert report_pdf.download_options(report)['word_bytes'] == 13
    assert report_pdf.download_options(report)['pdf_bytes'] is None
    path = report_pdf.prepare_pdf(report)
    assert report_pdf.download_options(report)['pdf_bytes'] == path.stat().st_size
    assert report_pdf.prepare_pdf(report) == path
    assert len(calls) == 1
    assert report_pdf.archived_file(report).read_bytes() == b'archived-word'
    report_pdf.archived_file(report).write_bytes(b'changed archive')
    assert report_pdf.download_options(report)['pdf_bytes'] is None


def test_path_escape_and_missing_archive_never_convert(report):
    report.file_path = '../private.docx'
    assert report_pdf.download_options(report)['word_bytes'] is None
    with pytest.raises(HTTPException) as error:
        report_pdf.prepare_pdf(report)
    assert error.value.status_code == 404


def test_failed_conversion_does_not_cache_a_broken_pdf(report, monkeypatch):
    monkeypatch.setattr(report_pdf.shutil, 'which', lambda _: 'libreoffice')
    monkeypatch.setattr(report_pdf, '_run_converter', lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout=b'', stderr=b'conversion failed'))
    with pytest.raises(HTTPException) as error:
        report_pdf.prepare_pdf(report)
    assert error.value.status_code == 503
    assert report_pdf.download_options(report)['pdf_bytes'] is None


def test_timeout_stops_converter_children_and_reaps_process(monkeypatch):
    calls = []
    class Process:
        pid = 12345
        def communicate(self, timeout=None):
            calls.append(('communicate', timeout))
            if timeout:
                raise report_pdf.subprocess.TimeoutExpired('converter', timeout)
            return b'', b''
    with monkeypatch.context() as patch:
        patch.setattr(report_pdf.os, 'name', 'posix')
        patch.setattr(report_pdf.signal, 'SIGKILL', 9, raising=False)
        patch.setattr(report_pdf.os, 'killpg', lambda pid, signal: calls.append(('killgroup', pid)), raising=False)
        patch.setattr(report_pdf.subprocess, 'Popen', lambda *args, **kwargs: Process())
        with pytest.raises(report_pdf.subprocess.TimeoutExpired):
            report_pdf._run_converter(['converter'])
    assert calls == [('communicate', 1800), ('killgroup', 12345), ('communicate', None)]


def test_progress_counts_completed_parts_and_reports_merge_and_save(report, monkeypatch, tmp_path):
    from pypdf import PdfWriter, PdfReader
    source = report_pdf.archived_file(report)
    source.write_bytes(b'x' * (20 * 1024 * 1024))
    monkeypatch.setattr(report_pdf.shutil, 'which', lambda _: 'libreoffice')
    monkeypatch.setattr(report_pdf, '_conversion_document', lambda source, folder: source)
    monkeypatch.setattr(report_pdf, '_conversion_parts', lambda source, folder: [folder / 'one.docx', folder / 'two.docx'])
    def convert(args):
        output = Path(args[args.index('--outdir') + 1]) / (Path(args[-1]).stem + '.pdf')
        writer = PdfWriter(); writer.add_blank_page(width=200, height=200); writer.write(output); writer.close()
        return SimpleNamespace(returncode=0, stdout=b'', stderr=b'')
    monkeypatch.setattr(report_pdf, '_run_converter', convert)
    stages = []
    result = report_pdf.prepare_pdf(report, progress=lambda *event: stages.append(event))
    assert len(PdfReader(result).pages) == 2
    assert stages == [('preparing', 0, None), ('converting', 0, 2), ('converting', 1, 2), ('converting', 2, 2), ('combining', 2, 2), ('saving', 2, 2), ('complete', 2, 2)]
