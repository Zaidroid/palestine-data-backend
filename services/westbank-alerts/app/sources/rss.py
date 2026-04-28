"""B2 — RSS poller. Polls a small set of high-volume Arabic news feeds
and hands each entry's text to monitor._process_text. The classifier and
all downstream stages (corroboration, review queue, entity extraction,
incident grouping) are unchanged — they work the same regardless of
whether text came from Telegram or RSS.

We classify on the entry **title** only. Bodies are full articles that
contain analysis, recap, and meta-discussion which the FP filters were
designed for short Telegram-message text — feeding the body in would
spike false-positives. Title-only keeps the input shape comparable.
"""

import asyncio
import hashlib
import logging
from datetime import datetime
from time import struct_time, mktime
from typing import Optional

import feedparser
import httpx

from .. import monitor

log = logging.getLogger(__name__)

# RSS feed list — Arabic-only (the classifier's keyword/regex stack is
# Arabic-tuned, English content yields almost no extraction). Telegram-
# polled sources (qudsn, ajanews, palinfoar, wafagency) are intentionally
# NOT duplicated as RSS — same content arrives faster via Telegram.
#
# (source_id, feed_url) — source_id becomes the alert's `source` field,
# so reliability lookup + corroboration work the same as Telegram.
RSS_FEEDS = [
    # Al Jazeera Arabic — broad MENA coverage, high reliability
    ("aljazeera_ar",   "https://www.aljazeera.net/aljazeerarss"),
    # Anadolu Agency Arabic — Turkish state media, frequent PS coverage
    ("anadolu_ar",     "https://www.aa.com.tr/ar/rss/default?cat=guncel"),
    # RT Arabic — Russian state media; framing-heavy but high volume
    ("rt_arabic",      "https://arabic.rt.com/rss/"),
    # Dropped (Cloudflare/WAF):
    #   skynews_ar    — Cloudflare bot-validator 302→perfdrive.com on every poll;
    #                   eventually returns 200 but burns 1-2s of latency per cycle
    #                   for ~3% of the daily RSS yield. Not worth it.
    #   alarabiya_ar  — https://www.alarabiya.net/feed/rss2/ar (403 with browser UA)
    #   almayadeen_ar — https://www.almayadeen.net/rss/all (403 with browser UA)
    # If we ever need them, route through a residential proxy or scraper.
]

POLL_INTERVAL_SECONDS = 300   # 5 minutes — RSS doesn't need second-level
MAX_ENTRIES_PER_POLL = 30     # safety cap on per-feed bursts


def _stable_id(guid_or_link: str) -> int:
    """Derive a stable 60-bit integer dedup key from an entry's GUID or
    URL. SQLite INTEGER is 64-bit signed, so 60 bits is safe."""
    h = hashlib.md5(guid_or_link.encode("utf-8")).hexdigest()
    return int(h[:15], 16)


def _entry_timestamp(entry) -> datetime:
    """Best-effort UTC timestamp from the feed entry. Falls back to now."""
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if isinstance(t, struct_time):
            return datetime.utcfromtimestamp(mktime(t))
    return datetime.utcnow()


async def _fetch_feed(url: str) -> Optional[str]:
    # Browser-like UA — Al Arabiya / Sky News Arabia / others' WAFs reject
    # generic bot User-Agents with 403.
    headers = {
        "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/126.0 Safari/537.36"),
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
            r = await c.get(url, headers=headers)
            r.raise_for_status()
            return r.text
    except Exception as e:
        log.warning(f"RSS fetch failed for {url}: {e}")
        return None


async def _poll_feed_once(source_id: str, url: str) -> int:
    body = await _fetch_feed(url)
    if not body:
        return 0
    parsed = feedparser.parse(body)
    if parsed.bozo:
        log.debug(f"RSS parse warning {source_id}: {parsed.bozo_exception}")
    processed = 0
    for entry in parsed.entries[:MAX_ENTRIES_PER_POLL]:
        title = (entry.get("title") or "").strip()
        if len(title) < 10:
            continue
        guid = entry.get("id") or entry.get("link") or title
        external_id = _stable_id(guid)
        ts = _entry_timestamp(entry)
        try:
            await monitor._process_text(
                raw_text=title,
                source=source_id,
                external_id=external_id,
                timestamp=ts,
                source_type="rss",
            )
            processed += 1
        except Exception as e:
            log.warning(f"RSS process_text failed [{source_id}]: {e}")
    return processed


async def run():
    """Background loop. Polls every feed every POLL_INTERVAL_SECONDS."""
    log.info(
        f"RSS poller starting: {len(RSS_FEEDS)} feed(s), "
        f"every {POLL_INTERVAL_SECONDS}s"
    )
    while True:
        for source_id, url in RSS_FEEDS:
            n = await _poll_feed_once(source_id, url)
            if n:
                log.info(f"[RSS] {source_id}: processed {n} entries")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
