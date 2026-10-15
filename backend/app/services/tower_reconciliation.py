"""Read-only reconciliation of current assignments against historical team evidence.

Archive coverage is all-time; screening/category coverage uses the latest team visit.
Four-category coverage deliberately does not interpret the default NOT REQUIRED value
as an approved exemption. This is a coverage check, not an approval or report gate.
"""
from collections import Counter, defaultdict
from sqlalchemy import and_, or_

from sqlalchemy.orm import Session

from app.models import Image, IMAGE_TYPE_CHOICES, Position, Team, Tower, Visit, VisitPhoto
from app.utils import natural_sort_key


def reconcile_towers(db: Session, team_ids: list[int], *, include_inventory: bool = False) -> dict:
    teams = db.query(Team).filter(Team.id.in_(team_ids)).order_by(Team.name).all()
    towers = {t.id: t for t in db.query(Tower).all()}
    visits = db.query(Visit.id, Visit.team_id, Visit.tower_id, Visit.inspection_date).filter(
        Visit.team_id.in_(team_ids)
    ).order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc()).all()
    latest = {}
    for v in visits:
        latest.setdefault((v.team_id, v.tower_id), v)

    evidence = defaultdict(Counter)
    for team_id, tower_id in db.query(Visit.team_id, Visit.tower_id).join(
        Position, Position.visit_id == Visit.id
    ).join(Image, Image.position_id == Position.id).filter(
        Visit.team_id.in_(team_ids), Image.file_path.isnot(None)
    ):
        evidence[team_id][tower_id] += 1
    for team_id, tower_id in db.query(Visit.team_id, Visit.tower_id).join(
        VisitPhoto, VisitPhoto.visit_id == Visit.id
    ).filter(Visit.team_id.in_(team_ids)):
        evidence[team_id][tower_id] += 1

    latest_ids = [v.id for v in latest.values()]
    positions = defaultdict(list)
    for p in db.query(Position.id, Position.visit_id, Position.installed,
                      Position.screening_result).filter(
        Position.visit_id.in_(latest_ids), Position.in_scope.is_(True)
    ):
        positions[p.visit_id].append(p)
    categories = defaultdict(set)
    # A recapture request cannot satisfy coverage even though the old file remains archived.
    for position_id, image_type in db.query(Image.position_id, Image.image_type).join(
        Position, Image.position_id == Position.id
    ).filter(Position.visit_id.in_(latest_ids), or_(
        and_(Image.file_path.isnot(None), Image.evidence_status != 'RECAPTURE REQUIRED'),
        and_(Image.sequence == 1, Image.evidence_status == 'NOT REQUIRED', Image.exemption_reason.isnot(None), Image.exemption_reason != '')
    )):
        categories[position_id].add(image_type)

    names = {t.id: t.name for t in teams}
    if include_inventory:
        names = {t.id: t.name for t in db.query(Team).all()}
    result = []
    for team in teams:
        assigned = [t for t in towers.values() if t.is_active and t.assigned_team_id == team.id]
        rows = []
        for tower in sorted(assigned, key=lambda t: natural_sort_key(t.tower_id)):
            visit = latest.get((team.id, tower.id))
            installed = [p for p in positions[visit.id] if p.installed] if visit else []
            # Preparation flags can remain set after observations are saved. Actual screening
            # results, rather than that layout flag, are authoritative (as in visit_rollup).
            screened = [p for p in installed if p.screening_result not in (None, 'Not inspected')]
            expected = len(installed) * len(IMAGE_TYPE_CHOICES)
            covered = sum(len(categories[p.id].intersection(IMAGE_TYPE_CHOICES)) for p in installed)
            screening_ready = bool(installed) and len(screened) == len(installed)
            four_categories = bool(installed) and covered == expected
            rows.append(dict(id=tower.id, tower_id=tower.tower_id, area=tower.area,
                             visit_id=visit.id if visit else None,
                             inspection_date=visit.inspection_date if visit else None,
                             archive_images=evidence[team.id][tower.id],
                             installed_positions=len(installed), screened_positions=len(screened),
                             expected_categories=expected, covered_categories=covered,
                             missing_categories=expected-covered,
                             screening_ready=screening_ready, four_category_coverage=four_categories,
                             screening_and_evidence_ready=screening_ready and four_categories and evidence[team.id][tower.id] > 0))
        assigned_ids = {t.id for t in assigned}
        outside = []
        for tower_id in sorted(set(evidence[team.id])-assigned_ids, key=lambda i: natural_sort_key(towers[i].tower_id)):
            tower = towers[tower_id]
            outside.append(dict(id=tower.id, tower_id=tower.tower_id,
                                is_active=tower.is_active,
                                assigned_team_name=names.get(tower.assigned_team_id),
                                archive_images=evidence[team.id][tower_id]))
        counts = dict(assigned=len(rows), archive_towers=len(evidence[team.id]),
                      assigned_with_evidence=sum(r['archive_images'] > 0 for r in rows),
                      without_evidence=sum(r['archive_images'] == 0 for r in rows),
                      without_visit=sum(r['visit_id'] is None for r in rows),
                      screening_ready=sum(r['screening_ready'] for r in rows),
                      four_category_coverage=sum(r['four_category_coverage'] for r in rows),
                      screening_and_evidence_ready=sum(r['screening_and_evidence_ready'] for r in rows),
                      outside_assignment=len(outside))
        result.append(dict(id=team.id, name=team.name, declared_status=team.status,
                           status_needs_review=team.status == 'completed' and counts['screening_and_evidence_ready'] < counts['assigned'],
                           counts=counts, towers=rows, outside_assignment=outside))
    archive_ids = set().union(*(set(evidence[t.id]) for t in teams))
    return dict(teams=result, totals={key: sum(t['counts'][key] for t in result) for key in (
        'assigned', 'assigned_with_evidence', 'without_evidence', 'without_visit',
        'screening_ready', 'four_category_coverage', 'screening_and_evidence_ready')},
        unique_archive_towers=len(archive_ids),
        archive_team_entries=sum(len(evidence[t.id]) for t in teams),
        inactive_inventory=sum(not t.is_active for t in towers.values()) if include_inventory else None,
        unassigned_active=sum(t.is_active and t.assigned_team_id is None for t in towers.values()) if include_inventory else None)
