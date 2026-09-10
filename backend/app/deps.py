"""FastAPI dependencies: DB session + current-user auth."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserRole, Visit
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


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


def require_role(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return user

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


def check_visit_team_access(visit: Visit, user: User) -> None:
    """A visit that's also a team's mission (team_id set) is off-limits to a team_leader from a
    different team, and to a team_member it isn't personally assigned to — called from
    visits.py/positions.py/images.py after loading the visit, since there's no team_id in those
    routes' own paths to gate on directly. Non-mission visits (team_id is None) and every other
    role are unaffected. A team_member's check is narrower than a team_leader's on purpose: the
    whole team's missions vs. only the ones assigned to that one person (see models.UserRole)."""
    if user.role == UserRole.TEAM_LEADER.value and visit.team_id != user.team_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this visit")
    if user.role == UserRole.TEAM_MEMBER.value and visit.assigned_member_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This mission isn't assigned to you")
