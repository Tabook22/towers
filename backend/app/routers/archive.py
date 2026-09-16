from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user
from app.models import Image, Position, Team, Tower, User, UserRole, Visit
from app.schemas import ArchiveImageOut, ImageOut

router = APIRouter(prefix="/api/archive", tags=["archive"])


@router.get("", response_model=list[ArchiveImageOut])
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
    return out
