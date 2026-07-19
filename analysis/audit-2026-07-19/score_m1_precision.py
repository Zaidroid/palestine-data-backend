#!/usr/bin/env python3
"""Score M1-precision from hand verdicts. gold_is_alert=True iff a genuine,
current WB/Gaza safety EVENT (not commentary/media/statistic/legal, not an
off-topic region). scope: wb|gaza|region|israel|offtopic. type_ok: label matches
the event. Volume-weights per-type precision by the 30d type counts."""
import json, sqlite3, pathlib, collections

BASE = pathlib.Path(__file__).parent
# index -> (gold_is_alert, scope, type_ok, reason)
V = {
0:(0,"wb",1,"statistic"),1:(1,"wb",1,""),2:(0,"wb",1,"statistic/feature"),3:(0,"offtopic",0,"Iraq"),
4:(0,"gaza",1,"commentary"),5:(1,"wb",1,""),6:(0,"gaza",1,"vigil"),7:(1,"wb",1,""),
8:(0,"gaza",0,"opinion/metaphor"),9:(1,"gaza",1,""),10:(1,"wb",1,""),11:(1,"wb",1,""),
12:(0,"wb",0,"opinion"),13:(0,"wb",0,"court ruling"),14:(0,"offtopic",0,"refugee-day statement"),
15:(1,"gaza",1,""),16:(1,"gaza",1,"DUP of 15"),17:(1,"wb",1,""),18:(1,"wb",1,""),19:(1,"wb",1,""),
20:(1,"wb",1,""),21:(1,"wb",1,""),22:(1,"wb",1,"DUP of 20"),23:(1,"wb",1,""),
24:(1,"gaza",1,""),25:(1,"gaza",1,""),26:(1,"gaza",1,""),27:(1,"gaza",1,""),28:(1,"gaza",1,""),
29:(1,"gaza",1,""),30:(1,"gaza",1,""),31:(0,"gaza",0,"podcast"),32:(1,"gaza",1,""),33:(1,"wb",1,""),
34:(1,"gaza",1,""),35:(1,"gaza",1,""),36:(1,"gaza",1,""),37:(1,"gaza",1,""),38:(1,"wb",1,""),
39:(1,"wb",1,"Aqsa incursion"),40:(1,"wb",1,""),41:(1,"gaza",1,""),42:(1,"wb",1,""),43:(1,"wb",1,""),
44:(1,"wb",1,""),45:(0,"gaza",0,"podcast"),46:(1,"gaza",1,""),47:(1,"gaza",1,""),
48:(0,"gaza",0,"prisoner release, not injury"),49:(1,"wb",1,""),50:(1,"wb",1,""),
51:(0,"gaza",0,"body recovery"),52:(0,"gaza",0,"statement + wrong type"),
53:(1,"gaza",0,"real event, NOT journalist (byline)"),54:(1,"gaza",0,"NOT journalist (byline)"),
55:(1,"gaza",0,"NOT journalist (byline)"),56:(1,"gaza",0,"NOT journalist (byline)"),
57:(0,"gaza",0,"commentary + wrong type"),58:(1,"gaza",0,"NOT journalist (byline)"),
59:(0,"israel",0,"N.Israel siren, off-scope"),60:(0,"offtopic",0,"Lebanon"),61:(0,"offtopic",0,"Lebanon"),
62:(0,"offtopic",0,"Lebanon"),63:(0,"offtopic",0,"Lebanon"),64:(0,"offtopic",0,"Lebanon"),
65:(0,"offtopic",0,"Lebanon"),66:(0,"offtopic",0,"Lebanon"),67:(0,"offtopic",0,"Lebanon"),
68:(0,"offtopic",0,"Iran"),69:(0,"offtopic",0,"Iran"),70:(0,"offtopic",0,"Syria"),
71:(0,"offtopic",0,"legal news"),72:(0,"offtopic",0,"Iran/Indian Ocean"),73:(1,"wb",1,""),
74:(0,"gaza",0,"commentary"),75:(0,"gaza",0,"commentary DUP"),76:(1,"wb",1,""),77:(1,"wb",1,""),
78:(1,"wb",1,""),79:(1,"wb",1,""),80:(0,"wb",0,"political act/intent"),81:(1,"wb",1,""),
82:(1,"wb",1,""),83:(1,"wb",1,""),84:(1,"wb",1,""),85:(1,"wb",1,""),86:(0,"wb",0,"call/commentary"),
87:(0,"wb",0,"feature/testimony"),88:(1,"gaza",1,"utility warning"),89:(0,"gaza",0,"infographic"),
90:(0,"gaza",0,"infographic DUP"),91:(1,"wb",1,""),92:(1,"wb",1,""),93:(0,"gaza",0,"video"),
94:(0,"gaza",0,"feature"),95:(0,"offtopic",0,"Lebanon/Hezbollah"),96:(0,"offtopic",0,"Lebanon"),
97:(1,"gaza",0,"real strike, wrong type WB-siren"),98:(1,"gaza",0,"real shelling, wrong type"),
99:(0,"offtopic",0,"Bahrain"),100:(0,"offtopic",0,"Kuwait/Bahrain"),101:(0,"offtopic",0,"Jordan"),
}

