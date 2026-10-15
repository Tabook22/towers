"""Recorded field activity and strict evidence coverage for tower map badges."""
from sqlalchemy.orm import selectinload
from app.models import Visit, Position, IMAGE_TYPE_CHOICES


def has_field_activity(visit):
    return bool(visit.mission_status in ('in_progress', 'completed') or visit.start_time
                or visit.status == 'closed' or any(p.file_path for p in visit.photos)
                or any(p.in_scope is not False and (
                    (p.direction and not p.prepared_only) or p.screening_result not in (None, 'Not inspected')
                    or any(image.file_path for image in p.images)) for p in visit.positions))


def tower_map_status(db, tower_ids, team_id=None):
    if not tower_ids:
        return {}
    query = db.query(Visit).filter(Visit.tower_id.in_(tower_ids))
    if team_id is not None:
        query = query.filter(Visit.team_id == team_id)
    visits = query.populate_existing().options(selectinload(Visit.photos), selectinload(Visit.positions).selectinload(Position.images)).order_by(
        Visit.inspection_date.desc().nullslast(), Visit.id.desc()).all()
    result = {}
    for visit in visits:
        if visit.tower_id in result or not has_field_activity(visit):
            continue
        installed = [p for p in visit.positions if p.in_scope is not False and p.installed]
        covered = bool(installed) and all(set(IMAGE_TYPE_CHOICES).issubset({
            image.image_type for image in p.images if (image.file_path and image.evidence_status != 'RECAPTURE REQUIRED')
            or (image.sequence == 1 and image.evidence_status == 'NOT REQUIRED' and image.exemption_reason)
        }) for p in installed)
        result[visit.tower_id] = dict(map_visit_recorded=True, map_evidence_missing=not covered)
    return result
