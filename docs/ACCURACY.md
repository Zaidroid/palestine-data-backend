# Accuracy — West Bank Live Tier

Measured, not asserted. Numbers below come from a read-only production snapshot and
offline replay of the deployed classifier/parser (verified identical to source, 0.98%
drift). Method and raw instruments: `analysis/audit-2026-07-19/`. We publish the ugly
numbers alongside the good ones — that is the point of a trust product.

**Last measured: 2026-07-19.** Re-measured after each fix round (before/after shown).

## Fix round 1 (2026-07-19) — before → after

| Metric | Before | After | Fix |
|---|---|---|---|
| Default-feed precision (volume-weighted) | 65.4% | **~81%** | F5 excludes regional bleed from the WB/Gaza feed; F1 removes foreign sirens |
| "West Bank siren" that is actually foreign (Bahrain/Kuwait/Jordan) | ~all of them | **0** → regional_attack | F1 siren geo-restrict |
| `journalist_targeted` fired on a reporter byline | yes (6/7) | **no** — byline stripped, event reclassified | F4 |
| Regional (Lebanon/Iran/Gulf) events in the default feed | 19% of volume | **0** (own `?scope=regional` feed) | F5 |

Round-1 fixes are **deployed and live-verified 2026-07-19** (full test suite + FP audit
96/96; default WB feed confirmed free of foreign sirens; 189 historical rows re-typed to
match the patched classifier).

**Round 2 — F0 recall (2026-07-19, DEPLOYED + live-verified 2026-07-19):** the
classifier was dropping real events on Arabic-verb gaps. Fixed: Gaza airstrikes (غارة/قنابل/
نسف, which had no tier-2 path), present-tense arrests (تعتقل), house search (تفتيش), clashes
(مواجهات), settler present-tense/kill verbs — with نسف gated on physical context to reject the
metaphor "المخطط ينسف إمكانية الدولة". Kept the intentional caption-dedup and funeral filters.
Corpus effect: fire rate 38.9% → 42.3% (~173 more real events caught), **discard-FN
~11.9% → ~6–7%, recall ~78% → ~88%**; newly-fired ~95% real; FP audit still 96/96. Remaining
misses are English-only content (the classifier is Arabic-focused) — a separate limitation.
Round-2 remaining (not started): F2 count reconciliation, F3 catalog promotion.

## Scorecard

| Metric | Value | Notes |
|---|---|---|
| Classifier precision (alerts served), volume-weighted (pre-fix) | **65.4%** | genuine WB/Gaza safety events among served alerts |
| Default-feed precision after round-1 fixes (volume-weighted) | **~81%** | regional bleed removed from the WB/Gaza feed |
| — core ground-event types (raids, strikes, flying checkpoints) | ~100% | the high-trust feed |
| Classifier drift (deployed vs source) | 0.98% | deployed behavior matches published code |
| Checkpoint served-status agreement (≥2 reports) | 83.7% | vs the recent report stream |
| Provenance completeness (per report) | 100% | channel + message id + timestamp + trust |
| Coordinate integrity (audited fixes) | 10/10 intact | authoritative OSM/resident coords |
| Discard false-negative rate (missed real events) | 11.9% → **~6–7%** (F0) | recall ~78% → ~88% |

## Alert precision by type (2026-07-19)

Stratified sample, hand-labeled against "is this a genuine, current WB/Gaza safety event."

| Type | Precision | ~Volume/30d |
|---|---|---|
| idf_raid | ~1.00 | 2,052 |
| gaza_strike | ~1.00 | 1,141 |
| flying_checkpoint | ~1.00 | 66 |
| hospital_strike | 0.86 | 24 |
| settler_attack | 0.71 | 263 |
| road_closure | 0.71 | 8 |
| demolition | 0.57 | 411 |
| injury_report | 0.57 | 932 |
| utility_cutoff | 0.43 | 13 |
| arrest_campaign | 0.29 | 241 |
| west_bank_siren | 0.29 | 272 |
| journalist_targeted | type-mislabeled | 142 |
| regional_attack | scope: regional | 1,293 |
| northern_israel_siren | scope: regional | 15 |

