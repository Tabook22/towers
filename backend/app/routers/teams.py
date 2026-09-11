"""Team management: rosters, missions, and a day-by-day progress log per team.

A Team is a real-world field crew (leader + members, mostly without logins of their own) — separate
from `User`, which just says "which team does this login's device/pings count toward" via
`User.team_id`.

A mission is NOT a separate record from a visit — it IS a Visit, with `Visit.team_id` and
`Visit.mission_seq` set (see models.Visit). "Assign Team Alpha's Mission 3" and "log an inspection
visit to tower X" are the same action; everything a visit already carries — positions, the 48-shot
checklist, screening, annotations, the free-form photo gallery, reports — is automatically part of
the mission with no duplicate data entry. This router's mission endpoints are thin, team-scoped
wrappers around the visits router (see create_visit_row/attach_rollup imports below); editing a
mission's fields, uploading its photos, or deleting it is done through the normal `/api/visits/...`
endpoints once you have its id.

Progress (towers visited, screened, hotspots) is always computed live from the team's Visits —
never stored — so it can't drift out of sync with the actual inspection data. `TeamDailyLog` holds
only the qualitative side: notes, delays, handovers — the things a team leader would phone in that
no visit record captures.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import effective_team_id, get_current_user, require_role, require_team_read, require_team_scope
from app.models import LineInspectionReport, LocationPing, Position, Team, TeamDailyLog, TeamDailyLogFile, TeamMember, TeamOutingPlan, TeamOutingTower, Tower, TrackingMission, User, UserRole, Visit
from app.routers.visits import _load_visit, attach_rollup, create_visit_row, delete_visit_completely
from app.schemas import (
    LiveTeamMember,
    TeamCreate,
    TeamDailyLogCreate,
    TeamDailyLogFileOut,
    TeamDailyLogFileUpdate,
    TeamDailyLogOut,
    TeamDailyLogUpdate,
    TeamDayProgress,
    NextTowersPlan,
    OutingPlanOut,
    OutingPlanSave,
    OutingPlanTowerOut,
    TeamJobMap,
    TeamJobMapTower,
    TeamMemberCreate,
    TeamMemberOut,
    TeamMemberUpdate,
    TeamOut,
    TeamProgressOut,
    TeamTodayProgress,
    TeamUpdate,
    TrackingMissionOut,
    TrailPoint,
    UserTrailOut,
    VisitCreate,
    VisitDetail,
    VisitOut,
)
from app.config import settings
from app.services.archive import file_extension, save_upload
from app.services.movement import build_team_progress, current_field_date, hour_window, shift_window
from app.services.next_towers import build_next_towers
from app.services.rollup import visit_rollup
from app.services.transcribe import transcribe_audio

router = APIRouter(prefix="/api/teams", tags=["teams"])

STALE_AFTER_MINUTES = 3

ACCEPTED_FILE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
    "image/tiff",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _is_image(content_type: str | None) -> bool:
    return (content_type or "").startswith("image/")


def _is_pdf(content_type: str | None, filename: str | None) -> bool:
    if (content_type or "") == "application/pdf":
        return True
    return (filename or "").lower().endswith(".pdf")


def _safe_filename(name: str | None) -> str:
    raw = (name or "file").replace("\\", "_").replace("/", "_")
    cleaned = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in raw).strip() or "file"
    return cleaned[:120]


async def _store_log_files(
    team_id: int,
    log_date: dt.date,
    uploads: list[UploadFile],
) -> list[TeamDailyLogFile]:
    if not isinstance(uploads, list):
        uploads = [uploads]
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    saved: list[TeamDailyLogFile] = []
    stamp_base = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    for i, upload in enumerate(uploads):
        content_type = (upload.content_type or "").split(";")[0].strip().lower()
        name = upload.filename or ""
        lower = name.lower()
        if not content_type or content_type == "application/octet-stream":
            if lower.endswith((".jpg", ".jpeg")):
                content_type = "image/jpeg"
            elif lower.endswith(".png"):
                content_type = "image/png"
            elif lower.endswith(".webp"):
                content_type = "image/webp"
            elif lower.endswith(".gif"):
                content_type = "image/gif"
        if name.lower().endswith(".pdf"):
            content_type = content_type if content_type in ACCEPTED_FILE_TYPES else "application/pdf"
        elif name.lower().endswith(".docx"):
            content_type = content_type if content_type in ACCEPTED_FILE_TYPES else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif name.lower().endswith(".doc"):
            content_type = content_type if content_type in ACCEPTED_FILE_TYPES else "application/msword"
        if content_type not in ACCEPTED_FILE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type for {name or 'upload'}: images, PDF, or Word only",
            )
        raw = await upload.read()
        if not raw:
            continue
        if len(raw) > max_bytes:
            raise HTTPException(status_code=400, detail=f"{name or 'File'} is too large")
        ext = file_extension(name, content_type)
        rel_path = f"{team_id}/{log_date.isoformat()}/{stamp_base}-{i}{ext}"
        save_upload(raw, rel_path, base_dir=settings.log_files_dir)
        saved.append(
            TeamDailyLogFile(
                file_path=rel_path,
                content_type=content_type,
                original_filename=name or f"file{ext}",
                file_size=len(raw),
            )
        )
    if not saved:
        raise HTTPException(status_code=400, detail="Files were empty")
    return saved


def _reload_note(db: Session, note_id: int) -> TeamDailyLog:
    log = (
        db.query(TeamDailyLog)
        .options(joinedload(TeamDailyLog.files))
        .filter(TeamDailyLog.id == note_id)
        .first()
    )
    if not log:
        raise HTTPException(status_code=404, detail="Note not found")
    return log


def _file_out(row: TeamDailyLogFile) -> TeamDailyLogFileOut:
    return TeamDailyLogFileOut(
        id=row.id,
        original_filename=row.original_filename,
        content_type=row.content_type,
        file_size=row.file_size,
        is_image=_is_image(row.content_type),
        is_pdf=_is_pdf(row.content_type, row.original_filename),
    )


ACCEPTED_AUDIO_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
    "audio/x-m4a",
    "video/webm",  # some Chrome MediaRecorder labels webm-opus this way
}


def _note_out(log: TeamDailyLog, db: Session) -> TeamDailyLogOut:
    author = db.get(User, log.created_by) if log.created_by else None
    return TeamDailyLogOut(
        id=log.id,
        team_id=log.team_id,
        log_date=log.log_date,
        note=log.note,
        has_audio=bool(log.audio_path),
        transcribed=bool(log.transcribed),
        audio_content_type=log.audio_content_type,
        duration_seconds=log.duration_seconds,
        attachments=[_file_out(f) for f in (log.files or [])],
        created_by=log.created_by,
        created_by_name=(author.full_name or author.username) if author else None,
        created_at=log.created_at,
    )


def _team_out(team: Team, db: Session, mission_count: int | None = None) -> TeamOut:
    out = TeamOut.model_validate(team)
    out.linked_user_count = len(team.users)
    if mission_count is None:
        mission_count = int(db.query(func.count(Visit.id)).filter(Visit.team_id == team.id).scalar() or 0)
    out.mission_count = mission_count
    return out


def _assign_leader(db: Session, team: Team, leader_user_id: int | None) -> None:
    """Links (or unlinks, if None) a team-leader login as this team's leader. Once linked, it's the
    authoritative source for `leader_name`/`leader_phone` — auto-filled here from the account's
    profile so anything already reading those two plain-text fields keeps working unchanged.
    Reassigning a leader who currently leads a *different* team moves them here automatically,
    detaching them (and that team's own leader_user_id) from wherever they were before, rather than
    leaving two teams both pointing at the same login."""
    if team.leader_user_id == leader_user_id:
        return
    if team.leader_user_id:
        prev = db.get(User, team.leader_user_id)
        if prev and prev.team_id == team.id:
            prev.team_id = None
    team.leader_user_id = leader_user_id
    if leader_user_id is None:
        return
    leader = db.get(User, leader_user_id)
    if not leader:
        raise HTTPException(status_code=404, detail="Team leader account not found")
    if leader.role != UserRole.TEAM_LEADER.value:
        raise HTTPException(status_code=400, detail="That account isn't a team-leader login")
    if leader.team_id and leader.team_id != team.id:
        other = db.get(Team, leader.team_id)
        if other and other.leader_user_id == leader.id:
            other.leader_user_id = None
    leader.team_id = team.id
    team.leader_name = leader.full_name or leader.username
    team.leader_phone = leader.mobile


def _load_team(db: Session, team_id: int) -> Team:
    team = (
        db.query(Team)
        .options(joinedload(Team.members), joinedload(Team.users))
        .filter(Team.id == team_id)
        .first()
    )
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.get("", response_model=list[TeamOut])
def list_teams(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    include_inactive: bool = False,
):
    q = db.query(Team).options(joinedload(Team.members), joinedload(Team.users))
    if not include_inactive:
        q = q.filter(Team.is_active.is_(True))
    # A team_leader or team_member only ever sees their own team — this list is the one place a
    # cross-team leak would be easy to miss, since every other endpoint takes a team_id in the path.
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value):
        tid = effective_team_id(db, user)
        if tid:
            q = q.filter(Team.id == tid)
        elif user.role == UserRole.TEAM_LEADER.value:
            q = q.filter(Team.leader_user_id == user.id)
        else:
            q = q.filter(False)
    teams = q.order_by(Team.name).all()
    ids = [t.id for t in teams]
    counts = (
        dict(
            db.query(Visit.team_id, func.count(Visit.id))
            .filter(Visit.team_id.in_(ids))
            .group_by(Visit.team_id)
            .all()
        )
        if ids
        else {}
    )
    return [_team_out(t, db, counts.get(t.id, 0)) for t in teams]


@router.post("", response_model=TeamOut, status_code=201)
def create_team(
    payload: TeamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    if db.query(Team).filter(Team.name.ilike(payload.name)).first():
        raise HTTPException(status_code=400, detail=f"A team named '{payload.name}' already exists")
    data = payload.model_dump(exclude={"members", "leader_user_id"})
    team = Team(**data, created_by=user.id)
    db.add(team)
    db.flush()
    for m in payload.members:
        db.add(TeamMember(team_id=team.id, **m.model_dump()))
    _assign_leader(db, team, payload.leader_user_id)
    db.commit()
    return _team_out(_load_team(db, team.id), db)


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, db: Session = Depends(get_db), _user: User = Depends(require_team_read())):
    return _team_out(_load_team(db, team_id), db)


@router.patch("/{team_id}", response_model=TeamOut)
def update_team(
    team_id: int,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    team = _load_team(db, team_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        clash = db.query(Team).filter(Team.name.ilike(data["name"]), Team.id != team_id).first()
        if clash:
            raise HTTPException(status_code=400, detail=f"A team named '{data['name']}' already exists")
    leader_provided = "leader_user_id" in data
    leader_value = data.pop("leader_user_id", None)
    for k, v in data.items():
        setattr(team, k, v)
    if leader_provided:
        _assign_leader(db, team, leader_value)
    db.commit()
    return _team_out(_load_team(db, team_id), db)


@router.delete("/{team_id}", status_code=204)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role(UserRole.ADMIN.value, UserRole.REVIEWER.value)),
):
    """Deleting a team is total, by design: every mission it ever ran (its Visits — positions,
    images, photos, all of it, files on disk included), every team-leader/team-member LOGIN linked
    to it, its roster and daily log, and any official report generated for it are all destroyed
    along with it. Nothing "belonging" to the team survives — this is deliberately NOT the soft
    archive teams used to get; an admin who deletes a team means gone.

    Towers are the one exception: they're real physical infrastructure that outlives any one team,
    so they're just unassigned (Tower.assigned_team_id cleared) rather than deleted — their own
    inspection history (from this or any other team) is untouched. Cannot be undone, so the
    frontend confirms — with the actual counts below — before calling this."""
    team = _load_team(db, team_id)

    # Team.leader_user_id -> users.id and User.team_id -> teams.id point at each other, so deleting
    # both the team and its linked users in the same flush is a genuine circular dependency as far
    # as SQLAlchemy's delete-ordering is concerned — break the cycle explicitly first.
    team.leader_user_id = None
    db.flush()

    # Every mission this team ran — full delete (DB rows + files on disk), same as a single visit's
    # own DELETE /api/visits/{id} endpoint.
    visits = (
        db.query(Visit)
        .options(joinedload(Visit.positions).joinedload(Position.images), joinedload(Visit.photos))
        .filter(Visit.team_id == team_id)
        .all()
    )
    for v in visits:
        delete_visit_completely(db, v)

    # Every login tied to this team — leader and team_member roster alike — plus their GPS-ping
    # history, which is meaningless once the account is gone.
    linked_users = db.query(User).filter(User.team_id == team_id).all()
    linked_user_ids = [u.id for u in linked_users]
    if linked_user_ids:
        db.query(LocationPing).filter(LocationPing.user_id.in_(linked_user_ids)).delete(synchronize_session=False)
    for u in linked_users:
        db.delete(u)
    db.flush()

    db.query(Tower).filter(Tower.assigned_team_id == team_id).update({"assigned_team_id": None})
    db.query(LineInspectionReport).filter(LineInspectionReport.team_id == team_id).delete()
    db.delete(team)  # cascades to TeamMember/TeamDailyLog rows (relationship cascade="all, delete-orphan")
    db.commit()
    return None


# ---------- Roster ----------
@router.post("/{team_id}/members", response_model=TeamMemberOut, status_code=201)
def add_member(
    team_id: int,
    payload: TeamMemberCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    _load_team(db, team_id)  # 404 if missing
    member = TeamMember(team_id=team_id, **payload.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch("/{team_id}/members/{member_id}", response_model=TeamMemberOut)
def update_member(
    team_id: int,
    member_id: int,
    payload: TeamMemberUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    member = db.query(TeamMember).filter(TeamMember.id == member_id, TeamMember.team_id == team_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(member, k, v)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/{team_id}/members/{member_id}", status_code=204)
def remove_member(
    team_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    member = db.query(TeamMember).filter(TeamMember.id == member_id, TeamMember.team_id == team_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    db.delete(member)
    db.commit()
    return None


# ---------- Daily log (qualitative notes) ----------
@router.post("/{team_id}/notes", response_model=TeamDailyLogOut, status_code=201)
def add_note(
    team_id: int,
    payload: TeamDailyLogCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    _load_team(db, team_id)
    log = TeamDailyLog(team_id=team_id, created_by=user.id, **payload.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return _note_out(log, db)


@router.post("/{team_id}/notes/voice", response_model=TeamDailyLogOut, status_code=201)
async def add_voice_note(
    team_id: int,
    log_date: dt.date = Form(...),
    file: UploadFile = File(...),
    note: str | None = Form(default=None),
    duration_seconds: float | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    """Save the recording only. Convert to text later with POST .../notes/{id}/transcribe so the
    crew can review the words before they go into a report."""
    _load_team(db, team_id)
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ACCEPTED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {file.content_type}")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty recording")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail="Recording is too large")
    ext = file_extension(file.filename, content_type)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    rel_path = f"{team_id}/{log_date.isoformat()}/{stamp}{ext}"
    save_upload(raw, rel_path, base_dir=settings.voice_notes_dir)
    caption = (note or "").strip()
    log = TeamDailyLog(
        team_id=team_id,
        log_date=log_date,
        note=caption or "Voice note",
        audio_path=rel_path,
        audio_content_type=content_type,
        audio_original_filename=file.filename,
        duration_seconds=duration_seconds,
        transcribed=bool(caption),
        created_by=user.id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return _note_out(log, db)


@router.post("/{team_id}/notes/files", response_model=TeamDailyLogOut, status_code=201)
async def add_note_files(
    team_id: int,
    log_date: dt.date = Form(...),
    note: str | None = Form(default=None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    """Attach several site-visit photos/PDFs/Word files (and a comment) to this team's daily log."""
    _load_team(db, team_id)
    saved = await _store_log_files(team_id, log_date, files if isinstance(files, list) else [files])
    log = TeamDailyLog(
        team_id=team_id,
        log_date=log_date,
        note=(note or "").strip() or "Site attachment",
        created_by=user.id,
        files=saved,
    )
    db.add(log)
    db.commit()
    return _note_out(_reload_note(db, log.id), db)


@router.post("/{team_id}/notes/{note_id}/files", response_model=TeamDailyLogOut)
async def add_files_to_note(
    team_id: int,
    note_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Add more photos/PDFs to an existing daily-log note."""
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Note not found")
    extra = await _store_log_files(team_id, log.log_date, files if isinstance(files, list) else [files])
    for row in extra:
        row.log_id = log.id
        db.add(row)
    db.commit()
    return _note_out(_reload_note(db, log.id), db)


@router.get("/{team_id}/notes/{note_id}/files/{file_id}")
def get_note_file(
    team_id: int,
    note_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Note not found")
    row = db.query(TeamDailyLogFile).filter(TeamDailyLogFile.id == file_id, TeamDailyLogFile.log_id == log.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = settings.log_files_dir / row.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    inline = _is_image(row.content_type) or _is_pdf(row.content_type, row.original_filename)
    headers = {"Cache-Control": "no-cache"}
    if inline and row.original_filename:
        headers["Content-Disposition"] = f'inline; filename="{_safe_filename(row.original_filename)}"'
    return FileResponse(
        path,
        media_type=row.content_type or "application/octet-stream",
        filename=None if inline else (row.original_filename or path.name),
        headers=headers,
    )


def _load_note_file(db: Session, team_id: int, note_id: int, file_id: int) -> tuple[TeamDailyLog, TeamDailyLogFile]:
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Note not found")
    row = db.query(TeamDailyLogFile).filter(TeamDailyLogFile.id == file_id, TeamDailyLogFile.log_id == log.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return log, row


@router.patch("/{team_id}/notes/{note_id}/files/{file_id}", response_model=TeamDailyLogOut)
def rename_note_file(
    team_id: int,
    note_id: int,
    file_id: int,
    payload: TeamDailyLogFileUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Rename one attached photo/PDF. Other files on the note are left alone."""
    _log, row = _load_note_file(db, team_id, note_id, file_id)
    row.original_filename = payload.original_filename.strip()
    db.commit()
    return _note_out(_reload_note(db, note_id), db)


@router.put("/{team_id}/notes/{note_id}/files/{file_id}", response_model=TeamDailyLogOut)
async def replace_note_file(
    team_id: int,
    note_id: int,
    file_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Replace one attached file with a new photo/PDF. Other uploads stay."""
    log, row = _load_note_file(db, team_id, note_id, file_id)
    extra = await _store_log_files(team_id, log.log_date, [file])
    new = extra[0]
    old_path = settings.log_files_dir / row.file_path
    row.file_path = new.file_path
    row.content_type = new.content_type
    row.original_filename = new.original_filename
    row.file_size = new.file_size
    db.commit()
    try:
        old_path.unlink(missing_ok=True)
    except OSError:
        pass
    return _note_out(_reload_note(db, note_id), db)


@router.delete("/{team_id}/notes/{note_id}/files/{file_id}", response_model=TeamDailyLogOut)
def delete_note_file(
    team_id: int,
    note_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Remove one photo/PDF. The note and every other attachment stay."""
    _log, row = _load_note_file(db, team_id, note_id, file_id)
    try:
        (settings.log_files_dir / row.file_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(row)
    db.commit()
    return _note_out(_reload_note(db, note_id), db)


@router.get("/{team_id}/notes/{note_id}/audio")
def get_voice_note_audio(
    team_id: int,
    note_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log or not log.audio_path:
        raise HTTPException(status_code=404, detail="Voice note not found")
    path = settings.voice_notes_dir / log.audio_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing")
    return FileResponse(
        path,
        media_type=log.audio_content_type or "application/octet-stream",
        filename=log.audio_original_filename or path.name,
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/{team_id}/notes/{note_id}/transcribe", response_model=TeamDailyLogOut)
def transcribe_voice_note(
    team_id: int,
    note_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Convert a saved voice recording to text (Grok STT). The audio stays; the transcript is stored
    on the note so it can be edited and used in reports."""
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log or not log.audio_path:
        raise HTTPException(status_code=404, detail="Voice note not found")
    path = settings.voice_notes_dir / log.audio_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing")
    raw = path.read_bytes()
    text, err = transcribe_audio(
        raw,
        log.audio_original_filename or path.name,
        log.audio_content_type or "application/octet-stream",
    )
    if err or not text:
        raise HTTPException(status_code=502, detail=err or "Could not convert this recording to text")
    log.note = text
    log.transcribed = True
    db.commit()
    db.refresh(log)
    return _note_out(log, db)


@router.patch("/{team_id}/notes/{note_id}", response_model=TeamDailyLogOut)
def update_note(
    team_id: int,
    note_id: int,
    payload: TeamDailyLogUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Edit the transcript after conversion so the wording is clean enough for a report."""
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Note not found")
    log.note = payload.note.strip()
    if log.audio_path:
        log.transcribed = True
    db.commit()
    db.refresh(log)
    return _note_out(log, db)


@router.delete("/{team_id}/notes/{note_id}", status_code=204)
def delete_note(
    team_id: int,
    note_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_scope()),
):
    log = db.query(TeamDailyLog).filter(TeamDailyLog.id == note_id, TeamDailyLog.team_id == team_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Note not found")
    if log.audio_path:
        audio = settings.voice_notes_dir / log.audio_path
        try:
            audio.unlink(missing_ok=True)
        except OSError:
            pass
    for att in list(log.files or []):
        try:
            (settings.log_files_dir / att.file_path).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(log)
    db.commit()
    return None


# ---------- Missions: a team-scoped view onto its Visits — see module docstring. Editing a
# mission's own fields, its photos, or deleting it all happen through /api/visits/{id}/... once
# you have the id (every mission row the frontend shows links straight to /visits/{id}). ----------
@router.get("/{team_id}/missions", response_model=list[VisitOut])
def list_missions(team_id: int, db: Session = Depends(get_db), _user: User = Depends(require_team_read())):
    _load_team(db, team_id)
    visits = (
        db.query(Visit)
        .options(
            joinedload(Visit.positions).joinedload(Position.images),
            joinedload(Visit.tower),
            joinedload(Visit.team),
            joinedload(Visit.photos),
            joinedload(Visit.assigned_member),
        )
        .filter(Visit.team_id == team_id)
        .order_by(Visit.mission_seq)
        .all()
    )
    return [attach_rollup(v) for v in visits]


@router.post("/{team_id}/missions", response_model=VisitDetail, status_code=201)
def create_mission(
    team_id: int,
    payload: VisitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    """Creates the mission as a real Visit already tied to this team and numbered (Mission 1, 2,
    3...) — go straight to /visits/{id} afterward to run it: positions, images, screening, all of it."""
    _load_team(db, team_id)
    next_seq = (db.query(func.max(Visit.mission_seq)).filter(Visit.team_id == team_id).scalar() or 0) + 1
    payload = payload.model_copy(update={"team_id": team_id})
    visit = create_visit_row(payload, db, user)
    visit.mission_seq = next_seq
    db.commit()
    return attach_rollup(_load_visit(db, visit.id), detail=True)


# ---------- Job map: the team's whole assigned scope of work, not just what's been visited so far
# ---------- (contrast with the missions list above, which is only the Visits that already exist) ----------
@router.get("/{team_id}/job-map", response_model=TeamJobMap)
def team_job_map(team_id: int, db: Session = Depends(get_db), _user: User = Depends(require_team_read())):
    """Every active tower the admin has directly assigned to this team (Tower.assigned_team_id),
    plotted with its status for THIS team — completed / in progress / not started yet. This is the
    "full job" view a leader (or field crew, planning where to fly next) needs: not just the towers
    already visited (that's the dashboard/missions list), but the entire scope they're responsible
    for, so progress can be measured against the whole job, not just what's been done so far. A
    team with nothing assigned yet just yields an empty map — assign towers from the Towers page."""
    team = _load_team(db, team_id)

    towers = (
        db.query(Tower)
        .filter(Tower.is_active.is_(True), Tower.assigned_team_id == team_id)
        .order_by(Tower.tower_id)
        .all()
    )
    if not towers:
        return TeamJobMap()
    rows: list[TeamJobMapTower] = []
    completed = in_progress = pending = 0
    for t in towers:
        visit = (
            db.query(Visit)
            .filter(Visit.tower_id == t.id, Visit.team_id == team_id)
            .order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc())
            .first()
        )
        if not visit:
            status = "pending"
            pending += 1
            visit_id = None
        else:
            if visit_rollup(visit)["visit_status"] == "Ready for review":
                status = "completed"
                completed += 1
            else:
                status = "in_progress"
                in_progress += 1
            visit_id = visit.id
        rows.append(
            TeamJobMapTower(
                id=t.id, tower_id=t.tower_id, area=t.area, latitude=t.latitude, longitude=t.longitude,
                status=status, visit_id=visit_id,
            )
        )
    return TeamJobMap(sector=team.primary_sector, total=len(towers), completed=completed, in_progress=in_progress, pending=pending, towers=rows)


def _outing_plan_out(plan: TeamOutingPlan) -> OutingPlanOut:
    rows: list[OutingPlanTowerOut] = []
    ids: list[int] = []
    for row in sorted(plan.towers, key=lambda r: r.sort_order):
        t = row.tower
        if t is None:
            continue
        ids.append(t.id)
        rows.append(
            OutingPlanTowerOut(
                id=t.id,
                tower_id=t.tower_id,
                area=t.area,
                latitude=t.latitude,
                longitude=t.longitude,
                sort_order=row.sort_order,
            )
        )
    return OutingPlanOut(team_id=plan.team_id, field_date=plan.field_date, tower_ids=ids, towers=rows, notes=plan.notes)


@router.get("/{team_id}/outing-plan", response_model=OutingPlanOut)
def get_outing_plan(
    team_id: int,
    field_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Towers the leader picked for this field night. Empty tower_ids means none chosen yet."""
    _load_team(db, team_id)
    day = field_date or current_field_date()
    plan = (
        db.query(TeamOutingPlan)
        .options(joinedload(TeamOutingPlan.towers).joinedload(TeamOutingTower.tower))
        .filter(TeamOutingPlan.team_id == team_id, TeamOutingPlan.field_date == day)
        .first()
    )
    if not plan:
        return OutingPlanOut(team_id=team_id, field_date=day)
    return _outing_plan_out(plan)


@router.put("/{team_id}/outing-plan", response_model=OutingPlanOut)
def save_outing_plan(
    team_id: int,
    payload: OutingPlanSave,
    db: Session = Depends(get_db),
    user: User = Depends(require_team_scope()),
):
    """Leader picks which assigned towers the crew will visit tonight — before leaving for site."""
    _load_team(db, team_id)
    day = payload.field_date or current_field_date()
    wanted: list[int] = []
    seen: set[int] = set()
    for tid in payload.tower_ids:
        if tid in seen:
            continue
        seen.add(tid)
        wanted.append(tid)
    if wanted:
        towers = db.query(Tower).filter(Tower.id.in_(wanted), Tower.is_active.is_(True)).all()
        by_id = {t.id: t for t in towers}
        missing = [tid for tid in wanted if tid not in by_id]
        if missing:
            raise HTTPException(status_code=400, detail="One or more towers were not found")
        wrong = [t.tower_id for t in towers if t.assigned_team_id != team_id]
        if wrong:
            raise HTTPException(
                status_code=400,
                detail=f"These towers are not assigned to this team: {', '.join(wrong)}",
            )
    plan = (
        db.query(TeamOutingPlan)
        .options(joinedload(TeamOutingPlan.towers).joinedload(TeamOutingTower.tower))
        .filter(TeamOutingPlan.team_id == team_id, TeamOutingPlan.field_date == day)
        .first()
    )
    if plan is None:
        plan = TeamOutingPlan(team_id=team_id, field_date=day, created_by=user.id)
        db.add(plan)
        db.flush()
    plan.notes = payload.notes
    plan.updated_at = dt.datetime.utcnow()
    db.query(TeamOutingTower).filter(TeamOutingTower.plan_id == plan.id).delete()
    for i, tid in enumerate(wanted):
        db.add(TeamOutingTower(plan_id=plan.id, tower_pk=tid, sort_order=i))
    db.commit()
    plan = (
        db.query(TeamOutingPlan)
        .options(joinedload(TeamOutingPlan.towers).joinedload(TeamOutingTower.tower))
        .filter(TeamOutingPlan.id == plan.id)
        .first()
    )
    return _outing_plan_out(plan)


@router.get("/{team_id}/next-towers", response_model=NextTowersPlan)
def team_next_towers(
    team_id: int,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    limit: int = Query(default=5, ge=1, le=8),
    db: Session = Depends(get_db),
    user: User = Depends(require_team_read()),
):
    """Where this crew should fly next tonight — finish open visits, then walk the line from GPS."""
    team = _load_team(db, team_id)
    return build_next_towers(db, team, user, latitude, longitude, limit=limit)


# ---------- Progress: day-by-day achievement, straight from the team's own Visits ----------
@router.get("/{team_id}/progress", response_model=list[TeamDayProgress])
def team_progress(
    team_id: int,
    start_date: dt.date | None = Query(default=None),
    end_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    team = _load_team(db, team_id)
    today = dt.datetime.now(dt.timezone.utc).date()
    end = end_date or team.end_date or today
    start = start_date or team.start_date or (end - dt.timedelta(days=6))
    if end < start:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    if (end - start).days > 90:
        raise HTTPException(status_code=400, detail="Date range too wide — ask for at most 90 days at a time")

    user_ids = [u.id for u in team.users]  # still used for GPS ping start/finish time below

    notes_by_date: dict[dt.date, list[TeamDailyLog]] = {}
    for log in (
        db.query(TeamDailyLog)
        .options(joinedload(TeamDailyLog.files))
        .filter(TeamDailyLog.team_id == team_id, TeamDailyLog.log_date >= start, TeamDailyLog.log_date <= end)
    ):
        notes_by_date.setdefault(log.log_date, []).append(log)

    # All this team's visits in range, grouped by date — a mission belongs to the team via
    # Visit.team_id directly now, regardless of which linked login happened to save it.
    range_visits = (
        db.query(Visit)
        .options(joinedload(Visit.positions).joinedload(Position.images))
        .filter(Visit.team_id == team_id, Visit.inspection_date >= start, Visit.inspection_date <= end)
        .all()
    )
    visits_by_date: dict[dt.date, list[Visit]] = {}
    for v in range_visits:
        visits_by_date.setdefault(v.inspection_date, []).append(v)

    days: list[TeamDayProgress] = []
    d = start
    while d <= end:
        visits = visits_by_date.get(d, [])
        towers = {v.tower_id for v in visits}
        screened = 0
        hotspots = 0
        images_captured = 0
        for v in visits:
            r = visit_rollup(v)
            screened += r["screened"]
            hotspots += r["hotspots"]
            for p in v.positions:
                images_captured += sum(1 for img in p.images if img.file_path)

        first_seen = last_seen = None
        if user_ids:
            # Night crews run 18:00–18:00 Oman; a calendar-midnight split would cut one outing in two.
            day_start, day_end = shift_window(d)
            bounds = (
                db.query(func.min(LocationPing.recorded_at), func.max(LocationPing.recorded_at))
                .filter(
                    LocationPing.user_id.in_(user_ids),
                    LocationPing.recorded_at >= day_start,
                    LocationPing.recorded_at < day_end,
                )
                .first()
            )
            if bounds and bounds[0] is not None:
                first_seen, last_seen = bounds[0], bounds[1]

        days.append(
            TeamDayProgress(
                log_date=d,
                towers_visited=len(towers),
                visits_touched=len(visits),
                screened=screened,
                hotspots=hotspots,
                images_captured=images_captured,
                first_seen=first_seen,
                last_seen=last_seen,
                notes=[_note_out(n, db) for n in notes_by_date.get(d, [])],
            )
        )
        d += dt.timedelta(days=1)

    days.reverse()  # most recent day first — that's what a manager checking in wants to see first
    return days


@router.get("/{team_id}/live", response_model=list[LiveTeamMember])
def team_live(
    team_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """Same shape as /api/tracking/live but scoped to one team's linked logins — for the team detail
    page's own small map, so it doesn't need every other team's dots to show just this one."""
    team = _load_team(db, team_id)
    now = dt.datetime.now(dt.timezone.utc)
    stale_cutoff = now - dt.timedelta(minutes=STALE_AFTER_MINUTES)
    shift_start, shift_end = shift_window(current_field_date())

    out: list[LiveTeamMember] = []
    for user in team.users:
        ping = (
            db.query(LocationPing)
            .filter(LocationPing.user_id == user.id)
            .order_by(LocationPing.recorded_at.desc())
            .first()
        )
        recorded_at = None
        is_stale = True
        if ping is not None:
            recorded_at = ping.recorded_at if ping.recorded_at.tzinfo else ping.recorded_at.replace(tzinfo=dt.timezone.utc)
            is_stale = recorded_at < stale_cutoff
        visits_today = (
            db.query(Visit)
            .options(joinedload(Visit.positions).joinedload(Position.images))
            .filter(Visit.created_by == user.id, Visit.created_at >= shift_start, Visit.created_at < shift_end)
            .all()
        )
        screened = sum(visit_rollup(v)["screened"] for v in visits_today)
        hotspots = sum(visit_rollup(v)["hotspots"] for v in visits_today)
        out.append(
            LiveTeamMember(
                user_id=user.id,
                username=user.username,
                full_name=user.full_name,
                team_id=team.id,
                team_name=team.name,
                latitude=ping.latitude if ping else None,
                longitude=ping.longitude if ping else None,
                accuracy_m=ping.accuracy_m if ping else None,
                last_seen=ping.recorded_at if ping else None,
                is_stale=is_stale,
                today=TeamTodayProgress(
                    towers_visited=len({v.tower_id for v in visits_today}),
                    visits_touched=len(visits_today),
                    screened=screened,
                    hotspots=hotspots,
                ),
            )
        )
    return out


@router.get("/{team_id}/trails", response_model=list[UserTrailOut])
def team_trails(
    team_id: int,
    on_date: dt.date | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """GPS breadcrumb paths for every login linked to this team, for the team page map."""
    team = _load_team(db, team_id)
    day = on_date or current_field_date()
    start, end = shift_window(day)
    user_ids = [u.id for u in team.users]
    if not user_ids:
        return []
    pings = (
        db.query(LocationPing)
        .filter(
            LocationPing.user_id.in_(user_ids),
            LocationPing.recorded_at >= start,
            LocationPing.recorded_at < end,
        )
        .order_by(LocationPing.user_id.asc(), LocationPing.recorded_at.asc())
        .all()
    )
    by_user: dict[int, list[TrailPoint]] = {}
    for p in pings:
        by_user.setdefault(p.user_id, []).append(
            TrailPoint(latitude=p.latitude, longitude=p.longitude, recorded_at=p.recorded_at)
        )
    out: list[UserTrailOut] = []
    users_by_id = {u.id: u for u in team.users}
    for uid, points in by_user.items():
        user = users_by_id.get(uid)
        if not user:
            continue
        out.append(UserTrailOut(user_id=user.id, username=user.username, full_name=user.full_name, points=points))
    return out


def _naive_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(dt.timezone.utc).replace(tzinfo=None)


def _aware_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value


def _team_ping_count(db: Session, user_ids: list[int], start: dt.datetime, end: dt.datetime | None) -> int:
    if not user_ids:
        return 0
    q = db.query(func.count(LocationPing.id)).filter(
        LocationPing.user_id.in_(user_ids),
        LocationPing.recorded_at >= start,
    )
    if end is not None:
        q = q.filter(LocationPing.recorded_at < end)
    return int(q.scalar() or 0)


@router.get("/{team_id}/field-history", response_model=list[TrackingMissionOut])
def team_field_history(
    team_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """This team's saved tracking sessions and field nights that have GPS — only their own tracks."""
    team = _load_team(db, team_id)
    user_ids = [u.id for u in team.users]
    now = dt.datetime.utcnow()
    out: list[TrackingMissionOut] = []
    for row in db.query(TrackingMission).order_by(TrackingMission.started_at.desc()).all():
        end = row.ended_at
        n = _team_ping_count(db, user_ids, row.started_at, end if end is not None else now)
        if n == 0:
            continue
        out.append(
            TrackingMissionOut(
                id=row.id,
                kind="mission",
                label=row.label,
                field_date=current_field_date(_aware_utc(row.started_at)),
                started_at=row.started_at,
                ended_at=end,
                is_current=end is None,
                ping_count=n,
            )
        )
    first = (
        db.query(func.min(LocationPing.recorded_at)).filter(LocationPing.user_id.in_(user_ids)).scalar()
        if user_ids
        else None
    )
    last = (
        db.query(func.max(LocationPing.recorded_at)).filter(LocationPing.user_id.in_(user_ids)).scalar()
        if user_ids
        else None
    )
    if first is not None and last is not None:
        day = current_field_date(_aware_utc(first))
        last_day = current_field_date(_aware_utc(last))
        while day <= last_day:
            start, end = shift_window(day)
            n = _team_ping_count(db, user_ids, start, end)
            if n:
                out.append(
                    TrackingMissionOut(
                        id=None,
                        kind="night",
                        label=f"Field night {day.isoformat()}",
                        field_date=day,
                        started_at=start,
                        ended_at=end,
                        is_current=False,
                        ping_count=n,
                    )
                )
            day += dt.timedelta(days=1)
    out.sort(key=lambda m: (not m.is_current, -_aware_utc(m.started_at).timestamp()))
    return out


@router.get("/{team_id}/field-track", response_model=list[TeamProgressOut])
def team_field_track(
    team_id: int,
    on_date: dt.date | None = Query(default=None),
    from_hour: int | None = Query(default=None, ge=0, le=23),
    to_hour: int | None = Query(default=None, ge=0, le=23),
    mission_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_team_read()),
):
    """This team's GPS recap for a field night or saved mission: path, km, stay at each tower."""
    _load_team(db, team_id)
    if mission_id is not None:
        row = db.get(TrackingMission, mission_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Mission not found")
        start = _naive_utc(row.started_at)
        end = _naive_utc(row.ended_at) if row.ended_at is not None else dt.datetime.utcnow()
        day = current_field_date(_aware_utc(row.started_at))
    else:
        day = on_date or current_field_date()
        start, end = hour_window(day, from_hour, to_hour)
    return build_team_progress(db, day, start=start, end=end, team_id=team_id)
