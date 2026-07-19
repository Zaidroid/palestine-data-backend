# M3 — served status vs evidence stream

- served checkpoint_status rows: 729
- checkpoint-hours with >=2 reports in the 60-min pre-window: 264 (agree 221 / disagree 43); thin(<2 reports): 465
- **agreement rate: 0.837**

## Disagreements (hand-review each — trust-weighting/recency may be correct)

- العيزريه/inbound: served=slow majority=congested window=Counter({'congested': 1, 'slow': 1})
- عين_شبلي/outbound: served=open majority=congested window=Counter({'congested': 1, 'open': 1})
- جباره/both: served=idf majority=open window=Counter({'open': 1, 'idf': 1})
- حواره/both: served=open majority=closed window=Counter({'closed': 3, 'open': 3})
- جسر_جيوس_عزون/both: served=open majority=closed window=Counter({'closed': 1, 'open': 1})
- عناب/outbound: served=congested majority=open window=Counter({'open': 6, 'congested': 3, 'closed': 1})
- تقوع/-: served=idf majority=open window=Counter({'open': 3, 'idf': 1})
- خط_يتسهار/-: served=police majority=open window=Counter({'open': 1, 'police': 1})
- عقبه_حسنه/-: served=open majority=closed window=Counter({'closed': 1, 'open': 1})
- النبي_صالح/-: served=idf majority=open window=Counter({'open': 6, 'idf': 4})
- شافي_شمرون/-: served=idf majority=open window=Counter({'open': 1, 'idf': 1})
- الساويه/-: served=idf majority=open window=Counter({'open': 2, 'idf': 1})
- فرش_الهوي/-: served=congested majority=open window=Counter({'open': 6, 'idf': 2, 'congested': 1})
- ترقوميا_المصانع/-: served=open majority=closed window=Counter({'closed': 3, 'open': 1})
- حلحول/-: served=open majority=closed window=Counter({'closed': 3, 'open': 1})
- اللبن الشرقيه/-: served=idf majority=open window=Counter({'open': 3, 'idf': 1})
- جناتا_تل_الربيع/-: served=closed majority=open window=Counter({'open': 2, 'closed': 1})
- سلفيت/both: served=police majority=open window=Counter({'open': 1, 'police': 1})
- كراميلو/both: served=idf majority=open window=Counter({'open': 1, 'police': 1, 'idf': 1})
- رايح_جاي/both: served=open majority=congested window=Counter({'congested': 1, 'open': 1})
- تياسير/-: served=closed majority=open window=Counter({'open': 1, 'closed': 1})
- قلنديا/-: served=congested majority=open window=Counter({'open': 7, 'congested': 6, 'idf': 1})
- بيت_ايل/-: served=closed majority=open window=Counter({'open': 9, 'closed': 2, 'idf': 1})
- عنبتا/inbound: served=inspection majority=closed window=Counter({'closed': 2, 'inspection': 2})
- عابود/-: served=open majority=closed window=Counter({'closed': 4, 'open': 3, 'idf': 3})
- عناتا/-: served=congested majority=open window=Counter({'open': 3, 'congested': 2})
- حزما/-: served=congested majority=open window=Counter({'open': 4, 'congested': 3})
- عيون_الحراميه/-: served=congested majority=open window=Counter({'open': 2, 'congested': 2})
- فرش_الهوي/inbound: served=open majority=congested window=Counter({'congested': 1, 'open': 1})
- كفر لاقف/-: served=idf majority=open window=Counter({'open': 2, 'idf': 1})
- عنبتا/outbound: served=congested majority=inspection window=Counter({'inspection': 2, 'congested': 1})
- مداخل_سبسطيه/-: served=idf majority=congested window=Counter({'congested': 1, 'idf': 1})
- زعتره/outbound: served=slow majority=police window=Counter({'police': 6, 'congested': 3, 'slow': 2, 'closed': 1, 'open': 1})
- سلفيت_الشمالي/outbound: served=police majority=idf window=Counter({'idf': 1, 'police': 1})
- زعتره/inbound: served=slow majority=police window=Counter({'police': 2, 'closed': 1, 'slow': 1})
- حوسان/-: served=closed majority=open window=Counter({'open': 1, 'closed': 1})
- عيون الحراميه/outbound: served=slow majority=congested window=Counter({'congested': 1, 'slow': 1})
- حواره_تحت_الجسر/outbound: served=closed majority=open window=Counter({'open': 1, 'closed': 1})
- بيت_ليد/inbound: served=open majority=police window=Counter({'police': 1, 'open': 1})
- دورا/outbound: served=congested majority=idf window=Counter({'idf': 2, 'inspection': 2, 'congested': 2})
- عطاره_البلد/outbound: served=congested majority=inspection window=Counter({'inspection': 3, 'congested': 1})
- فصايل/outbound: served=police majority=inspection window=Counter({'inspection': 1, 'police': 1})
- كرمه/inbound: served=congested majority=open window=Counter({'open': 1, 'congested': 1})


