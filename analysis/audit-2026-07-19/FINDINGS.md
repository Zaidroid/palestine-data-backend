# Tier 1 audit findings — 2026-07-19

West Bank live tier (`services/westbank-alerts`), measured against a read-only prod
snapshot (59,792 checkpoint updates, 9,233 alerts, 5,275 candidates) + offline replay
of the deployed classifier/parser (verified deployed == repo HEAD, 0.98% drift).

## Scorecard

| # | Metric | Value | Verdict |
|---|---|---|---|
| M1 | Classifier precision (alerts served), volume-weighted | **65.4%** | erodes-trust — 2 types near-0% |
| M1 | — high-precision core (idf_raid/gaza_strike/flying_checkpoint) | ~100% | strong |
| M2 | Candidates promoted to catalog | **0 / 5,275** (46 vetted `real`) | breaks-coverage |
| M3 | Served status vs evidence (≥2 reports) | 83.7% agree | mostly-honest; 5 false-open |
| M4 | Checkpoint count consistency across endpoints | **210 / 258 / 585** | breaks-trust |
| M4 | Freshness honesty (v2 bands) | live 14 / stale 171 / none 48 | needs surfacing |
| M5 | Discard false-negatives (missed alerts) | **11.9%** (~1 in 5 real events missed) | breaks-trust |
| M1 | Recall estimate | ~78% | breaks-trust |
| M6 | Active checkpoint channels | 4 (3 dead) | resilience risk |
| M7 | Provenance completeness (reports) | 100% | strong / sellable |
| M8 | June coordinate fixes intact | 10/10 | clean |

## Findings (ranked by trust impact)

**F0 [breaks-trust] The classifier silently drops ~1 in 5 real events (11.9% discard FN rate).**
Replaying the full classify path over 5,597 security-channel messages: 38.9% fired, and a
160-message stratified sample of the *discards* contained 19 real WB/Gaza safety events
wrongly dropped (11.9%) → ~406 missed in the corpus window; recall ≈78%. Verified missed:
Gaza airstrikes phrased with غارة/غارتين, single arrests (Masafer Yatta, Qalqilya),
demolitions (Anza, نسف east Gaza), settler assaults (Huwara), raids (اقتحام البيرة), clashes.
Root cause: keyword-brittle classification — the same event type fires on one phrasing and
drops on another (prod fired 2,052 raids / 411 demolitions, so coverage is partial). For a
safety product, a missed real airstrike is worse than a false one. *Fix direction:* broaden
verb/trigger coverage (غارة family, single-arrest, نسف/تجريف), add a high-signal-noun recall
net, route checkpoint-congestion off security channels. Evidence: M1-M5-RESULTS.md M5.

**F1 [breaks-trust] `west_bank_siren` alerts are ~0% actually West Bank.**
0 of 7 sampled were WB — they were Bahrain, Kuwait, Jordan, Lebanon, Gaza. The
classifier's "shared airspace ⇒ local threat" rule (defensible for Israel proper)
is over-extended to the whole MENA region. 272 alerts/30d. A customer receiving a
"West Bank siren" that is actually Bahrain stops trusting the feed immediately.
*Fix direction:* restrict siren-locality to Israel/WB/Gaza geography; everything
else → regional context, not a WB siren. Evidence: M1-M5-RESULTS.md F1; examples 99–101.

**F2 [breaks-trust] Three inconsistent checkpoint counts; the headline is 2.5× inflated.**
`/checkpoints/summary` reports `total_active: 585` (by_status sums to 585, "352 open"),
but the directory is 234 and per-checkpoint endpoints serve 210 (v1) / 258 (v2). 585
counts per-direction rows AND stale ones (fresh_last_6h only 155). `is_data_stale:false`
while 66% of checkpoints are stale-band. A buyer hitting the summary sees a fabricated
"352 open." *Fix:* one freshness-filtered, direction-deduped count; reconcile all three
surfaces. Evidence: M3-M4-RESULTS.md M4.

**F3 [breaks-coverage] The candidate→promote loop is stalled: 0 of 5,275 promoted.**
46 candidates vetted `real`@0.90–0.95 (Silat adh-Dhahr, Bani Na'im, Al-Badhan, Wadi Qana,
Taybeh gate, Azzun-Jayyous bridge, +~15 more after dedup) have sat unserved for a month.
Only 179/5,275 (3.4%) were ever LLM-vetted (matches llm_cache dying 2026-06-24). *Fix:*
re-run vetting; name-normalize (strip status words); promote the reviewed reals. This is
the coverage-expansion the "best Palestine data" goal needs. Evidence: M2-MISSES.md.

**F4 [erodes-trust] `journalist_targeted` is byline-triggered, not event-triggered.**
6/7 sampled were general Gaza casualties/gunfire bylined "مراسل صفا" (Safa reporter);
the type keys on the reporter attribution, not journalist harm. ~0% type-precision,
142/30d. *Fix:* require journalist/press entities in the text, not a reporter byline.

