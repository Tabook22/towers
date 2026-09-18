"""Official ("OETC") report generation: a team's whole campaign by default, one particular tower's
visits only when tower_id is set alongside team_id, or tower_id alone ("report by tower" — the team
is resolved from the tower's current assignment so the caller doesn't have to know it) — see
routers/reports.oetc_line_report and services/oetc_report.build_oetc_line_report_context."""
import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, LineInspectionReport, Position, Team, Tower, User, Visit
from app.routers.reports import oetc_line_report, redownload_oetc_line_report
from app.schemas import LineInspectionReportRequest
from app.services.oetc_report import build_oetc_line_report_context


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def _seed(db: Session):
    team = Team(name="Alpha")
    tower_a = Tower(tower_id="T-1", voltage="132")
    tower_b = Tower(tower_id="T-2", voltage="132")
    db.add_all([team, tower_a, tower_b])
    db.flush()
    tower_a.assigned_team_id = team.id
    tower_b.assigned_team_id = team.id

    visit_a = Visit(tower_id=tower_a.id, team_id=team.id, inspection_date=dt.date(2026, 9, 1))
    visit_b = Visit(tower_id=tower_b.id, team_id=team.id, inspection_date=dt.date(2026, 9, 2))
    db.add_all([visit_a, visit_b])
    db.flush()

    db.add_all(
        [
            Position(visit_id=visit_a.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", installed=True),
            Position(visit_id=visit_b.id, ohl="OHL1", phase="Y", string="S1", direction="Ashoor", installed=True),
        ]
    )
    db.commit()
    return team, tower_a, tower_b


def test_tower_id_scopes_visits_to_that_tower_only():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0001",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200
        assert response.body  # a real .docx was rendered, not empty

        record = db.query(LineInspectionReport).one()
        assert record.tower_id == tower_a.id


def test_no_visits_for_that_tower_in_range_is_a_clear_400():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 2),
            end_date=dt.date(2026, 9, 2),  # only tower_b was visited that day
            report_number="TEST-0002",
        )
        with pytest.raises(HTTPException) as exc:
            oetc_line_report(payload=payload, db=db, user=admin)
        assert exc.value.status_code == 400
        assert "T-1" in exc.value.detail


def test_omitting_tower_id_covers_the_whole_team_as_before():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0003",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200

        record = db.query(LineInspectionReport).filter_by(report_number="TEST-0003").one()
        assert record.tower_id is None


def test_tower_id_alone_resolves_the_team_from_the_towers_assignment():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=tower_a.id,  # no team_id — "report by tower" from the UI's single dropdown
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0005",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200

        record = db.query(LineInspectionReport).filter_by(report_number="TEST-0005").one()
        assert record.team_id == team.id
        assert record.tower_id == tower_a.id


def test_tower_id_alone_without_a_team_assignment_is_a_clear_400():
    engine = _engine()
    with Session(engine) as db:
        _team, _tower_a, _tower_b = _seed(db)
        unassigned = Tower(tower_id="T-3", voltage="132")
        db.add(unassigned)
        db.commit()
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=unassigned.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0006",
        )
        with pytest.raises(HTTPException) as exc:
            oetc_line_report(payload=payload, db=db, user=admin)
        assert exc.value.status_code == 400
        assert "T-3" in exc.value.detail


