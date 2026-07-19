# Product Packages — Palestine Data Platform

> **Customer-facing catalog.** The single sheet to hand a prospect. Prices and
> policy live in [`MONETIZATION.md`](./MONETIZATION.md); how-to in
> [`QUICKSTART-databank.md`](./QUICKSTART-databank.md) +
> [`QUICKSTART-alerts.md`](./QUICKSTART-alerts.md); measured accuracy in
> [`ACCURACY.md`](./ACCURACY.md). Sample payloads below are **real responses
> from the live API**, trimmed for length.

**Positioning:** the only unified, provenance-first API for Palestine data —
verified historical datasets (1948 → present, 22 categories) **plus** real-time
West Bank alerts and ~245 live checkpoints. Built and operated from Ramallah.
Every paid tier only ever *adds* (freshness, granularity, delivery, support); it
never subtracts from the free public tier.

---

## The tiers at a glance

| Tier | Price | Who it's for | Monthly quota | Real-time alerts | Commercial license |
|---|---|---|---|---|---|
| **Public** | Free, no signup | Everyone — individuals, activists, Palestinians | fair-use (per-IP) | public feed | attribution only |
| **Researcher** | Free, registered | Academics, journalists | 100k req/mo | public feed | non-commercial |
| **Journalist** | $29/mo | Solo reporters, freelance desks | 50k req/mo | public feed | editorial use |
| **Organization** | $99/mo intro → $149 list | Newsrooms, research institutes, NGО HQs | 500k req/mo | public feed | ✅ included |
| **Organization + Alerts** | $199/mo | Risk-intel, security desks, ops teams | 500k req/mo | ✅ **webhook / digest delivery** | ✅ included |
| **Enterprise** | from $500/quarter | Platforms, large orgs, resellers | unlimited | ✅ + custom extracts | ✅ + named support |

Billing is quarterly by USD wire (SWIFT) against invoice — standard institutional
procurement. Card and crypto invoicing available on request. **Field NGOs and
humanitarian orgs are never charged** — write in for researcher-tier access.
First three organizations lock founding pricing for 12 months.

---

## What every tier includes (the free public floor)

- **Two live products, one auth scheme** (`Authorization: Bearer pdb_live_…`):
  the historical databank (`api.zaidlab.xyz`) and the live alerts + checkpoints
  service (`wb-alerts.zaidlab.xyz`).
- **Provenance on every record** — source, upstream id, timestamp, trust score.
- **Published accuracy** — `/quality/accuracy` and [`ACCURACY.md`](./ACCURACY.md):
  we publish the ugly numbers next to the good ones. That is the product.
- **Freshness metadata** on everything; stale data is labelled, never disguised.
- **Per-source licensing** at `/api/v1/licenses` — know exactly what you may
  redistribute.

Paid tiers raise quotas, unlock real-time **delivery** (not access — access is
free), add the commercial-use license, and add support and SLA.

---

## Product 1 — Historical databank  ·  `api.zaidlab.xyz/api/v1`

Unified, deduplicated, stably-IDed records across **22 categories**:

`aid_access · casualties · conflict · connectivity · culture · demolitions ·
economic · education · food · funding · health · historical · infrastructure ·
land · martyrs_snapshot_2023 · news · pcbs · prisoners · refugees · settlements ·
water · westbank`

Each record carries a stable id (citable + permalinkable), normalized location
(governorate, admin levels, coordinates, precision), typed metrics, and source
provenance. Filter by `location`, `admin2`, `gazetteer_key`, `event_type`, and
date range; full-text search across categories; time-series buckets; event
clusters ("what happened in Jenin that week"); pinned daily snapshots for
reproducible citation.

```jsonc
// GET /api/v1/unified/education?limit=1  — a real record (trimmed)
{
  "id": "wb-school-ekcswr",
  "date": "2026-07-19",
  "category": "education",
  "event_type": "school_record",
  "schema_version": "3.0.0",
  "location": { "name": "jenin sec. girls", "region": "West Bank",
                "lat": 32.4597, "lon": 35.2956, "precision": "exact",
                "admin_levels": { "level1": "Jenin" }, "region_type": "urban" },
  "metrics": { "killed": 0, "injured": 0, "displaced": 0 }
  // + source provenance
}
```

Provenance and freshness for every upstream at `/api/v1/sources`:

```jsonc
// GET /api/v1/sources  — one source (trimmed)
{ "id": "acled_pse", "name": "ACLED — Palestine Conflict Events (HRP aggregated)",
  "organization": "Armed Conflict Location & Event Data Project (ACLED)",
  "license_id": "Other", "commercial_use": true,
  "attribution_text": "ACLED — Armed Conflict Location & Event Data Project, via HDX." }
```

---

## Product 2 — Live West Bank alerts + checkpoints  ·  `wb-alerts.zaidlab.xyz`

Palestinian Telegram news channels are monitored every ~5s, classified into
structured alerts (raids, settler attacks, demolitions, road closures, sirens,
Gaza strikes…), and joined to a crowd-sourced status feed for **~245 catalogued
West Bank checkpoints**. Delivery: REST poll, SSE stream, or (paid) webhook /
digest.

