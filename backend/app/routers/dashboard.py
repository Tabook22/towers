from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import effective_team_id, get_current_user
from app.models import Position, Tower, User, UserRole, Visit
from app.schemas import DashboardSummary, DashboardTowerRow, VisitOut, VisitRollup
from app.services.rollup import visit_rollup

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user), area: str | None = None):
    # A team_member's whole app is "my missions" (see routers/visits.py's list_visits) — this
    # cross-tower/cross-team summary isn't part of that narrower workspace.
    is_crew = user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value)
    leader_team_id = effective_team_id(db, user) if is_crew else None
    q = db.query(Tower).filter(Tower.is_active.is_(True))
    if area:
        q = q.filter(Tower.area == area)
    if is_crew:
        # Assigned job-map towers for this crew — not only towers they have already opened a visit on.
        if not leader_team_id:
            q = q.filter(False)
        else:
            q = q.filter(Tower.assigned_team_id == leader_team_id)
    towers = q.order_by(Tower.tower_id).all()

    rows: list[DashboardTowerRow] = []
    total_hotspots = 0
    total_pending = 0
    total_visits = 0

    for tower in towers:
        visit_q = db.query(Visit).filter(Visit.tower_id == tower.id)
        if is_crew and leader_team_id:
            visit_q = visit_q.filter(Visit.team_id == leader_team_id)
        latest = (
            visit_q.options(joinedload(Visit.positions).joinedload(Position.images))
            .order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc())
            .first()
        )
        visit_count = visit_q.count()
        total_visits += visit_count

        rollup = None
        visit_out = None
        if latest:
            r = visit_rollup(latest)
            rollup = VisitRollup(**r)
            total_hotspots += r["hotspots"]
            total_pending += r["images_pending"]
            visit_out = VisitOut.model_validate(latest)
            visit_out.rollup = rollup

        rows.append(DashboardTowerRow(tower=tower, latest_visit=visit_out, rollup=rollup))

    return DashboardSummary(
        tower_count=len(towers),
        visit_count=total_visits,
        total_hotspots=total_hotspots,
        total_images_pending=total_pending,
        rows=rows,
    )
