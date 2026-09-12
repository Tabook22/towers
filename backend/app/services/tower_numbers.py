"""Map pin numbers (1, 2, 3… per area) — keep in lockstep with frontend towerMapPins.ts."""
from __future__ import annotations

import math
import re
from collections.abc import Sequence

from app.models import Tower

_TRAILING_NUM = re.compile(r"^(.*?)(\d+)\s*$")


def extract_tower_number(tower_id: str) -> int | None:
    match = re.search(r"(\d+)\s*$", tower_id)
    return int(match.group(1)) if match else None


def desired_tower_id(tower_id: str, pin_number: int, area: str | None = None) -> str:
    """Ashoor-Saada-100 with pin 67 → Ashoor-Saada-67. Keeps the prefix, replaces the last number."""
    match = _TRAILING_NUM.match(tower_id.strip())
    if match:
        return f"{match.group(1)}{pin_number}"
    area_name = (area or "").strip()
    if area_name:
        return f"{area_name}-{pin_number}"
    return f"{tower_id.strip()}-{pin_number}"


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _order_along_line(towers: Sequence[Tower]) -> list[Tower]:
    gps = [t for t in towers if t.latitude is not None and t.longitude is not None]
    no_gps = [t for t in towers if t.latitude is None or t.longitude is None]
    no_gps.sort(key=lambda t: t.tower_id)
    if len(gps) < 2:
        return [*gps, *no_gps]
    a, b = gps[0], gps[1]
    best = -1.0
    for i, ti in enumerate(gps):
        for tj in gps[i + 1 :]:
            d = _haversine_m(ti.latitude, ti.longitude, tj.latitude, tj.longitude)
            if d > best:
                best = d
                a, b = ti, tj
    if b.longitude < a.longitude:
        a, b = b, a
    dx = b.longitude - a.longitude
    dy = b.latitude - a.latitude

    def proj(t: Tower) -> float:
        return (t.longitude - a.longitude) * dx + (t.latitude - a.latitude) * dy

    gps.sort(key=proj)
    return [*gps, *no_gps]


def _order_group(group: Sequence[Tower]) -> list[Tower]:
    numbered = [t for t in group if extract_tower_number(t.tower_id) is not None]
    if len(numbered) >= max(2, math.ceil(len(group) * 0.5)):
        return sorted(
            group,
            key=lambda t: (
                extract_tower_number(t.tower_id) is None,
                extract_tower_number(t.tower_id) or 0,
                t.tower_id.lower(),
            ),
        )
    return _order_along_line(group)


def tower_pin_numbers(towers: Sequence[Tower]) -> dict[int, int]:
    """Number in the pin = trailing number from the Tower ID (Ashoor-Saada-2 → 2)."""
    by_area: dict[str, list[Tower]] = {}
    for t in towers:
        key = (t.area or "").strip() or "_none"
        by_area.setdefault(key, []).append(t)
    out: dict[int, int] = {}
    for group in by_area.values():
        used: set[int] = set()
        for t in group:
            n = extract_tower_number(t.tower_id)
            if n is not None:
                out[t.id] = n
                used.add(n)
        nxt = 1
        for t in _order_group(group):
            if t.id in out:
                continue
            while nxt in used:
                nxt += 1
            out[t.id] = nxt
            used.add(nxt)
            nxt += 1
    return out