rows = [json.loads(l) for l in open(BASE / "labels_m1_precision.jsonl", encoding="utf-8")]
rows.sort(key=lambda r: (r["stored_type"], r["id"]))
for i, r in enumerate(rows):
    g, scope, tok, reason = V[i]
    r["gold_is_alert"], r["gold_scope"], r["type_ok"], r["note"] = bool(g), scope, bool(tok), reason
(BASE / "labels_m1_precision.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")

n = len(rows)
real = sum(1 for r in rows if r["gold_is_alert"])
offtopic_region = sum(1 for r in rows if r["gold_scope"] in ("offtopic", "israel"))
content_fp = sum(1 for r in rows if not r["gold_is_alert"] and r["gold_scope"] not in ("offtopic", "israel"))
type_err = sum(1 for r in rows if r["gold_is_alert"] and not r["type_ok"])

# per-type precision (genuine safety event) from the sample
per = collections.defaultdict(lambda: [0, 0])
for r in rows:
    per[r["stored_type"]][0] += 1
    per[r["stored_type"]][1] += 1 if r["gold_is_alert"] else 0

# volume-weight by 30d counts
al = sqlite3.connect(BASE / "snapshot" / "alerts.db")
vol = dict(al.execute("""SELECT type, COUNT(*) FROM alerts
    WHERE timestamp >= datetime('now','-30 days') GROUP BY type"""))
wsum = sum(vol.get(t, 0) * (v[1] / v[0]) for t, v in per.items())
wtot = sum(vol.get(t, 0) for t in per)
weighted_precision = wsum / wtot if wtot else 0

numbers = {
    "measured_at": "2026-07-19", "method": "stratified 7/type, hand-labeled, volume-weighted by 30d counts",
    "m1_precision": {
        "sample_n": n, "sample_real_rate": round(real / n, 3),
        "offtopic_region_rate_sample": round(offtopic_region / n, 3),
        "content_fp_rate_sample": round(content_fp / n, 3),
        "type_error_among_real_sample": round(type_err / real, 3),
        "volume_weighted_precision_30d": round(weighted_precision, 3),
        "per_type_precision": {t: {"n": v[0], "real": v[1], "vol_30d": vol.get(t, 0),
                                   "precision": round(v[1] / v[0], 2)} for t, v in sorted(per.items())},
    },
}
(BASE / "m1_precision_numbers.json").write_text(json.dumps(numbers, indent=2, ensure_ascii=False))
print(json.dumps(numbers["m1_precision"], indent=1, ensure_ascii=False))
