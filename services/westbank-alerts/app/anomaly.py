"""
A3 — volume anomaly detection.

For each (event_type, source) pair, count alerts in the last hour and
compare against the trailing 24h hourly baseline (mean ± std). When
the 1h count exceeds mean + 3*std AND mean has been built from at
least a few non-zero hours (avoids false positives on quiet sources),
record an anomaly.

The system tells YOU when something is off, instead of you having to
notice in the dashboard.
"""

import math
from datetime import datetime, timedelta
from typing import Optional

from .db_pool import get_alerts_db


SIGMA_THRESHOLD = 3.0
MIN_BASELINE_HOURS = 6     # Need ≥6 hours of data to trust the std
MIN_SPIKE_COUNT = 3        # Don't flag spikes of 1 or 2; noise

# Hours to evaluate per cycle. The current (in-progress) bucket is included
# even when partial — but the previous (just-completed) bucket is the most
# useful since the detector runs hourly and this catches end-of-hour bursts
# that the cycle-prior run missed because the bucket was not yet populated.
_BUCKETS_TO_EVAL = ("previous", "current")


async def check_volume_anomalies(now: Optional[datetime] = None) -> list[dict]:
    """Detect volume spikes vs trailing 24h baseline. Persists each
    new anomaly into the anomalies table; returns the list (with both
    newly-found and any rows from the current hour, deduped on the
    UNIQUE index)."""
    if now is None:
        now = datetime.utcnow()
    current_bucket = now.strftime("%Y-%m-%dT%H")
    previous_bucket = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H")
    last_hour_start = now - timedelta(hours=1)
    baseline_start = now - timedelta(hours=25)
    baseline_end = now - timedelta(hours=1)

    detected = []
    async with get_alerts_db() as db:
        # Pull all active alerts in the trailing 25h window
        cur = await db.execute(
            "SELECT id, type, source, timestamp FROM alerts "
            "WHERE timestamp >= ? AND status = 'active'",
            (baseline_start.isoformat(),),
        )
        rows = await cur.fetchall()

    # Group: per (type, source, hour-bucket) → count
    counts_by_key_hour: dict[tuple, dict[str, int]] = {}
    last_hour_alert_ids: dict[tuple, list[int]] = {}
    for row in rows:
        alert_id, etype, source, ts = row
        if not ts or not etype:
            continue
        try:
            t = datetime.fromisoformat(ts)
        except ValueError:
            continue
        hour_key = t.strftime("%Y-%m-%dT%H")
        key = (etype, source or "")
        per_hour = counts_by_key_hour.setdefault(key, {})
        per_hour[hour_key] = per_hour.get(hour_key, 0) + 1
        if t >= last_hour_start:
            last_hour_alert_ids.setdefault(key, []).append(alert_id)

    # For each (type, source): compute baseline mean+std from 24 prior hours,
    # check BOTH the previous (just-completed) bucket AND the current
    # (in-progress) bucket against the threshold. Previously this only
    # checked the current bucket, which routinely missed end-of-hour bursts
    # that completed before the next hourly cycle ran (the cycle would see
    # the bucket as "now empty" since time had moved on).
    for key, per_hour in counts_by_key_hour.items():
        etype, source = key
        # Baseline = the 24 prior hours (not including the current bucket)
        baseline_counts = [
            per_hour.get((baseline_start + timedelta(hours=h)).strftime("%Y-%m-%dT%H"), 0)
            for h in range(24)
        ]
        non_zero = [c for c in baseline_counts if c > 0]
        if len(non_zero) < MIN_BASELINE_HOURS:
            continue
        n = len(baseline_counts)
        mean = sum(baseline_counts) / n
        var = sum((c - mean) ** 2 for c in baseline_counts) / n
        std = math.sqrt(var)
        # If std is exactly 0 the source has been perfectly steady — any
        # spike at all is anomalous. Use mean as a soft floor.
        threshold = mean + SIGMA_THRESHOLD * max(std, 0.5)

        for bucket_to_check in (previous_bucket, current_bucket):
            count_in_bucket = per_hour.get(bucket_to_check, 0)
            if count_in_bucket < MIN_SPIKE_COUNT:
                continue
            if count_in_bucket <= threshold:
                continue
            sigma = (count_in_bucket - mean) / max(std, 0.5)
            # Sample IDs only available for the current-bucket check (the
            # last_hour_alert_ids dict was built from `t >= last_hour_start`).
            sample_ids = (last_hour_alert_ids.get(key, [])[:10]
                          if bucket_to_check == current_bucket else [])

            async with get_alerts_db() as db:
                await db.execute(
                    """INSERT INTO anomalies
                       (event_type, source, bucket_hour, count_1h, baseline_mean,
                        baseline_std, sigma, sample_alert_ids, detected_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(event_type, source, bucket_hour) DO UPDATE SET
                           count_1h         = excluded.count_1h,
                           baseline_mean    = excluded.baseline_mean,
                           baseline_std     = excluded.baseline_std,
                           sigma            = excluded.sigma,
                           sample_alert_ids = excluded.sample_alert_ids,
                           detected_at      = excluded.detected_at""",
                    (etype, source, bucket_to_check, count_in_bucket,
                     round(mean, 2), round(std, 2), round(sigma, 2),
                     ",".join(str(i) for i in sample_ids),
                     now.isoformat()),
                )
                await db.commit()

            detected.append({
                "event_type": etype,
                "source": source,
                "bucket_hour": bucket_to_check,
                "count_1h": count_in_bucket,
                "baseline_mean": round(mean, 2),
                "baseline_std": round(std, 2),
                "sigma": round(sigma, 2),
                "sample_alert_ids": sample_ids,
            })

    return detected


async def list_recent_anomalies(hours: int = 24, limit: int = 50) -> list[dict]:
    """List recent anomalies (already persisted), newest first."""
    since = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    async with get_alerts_db() as db:
        cur = await db.execute(
            "SELECT event_type, source, bucket_hour, count_1h, baseline_mean, "
            "baseline_std, sigma, sample_alert_ids, detected_at "
            "FROM anomalies WHERE detected_at >= ? "
            "ORDER BY detected_at DESC LIMIT ?",
            (since, limit),
        )
        rows = await cur.fetchall()
    return [
        {
            "event_type": r[0], "source": r[1], "bucket_hour": r[2],
            "count_1h": r[3], "baseline_mean": r[4], "baseline_std": r[5],
            "sigma": r[6],
            "sample_alert_ids": [int(x) for x in (r[7] or "").split(",") if x],
            "detected_at": r[8],
        }
        for r in rows
    ]
