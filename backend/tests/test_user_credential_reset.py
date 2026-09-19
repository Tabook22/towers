"""A username or password can leak (shared over chat, written down, seen over someone's shoulder)
independent of anything the account holder did wrong — being able to rotate both is a basic
credential-hygiene control, not just an account-editing convenience. update_user already reset
passwords; this covers the newly added ability to also change a username, through the same
manage-boundary every other field in that route already respects (see auth.py's update_user
docstring): an admin can rotate anyone's, a team_leader only their own team's team_members'."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.database import Base
from app.models import User, UserRole
from app.routers import auth
from app.schemas import UserUpdate
from app.security import verify_password


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _super_admin() -> User:
    return User(id=1, username="root_admin", role="admin", is_super_admin=True, hashed_password="x")


def test_super_admin_can_rename_any_user(db):
    target = User(username="old_name", role="team_leader", hashed_password="x")
    db.add(target)
    db.commit()
    updated = auth.update_user(target.id, UserUpdate(username="new_name"), db=db, actor=_super_admin())
    assert updated.username == "new_name"


def test_renaming_to_an_existing_username_is_rejected(db):
    other = User(username="taken", role="team_leader", hashed_password="x")
    target = User(username="old_name", role="team_leader", hashed_password="x")
    db.add_all([other, target])
    db.commit()
    with pytest.raises(HTTPException) as exc:
        auth.update_user(target.id, UserUpdate(username="taken"), db=db, actor=_super_admin())
    assert exc.value.status_code == 400


def test_renaming_to_its_own_current_username_is_a_harmless_no_op(db):
    target = User(username="same_name", role="team_leader", hashed_password="x")
    db.add(target)
    db.commit()
    updated = auth.update_user(target.id, UserUpdate(username="same_name"), db=db, actor=_super_admin())
    assert updated.username == "same_name"


def test_super_admin_can_reset_any_users_password(db):
    target = User(username="member1", role="team_member", hashed_password="old-hash")
    db.add(target)
    db.commit()
    updated = auth.update_user(target.id, UserUpdate(password="brandnewpass"), db=db, actor=_super_admin())
    assert verify_password("brandnewpass", updated.hashed_password)


def test_team_leader_can_rename_and_reset_password_for_their_own_team_member(db):
    from app.models import Team

    team = Team(name="Line A")
    db.add(team)
    db.commit()
    leader = User(username="leader1", role="team_leader", team_id=team.id, hashed_password="x")
    member = User(username="member_old", role="team_member", team_id=team.id, hashed_password="old-hash")
    db.add_all([leader, member])
    db.commit()
    updated = auth.update_user(
        member.id, UserUpdate(username="member_new", password="freshpass123"), db=db, actor=leader
    )
    assert updated.username == "member_new"
    assert verify_password("freshpass123", updated.hashed_password)


def test_team_leader_cannot_rename_a_member_of_another_team(db):
    from app.models import Team

    team_a = Team(name="Line A")
    team_b = Team(name="Line B")
    db.add_all([team_a, team_b])
    db.commit()
    leader = User(username="leader1", role="team_leader", team_id=team_a.id, hashed_password="x")
    other_member = User(username="member_x", role="team_member", team_id=team_b.id, hashed_password="x")
    db.add_all([leader, other_member])
    db.commit()
    with pytest.raises(HTTPException) as exc:
        auth.update_user(other_member.id, UserUpdate(username="hijacked"), db=db, actor=leader)
    assert exc.value.status_code == 403


def test_restricted_admin_with_manage_users_full_can_rename_a_team_leader(db):
    actor = User(id=2, username="ltd_admin", role="admin", is_super_admin=False, permissions_csv="manage_users:full", hashed_password="x")
    target = User(username="leader_old", role="team_leader", hashed_password="x")
    db.add_all([actor, target])
    db.commit()
    updated = auth.update_user(target.id, UserUpdate(username="leader_new"), db=db, actor=actor)
    assert updated.username == "leader_new"


def test_restricted_admin_still_cannot_rename_an_admin_account(db):
    actor = User(id=2, username="ltd_admin", role="admin", is_super_admin=False, permissions_csv="manage_users:full", hashed_password="x")
    target = User(username="other_admin", role="admin", is_super_admin=True, hashed_password="x")
    db.add_all([actor, target])
    db.commit()
    with pytest.raises(HTTPException) as exc:
        auth.update_user(target.id, UserUpdate(username="hijacked"), db=db, actor=actor)
    assert exc.value.status_code == 403