```jsonc
// GET /alerts/latest?limit=1  — a real alert (trimmed)
{
  "id": 9344, "type": "idf_raid", "severity": "medium",
  "title": "IDF Raid — Ramallah", "area": "Ramallah", "zone": "middle",
  "event_subtype": "raid",
  "latitude": 31.9038, "longitude": 35.2034, "geo_precision": "town",
  "source": "qudsn", "source_type": "telegram", "source_msg_id": 722375,
  "timestamp": "2026-07-19T22:21:52+00:00"
}
```

```jsonc
// GET /checkpoints/summary  — the headline feature (real)
{ "by_status": { "open": 152, "congested": 9, "closed": 29, "idf": 15,
                 "inspection": 2, "police": 4 },
  "by_status_fresh_6h": { "open": 63, "congested": 4, "closed": 13 },
  "fresh_last_6h": 83, "stale": 128,
  "total_active": 211, "total_directory": 245, "is_data_stale": false }
```

Every checkpoint record is provenance- and freshness-first — a status is never
served without the age and trust that qualify it:

```jsonc
// GET /v2/checkpoints  — one checkpoint (real, trimmed)
{ "canonical_key": "عناب", "name_en": "Anab / Enav",
  "governorate": "Tulkarm", "oslo_area": "C", "checkpoint_type": "checkpoint",
  "coordinates": { "lat": 32.279, "lon": 35.143, "precision": "checkpoint" },
  "live": { "status": "open", "status_raw": "فاتح", "confidence": "medium",
            "crowd_reports_1h": 7 },
  "freshness": { "age_hours": 1.2, "is_stale": false, "freshness_band": "recent",
                 "freshness_score": 0.871 },
  "source_trust": { "last_source_type": "crowd", "trust": 0.75 },
  "provenance": { "last_msg_id": 3312311, "source_channel": "a7walstreet" },
  "effective_status": "open" }
```

**Real-time delivery (Organization + Alerts, $199):** we register your webhook
endpoint (raw JSON, or Slack/Discord-formatted) or a private digest topic,
filtered to the alert types, severities, and areas you care about. HMAC-signed,
retry-with-backoff delivery. Correction/retraction events are pushed too, so a
cached alert can be updated in place.

---

## Trust & provenance — why this is defensible

We measure accuracy against a production snapshot and publish it. Current
headline (West Bank live tier, measured 2026-07-19): **~85% volume-weighted
precision on the default feed, ~88% recall**, with the ground-event core
(raids / strikes / flying checkpoints) near 100%. The `/quality/accuracy`
endpoint serves the full per-type breakdown live:

```jsonc
// GET /quality/accuracy  (real, trimmed)
{ "audit": { "measured_at": "2026-07-19",
    "method": "read-only prod snapshot + offline replay of deployed==repo classifier",
    "m1_precision": { "volume_weighted_precision_30d": 0.654,
      "per_type_precision": { "flying_checkpoint": { "precision": 1.00 },
                              "demolition": { "precision": 0.57 } } } } }
```

Full method: [`METHODOLOGY.md`](./METHODOLOGY.md). Honest scorecard, including
what we are still fixing: [`ACCURACY.md`](./ACCURACY.md).

---

## Rate limits (enforced)

Limits protect the service; they are not a paywall on the public data. The
**public safety feed stays generous** — each visitor gets their own budget, so
a live map polling continuously never trips it.

| Tier | Databank (`api.zaidlab.xyz`) | Alerts (`wb-alerts.zaidlab.xyz`) |
|---|---|---|
| Anonymous | 10 req/min · 1,000/day | 120 req/min |
| Researcher (free) | 30 req/min · 100k/mo | 300 req/min |
| Journalist | 60 req/min · 50k/mo | 600 req/min |
| Organization | 300 req/min · 500k/mo | 1,200 req/min |
| Enterprise | 1,500 req/min · unlimited | unlimited |

Responses carry `X-RateLimit-*` headers; a 429 includes `Retry-After`. Check
your own usage any time at `GET /api/v1/me/usage`.

---

## SLA

- **Public / Researcher / Journalist:** best-effort, no guarantee. Status at
  `api.zaidlab.xyz/status.html`.
- **Organization:** email support, best-effort same-business-day.
- **Organization + Alerts:** the above + best-effort alert-delivery SLA
  (missed-delivery replay on request).
- **Enterprise:** named support contact, custom terms.

Single-operator service, operated from Ramallah — SLAs are honest best-effort,
not enterprise 99.9% contracts. We say what we can actually keep.

---

## How to get access

1. **Request access** at `api.zaidlab.xyz/pricing.html` (or email
   `zaidsalem@live.com`) — name, org, tier, use case.
2. You get an answer and a **trial key within two working days**.
3. Invoice (quarterly, USD wire) — see [`invoice-template.md`](./invoice-template.md).
4. Key issuance is immediate on acceptance; keys carry your tier and quota.

---

## License

Per-source licensing at `/api/v1/licenses`. Individuals, activists, journalists,
researchers, and NGOs use the free tier freely (attribution only). Companies
incorporating the data into commercial products or services need an Organization
or Enterprise license (ACLED-style commercial clause). Some upstreams are
non-commercial (WHO, B'Tselem, certain news) and are labelled per-record so paid
redistribution stays clean.
