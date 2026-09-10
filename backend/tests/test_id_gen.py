"""Verifies the ID-generation logic reproduces the source workbook's formula exactly."""
from app.services.id_gen import image_code, position_code, slugify_tower_id


def test_slugify_strips_only_whitespace():
    assert slugify_tower_id("ARSD 92") == "ARSD92"
    assert slugify_tower_id("T-114B") == "T-114B"
    assert slugify_tower_id("  Dufar North 7  ") == "DufarNorth7"


def test_position_code_matches_workbook_example():
    assert position_code("ARSD 92", "OHL1", "R", "S1", "ES") == "ARSD92-OHL1-R-S1-ES"


def test_position_code_blank_until_complete():
    assert position_code("ARSD 92", "OHL1", "R", "S1", None) is None
    assert position_code("", "OHL1", "R", "S1", "ES") is None


def test_position_code_works_for_arbitrary_tower_id():
    assert position_code("T-114B", "OHL2", "Y", "S2", "WN") == "T-114B-OHL2-Y-S2-WN"


def test_image_code_matches_workbook_row12_example():
    # Workbook ARSD92 row 12: OHL1-R-S1-ES, image type TH Full -> sequence 0005 (hand-verified from
    # the P12 MATCH() formula: ohl_idx=0, phase_idx=0, str_idx=0, dir_idx=1(ES), type=1(TH Full)
    # n = ((((0*3+0)*2+0)*4+1)*4)+1 = 5
    pc = position_code("ARSD 92", "OHL1", "R", "S1", "ES")
    assert image_code(pc, "OHL1", "R", "S1", "ES", "TH Full") == "ARSD92-OHL1-R-S1-ES-0005"
    assert image_code(pc, "OHL1", "R", "S1", "ES", "TH Close") == "ARSD92-OHL1-R-S1-ES-0006"
    assert image_code(pc, "OHL1", "R", "S1", "ES", "RGB Full") == "ARSD92-OHL1-R-S1-ES-0007"
    assert image_code(pc, "OHL1", "R", "S1", "ES", "RGB Close") == "ARSD92-OHL1-R-S1-ES-0008"


def test_image_code_sequence_is_unique_across_all_combinations():
    from app.models import DIRECTION_CHOICES, IMAGE_TYPE_CHOICES, OHL_CHOICES, PHASE_CHOICES, STRING_CHOICES

    seen = set()
    for ohl in OHL_CHOICES:
        for phase in PHASE_CHOICES:
            for string in STRING_CHOICES:
                for direction in DIRECTION_CHOICES:
                    pc = position_code("ARSD 92", ohl, phase, string, direction)
                    for img_type in IMAGE_TYPE_CHOICES:
                        code = image_code(pc, ohl, phase, string, direction, img_type)
                        assert code not in seen
                        seen.add(code)
    assert len(seen) == 2 * 3 * 2 * 4 * 4  # 192 unique combinations
