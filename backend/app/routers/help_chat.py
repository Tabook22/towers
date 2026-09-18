"""Help & guides chat assistant.

Answers "how do I..." questions grounded only in knowledge/team_leader_guide.md — a hand-written
reference of the app's actual screens/buttons/terminology, so the assistant can't invent a feature
that doesn't exist. It can also answer live-data questions ("how many hotspots does my team have
open") by calling the read-only tools in services/chat_tools.py — those enforce the exact same
role-based scoping as the rest of the app (see chat_tools.py's own docstring); the model never
gets raw database access, only whatever those scoped functions choose to return, and there is no
write path anywhere in this flow. See frontend/src/pages/HelpPage.tsx (HelpChatWidget) and
components/FloatingHelpChat.tsx for where this is used.

payload.search_mode picks what this one message can draw on — "local" (the guide + the tools
above; the default), "internet" (only Anthropic's own server-executed web_search tool — none of
the app's own data tools), or "both". Defaulting to "local" means leaving the internet on would
just add cost/latency for no benefit most of the time and hand the model untrusted web content it
doesn't need; "internet" mode exists for a genuinely external question where local tools would
just get in the way (or be tried needlessly).

Requires ANTHROPIC_API_KEY in backend/.env. Left unset, every request returns a clear 503 instead
of crashing — same "optional external service, degrade gracefully" pattern as services/transcribe.py's
xai_api_key.
"""
from __future__ import annotations

import json
from pathlib import Path

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import HelpChatRequest, HelpChatResponse
from app.services import chat_tools

router = APIRouter(prefix="/api/help", tags=["help"])

_GUIDE_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "team_leader_guide.md"
_GUIDE_TEXT = _GUIDE_PATH.read_text(encoding="utf-8")

_SYSTEM_PROMPT = (
    "You are the in-app help assistant for Insulator Inspector Pro, talking to a user who may be "
    "an admin, a team leader, or a crew member. For \"how do I...\" questions about the app's "
    "screens, buttons, or workflow, answer using ONLY the guide below — it documents the app's "
    "exact, current behavior, in two parts: Part A for team leaders/crew, Part B for admins. Use "
    "whichever part actually answers the question — an admin may ask about the team-leader "
    "workflow too (e.g. to train someone), and vice versa. If something isn't covered, say you're "
    "not sure rather than guessing or inventing a screen, button, or field that isn't described.\n\n"
    "For questions about actual live data — counts, a specific tower's status, a team's progress, "
    "open hotspots — call the matching tool instead of guessing or using anything from the guide's "
    "example numbers. For anything that sounds like it might be covered by a past field report or "
    "incident write-up (\"has this happened before\", \"what did we do last time X\"), call "
    "search_knowledge_base — don't assume no such report exists just because you don't already "
    "know of one. The tools are already scoped to exactly what this user is allowed to see, so "
    "call them freely; never claim to know live data or a report's contents you didn't just get "
    "from a tool call. If a tool returns an error or no results, say so plainly rather than making "
    "something up.\n\n"
    "Keep answers short and step-by-step for \"how do I...\" questions, naming the exact screen and "
    "button text. Keep data answers short too — lead with the number/fact asked for. When quoting a "
    "knowledge-base excerpt, name which document it came from.\n\n---\n\n"
    + _GUIDE_TEXT
)

# Appended (not cached — it varies per request) depending on search_mode. Kept separate from
# _SYSTEM_PROMPT so the big cached guide block stays identical across every request regardless of
# this per-message choice.
_BOTH_SYSTEM_SUFFIX = (
    "\n\nFor this message, a real web_search tool is also available, because the user explicitly "
    "chose \"Both\". Still prefer the guide and the tools above for anything about this app or "
    "this organization's own towers/teams/reports — the web has no knowledge of those. Only reach "
    "for web_search for genuinely external questions (general technical/engineering facts, public "
    "standards, something outside this app entirely). When you use a web result, say plainly that "
    "it came from the internet rather than from this app's own records."
)
_INTERNET_ONLY_SYSTEM_SUFFIX = (
    "\n\nThe user chose \"Internet\" for this message: answer ONLY using the real web_search tool "
    "— none of this app's own data tools are available for this message, so don't reference the "
    "guide or claim anything about this organization's own towers/teams/reports here. Say plainly "
    "that the answer came from the internet."
)

