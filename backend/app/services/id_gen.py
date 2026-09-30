"""Position ID / Image ID generation.

Originally reproduced the source Excel workbook's formula exactly (ARSD92!P12 etc.), back when
Direction was the workbook's own 4-way compass set [EN, ES, WN, WS]. Direction now holds a
different, admin-defined set of values (line/segment names) instead, so the sequence formula below
uses the frozen historical IMAGE_DIRECTION_ORDER rather than dropdown display order — the
position/image ID *format* is unchanged, but the specific numbers a photo gets no longer line up
with that original workbook's numbering for any direction beyond the first four.

Position ID = {TowerID, whitespace stripped}-{OHL}-{Phase}-{String}-{Direction}
Image ID    = {Position ID}-{4-digit sequence}

sequence = ((((ohl_idx*3 + phase_idx)*2 + str_idx)*len(IMAGE_DIRECTION_ORDER) + dir_idx)*4) + image_type_num
  ohl_idx      0-based index in [OHL1, OHL2]
  phase_idx    0-based index in [R, Y, B]
  str_idx      0-based index in [S1, S2]
  dir_idx      0-based index in the frozen IMAGE_DIRECTION_ORDER below
  type_num     1-based index in [TH Full, TH Close, RGB Full, RGB Close]
"""
from app.models import IMAGE_TYPE_CHOICES, OHL_CHOICES, PHASE_CHOICES, STRING_CHOICES

# Freeze the historical numbering independently of dropdown order or spelling.
# Shahaon is the corrected spelling of the same direction slot as legacy Shaoon.
IMAGE_DIRECTION_ORDER = ("Ashoor", "Saada", "Shaoon", "Ittin", "Thumrait")


def slugify_tower_id(tower_id: str) -> str:
    """Mirrors the workbook's SUBSTITUTE(tower_id, " ", "") — strip whitespace only,
    keep everything else exactly as the user typed it (arbitrary tower IDs must work)."""
    return "".join(tower_id.split())


def position_code(tower_id: str, ohl: str, phase: str, string: str, direction: str | None) -> str | None:
    if not (tower_id and ohl and phase and string and direction):
        return None
    return f"{slugify_tower_id(tower_id)}-{ohl}-{phase}-{string}-{direction}"


def image_sequence_number(ohl: str, phase: str, string: str, direction: str, image_type: str) -> int:
    ohl_idx = OHL_CHOICES.index(ohl)
    phase_idx = PHASE_CHOICES.index(phase)
    str_idx = STRING_CHOICES.index(string)
    dir_idx = IMAGE_DIRECTION_ORDER.index("Shaoon" if direction == "Shahaon" else direction)
    type_num = IMAGE_TYPE_CHOICES.index(image_type) + 1  # 1-based, matches MATCH() in the workbook
    return ((((ohl_idx * 3 + phase_idx) * 2 + str_idx) * len(IMAGE_DIRECTION_ORDER) + dir_idx) * 4) + type_num


def image_code(pos_code: str | None, ohl: str, phase: str, string: str, direction: str | None, image_type: str) -> str | None:
    if not pos_code or not direction:
        return None
    n = image_sequence_number(ohl, phase, string, direction, image_type)
    return f"{pos_code}-{n:04d}"
