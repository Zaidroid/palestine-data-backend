"""Live feed -> {feed_key: status}. Authoritative for OPEN/CLOSED right now.

Parses Arabic + English checkpoint messages from the channels into a status per
feed_key. Status is timestamped; ``current_statuses`` drops signals older than
the TTL (default 1.5 days) so the router reverts to the cautious ``partial``
default instead of trusting a stale "open".

    "حاجز المربعة مسكر"  -> {"murabbaa": "closed"}
    "Zaatara open now"   -> {"zaatara": "open"}
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

FEED_TTL_DAYS = 1.5

# status keyword -> canonical status (most specific first when scanning)
STATUS_WORDS: list[tuple[str, str]] = [
    # closed
    ("مسكر", "closed"), ("مسكّر", "closed"), ("سكر", "closed"), ("مغلق", "closed"), ("مغلقة", "closed"),
    ("مقفل", "closed"), ("اغلاق", "closed"), ("إغلاق", "closed"), ("سدّ", "closed"), ("مسدود", "closed"),
    ("closed", "closed"), ("shut", "closed"), ("blocked", "closed"),
    # congested / crisis
    ("ازمة", "congested"), ("أزمة", "congested"), ("زحمة", "congested"), ("ازدحام", "congested"),
    ("اكتظاظ", "congested"), ("تكدس", "congested"), ("وقفة", "congested"),
    ("congested", "congested"), ("jam", "congested"), ("packed", "congested"), ("crowded", "congested"),
    # army / raid
    ("جيش", "idf"), ("اقتحام", "idf"), ("حملة", "idf"), ("دهم", "idf"),
    ("raid", "idf"), ("army", "idf"),
    # inspection
    ("تفتيش", "inspection"), ("تدقيق", "inspection"), ("فحص", "inspection"), ("inspection", "inspection"),
    # open
    ("سالك", "open"), ("سالكة", "open"), ("مفتوح", "open"), ("مفتوحة", "open"), ("فاتح", "open"),
    ("انفراج", "open"), ("سالكه", "open"), ("open", "open"), ("clear", "open"), ("flowing", "open"),
]

# checkpoint name (substring, normalized) -> feed_key
NAME_TO_FEED: list[tuple[str, str]] = [
    ("المربعة", "murabbaa"), ("مربعة", "murabbaa"), ("murabbaa", "murabbaa"), ("murabba", "murabbaa"),
    ("حوارة", "huwwara"), ("حوّارة", "huwwara"), ("huwwara", "huwwara"), ("hawara", "huwwara"),
    ("زعترة", "zaatara"), ("زعتره", "zaatara"), ("تبوح", "zaatara"), ("zaatara", "zaatara"), ("tapuach", "zaatara"),
    ("عطارة", "atara"), ("عطاره", "atara"), ("atara", "atara"),
    ("عين سينيا", "ein_siniya"), ("ein siniya", "ein_siniya"),
    ("قلنديا", "qalandiya"), ("qalandiya", "qalandiya"), ("qalandia", "qalandiya"),
    ("جبع", "jaba"), ("jaba", "jaba"),
    ("الكونتينر", "container"), ("كونتينر", "container"), ("وادي النار", "container"), ("container", "container"),
    ("عورتا", "awarta"), ("awarta", "awarta"),
    ("دير شرف", "deir_sharaf"), ("deir sharaf", "deir_sharaf"),
    ("بيت ايبا", "beit_iba"), ("بيت إيبا", "beit_iba"), ("beit iba", "beit_iba"),
    ("صرة", "sarra"), ("sarra", "sarra"),
    ("الحمرا", "hamra"), ("حمرا", "hamra"), ("hamra", "hamra"),
    ("التياسير", "tayasir"), ("تياسير", "tayasir"), ("tayasir", "tayasir"),
    ("بيت فوريك", "beit_furik"), ("beit furik", "beit_furik"),
    ("شافي شمرون", "shavei_shomron"), ("shavei shomron", "shavei_shomron"),
    ("النبي الياس", "nabi_elias"), ("nabi elias", "nabi_elias"),
]

_AR_DIAC = re.compile(r"[ً-ْٰ]")


def _norm(s: str) -> str:
    s = (s or "").lower()
    s = _AR_DIAC.sub("", s)            # strip Arabic diacritics
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه")
    return re.sub(r"\s+", " ", s).strip()


def match_feed_key(text: str) -> str | None:
    """Map a checkpoint name (AR or EN) to its feed_key, longest name first so a
    short name can't fire inside a longer one. Used to bind the live catalog."""
    n = _norm(text)
    for name, key in sorted(NAME_TO_FEED, key=lambda nk: len(_norm(nk[0])), reverse=True):
        if _norm(name) in n:
            return key
    return None


