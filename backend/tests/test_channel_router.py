"""Video/file attachments on the night channel, and the "one open company channel" read model —
every signed-in user can see every team's channel traffic (routers/channel.tracking_channel_feed),
even though posting stays scoped to your own team (require_team_read)."""
import asyncio
import datetime as dt
import io

import pytest
from fastapi import HTTPException
from fastapi import UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.database import Base
from app.models import Team, TeamChannelMessage, User
from app.routers import channel


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _team_member(team_id: int, user_id: int = 10) -> User:
    return User(id=user_id, username=f"crew{user_id}", role="team_member", team_id=team_id)


def _admin() -> User:
    return User(id=1, username="admin", role="admin", is_super_admin=True)


def test_post_channel_video_sets_has_video(db, tmp_path, monkeypatch):
    monkeypatch.setattr(channel.settings, "channel_dir", tmp_path)
    team = Team(name="Alpha")
    db.add(team)
    db.commit()

    video = UploadFile(file=io.BytesIO(b"fake-mp4-bytes"), filename="clip.mp4", headers=Headers({"content-type": "video/mp4"}))
    out = asyncio.run(
        channel.post_channel_video(
            team_id=team.id,
            file=video,
            kind="note",
            body="",
            duration_seconds=4.2,
            tower_id=None,
            latitude=None,
            longitude=None,
            db=db,
            user=_team_member(team.id),
        )
    )
    assert out.has_video is True
    assert out.body == "Video"
    row = db.get(TeamChannelMessage, out.id)
    assert (tmp_path / row.video_path).exists()


def test_post_channel_video_rejects_wrong_type(db, tmp_path, monkeypatch):
    monkeypatch.setattr(channel.settings, "channel_dir", tmp_path)
    team = Team(name="Alpha")
    db.add(team)
    db.commit()
    bad = UploadFile(file=io.BytesIO(b"not a video"), filename="note.txt", headers=Headers({"content-type": "text/plain"}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            channel.post_channel_video(
                team_id=team.id, file=bad, kind="note", body="", duration_seconds=None,
                tower_id=None, latitude=None, longitude=None, db=db, user=_team_member(team.id),
            )
        )
    assert exc.value.status_code == 400


def test_post_channel_file_sets_has_file_and_size(db, tmp_path, monkeypatch):
    monkeypatch.setattr(channel.settings, "channel_dir", tmp_path)
    team = Team(name="Alpha")
    db.add(team)
    db.commit()

    payload = b"%PDF-1.4 fake pdf bytes"
    doc = UploadFile(file=io.BytesIO(payload), filename="permit.pdf", headers=Headers({"content-type": "application/pdf"}))
    out = asyncio.run(
        channel.post_channel_file(
            team_id=team.id, file=doc, kind="note", body="",
            tower_id=None, latitude=None, longitude=None, db=db, user=_team_member(team.id),
        )
    )
    assert out.has_file is True
    assert out.file_name == "permit.pdf"
    assert out.file_size == len(payload)


_DAY = dt.date(2026, 9, 20)


def test_tracking_channel_feed_is_open_to_any_authenticated_user(db):
    team_a = Team(name="Alpha")
    team_b = Team(name="Bravo")
    db.add_all([team_a, team_b])
    db.commit()
    db.add_all(
        [
            TeamChannelMessage(team_id=team_a.id, field_date=_DAY, kind="note", body="from alpha"),
            TeamChannelMessage(team_id=team_b.id, field_date=_DAY, kind="note", body="from bravo"),
        ]
    )
    db.commit()

    # A team_member of Alpha (not admin/reviewer) can still see Bravo's messages too.
    viewer = _team_member(team_a.id)
    rows = channel.tracking_channel_feed(field_date=_DAY, team_id=None, limit=150, db=db, _viewer=viewer)
    bodies = {r.body for r in rows}
    assert "from alpha" in bodies
    assert "from bravo" in bodies


def test_channel_unread_count(db):
    team = Team(name="Alpha")
    db.add(team)
    db.commit()
    m1 = TeamChannelMessage(team_id=team.id, field_date=_DAY, kind="note", body="one")
    db.add(m1)
    db.commit()
    m2 = TeamChannelMessage(team_id=team.id, field_date=_DAY, kind="note", body="two")
    db.add(m2)
    db.commit()

    out = channel.channel_unread_count(after_id=0, field_date=_DAY, db=db, _viewer=_admin())
    assert out.unread_count == 2
    assert out.latest_id == m2.id

    out2 = channel.channel_unread_count(after_id=m1.id, field_date=_DAY, db=db, _viewer=_admin())
    assert out2.unread_count == 1
