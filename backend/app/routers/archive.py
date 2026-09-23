from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import extract, func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import get_current_user
from app.models import Image, LineInspectionReport, Position, ReportImage, Team, Tower, User, UserRole, Visit, VisitPhoto
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
    report_id: int | None = None,
    image_ceiling: int | None = None,
    photo_ceiling: int | None = None,
):
    # A team_member browses images through their own assigned mission's position panel, not this
    # cross-visit archive — same reasoning as dashboard_summary.
    if user.role == UserRole.TEAM_MEMBER.value:
        raise HTTPException(status_code=403, detail="Not available for team-member accounts")
    if skip < 0 or not 1 <= limit <= 1000:
        raise HTTPException(status_code=422, detail="Invalid archive page: skip must be non-negative and limit between 1 and 1000")
    if (year is not None and not 1 <= year <= 9999) or (month is not None and not 1 <= month <= 12) or (day is not None and not 1 <= day <= 31):
        raise HTTPException(status_code=422, detail="Invalid archive date filter")
    if report_id is not None:
        report = db.get(LineInspectionReport, report_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Report not found")
        if user.role == UserRole.TEAM_LEADER.value and user.team_id != report.team_id:
            raise HTTPException(status_code=403, detail="You don't have access to this team's report")

    def filter_dates(query, date_column):
        for part, value in (("year", year), ("month", month), ("day", day)):
            if value is not None:
                query = query.filter(extract(part, date_column) == value)
        return query

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

    if report_id is not None:
        q = q.filter(Image.id.in_(db.query(ReportImage.image_id).filter(ReportImage.report_id == report_id)))
    # Use one date policy for both filtering and display. Missing EXIF dates must not hide uploads.
    q = filter_dates(q, func.coalesce(Image.capture_date, Visit.inspection_date, func.date(Image.uploaded_at)))
    if image_ceiling is None:
        image_ceiling = q.with_entities(func.max(Image.id)).scalar() or 0
    q = q.filter(Image.id <= image_ceiling)
    total_images = q.count()
    # Stable ascending IDs plus a ceiling ensure uploads arriving during pagination cannot split
    # or duplicate the archive. The UI sorts the complete evidence collection for display.
    page = q.order_by(Image.id).offset(skip).limit(limit).all()
    report_links = {}
    if page:
        links = (db.query(ReportImage.image_id, ReportImage.image_type, LineInspectionReport.id, LineInspectionReport.report_number)
                 .join(LineInspectionReport, ReportImage.report_id == LineInspectionReport.id)
                 .filter(ReportImage.image_id.in_([img.id for img in page])))
        if user.role == UserRole.TEAM_LEADER.value:
            links = links.filter(LineInspectionReport.team_id == user.team_id)
        for image_id, saved_type, saved_id, number in links.order_by(LineInspectionReport.created_at.desc(), LineInspectionReport.id.desc()):
            report_links.setdefault(image_id, []).append({"id": saved_id, "report_number": number, "image_type": saved_type})

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
            visit_id=visit.id,
            inspection_date=visit.inspection_date,
            archive_date=img.capture_date or visit.inspection_date or (img.uploaded_at.date() if img.uploaded_at else None),
            reports=report_links.get(img.id, []),
        )
        out.append(ArchiveImageOut(**data))

    # The free-form "drop a photo in" gallery (VisitPhoto) — some tagged to a position, some not —
    # is a separate table from the formal checklist Image rows above, so it needs its own query.
    # Skipped when filtering by image_type since that concept doesn't apply to these photos at all.
    photos_out: list[ArchiveVisitPhotoOut] = []
    total_photos = 0
    if not image_type and report_id is None:
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

        pq = filter_dates(pq, func.coalesce(func.date(VisitPhoto.captured_at), Visit.inspection_date, func.date(VisitPhoto.uploaded_at)))
        if photo_ceiling is None:
            photo_ceiling = pq.with_entities(func.max(VisitPhoto.id)).scalar() or 0
        pq = pq.filter(VisitPhoto.id <= photo_ceiling)
        total_photos = pq.count()
        for p in pq.order_by(VisitPhoto.id).offset(skip).limit(limit).all():
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
                inspection_date=visit.inspection_date,
                archive_date=p.captured_at.date() if p.captured_at else visit.inspection_date or p.uploaded_at.date(),
            )
            photos_out.append(ArchiveVisitPhotoOut(**data))

    return ArchiveOut(images=out, photos=photos_out, total_images=total_images, total_photos=total_photos,
                      has_more=skip + limit < max(total_images, total_photos),
                      image_ceiling=image_ceiling, photo_ceiling=photo_ceiling or 0)
