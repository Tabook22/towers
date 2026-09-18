"""Skipping a tower must carry a real explanation — the admin reads it live in the crew channel
to track the team's progress, so a blank or boilerplate "reason" defeats the point (see
routers/claims.py's update_claim and _post_skip_channel)."""
import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import NightTowerClaim, Team, TeamChannelMessage, Tower, User
from app.routers.claims import update_claim
from app.schemas import NightClaimUpdate


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _setup(db: Session):
    team = Team(name="Alpha")
    db.add(team)
    db.flush()
    leader = User(username="leader", role="team_leader", team_id=team.id, hashed_password="x")
    tower = Tower(tower_id="T50", area="Dufar", latitude=17.0, longitude=54.0, assigned_team_id=team.id)
    db.add_all([leader, tower])
    db.flush()
    claim = NightTowerClaim(team_id=team.id, field_date=dt.date(2026, 9, 18), tower_pk=tower.id, assigned_user_id=leader.id)
    db.add(claim)
    db.commit()
    return team, leader, tower, claim


def test_skip_without_a_reason_is_rejected(db: Session):
    team, leader, _tower, claim = _setup(db)
    with pytest.raises(HTTPException) as exc:
        update_claim(team.id, claim.id, NightClaimUpdate(status="skipped"), db=db, user=leader)
    assert exc.value.status_code == 400


def test_skip_with_the_generic_boilerplate_is_rejected(db: Session):
    team, leader, _tower, claim = _setup(db)
    with pytest.raises(HTTPException) as exc:
        update_claim(team.id, claim.id, NightClaimUpdate(status="skipped", skip_reason="Skipping this tower"), db=db, user=leader)
    assert exc.value.status_code == 400


def test_skip_with_a_real_reason_posts_it_to_the_crew_channel(db: Session):
    team, leader, tower, claim = _setup(db)
    out = update_claim(
        team.id, claim.id, NightClaimUpdate(status="skipped", skip_reason="Gate locked, no keyholder answered"), db=db, user=leader
    )
    assert out.skip_reason == "Gate locked, no keyholder answered"
    msg = db.query(TeamChannelMessage).filter(TeamChannelMessage.team_id == team.id, TeamChannelMessage.kind == "skip").first()
    assert msg is not None
    assert msg.body == "Gate locked, no keyholder answered"
    assert msg.tower_pk == tower.id
