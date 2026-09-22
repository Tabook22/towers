"""The color-coded Severity column in the OETC line report's Thermal Inspection Measurements table
(see services/oetc_report._severity_visual) — thresholds and colors as specified by the customer:
Normal <=5C green, Low >5-10C yellow, Medium >10-20C orange, High/Critical >20C red."""
from app.services.oetc_report import _measurement_context, _severity_visual
from app.models import Position, Tower, Visit


def test_normal_band_at_and_below_five():
    assert _severity_visual(0.0) == ("Normal", "00B050", "FFFFFF")
    assert _severity_visual(5.0) == ("Normal", "00B050", "FFFFFF")


def test_low_band_above_five_to_ten():
    assert _severity_visual(5.1)[0] == "Low"
    assert _severity_visual(10.0) == ("Low", "FFFF00", "000000")


def test_medium_band_above_ten_to_twenty():
    assert _severity_visual(10.1)[0] == "Medium"
    assert _severity_visual(20.0) == ("Medium", "FFC000", "000000")


def test_high_critical_band_above_twenty():
    assert _severity_visual(20.1) == ("High / Critical", "FF0000", "FFFFFF")
    assert _severity_visual(45.0)[0] == "High / Critical"


def test_negative_delta_t_is_classified_by_magnitude():
    # A reading colder than the reference is still an anomaly by size, not automatically "Normal".
    assert _severity_visual(-25.0) == ("High / Critical", "FF0000", "FFFFFF")
    assert _severity_visual(-2.0)[0] == "Normal"


def test_no_reading_yet_gets_no_color():
    label, fill, text_color = _severity_visual(None)
    assert label == ""
    assert fill == "FFFFFF"


def test_measurement_context_carries_the_severity_visual_fields():
    tower = Tower(id=1, tower_id="T-1", voltage="132 kV")
    visit = Visit(id=1, tower_id=1, electrical_load="132")
    visit.tower = tower
    pos = Position(id=1, visit_id=1, ohl="OHL1", phase="R", string="S1", tmax_c=40.0, tref_c=25.0)

    ctx = _measurement_context(seq=1, visit=visit, pos=pos)

    assert ctx["delta_t"] == 15.0
    assert ctx["severity_label"] == "Medium"
    assert ctx["severity_fill"] == "FFC000"
    assert ctx["severity_text_color"] == "000000"
    # The pre-existing manual severity text field is untouched by this.
    assert ctx["severity"] == pos.severity
