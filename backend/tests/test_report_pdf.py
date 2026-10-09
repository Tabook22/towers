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
    monkeypatch.setattr(report_pdf.subprocess, 'run', convert)
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
    monkeypatch.setattr(report_pdf.subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(returncode=1))
    with pytest.raises(HTTPException) as error:
        report_pdf.prepare_pdf(report)
    assert error.value.status_code == 503
    assert report_pdf.download_options(report)['pdf_bytes'] is None
