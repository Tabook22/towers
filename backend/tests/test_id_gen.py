"""Verifies the ID-generation logic. Originally reproduced the source Excel workbook's formula
exactly, back when Direction was the workbook's own 4-way compass set [EN, ES, WN, WS] — Direction
is now a different, admin-defined set of values instead (see app.models.DIRECTION_CHOICES), so the
formula is generalized to whatever length that list actually is (see services/id_gen.py's docstring)
rather than the original hardcoded 4."""
from app.services.id_gen import image_code, image_sequence_number, position_code, slugify_tower_id


def test_slugify_strips_only_whitespace():
    assert slugify_tower_id("ARSD 92") == "ARSD92"
    assert slugify_tower_id("T-114B") == "T-114B"
    assert slugify_tower_id("  Dufar North 7  ") == "DufarNorth7"


def test_position_code_matches_workbook_example():
    assert position_code("ARSD 92", "OHL1", "R", "S1", "Saada") == "ARSD92-OHL1-R-S1-Saada"


def test_position_code_blank_until_complete():
    assert position_code("ARSD 92", "OHL1", "R", "S1", None) is None
    assert position_code("", "OHL1", "R", "S1", "Saada") is None


def test_position_code_works_for_arbitrary_tower_id():
    assert position_code("T-114B", "OHL2", "Y", "S2", "Ittin") == "T-114B-OHL2-Y-S2-Ittin"


def test_image_code_first_position_first_direction():
    # ohl_idx=0, phase_idx=0, str_idx=0, dir_idx=1(Saada), type=1(TH Full)
    # n = ((((0*3+0)*2+0)*5+1)*4)+1 = 5 — same number the original 4-direction formula gave for its
    # own second direction (ES), since every earlier term is 0 either way; see the next test for a
    # case where the 4-vs-5-direction difference actually shows up.
    pc = position_code("ARSD 92", "OHL1", "R", "S1", "Saada")
    assert image_code(pc, "OHL1", "R", "S1", "Saada", "TH Full") == "ARSD92-OHL1-R-S1-Saada-0005"
    assert image_code(pc, "OHL1", "R", "S1", "Saada", "TH Close") == "ARSD92-OHL1-R-S1-Saada-0006"
    assert image_code(pc, "OHL1", "R", "S1", "Saada", "RGB Full") == "ARSD92-OHL1-R-S1-Saada-0007"
    assert image_code(pc, "OHL1", "R", "S1", "Saada", "RGB Close") == "ARSD92-OHL1-R-S1-Saada-0008"


def test_sequence_uses_the_actual_direction_count_not_a_hardcoded_four():
    # ohl_idx=0, phase_idx=1(Y... wait using R,Y,B index 1 is Y), str_idx=0, dir_idx=0(Ashoor), type=1
    # n = ((((0*3+1)*2+0)*5+0)*4)+1 = (((1)*2)*5)*4+1 = (10*4)+1 = 41 — with the old hardcoded *4
    # this would have been (((1*2)*4)+0)*4+1 = 33, so this genuinely exercises the *len(...) fix.
    assert image_sequence_number("OHL1", "Y", "S1", "Ashoor", "TH Full") == 41


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
    assert len(seen) == 2 * 3 * 2 * len(DIRECTION_CHOICES) * 4
