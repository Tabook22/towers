"""Turns typed/pasted or voice-transcribed text into a real file for the knowledge base — a
plain .txt, or a simple PDF — so it fits the same models.KnowledgeDocument shape an uploaded file
does (see routers/knowledge_base.py). No formatting beyond a title heading and wrapped body text;
this is a field report, not a formatted document, and reuses the same fpdf2 (Helvetica, pure
Python) stack as services/reports.py."""
from __future__ import annotations

from fpdf import FPDF


def render_text_pdf(title: str, body: str) -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 8, title)
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(0, 6, body)
    return bytes(pdf.output())
