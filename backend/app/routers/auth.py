from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import LEVELED_PERMISSIONS, PERMISSION_LEVELS, PERMISSIONS, effective_team_id, get_current_user, has_permission_level
from app.models import LocationPing, Team, User, UserRole, Visit
from app.schemas import ChangePasswordRequest, Token, UserCreate, UserOut, UserUpdate
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")
    token = create_access_token(subject=user.username, role=user.role)
    team_id = effective_team_id(db, user)
    return Token(
        access_token=token,
        user_id=user.id,
        role=user.role,
        username=user.username,
        full_name=user.full_name,
        team_id=team_id,
        is_super_admin=user.is_super_admin,
        permissions=user.permissions,
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    effective_team_id(db, user)
    return user


@router.post("/change-password", status_code=204)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Self-service — any signed-in account (admin, team_leader, team_member) can change their own
    password any time, without going through an admin/leader. Requires the current password."""
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return None


def _require_can_manage(payload_role: str, payload_team_id: int | None, actor: User) -> None:
    """Who's allowed to create/edit which accounts:
    - a full ("super") admin: anyone, any role, any team — including creating other admin accounts,
      restricted or not.
    - a restricted admin (role=admin, is_super_admin=False): only with the "manage_users"
      permission, and only for non-admin roles — a restricted admin can never create or edit
      another admin account, which would otherwise be a privilege-escalation path.
    - team_leader: only team_member accounts, only on their own team — they can grow their own
      roster but can't create another leader, an admin, or reach into a different team.
    - anyone else (team_member included): nothing here — see change_password for their one piece
      of self-service."""
    if actor.role == UserRole.ADMIN.value:
        if actor.is_super_admin:
            return
        if payload_role == UserRole.ADMIN.value:
            raise HTTPException(status_code=403, detail="Only a full admin can create or edit admin accounts")
        if not has_permission_level(actor, "manage_users", "add"):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return
    if actor.role == UserRole.TEAM_LEADER.value:
        if payload_role != UserRole.TEAM_MEMBER.value:
            raise HTTPException(status_code=403, detail="Team leaders can only create team-member accounts")
        if payload_team_id != actor.team_id:
            raise HTTPException(status_code=403, detail="You can only add members to your own team")
        return
    raise HTTPException(status_code=403, detail="Not enough permissions")


def _clean_permissions(role: str, is_super_admin: bool, permissions: list[str]) -> tuple[bool, str | None]:
    """Normalizes is_super_admin/permissions for storage: meaningless combinations (any non-admin
    role, or a super admin) are collapsed to the harmless default rather than trusted verbatim from
    the payload, and every entry is checked against the fixed PERMISSIONS list. An entry is either
    bare (`"manage_towers"`, meaning "full") or `"name:level"` (`"manage_towers:add"`) for one of
    LEVELED_PERMISSIONS — see deps.permission_level for how these are read back."""
    if role != UserRole.ADMIN.value:
        return True, None
    if is_super_admin:
        return True, None
    cleaned: list[str] = []
    for raw in permissions:
        name, sep, level = raw.partition(":")
        if name not in PERMISSIONS:
            raise HTTPException(status_code=400, detail=f"Unknown permission(s): {name}")
        if sep:
            if name not in LEVELED_PERMISSIONS:
                raise HTTPException(status_code=400, detail=f"'{name}' doesn't support a level like '{level}'")
            if level not in PERMISSION_LEVELS or level == "view":
                raise HTTPException(status_code=400, detail=f"Invalid level '{level}' for '{name}'")
            cleaned.append(f"{name}:{level}")
        else:
            cleaned.append(name)
    return False, ",".join(cleaned) if cleaned else None


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    _require_can_manage(payload.role, payload.team_id, actor)
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    is_super_admin, permissions_csv = _clean_permissions(payload.role, payload.is_super_admin, payload.permissions)
    user = User(
        username=payload.username,
        email=payload.email,
        full_name=payload.full_name,
        mobile=payload.mobile,
        address=payload.address,
        notes=payload.notes,
        job_type=payload.job_type,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        team_id=payload.team_id,
        is_super_admin=is_super_admin,
        permissions_csv=permissions_csv,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """admin: everyone. team_leader: just their own team's accounts (themself + their members) —
    used both for the admin's "Team leaders" list and a leader's own "Team members" roster; a
    team_member gets nothing here, they don't manage anyone (see routers/auth.py's _require_can_manage
    and the frontend's own-workspace pages instead)."""
    if actor.role == UserRole.ADMIN.value:
        return db.query(User).order_by(User.username).all()
    if actor.role == UserRole.TEAM_LEADER.value:
        return db.query(User).filter(User.team_id == actor.team_id).order_by(User.username).all()
    raise HTTPException(status_code=403, detail="Not enough permissions")


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Mainly here so a team's roster can be linked to real logins — e.g. assigning the leader's
    account to their team so their pings and visits count toward that team's progress. A
    team_leader may only touch their own team's team_member accounts (not another leader, not
    themself via this route, not another team) — everything else stays admin-only."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role == UserRole.ADMIN.value and not actor.is_super_admin:
        # A restricted admin needs "manage_users" to touch anyone, and can never edit an admin
        # account (their own included) — same escalation concern as _require_can_manage's create path.
        if user.role == UserRole.ADMIN.value:
            raise HTTPException(status_code=403, detail="Only a full admin can edit admin accounts")
        if not has_permission_level(actor, "manage_users", "full"):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        payload = UserUpdate(
            **payload.model_dump(exclude_unset=True, exclude={"is_super_admin", "permissions"}),
        )
    elif actor.role != UserRole.ADMIN.value:
        if actor.role != UserRole.TEAM_LEADER.value:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        if user.role != UserRole.TEAM_MEMBER.value or user.team_id != actor.team_id:
            raise HTTPException(status_code=403, detail="You can only manage your own team's members")
        # A leader growing/editing their roster can't use this route to escalate a member's role or
        # move them to another team — only the fields a roster edit actually needs.
        payload = UserUpdate(
            **payload.model_dump(exclude_unset=True, exclude={"role", "team_id", "is_super_admin", "permissions"}),
        )
    data = payload.model_dump(exclude_unset=True)
    new_password = data.pop("password", None)
    is_super_admin = data.pop("is_super_admin", None)
    permissions = data.pop("permissions", None)
    for k, v in data.items():
        setattr(user, k, v)
    if is_super_admin is not None or permissions is not None:
        target_role = data.get("role", user.role)
        resolved_super, resolved_csv = _clean_permissions(
            target_role,
            user.is_super_admin if is_super_admin is None else is_super_admin,
            user.permissions if permissions is None else permissions,
        )
        user.is_super_admin = resolved_super
        user.permissions_csv = resolved_csv
    if new_password:
        user.hashed_password = hash_password(new_password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Same manage-boundary as update_user (admin: anyone; team_leader: only their own team's
    team_member accounts) — plus two hard rules no role can override: never your own account (use
    change-password/ask another admin instead), never another admin account (deactivate isn't even
    offered for those elsewhere in the app; this route follows suit).

    Soft vs. hard mirrors deactivate_tower/delete_team: an account with real mission-assignment
    history (Visit.assigned_member_id) is deactivated, not erased, so that history keeps its
    "assigned to" name; one that was never actually used for fieldwork is removed outright —
    unlinking it from its team and clearing its GPS-ping history first.

    An admin account may only be deleted by a full ("super") admin — a restricted admin, even with
    "manage_users" at "full", can never touch another admin account, same boundary as
    _require_can_manage's create path and update_user's edit path. There's no separate "don't
    delete the last full admin" guard needed: the actor deleting an admin account is itself
    required to be a full admin and (per the check above) can't be the account being deleted, so a
    full admin always remains after this call succeeds."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    if user.role == UserRole.ADMIN.value:
        if not actor.is_super_admin:
            raise HTTPException(status_code=403, detail="Only a full admin can delete an admin account")
    elif actor.role == UserRole.ADMIN.value:
        if not actor.is_super_admin and not has_permission_level(actor, "manage_users", "full"):
            raise HTTPException(status_code=403, detail="Not enough permissions")
    elif actor.role == UserRole.TEAM_LEADER.value:
        if user.role != UserRole.TEAM_MEMBER.value or user.team_id != actor.team_id:
            raise HTTPException(status_code=403, detail="You can only manage your own team's members")
    else:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    has_mission_history = db.query(Visit).filter(Visit.assigned_member_id == user.id).first() is not None
    if has_mission_history:
        user.is_active = False
        db.commit()
        return None

    db.query(LocationPing).filter(LocationPing.user_id == user.id).delete()
    for led_team in db.query(Team).filter(Team.leader_user_id == user.id):
        led_team.leader_user_id = None  # last-known leader_name/phone text stays as history
    db.delete(user)
    db.commit()
    return None
