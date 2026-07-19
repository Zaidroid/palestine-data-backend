#!/usr/bin/env python3
"""M5 + M1-recall: replay the full monitor classify path over security-channel
corpus messages, split fired vs discarded, sample the discard pile for FN labeling.
Run from repo root with the audit venv."""
import json, sqlite3, hashlib, pathlib, sys, collections
sys.path.insert(0, "services/westbank-alerts")
from app.classifier import classify, classify_wb_operational, is_security_relevant

SEC = ("QudsN", "alkofiyatv", "alqastalps", "eyeonpalestine2")
BASE = pathlib.Path(__file__).parent
corpus = sqlite3.connect(BASE / "snapshot" / "corpus" / "corpus.db")


def replay_classify(raw, source):
    c = None
    if is_security_relevant(raw):
        c = classify(raw, source)
    if c is None:
        c = classify_wb_operational(raw, source)
    return c


fired, discarded = [], []
for ch, mid, date, text in corpus.execute(
        "SELECT channel, msg_id, date, text FROM messages WHERE channel IN (?,?,?,?) AND length(text) >= 10", SEC):
    res = replay_classify(text, ch)
    rec = {"channel": ch, "msg_id": mid, "date": date, "text": text}
    (fired if res else discarded).append({**rec, "fired_type": res.get("type") if res else None})

fire_rate = len(fired) / (len(fired) + len(discarded))
# deterministic discard sample, stratified by channel
by_ch = collections.defaultdict(list)
for r in discarded:
    by_ch[r["channel"]].append(r)
sample = []
PER = 40
for ch, pool in by_ch.items():
    pool.sort(key=lambda r: hashlib.sha1(f"{r['channel']}:{r['msg_id']}".encode()).hexdigest())
    sample += pool[:PER]
for r in sample:
    r["gold_is_alert"] = None   # true = real WB/Gaza safety event that SHOULD have fired
    r["gold_type"] = None
    r["note"] = ""
(BASE / "labels_m5_discard.jsonl").write_text(
    "\n".join(json.dumps(r, ensure_ascii=False) for r in sample) + "\n")
(BASE / "m5_counts.json").write_text(json.dumps(
    {"security_msgs": len(fired) + len(discarded), "fired": len(fired),
     "discarded": len(discarded), "fire_rate": round(fire_rate, 3),
     "discard_sample_n": len(sample)}, indent=2))
print(f"security msgs={len(fired)+len(discarded)} fired={len(fired)} discarded={len(discarded)} "
      f"fire_rate={fire_rate:.3f}; discard sample={len(sample)}")
