"""Next-tower planner: walk the line in the crew's travel direction, finish open visits first."""
from app.services.next_towers import Candidate, order_along_line, plan_stops, travel_minutes


def _line(*ids: str) -> list[Candidate]:
    # West → east along lon 54.00, 54.01, ...
    out = []
    for i, name in enumerate(ids):
        out.append(
            Candidate(
                id=i + 1,
                tower_id=name,
                area="Dufar",
                latitude=17.0,
                longitude=54.0 + i * 0.02,
                status="pending",
                visit_id=None,
            )
        )
    return out


def test_travel_minutes_dirt_track():
    assert travel_minutes(0) == 0
    assert travel_minutes(35) == 60  # 35 km at 35 km/h


def test_order_walks_east_from_the_west_end():
    towers = _line("T50", "T51", "T52", "T53", "T54")
    points = [(c.latitude, c.longitude) for c in towers]
    origin = (17.0, 53.99)
    ordered = order_along_line(origin, towers, points, heading_sign=1.0)
    assert [c.tower_id for c in ordered] == ["T50", "T51", "T52", "T53", "T54"]


def test_order_walks_west_when_heading_west():
    towers = _line("T50", "T51", "T52", "T53", "T54")
    points = [(c.latitude, c.longitude) for c in towers]
    origin = (17.0, 54.09)  # east of T54
    ordered = order_along_line(origin, towers, points, heading_sign=-1.0)
    assert [c.tower_id for c in ordered] == ["T54", "T53", "T52", "T51", "T50"]


def test_in_progress_comes_before_pending_along_the_line():
    towers = _line("T50", "T51", "T52")
    towers[2].status = "in_progress"
    towers[2].visit_id = 9
    points = [(c.latitude, c.longitude) for c in towers]
    origin = (17.0, 54.0)
    stops = plan_stops(origin, towers, points, heading_sign=1.0, limit=5, dwell_min=25)
    assert stops[0]["tower_id"] == "T52"
    assert stops[0]["visit_id"] == 9
    assert stops[0]["reason"].startswith("Finish")
    assert [s["tower_id"] for s in stops[1:]] == ["T50", "T51"]


def test_claimed_tower_leads_the_plan():
    towers = _line("T50", "T51", "T52")
    points = [(c.latitude, c.longitude) for c in towers]
    origin = (17.0, 54.0)
    stops = plan_stops(origin, towers, points, heading_sign=1.0, limit=5, dwell_min=25, lead=[towers[2]])
    assert stops[0]["tower_id"] == "T52"
    assert "claimed" in stops[0]["reason"].lower()


def test_plan_caps_at_limit_and_accumulates_time():
    towers = _line("A", "B", "C", "D", "E", "F")
    points = [(c.latitude, c.longitude) for c in towers]
    origin = (17.0, 54.0)
    stops = plan_stops(origin, towers, points, heading_sign=1.0, limit=3, dwell_min=20)
    assert len(stops) == 3
    assert stops[0]["cumulative_minutes"] >= stops[0]["dwell_minutes"]
    assert stops[2]["cumulative_minutes"] > stops[0]["cumulative_minutes"]
