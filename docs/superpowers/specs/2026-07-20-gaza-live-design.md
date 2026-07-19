# Gaza live coverage — design spec

**Status: DESIGN — awaiting Zaid approval before build.** Companion to the Tier 1
audit spec (`2026-07-19-tier1-trustworthiness-audit-design.md`, Phase 6 seed) and
[[project_pdb_revenue_readiness]]. Reuses the West Bank trust framework wholesale;
this document is about what changes for Gaza, not a rebuild.

## 1. Goal & honest scope

Today the platform has **partial** Gaza coverage: the classifier already knows
Gaza geography (5 governorates + sub-zones), has Gaza-heavy channels, and emits
`gaza_strike` alerts; the Node side serves `/gaza/daily` + `/gaza/summary`
casualty bulletins (MoH). What's **missing** to call Gaza "live" like the West
Bank is:

1. A **Gaza facility catalog** — the analog of the 245-checkpoint catalog — so
   events attach to known, provenance-marked places (hospitals, shelters,
   crossings, bakeries, water points, humanitarian/evacuation zones).
2. **Gaza-specific event types** beyond strikes + casualty totals: evacuation
   orders, crossing status, humanitarian-zone status, aid-convoy movement,
   displacement waves.
3. A **measure-first accuracy pass** for the Gaza feed (precision/recall/FP
   audit), published like the WB tier.

Scope discipline: this is **incremental hardening on the existing pipeline**, not
a new service. Same repo, same `services/westbank-alerts/`, same auth, same
consensus/freshness/provenance machinery.

## 2. Non-negotiable ethical guardrails (Gaza-specific)

Gaza is an active mass-casualty catastrophe. These are hard constraints, not
preferences:

1. **Casualty figures come only from authoritative sources** (Gaza MoH, PRCS,
   OCHA, UNRWA). Never inferred, never estimated by the classifier. A casualty
   number without one of these sources is not served.
2. **Evacuation orders must cite the issuing party** (IDF Arabic spokesperson,
   OCHA relay) and be timestamped — an unattributed "evacuate X" is context, not
   an order. Serving a false evacuation order could kill people.
3. **No real-time targetable precision.** We catalog *known* facilities from
   already-public authoritative datasets (OCHA, WHO). We do **not** publish live,
   precise locations of shelters/people that could aid targeting. Facility
   coordinates are the published institutional ones, never crowd-triangulated.
4. **Freshness honesty is a safety feature**, not a nicety: a stale "crossing
   open" or "zone safe" is dangerous. Same `effective_status`/`is_stale` honesty
   as WB, with *shorter* staleness windows for Gaza volatility.
5. Source-trust policy (`DATA_SOURCES.md`) applies identically. No paid-only Gaza
   data; public tier carries the full safety feed.

## 3. Architecture — what's reused vs new

**Reused unchanged:** Telegram ingestion, the whitelist→classify→consensus→
freshness→provenance pipeline, `ApiKeyMiddleware`+rate limiting, webhook delivery,
the `/quality/accuracy` measurement harness.

**New/extended:**

| Component | WB analog | Gaza change |
|---|---|---|
| `data/gaza_facilities.json` | `known_checkpoints.json` | Catalog of Gaza facilities, provenance + precision marked |
| `app/gaza_facility_parser.py` | `checkpoint_whitelist_parser.py` | Whitelist-first: emit facility events only for catalogued facilities |
| Classifier event types | `idf_raid` etc. | `+evacuation_order, crossing_status, facility_strike, humanitarian_zone_status, aid_convoy, displacement_wave` |
| `GAZA_*_CHANNELS` config | `CHECKPOINT_CHANNELS` | Vetted Gaza channels, per-channel trust calibrated |
| `/v2/gaza/*` endpoints | `/v2/checkpoints` | facilities / crossings / evacuation-zones feeds |
| Consensus tuning | 30-min half-life, 6h window | Shorter windows (Gaza volatility); zone-directional evac logic |

## 4. The Gaza facility catalog

Seeded **only from authoritative, already-public datasets** (guardrail 3):

- **Hospitals / health:** WHO Gaza health-facility list, OCHA health cluster.
- **Shelters:** UNRWA designated shelters (schools), OCHA shelter list.
- **Crossings:** the named, fixed set (Rafah, Kerem Shalom/Karm Abu Salem, Erez/
  Beit Hanoun, Zikim, etc.) — small, stable, high-value.
