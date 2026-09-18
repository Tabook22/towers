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
        help_chat(HelpChatRequest(message="How do I start an inspection?"), db=None, user=_fake_user())
    assert exc.value.status_code == 503
    assert "not set up" in exc.value.detail.lower() or "anthropic" in exc.value.detail.lower()


def test_empty_message_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-fake-key-for-this-test")
    with pytest.raises(HTTPException) as exc:
        help_chat(HelpChatRequest(message="   "), db=None, user=_fake_user())
    assert exc.value.status_code == 400


def test_guide_text_loaded_and_nonempty():
    from app.routers.help_chat import _GUIDE_TEXT

    assert len(_GUIDE_TEXT) > 500
    assert "Mission plan" in _GUIDE_TEXT


class _FakeBlock:
    def __init__(self, type, **kw):
        self.type = type
        for k, v in kw.items():
            setattr(self, k, v)


class _FakeResponse:
    def __init__(self, content, stop_reason):
        self.content = content
        self.stop_reason = stop_reason


def test_tool_use_round_trip_calls_the_scoped_tool_and_returns_the_final_text(monkeypatch):
    """The model asking for live data should trigger exactly one call into chat_tools (scoped to
    the real user, not whatever the model happened to pass), then produce a normal text reply —
    proving the tool-use loop actually wires model <-> our own scoped Python function <-> model."""
    import app.routers.help_chat as help_chat_module

    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-fake-key-for-this-test")

    captured = {}

    def fake_tool_fn(db, user, **kwargs):
        captured["db"] = db
        captured["user"] = user
        captured["kwargs"] = kwargs
        return {"tower_count": 3, "total_hotspots": 1}

    monkeypatch.setitem(help_chat_module.chat_tools.TOOL_FUNCTIONS, "dashboard_summary", fake_tool_fn)

    responses = [
        _FakeResponse(
            content=[_FakeBlock("tool_use", id="tool_1", name="dashboard_summary", input={"area": "Ashoor-Saada"})],
            stop_reason="tool_use",
        ),
        _FakeResponse(
            content=[_FakeBlock("text", text="Your team has 3 towers and 1 open hotspot in Ashoor-Saada.")],
            stop_reason="end_turn",
        ),
    ]

    class FakeMessages:
        def create(self, **kwargs):
            return responses.pop(0)

    class FakeClient:
        def __init__(self, api_key):
            self.messages = FakeMessages()

    monkeypatch.setattr(help_chat_module.anthropic, "Anthropic", FakeClient)

    fake_db = object()
    fake_user = _fake_user()
    result = help_chat(HelpChatRequest(message="How many hotspots in Ashoor-Saada?"), db=fake_db, user=fake_user)

    assert "1 open hotspot" in result.reply
    assert captured["db"] is fake_db
    assert captured["user"] is fake_user
    assert captured["kwargs"] == {"area": "Ashoor-Saada"}


def test_search_mode_controls_which_tools_are_offered(monkeypatch):
    """The three-way control is per message — local-only must never see web_search, internet-only
    must never see the app's own data tools, and both must see everything."""
    import app.routers.help_chat as help_chat_module

    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-fake-key-for-this-test")

    captured_calls = []

    class FakeMessages:
        def create(self, **kwargs):
            captured_calls.append(kwargs)
            return _FakeResponse(content=[_FakeBlock("text", text="ok")], stop_reason="end_turn")

    class FakeClient:
        def __init__(self, api_key):
            self.messages = FakeMessages()

    monkeypatch.setattr(help_chat_module.anthropic, "Anthropic", FakeClient)

    help_chat(HelpChatRequest(message="hi", search_mode="local"), db=None, user=_fake_user())
    local_tools = captured_calls[0]["tools"]
    assert "web_search_20250305" not in {t.get("type") for t in local_tools}
    assert "dashboard_summary" in {t.get("name") for t in local_tools}
    assert len(captured_calls[0]["system"]) == 1

    help_chat(HelpChatRequest(message="hi", search_mode="internet"), db=None, user=_fake_user())
    internet_tools = captured_calls[1]["tools"]
    assert {t.get("type") for t in internet_tools} == {"web_search_20250305"}
    assert len(captured_calls[1]["system"]) == 2

    help_chat(HelpChatRequest(message="hi", search_mode="both"), db=None, user=_fake_user())
    both_tools = captured_calls[2]["tools"]
    assert "web_search_20250305" in {t.get("type") for t in both_tools}
    assert "dashboard_summary" in {t.get("name") for t in both_tools}
    assert len(captured_calls[2]["system"]) == 2
