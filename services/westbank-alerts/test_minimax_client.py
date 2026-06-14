"""Phase 0 / S1 — MiniMax client (app/llm/minimax_client.py).

The client is the single LLM entrypoint for the hybrid pipeline (parser fallback,
news clustering, candidate vetting). It MUST fail safe: any error, timeout, disabled
flag, or budget exhaustion returns None so every caller falls back to deterministic
rules — the LLM can never break or block ingestion.

Run:  pytest test_minimax_client.py -v
"""
import asyncio

from app.llm.minimax_client import MiniMaxClient, parse_json_lenient, get_client


def _run(coro):
    return asyncio.run(coro)


def _client(**over):
    base = dict(enabled=True, model="MiniMax-Text-01", base_url="http://x/v1",
                api_key="k", timeout=5.0, daily_budget=0)
    base.update(over)
    return MiniMaxClient(**base)


# ── lenient JSON parsing ─────────────────────────────────────────────────────

def test_parse_plain_json():
    assert parse_json_lenient('{"a": 1}') == {"a": 1}


def test_parse_fenced_json():
    assert parse_json_lenient('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_json_with_leading_prose():
    assert parse_json_lenient('Sure! Here:\n{"a": 1}\nDone.') == {"a": 1}


def test_parse_garbage_returns_none():
    assert parse_json_lenient("not json at all") is None
    assert parse_json_lenient("") is None
    assert parse_json_lenient(None) is None


# ── complete_json fail-safe behavior ─────────────────────────────────────────

def test_disabled_returns_none_without_calling_api():
    c = _client(enabled=False)
    called = {"n": 0}

    async def fake_raw(messages):
        called["n"] += 1
        return '{"x": 1}'

    c._raw_complete = fake_raw
    out = _run(c.complete_json("sys", "user"))
    assert out is None
    assert called["n"] == 0


def test_enabled_returns_parsed_dict():
    c = _client()

    async def fake_raw(messages):
        return '{"reports": []}'

    c._raw_complete = fake_raw
    assert _run(c.complete_json("sys", "user")) == {"reports": []}


def test_fenced_response_is_parsed():
    c = _client()

    async def fake_raw(messages):
        return '```json\n{"ok": true}\n```'

    c._raw_complete = fake_raw
    assert _run(c.complete_json("sys", "user")) == {"ok": True}


def test_garbage_response_returns_none():
    c = _client()

    async def fake_raw(messages):
        return "the checkpoint is open"

    c._raw_complete = fake_raw
    assert _run(c.complete_json("sys", "user")) is None


def test_raw_complete_exception_returns_none():
    c = _client()

    async def boom(messages):
        raise RuntimeError("network down")

    c._raw_complete = boom
    assert _run(c.complete_json("sys", "user")) is None


def test_budget_exhausted_returns_none_without_calling_api():
    c = _client(daily_budget=2)
    calls = {"n": 0}

    async def fake_raw(messages):
        calls["n"] += 1
        return '{"i": 1}'

    c._raw_complete = fake_raw
    # consume the budget
    _run(c.complete_json("s", "u1"))
    _run(c.complete_json("s", "u2"))
    # third call is over budget → None, API not hit a third time
    assert _run(c.complete_json("s", "u3")) is None
    assert calls["n"] == 2


def test_get_client_defaults_to_disabled():
    # config default MINIMAX_ENABLED=False → safe by default
    assert get_client().enabled is False