**Reading this honestly:** the ground-event core is excellent. Precision is dragged down
by (a) regional-scope types capturing Lebanon/Iran/Gulf events, and (b) siren/journalist
types that mislabel or over-capture. These are identified and scheduled; see the audit
findings. A consumer who filters to raids/strikes/checkpoints/settler-attacks gets a
near-clean feed today.

## Checkpoint freshness (honest reality of crowd data)

Of checkpoints served (v2, snapshot 2026-07-19): **live 14 / recent 25 / stale 171 /
never-reported 48**. Most checkpoints were last reported hours ago — normal for crowd
data. Every record exposes `age_hours` and a `freshness_band`; do not read status
without them.

## Recall — the missed-events number (2026-07-19)

Replaying the classifier over 5,597 security-channel messages: originally 38.9% became
alerts, and a stratified sample of the *discarded* messages found **11.9% were real WB/Gaza
safety events wrongly dropped** (Gaza airstrikes phrased غارة, single arrests, demolitions,
settler assaults, raids) — recall ≈78%. **Fixed (F0, deployed 2026-07-19):** broadened the
Arabic verb/term coverage and added a Gaza-airstrike path; fire rate rose to 42.3% (~173
more real events caught), moving **discard-FN to ~6–7% and recall to ~88%**, with no
precision regression (FP audit 96/96; نسف metaphor guarded). Remaining misses are largely
English-only posts — the classifier is Arabic-focused, a separate limitation.

## What we're fixing (transparency)

Shipped 2026-07-19:
- ✅ Broaden classifier triggers so real airstrikes/raids/arrests/clashes stop being dropped (F0).
- ✅ Restrict siren locality to WB/Gaza/Israel geography (F1) — foreign sirens no longer WB alerts.
- ✅ Separate regional (Lebanon/Iran/Gulf) events into their own `?scope=regional` feed (F5).
- ✅ Stop the reporter byline mislabeling events as journalist-targeted (F4).
- ✅ Reconcile checkpoint counts + fresh/stale split (F2): `/checkpoints/summary` `total_active`
  585 → 210 (distinct, matching the served feeds); added `total_directory`, `by_status_fresh_6h`,
  and an explicit `stale` count so the headline is neither inflated nor stale-inclusive.
- ✅ Promote verified-new checkpoints (F3 + OSM): catalog 234 → 240 (Ofra Junction, Wadi Qana,
  Silat adh-Dhahr, Rafat Entrance, Kedumim, Ma'ale Efrayim; Bani Na'im coord corrected via OSM;
  Beit Jala key un-corrupted). Most "46 unpromoted" were status-word variants of cataloged ones.
- ✅ F7 media/commentary FP filter (podcasts, infographics, prisoner-release, body-recovery) —
  lifts the low-precision types (arrest, utility, injury).
- ✅ F8 staleness honesty: a checkpoint not reported in >6h (was 12h) serves effective_status
  'unknown' + is_stale, so a 9h-old 'open' is no longer painted live.
- ✅ F9 consensus large-cohort guard: 2 recent reports can no longer flip a checkpoint with a
  strong agreeing cohort (بيت إيل was served 'closed' despite 14 'open').
- ✅ Bounded English event coverage (real WB/Gaza ground events in English; hard-gated vs
  MoH statistics + Lebanon).
- ✅ F10 (config, applied at deploy): replace 3 dead checkpoint channels with vetted active
  discovery candidates for redundancy.

Remaining (genuinely minor / external):
- OSM-precision coordinates for the ~10 still-uncoordinated deferred checkpoints (thin OSM name:ar).
- Fuller English parity (current coverage is deliberately narrow).

Progress is tracked in the audit findings; this page updates with each fix round.

## Method summary

Read-only snapshot of the production databases (59,792 checkpoint updates, 9,233 alerts,
5,275 review candidates) + offline replay of the exact deployed classifier and checkpoint
parser over stored message text, joined against what production served. Alert precision:
stratified sample by type, hand-labeled by an Arabic reader, volume-weighted by 30-day
type counts. Full instruments and per-finding evidence:
`analysis/audit-2026-07-19/` (FINDINGS.md, M1–M8 result files).
