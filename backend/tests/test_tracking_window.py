"""The Field Tracker's default 'live' view must bound a still-open TrackingMission to the
requested field night, so an admin who forgot to tap New mission for days doesn't get the whole
accumulated multi-day path dumped onto today's board. An explicitly viewed *closed* mission keeps
its own full span regardless — nothing is deleted, this only bounds the default live view."""
import datetime as dt

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import TrackingMission
from app.routers.tracking import _resolve_report_window
from app.services.movement import shift_window


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def test_open_mission_from_a_prior_field_night_is_clamped_to_today():
    engine = _engine()
    with Session(engine) as db:
        today = dt.date(2026, 9, 14)
        two_nights_ago = today - dt.timedelta(days=2)
        old_start, _ = shift_window(two_nights_ago)
        row = TrackingMission(label="Mission 4", started_at=old_start, ended_at=None)
        db.add(row)
        db.commit()

        day, start, end = _resolve_report_window(db, today, None, None, row.id, None, None)

        today_start, _ = shift_window(today)
        assert start == today_start, "an old still-open mission must not leak yesterday's path into today's board"
        assert start > old_start


def test_open_mission_started_today_is_unaffected():
    engine = _engine()
    with Session(engine) as db:
        today = dt.date(2026, 9, 14)
        today_start, _ = shift_window(today)
        started_at = today_start + dt.timedelta(hours=2)
        row = TrackingMission(label="Mission 5", started_at=started_at, ended_at=None)
        db.add(row)
        db.commit()

        _day, start, _end = _resolve_report_window(db, today, None, None, row.id, None, None)

        assert start == started_at, "clamping must never move the start later than when the mission actually began"


def test_closed_mission_keeps_its_full_span_regardless_of_on_date():
    engine = _engine()
    with Session(engine) as db:
        two_nights_ago = dt.date(2026, 9, 12)
        started_at, ended_at = shift_window(two_nights_ago)
        row = TrackingMission(label="Mission 3", started_at=started_at, ended_at=ended_at)
        db.add(row)
        db.commit()

        # Even if on_date is "today" (e.g. a stale query), a *closed* mission is an explicit
        # historical pick — it must never be clamped, or Previous missions would lose data.
        today = dt.date(2026, 9, 14)
        _day, start, end = _resolve_report_window(db, today, None, None, row.id, None, None)

        assert start == started_at
        assert end == ended_at
