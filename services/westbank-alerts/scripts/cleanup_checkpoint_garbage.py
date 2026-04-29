"""
One-shot cleanup — remove checkpoint rows that match the garbage filter
in checkpoint_db._accept_checkpoint_name. This is intentionally narrower
than "everything not in the whitelist" because the live ahwalaltreq
channel reports many real Palestinian villages that aren't curated yet.

What it deletes:
  - canonical_keys that match _EXACT_GARBAGE (status / restriction words)
  - canonical_keys containing any _GARBAGE_TOKENS substring
    (concatenated phrases ending in status words, typo patterns)
  - canonical_keys outside reasonable length bounds

Background: until 2026-04-29 the parser auto-created checkpoint entries
from any extracted phrase. The fix in checkpoint_db.insert_checkpoint_update
gates inserts going forward; this script cleans the historical mess.

Three tables touched:
  - checkpoints           (canonical row)
  - checkpoint_status     (current state)
  - checkpoint_updates    (history — KEEPS by default for audit; opt-in --purge-updates)

Usage (default = dry-run):
    docker exec params-alerts-api python /app/scripts/cleanup_checkpoint_garbage.py [--apply] [--purge-updates]
"""
import argparse
import asyncio
import sys

sys.path.insert(0, "/app")

from app.checkpoint_db import _accept_checkpoint_name
from app.checkpoint_knowledge_base import load_knowledge_base
from app.config import settings
from app.db_pool import init_pool, close_pool, get_checkpoint_db


async def cleanup(apply: bool, purge_updates: bool) -> dict:
    # Load KB so the whitelist short-circuit in _accept_checkpoint_name works
    kb = await load_knowledge_base()
    print(f"[KB] loaded {len(kb.all_canonical_keys())} canonical checkpoints")

    await init_pool(settings.DB_PATH, '/data/checkpoints.db')
    async with get_checkpoint_db() as db:
        cur = await db.execute("SELECT canonical_key, name_ar FROM checkpoints")
        all_rows = await cur.fetchall()

    garbage = []
    for k, n in all_rows:
        if not _accept_checkpoint_name({"canonical_key": k, "name_raw": n or ""}):
            garbage.append((k, n))

    print(f"[scan] {len(all_rows)} rows in `checkpoints`")
    print(f"[scan] {len(garbage)} match garbage filter → would delete")
    print(f"[scan] {len(all_rows) - len(garbage)} kept (whitelist + non-garbage)")

    print("\nFirst 30 garbage candidates:")
    for k, n in garbage[:30]:
        print(f"  {k!r:55}  {(n or '')!r}")

    if not apply:
        print("\nDry-run only. Re-run with --apply to delete.")
        await close_pool()
        return {"scanned": len(all_rows), "garbage": len(garbage), "deleted": 0}

    async with get_checkpoint_db() as db:
        d_cps = d_status = d_upd = 0
        for k, _ in garbage:
            cur = await db.execute("DELETE FROM checkpoints WHERE canonical_key = ?", (k,))
            d_cps += cur.rowcount
            cur = await db.execute("DELETE FROM checkpoint_status WHERE canonical_key = ?", (k,))
            d_status += cur.rowcount
            if purge_updates:
                cur = await db.execute("DELETE FROM checkpoint_updates WHERE canonical_key = ?", (k,))
                d_upd += cur.rowcount
        await db.commit()

    print(f"\n[apply] deleted: checkpoints={d_cps}, "
          f"checkpoint_status={d_status}, "
          f"checkpoint_updates={d_upd if purge_updates else '(kept for audit)'}")
    await close_pool()
    return {
        "scanned": len(all_rows), "garbage": len(garbage),
        "deleted_checkpoints": d_cps, "deleted_status": d_status,
        "deleted_updates": d_upd,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Actually delete (default dry-run)")
    ap.add_argument("--purge-updates", action="store_true",
                    help="Also delete from checkpoint_updates (default keeps for audit)")
    args = ap.parse_args()
    asyncio.run(cleanup(args.apply, args.purge_updates))


if __name__ == "__main__":
    main()
