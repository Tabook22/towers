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
from app.schemas import KnowledgeDocumentDetail, KnowledgeDocumentOut, KnowledgeDocumentUpdate
from app.services.knowledge_compose import render_text_pdf
from app.services.knowledge_extract import extract_text
from app.services.transcribe import transcribe_audio

router = APIRouter(prefix="/api/knowledge-base", tags=["knowledge-base"])

_ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
}

# Same set routers/teams.py's voice-note upload accepts — whatever a browser's MediaRecorder
# actually produces varies by device/browser, so this stays permissive on container format.
_ACCEPTED_AUDIO_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
    "audio/x-m4a",
    "video/webm",
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
    out.has_voice = bool(doc.voice_path)
    out.uploaded_by_name = uploader_name
    return out


def _require_modify(db: Session, doc: KnowledgeDocument, user: User) -> None:
    """The shared gate for delete AND edit: can this user manage documents at all, and — for a
    team leader — is this specifically one of their own team's documents (never a company-wide
    one, never another team's, since other teams may depend on those)."""
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if user.role == UserRole.TEAM_LEADER.value:
        tid = effective_team_id(db, user)
        if doc.team_id != tid:
            raise HTTPException(status_code=403, detail="You can only manage your own team's documents")


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
    file: UploadFile | None = File(default=None),
    # The alternative to `file`: typed/pasted text, or a voice recording already turned into text
    # via POST .../transcribe — either way it lands here as plain text, and save_as decides what
    # kind of file it becomes in storage.
    text_content: str | None = Form(default=None),
    save_as: str = Form(default="txt"),
    # When text_content came from a voice recording, the original audio — kept alongside the
    # transcript so it can be played back later (see GET .../voice), never re-transcribed.
    voice: UploadFile | None = File(default=None),
    voice_duration_seconds: float | None = Form(default=None),
):
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if user.role == UserRole.TEAM_LEADER.value:
        # A team leader can only ever file it under their own team — never company-wide, never
        # another team's — regardless of what team_id the request actually sends.
        team_id = effective_team_id(db, user)
        if not team_id:
            raise HTTPException(status_code=400, detail="You're not linked to a team yet")

    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="A title is required")

    if file is not None and (text_content or "").strip():
        raise HTTPException(status_code=400, detail="Provide either a file or text, not both")

    is_composed = False
    voice_path = voice_content_type = None
    if file is not None:
        stored_name, content_type, original_filename, data, extracted = _store_uploaded_file(file)
    elif (text_content or "").strip():
        stored_name, content_type, original_filename, data, extracted = _store_typed_text(title, text_content.strip(), save_as)
        is_composed = True
        if voice is not None and voice.filename:
            voice_path, voice_content_type = _store_voice(voice)
    else:
        raise HTTPException(status_code=400, detail="Provide a file, or some text to save")

    doc = KnowledgeDocument(
        title=title,
        description=(description or "").strip() or None,
        team_id=team_id,
        file_path=stored_name,
        original_filename=original_filename,
        content_type=content_type,
        file_size=len(data),
        extracted_text=extracted or None,
        is_composed=is_composed,
        voice_path=voice_path,
        voice_content_type=voice_content_type,
        voice_duration_seconds=voice_duration_seconds,
        uploaded_by=user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _doc_out(doc, user.full_name or user.username)


def _store_voice(voice: UploadFile) -> tuple[str | None, str | None]:
    content_type = (voice.content_type or "").split(";")[0].strip().lower()
    if content_type not in _ACCEPTED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {voice.content_type}")
    data = voice.file.read()
    if not data:
        return None, None  # empty recording is a no-op, not an error — the transcript still saves
    ext = Path(voice.filename or "").suffix or ".webm"
    stored_name = f"{uuid.uuid4().hex}{ext}"
    (settings.knowledge_base_dir / stored_name).write_bytes(data)
    return stored_name, content_type


def _store_uploaded_file(file: UploadFile) -> tuple[str, str, str, bytes, str]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file given")
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, Word (.docx), .txt, or .md files are supported for the knowledge base",
        )
    data = file.file.read()
    if len(data) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large (max {settings.max_upload_size_mb} MB)")

    ext = Path(file.filename).suffix or ""
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = settings.knowledge_base_dir / stored_name
    dest.write_bytes(data)
    extracted = extract_text(dest)
    return stored_name, file.content_type, file.filename, data, extracted


def _store_typed_text(title: str, text: str, save_as: str) -> tuple[str, str, str, bytes, str]:
    if save_as not in ("txt", "pdf"):
        raise HTTPException(status_code=400, detail="save_as must be 'txt' or 'pdf'")
    if save_as == "pdf":
        try:
            data = render_text_pdf(title, text)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Could not create a PDF from this text (it may contain unsupported characters) — try saving as .txt instead",
            )
        content_type = "application/pdf"
    else:
        data = text.encode("utf-8")
        content_type = "text/plain"
    ext = ".pdf" if save_as == "pdf" else ".txt"
    stored_name = f"{uuid.uuid4().hex}{ext}"
    (settings.knowledge_base_dir / stored_name).write_bytes(data)
    return stored_name, content_type, f"{title}{ext}", data, text


