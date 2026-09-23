"""Per-account, per-sidebar-item view/edit/download/full-control grants (see
models.User.menu_permissions_csv, deps.default_menu_permissions_for_role) — a menu item the
account has no grant for is fully hidden from the nav (frontend Layout.tsx), not just disabled.
Only an admin actor may ever hand-pick these; every other account-creator (a team_leader adding a
team_member) always gets the role's default set, which is designed to reproduce exactly what that
role's nav looked like before this system existed."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.deps import MENU_ITEM_IDS, default_menu_permissions_for_role
from app.models import Team, User
from app.routers import auth
from app.schemas import UserCreate, UserUpdate


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _super_admin() -> User:
    return User(id=1, username="root_admin", role="admin", is_super_admin=True)


def _restricted_admin(*perms: str) -> User:
    return User(id=2, username="ltd_admin", role="admin", is_super_admin=False, permissions_csv=",".join(perms) or None)


def test_menu_permissions_property_round_trips_the_csv():
    user = User(menu_permissions_csv="dashboard:full,reports:view")
    assert user.menu_permissions == {"dashboard": "full", "reports": "view"}


def test_menu_permissions_property_is_empty_dict_when_unset():
    assert User().menu_permissions == {}


@pytest.mark.parametrize(
    "role,expected_items",
    [
        ("admin", set(MENU_ITEM_IDS)),
        ("reviewer", set(MENU_ITEM_IDS) - {"settings"}),
        ("team_leader", {"dashboard", "messages", "towers", "teams", "knowledge_base"}),
        ("team_member", {"dashboard", "messages", "towers", "teams"}),
        ("client", {"reports"}),
        ("inspector", {"dashboard", "towers", "image_archive", "reports", "messages", "knowledge_base"}),
    ],
)
def test_default_menu_permissions_reproduce_the_old_hardcoded_nav_per_role(role, expected_items):
    perms = default_menu_permissions_for_role(role)
    assert set(perms.keys()) == expected_items
    assert all(level == "full" for level in perms.values())


def test_admin_creating_a_user_can_hand_pick_menu_permissions(db):
    actor = _super_admin()
    payload = UserCreate(
        username="limited_reviewer",
        password="secret123",
        role="reviewer",
        menu_permissions={"dashboard": "view", "reports": "full"},
    )
    created = auth.create_user(payload, db=db, actor=actor)
    assert created.menu_permissions == {"dashboard": "view", "reports": "full"}


def test_admin_creating_a_user_with_no_menu_permissions_gets_the_role_default(db):
    actor = _super_admin()
    payload = UserCreate(username="plain_reviewer", password="secret123", role="reviewer")
    created = auth.create_user(payload, db=db, actor=actor)
    assert created.menu_permissions == default_menu_permissions_for_role("reviewer")


def test_create_user_rejects_an_unknown_menu_item(db):
    actor = _super_admin()
    payload = UserCreate(
        username="bad_item",
        password="secret123",
        role="reviewer",
        menu_permissions={"not_a_real_item": "full"},
    )
    with pytest.raises(HTTPException) as exc:
        auth.create_user(payload, db=db, actor=actor)
    assert exc.value.status_code == 400


def test_create_user_rejects_an_invalid_level(db):
    actor = _super_admin()
    payload = UserCreate(
        username="bad_level",
        password="secret123",
        role="reviewer",
        menu_permissions={"dashboard": "super-full"},
    )
    with pytest.raises(HTTPException) as exc:
        auth.create_user(payload, db=db, actor=actor)
    assert exc.value.status_code == 400


def test_team_leader_creating_a_team_member_always_gets_the_role_default_even_if_they_send_more(db):
    team = Team(name="Team 7")
    db.add(team)
    db.commit()
    leader = User(id=9, username="leader9", role="team_leader", team_id=team.id, hashed_password="x")
    db.add(leader)
    db.commit()
    payload = UserCreate(
        username="member1",
        password="secret123",
        role="team_member",
        team_id=team.id,
        # A team_leader is never allowed to hand-pick this — even if a crafted payload tries to
        # grant Settings, it must be silently ignored in favor of the role default.
        menu_permissions={"settings": "full", "dashboard": "full"},
    )
    created = auth.create_user(payload, db=db, actor=leader)
    assert created.menu_permissions == default_menu_permissions_for_role("team_member")
    assert "settings" not in created.menu_permissions


def test_restricted_admin_with_manage_users_can_hand_pick_menu_permissions(db):
    actor = _restricted_admin("manage_users")
    payload = UserCreate(
        username="leader_custom",
        password="secret123",
        role="team_leader",
        menu_permissions={"dashboard": "full"},
    )
    created = auth.create_user(payload, db=db, actor=actor)
    assert created.menu_permissions == {"dashboard": "full"}


def test_super_admin_can_update_a_users_menu_permissions(db):
    target = User(username="member2", role="team_member", hashed_password="x")
    db.add(target)
    db.commit()
    updated = auth.update_user(
        target.id,
        UserUpdate(menu_permissions={"dashboard": "view"}),
        db=db,
        actor=_super_admin(),
    )
    assert updated.menu_permissions == {"dashboard": "view"}


def test_update_user_rejects_an_invalid_menu_permission(db):
    target = User(username="member3", role="team_member", hashed_password="x")
    db.add(target)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        auth.update_user(
            target.id,
            UserUpdate(menu_permissions={"nope": "full"}),
            db=db,
            actor=_super_admin(),
        )
    assert exc.value.status_code == 400


def test_team_leader_updating_their_member_cannot_change_menu_permissions(db):
    team = Team(name="Team 8")
    db.add(team)
    db.commit()
    leader = User(id=10, username="leader10", role="team_leader", team_id=team.id, hashed_password="x")
    member = User(username="member4", role="team_member", team_id=team.id, hashed_password="x", menu_permissions_csv="dashboard:full")
    db.add_all([leader, member])
    db.commit()
    updated = auth.update_user(
        member.id,
        UserUpdate(menu_permissions={"settings": "full"}, full_name="Renamed"),
        db=db,
        actor=leader,
    )
    assert updated.full_name == "Renamed"
    assert updated.menu_permissions == {"dashboard": "full"}  # unchanged — the leader's edit was ignored
