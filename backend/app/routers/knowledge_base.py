"""Admin/team-leader-managed knowledge base — field reports, incident write-ups, and reference
files the help-chat assistant can search (see services/chat_tools.py's search_knowledge_base).
Upload extracts and stores plain text once (services/knowledge_extract.py) so search never has to
re-parse the original file. See models.KnowledgeDocument for the visibility rule (team_id null =
shared company-wide, set = scoped to that team)."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.deps import effective_team_id, get_current_user, has_permission
from app.models import KnowledgeDocument, User, UserRole
from app.schemas import KnowledgeDocumentOut
from app.services.knowledge_extract import extract_text

router = APIRouter(prefix="/api/knowledge-base", tags=["knowledge-base"])

_ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
}


def _can_manage(user: User) -> bool:
    """Who can upload/delete at all: reviewer always; a (super or permitted) admin via
    has_permission; a team_leader can (their own team only, enforced by the caller); nobody else —
    a team_member reads/searches only, same as the chat tool's own scoping."""
    if user.role == UserRole.REVIEWER.value:
        return True
    if user.role == UserRole.ADMIN.value:
        return has_permission(user, "manage_knowledge_base")
    return user.role == UserRole.TEAM_LEADER.value


def _doc_out(doc: KnowledgeDocument, uploader_name: str | None = None) -> KnowledgeDocumentOut:
    out = KnowledgeDocumentOut.model_validate(doc)
    out.team_name = doc.team.name if doc.team else None
    out.has_text = bool(doc.extracted_text)
    out.uploaded_by_name = uploader_name
    return out


@router.get("", response_model=list[KnowledgeDocumentOut])
def list_documents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(KnowledgeDocument).options(joinedload(KnowledgeDocument.team))
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value):
        tid = effective_team_id(db, user)
        q = q.filter(or_(KnowledgeDocument.team_id.is_(None), KnowledgeDocument.team_id == tid))
    docs = q.order_by(KnowledgeDocument.uploaded_at.desc()).all()

    uploader_ids = {d.uploaded_by for d in docs if d.uploaded_by}
    uploaders = {u.id: (u.full_name or u.username) for u in db.query(User).filter(User.id.in_(uploader_ids))} if uploader_ids else {}
    return [_doc_out(d, uploaders.get(d.uploaded_by)) for d in docs]


@router.post("", response_model=KnowledgeDocumentOut, status_code=201)
def upload_document(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    title: str = Form(...),
    description: str | None = Form(default=None),
    team_id: int | None = Form(default=None),
    file: UploadFile = File(...),
):
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if user.role == UserRole.TEAM_LEADER.value:
        # A team leader can only ever file it under their own team — never company-wide, never
        # another team's — regardless of what team_id the request actually sends.
        team_id = effective_team_id(db, user)
        if not team_id:
            raise HTTPException(status_code=400, detail="You're not linked to a team yet")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file given")
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, Word (.docx), .txt, or .md files are supported for the knowledge base",
        )

    ext = Path(file.filename).suffix or ""
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = settings.knowledge_base_dir / stored_name
    data = file.file.read()
    if len(data) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large (max {settings.max_upload_size_mb} MB)")
    dest.write_bytes(data)

    extracted = extract_text(dest)

    doc = KnowledgeDocument(
        title=title.strip(),
        description=(description or "").strip() or None,
        team_id=team_id,
        file_path=stored_name,
        original_filename=file.filename,
        content_type=file.content_type,
        file_size=len(data),
        extracted_text=extracted or None,
        uploaded_by=user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _doc_out(doc, user.full_name or user.username)


def _load_visible(db: Session, doc_id: int, user: User) -> KnowledgeDocument:
    doc = db.query(KnowledgeDocument).options(joinedload(KnowledgeDocument.team)).filter(KnowledgeDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value):
        tid = effective_team_id(db, user)
        if doc.team_id is not None and doc.team_id != tid:
            raise HTTPException(status_code=403, detail="You don't have access to this document")
    return doc


@router.get("/{doc_id}/file")
def download_document(doc_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _load_visible(db, doc_id, user)
    path = settings.knowledge_base_dir / doc.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(path, filename=doc.original_filename or path.name, media_type=doc.content_type)


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _load_visible(db, doc_id, user)
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if user.role == UserRole.TEAM_LEADER.value:
        tid = effective_team_id(db, user)
        # A leader can remove their own team's documents, but never a company-wide shared one —
        # that's an admin call, since other teams may be relying on it too.
        if doc.team_id != tid:
            raise HTTPException(status_code=403, detail="You can only remove your own team's documents")

    path = settings.knowledge_base_dir / doc.file_path
    if path.exists():
        path.unlink()
    db.delete(doc)
    db.commit()
    return None
