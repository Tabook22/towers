"""The help-chat assistant's live-data tools (see services/chat_tools.py) must never leak one
team's data to another team's login, and must always show an admin/reviewer everything — the
exact same wall the rest of the app already enforces, just reachable through a chat question
instead of a page. These tests exercise the tool functions directly, the same functions
routers/help_chat.py calls when the model asks for one."""
import datetime as dt

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import KnowledgeDocument, Position, Team, Tower, User, Visit
from app.services import chat_tools


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def _seed(db: Session):
    alpha = Team(name="Alpha")
    bravo = Team(name="Bravo")
    db.add_all([alpha, bravo])
    db.flush()

    t1 = Tower(tower_id="Ashoor-Saada-1", area="Ashoor-Saada", assigned_team_id=alpha.id)
    t2 = Tower(tower_id="Ashoor-Saada-2", area="Ashoor-Saada", assigned_team_id=bravo.id)
    db.add_all([t1, t2])
    db.flush()

    v1 = Visit(tower_id=t1.id, team_id=alpha.id, inspection_date=dt.date(2026, 9, 1))
    v2 = Visit(tower_id=t2.id, team_id=bravo.id, inspection_date=dt.date(2026, 9, 2))
    db.add_all([v1, v2])
    db.flush()

    db.add_all(
        [
            Position(visit_id=v1.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", hotspot="Yes"),
            Position(visit_id=v2.id, ohl="OHL1", phase="R", string="S1", direction="Saada", hotspot="No"),
        ]
    )
    db.commit()
    return alpha, bravo, t1, t2


def _admin() -> User:
    return User(id=1, username="admin", role="admin")


def _leader_for(team: Team) -> User:
    return User(id=team.id + 100, username=f"leader{team.id}", role="team_leader", team_id=team.id)


def test_dashboard_summary_admin_sees_every_team():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    out = chat_tools.dashboard_summary(db, _admin())
    assert out["tower_count"] == 2
    assert out["total_hotspots"] == 1


def test_dashboard_summary_team_leader_only_sees_their_own_team():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    out = chat_tools.dashboard_summary(db, _leader_for(alpha))
    assert out["tower_count"] == 1
    assert out["total_hotspots"] == 1  # Alpha's own tower has the hotspot

    out_bravo = chat_tools.dashboard_summary(db, _leader_for(bravo))
    assert out_bravo["tower_count"] == 1
    assert out_bravo["total_hotspots"] == 0  # Bravo's tower has no hotspot


def test_tower_status_team_leader_cannot_look_up_another_teams_tower():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    # Bravo's tower, asked by Alpha's leader — must not leak.
    out = chat_tools.tower_status(db, _leader_for(alpha), tower_id="Ashoor-Saada-2")
    assert "error" in out

    # Alpha's own tower is fine.
    out_own = chat_tools.tower_status(db, _leader_for(alpha), tower_id="Ashoor-Saada-1")
    assert out_own["tower_id"] == "Ashoor-Saada-1"
    assert out_own["hotspots"] == 1


def test_tower_status_admin_can_look_up_any_tower():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    out = chat_tools.tower_status(db, _admin(), tower_id="ashoor-saada-2")  # case-insensitive
    assert out["tower_id"] == "Ashoor-Saada-2"


def test_team_progress_team_leader_ignores_a_different_team_name_argument():
    """Even if the model were somehow prompted (by the user, or by injected data) to pass another
    team's name, a crew login's own scoping must win — this is the actual security boundary, not
    something the model is trusted to respect on its own."""
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    out = chat_tools.team_progress(db, _leader_for(alpha), team_name="Bravo")
    assert len(out["teams"]) == 1
    assert out["teams"][0]["team_name"] == "Alpha"


def test_team_progress_admin_can_filter_by_name_or_get_everyone():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    filtered = chat_tools.team_progress(db, _admin(), team_name="Bravo")
    assert len(filtered["teams"]) == 1
    assert filtered["teams"][0]["team_name"] == "Bravo"

    everyone = chat_tools.team_progress(db, _admin())
    assert {t["team_name"] for t in everyone["teams"]} == {"Alpha", "Bravo"}


def test_search_knowledge_base_finds_matching_document_by_keyword():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    db.add(
        KnowledgeDocument(
            title="Cracked insulator at Ashoor-Saada-1",
            description="What we did when we found a hairline crack",
            team_id=alpha.id,
            file_path="doc1.txt",
            extracted_text="We found a cracked porcelain insulator on the top phase. Replaced it and logged a hotspot.",
        )
    )
    db.commit()
    out = chat_tools.search_knowledge_base(db, _admin(), query="cracked insulator")
    assert len(out["results"]) == 1
    assert out["results"][0]["title"] == "Cracked insulator at Ashoor-Saada-1"
    assert "cracked" in out["results"][0]["excerpt"].lower()


def test_search_knowledge_base_no_match_says_so_instead_of_guessing():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    out = chat_tools.search_knowledge_base(db, _admin(), query="lightning strike")
    assert out["results"] == []
    assert "message" in out


def test_search_knowledge_base_team_leader_cannot_see_another_teams_private_document():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    db.add(
        KnowledgeDocument(
            title="Bravo-only incident report",
            team_id=bravo.id,
            file_path="doc2.txt",
            extracted_text="A very specific bravo-team access road was blocked by a landslide.",
        )
    )
    db.commit()
    out = chat_tools.search_knowledge_base(db, _leader_for(alpha), query="landslide")
    assert out["results"] == []

    out_bravo = chat_tools.search_knowledge_base(db, _leader_for(bravo), query="landslide")
    assert len(out_bravo["results"]) == 1


def test_search_knowledge_base_team_leader_sees_company_wide_documents():
    db = Session(_engine())
    alpha, bravo, t1, t2 = _seed(db)
    db.add(
        KnowledgeDocument(
            title="Company safety bulletin",
            team_id=None,  # shared / company-wide
            file_path="doc3.txt",
            extracted_text="All crews must wear arc-flash gear near live 132kV lines.",
        )
    )
    db.commit()
    out = chat_tools.search_knowledge_base(db, _leader_for(alpha), query="arc-flash")
    assert len(out["results"]) == 1
    assert out["results"][0]["team"] == "Company-wide"
