"""Help & guides chat assistant.

Answers are grounded only in knowledge/team_leader_guide.md — a hand-written reference of the
app's actual screens/buttons/terminology — so the assistant can't invent a feature that doesn't
exist. See frontend/src/pages/HelpPage.tsx (HelpChatWidget) for where this is used.

Requires ANTHROPIC_API_KEY in backend/.env. Left unset, every request returns a clear 503 instead
of crashing — same "optional external service, degrade gracefully" pattern as services/transcribe.py's
xai_api_key.
"""
from __future__ import annotations

from pathlib import Path

import anthropic
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.deps import get_current_user
from app.models import User
from app.schemas import HelpChatRequest, HelpChatResponse

router = APIRouter(prefix="/api/help", tags=["help"])

_GUIDE_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "team_leader_guide.md"
_GUIDE_TEXT = _GUIDE_PATH.read_text(encoding="utf-8")

_SYSTEM_PROMPT = (
    "You are the in-app help assistant for Insulator Inspector Pro, talking to a user who may be "
    "an admin, a team leader, or a crew member. Answer using ONLY the guide below — it documents "
    "the app's exact, current behavior, in two parts: Part A for team leaders/crew, Part B for "
    "admins. Use whichever part actually answers the question — an admin may ask about the "
    "team-leader workflow too (e.g. to train someone), and vice versa. If something isn't "
    "covered, say you're not sure rather than guessing or inventing a screen, button, or field "
    "that isn't described. Keep answers short and step-by-step for \"how do I...\" questions, "
    "naming the exact screen and button text.\n\n---\n\n" + _GUIDE_TEXT
)

# Keeps each request small — a help chat rarely needs more than this much back-and-forth to
# answer one question, and the API is stateless so the full history is resent every time.
_MAX_HISTORY_TURNS = 20


@router.post("/chat", response_model=HelpChatResponse)
def help_chat(payload: HelpChatRequest, _user: User = Depends(get_current_user)) -> HelpChatResponse:
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
    messages = [
        {"role": t.role, "content": t.content} for t in history if t.role in ("user", "assistant")
    ]
    messages.append({"role": "user", "content": message})

    client = anthropic.Anthropic(api_key=key)
    try:
        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1024,
            # The guide is identical on every request — cache it so repeat questions (and every
            # other team leader's questions) mostly pay the ~10% cached-read rate, not full price.
            system=[{"type": "text", "text": _SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            output_config={"effort": "low"},
            messages=messages,
        )
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
