"""Bind the live checkpoint catalog -> wbkb live_status.

Pulls current statuses (from the live API or a local geojson snapshot), maps each
checkpoint name to a wbkb feed_key, and writes them into live_status so the router
sees real-time status on the named corridor checkpoints.

    python3 -m ingestion.live_bind                         # fetch live API
    python3 -m ingestion.live_bind ../data/our_checkpoints.geojson   # local snapshot
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone

from engine import db as DB
from engine.kb_io import set_live_status, now_iso
from ingestion.telegram_adapter import match_feed_key

LIVE_URL = "https://wb-alerts.zaidlab.xyz/v2/checkpoints/geojson"
# normalize the live status vocabulary to the router's
STATUS_MAP = {
    "open": "open", "closed": "closed", "congested": "congested", "slow": "slow",
    "idf": "idf", "police": "police", "inspection": "inspection", "crisis": "congested",
    "unknown": "unknown",
}


def _features(src: str | None) -> list[dict]:
    if src and src not in ("-", "live"):
        return json.loads(open(src, encoding="utf-8").read()).get("features", [])
    req = urllib.request.Request(LIVE_URL, headers={"User-Agent": "wbkb-live-bind/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 (trusted host)
        return json.loads(r.read().decode()).get("features", [])


def _status_of(props: dict) -> str | None:
    raw = props.get("effective_status") or (props.get("live") or {}).get("status")
    return STATUS_MAP.get(str(raw).lower()) if raw else None


def _name_of(props: dict) -> str:
    return " ".join(str(props.get(k) or "") for k in ("name_ar", "name_en", "canonical_key"))


def bind(src: str | None = None, conn=None, now: datetime | None = None) -> dict:
    own = conn is None
    conn = conn or DB.connect()
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S+00:00") if now else now_iso()
    try:
        feats = _features(src)
        bound, seen = 0, {}
        for f in feats:
            props = f.get("properties") or {}
            fk = match_feed_key(_name_of(props))
            st = _status_of(props)
            if not fk or not st or fk in seen:
                continue
            set_live_status(conn, fk, st, stamp, "live_catalog")
            seen[fk] = st
            bound += 1
        return {"features": len(feats), "bound": bound, "statuses": seen}
    finally:
        if own:
            conn.close()


if __name__ == "__main__":
    print(json.dumps(bind(sys.argv[1] if len(sys.argv) > 1 else None), ensure_ascii=False, indent=2))
