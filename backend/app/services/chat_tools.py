"""Read-only data look-ups the help-chat assistant can call (Anthropic tool use) to answer
questions about live data instead of just the static guide — see routers/help_chat.py.

Every function here takes the SAME (db, user) any other authenticated endpoint would and enforces
the exact same role-based scoping the rest of the app already has (see deps.effective_team_id):
admin/reviewer can see everything; a team_leader/team_member only ever sees their own team's data,
regardless of what arguments the model passes in — the scoping is enforced here in Python, never
left to the model to "remember" to ask for the right team. There is deliberately no write path in
this module: these are look-ups only, driven by a user's own chat message, so nothing here can
ever create, edit, or delete a row.
"""
from __future__ import annotations

import re

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.deps import effective_team_id
from app.models import KnowledgeDocument, Position, Team, Tower, User, UserRole, Visit
from app.services.rollup import visit_rollup
from app.utils import natural_sort_key

TOOLS = [
    {
        "name": "dashboard_summary",
        "description": (
            "Overall live counts across the project: how many towers, open hotspots, and pending "
            "evidence images — optionally filtered to one area/line. Automatically scoped to "
            "whoever is asking: an admin/reviewer sees the whole project, a team leader or crew "
            "member only ever sees their own team's towers. Also returns the towers most needing "
            "attention right now (highest hotspot/pending count first)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "area": {
                    "type": "string",
                    "description": "Optional area/line name to filter to, e.g. 'Ashoor-Saada'.",
                },
            },
        },
    },
    {
        "name": "tower_status",
        "description": (
            "Look up one specific tower by its Tower ID (e.g. 'Ashoor-Saada-43') — its area, "
            "latest visit status, hotspot count, pending images, and completion percentage. Only "
            "returns a result if the caller can actually see that tower — a team leader or crew "
            "member can only look up a tower assigned to their own team."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "tower_id": {"type": "string", "description": "The Tower ID to look up, e.g. 'Ashoor-Saada-43'."},
            },
            "required": ["tower_id"],
        },
    },
    {
        "name": "team_progress",
        "description": (
            "Progress for one team (missions run, towers assigned, hotspots, pending images) — or, "
            "for an admin/reviewer with no team_name given, every active team at once. A team "
            "leader or crew member always gets only their own team back, regardless of what "
            "team_name is passed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "team_name": {
                    "type": "string",
                    "description": "Optional team name to filter to — ignored for a team leader/crew member, who always get their own team.",
                },
            },
        },
    },
    {
        "name": "search_knowledge_base",
        "description": (
            "Search field reports, incident write-ups, and other reference documents the team has "
            "uploaded — e.g. 'has a cracked insulator like this been seen before', 'what happened "
            "the last time a team lost GPS signal'. Automatically scoped: a team leader or crew "
            "member only searches their own team's documents plus anything shared company-wide; "
            "an admin/reviewer searches everything. Returns short excerpts, not whole documents — "
            "say so plainly if nothing matches rather than guessing at what a report might contain."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords to search for, e.g. 'cracked insulator Ashoor-Saada'."},
            },
            "required": ["query"],
        },
    },
]


def _is_crew(user: User) -> bool:
    return user.role in (UserRole.TEAM_LEADER.value, UserRole.TEAM_MEMBER.value)


def _scoped_tower_query(db: Session, user: User):
    q = db.query(Tower).filter(Tower.is_active.is_(True))
    if _is_crew(user):
        tid = effective_team_id(db, user)
        q = q.filter(Tower.assigned_team_id == tid) if tid else q.filter(False)
    return q


def _tower_summary(db: Session, tower: Tower, team_id: int | None) -> dict:
    visit_q = db.query(Visit).filter(Visit.tower_id == tower.id)
    if team_id:
        visit_q = visit_q.filter(Visit.team_id == team_id)
    latest = (
        visit_q.options(joinedload(Visit.positions).joinedload(Position.images))
        .order_by(Visit.inspection_date.desc().nullslast(), Visit.id.desc())
        .first()
    )
    if not latest:
        return {
            "tower_id": tower.tower_id,
            "area": tower.area,
            "status": "not inspected yet",
            "hotspots": 0,
            "images_pending": 0,
            "completion_pct": 0.0,
        }
    r = visit_rollup(latest)
    return {
        "tower_id": tower.tower_id,
        "area": tower.area,
        "mission_status": latest.mission_status,
        "status": r["visit_status"],
        "inspection_date": str(latest.inspection_date) if latest.inspection_date else None,
        "hotspots": r["hotspots"],
        "images_pending": r["images_pending"],
        "completion_pct": r["completion_pct"],
    }


