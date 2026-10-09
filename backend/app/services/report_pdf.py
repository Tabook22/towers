"""Cached PDF copies of the actual archived issue; never regenerate field data."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import threading

from fastapi import HTTPException
from app.config import settings

_conversion_slots = threading.BoundedSemaphore(2)


def archived_file(record):
    if not record.file_path:
        return None
    path = (settings.reports_dir / record.file_path).resolve()
    return path if path.is_relative_to(settings.reports_dir.resolve()) and path.is_file() else None


def pdf_file(record):
    source = archived_file(record)
    if not source:
        return None
    stat = source.stat()
    return settings.reports_dir / '.pdf-cache' / f'{record.id}-{stat.st_size}-{stat.st_mtime_ns}.pdf'


def download_options(record):
    word = archived_file(record)
    pdf = pdf_file(record)
    return {'word_bytes': word.stat().st_size if word else None,
            'pdf_bytes': pdf.stat().st_size if pdf and pdf.is_file() else None,
            'pdf_available': bool(word and shutil.which('libreoffice'))}


def prepare_pdf(record):
    source = archived_file(record)
    if not source:
        raise HTTPException(404, 'No archived Word document is available for PDF conversion')
    target = pdf_file(record)
    if target.is_file():
        return target
    executable = shutil.which('libreoffice')
    if not executable:
        raise HTTPException(503, 'PDF conversion is temporarily unavailable. Please download Word or try again later.')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not _conversion_slots.acquire(timeout=30):
        raise HTTPException(429, 'PDF preparation is busy. Please try again shortly.')
    try:
        return _convert(source, target, executable)
    finally:
        _conversion_slots.release()


def _convert(source, target, executable):
    with tempfile.TemporaryDirectory(prefix='report-pdf-', dir=target.parent) as folder:
        folder = Path(folder)
        # A separate profile prevents interference with other report conversions.
        profile = (folder / 'profile').resolve().as_uri()
        conversion = 'pdf:writer_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"true"},"MaxImageResolution":{"type":"long","value":"150"},"Quality":{"type":"long","value":"80"}}'
        try:
            result = subprocess.run([executable, f'-env:UserInstallation={profile}', '--headless', '--convert-to', conversion, '--outdir', str(folder), str(source)], capture_output=True, timeout=600)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise HTTPException(503, 'Could not prepare the PDF. Please retry or download Word.') from error
        output = folder / (source.stem + '.pdf')
        if result.returncode or not output.is_file() or output.stat().st_size < 5:
            raise HTTPException(503, 'Could not prepare the PDF. Please retry or download Word.')
        with output.open('rb') as stream:
            if stream.read(5) != b'%PDF-':
                raise HTTPException(503, 'Could not prepare the PDF. Please retry or download Word.')
        os.replace(output, target)
    return target
