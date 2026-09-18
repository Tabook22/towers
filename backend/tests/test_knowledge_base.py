"""Who can add/remove knowledge-base documents (and who can only search them) — see
routers/knowledge_base.py. A team leader can only ever file something under their own team
(never company-wide, never another team's, regardless of what the request asks for); a team
member can't upload at all; a restricted admin needs the "manage_knowledge_base" permission.
Also covers the typed-text/PDF and voice-transcription-to-text upload paths added alongside the
original file upload."""
import io

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.database import Base
from app.models import KnowledgeDocument, Team, User
from app.routers import knowledge_base
from app.schemas import KnowledgeDocumentUpdate


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


def _media_file(name: str, content_type: str, content: bytes = b"fake-media-bytes") -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name, headers=Headers({"content-type": content_type}))


def _upload(
    db,
    user,
    title,
    description=None,
    team_id=None,
    file=None,
    text_content=None,
    body_html=None,
    save_as="txt",
    voice=None,
    voice_duration_seconds=None,
):
    """Wraps upload_document with every Form/File param given explicitly — calling a FastAPI
    endpoint function directly (bypassing real request dependency injection) means an omitted
    Form/File param keeps its literal `Form(...)`/`File(...)` marker object instead of resolving
    to the value a real request would give it."""
    return knowledge_base.upload_document(
        db=db,
        user=user,
        title=title,
        description=description,
        team_id=team_id,
        file=file,
        text_content=text_content,
        body_html=body_html,
        save_as=save_as,
        voice=voice,
        voice_duration_seconds=voice_duration_seconds,
    )


def test_team_leader_upload_is_always_scoped_to_their_own_team_regardless_of_request(db):
    alpha = _team(db, "Alpha")
    bravo = _team(db, "Bravo")
    leader = User(id=1, username="leader1", role="team_leader", team_id=alpha.id)

    out = _upload(db, leader, "Cracked insulator report", team_id=bravo.id, file=_file())  # attempted — must be ignored
    assert out.team_id == alpha.id


def test_team_member_cannot_upload(db):
    alpha = _team(db, "Alpha")
    member = User(id=2, username="member1", role="team_member", team_id=alpha.id)
    with pytest.raises(HTTPException) as exc:
        _upload(db, member, "x", file=_file())
    assert exc.value.status_code == 403


def test_restricted_admin_without_permission_cannot_upload(db):
    admin = User(id=3, username="ltd_admin", role="admin", is_super_admin=False, permissions_csv="manage_towers")
    with pytest.raises(HTTPException) as exc:
        _upload(db, admin, "x", file=_file())
    assert exc.value.status_code == 403


def test_restricted_admin_with_permission_can_upload_company_wide(db):
    admin = User(id=4, username="kb_admin", role="admin", is_super_admin=False, permissions_csv="manage_knowledge_base")
    out = _upload(db, admin, "Safety bulletin", file=_file())
    assert out.team_id is None
    assert out.team_name is None


def test_super_admin_can_upload_to_any_team(db):
    alpha = _team(db, "Alpha")
    admin = User(id=5, username="admin", role="admin", is_super_admin=True)
    out = _upload(db, admin, "x", team_id=alpha.id, file=_file())
    assert out.team_id == alpha.id
    assert out.team_name == "Alpha"


def test_uploaded_document_has_extracted_text_and_is_findable(db):
    admin = User(id=6, username="admin", role="admin", is_super_admin=True)
    out = _upload(db, admin, "x", file=_file(content=b"a very unique phrase here"))
    assert out.has_text is True
    row = db.get(KnowledgeDocument, out.id)
    assert "unique phrase" in row.extracted_text


def test_team_leader_can_delete_their_own_teams_document_but_not_a_shared_one(db):
    alpha = _team(db, "Alpha")
    leader = User(id=7, username="leader1", role="team_leader", team_id=alpha.id)
    own_doc = _upload(db, leader, "own", file=_file())

    admin = User(id=8, username="admin", role="admin", is_super_admin=True)
    shared_doc = _upload(db, admin, "shared", file=_file())

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
    _upload(db, admin, "alpha-only", team_id=alpha.id, file=_file())
    _upload(db, admin, "bravo-only", team_id=bravo.id, file=_file())
    _upload(db, admin, "shared", file=_file())

    leader_alpha = User(id=10, username="leader_a", role="team_leader", team_id=alpha.id)
    titles = {d.title for d in knowledge_base.list_documents(db=db, user=leader_alpha)}
    assert titles == {"alpha-only", "shared"}

    titles_admin = {d.title for d in knowledge_base.list_documents(db=db, user=admin)}
    assert titles_admin == {"alpha-only", "bravo-only", "shared"}