# M4 — staleness honesty

- v2: 258 served, 6 stale(>6h) NOT shown as unknown/closed
- v1: 210 served, 7 stale(>6h) with is_stale=false and non-unknown status
- v2 freshness bands: {'live': 14, 'recent': 25, 'stale': 171, 'none': 48}

## Leaks (stale served as live)

- /v2: راس_الجوره age=9.6h effective_status=open band=recent
- /v2: بيت_ايل age=9.6h effective_status=open band=recent
- /v2: تياسير age=11.5h effective_status=congested band=recent
- /v2: فرش_الهوي age=11.6h effective_status=idf band=recent
- /v2: عين_سينيا age=11.7h effective_status=congested band=recent
- /v2: نور_شمس age=11.9h effective_status=open band=recent
- /v1: راس_الجوره last_active=9.6h status=open is_stale=False
- /v1: بيت_ايل last_active=9.6h status=open is_stale=False
- /v1: حوسان last_active=10.5h status=closed is_stale=False
- /v1: تياسير last_active=11.5h status=congested is_stale=False
- /v1: فرش_الهوي last_active=11.6h status=idf is_stale=False
- /v1: عين_سينيا last_active=11.7h status=congested is_stale=False
- /v1: نور_شمس last_active=11.9h status=open is_stale=False

(summary/stats/cities saved to snapshot/ for hand-review of stale-inflated aggregates)

## M3 verdict
- **Agreement 83.7%** (221/264) on checkpoints with >=2 reports in the 60-min pre-window.
- 465/729 served status rows had <2 reports in that window (served largely off a single report — see M4).
- 43 disagreements = 24 recency-legitimate ties + 19 clear-majority overrides.
- **Safety-relevant (5 false-open):** served passable while the recent window is closed/police-dominated — زعتره out (served slow vs police:6/congested:3), زعتره in (police:2), ترقوميا_المصانع (open vs closed:3), حلحول (open vs closed:3), عابود (open vs closed:4 plurality). For a safety tool, false-open is the dangerous direction.
- 7 false-closed (over-cautious, fails safe) incl. بيت_ايل served closed vs open:9, النبي_صالح idf vs open:6.
- Root pattern: consensus over-weights the single latest report over the recent window, especially for high-severity statuses. Fix direction: window-weighted consensus with severity-aware recency (not latest-wins).

## M4 verdict
- **Honest freshness reality:** of 258 served (v2), bands = live 14 / recent 25 / stale 171 / none 48. **~85% are not fresh** — the nature of crowd data, and the single most important thing a buyer must understand.
- **Staleness-honesty gaps:**
  1. **Aggregate inflation (worst):** `/checkpoints/summary` + `/checkpoints/stats` report `total_active: 585` with by_status summing to 585 (352 open), but `total_directory: 234` and per-checkpoint endpoints serve 210 (v1)/258 (v2). 585 counts per-direction rows AND stale ones (fresh_last_6h only 155, fresh_last_1h 87). **Three inconsistent checkpoint counts across endpoints (210/258/585); the headline 585 is 2.5x the catalog and stale-inflated.**
  2. `is_data_stale: false` at summary top-level while 66% of served checkpoints are stale-band.
  3. 13 per-checkpoint leaks: checkpoints 9.6-11.9h old served with live effective_status (open/idf/congested) and is_stale=False — the stale threshold is ~12h, so 6-12h reports claim is_stale=False. For conditions that flip in minutes, a 12h "open" without a stale flag is misleading.
- Mitigation already present: v2 exposes age_hours + freshness_band, so a careful consumer isn't fully deceived — but effective_status, is_stale, and the summary aggregates don't reflect staleness. Fix direction: freshness-filter the aggregates, reconcile the 3 counts, degrade effective_status→unknown past a defensible age (6h), flip is_stale at the same threshold.