def dashboard_summary(db: Session, user: User, area: str | None = None) -> dict:
    q = _scoped_tower_query(db, user)
    if area:
        q = q.filter(Tower.area == area)
    towers = sorted(q.all(), key=lambda t: natural_sort_key(t.tower_id))
    team_id = effective_team_id(db, user) if _is_crew(user) else None

    summaries = [_tower_summary(db, t, team_id) for t in towers]
    needing_attention = sorted(
        [s for s in summaries if s["hotspots"] > 0 or s["images_pending"] > 0],
        key=lambda s: (-s["hotspots"], -s["images_pending"]),
    )[:10]

    return {
        "tower_count": len(towers),
        "total_hotspots": sum(s["hotspots"] for s in summaries),
        "total_images_pending": sum(s["images_pending"] for s in summaries),
        "towers_needing_attention": needing_attention,
    }


def tower_status(db: Session, user: User, tower_id: str) -> dict:
    tower_id = (tower_id or "").strip()
    if not tower_id:
        return {"error": "No tower_id given."}
    tower = _scoped_tower_query(db, user).filter(Tower.tower_id.ilike(tower_id)).first()
    if not tower:
        return {"error": f"No tower found matching '{tower_id}' that you have access to."}
    team_id = effective_team_id(db, user) if _is_crew(user) else None
    return _tower_summary(db, tower, team_id)


def team_progress(db: Session, user: User, team_name: str | None = None) -> dict:
    q = db.query(Team).filter(Team.is_active.is_(True))
    if _is_crew(user):
        tid = effective_team_id(db, user)
        q = q.filter(Team.id == tid) if tid else q.filter(False)
    elif team_name:
        q = q.filter(Team.name.ilike(f"%{team_name.strip()}%"))
    teams = q.all()
    if not teams:
        return {"error": "No matching team found (or you don't have access to it)."}

    results = []
    for team in teams:
        towers = db.query(Tower).filter(Tower.assigned_team_id == team.id, Tower.is_active.is_(True)).all()
        summaries = [_tower_summary(db, t, team.id) for t in towers]
        results.append(
            {
                "team_name": team.name,
                "status": team.status,
                "towers_assigned": len(towers),
                "missions_run": db.query(Visit).filter(Visit.team_id == team.id).count(),
                "total_hotspots": sum(s["hotspots"] for s in summaries),
                "total_images_pending": sum(s["images_pending"] for s in summaries),
            }
        )
    return {"teams": results}


_SNIPPET_RADIUS = 200  # characters of context on each side of the first matched keyword


def _snippet(text: str, words: list[str]) -> str:
    lower = text.lower()
    pos = -1
    for w in words:
        pos = lower.find(w)
        if pos != -1:
            break
    if pos == -1:
        return text[: _SNIPPET_RADIUS * 2].strip()
    start = max(0, pos - _SNIPPET_RADIUS)
    end = min(len(text), pos + _SNIPPET_RADIUS)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{text[start:end].strip()}{suffix}"


def search_knowledge_base(db: Session, user: User, query: str, limit: int = 5) -> dict:
    words = [w for w in re.findall(r"\w+", (query or "").lower()) if len(w) > 2]
    if not words:
        return {"error": "Give at least one real keyword to search for."}

    q = db.query(KnowledgeDocument)
    if _is_crew(user):
        tid = effective_team_id(db, user)
        q = q.filter(or_(KnowledgeDocument.team_id.is_(None), KnowledgeDocument.team_id == tid))
    docs = q.all()

    scored: list[tuple[int, KnowledgeDocument]] = []
    for d in docs:
        haystack = f"{d.title} {d.description or ''} {d.extracted_text or ''}".lower()
        score = sum(haystack.count(w) for w in words)
        if score > 0:
            scored.append((score, d))
    scored.sort(key=lambda pair: -pair[0])

    if not scored:
        return {"results": [], "message": "No matching documents found in the knowledge base."}

    results = []
    for _score, d in scored[:limit]:
        body = d.extracted_text or d.description or ""
        results.append(
            {
                "title": d.title,
                "team": d.team.name if d.team else "Company-wide",
                "uploaded_at": str(d.uploaded_at.date()),
                "excerpt": _snippet(body, words) if body else None,
            }
        )
    return {"results": results}


TOOL_FUNCTIONS = {
    "dashboard_summary": dashboard_summary,
    "tower_status": tower_status,
    "team_progress": team_progress,
    "search_knowledge_base": search_knowledge_base,
}
