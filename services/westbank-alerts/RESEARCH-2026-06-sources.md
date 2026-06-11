# Source research — June 2026 (Tier-A rework, phases 1–2)

## PHASE 2 EXECUTED 2026-06-11 (with Zaid's per-channel approval)

**Live config now:** security channels = QudsN, palinfo, alqastalps, maannews,
safaps, eyeonpalestine2, alkofiyatv (dead wafanews/nablus_now/shehabagency
removed). CHECKPOINT_CHANNELS = ahwalaltreq, **a7walstreet, road_jehad,
peopleofHebron** (.env backed up to .env.bak-2026-06-11). All 11 resolve.

**Telethon discovery (SearchRequest, via service session)** found the whole
road-channel ecosystem — top hits, all active 2026-06-11 unless noted:
a7walstreet (124K), road_jehad (29.7K), peopleofHebron (13.7K, Hebron),
aljanoop48 (10.5K, south), ahwalaltareq (7.6K, north→Ramallah), ahwaltareq1
(6.2K), rsdrasd (3.7K), Roaddconditions (2.4K, Ramallah),
ahwaltrkwhwagz_nablous (2.2K, Nablus), Almasshta (1.1K, Jericho),
ahwalaltorq (1K, S-Nablus), roadsnajah (1.3K, Najah radio). Full list in
`/data/corpus/discovery.json` on the server. **Future per-governorate
expansion candidates: aljanoop48, Roaddconditions, ahwaltrkwhwagz_nablous,
Almasshta, ahwalaltorq.**

**Corpus captured** (~21k messages, 10 channels → `/data/corpus/*.jsonl`,
mirrored at /tmp/corpus locally). Evidence (scripts/analyze_corpus.py):

| channel | msgs/day | status-content | character |
|---|---|---|---|
| a7walstreet | 676 | 46% | checkpoint firehose |
| ahwalaltreq | 414 | 84% | checkpoint backbone (current) |
| alkofiyatv | 266 | 28% | raids/settlers |
| qudsn | 226 | 36% | broad incidents |
| safaps | 205 | 85%* | *🔴 used as news bullets — NOT statuses |
| road_jehad | 179 | 47% | checkpoint, WB-wide |
| palinfo | 142 | 34% | broad |
| alqastalps | 76 | 30% | Jerusalem/EJ raids + أزمة reports |
| eyeonpalestine2 | 26 | 29% | aggregation |
| maannews | 19 | 20% | establishment news |

**Classifier findings from corpus:**
- Emoji semantics are channel-specific: safaps uses 🔴 as a bullet (1,952×) —
  emoji status parsing must stay restricted to checkpoint channels.
- ahwalaltreq vocabulary confirmed: ✅/سالك dominate (~2.6k/1.9k per week),
  ❌/مغلق secondary; congested family (أزمة/كثافة) underweighted in current
  vocab relative to corpus frequency.
- alqastalps is the only news channel with heavy أزمة (traffic) reporting —
  candidate for Jerusalem-area congestion signals.
- Naive token mining is too noisy for KB names — checkpoint-name extraction
  should reuse checkpoint_parser line splitting over the corpus instead
  (next iteration; history_analyzer needs a non-interactive auth fix to run
  under `docker compose run` — it EOFs on the Telethon phone prompt).



Empirical probe of Telegram channels via `t.me/s/<handle>` previews, 2026-06-11.
Caveat: channels can disable web previews — "hidden" ≠ dead. Channels the
service already receives (e.g. `ahwalaltreq`) show as hidden but are alive.

## Findings on CURRENT sources

| channel | status | evidence |
|---|---|---|
| qudsn | healthy | 692K subs, posting today |
| palinfo | healthy | 16.6K subs, posting today |
| **nablus_now** | **ZOMBIE — last post 2022-02-26, 50 subs** | drop or replace |
| ahwalaltreq | alive (preview hidden) | checkpoint updates still flowing |
| MOHMediaGaza | (bulletins) not probed | — |

## Verified NEW candidates (public previews, active today)

| channel | subs | focus | suggested weight |
|---|---|---|---|
| alqastalps | 117K | Jerusalem / al-Qastal — strong EJ + raids coverage | 0.7 |
| maannews | 43.5K | Ma'an agency — establishment news | 0.8 |
| eyeonpalestine2 | 39.7K | WB-wide incident aggregation | 0.5 |
| safaps | 24.5K | Safa agency | 0.7 |
| alkofiyatv | 7.7K | Kofiya TV | 0.6 |

Dead/renamed handles confirmed: shehabtelegram, ShehabAgency, wattanTV,
jmedia_ps, baladi24, alresalahnet, jeninnow (2021), bethlehem_news (2023),
nabluslive (2026-02 but 328 subs — marginal).

## Road-condition channels (the checkpoint gold)

Per-governorate "أحوال الطرق / حواجز" channels do not expose web previews —
discovery must run **inside Telegram** via the service's Telethon session:

```python
from telethon.tl.functions.contacts import SearchRequest
await client(SearchRequest(q='أحوال الطرق', limit=50))
await client(SearchRequest(q='حواجز الضفة', limit=50))
await client(SearchRequest(q='أحوال الطرق الخليل', limit=50))  # per governorate
```

Also mine forwarded-from channel IDs in the existing message corpus —
`ahwalaltreq` frequently forwards from feeder channels per region.

## Mandated methodology (from the rework directive)

1. Join candidates with the service account (admin action — needs Zaid's OK
   per channel to avoid account flags; join gradually, 2-3/day).
2. Bulk-backfill history per channel: `python -m app.history_analyzer
   --limit 5000` (prior art) into a per-channel corpus.
3. Build the new classifier/vocab from corpus evidence, not hand-tuned
   keywords: frequency of status words per channel, checkpoint-name n-grams
   (feeds known_checkpoints.json), FP patterns per channel.
4. Channel-reliability baselines from observed retraction/corroboration
   rates instead of the current hand-set weights (`/channel-reliability`
   shows 0 observed events for most — the loop isn't learning yet).

## Accuracy debt folded in (from memory + this session)

- Lebanon-area alert tagged zone=west_bank (2026-06-10) — zone assignment
  needs the admin/oslo stamps as ground truth, not keyword zones.
- 🟣→military emoji parser failing its test.
- ~50 garbage checkpoint names in live DB ("سيارة", "وخارج", "تحديث فتحت") —
  the whitelist gate accepts provisionals too eagerly; corpus stats should
  drive promotion instead.
- geocode unresolved tail (54 keys) is mostly that garbage; real places now
  resolve at 85%+ via geo_resolver.
