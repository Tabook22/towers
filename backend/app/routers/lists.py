from __future__ import annotations

from fastapi import APIRouter

from app.schemas import ChoiceLists

router = APIRouter(prefix="/api/lists", tags=["lists"])


@router.get("", response_model=ChoiceLists)
def get_choice_lists():
    """Single source of truth for every dropdown in the frontend, mirroring the workbook's Lists sheet."""
    return ChoiceLists()
