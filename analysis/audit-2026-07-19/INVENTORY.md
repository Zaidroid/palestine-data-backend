# Snapshot inventory — 2026-07-19


## checkpoints.db

- `checkpoints`: 392 rows — created_at: 2026-06-10 -> 2026-06-14
- `checkpoint_updates`: 59792 rows — timestamp: 2026-06-09 -> 2026-07-19
- `checkpoint_status`: 729 rows — last_updated: 2026-06-10 -> 2026-07-19
- `vocab_discoveries`: 246 rows — last_seen: 2026-06-14 -> 2026-07-19
- `learned_vocab`: 16 rows — created_at: 2026-06-10 -> 2026-07-17
- `checkpoint_candidates`: 5275 rows — last_seen: 2026-06-17 -> 2026-07-19
- `user_reports`: 0 rows
- `llm_cache`: 14793 rows — created_at: 2026-06-14 -> 2026-06-24

## alerts.db

- `alerts`: 9233 rows — timestamp: 2026-06-10 -> 2026-07-19
- `webhooks`: 0 rows
- `channels`: 10 rows
- `security_vocab_candidates`: 0 rows
- `channel_reliability`: 30 rows — last_updated: 2026-06-10 -> 2026-06-11
- `people_killed`: 70482 rows — created_at: 2026-06-10 -> 2026-07-19
- `people_injured`: 1152 rows — created_at: 2026-06-10 -> 2026-07-19
- `people_detained`: 546 rows — created_at: 2026-06-11 -> 2026-07-19
- `structures_damaged`: 595 rows — created_at: 2026-06-11 -> 2026-07-19
- `actor_actions`: 3404 rows — created_at: 2026-06-10 -> 2026-07-19
- `keyword_weight_overrides`: 0 rows
- `alert_review_queue`: 551 rows
- `anomalies`: 181 rows
- `humanitarian_incidents`: 19173 rows
- `incidents`: 3641 rows — last_updated: 2026-06-10 -> 2026-07-19
- `incident_alerts`: 9233 rows
- `push_subscriptions`: 1 rows — created_at: 2026-06-11 -> 2026-06-11
- `incident_cluster_map`: 869 rows — created_at: 2026-06-14 -> 2026-06-25

## news.db

- `articles`: 5456 rows
- `fetch_runs`: 2201 rows

## checkpoint_updates per channel, last 30 days

- a7walstreet: 17450
- ahwalaltreq: 10881
- road_jehad: 7027
- roaddconditions: 3403
- almasshta: 1913
- peopleofhebron: 144
- jisrrrr: 10
- khbnews1: 7
- aljesernews: 5
- ahwaltrkwhwagz_nablous: 3

**checkpoint_updates provenance:** raw_message present 59792/59792, source_msg_id present 59792/59792

## alerts per source, last 30 days

- qudsn: 1882
- safaps: 1548
- palinfo: 1150
- alkofiyatv: 864
- alqastalps: 518
- rt_arabic: 246
- anadolu_ar: 223
- aljazeera_ar: 179
- eyeonpalestine2: 152
- maannews: 71
- a7walstreet: 18
- roaddconditions: 8
- ahwalaltreq: 7
- road_jehad: 5
- jisrrrr: 5
- khbnews1: 1

## Early signals (flag for FINDINGS)
- **Provenance 100%** on checkpoint_updates (raw_message + source_msg_id all present) → M7 strong, M3 feasible.
- **Live security channel set = the `channels` DB table (10)**, NOT env TELEGRAM_CHANNELS (5, stale seed). get_channels() reads the DB. Authoritative sets saved to snapshot/channels.json.
- **5 of 10 checkpoint channels are near-dead** (30d): peopleofhebron 144, jisrrrr 10, khbnews1 7, aljesernews 5, ahwaltrkwhwagz_nablous 3. a7walstreet/ahwalaltreq/road_jehad/roaddconditions/almasshta carry the load.
- **channel_reliability frozen since 2026-06-11** (last_updated). Dynamic-trust may not be updating on the alerts side — investigate in M6.
- **llm_cache last write 2026-06-24** — MiniMax fallback may be silently off/exhausted since. Investigate.
- **user_reports = 0** — crowdsource /v2/report never used; v2 "crowd" trust is 100% Telegram-derived.
- **3 RSS feeds** (aljazeera_ar/anadolu_ar/rt_arabic) contribute alerts but are not text-replayable offline (no stored raw body join by msg_id the same way) — replay covers telegram only; note RSS separately.
