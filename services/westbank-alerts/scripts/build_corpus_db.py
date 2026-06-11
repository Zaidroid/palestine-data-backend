"""
Build the corpus database — structured storage of everything the Tier-A
rework collected, for future analysis (classifier training, vocab mining,
reliability baselines, historical research).

Input:  <corpus-dir>/*.jsonl (Telegram dumps) + discovery.json
Output: <corpus-dir>/corpus.db (SQLite)

Schema:
  messages(channel, msg_id, date, text, views, fwd_from_channel)
    — one row per captured Telegram message, unique per (channel, msg_id)
  messages_fts — FTS5 full-text index over text (Arabic works with unicode61)
  channels(username, title, participants, matched_query, last_post,
           kind, discovered_at)
    — every channel we know about: monitored + discovery candidates
  captures(channel, captured_at, message_count, oldest, newest)
    — provenance: when each corpus slice was pulled and what it covers

Idempotent: re-running upserts. Plain stdlib, runs anywhere:
  python3 scripts/build_corpus_db.py /path/to/corpus
"""

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

CORPUS = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/corpus")
DB = CORPUS / "corpus.db"

MONITORED_SECURITY = ["QudsN", "palinfo", "alqastalps", "maannews", "safaps", "eyeonpalestine2", "alkofiyatv"]
MONITORED_CHECKPOINT = ["ahwalaltreq", "a7walstreet", "road_jehad", "peopleofHebron"]


def main():
    con = sqlite3.connect(DB)
    con.executescript("""
    CREATE TABLE IF NOT EXISTS messages(
        channel TEXT NOT NULL,
        msg_id  INTEGER NOT NULL,
        date    TEXT NOT NULL,
        text    TEXT NOT NULL,
        views   INTEGER,
        fwd_from_channel INTEGER,
        PRIMARY KEY (channel, msg_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
    CREATE INDEX IF NOT EXISTS idx_messages_channel_date ON messages(channel, date);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        text, content='messages', content_rowid='rowid', tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS channels(
        username      TEXT PRIMARY KEY,
        title         TEXT,
        participants  INTEGER,
        matched_query TEXT,
        last_post     TEXT,
        kind          TEXT,   -- monitored_security | monitored_checkpoint | candidate
        discovered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS captures(
        channel       TEXT NOT NULL,
        captured_at   TEXT NOT NULL,
        message_count INTEGER,
        oldest        TEXT,
        newest        TEXT,
        PRIMARY KEY (channel, captured_at)
    );
    """)

    now = datetime.now(timezone.utc).isoformat()

    # messages from JSONL dumps
    total_new = 0
    for f in sorted(CORPUS.glob("*.jsonl")):
        ch = f.stem
        rows = []
        for line in open(f, encoding="utf-8"):
            try:
                m = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append((ch, m["id"], m["date"], m.get("text") or "", m.get("views"), m.get("fwd_from")))
        if not rows:
            continue
        before = con.execute("SELECT COUNT(*) FROM messages WHERE channel=?", (ch,)).fetchone()[0]
        con.executemany(
            "INSERT OR IGNORE INTO messages(channel,msg_id,date,text,views,fwd_from_channel) VALUES(?,?,?,?,?,?)",
            rows,
        )
        after = con.execute("SELECT COUNT(*) FROM messages WHERE channel=?", (ch,)).fetchone()[0]
        new = after - before
        total_new += new
        dates = con.execute("SELECT MIN(date), MAX(date) FROM messages WHERE channel=?", (ch,)).fetchone()
        con.execute(
            "INSERT OR REPLACE INTO captures(channel,captured_at,message_count,oldest,newest) VALUES(?,?,?,?,?)",
            (ch, now, after, dates[0], dates[1]),
        )
        print(f"  {ch}: +{new} new ({after} total, {dates[0][:10]} → {dates[1][:10]})")

    # rebuild FTS from content table (cheap at this scale)
    con.execute("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")

    # channels: discovery candidates + monitored sets
    disc = CORPUS / "discovery.json"
    if disc.exists():
        for c in json.load(open(disc, encoding="utf-8")):
            con.execute(
                """INSERT INTO channels(username,title,participants,matched_query,last_post,kind,discovered_at)
                   VALUES(?,?,?,?,?,?,?)
                   ON CONFLICT(username) DO UPDATE SET title=excluded.title,
                     participants=excluded.participants, last_post=excluded.last_post""",
                (c["username"], c.get("title"), c.get("participants"), c.get("matched_query"),
                 c.get("last_post"), "candidate", now),
            )
    for ch in MONITORED_SECURITY:
        con.execute("INSERT INTO channels(username, kind, discovered_at) VALUES(?,?,?) "
                    "ON CONFLICT(username) DO UPDATE SET kind=?", (ch, "monitored_security", now, "monitored_security"))
    for ch in MONITORED_CHECKPOINT:
        con.execute("INSERT INTO channels(username, kind, discovered_at) VALUES(?,?,?) "
                    "ON CONFLICT(username) DO UPDATE SET kind=?", (ch, "monitored_checkpoint", now, "monitored_checkpoint"))

    con.commit()
    msgs = con.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    chans = con.execute("SELECT COUNT(*) FROM channels").fetchone()[0]
    print(f"corpus.db: {msgs} messages ({total_new} new), {chans} channels → {DB}")
    # smoke-test FTS
    hit = con.execute("SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'سالك'").fetchone()[0]
    print(f"FTS smoke test — messages mentioning سالك: {hit}")
    con.close()


if __name__ == "__main__":
    main()
