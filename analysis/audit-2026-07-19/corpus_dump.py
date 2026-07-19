"""Audit corpus dump — reads recent messages from the monitored channels using
the SEPARATE analyzer Telegram session (wb_alerts_analyzer), so it runs
concurrently with the live monitor WITHOUT a prod pause. Writes JSONL to
/tmp/corpus (docker cp'd out afterwards) in the exact shape build_corpus_db.py
expects: {id, date, text, views, fwd_from}. Read-only against Telegram.

Run inside params-alerts-api:
  docker exec params-alerts-api python /tmp/corpus_dump.py --corpus <ch1,ch2> --limit 2000
  docker exec params-alerts-api python /tmp/corpus_dump.py --discover
"""
import argparse, asyncio, json, os, sys
from pathlib import Path
sys.path.insert(0, "/app")
from telethon import TelegramClient, functions

API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
# Session name override: analyzer session (concurrent) if authed, else the
# monitor's own session 'wb_alerts' — but ONLY when the monitor is stopped.
_SESS_NAME = os.environ.get("AUDIT_SESSION", "wb_alerts_analyzer")
SESSION = os.path.join(os.environ.get("TELEGRAM_SESSION_DIR", "/session"), _SESS_NAME)
OUT = Path(os.environ.get("AUDIT_OUT", "/tmp/corpus"))

QUERIES = ["أحوال الطرق", "أحوال الطرق والحواجز", "حواجز الضفة", "حواجز",
           "أحوال طرق الخليل", "أحوال طرق نابلس", "أحوال طرق رام الله", "طرق وحواجز"]


async def corpus(client, channels, limit):
    OUT.mkdir(parents=True, exist_ok=True)
    for ch in channels:
        path = OUT / f"{ch}.jsonl"
        n = 0
        try:
            with open(path, "w", encoding="utf-8") as f:
                async for msg in client.iter_messages(ch, limit=limit):
                    if not msg.message:
                        continue
                    f.write(json.dumps({
                        "id": msg.id, "date": msg.date.isoformat(), "text": msg.message,
                        "views": msg.views,
                        "fwd_from": getattr(getattr(msg.fwd_from, "from_id", None), "channel_id", None) if msg.fwd_from else None,
                    }, ensure_ascii=False) + "\n")
                    n += 1
            print(f"[corpus] {ch}: {n} -> {path}", flush=True)
        except Exception as e:
            print(f"[corpus] {ch} FAILED: {e}", flush=True)
        await asyncio.sleep(2)


async def discover(client):
    seen = {}
    for q in QUERIES:
        try:
            res = await client(functions.contacts.SearchRequest(q=q, limit=30))
            for chat in res.chats:
                u = getattr(chat, "username", None)
                if not u or u in seen:
                    continue
                seen[u] = {"username": u, "title": getattr(chat, "title", ""),
                           "participants": getattr(chat, "participants_count", None),
                           "matched_query": q, "broadcast": bool(getattr(chat, "broadcast", False))}
        except Exception as e:
            print(f"[discover] {q!r} failed: {e}", flush=True)
        await asyncio.sleep(2)
    ranked = sorted(seen.values(), key=lambda c: -(c["participants"] or 0))[:25]
    for c in ranked:
        try:
            async for msg in client.iter_messages(c["username"], limit=1):
                c["last_post"] = msg.date.isoformat()
        except Exception as e:
            c["last_post_error"] = str(e)[:80]
        await asyncio.sleep(1.5)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "discovery.json").write_text(json.dumps(ranked, ensure_ascii=False, indent=2))
    print(f"[discover] wrote {len(ranked)} candidates", flush=True)
    for c in ranked:
        print(f"  @{c['username']:<24} {c.get('participants') or '?':>8} subs last={c.get('last_post','?')[:10]} {c['title'][:40]}", flush=True)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="store_true")
    ap.add_argument("--corpus", type=str, default="")
    ap.add_argument("--limit", type=int, default=2000)
    args = ap.parse_args()
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("ANALYZER SESSION NOT AUTHORIZED", flush=True)
        return
    if args.discover:
        await discover(client)
    if args.corpus:
        await corpus(client, [c.strip().lstrip("@") for c in args.corpus.split(",") if c.strip()], args.limit)
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