@router.post("/transcribe")
async def transcribe_for_knowledge_base(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """Turns a voice recording into text for the "record instead of typing" path in the upload
    dialog — returns the transcript only, so the admin/team leader can review and edit it before
    it's actually saved as a document via POST ''. Nothing is written to the knowledge base here."""
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in _ACCEPTED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {file.content_type}")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty recording")
    text, err = transcribe_audio(raw, file.filename or "recording.webm", content_type)
    if not text:
        raise HTTPException(status_code=503, detail=err or "Could not transcribe this recording")
    return {"transcript": text}


def _load_visible(db: Session, doc_id: int, user: User) -> KnowledgeDocument:
    doc = db.query(KnowledgeDocument).options(joinedload(KnowledgeDocument.team)).filter(KnowledgeDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value):
        tid = effective_team_id(db, user)
        if doc.team_id is not None and doc.team_id != tid:
            raise HTTPException(status_code=403, detail="You don't have access to this document")
    return doc


@router.get("/{doc_id}", response_model=KnowledgeDocumentDetail)
def get_document(doc_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The full detail view (including extracted_text) — used to populate the edit dialog, so
    editing a composed document's body doesn't need a second round trip just to see what it says."""
    doc = _load_visible(db, doc_id, user)
    uploader = db.get(User, doc.uploaded_by) if doc.uploaded_by else None
    out = KnowledgeDocumentDetail.model_validate(doc)
    out.team_name = doc.team.name if doc.team else None
    out.has_text = bool(doc.extracted_text)
    out.has_voice = bool(doc.voice_path)
    out.uploaded_by_name = (uploader.full_name or uploader.username) if uploader else None
    return out


@router.get("/{doc_id}/file")
def download_document(
    doc_id: int,
    inline: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """`inline=true` (used by DocumentPreviewDialog's PDF viewer) asks the browser to render the
    file itself rather than save it — Starlette's FileResponse defaults to "attachment", which
    forces a download even inside an <iframe> and is why the read-only viewer used to just
    download a PDF instead of showing it. The actual Download button/link never passes this."""
    doc = _load_visible(db, doc_id, user)
    path = settings.knowledge_base_dir / doc.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(
        path,
        filename=doc.original_filename or path.name,
        media_type=doc.content_type,
        content_disposition_type="inline" if inline else "attachment",
    )


@router.get("/{doc_id}/voice")
def download_voice(doc_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _load_visible(db, doc_id, user)
    if not doc.voice_path:
        raise HTTPException(status_code=404, detail="No voice recording attached to this document")
    path = settings.knowledge_base_dir / doc.voice_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Voice file missing on disk")
    return FileResponse(path, media_type=doc.voice_content_type or "audio/webm")


@router.patch("/{doc_id}", response_model=KnowledgeDocumentOut)
def update_document(
    doc_id: int,
    payload: KnowledgeDocumentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = _load_visible(db, doc_id, user)
    _require_modify(db, doc, user)

    data = payload.model_dump(exclude_unset=True)
    body_text = data.pop("body_text", None)
    save_as = data.pop("save_as", None)

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        doc.title = title
    if "description" in data:
        doc.description = (data["description"] or "").strip() or None
    if "team_id" in data and user.role != UserRole.TEAM_LEADER.value:
        # A team leader's own documents always stay filed under their own team — the same rule
        # upload_document enforces at creation — so team_id is silently ignored for them here too,
        # rather than accepted from a leader and quietly moving a document to another team.
        doc.team_id = data["team_id"]

    if body_text is not None:
        if not doc.is_composed:
            raise HTTPException(
                status_code=400,
                detail="This document was uploaded as a file — delete and re-upload to change its content",
            )
        text = body_text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        chosen_format = save_as or ("pdf" if doc.content_type == "application/pdf" else "txt")
        old_path = settings.knowledge_base_dir / doc.file_path
        stored_name, content_type, original_filename, new_data, extracted = _store_typed_text(doc.title, text, chosen_format)
        if old_path.exists():
            old_path.unlink()
        doc.file_path = stored_name
        doc.content_type = content_type
        doc.original_filename = original_filename
        doc.file_size = len(new_data)
        doc.extracted_text = extracted

    db.commit()
    db.refresh(doc)
    uploader = db.get(User, doc.uploaded_by) if doc.uploaded_by else None
    return _doc_out(doc, (uploader.full_name or uploader.username) if uploader else None)


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _load_visible(db, doc_id, user)
    _require_modify(db, doc, user)

    path = settings.knowledge_base_dir / doc.file_path
    if path.exists():
        path.unlink()
    if doc.voice_path:
        voice_path = settings.knowledge_base_dir / doc.voice_path
        if voice_path.exists():
            voice_path.unlink()
    db.delete(doc)
    db.commit()
    return None
