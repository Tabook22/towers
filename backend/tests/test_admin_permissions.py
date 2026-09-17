"""A super admin can create a restricted "admin" sub-account limited to a fixed subset of
permissions (see deps.PERMISSIONS) — e.g. one who can manage towers and generate reports but can't
touch teams, users, or branding settings. This must be a real server-side wall, not just a hidden
UI control, so these tests exercise deps.require_permission / has_permission directly (the actual
gate every admin-only route now goes through) and routers/auth.py's create/update/delete guards
that decide who may create or edit an admin account at all."""
import io

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.database import Base
from app.deps import has_permission, require_permission
from app.models import AppSetting, User
from app.routers import app_settings, auth
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


def test_super_admin_has_every_permission_implicitly():
    admin = _super_admin()
    assert has_permission(admin, "manage_towers")
    assert has_permission(admin, "manage_settings")


def test_restricted_admin_only_has_what_was_granted():
    admin = _restricted_admin("manage_towers", "generate_reports")
    assert has_permission(admin, "manage_towers")
    assert has_permission(admin, "generate_reports")
    assert not has_permission(admin, "manage_teams")
    assert not has_permission(admin, "manage_settings")


def test_non_admin_role_never_has_permissions_even_if_column_somehow_set():
    leader = User(id=3, username="leader", role="team_leader", is_super_admin=True, permissions_csv="manage_towers")
    assert not has_permission(leader, "manage_towers")


def test_require_permission_blocks_restricted_admin_missing_the_permission():
    checker = require_permission("manage_teams")
    with pytest.raises(HTTPException) as exc:
        checker(user=_restricted_admin("manage_towers"))
    assert exc.value.status_code == 403


def test_require_permission_passes_restricted_admin_with_the_permission():
    checker = require_permission("manage_towers")
    assert checker(user=_restricted_admin("manage_towers")).id == 2


def test_require_permission_extra_role_passes_regardless_of_permissions():
    checker = require_permission("manage_towers", "reviewer")
    reviewer = User(id=4, username="rev", role="reviewer")
    assert checker(user=reviewer).id == 4


def test_super_admin_can_create_a_restricted_admin_with_a_specific_permission_set(db):
    actor = _super_admin()
    payload = UserCreate(
        username="branding_admin",
        password="secret123",
        role="admin",
        is_super_admin=False,
        permissions=["manage_settings"],
    )
    created = auth.create_user(payload, db=db, actor=actor)
    assert created.is_super_admin is False
    assert created.permissions == ["manage_settings"]


def test_restricted_admin_cannot_create_another_admin_account(db):
    actor = _restricted_admin("manage_users")
    payload = UserCreate(username="sneaky", password="secret123", role="admin")
    with pytest.raises(HTTPException) as exc:
        auth.create_user(payload, db=db, actor=actor)
    assert exc.value.status_code == 403


def test_restricted_admin_without_manage_users_cannot_create_anyone(db):
    actor = _restricted_admin("manage_towers")
    payload = UserCreate(username="member1", password="secret123", role="team_member")
    with pytest.raises(HTTPException) as exc:
        auth.create_user(payload, db=db, actor=actor)
    assert exc.value.status_code == 403


def test_restricted_admin_with_manage_users_can_create_a_team_leader(db):
    actor = _restricted_admin("manage_users")
    payload = UserCreate(username="leader1", password="secret123", role="team_leader")
    created = auth.create_user(payload, db=db, actor=actor)
    assert created.role == "team_leader"
    assert created.is_super_admin is True  # meaningless for non-admin roles, harmless default
    assert created.permissions == []


def test_restricted_admin_cannot_edit_an_existing_admin_account(db):
    actor = _restricted_admin("manage_users")
    target = User(username="other_admin", role="admin", is_super_admin=True, hashed_password="x")
    db.add(target)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        auth.update_user(target.id, UserUpdate(full_name="Hacked"), db=db, actor=actor)
    assert exc.value.status_code == 403


def test_restricted_admin_cannot_grant_themself_more_permissions_via_update(db):
    actor = _restricted_admin("manage_users")
    other = User(username="member1", role="team_member", hashed_password="x")
    db.add(other)
    db.commit()
    # Even though actor has manage_users, is_super_admin/permissions on the TARGET user are stripped
    # by update_user's restricted-admin branch — this only ever matters if `other` were later
    # promoted to admin, but the field should never silently pass through regardless.
    updated = auth.update_user(
        other.id,
        UserUpdate(is_super_admin=True, permissions=["manage_settings"], full_name="Renamed"),
        db=db,
        actor=actor,
    )
    assert updated.full_name == "Renamed"
    assert updated.permissions == []


def test_branding_get_works_for_any_authenticated_user(db):
    reviewer = User(id=5, username="rev", role="reviewer")
    out = app_settings.get_branding(db=db, _user=reviewer)
    assert out.configured is False
    assert out.oetc_logo_url is None


def test_branding_update_requires_manage_settings_permission():
    checker = require_permission("manage_settings")
    with pytest.raises(HTTPException):
        checker(user=_restricted_admin("manage_towers"))
    assert checker(user=_restricted_admin("manage_settings")).id == 2


def test_branding_update_saves_text_fields_and_logo(db, tmp_path, monkeypatch):
    monkeypatch.setattr(app_settings.settings, "branding_dir", tmp_path)
    logo = UploadFile(file=io.BytesIO(b"fake-png-bytes"), filename="oetc.png", headers=Headers({"content-type": "image/png"}))
    out = app_settings.update_branding(
        db=db,
        _user=_super_admin(),
        app_title="OETC Field Ops",
        splash_header="Welcome back",
        splash_subtitle=None,
        oetc_logo=logo,
        sky_green_line_logo=None,
        hero_image=None,
    )
    assert out.app_title == "OETC Field Ops"
    assert out.oetc_logo_url is not None
    assert out.configured is True
    row = db.get(AppSetting, 1)
    assert (tmp_path / row.oetc_logo_filename).exists()


def test_branding_update_saves_a_hero_banner_image(db, tmp_path, monkeypatch):
    monkeypatch.setattr(app_settings.settings, "branding_dir", tmp_path)
    hero = UploadFile(file=io.BytesIO(b"fake-jpeg-bytes"), filename="tower.jpg", headers=Headers({"content-type": "image/jpeg"}))
    out = app_settings.update_branding(
        db=db,
        _user=_super_admin(),
        app_title=None,
        splash_header=None,
        splash_subtitle=None,
        oetc_logo=None,
        sky_green_line_logo=None,
        hero_image=hero,
    )
    assert out.hero_image_url is not None
    assert out.configured is True
    row = db.get(AppSetting, 1)
    assert (tmp_path / row.hero_image_filename).exists()