# Keeps each request small — a help chat rarely needs more than this much back-and-forth to
# answer one question, and the API is stateless so the full history is resent every time.
_MAX_HISTORY_TURNS = 20

# A tool-calling turn (ask -> tool -> answer) is normally 1-2 round trips; this is just a hard
# ceiling so a confused model can't loop forever calling tools instead of ever answering.
_MAX_TOOL_ROUNDS = 4


def _run_tool(db: Session, user: User, name: str, tool_input: dict) -> dict:
    fn = chat_tools.TOOL_FUNCTIONS.get(name)
    if not fn:
        return {"error": f"Unknown tool '{name}'"}
    try:
        return fn(db, user, **tool_input)
    except TypeError as exc:
        return {"error": f"Bad arguments for '{name}': {exc}"}


@router.post("/chat", response_model=HelpChatResponse)
def help_chat(
    payload: HelpChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HelpChatResponse:
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Type a question first")

    key = (settings.anthropic_api_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="The help assistant isn't set up yet — ask an admin to add an Anthropic API key.",
        )

    history = payload.history[-_MAX_HISTORY_TURNS:]
    messages: list[dict] = [
        {"role": t.role, "content": t.content} for t in history if t.role in ("user", "assistant")
    ]
    messages.append({"role": "user", "content": message})

    client = anthropic.Anthropic(api_key=key)

    # Anthropic's own server-executed tool — the actual fetch/search runs on their infrastructure,
    # not this backend, and max_uses caps cost/latency for one message.
    web_search_tool = {"type": "web_search_20250305", "name": "web_search", "max_uses": 3}
    system_blocks: list[dict] = [{"type": "text", "text": _SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
    if payload.search_mode == "internet":
        tools: list[dict] = [web_search_tool]
        system_blocks.append({"type": "text", "text": _INTERNET_ONLY_SYSTEM_SUFFIX})
    elif payload.search_mode == "both":
        tools = list(chat_tools.TOOLS) + [web_search_tool]
        system_blocks.append({"type": "text", "text": _BOTH_SYSTEM_SUFFIX})
    else:
        tools = list(chat_tools.TOOLS)

    def call_model():
        return client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1024,
            # The guide is identical on every request — cache it so repeat questions (and every
            # other team leader's questions) mostly pay the ~10% cached-read rate, not full price.
            system=system_blocks,
            tools=tools,
            output_config={"effort": "low"},
            messages=messages,
        )

    try:
        response = call_model()
        for _ in range(_MAX_TOOL_ROUNDS):
            if response.stop_reason != "tool_use":
                break
            messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                result = _run_tool(db, user, block.name, block.input or {})
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, default=str),
                    }
                )
            messages.append({"role": "user", "content": tool_results})
            response = call_model()
    except anthropic.AuthenticationError:
        raise HTTPException(
            status_code=503,
            detail="The help assistant's API key looks invalid — ask an admin to check it.",
        )
    except anthropic.RateLimitError:
        raise HTTPException(status_code=503, detail="The help assistant is busy right now — try again in a moment.")
    except anthropic.APIConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Couldn't reach the help assistant — check the server's internet connection.",
        )
    except anthropic.APIStatusError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"The help assistant hit an error ({exc.status_code}) — try again shortly.",
        )

    reply = "".join(block.text for block in response.content if block.type == "text").strip()
    if not reply:
        reply = "Sorry, I couldn't come up with an answer to that — try rephrasing your question."
    return HelpChatResponse(reply=reply)
