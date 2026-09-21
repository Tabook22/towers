"""Public self sign-up (routers/auth.register) and the admin-approval gate it must pass through
before login() will issue a token — see models.User.is_approved."""
import pytest
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Team, User
from app.routers import auth
from app.schemas import UserRegister, UserUpdate
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


def test_register_creates_an_unapproved_team_member(db):
    out = auth.register(payload=UserRegister(username="newcrew", password="secret123", full_name="New Crew"), db=db)
    assert "admin needs to approve" in out["detail"]
    row = db.query(User).filter(User.username == "newcrew").first()
    assert row is not None
    assert row.is_approved is False
    assert row.role == "team_member"
    assert row.team_id is None
    assert row.is_active is True


def test_register_rejects_a_taken_username(db):
    db.add(User(username="taken", hashed_password="x", role="team_member"))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        auth.register(payload=UserRegister(username="taken", password="secret123"), db=db)
    assert exc.value.status_code == 400


def test_login_refuses_an_unapproved_account_with_a_clear_message(db):
    auth.register(payload=UserRegister(username="pending1", password="secret123"), db=db)
    with pytest.raises(HTTPException) as exc:
        auth.login(form_data=_form("pending1", "secret123"), db=db)
    assert exc.value.status_code == 403
    assert "waiting for admin approval" in exc.value.detail


def test_login_succeeds_once_an_admin_approves(db):
    auth.register(payload=UserRegister(username="pending2", password="secret123"), db=db)
    row = db.query(User).filter(User.username == "pending2").first()

    # Approve exactly the way the frontend does — PATCH is_approved via update_user.
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
    auth.register(payload=UserRegister(username="pending3", password="secret123"), db=db)
    row = db.query(User).filter(User.username == "pending3").first()
    row.team_id = team.id  # even if the leader could otherwise touch this row (same team)
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
