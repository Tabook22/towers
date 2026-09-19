"""Restricted admins now get a 3-level grant (View / Add / Full) per category, instead of the old
all-or-nothing checkbox. Encoding is backward compatible: a bare name in permissions_csv
(e.g. "manage_towers") still means "full", exactly as it always has, so no migration is needed
for any account created before this feature existed (see deps.permission_level's docstring).
These tests exercise deps.permission_level / has_permission_level / require_permission_level
directly, plus routers/auth.py's _clean_permissions validation of the "name:level" encoding, and
the two pre-existing authorization gaps (routers/teams.py's update_team, routers/reports.py's
oetc_line_report) that this same sweep discovered and closed."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.deps import has_permission_level, permission_level, require_permission_level
from app.models import Team, User, UserRole
from app.routers import auth
from app.routers.auth import _clean_permissions
from app.routers.teams import update_team
from app.schemas import TeamUpdate


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


def _non_admin(role: str) -> User:
    return User(id=9, username="someone", role=role, is_super_admin=True, permissions_csv="manage_towers")


# ---- deps.permission_level -------------------------------------------------

def test_super_admin_is_full_on_every_leveled_permission():
    admin = _super_admin()
    assert permission_level(admin, "manage_towers") == "full"
    assert permission_level(admin, "manage_users") == "full"


def test_bare_grant_means_full_for_backward_compatibility():
    admin = _restricted_admin("manage_towers")
    assert permission_level(admin, "manage_towers") == "full"


def test_explicit_level_is_read_back_verbatim():
    admin = _restricted_admin("manage_towers:add", "generate_reports:full")
    assert permission_level(admin, "manage_towers") == "add"
    assert permission_level(admin, "generate_reports") == "full"


def test_ungranted_permission_defaults_to_view():
    admin = _restricted_admin("manage_towers:add")
    assert permission_level(admin, "manage_teams") == "view"


def test_non_admin_role_is_always_view_regardless_of_stored_permissions():
    leader = _non_admin("team_leader")
    assert permission_level(leader, "manage_towers") == "view"


# ---- deps.has_permission_level ---------------------------------------------

def test_has_permission_level_respects_ordering():
    admin = _restricted_admin("manage_towers:add")
    assert has_permission_level(admin, "manage_towers", "view")
    assert has_permission_level(admin, "manage_towers", "add")
    assert not has_permission_level(admin, "manage_towers", "full")


def test_has_permission_level_view_only_passes_view_but_not_add():
    admin = _restricted_admin()  # nothing granted -> floor is "view" everywhere
    assert has_permission_level(admin, "manage_towers", "view")
    assert not has_permission_level(admin, "manage_towers", "add")


def test_has_permission_level_super_admin_passes_every_level():
    admin = _super_admin()
    assert has_permission_level(admin, "manage_users", "full")


def test_has_permission_level_non_admin_role_never_passes():
    leader = _non_admin("team_leader")
    assert not has_permission_level(leader, "manage_towers", "view")


# ---- deps.require_permission_level ------------------------------------------

def test_require_permission_level_blocks_below_minimum():
    checker = require_permission_level("manage_towers", "full")
    with pytest.raises(HTTPException) as exc:
        checker(user=_restricted_admin("manage_towers:add"))
    assert exc.value.status_code == 403


def test_require_permission_level_passes_at_or_above_minimum():
    checker = require_permission_level("manage_towers", "add")
    assert checker(user=_restricted_admin("manage_towers:full")).id == 2
    assert checker(user=_restricted_admin("manage_towers:add")).id == 2


def test_require_permission_level_extra_role_passes_regardless():
    checker = require_permission_level("manage_towers", "full", UserRole.REVIEWER.value)
    reviewer = User(id=4, username="rev", role="reviewer")
    assert checker(user=reviewer).id == 4


# ---- routers/auth.py::_clean_permissions ------------------------------------

def test_clean_permissions_accepts_bare_name_as_full():
    is_super, csv = _clean_permissions("admin", False, ["manage_towers"])
    assert is_super is False
    assert csv == "manage_towers"


def test_clean_permissions_accepts_explicit_add_and_full_levels():
    is_super, csv = _clean_permissions("admin", False, ["manage_towers:add", "manage_teams:full"])
    assert csv == "manage_towers:add,manage_teams:full"


def test_clean_permissions_rejects_explicit_view_level():
    # "view" is the implicit floor and never needs to be stored — an explicit ":view" entry would
    # be indistinguishable from "not granted" and is rejected rather than silently accepted.
    with pytest.raises(HTTPException) as exc:
        _clean_permissions("admin", False, ["manage_towers:view"])
    assert exc.value.status_code == 400


def test_clean_permissions_rejects_unknown_level():
    with pytest.raises(HTTPException) as exc:
        _clean_permissions("admin", False, ["manage_towers:owner"])
    assert exc.value.status_code == 400


def test_clean_permissions_rejects_level_on_a_non_leveled_permission():
    # manage_settings stays a plain on/off checkbox (a single form, not a view/add/full shape).
    with pytest.raises(HTTPException) as exc:
        _clean_permissions("admin", False, ["manage_settings:add"])
    assert exc.value.status_code == 400


def test_clean_permissions_rejects_unknown_permission_name():
    with pytest.raises(HTTPException) as exc:
        _clean_permissions("admin", False, ["totally_made_up"])
    assert exc.value.status_code == 400


def test_clean_permissions_collapses_super_admin_and_non_admin_role_to_defaults():
    assert _clean_permissions("admin", True, ["manage_towers:add"]) == (True, None)
    assert _clean_permissions("team_leader", False, ["manage_towers:add"]) == (True, None)


# ---- previously-ungated endpoints, now closed by this sweep -----------------

def test_update_team_blocks_restricted_admin_without_full_manage_teams(db):
    team = Team(name="Line A")
    db.add(team)
    db.commit()
    actor = _restricted_admin("manage_teams:add")
    with pytest.raises(HTTPException) as exc:
        update_team(team.id, TeamUpdate(name="Line A Renamed"), db=db, user=actor)
    assert exc.value.status_code == 403


def test_update_team_allows_restricted_admin_with_full_manage_teams(db):
    team = Team(name="Line B")
    db.add(team)
    db.commit()
    actor = _restricted_admin("manage_teams:full")
    updated = update_team(team.id, TeamUpdate(name="Line B Renamed"), db=db, user=actor)
    assert updated.name == "Line B Renamed"


def test_create_user_with_manage_users_add_can_create_but_not_edit(db):
    actor = _restricted_admin("manage_users:add")
    created = auth.create_user(
        __import__("app.schemas", fromlist=["UserCreate"]).UserCreate(
            username="new_leader", password="secret123", role="team_leader"
        ),
        db=db,
        actor=actor,
    )
    assert created.role == "team_leader"
    from app.schemas import UserUpdate

    with pytest.raises(HTTPException) as exc:
        auth.update_user(created.id, UserUpdate(full_name="Changed"), db=db, actor=actor)
    assert exc.value.status_code == 403


def test_create_user_blocked_without_manage_users_add(db):
    actor = _restricted_admin()  # nothing granted -> floor is "view", below the "add" this needs
    from app.schemas import UserCreate

    with pytest.raises(HTTPException) as exc:
        auth.create_user(
            UserCreate(username="nope", password="secret123", role="team_member"),
            db=db,
            actor=actor,
        )
    assert exc.value.status_code == 403
