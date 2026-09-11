"""Field-night windows and GPS stay merging."""
import datetime as dt
from types import SimpleNamespace

from app.services.movement import (
    FIELD_TZ,
    _merge_stays,
    _stays_for_pings,
    current_field_date,
    hour_window,
    shift_window,
)


def test_shift_window_is_18_to_18_oman():
    day = dt.date(2026, 9, 10)
    start, end = shift_window(day)
    # 18:00 Oman = 14:00 UTC (UTC+4, no DST).
    assert start == dt.datetime(2026, 9, 10, 14, 0, 0)
    assert end == dt.datetime(2026, 9, 11, 14, 0, 0)


def test_hour_window_wraps_past_midnight():
    day = dt.date(2026, 9, 10)
    start, end = hour_window(day, 22, 5)
    assert start == dt.datetime(2026, 9, 10, 18, 0, 0)  # 22:00 Oman
    assert end == dt.datetime(2026, 9, 11, 1, 0, 0)  # 05:00 Oman


def test_current_field_date_before_6pm_is_yesterday():
    afternoon = dt.datetime(2026, 9, 11, 14, 0, tzinfo=FIELD_TZ)  # 2pm Oman
    assert current_field_date(afternoon) == dt.date(2026, 9, 10)
    evening = dt.datetime(2026, 9, 11, 19, 0, tzinfo=FIELD_TZ)
    assert current_field_date(evening) == dt.date(2026, 9, 11)


def test_merge_stays_collapses_same_tower():
    t0 = dt.datetime(2026, 9, 10, 18, 0)
    t1 = dt.datetime(2026, 9, 10, 18, 10)
    t2 = dt.datetime(2026, 9, 10, 18, 12)
    t3 = dt.datetime(2026, 9, 10, 18, 40)
    merged = _merge_stays(
        [
            {
                "tower_pk": 1,
                "tower_id": "T1",
                "arrived_at": t0,
                "departed_at": t1,
                "minutes": 10,
                "visit_id": None,
                "visit_status": None,
            },
            {
                "tower_pk": 1,
                "tower_id": "T1",
                "arrived_at": t2,
                "departed_at": t3,
                "minutes": 28,
                "visit_id": 9,
                "visit_status": "draft",
            },
        ]
    )
    assert len(merged) == 1
    assert merged[0]["arrived_at"] == t0
    assert merged[0]["departed_at"] == t3
    assert merged[0]["visit_id"] == 9


def test_merge_stays_keeps_return_visit_hours_later():
    t0 = dt.datetime(2026, 9, 10, 18, 0)
    later = _merge_stays(
        [
            {
                "tower_pk": 1,
                "tower_id": "T1",
                "arrived_at": t0,
                "departed_at": t0 + dt.timedelta(minutes=10),
                "minutes": 10,
                "visit_id": None,
                "visit_status": None,
            },
            {
                "tower_pk": 1,
                "tower_id": "T1",
                "arrived_at": t0 + dt.timedelta(hours=2),
                "departed_at": t0 + dt.timedelta(hours=2, minutes=15),
                "minutes": 15,
                "visit_id": None,
                "visit_status": None,
            },
        ]
    )
    assert len(later) == 2


def test_stays_split_when_crew_moves_to_another_tower():
    towers = [
        SimpleNamespace(id=1, tower_id="T1", area="A", latitude=17.0, longitude=54.0),
        SimpleNamespace(id=2, tower_id="T2", area="A", latitude=17.001, longitude=54.02),
    ]
    t0 = dt.datetime(2026, 9, 10, 18, 0)
    pings = [
        SimpleNamespace(latitude=17.0, longitude=54.0, recorded_at=t0),
        SimpleNamespace(latitude=17.0, longitude=54.0, recorded_at=t0 + dt.timedelta(minutes=8)),
        SimpleNamespace(latitude=17.001, longitude=54.02, recorded_at=t0 + dt.timedelta(minutes=20)),
        SimpleNamespace(latitude=17.001, longitude=54.02, recorded_at=t0 + dt.timedelta(minutes=30)),
    ]
    stays = _stays_for_pings(pings, towers, {}, user_id=1)
    assert [s["tower_id"] for s in stays] == ["T1", "T2"]
