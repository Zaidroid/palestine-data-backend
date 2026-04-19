# Palestine Data Backend

Real-time operational intelligence for the West Bank and Gaza, backed by
official Palestinian statistics and NGO-grade humanitarian context.

The platform has two halves:

1. **Alerts service** (`services/westbank-alerts/`) — a Python/FastAPI server
   that monitors Telegram news channels every ~5 seconds, classifies events
   into 9 structured alert types, enriches them with zone + coordinates, and
   fans out to WebSocket / SSE / webhook subscribers in under 50 ms. Every
   alert carries a **confidence score** and **source reliability weight**, and
   can be **retracted or corrected** post-publication with a push event to all
   subscribers. This is the product we are building.

2. **Unified data API** (`src/api/`) — an Express service that serves
   normalized historical datasets (conflict, water, health, etc.) with
   honest freshness gating, license-aware responses, and a canonical schema.
   The API's purpose is credibility: it gives the alerts service a trusted
   historical baseline to hang off of.

---

## Strategic positioning

The repo started as "aggregate every Palestine dataset we can find." It has
since narrowed: **the moat is real-time, not historical**. ACLED, HDX, and
Tech4Palestine already serve historical event data; none offer a live
operational feed with confidence scoring, geographic webhook filters, or
retractions. That is the product.

Historical categories live on — but only where the license is green-light for
downstream reuse and the upstream is still publishing. Stale stubs have been
pruned. Frozen datasets (e.g. the Oct-2023 martyrs snapshot) are retained
under the `_snapshot_YYYY` suffix with an `active: false` metadata flag so
consumers do not treat them as live.

Commercial surface (Stripe, billing, API-key tiers) is scaffolded but
**deferred** until the data and alert layers are production-grade.

---

## Data catalog

14 unified categories, ~194 k records. Every response carries freshness
metadata and a `Warning: 299` header when the category has not updated in 90+
days.

| Category | Records | Source(s) | License | Status |
|:--|--:|:--|:--|:--|
| **Water / WASH** | 72,603 | HDX WASH Cluster (OCHA) | CC-BY | live |
| **Martyrs** | 60,200 | Tech4Palestine | CC-BY-4.0 | live (60,199 named + 1 cumulative summary; current MoH total: 72,345 killed Gaza, 1,065 WB) |
| **Health** | 38,232 | WHO GHO | CC-BY-NC-SA | live, non-commercial only |
| **Funding** | 9,139 | UN OCHA Financial Tracking Service | CC-BY-IGO-3.0 | live (NEW) |
| **Education** | 2,990 | HDX | CC-BY | live |
| **West Bank layers** | 2,962 | HDX (schools, villages, barrier) | CC-BY | live |
| **Conflict** | 2,101 | Tech4Palestine, OCHA, B'Tselem | Mixed (CC-BY / CC-BY-NC) | live |
| **Conflict/Historical** | 1,572 | World Bank + PCBS | Public | live |
| **Infrastructure damage** | 1,333 | Tech4Palestine | CC-BY | live |
| **Refugees** | 1,230 | UNHCR ODP + UNRWA camps | CC-BY-4.0 / CC-BY-SA | live |
| **PCBS** | 875 | Palestinian Central Bureau of Statistics | Public | live |
| **Land** | 691 | OCHA, B'Tselem, Peace Now | Mixed | live |
| **Culture** | 333 | UNESCO, Wikidata | CC0 / CC-BY | live |
| **News** | 66 | MEE, Al Jazeera, WAFA | Fair-use (non-redistributable) | live |

Prior to the pivot the catalog listed `prisoners`, `historical`, and
`humanitarian` — all have been removed as stubs (1, 44, and 598 records
respectively, with broken attributions). The original 75-record `refugees`
stub (Wikipedia camp scrape) is now augmented by 1,155 UNHCR ODP records
covering 2010 → present. `funding` is a new green-license category backed by
the UN OCHA Financial Tracking Service: every donor → recipient humanitarian
flow into Palestine ($18.7 B across 2013 → present).

---

## Alerts service

`services/westbank-alerts/` is the real product. It runs as
`params-alerts-api` on port `8080`.

### Pipeline
```
Telegram channels   →  classifier  →  enricher (zone + coords)  →  dedupe
    (10 channels)        9 alert             location KB                fingerprint
                         types               + checkpoint KB            + content sim
                                                                          ↓
                                    confidence / reliability scoring
                                                                          ↓
                                     SQLite   →  fanout
                                                 (WebSocket / SSE / webhooks)
```

### Alert types
Tier 1 (airspace / strikes): `west_bank_siren`, `gaza_strike`, `regional_attack`.
Tier 2 (operational): `idf_raid`, `settler_attack`, `road_closure`,
`flying_checkpoint`, `injury_report`, `demolition`, `arrest_campaign`.

### Confidence & reliability
Every alert carries:
- `source_reliability` (0.0–1.0) — baseline trust for the publishing channel,
  seeded from historical precision (`Almustashaar` 1.0, `WAFA` 0.9, `QudsN`
  0.8, `Shihab` 0.7, `PalinfoAr` 0.7, `ajanews` 0.6, `AlMayadeenNews` 0.5).
  See `GET /channel-reliability`.
- `confidence` (0.0–1.0) — per-alert score blending source reliability,
  classified severity, locality clarity, and tier guards. Consumers filter
  with `?min_confidence=0.8`.

### Corrections
`PATCH /alerts/{id}` with `status=retracted|corrected&correction_note=...`
flips an alert and pushes a `{event: "correction", ...}` event to every live
subscriber. Clients update their caches in place without re-fetching.

