"""The Help page's chat assistant must degrade gracefully — never crash the page — when no
Anthropic API key is configured, and reject an empty question before it ever calls out."""
import pytest
from fastapi import HTTPException

from app.config import settings
from app.models import User
from app.routers.help_chat import help_chat
from app.schemas import HelpChatRequest


def _fake_user() -> User:
    return User(id=1, username="leader1", role="team_leader")


def test_missing_api_key_returns_clear_503(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    with pytest.raises(HTTPException) as exc:
        help_chat(HelpChatRequest(message="How do I start an inspection?"), _fake_user())
    assert exc.value.status_code == 503
    assert "not set up" in exc.value.detail.lower() or "anthropic" in exc.value.detail.lower()


def test_empty_message_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-fake-key-for-this-test")
    with pytest.raises(HTTPException) as exc:
        help_chat(HelpChatRequest(message="   "), _fake_user())
    assert exc.value.status_code == 400


def test_guide_text_loaded_and_nonempty():
    from app.routers.help_chat import _GUIDE_TEXT

    assert len(_GUIDE_TEXT) > 500
    assert "Mission plan" in _GUIDE_TEXT