def test_tower_id_alone_resolves_the_team_from_the_visit_when_the_tower_itself_is_unassigned():
    """The real-world bug this guards: a crew finishes inspecting a tower, but the tower's catalog
    assignment was since changed or cleared (or was never set — the visit can exist without a
    formal "assign to team" step). "Report by tower" must still find it via the visit's own
    team_id instead of hard-requiring Tower.assigned_team_id."""
    engine = _engine()
    with Session(engine) as db:
        team = Team(name="Alpha")
        unassigned = Tower(tower_id="T-9", voltage="132")  # never assigned in the catalog
        db.add_all([team, unassigned])
        db.flush()
        visit = Visit(tower_id=unassigned.id, team_id=team.id, inspection_date=dt.date(2026, 9, 5), mission_status="completed")
        db.add(visit)
        db.flush()
        db.add(Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor", installed=True))
        db.commit()
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=unassigned.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0009",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)
        assert response.status_code == 200

        record = db.query(LineInspectionReport).filter_by(report_number="TEST-0009").one()
        assert record.team_id == team.id
        assert record.tower_id == unassigned.id


def test_tower_id_alone_still_enforces_the_team_leader_boundary():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, _tower_b = _seed(db)
        other_team = Team(name="Bravo")
        db.add(other_team)
        db.commit()
        leader = User(username="lead-bravo", role="team_leader", team_id=other_team.id, hashed_password="x")
        db.add(leader)
        db.commit()

        # tower_a is assigned to "Alpha", not this leader's own team "Bravo" — resolving the team
        # from the tower must not bypass the same team_leader wall every other report enforces.
        payload = LineInspectionReportRequest(
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0008",
        )
        with pytest.raises(HTTPException) as exc:
            oetc_line_report(payload=payload, db=db, user=leader)
        assert exc.value.status_code == 403


def test_checkbox_glyphs_match_their_checked_state_and_all_four_images_render(tmp_path, monkeypatch):
    """Guards the exact bug a user hit: every checkbox's *visible* glyph (☒/☐) must track its
    w14:checked value — the template used to leave the glyph a static, always-unchecked literal
    even though w14:checked evaluated correctly, so the report always looked empty regardless of
    the real data. Also checks all 4 evidence images (not just one thermal + one visual pick) make
    it into the "Image (Thermal / Visual)" section."""
    import io
    import re
    import zipfile

    from PIL import Image as PILImage

    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "images_dir", tmp_path)

    engine = _engine()
    with Session(engine) as db:
        team, tower_a, _tower_b = _seed(db)
        pos = db.query(Position).join(Visit).filter(Visit.tower_id == tower_a.id).first()
        pos.ohl = "OHL2"
        pos.phase = "Y"
        pos.mount_type = "Tension"
        pos.gs_side = "Tower side"
        pos.insulator_type = "Porcelain"
        pos.string_count = "Double"
        pos.tower_proximity = "Inner"
        pos.pollution_condition = "Heavy"
        pos.thermal_indication = "Dry band"

        for name, color in [
            ("th_full.jpg", (200, 50, 50)),
            ("th_close.jpg", (50, 200, 50)),
            ("rgb_full.jpg", (50, 50, 200)),
            ("rgb_close.jpg", (200, 200, 50)),
        ]:
            (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
            PILImage.new("RGB", (40, 30), color=color).save(tmp_path / name, format="JPEG")
        db.add_all(
            [
                Image(position_id=pos.id, image_type="TH Full", file_path="th_full.jpg"),
                Image(position_id=pos.id, image_type="TH Close", file_path="th_close.jpg"),
                Image(position_id=pos.id, image_type="RGB Full", file_path="rgb_full.jpg"),
                Image(position_id=pos.id, image_type="RGB Close", file_path="rgb_close.jpg"),
            ]
        )
        db.commit()

        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=tower_a.id,
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0010",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)

    with zipfile.ZipFile(io.BytesIO(response.body)) as z:
        xml = z.read("word/document.xml").decode("utf-8")
        media_names = [n for n in z.namelist() if n.startswith("word/media/")]

    # Every checkbox's visible glyph must agree with its own w14:checked value — nowhere in the
    # document, not just the fields this test happens to set.
    checked_pos = 0
    while True:
        start = xml.find("<w:sdt>", checked_pos)
        if start == -1:
            break
        end = xml.find("</w:sdt>", start) + len("</w:sdt>")
        block = xml[start:end]
        checked_m = re.search(r'w14:checked w14:val="(\d)"', block)
        glyph_m = re.search(r"<w:t[^>]*>(.)</w:t>", block)
        assert checked_m and glyph_m, f"malformed checkbox block: {block[:200]}"
        expected_glyph = "☒" if checked_m.group(1) == "1" else "☐"
        assert glyph_m.group(1) == expected_glyph, f"glyph/checked mismatch: {block[:300]}"
        checked_pos = end

    # All four evidence slots actually made it in, as four distinct embedded pictures.
    assert "Thermal (Full)" in xml and "Thermal (Close)" in xml
    assert "Visual (Full)" in xml and "Visual (Close)" in xml
    assert len(media_names) >= 4

    # Laid out as a real 2x2 table (Thermal row, then Visual row; Full column, then Close column)
    # rather than the 4 slots just stacked one under another in a single wide cell.
    thermal_full_idx = xml.find("Thermal (Full)")
    thermal_close_idx = xml.find("Thermal (Close)")
    visual_full_idx = xml.find("Visual (Full)")
    visual_close_idx = xml.find("Visual (Close)")
    assert thermal_full_idx < thermal_close_idx < visual_full_idx < visual_close_idx
    # Each of the 4 image cells spans half the row (gridSpan=2 of the section's 4 grid columns),
    # not the whole width — i.e. two cells side by side per row, not one wide cell per image.
    assert xml.count('<w:gridSpan w:val="2"/>') >= 4


def test_inner_outer_checkbox_renders_checked_from_string_alone_when_never_set_by_hand(tmp_path, monkeypatch):
    """End-to-end version of test_tower_proximity_is_derived_from_string_when_never_recorded_by_hand
    — a real double-string Tension position whose Inner/Outer dropdown was simply never touched
    must still come out of the actual rendered .docx with the right box checked, not blank."""
    import io
    import re
    import zipfile

    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "images_dir", tmp_path)

    engine = _engine()
    with Session(engine) as db:
        team, tower_a, _tower_b = _seed(db)
        pos = db.query(Position).join(Visit).filter(Visit.tower_id == tower_a.id).first()
        pos.mount_type = "Tension"
        pos.string = "S2"
        pos.string_count = "Double"
        pos.tower_proximity = None  # never set by hand — should still derive to "Inner"
        db.commit()

        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            tower_id=tower_a.id,
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0011",
        )
        response = oetc_line_report(payload=payload, db=db, user=admin)

    with zipfile.ZipFile(io.BytesIO(response.body)) as z:
        xml = z.read("word/document.xml").decode("utf-8")

    inner_idx = xml.find("Inner")
    assert inner_idx != -1
    # The checkbox content-control immediately preceding the "Inner" label text.
    block_start = xml.rfind("<w:sdt>", 0, inner_idx)
    block_end = xml.find("</w:sdt>", block_start) + len("</w:sdt>")
    block = xml[block_start:block_end]
    assert re.search(r'w14:checked w14:val="1"', block), f"Inner checkbox not checked: {block[:300]}"


