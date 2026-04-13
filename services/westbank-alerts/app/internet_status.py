"""
Internet connectivity status for Palestine via IODA (Georgia Tech).

IODA (Internet Outage Detection and Analysis) provides three independent
signal sources for Palestine:

  - BGP:          Number of visible BGP prefixes (routes). A drop = routing outage.
  - ping-slash24: Active probing of /24 blocks. Measures reachability from outside.
  - merit-nt:     Google Transparency Report traffic data. Measures actual user traffic.

All data is free, no API key needed.  We compare current values against a
rolling baseline to detect anomalies and report a simple health status.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger("internet_status")

IODA_BASE = "https://api.ioda.inetintel.cc.gatech.edu/v2"
COUNTRY_CODE = "PS"

# Data sources we track
SOURCES = ["bgp", "ping-slash24", "merit-nt"]

SOURCE_LABELS = {
    "bgp":          "BGP Prefix Count",
    "ping-slash24": "Active Probing (Reachability)",
    "merit-nt":     "Google Traffic (Merit-NT)",
}

SOURCE_DESCRIPTIONS = {
    "bgp":          "Number of visible BGP routes to Palestine. A significant drop indicates routing-level disruption.",
    "ping-slash24": "Active pings to Palestine /24 blocks from external vantage points. Measures reachability.",
    "merit-nt":     "Normalized internet traffic volume from Google Transparency Report. Measures actual user activity.",
}

# Health thresholds — fraction of baseline below which we flag
OUTAGE_THRESHOLD = 0.50    # <50% of baseline = outage
DEGRADED_THRESHOLD = 0.80  # <80% of baseline = degraded

# ── Cache ────────────────────────────────────────────────────────────────────

CACHE_TTL = 300  # 5 minutes

_cache: Optional[Dict[str, Any]] = None
_cache_time: float = 0.0

# ── Fetcher ──────────────────────────────────────────────────────────────────

_HEADERS = {"User-Agent": "WestBankAlerts/1.0 (Palestinian conditions API)"}


async def _fetch_signals(window_seconds: int = 7200) -> List[Dict[str, Any]]:
    """
    Fetch raw signal data for Palestine from IODA.
    Returns the last `window_seconds` of data for all sources.
    """
    now = int(time.time())
    start = now - window_seconds

    url = f"{IODA_BASE}/signals/raw/country/{COUNTRY_CODE}"
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=15.0, headers=_HEADERS,
    ) as client:
        resp = await client.get(url, params={
            "from": start,
            "until": now,
        })
    resp.raise_for_status()
    return resp.json().get("data", [])


def _analyze_source(item: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze a single IODA data source for health status."""
    source = item.get("datasource", "unknown")
    values = item.get("values", [])
    step = item.get("step", 300)

    # Filter out None values
    valid = [v for v in values if v is not None]

    if not valid:
        return {
            "source":      source,
            "label":       SOURCE_LABELS.get(source, source),
            "status":      "no_data",
            "description": SOURCE_DESCRIPTIONS.get(source, ""),
        }

    current = valid[-1]
    # Use first half as baseline, second half as recent
    midpoint = len(valid) // 2
    if midpoint > 0:
        baseline = sum(valid[:midpoint]) / midpoint
    else:
        baseline = current

    # Compute health ratio
    ratio = current / baseline if baseline > 0 else 1.0

    if ratio < OUTAGE_THRESHOLD:
        status = "outage"
    elif ratio < DEGRADED_THRESHOLD:
        status = "degraded"
    else:
        status = "normal"

    return {
        "source":      source,
        "label":       SOURCE_LABELS.get(source, source),
        "description": SOURCE_DESCRIPTIONS.get(source, ""),
        "status":      status,
        "current":     round(current, 1),
        "baseline":    round(baseline, 1),
        "ratio":       round(ratio, 3),
        "points":      len(valid),
        "step_seconds": step,
    }


def _overall_status(sources: List[Dict[str, Any]]) -> str:
    """Determine overall connectivity status from individual source statuses."""
    statuses = {s["status"] for s in sources if s["status"] != "no_data"}
    if "outage" in statuses:
        return "outage"
    if "degraded" in statuses:
        return "degraded"
    if statuses:
        return "normal"
    return "unknown"


STATUS_LABELS = {
    "normal":   {"en": "Normal",   "ar": "طبيعي"},
    "degraded": {"en": "Degraded", "ar": "متدهور"},
    "outage":   {"en": "Outage",   "ar": "انقطاع"},
    "unknown":  {"en": "Unknown",  "ar": "غير معروف"},
}


async def get_internet_status() -> Dict[str, Any]:
    """
    Return Palestine internet connectivity status.

    Compares current signal values against a 2-hour rolling baseline
    for each of three independent data sources (BGP, ping, traffic).
    """
    global _cache, _cache_time

    if _cache and (time.time() - _cache_time) < CACHE_TTL:
        return {**_cache, "cached": True}

    try:
        raw_data = await _fetch_signals(window_seconds=7200)

        # IODA returns nested lists: data is [[source1, source2, ...]]
        sources_analyzed = []
        if raw_data:
            items = raw_data
            # Flatten if nested
            if items and isinstance(items[0], list):
                items = [item for group in items for item in group]

            for item in items:
                if isinstance(item, dict) and item.get("datasource") in SOURCES:
                    sources_analyzed.append(_analyze_source(item))

        overall = _overall_status(sources_analyzed)
        labels = STATUS_LABELS.get(overall, STATUS_LABELS["unknown"])

        _cache = {
            "status":       overall,
            "status_label": labels["en"],
            "status_ar":    labels["ar"],
            "country":      "Palestine",
            "country_code": COUNTRY_CODE,
            "sources":      sources_analyzed,
            "source":       "IODA (Georgia Tech)",
            "source_url":   f"https://ioda.inetintel.cc.gatech.edu/country/{COUNTRY_CODE}",
            "note":         "Compares current signals against 2-hour rolling baseline. "
                            "Three independent sources: BGP routing, active probing, Google traffic.",
            "fetched_at":   datetime.now(timezone.utc).isoformat(),
        }
        _cache_time = time.time()
        log.info(f"Internet status refreshed: {overall} ({len(sources_analyzed)} sources)")
        return _cache

    except Exception as e:
        log.warning(f"Internet status fetch failed: {e}")

    if _cache:
        return {**_cache, "stale": True}

    return {
        "status":       "unknown",
        "status_label": "Unknown",
        "status_ar":    "غير معروف",
        "country":      "Palestine",
        "sources":      [],
        "source":       "unavailable",
        "error":        "fetch failed",
    }
