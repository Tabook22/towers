"""FastAPI dependencies: DB session + current-user auth."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Team, User, UserRole, Visit
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# The only permissions a restricted (non-super) admin sub-account can be granted — see
# User.is_super_admin / User.permissions_csv and require_permission() below. A full ("super") admin
# always has all of these implicitly and is never limited by this list.
PERMISSIONS: tuple[str, ...] = (
    "manage_towers",
    "manage_teams",
    "manage_users",
    "generate_reports",
    "manage_settings",
)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    token_query: str | None = Query(default=None, alias="token"),
    db: Session = Depends(get_db),
) -> User:
    # <img>/<a> tags can't send an Authorization header, so image/thumbnail/report links pass the
    # same JWT as a `?token=` query param instead — this is the "signed/authenticated URL" the image
    # serving endpoints need. Every other endpoint keeps using the header; the query param is just an
    # accepted alternate transport for the identical token, not a weaker credential.
    token = token or token_query
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise credentials_exception
    user = db.query(User).filter(User.username == payload["sub"]).first()
    if not user or not user.is_active:
        raise credentials_exception
    return user


def effective_team_id(db: Session, user: User) -> int | None:
    """User.team_id, or the team this login leads (leader_user_id) if team_id was never filled in."""
    if user.team_id:
        return user.team_id
    if user.role == UserRole.TEAM_LEADER.value:
        led = db.query(Team).filter(Team.leader_user_id == user.id).first()
        if led:
            user.team_id = led.id
            db.add(user)
            db.commit()
            db.refresh(user)
            return led.id
    return None


def require_role(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return user

    return checker


def has_permission(user: User, perm: str) -> bool:
    """True for a full ("super") admin unconditionally; for a restricted admin, only if `perm` is
    in their granted set. Meaningless (always False) for any non-admin role — those are gated by
    their own role checks elsewhere, never by this."""
    if user.role != UserRole.ADMIN.value:
        return False
    if user.is_super_admin:
        return True
    return perm in user.permissions


def require_permission(perm: str, *extra_roles: str):
    """Like require_role(ADMIN, *extra_roles), except an admin account also needs `perm` granted
    unless it's a full ("super") admin. `extra_roles` (e.g. reviewer) pass through unconditionally,
    same as they always have with require_role — this dependency only ever narrows what a
    *restricted* admin sub-account can do, it never widens anyone else's access."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role in extra_roles:
            return user
        if has_permission(user, perm):
            return user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")

    return checker


def require_team_scope():
    """For any route shaped /api/teams/{team_id}/... — admin/reviewer reach any team; a team_leader
    only their own (User.team_id); everyone else is refused. This is the actual server-side wall
    between teams' data, not just a UI hide — a team_leader's token literally can't fetch or edit
    another team's roster, missions, or notes."""

    def checker(team_id: int, user: User = Depends(get_current_user)) -> User:
        if user.role in (UserRole.ADMIN.value, UserRole.REVIEWER.value):
            return user
        if user.role == UserRole.TEAM_LEADER.value and user.team_id == team_id:
            return user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this team")

    return checker


def require_team_read():
    """Read-only team data: same wall as require_team_scope, plus a team_member may view their own
    team's track, towers, and history so the crew can see how far they have got."""

    def checker(team_id: int, user: User = Depends(get_current_user)) -> User:
        if user.role in (UserRole.ADMIN.value, UserRole.REVIEWER.value):
            return user
        if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value) and user.team_id == team_id:
            return user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this team")

    return checker


def check_visit_team_access(visit: Visit, user: User) -> None:
    """A visit that's also a team's mission (team_id set) is off-limits to a crew login from a
    different team. Team leaders and team members on that team can view and record on it."""
    if user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value) and visit.team_id != user.team_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this visit")
