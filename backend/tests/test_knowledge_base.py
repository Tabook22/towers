"""Who can add/remove knowledge-base documents (and who can only search them) — see
routers/knowledge_base.py. A team leader can only ever file something under their own team
(never company-wide, never another team's, regardless of what the request asks for); a team
member can't upload at all; a restricted admin needs the "manage_knowledge_base" permission."""
import io

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.database import Base
from app.models import KnowledgeDocument, Team, User
from app.routers import knowledge_base


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(knowledge_base.settings, "knowledge_base_dir", tmp_path)
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _team(db, name="Alpha") -> Team:
    t = Team(name=name)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _file(name="report.txt", content=b"we found a cracked insulator") -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name, headers=Headers({"content-type": "text/plain"}))


def test_team_leader_upload_is_always_scoped_to_their_own_team_regardless_of_request(db):
    alpha = _team(db, "Alpha")
    bravo = _team(db, "Bravo")
    leader = User(id=1, username="leader1", role="team_leader", team_id=alpha.id)

    out = knowledge_base.upload_document(
        db=db,
        user=leader,
        title="Cracked insulator report",
        description=None,
        team_id=bravo.id,  # attempted — must be ignored
        file=_file(),
    )
    assert out.team_id == alpha.id


def test_team_member_cannot_upload(db):
    alpha = _team(db, "Alpha")
    member = User(id=2, username="member1", role="team_member", team_id=alpha.id)
    with pytest.raises(HTTPException) as exc:
        knowledge_base.upload_document(db=db, user=member, title="x", description=None, team_id=None, file=_file())
    assert exc.value.status_code == 403


def test_restricted_admin_without_permission_cannot_upload(db):
    admin = User(id=3, username="ltd_admin", role="admin", is_super_admin=False, permissions_csv="manage_towers")
    with pytest.raises(HTTPException) as exc:
        knowledge_base.upload_document(db=db, user=admin, title="x", description=None, team_id=None, file=_file())
    assert exc.value.status_code == 403


def test_restricted_admin_with_permission_can_upload_company_wide(db):
    admin = User(id=4, username="kb_admin", role="admin", is_super_admin=False, permissions_csv="manage_knowledge_base")
    out = knowledge_base.upload_document(db=db, user=admin, title="Safety bulletin", description=None, team_id=None, file=_file())
    assert out.team_id is None
    assert out.team_name is None


def test_super_admin_can_upload_to_any_team(db):
    alpha = _team(db, "Alpha")
    admin = User(id=5, username="admin", role="admin", is_super_admin=True)
    out = knowledge_base.upload_document(db=db, user=admin, title="x", description=None, team_id=alpha.id, file=_file())
    assert out.team_id == alpha.id
    assert out.team_name == "Alpha"


def test_uploaded_document_has_extracted_text_and_is_findable(db):
    admin = User(id=6, username="admin", role="admin", is_super_admin=True)
    out = knowledge_base.upload_document(
        db=db, user=admin, title="x", description=None, team_id=None, file=_file(content=b"a very unique phrase here")
    )
    assert out.has_text is True
    row = db.get(KnowledgeDocument, out.id)
    assert "unique phrase" in row.extracted_text


def test_team_leader_can_delete_their_own_teams_document_but_not_a_shared_one(db):
    alpha = _team(db, "Alpha")
    leader = User(id=7, username="leader1", role="team_leader", team_id=alpha.id)
    own_doc = knowledge_base.upload_document(db=db, user=leader, title="own", description=None, team_id=None, file=_file())

    admin = User(id=8, username="admin", role="admin", is_super_admin=True)
    shared_doc = knowledge_base.upload_document(db=db, user=admin, title="shared", description=None, team_id=None, file=_file())

    knowledge_base.delete_document(own_doc.id, db=db, user=leader)
    assert db.get(KnowledgeDocument, own_doc.id) is None

    with pytest.raises(HTTPException) as exc:
        knowledge_base.delete_document(shared_doc.id, db=db, user=leader)
    assert exc.value.status_code == 403
    assert db.get(KnowledgeDocument, shared_doc.id) is not None


def test_list_documents_scoping_matches_search_scoping(db):
    alpha = _team(db, "Alpha")
    bravo = _team(db, "Bravo")
    admin = User(id=9, username="admin", role="admin", is_super_admin=True)
    knowledge_base.upload_document(db=db, user=admin, title="alpha-only", description=None, team_id=alpha.id, file=_file())
    knowledge_base.upload_document(db=db, user=admin, title="bravo-only", description=None, team_id=bravo.id, file=_file())
    knowledge_base.upload_document(db=db, user=admin, title="shared", description=None, team_id=None, file=_file())

    leader_alpha = User(id=10, username="leader_a", role="team_leader", team_id=alpha.id)
    titles = {d.title for d in knowledge_base.list_documents(db=db, user=leader_alpha)}
    assert titles == {"alpha-only", "shared"}

    titles_admin = {d.title for d in knowledge_base.list_documents(db=db, user=admin)}
    assert titles_admin == {"alpha-only", "bravo-only", "shared"}
