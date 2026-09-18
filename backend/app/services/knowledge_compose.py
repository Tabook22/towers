"""Turns typed/pasted, rich-text, or voice-transcribed content into a real file for the knowledge
base — a plain .txt, or a PDF — so it fits the same models.KnowledgeDocument shape an uploaded
file does (see routers/knowledge_base.py). Reuses fpdf2 (Helvetica, pure Python), same as
services/reports.py.

render_text_pdf/render_html_pdf produce plain files, not a formatted report — this is a field
note, not the customer's official inspection PDF."""
from __future__ import annotations

import html as html_lib
import re

import bleach
from fpdf import FPDF

from app.config import settings

# The rich-text editor's toolbar only ever produces these tags/attributes — anything else in a
# request body is either a mistake or an attempted injection, so it's stripped rather than passed
# through. `data-align` and `width` on <img> carry the editor's resize/position controls; nothing
# else needs an attribute allowlist entry.
_ALLOWED_TAGS = [
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike",
    "h2", "h3", "ul", "ol", "li", "blockquote", "a", "img", "span",
]
_ALLOWED_ATTRS = {
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "width", "height", "data-align"],
}
_ALLOWED_PROTOCOLS = ["http", "https"]

_BLOCK_END = re.compile(r"</(?:p|div|li|h[1-6]|blockquote)>|<br\s*/?>", re.IGNORECASE)
_INLINE_IMAGE_SRC = re.compile(r'src="(/api/knowledge-base/inline-images/([^"/?]+))"')


def sanitize_html(raw: str) -> str:
    """Strips anything the rich-text editor couldn't have produced itself (scripts, event
    handlers, javascript: URLs, unknown tags) before it's ever stored or rendered back to any
    other user."""
    return bleach.clean(raw, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, protocols=_ALLOWED_PROTOCOLS, strip=True)


def html_to_text(html_body: str) -> str:
    """Plain-text version of composed HTML for search indexing and the .txt export — block
    boundaries become newlines first so words from different paragraphs/list items don't run
    together once the tags are gone."""
    with_breaks = _BLOCK_END.sub("\n", html_body)
    stripped = bleach.clean(with_breaks, tags=[], attributes={}, strip=True)
    text = html_lib.unescape(stripped)
    lines = [line.strip() for line in text.splitlines()]
    # Collapse runs of blank lines to at most one, matching how the editor's own paragraph spacing reads.
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def _resolve_inline_image_paths(html_body: str) -> str:
    """fpdf2's write_html loads <img src="..."> from a local path, not this app's own API — so
    the stored `/api/knowledge-base/inline-images/<file>` reference is swapped for the real file
    on disk just for this render. Any image that's gone missing is dropped rather than breaking
    the whole PDF."""
    def _replace(m: re.Match) -> str:
        path = settings.knowledge_base_dir / "inline" / m.group(2)
        if not path.exists():
            return 'src=""'
        return f'src="{path.as_posix()}"'

    return _INLINE_IMAGE_SRC.sub(_replace, html_body)


def render_text_pdf(title: str, body: str) -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 8, title)
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(0, 6, body)
    return bytes(pdf.output())


def render_html_pdf(title: str, html_body: str) -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 8, title)
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 11)
    pdf.write_html(_resolve_inline_image_paths(html_body))
    return bytes(pdf.output())
