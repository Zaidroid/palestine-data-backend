# Tier 2 databank audit — findings (2026-07-20)

Measure-first pass over the historical databank, mirroring the Tier 1 audit
method: a read-only snapshot of the **live production API** (`api.zaidlab.xyz`),
not the repo. Totals summed live from `/api/v1/stats`.

**Scale:** 295,808 records across 22 categories (both the old "132k/14-cat" in
docs and the memory's "196k" were stale — corrected in this round).

## D1 — Encoding bug: Arabic mojibake in the `westbank` category  ✅ ROOT-CAUSED + FIXED IN CODE

- **Symptom:** `westbank`-category records serve Arabic `governorate`/`locality`
  as `Ø¬Ù†ÙŠÙ†` instead of `جنين`. Measured: 80 mangled string values in a
  20-record sample; **isolated to `westbank`** — the other 21 categories are clean.
- **Root cause:** `scripts/fetch-westbank-data.js` reads an HDX shapefile via the
  `shapefile` npm lib, whose DBF text decoder **defaults to `windows-1252`**
  (`node_modules/shapefile/index.js:27`). This DBF's Arabic is UTF-8, so the
  bytes get misdecoded (classic UTF-8-as-cp1252 mojibake).
- **Fix (committed):** pass `{ encoding: 'utf-8' }` to `shapefile.open(...)`.
- **Remaining (Zaid-gated pipeline):** re-run `npm run fetch:westbank` → re-populate
  → deploy to regenerate the baked `westbank` data cleanly from source. The fix
  is in code but the served data stays mangled until that re-fetch runs.

## D2 — Freshness: stale categories needing a refresh  ⏳ ZAID-GATED (re-run fetchers)

Days since latest record (vs 2026-07-20):

| Category | Records | Latest | Stale (days) | Read |
|---|---|---|---|---|
| historical | 2,517 | 2005-08-22 | 7,637 | **expected** — static archive, not stale |
| martyrs_snapshot_2023 | 60,200 | 2026-06-09 | 41 | snapshot dataset — expected static |
| settlements | 50 | 2023-12-31 | 931 | **stale** — refresh (annual-ish source) |
| pcbs | 2,060 | 2025-01-01 | 564 | **stale** — census cadence, but 1.5y |
| aid_access | 50,059 | 2025-01-16 | 549 | **stale** — large category, worth a refresh |
| health | 40,769 | 2026-04-08 | 103 | moderately stale |
| food | 26,419 | 2026-05-15 | 66 | moderately stale |
| refugees / prisoners / connectivity | — | — | 11–26 | acceptable |
| water, funding, westbank, news, land, infrastructure, education, culture, conflict | — | ≤3 | fresh — nightly pipeline healthy |

The live categories (≤3 days) confirm the nightly pipeline works; the stale ones
are slower upstreams whose fetchers haven't been re-run. Refresh = re-run the
relevant `fetch:*` scripts (Zaid-gated pipeline action; see the checklist).

## D3 — Future-dated records  ⚠️ REVIEW (likely annual-bucket convention, not corruption)

`economic`, `demolitions`, `casualties` report `date_range.latest = 2026-12-31`
(164 days ahead). Depth check: only a handful (economic 3, demolitions 1,
casualties 1 in the first 1,000). These are **annual series** — a 2026 annual
figure forward-stamped to Dec-31 of its reporting year is a modelling choice,
not necessarily bad data. **But** it inflates `date_range.latest` and breaks
naive `date <= today` filters. Recommendation: stamp annual buckets to the
data's real as-of date (or expose a `bucket: annual` flag), so the freshness
headline and time-series filters stay honest. Not urgent; not corruption.

## What changed this round (autonomous)

- Fixed D1 root cause in code (`fetch-westbank-data.js` UTF-8 DBF decode).
- Corrected the headline record count everywhere (295k, 22 categories):
  OTF concept note, GRANTS-PACK, MONETIZATION positioning.

## What's Zaid-gated (pipeline / server)

- Re-fetch `westbank` to flush D1 from the served data.
- Refresh stale categories (D2): `fetch:pcbs`, aid-access source, settlements.
- Decide D3 annual-bucket date convention (optional).

## Method

`/api/v1/stats` for per-category counts + date ranges; per-category
`/unified/<cat>?limit=20` sampled and walked for mojibake (`[ØÙ]` lead-byte
signature via jq); future-date depth via `/unified/<cat>?limit=1000` filtered
`date > today`. Read-only throughout.
