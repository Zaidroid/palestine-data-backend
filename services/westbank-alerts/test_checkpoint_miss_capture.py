"""Phase 3a: a validated-but-unknown checkpoint name (passes the garbage filter
but isn't in the whitelist) is captured into a `misses` sink so the monitor can
accrue it as a candidate (upsert_candidate) — turning the ~67% of checkpoint
messages that currently drop silently into an auditable queue. Known checkpoints
and garbage lines record no miss.
"""
import os
os.environ.setdefault("API_SECRET_KEY", "test-secret-key-0123456789abcdef")

from app.checkpoint_knowledge_base import CheckpointKnowledgeBase
from app.checkpoint_parser import _normalise
from app.checkpoint_whitelist_parser import parse_checkpoint_message


def _kb():
    kb = CheckpointKnowledgeBase()
    cp = {"canonical_key": "حواره", "name_ar": "حوارة", "name_en": "Huwara",
          "region": "nablus", "checkpoint_type": "checkpoint",
          "latitude": 32.1587, "longitude": 35.2538}
    kb.by_canonical_key[cp["canonical_key"]] = cp
    n = _normalise(cp["name_ar"])
    kb.by_name_norm[n] = cp["canonical_key"]
    kb.all_names.append((n, cp["canonical_key"]))
    kb.all_names.sort(key=lambda x: -len(x[0]))
    return kb


def test_known_checkpoint_records_no_miss():
    misses = []
    updates = parse_checkpoint_message("حوارة: مغلق", _kb(), misses=misses)
    assert updates and updates[0]["canonical_key"] == "حواره"
    assert misses == []


def test_unknown_validated_name_is_captured_as_miss():
    misses = []
    # "بيت فوريك" is a plausible checkpoint name not in this KB → captured.
    updates = parse_checkpoint_message("بيت فوريك: مغلق", _kb(), misses=misses)
    assert updates == []
    assert any("فوريك" in m for m in misses), misses


def test_misses_sink_is_optional_and_defaults_off():
    # No sink passed → behaves exactly as before (catchup path unaffected).
    updates = parse_checkpoint_message("بيت فوريك: مغلق", _kb())
    assert updates == []


# ── integration: the monitor's capture path accrues a candidate ───────────────
import asyncio
from app import db_pool
from app import checkpoint_db as cpdb


def test_monitor_style_capture_accrues_candidate(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            kb = _kb()
            # Two messages name the same unknown checkpoint → mentions accrue.
            for _ in range(2):
                misses = []
                parse_checkpoint_message("بيت فوريك: مغلق", kb, misses=misses)
                for name in misses:
                    await cpdb.upsert_candidate(raw_name=name, normalized=_normalise(name),
                                                absolute=False)
            async with db_pool.get_checkpoint_db() as db:
                cur = await db.execute(
                    "SELECT raw_name, mentions, status FROM checkpoint_candidates")
                return await cur.fetchall()
        finally:
            await db_pool.close_pool()

    rows = asyncio.run(go())
    assert len(rows) == 1                 # one candidate (deduped by normalized)
    assert "فوريك" in rows[0][0]
    assert rows[0][1] == 2                # mentions accrued across both messages
    assert rows[0][2] == "pending"