def test_typed_text_is_saved_as_a_real_txt_file(db):
    admin = User(id=11, username="admin", role="admin", is_super_admin=True)
    out = _upload(db, admin, "Typed policy note", text_content="Always wear arc-flash gear.", save_as="txt")
    assert out.content_type == "text/plain"
    row = db.get(KnowledgeDocument, out.id)
    assert row.extracted_text == "Always wear arc-flash gear."
    assert (knowledge_base.settings.knowledge_base_dir / row.file_path).read_text() == "Always wear arc-flash gear."


def test_typed_text_is_saved_as_a_real_pdf_file(db):
    admin = User(id=12, username="admin", role="admin", is_super_admin=True)
    out = _upload(db, admin, "Typed policy note", text_content="Always wear arc-flash gear.", save_as="pdf")
    assert out.content_type == "application/pdf"
    row = db.get(KnowledgeDocument, out.id)
    pdf_bytes = (knowledge_base.settings.knowledge_base_dir / row.file_path).read_bytes()
    assert pdf_bytes.startswith(b"%PDF")
    # The raw text is kept as-is for search even though the stored file is now a PDF.
    assert row.extracted_text == "Always wear arc-flash gear."


def test_cannot_provide_both_a_file_and_typed_text(db):
    admin = User(id=13, username="admin", role="admin", is_super_admin=True)
    with pytest.raises(HTTPException) as exc:
        _upload(db, admin, "x", file=_file(), text_content="some text")
    assert exc.value.status_code == 400


def test_must_provide_either_a_file_or_text(db):
    admin = User(id=14, username="admin", role="admin", is_super_admin=True)
    with pytest.raises(HTTPException) as exc:
        _upload(db, admin, "x")
    assert exc.value.status_code == 400


