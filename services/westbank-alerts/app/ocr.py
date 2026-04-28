"""
F10 — Tesseract Arabic OCR for media-only Telegram posts.

Reasonably-fast wrapper around pytesseract that:
  - Skips when OCR is disabled (default off; opt-in via OCR_ENABLED env)
  - Skips images larger than OCR_MAX_PIXELS (latency cap; large images
    take >5s on tesseract)
  - Runs OCR with the Arabic + English language packs
  - Returns "" on any error so callers can fall through cleanly

Designed to be called from monitor.py only when the Telegram message has
no usable text but does have an image attachment. We deliberately avoid
calling it on every message — most posts have text and the OCR pass would
just add per-cycle latency without yield.
"""

import asyncio
import io
import logging
from typing import Optional

from .config import settings

log = logging.getLogger("ocr")

# Lazy import — pytesseract + Pillow are only loaded if OCR_ENABLED.
# Keeps the module loadable on hosts without tesseract installed.
_TESSERACT = None
_PIL_IMAGE = None


def _load_deps() -> bool:
    global _TESSERACT, _PIL_IMAGE
    if _TESSERACT is not None and _PIL_IMAGE is not None:
        return True
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore
        _TESSERACT = pytesseract
        _PIL_IMAGE = Image
        return True
    except Exception as e:
        log.warning(f"OCR deps not loadable: {e}")
        return False


def _run_tesseract_sync(image_bytes: bytes) -> str:
    """Sync OCR worker — runs in a thread because pytesseract is blocking."""
    if not _load_deps():
        return ""
    try:
        img = _PIL_IMAGE.open(io.BytesIO(image_bytes))
        # Drop oversized images to keep cycle latency bounded.
        if (img.width * img.height) > settings.OCR_MAX_PIXELS:
            log.debug(f"OCR skip: image too large ({img.width}x{img.height})")
            return ""
        # Arabic + English so we catch mixed-script captions.
        text = _TESSERACT.image_to_string(img, lang="ara+eng", timeout=int(settings.OCR_TIMEOUT_SECONDS))
        return (text or "").strip()
    except Exception as e:
        log.debug(f"OCR error: {e}")
        return ""


async def ocr_image_bytes(image_bytes: Optional[bytes]) -> str:
    """Run OCR off-thread. Returns extracted text or "" if OCR disabled,
    deps missing, image invalid, or extraction failed."""
    if not settings.OCR_ENABLED or not image_bytes:
        return ""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_run_tesseract_sync, image_bytes),
            timeout=settings.OCR_TIMEOUT_SECONDS + 2,
        )
    except asyncio.TimeoutError:
        log.debug("OCR timeout")
        return ""
    except Exception as e:
        log.debug(f"OCR wrapper error: {e}")
        return ""
