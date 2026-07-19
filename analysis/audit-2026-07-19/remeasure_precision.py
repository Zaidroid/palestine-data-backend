#!/usr/bin/env python3
"""Re-measure M1 precision after F1+F4+F5 on the SAME 102-alert sample.
Re-classify each raw text with the patched classifier, apply the F5 scope filter
(regional excluded from the default WB/Gaza feed), recompute precision vs gold."""
import json, sqlite3, pathlib, sys, collections
sys.path.insert(0, "services/westbank-alerts")
from app.classifier import classify, classify_wb_operational, is_security_relevant
from app.main import REGIONAL_ALERT_TYPES

BASE = pathlib.Path(__file__).parent
rows = [json.loads(l) for l in open(BASE / "labels_m1_precision.jsonl", encoding="utf-8")]


def reclassify(raw, source):
    c = None
    if is_security_relevant(raw):
        c = classify(raw, source)
    if c is None:
        c = classify_wb_operational(raw, source)
    t = c.get("type") if c else None
    return (t.value if hasattr(t, "value") else t) if t else None


# OLD: default feed = stored_type not regional; precision = gold among retained
def prec(items, type_key):
    feed = [r for r in items if r[type_key] and r[type_key] not in REGIONAL_ALERT_TYPES]
    if not feed:
        return None, 0
    real = sum(1 for r in feed if r["gold_is_alert"])
    return round(real / len(feed), 3), len(feed)

for r in rows:
    r["new_type"] = reclassify(r["text"], r["source"])

old_p, old_n = prec(rows, "stored_type")
new_p, new_n = prec(rows, "new_type")

# where did the fixes move things
moved = collections.Counter()
for r in rows:
    if r["stored_type"] != r["new_type"]:
        moved[f"{r['stored_type']} -> {r['new_type']}"] += 1
dropped_from_feed = [r for r in rows if r["stored_type"] not in REGIONAL_ALERT_TYPES
                     and (r["new_type"] in REGIONAL_ALERT_TYPES or r["new_type"] is None)]

out = {
    "sample_n": len(rows),
    "default_feed_precision_before": old_p, "default_feed_n_before": old_n,
    "default_feed_precision_after": new_p, "default_feed_n_after": new_n,
    "reclassifications": dict(moved),
    "removed_from_default_feed": len(dropped_from_feed),
}
(BASE / "remeasure_after_f1f4f5.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
print(json.dumps(out, indent=2, ensure_ascii=False))
