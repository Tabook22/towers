"""Roll-up / dashboard calculations — reproduces the workbook's 'Overall Summary' sheet."""
from __future__ import annotations

from app.models import Position, Visit

POSSIBLE_POSITIONS = 12  # 2 OHL circuits x 3 phases x 2 strings


def visit_rollup(visit: Visit) -> dict:
    positions: list[Position] = visit.positions
    installed = [p for p in positions if p.installed]
    screened = [p for p in installed if p.screening_result not in (None, "Not inspected")]
    hotspots = [p for p in positions if p.hotspot == "Yes"]
    inconclusive = [p for p in positions if p.screening_result == "Inconclusive"]

    images_pending = 0
    for p in positions:
        for img in p.images:
            # Extra gallery images (sequence > 1, beyond the original one-per-type baseline) are
            # supplementary evidence, not part of the required 48-image checklist — only the
            # baseline slot per (position, type) counts toward "still pending" / roll-up status.
            if img.sequence != 1:
                continue
            if img.evidence_status not in ("COMPLETE", "NOT REQUIRED"):
                images_pending += 1

    installed_n = len(installed)
    screened_n = len(screened)
    completion_pct = (screened_n / installed_n) if installed_n else 0.0

    if images_pending > 0:
        visit_status = "Evidence incomplete"
    elif screened_n < installed_n:
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
