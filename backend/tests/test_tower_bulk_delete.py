from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Team, TeamOutingPlan, TeamOutingTower, Tower
from app.routers.towers import _strip_tower_fks


def test_strip_and_delete_towers():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name="Alpha")
        db.add(team)
        db.flush()
        a = Tower(tower_id="T1", assigned_team_id=team.id)
        b = Tower(tower_id="T2")
        db.add_all([a, b])
        db.flush()
        plan = TeamOutingPlan(team_id=team.id, field_date=__import__("datetime").date(2026, 9, 12))
        db.add(plan)
        db.flush()
        db.add(TeamOutingTower(plan_id=plan.id, tower_pk=a.id, sort_order=0))
        db.commit()

        _strip_tower_fks(db, a.id)
        db.delete(a)
        db.delete(b)
        db.commit()
        assert db.query(Tower).count() == 0
        assert db.query(TeamOutingTower).count() == 0
