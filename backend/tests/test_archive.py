"""Storage path safety — a crafted upload filename must not escape the storage directory."""
from pathlib import Path

import pytest

from app.services.archive import file_extension, resolve_storage_path


def test_file_extension_strips_path_traversal():
    assert file_extension("shot.jpg/../../secret", "image/jpeg") == ".jpg"
    assert file_extension("note.webm/../../../etc/passwd", "audio/webm") == ".webm"
    assert file_extension("ok.JPEG", None) == ".jpeg"
    assert file_extension("report.docx", None) == ".docx"
    assert file_extension(None, "audio/webm") == ".webm"
    assert file_extension("noext", "application/pdf") == ".pdf"


def test_resolve_storage_path_rejects_escape(tmp_path: Path):
    base = tmp_path / "voice_notes"
    base.mkdir()
    dest = resolve_storage_path(base, "1/2026-09-11/note.webm")
    assert dest.is_relative_to(base.resolve())
    with pytest.raises(ValueError):
        resolve_storage_path(base, "../secret.webm")
    with pytest.raises(ValueError):
        resolve_storage_path(base, "1/../../secret.webm")