- **Water/bakeries/aid points:** OCHA/CCG datasets where public.
- **Humanitarian / evacuation zones:** the declared zone geometries (e.g.
  al-Mawasi) from OCHA — as polygons, not points.

Each entry carries: canonical key, name_ar/en, governorate, sub-zone, type,
coordinates + `precision` (`facility` = authoritative point, `zone` = polygon,
`gazetteer` = governorate-level fallback), `source`, `source_url`. Same honest
precision marking as the checkpoint catalog (26 precise / 219 gazetteer today).

## 5. Event types & classifier paths

Additive to `classifier.py` (which already has Gaza geography + `gaza_strike`):

- **`evacuation_order`** — IDF Arabic evac notices / OCHA relays naming a block
  or zone. Extract: zone(s), direction, issuing source, timestamp. Hard-gated on
  an attributable source (guardrail 2).
- **`crossing_status`** — open/closed/limited for the named crossings; whitelist
  parser like checkpoints.
- **`facility_strike`** — strike on a catalogued hospital/shelter; joins to the
  facility catalog; casualty numbers only if authoritatively sourced.
- **`humanitarian_zone_status`** — declared-zone safety advisories (strikes in a
  "safe" zone are high-signal).
- **`aid_convoy` / `displacement_wave`** — movement signals; lower severity,
  context feed.
- **`casualty_bulletin`** (existing) — kept, sourced to MoH/PRCS.

## 6. API surface

Mirror the `/v2/checkpoints` shape for consistency:

- `GET /v2/gaza/facilities` — catalog + live status, freshness/provenance-first.
- `GET /v2/gaza/crossings` — the named-crossing status board.
- `GET /v2/gaza/evacuation-zones` — active evacuation orders by zone, each with
  issuing source + timestamp + `is_stale`.
- `GET /gaza/daily`, `/gaza/summary` (existing Node) — casualties, unchanged.
- Default `/alerts` feed already carries `gaza_strike`; new types flow in with a
  `scope=gaza` filter option (extends the existing F5 scope machinery).

## 7. Measure-first validation (before it's "live")

Same as Tier 1, non-negotiable before selling Gaza coverage:

1. Snapshot the Gaza message corpus; replay the extended classifier offline.
2. Precision by event type (hand-labelled by an Arabic reader), volume-weighted.
3. Recall on a discarded-message sample.
4. FP audit gate (the WB tier held 96/96).
5. Publish results in `ACCURACY.md` + `/quality/accuracy` with a Gaza section.
6. Gate: do not advertise Gaza parity until precision ≥ the WB bar (~85%).

## 8. Decomposition (build order, each independently testable)

1. Facility catalog builder (fetch authoritative sources → `gaza_facilities.json`
   + precision marking) + seed table. *Test: catalog loads, precision counts.*
2. `gaza_facility_parser.py` whitelist parser. *Test: emits only catalogued facilities.*
3. `evacuation_order` + `crossing_status` classifier paths. *Test: fixtures, FP audit.*
4. `facility_strike` + `humanitarian_zone_status` paths. *Test: fixtures.*
5. `/v2/gaza/*` endpoints. *Test: feed shape, freshness honesty.*
6. Consensus/freshness tuning for Gaza volatility. *Test: staleness fixtures.*
7. Measure-first accuracy pass + publish.

## 9. Open questions — need Zaid before build

- **Channel list:** which Gaza Telegram channels to whitelist (need his Telegram
  account to read them; per-channel trust calibration). Biggest unknown.
- **OCHA/WHO/UNRWA source access:** confirm the facility/shelter/zone datasets are
  fetchable + their licenses (some may be non-commercial → label per guardrail).
- **Evacuation-order source-of-truth:** which relay(s) to trust for IDF Arabic
  evac notices, given the safety stakes.
- **Scope confirmation:** is casualty-bulletin + facility-status + evacuation the
  right v1, deferring aid-convoy/displacement to v2? (Recommended: yes — smaller,
  safer first cut.)

## 10. Why this sequencing

Building Gaza live requires (a) Zaid's Telegram channel access, (b) authoritative
source vetting, (c) deploys, and (d) a live-data validation window — none of which
can be completed autonomously. This spec is therefore the correct deliverable now:
approve/adjust it, then the build round proceeds task-by-task from §8 with the
same test-first discipline as the Tier 1 audit.
