"""Tower IDs are free-text, so listing them in a sane order (2 before 10, not after) needs a real
sort key rather than relying on SQL/Python's default string comparison — see app/utils.py."""
from app.utils import natural_sort_key


def test_numeric_suffix_sorts_numerically_not_lexically():
    ids = ["Ashoor-Saada-108", "Ashoor-Saada-109", "Ashoor-Saada-11", "Ashoor-Saada-110", "Ashoor-Saada-2"]
    assert sorted(ids, key=natural_sort_key) == [
        "Ashoor-Saada-2",
        "Ashoor-Saada-11",
        "Ashoor-Saada-108",
        "Ashoor-Saada-109",
        "Ashoor-Saada-110",
    ]


def test_prefix_with_space_and_number_sorts_numerically():
    ids = ["ARSD 92", "ARSD 9", "ARSD 100"]
    assert sorted(ids, key=natural_sort_key) == ["ARSD 9", "ARSD 92", "ARSD 100"]


def test_plain_alpha_ids_still_sort_case_insensitively():
    ids = ["Tower-b", "Tower-A", "Tower-c"]
    assert sorted(ids, key=natural_sort_key) == ["Tower-A", "Tower-b", "Tower-c"]
