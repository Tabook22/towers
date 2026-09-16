"""Small helpers shared across routers/services that don't belong to any one domain module."""
from __future__ import annotations

import re

_NUM_RE = re.compile(r"(\d+)")


def natural_sort_key(value: str) -> list[str | int]:
    """Sort key for user-defined tower IDs so "Ashoor-Saada-2" sorts before "-10" instead of after
    it, the way SQL/Python's default string ordering would (compares digit-by-digit, so "10" < "2").
    Splits on runs of digits and turns those runs into ints for numeric comparison, leaving the
    surrounding text as lowercased strings — works for any tower ID shape (a bare number, a
    prefix-number like "ARSD 92", or several numeric groups), not just one fixed pattern."""
    return [int(part) if part.isdigit() else part.lower() for part in _NUM_RE.split(value)]
