#!/usr/bin/env python3
"""Enumerate what the prod snapshot actually contains -> INVENTORY.md."""
import sqlite3, pathlib

BASE = pathlib.Path(__file__).parent
out = ["# Snapshot inventory — 2026-07-19\n"]

for name in ("checkpoints", "alerts", "news"):
    dbp = BASE / "snapshot" / f"{name}.db"
    if not dbp.exists():
        continue
    db = sqlite3.connect(dbp)
    out.append(f"\n## {name}.db\n")
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for t in tables:
        n = db.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
        cols = [c[1] for c in db.execute(f"PRAGMA table_info([{t}])")]
        tcol = next((c for c in ("timestamp", "created_at", "last_seen", "last_updated") if c in cols), None)
        rng = ""
        if tcol and n:
            lo, hi = db.execute(f"SELECT MIN([{tcol}]), MAX([{tcol}]) FROM [{t}]").fetchone()
            rng = f" — {tcol}: {str(lo)[:10]} -> {str(hi)[:10]}"
        out.append(f"- `{t}`: {n} rows{rng}")
    db.close()

db = sqlite3.connect(BASE / "snapshot" / "checkpoints.db")
out.append("\n## checkpoint_updates per channel, last 30 days\n")
for ch, n in db.execute("""SELECT source_channel, COUNT(*) FROM checkpoint_updates
        WHERE timestamp >= datetime('now', '-30 days') GROUP BY 1 ORDER BY 2 DESC"""):
    out.append(f"- {ch}: {n}")
# provenance feasibility: how many updates carry raw_message + source_msg_id
prov = db.execute("""SELECT
    SUM(CASE WHEN raw_message IS NOT NULL AND raw_message != '' THEN 1 ELSE 0 END),
    SUM(CASE WHEN source_msg_id IS NOT NULL THEN 1 ELSE 0 END), COUNT(*)
    FROM checkpoint_updates""").fetchone()
out.append(f"\n**checkpoint_updates provenance:** raw_message present {prov[0]}/{prov[2]}, source_msg_id present {prov[1]}/{prov[2]}")

db2 = sqlite3.connect(BASE / "snapshot" / "alerts.db")
out.append("\n## alerts per source, last 30 days\n")
for ch, n in db2.execute("""SELECT source, COUNT(*) FROM alerts
        WHERE timestamp >= datetime('now', '-30 days') GROUP BY 1 ORDER BY 2 DESC"""):
    out.append(f"- {ch}: {n}")

(BASE / "INVENTORY.md").write_text("\n".join(out) + "\n")
print(f"wrote INVENTORY.md ({len(out)} lines)")