def parse_message(text: str) -> dict[str, str]:
    """One message -> {feed_key: status} for every checkpoint named in it."""
    n = _norm(text)
    status = None
    for word, st in STATUS_WORDS:
        if _norm(word) in n:
            status = st
            break
    if status is None:
        return {}
    out: dict[str, str] = {}
    work = n
    # longest name first, blanking each match so a short name (atara) can't also
    # fire inside a longer one (zaatara)
    for name, key in sorted(NAME_TO_FEED, key=lambda nk: len(_norm(nk[0])), reverse=True):
        nm = _norm(name)
        if nm and nm in work:
            out[key] = status
            work = work.replace(nm, " ")
    return out


def ingest_feed(messages: list[dict], now: datetime | None = None) -> dict[str, dict]:
    """messages: [{text, channel?, ts?}] -> {feed_key: {status, ts, channel}}.
    Latest message per feed_key wins."""
    now = now or datetime.now(timezone.utc)
    latest: dict[str, dict] = {}
    for m in messages:
        ts = m.get("ts") or now.isoformat()
        for key, status in parse_message(m.get("text", "")).items():
            prev = latest.get(key)
            if prev is None or ts >= prev["ts"]:
                latest[key] = {"status": status, "ts": ts, "channel": m.get("channel")}
    return latest


def current_statuses(feed_state: dict[str, dict], now: datetime | None = None, ttl_days: float = FEED_TTL_DAYS) -> dict[str, str]:
    """Drop expired signals -> {feed_key: status} for the router. Expired keys are
    omitted so the router falls back to the cautious 'partial' default."""
    from engine.confidence import age_days
    out: dict[str, str] = {}
    for key, sig in feed_state.items():
        if age_days(sig["ts"], now) <= ttl_days:
            out[key] = sig["status"]
    return out


def ingest_to_db(messages: list[dict], conn=None, now: datetime | None = None) -> dict:
    """Parse a batch of channel messages and persist each into live_status
    (last-wins). This is what a feed worker calls; the router reads back via
    kb_io.get_live_statuses."""
    from engine import db as DB
    from engine.kb_io import set_live_status
    own = conn is None
    conn = conn or DB.connect()
    try:
        state = ingest_feed(messages, now)
        for key, sig in state.items():
            set_live_status(conn, key, sig["status"], sig["ts"], sig.get("channel"))
        return {"messages": len(messages), "updated": len(state)}
    finally:
        if own:
            conn.close()


if __name__ == "__main__":
    import json
    import sys
    demo = [
        {"text": "حاجز المربعة مسكر تماماً", "channel": "demo"},
        {"text": "زعترة سالك الحمدلله", "channel": "demo"},
        {"text": "Qalandiya congested heavy jam", "channel": "demo"},
    ]
    if len(sys.argv) > 1:
        demo = json.loads(open(sys.argv[1], encoding="utf-8").read())
    state = ingest_feed(demo)
    print(json.dumps({"feed_state": state, "current": current_statuses(state)}, ensure_ascii=False, indent=2))
