"""Nearest-tower tagging for the night channel."""
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Team, Tower
from app.services.channel import TAG_RADIUS_M, nearest_assigned_tower


def test_nearest_assigned_tower_within_radius():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name="Alpha")
        db.add(team)
        db.flush()
        near = Tower(tower_id="T50", area="Dufar", latitude=17.0, longitude=54.0, assigned_team_id=team.id)
        far = Tower(tower_id="T80", area="Dufar", latitude=17.2, longitude=54.3, assigned_team_id=team.id)
        other = Tower(tower_id="X1", area="Dufar", latitude=17.0002, longitude=54.0002, assigned_team_id=None)
        db.add_all([near, far, other])
        db.commit()
        hit = nearest_assigned_tower(db, team.id, 17.0003, 54.0003)
        assert hit is not None
        assert hit.tower_id == "T50"
        miss = nearest_assigned_tower(db, team.id, 16.0, 53.0)
        assert miss is None
        assert TAG_RADIUS_M == 150