**F5 [erodes-trust] MENA scope-bleed: `regional_attack`+`northern_israel_siren` = 19% of alert volume.**
1,308 alerts/30d are Lebanon/Iran/Syria/Gulf — not actionable WB/Gaza safety. Suppressing
or clearly separating these two types alone lifts volume-weighted precision 65% → ~81%.
*Decision needed (Zaid):* is regional context a feature (separate feed/tag) or noise (drop)?

**F6 [erodes-trust] Vetter false-negatives hide real checkpoints.**
Real Hebron/Ramallah checkpoints (Farsh al-Hawa, Ein Siniya, Tunayb, Mukhmas, N. entrance
of Al-Bireh) were marked `not_a_checkpoint` at 0.0–0.3. The vetter under-recognizes
checkpoints named by a bare place/junction without a "gate" word. *Fix:* gazetteer
cross-check in the vetter; a known place-name is evidence for, not against.

**F7 [erodes-trust] Content-type false positives: commentary/media served as events.**
arrest_campaign 0.29, utility_cutoff 0.43, injury_report 0.57, demolition 0.57 —
podcasts, infographics, videos, statistics, opinion headlines, court rulings, advocacy
statements classified as live events. *Fix:* media/statement-marker filter (URLs,
بودكاست/إنفوجرافيك/اقرأ المزيد, statement verbs, past-tense analysis).

**F8 [erodes-trust] Staleness under-surfaced on per-checkpoint + effective_status.**
Checkpoints 6–12h old serve a live `effective_status` with `is_stale:false` (threshold
is ~12h). For conditions that flip in minutes, a 12h "open" without a stale flag misleads.
age_hours/freshness_band exist (good) but effective_status/is_stale don't reflect them.
*Fix:* degrade effective_status→unknown past a defensible age; flip is_stale at 6h.

**F9 [erodes-trust] Consensus over-weights the single latest report.**
5 dangerous false-opens: served passable while the recent window is closed/police-dominated
(زعتره served slow vs police:6; ترقوميا/حلحول open vs closed:3). Plus over-reactions the
other way (بيت_ايل closed vs open:9). 465/729 served off a single report. *Fix:*
window-weighted, severity-aware consensus instead of latest-wins.

**F10 [erodes-resilience] Checkpoint coverage rests on 4 channels; 3 are dead.**
a7walstreet/ahwalaltreq/road_jehad/roaddconditions carry 38.7k of 39.7k updates.
jisrrrr/khbnews1/aljesernews dead (0 in 7d); almasshta dying. If a top channel drops,
coverage craters with no redundancy. *Fix:* replace dead channels (Task 13 discovery sweep).

**F11 [cosmetic] Duplicates served + Beit Jala key corruption.**
Near-identical reposts served twice (evac 15≡16, flying-cp 20≡22, utility 89≡90); Beit
Jala canonical_key carries corrupted bytes (works via name_ar). Low impact.

## Strengths to sell (verified)
- Provenance 100% on every report (channel + msg id + timestamp + trust) — M7.
- High-precision WB/Gaza ground-event core (idf_raid, gaza_strike, flying_checkpoint ~100%).
- Coordinate integrity intact (10/10 June fixes) — M8.
- The freshness *data* exists (age_hours, bands) — honesty is a surfacing problem, not a data hole.

## Corpus measurements — DONE 2026-07-19
M5 + M1-recall completed (corpus re-pulled via a helper container; monitor restored, no
lasting prod impact). Two channel facts surfaced: **Almasshta checkpoint channel is now
private/banned** (0 pull); 6 security channels (safaps, palinfo, maannews, nablus_now,
shehabagency, wafanews) allow live receipt but not history pull. Discovery sweep returned
25 candidates (see SOURCES-SHORTLIST.md).

## Proposed Plan B cut line (recommendation, updated with F0)
**This round (highest trust-per-effort):**
- **F0** — classifier recall: broaden triggers so real airstrikes/raids/arrests/demolitions
  stop being dropped. Top item now: missed real events is the worst failure of a safety product.
- **F1** (WB siren geo-restrict), **F2** (reconcile the 585/258/210 counts + freshness-filter
  aggregates), **F5** (decide regional bleed → tag or drop), **F3** (re-vet + promote the
  reviewed real checkpoints).
These five move both customer-facing "breaks-trust" axes (missed events + false/inflated
served data) the most and add real coverage. **Next round:** F4, F6, F7, F8, F9 (classifier +
consensus refinements, each CI-gated). **Backlog:** F10 (channel replacement — discovery
candidates ready), F11 (cosmetic).
Every fix ships with a regression test wired into the classifier-eval CI gate; re-measure
after each so ACCURACY.md shows before/after.
