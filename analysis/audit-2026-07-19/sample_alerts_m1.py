#!/usr/bin/env python3
"""M1-precision sampler: stratified sample of FIRED alerts, replay the current
classifier over each raw_text (consistency + drift check), emit for hand-labeling.
Deterministic by id-hash. Needs no corpus — measures precision (FP among served)."""
import json, sqlite3, hashlib, pathlib, sys, collections
sys.path.insert(0, "services/westbank-alerts")
from app.classifier import classify, classify_wb_operational, is_security_relevant


def replay_classify(raw, source):
    """Mirror monitor._process_text exactly: tier-1 (security-relevant → classify)
    then tier-2 (classify_wb_operational) fallback."""
    classified = None
    if is_security_relevant(raw):
        classified = classify(raw, source)
    if classified is None:
        classified = classify_wb_operational(raw, source)
    return classified

BASE = pathlib.Path(__file__).parent
al = sqlite3.connect(BASE / "snapshot" / "alerts.db")
rows = list(al.execute("""SELECT id, type, severity, title, raw_text, source, timestamp
    FROM alerts WHERE timestamp >= datetime('now','-30 days') AND raw_text != ''"""))

# stratify: up to N per type, deterministic by hash
PER_TYPE = 7
by_type = collections.defaultdict(list)
for r in rows:
    by_type[r[1]].append(r)
sample = []
for t, pool in by_type.items():
    pool.sort(key=lambda r: hashlib.sha1(str(r[0]).encode()).hexdigest())
    sample += pool[:PER_TYPE]

out = []
drift = 0
for _id, typ, sev, title, raw, source, ts in sample:
    replayed = replay_classify(raw, source)
    r_type = replayed.get("type") if replayed else None
    if (replayed is None) or (r_type != typ):
        drift += 1
    out.append({
        "id": _id, "stored_type": typ, "severity": sev, "source": source,
        "text": raw[:500], "replay_fires": replayed is not None, "replay_type": r_type,
        # hand-label:
        "gold_is_alert": None,        # true = genuine WB/Gaza safety event worth alerting
        "gold_scope": None,           # "wb" | "gaza" | "regional" | "israel" | "offtopic"
        "note": "",
    })

(BASE / "labels_m1_precision.jsonl").write_text(
    "\n".join(json.dumps(o, ensure_ascii=False) for o in out) + "\n")
print(f"sampled {len(out)} fired alerts across {len(by_type)} types; classifier drift (replay!=stored or no-fire): {drift}")
