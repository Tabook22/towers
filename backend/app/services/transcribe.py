"""Turn a field voice note into text.

Prefers a local faster-whisper model on the VPS (no API key). If that is not installed, falls
back to Grok Speech-to-Text when XAI_API_KEY is set. Audio is always saved on disk even when
transcription fails.
"""
from __future__ import annotations

import json
import logging
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

STT_URL = "https://api.x.ai/v1/stt"

_whisper_model = None
_whisper_failed: str | None = None


def transcribe_audio(raw: bytes, filename: str, content_type: str) -> tuple[str | None, str | None]:
    """Returns (transcript, error_message). error_message is set when transcription cannot run."""
    if not raw:
        return None, "Recording is empty"
    text, err = _transcribe_local(raw, filename, content_type)
    if text:
        return text, None
    key = (settings.xai_api_key or "").strip()
    if key:
        cloud_text, cloud_err = _transcribe_xai(raw, filename, content_type, key)
        if cloud_text:
            return cloud_text, None
        return None, cloud_err or err
    return None, err or "Speech-to-text is not available on the server"


def _suffix(filename: str, content_type: str) -> str:
    name = (filename or "").lower()
    if "." in name:
        ext = "." + name.rsplit(".", 1)[-1]
        if ext in {".webm", ".ogg", ".mp3", ".wav", ".m4a", ".mp4", ".aac", ".flac"}:
            return ext
    mapping = {
        "audio/webm": ".webm",
        "video/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/aac": ".aac",
        "audio/x-m4a": ".m4a",
    }
    return mapping.get((content_type or "").split(";")[0].strip().lower(), ".webm")


def _get_whisper():
    global _whisper_model, _whisper_failed
    if _whisper_model is not None:
        return _whisper_model
    if _whisper_failed:
        raise RuntimeError(_whisper_failed)
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        _whisper_failed = "faster-whisper is not installed"
        raise RuntimeError(_whisper_failed) from exc
    model_name = (settings.whisper_model or "small").strip()
    logger.info("Loading local Whisper model %s (cpu/int8)", model_name)
    _whisper_model = WhisperModel(model_name, device="cpu", compute_type="int8")
    return _whisper_model


def _transcribe_local(raw: bytes, filename: str, content_type: str) -> tuple[str | None, str | None]:
    suffix = _suffix(filename, content_type)
    tmp_path: Path | None = None
    try:
        model = _get_whisper()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        segments, _info = model.transcribe(
            str(tmp_path),
            beam_size=5,
            vad_filter=True,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        if not text:
            return None, "No speech was detected in this recording."
        return text, None
    except RuntimeError as exc:
        logger.warning("Local Whisper unavailable: %s", exc)
        return None, str(exc)
    except Exception as exc:
        logger.exception("Local Whisper failed")
        return None, f"Local speech-to-text failed: {exc}"
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


def _transcribe_xai(
    raw: bytes, filename: str, content_type: str, key: str
) -> tuple[str | None, str | None]:
    boundary = "----IipVoiceNote"
    safe_name = filename.replace('"', "") or "voice.webm"
    ctype = content_type or "application/octet-stream"
    parts = [
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="model"\r\n\r\n'
            "grok-stt\r\n"
        ).encode(),
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode()
        + raw
        + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    req = urllib.request.Request(
        STT_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        logger.warning("Voice-note transcription HTTP %s: %s", exc.code, detail)
        return None, "Could not convert this recording to text. Try again, or type the note."
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        logger.warning("Voice-note transcription failed: %s", exc)
        return None, "Could not reach speech-to-text. Check the connection and try again."
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not text.strip():
        return None, "No speech was detected in this recording."
    return text.strip(), None
