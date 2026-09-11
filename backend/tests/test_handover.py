"""Shift handover: classify tonight's towers and continue leftover work."""
import datetime as dt

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import NightTowerClaim, Team, TeamOutingPlan, TeamOutingTower, Tower, User, UserRole, Visit
from app.services.handover import (
    classify_tower,
    continue_last_night,
    remaining_tower_ids,
    build_handover_pack,
)


def test_classify_skip_wins_over_open_visit():
    assert classify_tower("Evidence incomplete", "skipped") == "skipped"
    assert classify_tower("Ready for review", "skipped") == "skipped"


def test_classify_open_visit_stays_in_progress_even_if_claim_done():
    assert classify_tower("Evidence incomplete", "done") == "in_progress"
    assert classify_tower("Inspection incomplete", "on_site") == "in_progress"


def test_classify_ready_is_completed():
    assert classify_tower("Ready for review", "claimed") == "completed"
    assert classify_tower("Ready for review", None) == "completed"


def test_classify_claim_only():
    assert classify_tower(None, "done") == "completed"
    assert classify_tower(None, "en_route") == "in_progress"
    assert classify_tower(None, None) == "pending"


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return Session(engine)


def test_pack_counts_and_continue_seeds_tonight():
    with _session() as db:
        team = Team(name="Alpha")
        db.add(team)
        db.flush()
        leader = User(
            username="lead",
            hashed_password="x",
            role=UserRole.TEAM_LEADER.value,
            team_id=team.id,
        )
        db.add(leader)
        db.flush()
        team.leader_user_id = leader.id
        t50 = Tower(tower_id="T50", area="Dufar", latitude=17.0, longitude=54.00, assigned_team_id=team.id)
        t51 = Tower(tower_id="T51", area="Dufar", latitude=17.0, longitude=54.02, assigned_team_id=team.id)
        t52 = Tower(tower_id="T52", area="Dufar", latitude=17.0, longitude=54.04, assigned_team_id=team.id)
        db.add_all([t50, t51, t52])
        db.flush()

        night = dt.date(2026, 9, 10)
        plan = TeamOutingPlan(team_id=team.id, field_date=night, created_by=leader.id)
        db.add(plan)
        db.flush()
        db.add_all(
            [
                TeamOutingTower(plan_id=plan.id, tower_pk=t50.id, sort_order=0),
                TeamOutingTower(plan_id=plan.id, tower_pk=t51.id, sort_order=1),
                TeamOutingTower(plan_id=plan.id, tower_pk=t52.id, sort_order=2),
            ]
        )
        db.add(
            NightTowerClaim(
                team_id=team.id,
                field_date=night,
                tower_pk=t50.id,
                assigned_user_id=leader.id,
                status="done",
            )
        )
        db.add(
            NightTowerClaim(
                team_id=team.id,
                field_date=night,
                tower_pk=t51.id,
                assigned_user_id=leader.id,
                status="skipped",
                skip_reason="Gate locked",
            )
        )
        db.commit()

        pack = build_handover_pack(db, team, night, include_previous=False)
        assert pack["completed"] == 1
        assert pack["skipped"] == 1
        assert pack["pending"] == 1
        assert pack["remaining"] == 2
        leftover = remaining_tower_ids(pack)
        assert leftover == [t51.id, t52.id]
        assert pack["recommended"]["tower_id"] in ("T51", "T52")

        today = night + dt.timedelta(days=1)
        continued = continue_last_night(db, team, leader, field_date=today, from_date=night)
        assert continued["continued_from"] == night
        assert continued["scope"] == "outing"
        assert [t["tower_id"] for t in continued["towers"]] == ["T51", "T52"]
        assert continued["pending"] == 2


def test_open_visit_is_in_progress_not_completed():
    with _session() as db:
        team = Team(name="Bravo")
        db.add(team)
        db.flush()
        tower = Tower(tower_id="T10", area="Dufar", latitude=17.1, longitude=54.1, assigned_team_id=team.id)
        db.add(tower)
        db.flush()
        visit = Visit(tower_id=tower.id, team_id=team.id, inspection_date=dt.date(2026, 9, 10))
        db.add(visit)
        db.commit()

        pack = build_handover_pack(db, team, dt.date(2026, 9, 10), include_previous=False)
        row = pack["towers"][0]
        assert row["status"] == "in_progress"
        assert row["visit_id"] == visit.id
        assert pack["remaining"] == 1
