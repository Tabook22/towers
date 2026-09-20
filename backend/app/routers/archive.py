from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user
from app.models import Image, Position, Team, Tower, User, UserRole, Visit, VisitPhoto
from app.schemas import ArchiveImageOut, ArchiveOut, ArchiveVisitPhotoOut, ImageOut, VisitPhotoOut

router = APIRouter(prefix="/api/archive", tags=["archive"])


@router.get("", response_model=ArchiveOut)
def browse_archive(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    year: int | None = None,
    month: int | None = None,
    day: int | None = None,
    tower_id: int | None = None,
    team_id: int | None = None,
    image_type: str | None = None,
    only_uploaded: bool = True,
    skip: int = 0,
    limit: int = 200,
):
    # A team_member browses images through their own assigned mission's position panel, not this
    # cross-visit archive — same reasoning as dashboard_summary.
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    q = (
        db.query(Image)
        .join(Position, Image.position_id == Position.id)
        .join(Visit, Position.visit_id == Visit.id)
        .join(Tower, Visit.tower_id == Tower.id)
        .options(
            joinedload(Image.position).joinedload(Position.visit).joinedload(Visit.tower),
            joinedload(Image.position).joinedload(Position.visit).joinedload(Visit.team),
        )
    )
    if user.role == UserRole.TEAM_LEADER.value:
        # Their own team's mission photos only — this endpoint spans every visit, so without this
        # it would be the one place a team_leader could browse straight past the team wall.
        q = q.filter(Visit.team_id == user.team_id) if user.team_id else q.filter(False)
    if only_uploaded:
        q = q.filter(Image.file_path.isnot(None))
    if tower_id:
        q = q.filter(Tower.id == tower_id)
    if team_id:
        q = q.filter(Visit.team_id == team_id)
    if image_type:
        q = q.filter(Image.image_type == image_type)

    images = q.order_by(Image.capture_date.desc().nullslast(), Image.id.desc()).all()

    def matches(img: Image) -> bool:
        if not img.capture_date:
            return year is None and month is None and day is None
        if year and img.capture_date.year != year:
            return False
        if month and img.capture_date.month != month:
            return False
        if day and img.capture_date.day != day:
            return False
        return True

    filtered = [i for i in images if matches(i)]
    page = filtered[skip : skip + limit]

    out: list[ArchiveImageOut] = []
    for img in page:
        pos = img.position
        visit = pos.visit
        tower = visit.tower
        team: Team | None = visit.team
        data = ImageOut.model_validate(img).model_dump()
        data.update(
            team_id=team.id if team else None,
            team_name=team.name if team else None,
            tower_pk=tower.id,
            tower_code=tower.tower_id,
            area=tower.area,
            position_code=pos.position_code,
            ohl=pos.ohl,
            phase=pos.phase,
            string=pos.string,
            direction=pos.direction,
        )
        out.append(ArchiveImageOut(**data))

    # The free-form "drop a photo in" gallery (VisitPhoto) — some tagged to a position, some not —
    # is a separate table from the formal checklist Image rows above, so it needs its own query.
    # Skipped when filtering by image_type since that concept doesn't apply to these photos at all.
    photos_out: list[ArchiveVisitPhotoOut] = []
    if not image_type:
        pq = (
            db.query(VisitPhoto)
            .join(Visit, VisitPhoto.visit_id == Visit.id)
            .join(Tower, Visit.tower_id == Tower.id)
            .options(
                joinedload(VisitPhoto.position),
                joinedload(VisitPhoto.visit).joinedload(Visit.team),
                joinedload(VisitPhoto.visit).joinedload(Visit.tower),
            )
        )
        if user.role == UserRole.TEAM_LEADER.value:
            pq = pq.filter(Visit.team_id == user.team_id) if user.team_id else pq.filter(False)
        if tower_id:
            pq = pq.filter(Tower.id == tower_id)
        if team_id:
            pq = pq.filter(Visit.team_id == team_id)

        def photo_matches(p: VisitPhoto) -> bool:
            if not p.captured_at:
                return year is None and month is None and day is None
            if year and p.captured_at.year != year:
                return False
            if month and p.captured_at.month != month:
                return False
            if day and p.captured_at.day != day:
                return False
            return True

        photos = pq.order_by(VisitPhoto.uploaded_at.desc()).all()
        for p in [p for p in photos if photo_matches(p)][skip : skip + limit]:
            visit = p.visit
            tower = visit.tower
            team = visit.team
            data = VisitPhotoOut.model_validate(p).model_dump()
            data.update(
                position_code=p.position.position_code if p.position else None,
                team_id=team.id if team else None,
                team_name=team.name if team else None,
                tower_pk=tower.id,
                tower_code=tower.tower_id,
                area=tower.area,
                ohl=p.position.ohl if p.position else None,
                phase=p.position.phase if p.position else None,
                string=p.position.string if p.position else None,
                direction=p.position.direction if p.position else None,
            )
            photos_out.append(ArchiveVisitPhotoOut(**data))

    return ArchiveOut(images=out, photos=photos_out)
