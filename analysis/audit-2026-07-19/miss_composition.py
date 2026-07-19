#!/usr/bin/env python3
"""M2 — decompose the whitelist-miss stream (checkpoint_candidates).
Corpus replay_misses are folded in later if snapshot/replay.jsonl exists."""
import json, sqlite3, pathlib, collections

BASE = pathlib.Path(__file__).parent
db = sqlite3.connect(BASE / "snapshot" / "checkpoints.db")

cands = list(db.execute("""SELECT raw_name, normalized, mentions, llm_verdict, llm_confidence,
        status, governorate, first_seen, last_seen FROM checkpoint_candidates ORDER BY mentions DESC"""))
by_verdict = collections.Counter(r[3] or "unvetted" for r in cands)
by_status = collections.Counter(r[5] for r in cands)
promoted = sum(1 for r in cands if r[5] == "promoted")
real_unpromoted = [r for r in cands if r[3] == "real" and r[5] != "promoted"]

# catalog for variant cross-check
cat = json.load(open(BASE / "snapshot" / "known_checkpoints.prod.json"))
cat_names = set()
for e in (cat if isinstance(cat, list) else cat.values()):
    for k in ("canonical_key", "name_ar", "name_en"):
        if e.get(k):
            cat_names.add(e[k])

misses = collections.Counter()
mp = BASE / "snapshot" / "replay.jsonl"
if mp.exists():
    for line in open(mp, encoding="utf-8"):
        r = json.loads(line)
        for m in r.get("replay_misses", []):
            misses[str(m)] += 1

md = ["# M2 — whitelist-miss composition\n",
      f"candidates table: **{len(cands)}** distinct names",
      f"- llm verdicts: {dict(by_verdict)}",
      f"- statuses: {dict(by_status)}",
      f"- **promoted to catalog: {promoted}**",
      f"- llm_verdict=real but NOT promoted: **{len(real_unpromoted)}** (coverage gap — real checkpoints sitting unserved)\n",
      "## The unpromoted 'real' candidates (highest-value coverage gap)\n",
      "| raw_name | mentions | conf | governorate |", "|---|---|---|---|"]
for r in sorted(real_unpromoted, key=lambda x: -x[2]):
    md.append(f"| {r[0]} | {r[2]} | {round(r[4] or 0,2)} | {r[6]} |")

md += ["\n## Top 40 candidates by mentions (hand-classify column below)\n",
       "| raw_name | mentions | llm_verdict | conf | in_catalog? | HAND: junk/real/variant/parse |",
       "|---|---|---|---|---|---|"]
for r in cands[:40]:
    in_cat = "yes" if (r[0] in cat_names or r[1] in cat_names) else ""
    md.append(f"| {r[0]} | {r[2]} | {r[3]} | {round(r[4] or 0,2)} | {in_cat} | |")

if misses:
    md += ["\n## Top 30 replay-window misses (corpus)\n"] + [f"- {k}: {v}" for k, v in misses.most_common(30)]
else:
    md += ["\n## Replay-window misses: (pending corpus re-pull — Task 4 gate)\n"]

(BASE / "M2-MISSES.md").write_text("\n".join(md) + "\n")
print(f"candidates={len(cands)} promoted={promoted} real_unpromoted={len(real_unpromoted)} replay_misses={len(misses)}")
