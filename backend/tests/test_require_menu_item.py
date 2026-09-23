"""The real, server-side half of the per-menu-item permission system (see
models.User.menu_permissions_csv, deps.require_menu_item) — a restricted admin whose account has
no grant at all for a menu item gets a 403 from the routes that item's page depends on, not just a
hidden sidebar link. Scoped to exactly the "teams" item for now (Teams page + team-leader/member
account listing), matching the concrete case that prompted it. Every other role's access to these
routes is completely untouched — this only ever narrows a restricted ADMIN sub-account."""
import inspect

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.deps import require_menu_item
from app.models import Team, User
from app.routers import auth, teams

pytestmark = pytest.mark.filterwarnings("ignore::sqlalchemy.exc.SAWarning")


def _resolve_dependency(fn, param_name: str):
    """Pulls the actual checker function FastAPI would call for `Depends(...)` on this exact route
    parameter — calling the route function directly (as the tests below do) bypasses FastAPI's own
    dependency-injection machinery entirely, so this is what lets a test exercise the *real* wired
    dependency instead of a hand-rolled duplicate of it."""
    return inspect.signature(fn).parameters[param_name].default.dependency


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _super_admin() -> User:
    return User(id=1, username="root_admin", role="admin", is_super_admin=True)


def _restricted_admin(menu_permissions_csv: str | None) -> User:
    return User(id=2, username="ltd_admin", role="admin", is_super_admin=False, menu_permissions_csv=menu_permissions_csv)


def test_checker_blocks_restricted_admin_with_no_grant_for_the_item():
    checker = require_menu_item("teams")
    with pytest.raises(HTTPException) as exc:
        checker(user=_restricted_admin("dashboard:full"))
    assert exc.value.status_code == 403


def test_checker_passes_restricted_admin_with_any_level_granted():
    checker = require_menu_item("teams")
    for level in ("view", "edit", "download", "full"):
        assert checker(user=_restricted_admin(f"teams:{level}")).id == 2


def test_checker_never_restricts_a_super_admin():
    checker = require_menu_item("teams")
    assert checker(user=_super_admin()).id == 1


def test_checker_never_restricts_non_admin_roles():
    checker = require_menu_item("teams")
    for role in ("reviewer", "team_leader", "team_member", "client"):
        u = User(id=3, username=f"u_{role}", role=role)
        assert checker(user=u).id == 3


def test_list_teams_blocks_restricted_admin_without_teams_menu_grant(db):
    dep = _resolve_dependency(teams.list_teams, "user")
    actor = _restricted_admin("dashboard:full,reports:full")
    with pytest.raises(HTTPException) as exc:
        dep(user=actor)
    assert exc.value.status_code == 403


def test_list_teams_allows_restricted_admin_with_teams_menu_grant(db):
    db.add(Team(name="Team A"))
    db.commit()
    dep = _resolve_dependency(teams.list_teams, "user")
    actor = _restricted_admin("teams:view")
    resolved = dep(user=actor)
    result = teams.list_teams(db=db, user=resolved, include_inactive=False)
    assert len(result) == 1


def test_get_team_blocks_restricted_admin_without_teams_menu_grant(db):
    t = Team(name="Team B")
    db.add(t)
    db.commit()
    dep = _resolve_dependency(teams.get_team, "_menu")
    actor = _restricted_admin(None)
    with pytest.raises(HTTPException) as exc:
        dep(user=actor)
    assert exc.value.status_code == 403


def test_list_users_blocks_restricted_admin_without_teams_menu_grant(db):
    dep = _resolve_dependency(auth.list_users, "_menu")
    actor = _restricted_admin("dashboard:full")
    with pytest.raises(HTTPException) as exc:
        dep(user=actor)
    assert exc.value.status_code == 403


def test_list_users_allows_restricted_admin_with_teams_menu_grant(db):
    other = User(username="leader1", role="team_leader", hashed_password="x")
    db.add(other)
    db.commit()
    dep = _resolve_dependency(auth.list_users, "_menu")
    actor = _restricted_admin("teams:full")
    dep(user=actor)  # doesn't raise
    result = auth.list_users(db=db, actor=actor, _menu=actor)
    assert any(u.username == "leader1" for u in result)


def test_super_admin_always_passes_list_teams_and_list_users(db):
    actor = _super_admin()
    list_teams_dep = _resolve_dependency(teams.list_teams, "user")
    list_users_dep = _resolve_dependency(auth.list_users, "_menu")
    list_teams_dep(user=actor)  # doesn't raise
    list_users_dep(user=actor)  # doesn't raise
    assert teams.list_teams(db=db, user=actor, include_inactive=False) == []
    assert auth.list_users(db=db, actor=actor, _menu=actor) == []
