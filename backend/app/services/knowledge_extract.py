"""Pulls plain text out of an uploaded knowledge-base file at upload time (see models.
KnowledgeDocument, routers/knowledge_base.py) so search never has to re-parse the original file.

Deliberately narrow: PDF, DOCX, and plain text/markdown — the formats a field report or incident
write-up actually shows up in. Anything else (an image, a spreadsheet) just gets no extracted
text and is searchable only by its title/description; there's no OCR here."""
from __future__ import annotations

from pathlib import Path

# Caps how much text one document contributes — keeps a single huge PDF from dominating search
# results or blowing up a tool-call's token cost when its excerpt is sent to the model.
_MAX_CHARS = 50_000


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            return _extract_pdf(path)
        if suffix == ".docx":
            return _extract_docx(path)
        if suffix in (".txt", ".md"):
            return path.read_text(encoding="utf-8", errors="ignore")[:_MAX_CHARS]
    except Exception:
        # A malformed/corrupt upload shouldn't break the upload itself — it just won't be
        # full-text searchable beyond its title/description.
        return ""
    return ""


def _extract_pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    return text[:_MAX_CHARS]


def _extract_docx(path: Path) -> str:
    import docx

    doc = docx.Document(str(path))
    text = "\n".join(p.text for p in doc.paragraphs)
    return text[:_MAX_CHARS]
