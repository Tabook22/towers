from app.services.tower_numbers import desired_tower_id, extract_tower_number


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
