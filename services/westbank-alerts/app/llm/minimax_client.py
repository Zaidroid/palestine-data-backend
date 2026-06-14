"""MiniMax LLM client (Phase 0 / S1).

The single LLM entrypoint for the hybrid pipeline. It is deliberately boring and
fail-safe: `complete_json` returns a parsed dict on success and `None` on ANY
problem (disabled, over budget, timeout, network error, malformed output). Every
caller treats `None` as "fall back to deterministic rules", so the LLM can never
break or block ingestion.

The wire format targets MiniMax's OpenAI-style chat endpoint
(`POST {base_url}/text/chatcompletion_v2`). The exact path/shape is verified against
the live API at deploy time; `_raw_complete` is the only place that knows it, so it
is trivially mockable in tests.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Optional

import httpx

log = logging.getLogger("minimax")

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)
_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)


def parse_json_lenient(text: Optional[str]) -> Optional[dict]:
    """Best-effort extraction of a JSON object from a model reply.

    Handles ```json fences and leading/trailing prose. Returns None if no JSON
    object can be parsed.
    """
    if not text or not text.strip():
        return None
    # 1) fenced block
    m = _FENCE_RE.search(text)
    candidate = m.group(1) if m else text
    for chunk in (candidate, text):
        try:
            obj = json.loads(chunk)
            if isinstance(obj, dict):
                return obj
        except (ValueError, TypeError):
            pass
    # 2) first {...} span
    m = _OBJ_RE.search(text)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except (ValueError, TypeError):
            pass
    return None


class MiniMaxClient:
    def __init__(self, *, enabled: bool, model: str, base_url: str, api_key: str,
                 timeout: float = 20.0, daily_budget: int = 0):
        self.enabled = enabled
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.daily_budget = daily_budget  # 0 = unlimited
        self._calls = 0
        self._calls_day = date.today()

    # ── budget (in-process soft cap; resets daily / on restart) ──────────────
    def _budget_ok(self) -> bool:
        if not self.daily_budget:
            return True
        today = date.today()
        if today != self._calls_day:
            self._calls_day = today
            self._calls = 0
        return self._calls < self.daily_budget

    def stats(self) -> dict:
        return {"calls_today": self._calls, "daily_budget": self.daily_budget,
                "enabled": self.enabled, "model": self.model}

    async def _raw_complete(self, messages: list) -> Optional[str]:
        """POST to MiniMax chat endpoint, return assistant text (or None)."""
        url = f"{self.base_url}/text/chatcompletion_v2"
        headers = {"Authorization": f"Bearer {self.api_key}",
                   "Content-Type": "application/json"}
        payload = {"model": self.model, "messages": messages,
                   "temperature": 0.1, "max_tokens": 1024}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def complete_json(self, system: str, user: str, *,
                            schema_hint: str = "",
                            cache_key: Optional[str] = None) -> Optional[dict]:
        if not self.enabled:
            return None
        if cache_key:
            cached = await _cache_get(cache_key)
            if cached is not None:
                return cached
        if not self._budget_ok():
            log.warning("MiniMax daily budget (%s) reached — falling back to rules", self.daily_budget)
            return None

        sys_msg = system
        if schema_hint:
            sys_msg = f"{system}\n\nRespond with ONLY valid JSON matching: {schema_hint}"
        messages = [{"role": "system", "content": sys_msg},
                    {"role": "user", "content": user}]
        try:
            self._calls += 1
            raw = await self._raw_complete(messages)
        except Exception as e:  # noqa: BLE001 — fail safe to rules on any error
            log.warning("MiniMax call failed (%s) — falling back to rules", e)
            return None

        result = parse_json_lenient(raw)
        if result is None:
            log.warning("MiniMax returned non-JSON — falling back to rules")
            return None
        if cache_key:
            await _cache_put(cache_key, result, self.model)
        return result


# ── persistent cache (llm_cache table in checkpoints.db) ─────────────────────
async def _cache_get(cache_key: str) -> Optional[dict]:
    try:
        from ..db_pool import get_checkpoint_db
        async with get_checkpoint_db() as db:
            cur = await db.execute(
                "SELECT response_json FROM llm_cache WHERE cache_key=?", (cache_key,))
            row = await cur.fetchone()
        if row and row[0]:
            return json.loads(row[0])
    except Exception:  # noqa: BLE001 — cache is best-effort
        return None
    return None


async def _cache_put(cache_key: str, result: dict, model: str) -> None:
    try:
        from datetime import datetime
        from ..db_pool import get_checkpoint_db
        async with get_checkpoint_db() as db:
            await db.execute(
                "INSERT OR REPLACE INTO llm_cache (cache_key, response_json, model, created_at) "
                "VALUES (?,?,?,?)",
                (cache_key, json.dumps(result, ensure_ascii=False), model,
                 datetime.utcnow().isoformat()))
            await db.commit()
    except Exception:  # noqa: BLE001 — never let caching break a call
        pass


_client: Optional[MiniMaxClient] = None


def get_client() -> MiniMaxClient:
    """Singleton built from settings."""
    global _client
    if _client is None:
        from ..config import settings
        _client = MiniMaxClient(
            enabled=settings.MINIMAX_ENABLED,
            model=settings.MINIMAX_MODEL,
            base_url=settings.MINIMAX_BASE_URL,
            api_key=settings.MINIMAX_API_KEY,
            timeout=settings.MINIMAX_TIMEOUT_S,
            daily_budget=settings.MINIMAX_DAILY_BUDGET,
        )
    return _client
