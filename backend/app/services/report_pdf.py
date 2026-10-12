"""Cached PDF copies of the actual archived issue; never regenerate field data."""
from pathlib import Path
import os
import logging
import signal
import shutil
import subprocess
import tempfile
import threading
import zipfile
from io import BytesIO
from PIL import Image

from fastapi import HTTPException
from app.config import settings

log = logging.getLogger(__name__)

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


def _conversion_document(source, folder):
    """Shrink oversized raster photos in a temporary package; retain all document XML."""
    if source.stat().st_size < 20 * 1024 * 1024:
        return source
    prepared = folder / 'input' / source.name
    prepared.parent.mkdir()
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(prepared, 'w', zipfile.ZIP_DEFLATED) as target:
        for entry in original.infolist():
            data = original.read(entry)
            if entry.filename.startswith('word/media/') and entry.filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                try:
                    with Image.open(BytesIO(data)) as image:
                        if max(image.size) > 2200:
                            image.thumbnail((2200, 2200), Image.Resampling.LANCZOS)
                            output = BytesIO()
                            image.save(output, format=image.format or ('PNG' if entry.filename.lower().endswith('.png') else 'JPEG'), **({'quality': 88} if image.format == 'JPEG' else {}))
                            if output.tell() < len(data):
                                data = output.getvalue()
                except (OSError, ValueError):
                    pass  # Preserve unsupported images rather than lose evidence.
            target.writestr(entry, data)
    return prepared


def _run_converter(args):
    # LibreOffice launches a child process: stop the whole isolated group on timeout.
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=os.name == 'posix')
    try:
        stdout, stderr = process.communicate(timeout=1800)
    except BaseException:
        if os.name == 'posix':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.communicate()
        raise
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def _convert(source, target, executable):
    with tempfile.TemporaryDirectory(prefix='report-pdf-', dir=target.parent) as folder:
        folder = Path(folder)
        # A separate profile prevents interference with other report conversions.
        profile = (folder / 'profile').resolve().as_uri()
        prepared = _conversion_document(source, folder)
        conversion = 'pdf:writer_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"true"},"MaxImageResolution":{"type":"long","value":"150"},"Quality":{"type":"long","value":"80"}}'
        try:
            result = _run_converter([executable, f'-env:UserInstallation={profile}', '--headless', '--convert-to', conversion, '--outdir', str(folder), str(prepared)])
        except (OSError, subprocess.TimeoutExpired) as error:
            raise HTTPException(503, 'Could not prepare the PDF. Please retry or download Word.') from error
        output = folder / (source.stem + '.pdf')
        if result.returncode or not output.is_file() or output.stat().st_size < 5:
            log.error('PDF converter failed: exit=%s stderr=%s stdout=%s', result.returncode, result.stderr[-2000:], result.stdout[-2000:])
            raise HTTPException(503, 'Could not prepare the PDF. Please retry or download Word.')
        with output.open('rb') as stream:
            if stream.read(5) != b'%PDF-':
                raise HTTPException(503, 'Could not prepare the PDF. Please retry or download Word.')
        os.replace(output, target)
    return target