### Checkpoint telemetry
- `GET /checkpoints/{key}/history?from=&to=` — status transitions in a window.
- `GET /checkpoints/uptime?from=&to=` — % open / closed / restricted per
  checkpoint over a window. Computes spans by clamping each status interval
  to the window boundaries.

### Bulk export
`GET /alerts/export?since=&until=&format=ndjson|csv` streams the full window
in 500-row batches. CSV includes all scoring columns. Authenticated.

### Webhook subscriber filters
Beyond `alert_types` and `min_severity`, webhooks now accept:
- `areas` — comma-separated city/camp names; case-insensitive substring match.
- `zones` — north / middle / south (WB) or gaza_north / gaza_city /
  middle_gaza / khan_younis / rafah.
- `confidence_min` — minimum per-alert confidence.

---

## Unified API (Node / Express 5)

Base: `http://<host>:7860/api/v1`

### Core

| Endpoint | Notes |
|:--|:--|
| `GET /unified/:category` | Paginated data with filters (location, region, event_type, date range). |
| `GET /unified/:category/summary` | Aggregated metrics totals. |
| `GET /unified/:category/timeseries?metric=&interval=&region=` | Time-series buckets. |
| `GET /unified/:category/metadata` | Schema + provenance. |
| `GET /search?q=` | Full-text search (per-category indexes). |
| `GET /categories` | Live category list + record counts. |
| `GET /stats` | Cross-category aggregates. |
| `GET /version` | Build SHA + pipeline generated-at. |
| `GET /quality` | Per-category freshness + coverage snapshot. |
| `GET /licenses` | License registry for all sources. |
| `GET /record/:category/:id` | Single record (stable IDs in progress). |

### Freshness gate

Every unified response (`getData`, `getMetadata`, `getSummary`, `getTimeseries`)
is wrapped by `src/api/utils/freshnessGate.js`. When the category's newest
record is > 90 days old, or the source is explicitly frozen, the response gets:

- `Warning: 299 - "Stale data: latest record YYYY-MM-DD (N days old)"` header
- `metadata.stale: true`, `metadata.frozen_at`, `metadata.active`,
  `metadata.freshness_days_since_latest`, `metadata.latest_record_at`

The gate reads from `public/data/unified/quality.json`, a pre-computed
snapshot generated by `scripts/generate-quality-snapshot.js` (one category at
a time to stay under the container memory limit).

### Live alerts proxy

`GET /live/*` endpoints transparently proxy to the alerts service so a single
consumer-facing origin serves both.

### Health

`GET /health` — basic. `GET /health-deep` — pipeline freshness + alerts
connectivity.

---

## Trust foundation

- **Licenses** (`src/api/data/licenses.json`, `GET /licenses`) — every source
  tagged with `commercial_use` boolean, `attribution_text`, SPDX-style ID.
  Enforced at pipeline time via `scripts/check-license-coverage.js` in CI.
- **Quality snapshot** (`GET /quality`) — pre-computed so a request does not
  have to parse the 110 MB of unified data.
- **Version** (`GET /version`) — build SHA + pipeline generated-at.
- **Citable records** (wip) — stable `sha256(category + source_id +
  source_record_key)` IDs and retained daily snapshots under
  `public/data/unified/snapshots/YYYY-MM-DD/`, query with `?as_of=`.

---

## Deployment

Two Docker containers under a single compose group:

| Container | Port | Role |
|:--|:--|:--|
| `palestine-data-api` | 7860 | Express API + static data |
| `params-alerts-api`  | 8080 | FastAPI + Telethon alerts service |

```bash
# Local
docker compose up -d --build

# Production server (admin@192.168.0.118)
rsync -avz --exclude node_modules --exclude .git \
  ./ admin@192.168.0.118:/home/admin/palestine-data-backend/
ssh admin@192.168.0.118 'cd /home/admin/palestine-data-backend && docker compose up -d --build'
```

### Environment

`~/palestine-data-backend/.env`
```
PORT=7860
ALERTS_API_URL=http://alerts:8080
SENTRY_DSN=                 # optional
```

`services/westbank-alerts/.env`
```
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
TELEGRAM_PHONE=...
TELEGRAM_CHANNELS=Almustashaar,WAFAgency,QudsN,ajanews,PalinfoAr,shihabagency,AlMayadeenNews,MOHMediaGaza
CHECKPOINT_CHANNELS=ahwalaltreq,abd_jbreel
DB_PATH=/data/alerts.db
API_SECRET_KEY=...          # for /admin, /webhooks, PATCH /alerts/{id}
```

---

## Development

```bash
# Node API
npm install
npm run fetch:all           # pull raw data (HDX, WHO, T4P, World Bank, …)
npm run transform           # unify into canonical schema v3
node scripts/generate-quality-snapshot.js
npm start

# Alerts service
cd services/westbank-alerts
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8080
```

The ETL runs 21 isolated tasks with per-category fault isolation — one
failing source does not block the others. A report lands at
`public/data/pipeline-report.json`.

---

## Status

- ✅ Data triage — stubs pruned, martyrs frozen
- ✅ Freshness gate — headers + metadata across unified API
- ✅ Alerts SaaS hardening — confidence, corrections, geo webhooks, export, uptime
- 🚧 Stable record IDs + snapshot pinning
- 🚧 UNHCR / UN FTS / Wikidata / IDMC fetchers (replace thin stubs)
- ⏸ Commercial surface (Stripe pricing, billing) — scaffolded, deferred until
  the data and alert layers are production-grade

---

## License

Source code: open. Dataset licenses vary per source and are declared via
`GET /licenses`. Non-commercial sources (WHO, some news) are returned only
on the free tier once the commercial surface is activated.
