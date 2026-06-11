# Source research — June 2026 (Tier-A rework, phase 1)

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
