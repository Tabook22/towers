"""Transactional visit creation and retries, shared by both creation endpoints."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import func, update

from app.models import Team, Tower, User, Visit, VisitCreationRequest


def create_visit_once(payload, db, user, *, numbered=False):
    from app.routers.visits import create_visit_row, _load_visit, _check_workflow_access

    token = str(payload.request_token) if payload.request_token else None
    values = payload.model_dump(mode='json', exclude={'request_token'})
    fingerprint = hashlib.sha256(json.dumps({'numbered': numbered, 'values': values}, sort_keys=True).encode()).hexdigest()
    try:
        # Taking a write lock before reading serializes retries on SQLite and locks
        # the author's row on other databases. Locks live until the final commit.
        db.execute(update(User).where(User.id == user.id).values(id=User.id))
        if payload.team_id is not None:
            locked = db.execute(update(Team).where(Team.id == payload.team_id)
                                .values(id=Team.id, updated_at=Team.updated_at))
            if locked.rowcount != 1:
                raise HTTPException(404, 'Team not found')
        elif payload.resume_existing:
            locked = db.execute(update(Tower).where(Tower.id == payload.tower_id)
                                .values(id=Tower.id, updated_at=Tower.updated_at))
            if locked.rowcount != 1:
                raise HTTPException(404, 'Tower not found')
        if token:
            prior = db.query(VisitCreationRequest).filter_by(user_id=user.id, token=token).first()
            if prior:
                if prior.fingerprint != fingerprint:
                    raise HTTPException(409, 'This creation token belongs to a different inspection request')
                if prior.visit_id is None:
                    raise HTTPException(410, 'The inspection created by this request was deleted. Start a new request.')
                visit = _load_visit(db, prior.visit_id)
                _check_workflow_access(visit, user)
                db.commit()
                return visit
        visit = None
        if payload.resume_existing:
            visit = db.query(Visit).filter_by(tower_id=payload.tower_id, team_id=payload.team_id,
                                             inspection_date=payload.inspection_date).order_by(Visit.id.desc()).first()
            if visit:
                _check_workflow_access(visit, user)
        if visit is None:
            # Allocate only after locking the team: concurrent creators cannot
            # read the same maximum. Historical mission numbers stay intact.
            sequence = ((db.query(func.max(Visit.mission_seq)).filter_by(team_id=payload.team_id).scalar() or 0) + 1
                        if numbered else None)
            visit = create_visit_row(payload, db, user)
            visit.mission_seq = sequence
        if token:
            db.add(VisitCreationRequest(user_id=user.id, token=token, fingerprint=fingerprint, visit_id=visit.id))
        db.commit()
        return visit
    except Exception:
        db.rollback()
        raise
