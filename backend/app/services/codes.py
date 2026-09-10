"""Recomputes Position/Image codes and default evidence status.

Called whenever a Position's direction/installed/screening_result changes,
or when a Visit's 12 positions (and their 4 image slots each) are first created.
"""
from __future__ import annotations

from app.models import IMAGE_TYPE_CHOICES, Position
from app.services.id_gen import image_code, position_code

CLOSE_TYPES = {"TH Close", "RGB Close"}


def refresh_position_codes(position: Position) -> None:
    # Enforce the workbook's invariant: an uninstalled position is always screened as
    # "Not installed" (never left at "Not inspected" or a stale real screening result).
    # Re-enabling Installed afterwards resets it to "Not inspected" so it isn't stuck.
    if not position.installed:
        position.screening_result = "Not installed"
    elif position.screening_result == "Not installed":
        position.screening_result = "Not inspected"

    tower_id = position.visit.tower.tower_id
    pcode = position_code(tower_id, position.ohl, position.phase, position.string, position.direction)
    position.position_code = pcode

    by_type = {img.image_type: img for img in position.images}
    for img_type in IMAGE_TYPE_CHOICES:
        img = by_type.get(img_type)
        if img is None:
            continue
        img.image_code = image_code(pcode, position.ohl, position.phase, position.string, position.direction, img_type)
        _apply_default_evidence_status(position, img)


def _apply_default_evidence_status(position: Position, img) -> None:
    """Only touches evidence_status when no file has been uploaded yet — an uploaded
    file (COMPLETE) or a reviewer's manual RECAPTURE REQUIRED flag is never overwritten."""
    if img.file_path:
        return
    if img.evidence_status == "RECAPTURE REQUIRED":
        return

    if not position.installed or position.screening_result == "Not installed":
        img.evidence_status = "NOT REQUIRED"
    elif position.screening_result == "Normal" and img.image_type in CLOSE_TYPES:
        img.evidence_status = "NOT REQUIRED"
    else:
        img.evidence_status = "PENDING CAPTURE"