def test_transcribe_endpoint_requires_manage_permission(db):
    import asyncio

    member = User(id=15, username="member1", role="team_member")
    audio = UploadFile(file=io.BytesIO(b"fake-audio"), filename="note.webm", headers=Headers({"content-type": "audio/webm"}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(knowledge_base.transcribe_for_knowledge_base(file=audio, user=member))
    assert exc.value.status_code == 403


def test_transcribe_endpoint_rejects_unsupported_audio_type(db):
    import asyncio

    leader = User(id=16, username="leader1", role="team_leader", team_id=1)
    audio = UploadFile(file=io.BytesIO(b"fake"), filename="note.xyz", headers=Headers({"content-type": "application/octet-stream"}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(knowledge_base.transcribe_for_knowledge_base(file=audio, user=leader))
    assert exc.value.status_code == 400


def _audio(name="note.webm", content=b"fake-audio-bytes") -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name, headers=Headers({"content-type": "audio/webm"}))


def test_voice_recording_is_kept_alongside_a_composed_document(db):
    admin = User(id=17, username="admin", role="admin", is_super_admin=True)
    out = _upload(
        db,
        admin,
        "Voice incident note",
        text_content="We found a cracked insulator during the storm.",
        save_as="txt",
        voice=_audio(),
        voice_duration_seconds=12.5,
    )
    assert out.has_voice is True
    row = db.get(KnowledgeDocument, out.id)
    assert row.voice_path is not None
    assert (knowledge_base.settings.knowledge_base_dir / row.voice_path).read_bytes() == b"fake-audio-bytes"
    assert row.voice_duration_seconds == 12.5


def test_file_upload_never_gets_a_voice_attachment_even_if_one_is_sent(db):
    admin = User(id=18, username="admin", role="admin", is_super_admin=True)
    out = _upload(db, admin, "Uploaded report", file=_file(), voice=_audio())
    assert out.has_voice is False
    assert out.is_composed is False


def test_uploaded_file_document_cannot_have_its_body_text_edited(db):
    admin = User(id=19, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "Uploaded report", file=_file())
    with pytest.raises(HTTPException) as exc:
        knowledge_base.update_document(doc.id, KnowledgeDocumentUpdate(body_text="new text"), db=db, user=admin)
    assert exc.value.status_code == 400


def test_composed_document_body_text_edit_rerenders_the_file(db):
    admin = User(id=20, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "Typed note", text_content="original text", save_as="txt")
    old_path = knowledge_base.settings.knowledge_base_dir / db.get(KnowledgeDocument, doc.id).file_path

    updated = knowledge_base.update_document(
        doc.id, KnowledgeDocumentUpdate(body_text="corrected text"), db=db, user=admin
    )
    row = db.get(KnowledgeDocument, doc.id)
    assert row.extracted_text == "corrected text"
    assert not old_path.exists()  # old file replaced, not left orphaned
    assert (knowledge_base.settings.knowledge_base_dir / row.file_path).read_text() == "corrected text"
    assert updated.has_text is True


def test_composed_document_can_switch_format_on_edit(db):
    admin = User(id=21, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "Typed note", text_content="original text", save_as="txt")
    updated = knowledge_base.update_document(
        doc.id, KnowledgeDocumentUpdate(body_text="original text", save_as="pdf"), db=db, user=admin
    )
    assert updated.content_type == "application/pdf"


def test_editing_title_and_description_works_for_any_document_type(db):
    admin = User(id=22, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "Original title", file=_file())
    updated = knowledge_base.update_document(
        doc.id, KnowledgeDocumentUpdate(title="New title", description="New description"), db=db, user=admin
    )
    assert updated.title == "New title"
    assert updated.description == "New description"


def test_team_leader_can_edit_their_own_teams_document_but_not_a_shared_one(db):
    alpha = _team(db, "Alpha")
    leader = User(id=23, username="leader1", role="team_leader", team_id=alpha.id)
    own_doc = _upload(db, leader, "own", file=_file())

    admin = User(id=24, username="admin", role="admin", is_super_admin=True)
    shared_doc = _upload(db, admin, "shared", file=_file())

    updated = knowledge_base.update_document(own_doc.id, KnowledgeDocumentUpdate(title="Edited"), db=db, user=leader)
    assert updated.title == "Edited"

    with pytest.raises(HTTPException) as exc:
        knowledge_base.update_document(shared_doc.id, KnowledgeDocumentUpdate(title="Hijacked"), db=db, user=leader)
    assert exc.value.status_code == 403


def test_get_document_detail_includes_extracted_text_and_respects_scoping(db):
    alpha = _team(db, "Alpha")
    bravo = _team(db, "Bravo")
    admin = User(id=25, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "Bravo report", team_id=bravo.id, file=_file(content=b"some unique bravo content"))

    detail = knowledge_base.get_document(doc.id, db=db, user=admin)
    assert "unique bravo content" in detail.extracted_text

    leader_alpha = User(id=26, username="leader_a", role="team_leader", team_id=alpha.id)
    with pytest.raises(HTTPException) as exc:
        knowledge_base.get_document(doc.id, db=db, user=leader_alpha)
    assert exc.value.status_code == 403


def test_download_defaults_to_attachment_disposition(db):
    admin = User(id=27, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "x", file=_file())
    response = knowledge_base.download_document(doc.id, db=db, user=admin)
    assert response.headers["content-disposition"].startswith("attachment")


def test_view_inline_true_uses_inline_disposition_so_the_browser_renders_it(db):
    """The actual bug report: clicking "view" downloaded the PDF instead of showing it, because
    FileResponse defaults to attachment — which a browser also honors inside an <iframe>, not just
    for a top-level navigation. inline=true is what DocumentPreviewDialog's viewer passes."""
    admin = User(id=28, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "x", file=_file())
    response = knowledge_base.download_document(doc.id, inline=True, db=db, user=admin)
    assert response.headers["content-disposition"].startswith("inline")


def test_image_and_video_files_can_be_uploaded_as_documents_directly(db):
    """A photo or a walkthrough clip can be the whole reference — not just something a report
    links out to — so these need to be accepted as the primary file, not just rejected as an
    unsupported type."""
    admin = User(id=29, username="admin", role="admin", is_super_admin=True)
    image_doc = _upload(db, admin, "Site photo", file=_media_file("crack.jpg", "image/jpeg"))
    assert image_doc.content_type == "image/jpeg"

    video_doc = _upload(db, admin, "Walkthrough clip", file=_media_file("walk.mp4", "video/mp4"))
    assert video_doc.content_type == "video/mp4"

    audio_doc = _upload(db, admin, "Briefing recording", file=_media_file("brief.mp3", "audio/mpeg"))
    assert audio_doc.content_type == "audio/mpeg"


def test_rich_text_body_is_sanitized_before_it_is_ever_stored(db):
    """The editor's toolbar could never produce a <script> tag or an onerror handler — anything
    like that in the request is either a bug or an attempted stored-XSS, so it must never survive
    into body_html (which gets rendered back to every other viewer as raw HTML)."""
    admin = User(id=30, username="admin", role="admin", is_super_admin=True)
    malicious = '<p>Site note</p><script>alert(1)</script><img src="x" onerror="alert(1)">'
    out = _upload(db, admin, "Rich note", body_html=malicious)
    row = db.get(KnowledgeDocument, out.id)
    assert "<script" not in row.body_html
    assert "onerror" not in row.body_html
    assert "<p>Site note</p>" in row.body_html
    assert out.is_composed is True


def test_rich_text_body_populates_plain_text_for_search(db):
    admin = User(id=31, username="admin", role="admin", is_super_admin=True)
    out = _upload(db, admin, "Rich note", body_html="<p>We found a <b>unique cracked</b> insulator</p>")
    row = db.get(KnowledgeDocument, out.id)
    assert "unique cracked" in row.extracted_text
    assert "<b>" not in row.extracted_text


def test_rich_text_body_can_be_saved_as_pdf(db):
    admin = User(id=32, username="admin", role="admin", is_super_admin=True)
    out = _upload(db, admin, "Rich note", body_html="<p>Bold <b>text</b></p>", save_as="pdf")
    assert out.content_type == "application/pdf"
    row = db.get(KnowledgeDocument, out.id)
    pdf_bytes = (knowledge_base.settings.knowledge_base_dir / row.file_path).read_bytes()
    assert pdf_bytes.startswith(b"%PDF")


def test_cannot_provide_both_rich_text_and_typed_text(db):
    admin = User(id=33, username="admin", role="admin", is_super_admin=True)
    with pytest.raises(HTTPException) as exc:
        _upload(db, admin, "x", text_content="plain", body_html="<p>rich</p>")
    assert exc.value.status_code == 400


def test_editing_a_composed_document_with_rich_text_replaces_the_plain_text_body(db):
    admin = User(id=34, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "Typed note", text_content="original plain text", save_as="txt")
    assert db.get(KnowledgeDocument, doc.id).body_html is None

    updated = knowledge_base.update_document(
        doc.id, KnowledgeDocumentUpdate(body_html="<p>now <b>rich</b></p>"), db=db, user=admin
    )
    row = db.get(KnowledgeDocument, doc.id)
    assert row.body_html == "<p>now <b>rich</b></p>"
    assert "rich" in row.extracted_text
    assert updated.has_text is True

    # And editing back with plain body_text clears the stale rich HTML rather than leaving it
    # to desync from what extracted_text/the file now say.
    knowledge_base.update_document(doc.id, KnowledgeDocumentUpdate(body_text="back to plain"), db=db, user=admin)
    assert db.get(KnowledgeDocument, doc.id).body_html is None


def test_get_document_detail_includes_body_html(db):
    admin = User(id=35, username="admin", role="admin", is_super_admin=True)
    doc = _upload(db, admin, "Rich note", body_html="<p>hello</p>")
    detail = knowledge_base.get_document(doc.id, db=db, user=admin)
    assert detail.body_html == "<p>hello</p>"


def _inline_image(name="pic.png", content_type="image/png", content=b"fake-png-bytes") -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name, headers=Headers({"content-type": content_type}))


def test_inline_image_upload_requires_manage_permission(db):
    member = User(id=36, username="member1", role="team_member")
    with pytest.raises(HTTPException) as exc:
        knowledge_base.upload_inline_image(image=_inline_image(), user=member)
    assert exc.value.status_code == 403


def test_inline_image_upload_rejects_unsupported_type(db):
    admin = User(id=37, username="admin", role="admin", is_super_admin=True)
    with pytest.raises(HTTPException) as exc:
        knowledge_base.upload_inline_image(image=_inline_image(name="doc.pdf", content_type="application/pdf"), user=admin)
    assert exc.value.status_code == 400


def test_inline_image_upload_and_fetch_round_trip(db):
    admin = User(id=38, username="admin", role="admin", is_super_admin=True)
    out = knowledge_base.upload_inline_image(image=_inline_image(content=b"real-bytes-here"), user=admin)
    filename = out["url"].rsplit("/", 1)[-1]
    response = knowledge_base.get_inline_image(filename, user=admin)
    assert (knowledge_base.settings.knowledge_base_dir / "inline" / filename).read_bytes() == b"real-bytes-here"
    assert response.path.name == filename


def test_inline_image_fetch_rejects_path_traversal_filenames(db):
    admin = User(id=39, username="admin", role="admin", is_super_admin=True)
    with pytest.raises(HTTPException) as exc:
        knowledge_base.get_inline_image("../../etc/passwd", user=admin)
    assert exc.value.status_code == 404
