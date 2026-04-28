"""
Closed-loop self-improvement workers.

Two daily aggregation jobs that run alongside the monitor and turn passive
data (retracted alerts + stale review queue) into active classifier
adjustments. Both are idempotent and safe to re-run.

  - aggregate_retractions_to_overrides() — A2 loop closure
        Mines `alerts WHERE status='retracted'` over the last 30 days,
        groups by (source, type). When a (source, type) pair has >=7
        retractions and no existing override, INSERTs a -0.10 weight_delta
        into keyword_weight_overrides so the classifier downweights that
        pair on its next refresh (every 6h).

  - auto_resolve_stale_review_queue(min_age_hours=24) — B6 loop closure
        Alerts in the review queue older than 24h with no admin verdict
        and no retraction get auto-marked verdict='auto_tp'. Assumption:
        silence + no contradicting source within a day is implicit
        confirmation. Removes the queue from "fills forever, nobody reads"
        to "self-draining unless flagged."

  - run_volume_anomaly_check() — A3 scheduler hook
        The anomaly detector existed but had no scheduler — manual
        /admin/anomalies?run=true was the only trigger. Now runs every
        hour as part of the same background task.

All three are wrapped in run_periodic() which fires once on startup (after
a small delay so the monitor settles), then once an hour thereafter.
"""

import asyncio
import logging
from datetime import datetime, timedelta

from .db_pool import get_alerts_db

log = logging.getLogger("learner_overrides")

# Tunables — chosen to match the prior plan's stated thresholds.
RETRACTION_MIN_COUNT = 7        # Need this many retractions to act
RETRACTION_LOOKBACK_DAYS = 30
RETRACTION_WEIGHT_DELTA = -0.10
REVIEW_AUTO_TP_AGE_HOURS = 24
TICK_INTERVAL_SECONDS = 3600    # Hourly


async def aggregate_retractions_to_overrides() -> int:
    """A2 loop closure. Returns the number of new overrides written."""
    cutoff = (datetime.utcnow() - timedelta(days=RETRACTION_LOOKBACK_DAYS)).isoformat()
    written = 0
    async with get_alerts_db() as db:
        cur = await db.execute(
            """SELECT source, type, COUNT(*) AS n
               FROM alerts
               WHERE status = 'retracted' AND timestamp >= ?
                 AND source IS NOT NULL AND type IS NOT NULL
               GROUP BY source, type
               HAVING n >= ?""",
            (cutoff, RETRACTION_MIN_COUNT),
        )
        candidates = await cur.fetchall()

        for source, alert_type, n in candidates:
            channel = source.lower()
            cur = await db.execute(
                "SELECT 1 FROM keyword_weight_overrides "
                "WHERE channel = ? AND event_type = ? LIMIT 1",
                (channel, alert_type),
            )
            if await cur.fetchone():
                continue
            await db.execute(
                "INSERT INTO keyword_weight_overrides "
                "(channel, event_type, weight_delta, basis, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    channel, alert_type, RETRACTION_WEIGHT_DELTA,
                    f"auto: {n} retractions in last {RETRACTION_LOOKBACK_DAYS}d",
                    datetime.utcnow().isoformat(),
                ),
            )
            written += 1
            log.info(
                f"A2: new override channel={channel} type={alert_type} "
                f"delta={RETRACTION_WEIGHT_DELTA} (basis: {n} retractions)"
            )
        if written:
            await db.commit()
    return written


async def auto_resolve_stale_review_queue() -> int:
    """B6 loop closure. Returns the number of queue entries auto-resolved."""
    cutoff = (datetime.utcnow() - timedelta(hours=REVIEW_AUTO_TP_AGE_HOURS)).isoformat()
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        # Only auto-resolve when the corresponding alert was NOT retracted —
        # silence on a still-active alert is the implicit "looks fine" signal.
        cur = await db.execute(
            """UPDATE alert_review_queue
               SET reviewed_at = ?, verdict = 'auto_tp',
                   note = 'auto-resolved: no admin verdict + alert still active after 24h'
               WHERE reviewed_at IS NULL
                 AND queued_at <= ?
                 AND alert_id IN (SELECT id FROM alerts WHERE status = 'active')""",
            (now, cutoff),
        )
        n = cur.rowcount
        await db.commit()
    if n:
        log.info(f"B6: auto-resolved {n} review-queue entries to verdict=auto_tp")
    return n


async def run_volume_anomaly_check() -> None:
    """A3 scheduler hook. Wraps the existing detector so it actually runs."""
    try:
        from . import anomaly
        await anomaly.check_volume_anomalies()
    except Exception as e:
        log.warning(f"A3: anomaly check failed: {e}")


async def run_periodic(initial_delay_s: int = 120) -> None:
    """Start the periodic cycle. First tick after `initial_delay_s` so the
    monitor and DB pool have settled; subsequent ticks every hour."""
    await asyncio.sleep(initial_delay_s)
    while True:
        try:
            n_overrides = await aggregate_retractions_to_overrides()
            n_resolved = await auto_resolve_stale_review_queue()
            await run_volume_anomaly_check()
            log.info(
                f"learner_overrides cycle: A2 wrote {n_overrides} override(s); "
                f"B6 auto-resolved {n_resolved}; A3 anomaly check ran"
            )
        except Exception as e:
            log.exception(f"learner_overrides cycle failed: {e}")
        await asyncio.sleep(TICK_INTERVAL_SECONDS)
