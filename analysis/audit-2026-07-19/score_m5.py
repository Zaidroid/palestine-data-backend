#!/usr/bin/env python3
"""Score M5 discard false-negatives + estimate M1 recall.
gold=True index set = real, discrete WB/Gaza safety events found in the discard
sample (verified DISCARD under replay). Checkpoint-congestion items are tracked
separately (real, but belong to the checkpoint pipeline, not security alerts)."""
import json, pathlib

BASE = pathlib.Path(__file__).parent
# real WB/Gaza safety events wrongly discarded (see M1-M5-RESULTS.md for the read)
FN = {0,4,6,11,12,13,17,22,25,39,62,73,75,76,102,116,117,134,155}
# real checkpoint conditions on a security channel (wrong pipeline, not a security FN)
CP_MISROUTE = {81,84,106,83,87}

rows = [json.loads(l) for l in open(BASE / "labels_m5_discard.jsonl", encoding="utf-8")]
for i, r in enumerate(rows):
    r["gold_is_alert"] = i in FN
    r["note"] = "FN: real safety event discarded" if i in FN else (
        "checkpoint-congestion (wrong pipeline)" if i in CP_MISROUTE else "")
(BASE / "labels_m5_discard.jsonl").write_text(
    "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")

counts = json.loads((BASE / "m5_counts.json").read_text())
n = len(rows)
fn = len(FN)
discard_fn_rate = fn / n
est_missed = round(discard_fn_rate * counts["discarded"])
# rough recall estimate: TP among fired ~ M1 precision (0.65); FN ~ extrapolated
tp = round(0.65 * counts["fired"])
recall_est = tp / (tp + est_missed)

out = {
    "discard_sample_n": n, "discard_fn": fn, "cp_misroute": len(CP_MISROUTE),
    "discard_fn_rate": round(discard_fn_rate, 3),
    "estimated_missed_events_in_corpus_window": est_missed,
    "recall_estimate": round(recall_est, 2),
    "recall_caveat": "estimate: 4 security channels, ~8-day window; TP≈0.65×fired",
    **counts,
}
(BASE / "m5_numbers.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
