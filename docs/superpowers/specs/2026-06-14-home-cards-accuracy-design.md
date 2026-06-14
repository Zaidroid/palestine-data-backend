# Home stat cards — accuracy redesign

**Date:** 2026-06-14
**Status:** approved, pre-implementation
**Repos:** `palestine-data-backend` (backend `services/westbank-alerts`), `palestine-databank-web` (frontend `src/westbank`)

## Problem

The four home cards on `live.zaidlab.xyz` are not defensible numbers. The
"injuries" card read **309** — `/stats/today` summed the classifier's
free-text `count` over every `injury_report` since midnight UTC with no
geofence, so three alerts that mis-extracted "90" from a cumulative
prisoner-death figure plus Gaza-wide casualty roundups (16+6+3) inflated
~14 West Bank reports into 309. An audit of the other three found the same
class of defect:

| Card | Showed | Distinct | Defect |
|------|--------|----------|--------|
| Raids | 21 | ~9 | duplicate channel reports of one raid, not deduped |
| Arrests | 4 | ~3 | still **sums** free-text `count` (latent inflation) |
| Settler | 1 | 1 | accurate but near-zero signal |
| Injured | 17 | ~3 | deaths + Gaza + cumulative + duplicates |

**Already shipped (C, 2026-06-14):** `/stats/today` injuries now counts
distinct reports (not the summed count) and excludes `admin1=="Gaza Strip"`;
frontend drill-down filters `injury_report`. Live 309 → 17. This spec covers
the follow-up redesign.

## Decision

Replace the four cards with the system's strongest data — checkpoint status
(whitelist-filtered, deduped by `canonical_key`, with freshness) — plus two
deduped repression counts. Casualties move to the live feed, not a card.

| Card | Value (live 2026-06-14) | Source |
|------|------------------------|--------|
| **Closed** | 49 | `s.summary.by_status.closed` (already in store) |
| **Restricted** | 105 | `s.summary.total_active − by_status.open` (already in store) |
| **Raids** | ~9 | `/stats/today.military_raids_today`, deduped |
| **Detentions** | ~3 | `/stats/today.total_arrests_today`, deduped + 1-per-event |

This is **read-time only**: no DB migration, no `entity_key` column, no
ingestion change, no killed/injured split (those were for the casualty cards
we dropped).

## Backend — `services/westbank-alerts/app/stats.py`

Evolve `aggregate_today_counts(alerts)` (pure, already unit-tested):

- **Raids** = distinct West-Bank `idf_raid` events whose `event_subtype != "arrest"`,
  deduped by a **location-day signature**: `normalize(area or admin2 or title-core)`.
  (Today is already the query window, so day is implicit.)
- **Detentions** (`total_arrests_today`) = distinct West-Bank detention events
  across `arrest_campaign` + `child_detention` + `idf_raid` with
  `event_subtype == "arrest"`. Dedupe by extracted victim name when present
  (hardened `_extract_named_individual` + honorific-stripping normalizer),
  else by location signature. **Stop summing** `count` — one event = one.
- **Geofence** unchanged from C (`admin1 == "Gaza Strip"` excluded). Raid/
  detention de-dup keys are computed only over West-Bank alerts.
- `injuries`/`settler` keep their C-era semantics — still returned so the
  public `/live/stats/today` contract is unbroken — but are not carded.

New small helpers in `stats.py`, all unit-tested:
`_norm_sig(alert)` (location/title signature), `_detention_key(alert)`
(name-or-location), `_is_raid(alert)` / `_is_detention(alert)` (type+subtype).

`/stats/today` route is unchanged — it still spreads `aggregate_today_counts`.

## Frontend — `palestine-databank-web/src/westbank`

- `views/NowSheet.tsx`: replace the four `statCards` entries:
  - `closed` → `s.summary?.by_status?.closed ?? 0`
  - `restricted` → `(s.summary?.total_active ?? 0) − (s.summary?.by_status?.open ?? 0)`
  - `raids` → `s.statsToday?.military_raids_today` (alertType `idf_raid`)
  - `detentions` → `s.statsToday?.total_arrests_today` (alertType `arrest_campaign`)
- Drill-downs: Closed/Restricted expand to the matching checkpoints from
  `s.cps` (status `closed`; status `!= open`). Raids/Detentions keep the
  existing `getRelatedAlerts` path.
- `state/store.ts`: extend `Summary` type with `fresh_last_6h?: number` (already
  in the payload) for a freshness sub-label on the checkpoint cards.
- `i18n.ts`: add `closed`, `restricted`, `detentions` (raids exists). Closed =
  مغلق, Restricted = مقيّد, Detentions = اعتقالات.

## Testing

Extend `test_stats_today.py` (standalone `python3`, real `Alert` objects):

- `test_raids_dedupe_same_town_one_event`: 5 `idf_raid` reports, same `area`,
  different `source` → `military_raids_today == 1`.
- `test_raid_with_arrest_subtype_counts_as_detention_not_raid`.
- `test_detentions_dedupe_and_no_count_sum`: an `arrest_campaign` with
  `count=30` plus a duplicate named detainee → distinct events, not 30.
- Existing C tests stay green (injuries distinct-report + Gaza exclusion).

## Honest limitations

- Checkpoint statuses can be stale — only 138/358 refreshed in 6h on the
  sample day. Surfaced via the freshness sub-label, not hidden.
- Raid location-dedup undercounts a town raided more than once in a day.
- Detention name-extraction is heuristic (Arabic, regex) — residual split/
  merge on heavy rephrasing. Logged, not silently dropped.

## Rollout

1. Backend: commit + push `main`, `bash /opt/stacks/palestine/deploy.sh` on
   `.114` (rebuild; no migration). Verify `/stats/today` raids/arrests drop to
   deduped values.
2. Frontend: `npm run build` + `netlify deploy --prod --dir=dist`. Verify the
   four new cards render with live values and drill-downs work.
