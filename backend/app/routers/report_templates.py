from __future__ import annotations

import datetime as dt
import io
import uuid

from docx import Document as DocxDocument
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_permission_level
from app.models import ReportTemplate, User, UserRole
from app.schemas import ReportTemplateOut, ReportTemplatesActive
from app.services.docx_reports import build_starter_template
from app.services.pdf_form_reports import build_starter_pdf_form

router = APIRouter(prefix="/api/report-templates", tags=["report-templates"])

DOCX_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    # Some browsers/OSes send a generic type depending on file-association state — the extension +
    # actually-opening-it-as-a-.docx check below is what really guards against a bad upload.
    "application/octet-stream",
}
PDF_CONTENT_TYPES = {"application/pdf", "application/octet-stream"}


def _active(db: Session, kind: str) -> ReportTemplate | None:
    return (
        db.query(ReportTemplate)
        .filter(ReportTemplate.is_active.is_(True), ReportTemplate.kind == kind)
        .order_by(ReportTemplate.id.desc())
        .first()
    )


@router.get("/active", response_model=ReportTemplatesActive)
def get_active_templates(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return ReportTemplatesActive(docx=_active(db, "docx"), pdf=_active(db, "pdf"))


@router.post("", response_model=ReportTemplateOut, status_code=201)
async def upload_template(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission_level("generate_reports", "add", UserRole.REVIEWER.value)),
):
    """Kind (Word vs. PDF form) is auto-detected from the file extension — one upload control on
    the frontend handles both, no separate endpoint per kind needed."""
    filename = file.filename or ""
    lower = filename.lower()
    if lower.endswith(".docx"):
        kind, ext = "docx", ".docx"
        if file.content_type not in DOCX_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="Please upload a Word .docx file")
    elif lower.endswith(".pdf"):
        kind, ext = "pdf", ".pdf"
        if file.content_type not in PDF_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="Please upload a PDF file")
    else:
        raise HTTPException(status_code=400, detail="Please upload a Word (.docx) or fillable PDF (.pdf) file")

    raw = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB limit")

    # Sanity-check it's actually a well-formed file of the claimed kind before it becomes "the"
    # active template — better to reject a corrupt/mislabeled upload now than to have every report
    # generation from here on fail with an opaque docxtpl/pypdf error.
    if kind == "docx":
        try:
            DocxDocument(io.BytesIO(raw))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="This doesn't look like a valid Word (.docx) file") from exc
    else:
        try:
            reader = PdfReader(io.BytesIO(raw))
            fields = reader.get_fields()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="This doesn't look like a valid PDF file") from exc
        if not fields:
            raise HTTPException(
                status_code=400,
                detail="This PDF has no fillable form fields — it needs to be a fillable form, not a flat "
                "PDF. Download the starter PDF template for a working example.",
            )

    rel_path = f"{uuid.uuid4().hex}{ext}"
    (settings.report_templates_dir / rel_path).write_bytes(raw)

    # Only one template per KIND is ever active at a time — earlier ones (of either kind) stay on
    # disk and in the DB (see models.ReportTemplate's docstring) so nothing is destroyed, they just
    # stop being used. A docx and a pdf template can be active simultaneously, so this only touches
    # rows matching the kind just uploaded.
    db.query(ReportTemplate).filter(ReportTemplate.is_active.is_(True), ReportTemplate.kind == kind).update(
        {"is_active": False}
    )

    template = ReportTemplate(
        kind=kind,
        original_filename=filename,
        file_path=rel_path,
        is_active=True,
        uploaded_by=user.id,
        uploaded_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/active", status_code=204)
def clear_active_template(
    kind: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission_level("generate_reports", "full", UserRole.REVIEWER.value)),
):
    if kind not in ("docx", "pdf"):
        raise HTTPException(status_code=400, detail="kind must be 'docx' or 'pdf'")
    db.query(ReportTemplate).filter(ReportTemplate.is_active.is_(True), ReportTemplate.kind == kind).update(
        {"is_active": False}
    )
    db.commit()
    return None


@router.get("/starter")
def download_starter_template(kind: str = "docx", _user: User = Depends(get_current_user)):
    if kind == "pdf":
        pdf_bytes = build_starter_pdf_form()
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="report-template-starter-form.pdf"'},
        )
    if kind != "docx":
        raise HTTPException(status_code=400, detail="kind must be 'docx' or 'pdf'")
    docx_bytes = build_starter_template()
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": 'attachment; filename="report-template-starter.docx"'},
    )
