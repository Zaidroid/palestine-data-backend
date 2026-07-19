# M1 (classifier) + M5 (discard FN) — 2026-07-19

## Replay validity
Deployed classifier == repo HEAD: replaying the exact monitor path
(`is_security_relevant → classify → classify_wb_operational`) over 102 stored
alerts reproduced the stored type on **101/102** (0.98% drift; the one change,
a Lebanon strike west_bank_siren→regional_attack, is more correct). So
replay-based measurements are valid against production.

## M1-precision (FP among SERVED alerts) — DONE
Method: stratified 7/type sample of 30d fired alerts, hand-labeled (genuine,
current WB/Gaza safety **event** vs commentary/media/statistic/legal or
off-topic region), volume-weighted by 30d type counts.

- **Volume-weighted precision (genuine WB/Gaza safety event): 65.4%.**
- Sample real-rate 57.8%; off-topic-region 20.6%; content-FP 21.6%; type-error among real 11.9%.

### Per-type precision (sample) × 30d volume
| type | precision | vol/30d | note |
|---|---|---|---|
| idf_raid | 1.00 | 2052 | clean |
| gaza_strike | 1.00 | 1141 | clean |
| flying_checkpoint | 1.00 | 66 | clean |
| hospital_strike | 0.86 | 24 | 1 podcast FP; several are injuries w/ hospital as destination |
| journalist_targeted | 0.71* | 142 | *real events but **wrong type** — fires on "مراسل صفا" byline, 6/7 not about journalists |
| settler_attack | 0.71 | 263 | FPs = calls/features |
| road_closure | 0.71 | 8 | FPs = Gaza "red line" commentary |
| evacuation_order | 0.67 | 3 | tiny N |
| demolition | 0.57 | 411 | FPs = opinion headlines, court ruling, metaphor |
| injury_report | 0.57 | 932 | FPs = podcasts, prisoner-release, body-recovery |
| utility_cutoff | 0.43 | 13 | FPs = infographics/videos/features |
| arrest_campaign | 0.29 | 241 | FPs = statistics, vigils, advocacy |
| west_bank_siren | 0.29 | 272 | **0/7 actually WB** — Bahrain/Kuwait/Jordan/Lebanon/Gaza |
| regional_attack | 0.00 | 1293 | **entirely Lebanon/Iran/Syria/Gulf — 19% of all alerts** |
| northern_israel_siren | 0.00 | 15 | entirely Lebanon / N. Israel |
| school_closure | 0.00 | 1 | tiny N |

## M1 findings (ranked by trust impact)
1. **`west_bank_siren` has ~0% true-WB precision** — 0/7 sampled were West Bank (Bahrain, Kuwait, Jordan, Lebanon, Gaza). The classifier's "shared airspace = local threat" rationale (valid for Israel proper) is over-extended across the entire MENA region. A "West Bank siren" alert that is actually Bahrain is maximally trust-destroying for a safety product. 272 alerts/30d.
2. **`journalist_targeted` is byline-triggered, not event-triggered** — 6/7 are general Gaza casualties/gunfire bylined "مراسل صفا" (Safa reporter); the type keys on the reporter attribution, not journalist harm. ~0% type-precision. 142/30d.
3. **`regional_attack` + `northern_israel_siren` = 1,308 alerts/30d (19% of volume) of MENA scope-bleed** (Lebanon/Iran/Syria/Gulf). For a WB+Gaza product these are not actionable safety events. **Biggest single precision lever: suppressing or clearly separating these two types lifts volume-weighted precision 65% → ~81%.**
4. **Content-type FPs (commentary/media as events)** across arrest_campaign (0.29), utility_cutoff (0.43), injury_report (0.57), demolition (0.57): podcasts, infographics, videos, statistics, opinion headlines, court rulings, and advocacy statements are classified as live events. A signal-density / media-marker filter (URLs, "بودكاست", "إنفوجرافيك", "اقرأ المزيد", statement verbs) would recover most.
5. **Duplicates served** — evacuation_order 15≡16, flying_checkpoint 20≡22, utility_cutoff 89≡90, road_closure 74≡75: content-dedup misses near-identical reposts across/within sources.
6. **Type imprecision on real events** — hospital_strike often = injury reports where a hospital is the destination, not a hospital being struck; west_bank_siren catches real Gaza strikes. Real events, wrong label → misleading type filters.

**High-precision core to sell now:** idf_raid, gaza_strike, flying_checkpoint, settler_attack, demolition(after media filter), road_closure — the WB/Gaza ground-event feed is strong; the regional/siren/journalist types are where trust leaks.

## M5 (discard false-negatives) + M1-recall — DONE (corpus 2026-07-19)
Corpus re-pull: 4 security channels (QudsN, alkofiyatv, alqastalps, eyeonpalestine2),
5,597 messages, ~8-day window. Replayed the full monitor path offline.

- **Fire rate 38.9%** (2,180 fired / 3,417 discarded).
- **Discard false-negative rate: 11.9%** (19 of a 160-message stratified discard sample
  were real WB/Gaza safety events wrongly dropped) → **~406 missed events** extrapolated
  across the corpus window.
- **Recall estimate ≈ 78%** (caveat: 4-channel sample; TP≈0.65×fired). The classifier
  misses roughly **1 in 5 real events**.
- 5 additional discards were real **checkpoint-congestion** reports on a security channel
  (Jaba, Shu'fat) — real, but they belong to the checkpoint pipeline, not alerts (routing gap).

### What gets missed (verified DISCARD under replay)
- **Gaza airstrikes** phrased with غارة/غارتين ("طيران الاحتلال يشن غارتين على خان يونس") —
  tier-1 needs an attack verb; غارة (raid/airstrike) is under-covered, and tier-2 is WB-operational,
  so Gaza strikes in this phrasing fall through both.
- **Single arrests** ("تعتقل فلسطينيا في مسافر يطا", "تعتقل 4 شبان") — the arrest trigger
  appears to require a campaign/plural; discrete arrests drop.
- **Demolitions** ("عمليات الهدم في قرية عنزا", "نسف مبانٍ سكنية شرقي غزة") — narrow trigger.
- **Settler assaults** ("مستوطنون يعتدون على عائلة... ورش غاز الفلفل في حوارة").
- **Raids** ("اقتحام مدينة البيرة وفتّش محل ألعاب"), **clashes** ("اندلاع مواجهات في بيت ريما/جيّوس").

**Root cause:** keyword-brittle classification — the same event type fires on one phrasing
and drops on another (prod DID fire on 2,052 raids / 411 demolitions / 263 settler attacks,
so coverage is partial, not absent). *Fix direction:* broaden verb/trigger coverage
(غارة family, single-arrest, نسف/تجريف), add a recall-safety net for high-signal event
nouns, and route checkpoint-congestion off security channels into the checkpoint pipeline.
This is the safety-critical failure mode — missed real events — and outranks precision.

Note: 6 higher-volume security channels (safaps, palinfo, maannews, nablus_now, shehabagency,
wafanews) returned no history (account receives them live but has not joined for GetHistoryRequest);
the sample is the 4 accessible channels. Almasshta checkpoint channel is now private/banned.
