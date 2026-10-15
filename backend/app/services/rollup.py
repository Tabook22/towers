"""Roll-up / dashboard calculations — reproduces the workbook's 'Overall Summary' sheet."""
from __future__ import annotations

from app.models import Position, Visit, IMAGE_TYPE_CHOICES

POSSIBLE_POSITIONS = 12  # 2 OHL circuits x 3 phases x 2 strings


def visit_rollup(visit: Visit) -> dict:
    positions: list[Position] = [p for p in visit.positions if getattr(p, 'in_scope', True) is not False]
    installed = [p for p in positions if p.installed]
    screened = [p for p in installed if p.screening_result not in (None, "Not inspected")]
    hotspots = [p for p in positions if p.hotspot == "Yes"]
    inconclusive = [p for p in positions if p.screening_result == "Inconclusive"]

    images_pending = 0
    for p in installed:
        covered = {img.image_type for img in p.images if (img.file_path and img.evidence_status != 'RECAPTURE REQUIRED')
                   or (img.sequence == 1 and img.evidence_status == 'NOT REQUIRED' and getattr(img, 'exemption_reason', None))}
        images_pending += len(set(IMAGE_TYPE_CHOICES) - covered)

    installed_n = len(installed)
    screened_n = len(screened)
    completion_pct = (screened_n / installed_n) if installed_n else 0.0

    # Images pending is tracked as an informational count only — a tower is never marked
    # incomplete just because it's short of the full photo checklist. Screening result is what
    # decides whether a visit is ready for review.
    if screened_n < installed_n:
        visit_status = "Inspection incomplete"
    else:
        visit_status = "Ready for review"

    return {
        "possible_positions": len(positions) or POSSIBLE_POSITIONS,
        "installed": installed_n,
        "screened": screened_n,
        "hotspots": len(hotspots),
        "inconclusive": len(inconclusive),
        "images_pending": images_pending,
        "completion_pct": round(completion_pct * 100, 1),
        "visit_status": visit_status,
    }
