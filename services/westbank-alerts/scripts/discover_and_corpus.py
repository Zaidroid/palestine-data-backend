"""
One-shot channel discovery + corpus capture (Tier-A rework, phase 2).

MUST run while the monitor is stopped (shares the Telethon session).

1. Discovery: Telegram global search for road/checkpoint channel queries —
   reports username, title, participants for candidates.
2. Corpus: dumps the last N messages of given channels to
   /data/corpus/<channel>.jsonl (raw evidence for the classifier rebuild).

Usage (inside the service container):
  python /scripts/discover_and_corpus.py --discover
  python /scripts/discover_and_corpus.py --corpus qudsn,alqastalps --limit 2000
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, "/app")
try:
    from dotenv import load_dotenv
    load_dotenv("/app/.env")
except ImportError:
    pass

from telethon import TelegramClient, functions

API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
SESSION = os.path.join(os.environ.get("TELEGRAM_SESSION_DIR", "/session"), "wb_alerts")

QUERIES = [
    "أحوال الطرق",
    "أحوال الطرق والحواجز",
    "حواجز الضفة",
    "حواجز",
    "أحوال طرق الخليل",
    "أحوال طرق نابلس",
    "أحوال طرق رام الله",
    "طرق وحواجز",
]

OUT_DIR = Path("/data/corpus")


async def discover(client: TelegramClient):
    seen = {}
    for q in QUERIES:
        try:
            res = await client(functions.contacts.SearchRequest(q=q, limit=30))
            for chat in res.chats:
                uname = getattr(chat, "username", None)
                if not uname or uname in seen:
                    continue
                seen[uname] = {
                    "username": uname,
                    "title": getattr(chat, "title", ""),
                    "participants": getattr(chat, "participants_count", None),
                    "matched_query": q,
                    "broadcast": bool(getattr(chat, "broadcast", False)),
                }
        except Exception as e:
            print(f"[discover] query {q!r} failed: {e}", flush=True)
        await asyncio.sleep(2)

    # enrich with last-post recency for the top candidates
    ranked = sorted(seen.values(), key=lambda c: -(c["participants"] or 0))[:25]
    for c in ranked:
        try:
            async for msg in client.iter_messages(c["username"], limit=1):
                c["last_post"] = msg.date.isoformat()
        except Exception as e:
            c["last_post_error"] = str(e)[:80]
        await asyncio.sleep(1.5)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "discovery.json"
    out.write_text(json.dumps(ranked, ensure_ascii=False, indent=2))
    print(f"[discover] wrote {len(ranked)} candidates to {out}", flush=True)
    for c in ranked:
        print(f"  @{c['username']:<24} {c.get('participants') or '?':>8} subs  last={c.get('last_post','?')[:10]}  {c['title'][:40]}", flush=True)


async def corpus(client: TelegramClient, channels: list[str], limit: int):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for ch in channels:
        path = OUT_DIR / f"{ch}.jsonl"
        n = 0
        try:
            with open(path, "w", encoding="utf-8") as f:
                async for msg in client.iter_messages(ch, limit=limit):
                    if not msg.message:
                        continue
                    f.write(json.dumps({
                        "id": msg.id,
                        "date": msg.date.isoformat(),
                        "text": msg.message,
                        "views": msg.views,
                        "fwd_from": getattr(getattr(msg.fwd_from, "from_id", None), "channel_id", None) if msg.fwd_from else None,
                    }, ensure_ascii=False) + "\n")
                    n += 1
            print(f"[corpus] {ch}: {n} messages -> {path}", flush=True)
        except Exception as e:
            print(f"[corpus] {ch} FAILED: {e}", flush=True)
        await asyncio.sleep(3)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="store_true")
    ap.add_argument("--corpus", type=str, default="")
    ap.add_argument("--limit", type=int, default=2000)
    args = ap.parse_args()

    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"[auth] connected as +{me.phone}", flush=True)

    if args.discover:
        await discover(client)
    if args.corpus:
        await corpus(client, [c.strip() for c in args.corpus.split(",") if c.strip()], args.limit)

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
