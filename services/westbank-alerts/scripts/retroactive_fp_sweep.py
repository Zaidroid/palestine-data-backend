"""
Retroactive FP sweep — re-run the current classifier against the last
N days of active alerts and mark anything it would now filter as
status='retracted' with correction_note='retroactive_fp_filter:<reason>'.

Why: every time we add new FP filter families (SPOKESPERSON_LEADING,
ACTIVISM_COMMENTARY, OFF_TOPIC_LEAK, etc.) the live tracker stops
emitting those FPs going forward, but the historical DB still carries
them as active. This script cleans them up, which:

  - Makes /channel-reliability fp_rate_30d numbers reflect the REAL
    classifier behavior, not historical state
  - Feeds the A2 retraction → keyword_weight_overrides loop
    (learner_overrides.py) so it learns from the cleanup
  - Removes stale incidents that the grouper merged FPs into

Idempotent — re-running with no new filter changes is a no-op
(already-retracted alerts are skipped).

Usage (inside container):
    docker exec params-alerts-api python /app/scripts/retroactive_fp_sweep.py [--days 30] [--apply]

By default this is a DRY RUN — it scans + reports candidates without
modifying the DB. Pass --apply to actually mark them retracted. This is
intentional: a noisy filter could over-retract real events. Always
review the dry-run sample first.
"""
import argparse
import asyncio
import sys
from pathlib import Path

# Make the app importable when run as `docker exec ... python script.py`.
sys.path.insert(0, "/app")

from app.config import settings
from app.db_pool import init_pool, close_pool, get_alerts_db
from app.classifier import classify, classify_wb_operational, is_security_relevant


def _classify(text, source):
    if is_security_relevant(text):
        r = classify(text, source)
        if r is not None:
            return r
    return classify_wb_operational(text, source)


async def sweep(days: int, dry_run: bool) -> dict:
    """Returns counts of {scanned, would_retract, retracted}."""
    cutoff = f"datetime('now','-{int(days)} days')"
    await init_pool(settings.DB_PATH, '/data/checkpoints.db')

    async with get_alerts_db() as db:
        cur = await db.execute(
            f"SELECT id, type, source, raw_text FROM alerts "
            f"WHERE status='active' AND timestamp >= {cutoff}"
        )
        rows = await cur.fetchall()

    total = len(rows)
    to_retract: list[tuple[int, str, str, str]] = []  # (id, old_type, source, raw_text)

    for alert_id, old_type, source, raw_text in rows:
        if not raw_text:
            continue
        # Re-classify under the current rules.
        result = _classify(raw_text, source)
        if result is None:
            # Filter would now drop this entirely.
            to_retract.append((alert_id, old_type, source, raw_text[:100]))

    print(f"scanned={total}, would_retract={len(to_retract)}")

    if dry_run:
        print("\nDry-run sample (first 10 candidates):")
        for aid, ot, src, txt in to_retract[:10]:
            print(f"  #{aid:6} {ot:18} {src:14} {txt}")
        await close_pool()
        return {"scanned": total, "would_retract": len(to_retract), "retracted": 0}

    # Apply retraction in batches.
    note = "retroactive_fp_filter"
    retracted = 0
    async with get_alerts_db() as db:
        for aid, _, _, _ in to_retract:
            await db.execute(
                "UPDATE alerts SET status='retracted', correction_note=? WHERE id=? AND status='active'",
                (note, aid),
            )
            retracted += 1
        await db.commit()
    print(f"retracted={retracted}")
    await close_pool()
    return {"scanned": total, "would_retract": len(to_retract), "retracted": retracted}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--apply", action="store_true",
                    help="Actually mark candidates as retracted. Default is dry-run.")
    args = ap.parse_args()
    asyncio.run(sweep(args.days, dry_run=not args.apply))


if __name__ == "__main__":
    main()