def test_neither_team_nor_tower_is_rejected_by_the_schema():
    with pytest.raises(Exception):
        LineInspectionReportRequest(
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0007",
        )


def test_single_tower_context_names_the_tower_in_line_section_instead_of_the_mission_range():
    from docxtpl import DocxTemplate

    from app.services.oetc_report import TEMPLATE_PATH

    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        team.mission_from = "1"
        team.mission_to = "70"
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            tower_id=tower_a.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="TEST-0004",
        )
        visits = [v for v in db.query(Visit).all() if v.tower_id == tower_a.id]
        tpl = DocxTemplate(str(TEMPLATE_PATH))
        context = build_oetc_line_report_context(tpl, team, visits, payload, tower=tower_a)
        assert context["line_section"] == "T-1"

        context_whole_team = build_oetc_line_report_context(tpl, team, db.query(Visit).all(), payload)
        assert context_whole_team["line_section"] == "1 to 70"


def test_redownload_reproduces_the_same_report_without_touching_the_uniqueness_check():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="REDOWNLOAD-0001",
            prepared_by="Ahmed",
        )
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).filter_by(report_number="REDOWNLOAD-0001").one()

        # Calling redownload twice must not fail on "report number already used" — it never inserts
        # a new row, just re-renders from the one that's already there.
        response1 = redownload_oetc_line_report(report_id=record.id, db=db, user=admin)
        response2 = redownload_oetc_line_report(report_id=record.id, db=db, user=admin)
        assert response1.status_code == 200
        assert response2.status_code == 200
        assert response1.body and response2.body
        assert db.query(LineInspectionReport).count() == 1  # still just the one row


