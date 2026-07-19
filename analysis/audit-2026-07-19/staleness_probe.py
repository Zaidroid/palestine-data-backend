#!/usr/bin/env python3
"""M4: staleness honesty — does ANY serving path paint a stale checkpoint as live?
Rule under test (June design): stale/never-reported must serve effective_status
'unknown' (v2) or carry is_stale/last_active flags (v1)."""
import json, urllib.request, pathlib
from datetime import datetime, timezone

B = "https://wb-alerts.zaidlab.xyz"
SNAP = pathlib.Path(__file__).parent / "snapshot"
def get(p):
    req = urllib.request.Request(B + p, headers={"User-Agent": "pdb-audit/1.0 (Mozilla/5.0)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

now = datetime.now(timezone.utc)
def age_h(ts):
    if not ts: return None
    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if t.tzinfo is None: t = t.replace(tzinfo=timezone.utc)
    return (now - t).total_seconds() / 3600

leaks, notes = [], []

# ---- v2 ----
v2 = get("/v2/checkpoints?limit=500")["checkpoints"]
v2_stale_live = [c for c in v2 if (c.get("freshness", {}).get("age_hours") or 0) > 6
                 and c.get("effective_status") not in ("unknown", "closed")]
for c in v2_stale_live:
    leaks.append(f"- /v2: {c['canonical_key']} age={c['freshness']['age_hours']}h effective_status={c['effective_status']} band={c['freshness'].get('freshness_band')}")
notes.append(f"v2: {len(v2)} served, {len(v2_stale_live)} stale(>6h) NOT shown as unknown/closed")

# ---- v1 ----
v1 = get("/checkpoints")
items = v1.get("checkpoints") if isinstance(v1, dict) and "checkpoints" in v1 else (
        list(v1.values()) if isinstance(v1, dict) else v1)
v1_stale_live = [c for c in items if (c.get("last_active_hours") or 0) > 6
                 and not c.get("is_stale") and c.get("status") not in ("unknown",)]
for c in v1_stale_live:
    leaks.append(f"- /v1: {c.get('canonical_key')} last_active={c.get('last_active_hours')}h status={c.get('status')} is_stale={c.get('is_stale')}")
notes.append(f"v1: {len(items)} served, {len(v1_stale_live)} stale(>6h) with is_stale=false and non-unknown status")

# distribution of freshness for context
bands = {}
for c in v2:
    b = c.get("freshness", {}).get("freshness_band", "?")
    bands[b] = bands.get(b, 0) + 1
notes.append(f"v2 freshness bands: {bands}")

# save aggregate endpoints for hand-review
for path in ("/checkpoints/summary", "/checkpoints/stats", "/v2/cities"):
    try:
        doc = get(path)
        (SNAP / (path.strip("/").replace("/", "_") + ".json")).write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    except Exception as e:
        notes.append(f"{path}: fetch failed {e}")

md = pathlib.Path(__file__).parent / "M3-M4-RESULTS.md"
with open(md, "a") as f:
    f.write("\n\n# M4 — staleness honesty\n\n")
    for n in notes:
        f.write(f"- {n}\n")
    f.write("\n## Leaks (stale served as live)\n\n")
    f.write(("\n".join(leaks) + "\n") if leaks else "NONE on probed per-checkpoint endpoints.\n")
    f.write("\n(summary/stats/cities saved to snapshot/ for hand-review of stale-inflated aggregates)\n")
print(f"v2_stale_live_leaks={len(v2_stale_live)} v1_stale_live_leaks={len(v1_stale_live)} total_leaks={len(leaks)}")
