#!/usr/bin/env python3
"""M6 channel health, M7 provenance completeness, M8 coord regressions."""
import json, sqlite3, pathlib

BASE = pathlib.Path(__file__).parent
SNAP = BASE / "snapshot"
md = ["# M6 — channel health (last 30d)\n"]

# ---- M6: checkpoint channels from checkpoint_updates ----
cps = sqlite3.connect(SNAP / "checkpoints.db")
md += ["## Checkpoint channels (checkpoint_updates)\n",
       "| channel | updates 30d | updates 7d | verdict |", "|---|---|---|---|"]
for ch, n30, n7 in cps.execute("""SELECT source_channel,
        SUM(CASE WHEN timestamp >= datetime('now','-30 days') THEN 1 ELSE 0 END),
        SUM(CASE WHEN timestamp >= datetime('now','-7 days') THEN 1 ELSE 0 END)
        FROM checkpoint_updates GROUP BY 1 ORDER BY 2 DESC"""):
    verdict = "DEAD" if not n7 else ("dying" if n7 < (n30 or 0) / 8 else "active")
    md.append(f"| {ch} | {n30} | {n7} | {verdict} |")

# ---- M6: security sources from alerts ----
al = sqlite3.connect(SNAP / "alerts.db")
md += ["\n## Security/news sources (alerts)\n",
       "| source | alerts 30d | alerts 7d | verdict |", "|---|---|---|---|"]
for ch, n30, n7 in al.execute("""SELECT source,
        SUM(CASE WHEN timestamp >= datetime('now','-30 days') THEN 1 ELSE 0 END),
        SUM(CASE WHEN timestamp >= datetime('now','-7 days') THEN 1 ELSE 0 END)
        FROM alerts GROUP BY 1 ORDER BY 2 DESC"""):
    verdict = "DEAD" if not n7 else ("dying" if n7 < (n30 or 0) / 8 else "active")
    md.append(f"| {ch} | {n30} | {n7} | {verdict} |")

md += ["\n## channel_reliability (static trust priors — seed, not dynamic)\n"]
for ch, w, basis, upd in al.execute("SELECT channel, weight, basis, last_updated FROM channel_reliability ORDER BY weight DESC"):
    md.append(f"- {ch}: w={w} ({basis[:40]}) seeded {upd[:10]}")

# ---- M7: provenance ----
md.append("\n# M7 — provenance completeness\n")
v2 = json.load(open(SNAP / "v2_checkpoints.json"))["checkpoints"]
full = sum(1 for c in v2 if c.get("provenance", {}).get("last_msg_id")
           and c.get("provenance", {}).get("source_channel")
           and c.get("freshness", {}).get("last_updated"))
md.append(f"- /v2/checkpoints: {full}/{len(v2)} records with full provenance chain ({round(full/len(v2)*100)}%)")
cu = cps.execute("""SELECT COUNT(*),
    SUM(CASE WHEN raw_message IS NOT NULL AND raw_message!='' THEN 1 ELSE 0 END),
    SUM(CASE WHEN source_msg_id IS NOT NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN source_channel IS NOT NULL AND source_channel!='' THEN 1 ELSE 0 END)
    FROM checkpoint_updates""").fetchone()
md.append(f"- checkpoint_updates: {cu[0]} rows — raw_message {cu[1]} ({round(cu[1]/cu[0]*100)}%), source_msg_id {cu[2]} ({round(cu[2]/cu[0]*100)}%), source_channel {cu[3]} ({round(cu[3]/cu[0]*100)}%)")
na = al.execute("""SELECT COUNT(*), SUM(CASE WHEN source_msg_id IS NOT NULL AND raw_text!='' THEN 1 ELSE 0 END)
    FROM alerts WHERE timestamp >= datetime('now','-30 days')""").fetchone()
md.append(f"- alerts (30d): {na[1]}/{na[0]} with source_msg_id + raw_text ({round((na[1] or 0)/na[0]*100) if na[0] else 0}%)")

# ---- M8: coordinate regressions ----
md.append("\n# M8 — coordinate regressions (June authoritative OSM/resident fixes)\n")
# (canonical name, lat, lon, commit) — the 10 fixes across 7c76657/bd6ad3f/2f9696b
FIXES = [
    ("Huwara حواره", 32.1780141, 35.2734519), ("Anab عناب", 32.2904334, 35.1357898),
    ("Tayasir تياسير", 32.3289189, 35.4353458), ("Walaja الولجه", 31.7425736, 35.1708226),
    ("Zaim الزعيم", 31.7833576, 35.2638149), ("Allenby جسر الملك حسين", 31.8738717, 35.5409112),
    ("Zatara زعتره", 32.1153, 35.2547), ("Anata عناتا", 31.85392, 35.2564),
    ("Beit Jala بيت جالا", 31.71604, 35.17751), ("Jaba جبع", 31.8084, 35.24238),
]
prod = json.load(open(SNAP / "known_checkpoints.prod.json"))
entries = prod if isinstance(prod, list) else list(prod.values())
def present(lat, lon):
    for e in entries:
        elat = e.get("latitude") or e.get("lat"); elon = e.get("longitude") or e.get("lon")
        if elat and elon and abs(elat - lat) < 0.002 and abs(elon - lon) < 0.002:
            return e.get("canonical_key") or e.get("name_ar")
    return None
ok = 0
for name, lat, lon in FIXES:
    hit = present(lat, lon)
    if hit:
        ok += 1; md.append(f"- {name}: authoritative coord present (as `{hit}`) → OK")
    else:
        md.append(f"- {name}: expected ~({lat},{lon}) NOT found in prod catalog → **REGRESSED/CHECK**")
md.append(f"\n**{ok}/{len(FIXES)} June coord fixes intact in prod.**")

(BASE / "M6-M7-M8-RESULTS.md").write_text("\n".join(md) + "\n")
print(f"M6/M7/M8 written. provenance v2={full}/{len(v2)}, coord fixes intact={ok}/{len(FIXES)}")
