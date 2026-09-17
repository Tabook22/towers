"""A voice recording is always tied to the exact insulator (Position) it was recorded for — never
shared with, or leaked onto, any other position on the same visit. This is the guarantee the user
explicitly asked to be sure of, mirroring how per-position images already work."""
import asyncio
import io

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers
from fastapi import UploadFile, HTTPException

from app.database import Base
from app.models import Position, Tower, User, Visit
from app.routers import positions


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def isolated_voice_notes_dir(tmp_path, monkeypatch):
    # Never let a test write into the real storage/voice_notes directory.
    monkeypatch.setattr(positions.settings, "voice_notes_dir", tmp_path)


def make_two_positions(db) -> tuple[Position, Position]:
    tower = Tower(tower_id="ARSD 92", voltage="132 kV", area="Dufar")
    db.add(tower)
    db.flush()
    visit = Visit(tower_id=tower.id)
    db.add(visit)
    db.flush()
    # S1/S2 are genuinely distinct positions (see models.Position's unique constraint on
    # visit_id+ohl+phase+string) — tower_proximity ("Outer"/"Inner") just labels which one.
    outer = Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", tower_proximity="Outer")
    inner = Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S2", tower_proximity="Inner")
    db.add_all([outer, inner])
    db.commit()
    db.refresh(outer)
    db.refresh(inner)
    outer.visit = visit
    inner.visit = visit
    return outer, inner


def _admin_user() -> User:
    return User(id=1, username="admin", role="admin")


def _upload_file(name="note.webm", content_type="audio/webm", data=b"fake-audio-bytes") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


def test_voice_note_is_stored_only_on_its_own_position(db):
    outer, inner = make_two_positions(db)
    user = _admin_user()

    asyncio.run(
        positions.add_voice_note(
            position_id=outer.id, file=_upload_file(), duration_seconds=12.5, db=db, user=user
        )
    )

    db.refresh(outer)
    db.refresh(inner)
    assert outer.voice_note_path is not None
    assert outer.voice_note_duration_seconds == 12.5
    # The other insulator on the very same visit must be completely untouched.
    assert inner.voice_note_path is None
    assert inner.voice_note_duration_seconds is None


def test_reuploading_replaces_this_positions_recording_and_clears_its_transcript(db):
    outer, _inner = make_two_positions(db)
    user = _admin_user()

    asyncio.run(positions.add_voice_note(position_id=outer.id, file=_upload_file(), duration_seconds=None, db=db, user=user))
    db.refresh(outer)
    outer.voice_note_transcript = "first recording, transcribed"
    db.commit()
    first_path = outer.voice_note_path

    asyncio.run(
        positions.add_voice_note(position_id=outer.id, file=_upload_file(name="note2.webm"), duration_seconds=None, db=db, user=user)
    )
    db.refresh(outer)

    assert outer.voice_note_path != first_path
    assert outer.voice_note_transcript is None
    assert not (positions.settings.voice_notes_dir / first_path).exists()  # old file cleaned up


def test_transcribe_fills_transcript_without_touching_inspector_notes(db, monkeypatch):
    outer, _inner = make_two_positions(db)
    outer.inspector_notes = "typed note from the field — must survive"
    db.commit()
    user = _admin_user()

    asyncio.run(positions.add_voice_note(position_id=outer.id, file=_upload_file(), duration_seconds=None, db=db, user=user))
    monkeypatch.setattr(positions, "transcribe_audio", lambda raw, filename, content_type: ("hairline crack near clamp", None))

    positions.transcribe_voice_note(position_id=outer.id, db=db, user=user)
    db.refresh(outer)

    assert outer.voice_note_transcript == "hairline crack near clamp"
    assert outer.inspector_notes == "typed note from the field — must survive"


def test_deleting_one_positions_voice_note_leaves_the_others_recording_alone(db):
    outer, inner = make_two_positions(db)
    user = _admin_user()

    asyncio.run(positions.add_voice_note(position_id=outer.id, file=_upload_file(), duration_seconds=None, db=db, user=user))
    asyncio.run(positions.add_voice_note(position_id=inner.id, file=_upload_file(), duration_seconds=None, db=db, user=user))
    db.refresh(outer)
    db.refresh(inner)
    inner_path = inner.voice_note_path

    positions.delete_voice_note(position_id=outer.id, db=db, user=user)
    db.refresh(outer)
    db.refresh(inner)

    assert outer.voice_note_path is None
    assert inner.voice_note_path == inner_path
    assert (positions.settings.voice_notes_dir / inner_path).exists()


def test_team_member_on_a_different_team_cannot_reach_this_visits_positions(db):
    outer, _inner = make_two_positions(db)
    outer.visit.team_id = 7
    db.commit()
    other_team_user = User(id=2, username="member2", role="team_member", team_id=9)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            positions.add_voice_note(position_id=outer.id, file=_upload_file(), duration_seconds=None, db=db, user=other_team_user)
        )
    assert exc.value.status_code == 403
