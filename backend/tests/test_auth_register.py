"""The is_approved gate on login() — see models.User.is_approved. Public self sign-up
(routers/auth.py's old register() endpoint) has been removed (only an admin creates accounts now,
see routers/auth.py's create_user), but the gate itself stays: an admin can still deliberately land
an account with is_approved=False (e.g. via UserUpdate) and have login() hold it until approved."""
import pytest
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Team, User
from app.routers import auth
from app.schemas import UserUpdate
from app.security import hash_password


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _super_admin(user_id: int = 1) -> User:
    return User(id=user_id, username="root_admin", role="admin", is_super_admin=True, hashed_password="x")


def _form(username: str, password: str) -> OAuth2PasswordRequestForm:
    return OAuth2PasswordRequestForm(username=username, password=password)


def test_login_refuses_an_unapproved_account_with_a_clear_message(db):
    row = User(username="pending1", hashed_password=hash_password("secret123"), role="team_member", is_approved=False)
    db.add(row)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        auth.login(form_data=_form("pending1", "secret123"), db=db)
    assert exc.value.status_code == 403
    assert "waiting for admin approval" in exc.value.detail


def test_login_succeeds_once_an_admin_approves(db):
    row = User(username="pending2", hashed_password=hash_password("secret123"), role="team_member", is_approved=False)
    db.add(row)
    db.commit()

    auth.update_user(user_id=row.id, payload=UserUpdate(is_approved=True), db=db, actor=_super_admin())

    token = auth.login(form_data=_form("pending2", "secret123"), db=db)
    assert token.username == "pending2"
    assert token.role == "team_member"


def test_team_leader_cannot_approve_a_pending_account(db):
    team = Team(name="Alpha")
    db.add(team)
    db.commit()
    leader = User(id=5, username="leader1", role="team_leader", team_id=team.id, hashed_password="x")
    db.add(leader)
    row = User(username="pending3", hashed_password=hash_password("secret123"), role="team_member", is_approved=False, team_id=team.id)
    db.add(row)
    db.commit()

    # is_approved is silently dropped for a team_leader actor (see update_user's exclude set) —
    # the row stays unapproved rather than the request failing outright.
    out = auth.update_user(user_id=row.id, payload=UserUpdate(is_approved=True, job_type="Drone Operator"), db=db, actor=leader)
    assert out.is_approved is False
    assert out.job_type == "Drone Operator"


def test_existing_admin_created_accounts_default_to_approved(db):
    row = User(username="admincreated", hashed_password=hash_password("secret123"), role="team_member")
    db.add(row)
    db.commit()
    db.refresh(row)
    assert row.is_approved is True
    token = auth.login(form_data=_form("admincreated", "secret123"), db=db)
    assert token.username == "admincreated"
