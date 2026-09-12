from types import SimpleNamespace

from app.services.tower_numbers import desired_tower_id, extract_tower_number, tower_pin_numbers


def test_desired_id_replaces_trailing_number():
    assert desired_tower_id("Ashoor-Saada-100", 67, "Ashoor-Saada") == "Ashoor-Saada-67"
    assert desired_tower_id("Ashoor-Saada-1", 1, "Ashoor-Saada") == "Ashoor-Saada-1"
    assert desired_tower_id("ARSD 92", 3, None) == "ARSD 3"


def test_desired_id_without_trailing_number_uses_area():
    assert desired_tower_id("Main line", 4, "Ashoor-Saada") == "Ashoor-Saada-4"
    assert desired_tower_id("Main line", 4, None) == "Main line-4"


def test_extract_trailing_number():
    assert extract_tower_number("Ashoor-Saada-100") == 100
    assert extract_tower_number("Tower 12") == 12
    assert extract_tower_number("no-number") is None


def test_pin_number_matches_tower_id_suffix():
    towers = [
        SimpleNamespace(id=1, tower_id="Ashoor-Saada-2", area="Ashoor-Saada", latitude=17.0, longitude=54.0),
        SimpleNamespace(id=2, tower_id="Ashoor-Saada-100", area="Ashoor-Saada", latitude=17.0, longitude=54.1),
        SimpleNamespace(id=3, tower_id="Ashoor-Saada-3", area="Ashoor-Saada", latitude=17.0, longitude=54.2),
    ]
    pins = tower_pin_numbers(towers)
    assert pins[1] == 2
    assert pins[2] == 100
    assert pins[3] == 3
