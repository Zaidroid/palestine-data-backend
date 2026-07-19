#!/usr/bin/env python3
"""M3: does the served status match the evidence stream?
For each (canonical_key, direction) the snapshot serves, compare checkpoint_status
against the majority status of its checkpoint_updates in the 60 min before
last_updated. Disagreement != bug (trust weighting is intentional) — every
disagreement is listed for hand-review."""
import sqlite3, pathlib, collections

BASE = pathlib.Path(__file__).parent
db = sqlite3.connect(BASE / "snapshot" / "checkpoints.db")
rows = list(db.execute("SELECT canonical_key, direction, status, last_updated FROM checkpoint_status"))
agree = disagree = thin = 0
details = []
for key, direction, served, at in rows:
    upd = [r[0] for r in db.execute("""SELECT status FROM checkpoint_updates
        WHERE canonical_key=? AND IFNULL(direction,'')=IFNULL(?, '')
          AND timestamp BETWEEN datetime(?, '-60 minutes') AND ?""", (key, direction, at, at))]
    if len(upd) < 2:
        thin += 1
        continue
    majority = collections.Counter(upd).most_common(1)[0][0]
    if majority == served:
        agree += 1
    else:
        disagree += 1
        details.append(f"- {key}/{direction or '-'}: served={served} majority={majority} window={collections.Counter(upd)}")
total = agree + disagree
md = ["# M3 — served status vs evidence stream\n",
      f"- served checkpoint_status rows: {len(rows)}",
      f"- checkpoint-hours with >=2 reports in the 60-min pre-window: {total} (agree {agree} / disagree {disagree}); thin(<2 reports): {thin}",
      f"- **agreement rate: {round(agree/total, 3) if total else 'n/a'}**\n",
      "## Disagreements (hand-review each — trust-weighting/recency may be correct)\n"] + (details or ["(none)"])
(BASE / "M3-M4-RESULTS.md").write_text("\n".join(md) + "\n")
print(f"served={len(rows)} agree={agree} disagree={disagree} thin={thin}")