def test_redownload_is_blocked_for_a_team_leader_on_a_different_team():
    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        other_team = Team(name="Bravo")
        db.add(other_team)
        db.commit()
        admin = User(username="admin", role="admin", hashed_password="x")
        leader = User(username="lead-bravo", role="team_leader", team_id=other_team.id, hashed_password="x")
        db.add_all([admin, leader])
        db.commit()

        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="REDOWNLOAD-0002",
        )
        oetc_line_report(payload=payload, db=db, user=admin)
        record = db.query(LineInspectionReport).filter_by(report_number="REDOWNLOAD-0002").one()

        with pytest.raises(HTTPException) as exc:
            redownload_oetc_line_report(report_id=record.id, db=db, user=leader)
        assert exc.value.status_code == 403


def test_grouped_reports_persist_the_sign_off_fields_for_later_redownload():
    from app.routers.reports import _persist_blocks

    class FakeBlock:
        def __init__(self, team, visits, report_number):
            self.team = team
            self.visits = visits
            self.report_number = report_number

    engine = _engine()
    with Session(engine) as db:
        team, tower_a, tower_b = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        visits = db.query(Visit).all()
        block = FakeBlock(team, visits, "GROUPED-0001")
        payload = LineInspectionReportRequest(
            team_id=team.id,
            start_date=dt.date(2026, 9, 1),
            end_date=dt.date(2026, 9, 30),
            report_number="GROUPED-BASE",
            overall_condition="Acceptable",
            prepared_by="Ahmed",
        )
        _persist_blocks(db, [block], admin, payload)

        record = db.query(LineInspectionReport).filter_by(report_number="GROUPED-0001").one()
        assert record.overall_condition == "Acceptable"
        assert record.prepared_by == "Ahmed"


def test_tower_proximity_is_derived_from_string_when_never_recorded_by_hand():
    """The Inner/Outer field is a separate, easy-to-forget dropdown — the app already labels the
    String picker itself "S1 — Outer" / "S2 — Inner" as a fixed convention (see frontend's
    AddPositionBar.STRING_LABELS) precisely so the crew never has to guess, so the report should
    fall back to that same convention rather than showing a blank checkbox just because the second
    field went unfilled. Only meaningful for a double-string Tension position — the only place two
    physical strings actually share one slot."""
    from app.services.oetc_report import _derived_tower_proximity

    outer = Position(ohl="OHL1", phase="R", string="S1", mount_type="Tension", string_count="Double")
    assert _derived_tower_proximity(outer) == "Outer"

    inner = Position(ohl="OHL1", phase="R", string="S2", mount_type="Tension", string_count="Double")
    assert _derived_tower_proximity(inner) == "Inner"


def test_tower_proximity_manual_value_always_wins_over_the_derived_one():
    from app.services.oetc_report import _derived_tower_proximity

    pos = Position(ohl="OHL1", phase="R", string="S1", mount_type="Tension", string_count="Double", tower_proximity="Inner")
    assert _derived_tower_proximity(pos) == "Inner"  # the crew's own read of the hardware, not S1's usual "Outer"


def test_tower_proximity_is_not_derived_outside_double_tension():
    from app.services.oetc_report import _derived_tower_proximity

    suspension = Position(ohl="OHL1", phase="R", string="S1", mount_type="Suspension", string_count="Double")
    assert _derived_tower_proximity(suspension) is None

    single = Position(ohl="OHL1", phase="R", string="S1", mount_type="Tension", string_count="Single")
    assert _derived_tower_proximity(single) is None

    unset = Position(ohl="OHL1", phase="R", string="S1", mount_type="Tension", string_count=None)
    assert _derived_tower_proximity(unset) is None
