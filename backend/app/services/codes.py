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

    # An inspector who has recorded a hotspot determination has, by definition, screened this
    # position — even if they never separately touched the Screening result dropdown. Fill in a
    # sensible starting value from that determination (only while screening_result is still at
    # its untouched "Not inspected" default, so a value the inspector picked themselves — e.g.
    # "Inconclusive" or "Reinspection required" — is never overwritten) so the position, and the
    # whole visit's completion status, isn't stuck reading "incomplete" despite real inspection
    # data already being on file.
    if position.installed and position.screening_result == "Not inspected" and position.hotspot:
        position.screening_result = {
            "No": "Normal",
            "Yes": "Hotspot detected",
            "Unconfirmed": "Inconclusive",
        }.get(position.hotspot, position.screening_result)

    tower_id = position.visit.tower.tower_id
    pcode = position_code(tower_id, position.ohl, position.phase, position.string, position.direction)
    position.position_code = pcode

    # Only the baseline (sequence == 1) image of each type feeds evidence-status/roll-up counting
    # (see models.Image) — filter to it explicitly rather than picking whichever image of that type
    # `position.images` happens to list last, which could otherwise be an extra (sequence > 1) one
    # and collide its code with the baseline's (images.image_code is unique).
    baseline_by_type = {img.image_type: img for img in position.images if img.sequence == 1}
    for img_type in IMAGE_TYPE_CHOICES:
        img = baseline_by_type.get(img_type)
        if img is None:
            continue
        img.image_code = image_code(pcode, position.ohl, position.phase, position.string, position.direction, img_type)
        _apply_default_evidence_status(position, img)

    # Extra gallery images (sequence > 1) aren't part of the required checklist, but their code
    # should still track the position's own code (base code + their sequence suffix, same scheme as
    # routers/positions.py's add_extra_image) rather than going stale after a Direction/phase edit.
    for img in position.images:
        if img.sequence == 1:
            continue
        base = image_code(pcode, position.ohl, position.phase, position.string, position.direction, img.image_type)
        img.image_code = base if base is None else f"{base}-{img.sequence}"


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
