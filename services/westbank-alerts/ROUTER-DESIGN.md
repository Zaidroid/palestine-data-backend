# West Bank Checkpoint-Aware Router — Buildable Design

**Status:** Engine chosen (Valhalla) and scaffolded. `/v2/route` already serves Phase-1 routing + a coarse avoid-closed reroute today. This doc is the path from that baseline to full checkpoint-aware, plate-aware, live-dynamic routing — written against the actual files in the repo, not a greenfield.

**Repos**
- Backend: `services/westbank-alerts/`
- Frontend: `palestine-databank-web/src/westbank/route/`
- Live deploy: `.114` → `/opt/stacks/palestine/` (svc `alerts`:8081 → `live.zaidlab.xyz`); deploy = `bash /opt/stacks/palestine/deploy.sh`

---

## 1. Architecture

### Engine: Valhalla (confirmed, already wired)
The decisive property is **query-time dynamic costing**: penalties, `exclude_locations`, `exclude_polygons`, and live-speed tiles are applied per-request against a *static* graph — so a checkpoint flip is a different request JSON or a one-edge tile write, never a graph rebuild. OSRM bakes weights into a contraction hierarchy (rebuild + reload per change — wrong shape). GraphHopper can do per-request custom models but only with CH disabled (slower, heavier JVM). Valhalla also natively gives turn-by-turn narrative + a matrix endpoint (`/sources_to_targets`) + Arabic locale. Matches what's committed in `valhalla_client.py` and `docker-compose.valhalla.yml`. Keep GraphHopper as documented fallback only.

### Homelab placement
- **main — Ubuntu `192.168.1.114` (15 GB, RTX 3060):** serves the Valhalla container + the `alerts` FastAPI + checkpoint DB. WB extract is tiny (~115 MB PBF, derived tile cache <1 GB; `mem_limit: 3g` set). Co-locating keeps the proxy→engine hop on the Docker net (`http://valhalla:8002`), which the live-tile/per-request cost model leans on. Always-on prod box.
- **mainpc desktop (i5-12400F / 32 GB / WSL2):** offline tile builder — build derived PBF + tiles, `rsync valhalla_tiles/` to `.114` so prod never stops serving during rebuilds. Optional (a `.114` build is only minutes).
- **Surface (8 GB, 82% full):** do **not** host routing.

### Data flow
```
Geofabrik israel-and-palestine.pbf
   │  (osmium extract → WB poly)
   ▼
restrictions.geojson ──┐  (B'Tselem 3-tier + OCHA obstacles + your edits)
                       │  conflation: snap → motor_vehicle=* + restriction_id
   ▼  derived_wb.pbf ◄─┘
   │  Valhalla tile build (mainpc, then rsync) → valhalla_tiles/
   ▼
[ wb-valhalla :8002 ] ◄── live traffic tile ◄── live-tile writer ◄── checkpoint_status DB
   ▲  (static graph)        (mmap per-edge speed/closed)     (Telegram parser + crowd)
   │  /route  /sources_to_targets
[ alerts FastAPI /v2/route ] ── inject exclude_locations (flying) + read checkpoint envelopes
   │  routes[] + checkpoints_on_route[] + advisory + gateways
   ▼
[ frontend engine.ts → RoutePlanner / FollowMe ]
```

---

## 2. Data Pipeline

### 2.1 Base extract
- Source: `https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf` (~115 MB, daily) — already pinned in `scripts/fetch_osm_extract.sh`.
- **Clip to West Bank** (`osmium extract -p wb.poly …`) to shrink build time and avoid routing through Israel proper. `osmium` (apt `osmium-tool`); `osm2pgsql` not needed (Valhalla's Mjolnir tiler reads the PBF directly).

### 2.2 Restriction overlay (the editorial layer — your IP)
OSM **cannot** express plate/nationality prohibition (no convention; `:conditional` only covers time/weight/height/permit). So the restriction logic lives in a **versioned local file**, never upstream OSM:

`data/restrictions.geojson` — line features (road segments) + point features (obstacles):
```json
{ "restriction_id": "btselem-route60-zatara-tapuah",
  "class": "prohibited|partial|restricted|open",
  "source": "btselem|ocha|local",
  "confidence": 0.0-1.0,
  "last_verified": "2026-06-15" }
```
Seeded from: **B'Tselem "Forbidden Roads"** 3-tier (authoritative classification, PDF/web-map only → hand-digitize); **OCHA oPt** obstacle inventory on HDX (checkpoints/gates/earthmounds — *but the downloadable closures GDB is stale, ~2022; current ~793–925 obstacle counts are PDF-only → manual reconcile*); **Area A/B/C polygons** (OCHA/Peace Now) as a spatial overlay (there's already an `oslo_area` column on checkpoints).

### 2.3 Conflation → derived PBF
New build step `scripts/build_derived_pbf.py` (run on mainpc, before tiling):
1. Snap each `restrictions.geojson` feature to OSM way(s) within **≤15 m + bearing match** (avoid grabbing a parallel service road).
2. Write the access tag the router honors (green-plate default profile):

   | class | tag written | router effect |
   |---|---|---|
   | prohibited (settler/sterile) | `motor_vehicle=no` (+`note=israeli_only`) | edge dropped |
   | partial / permit-only | `motor_vehicle=permit` | soft-excluded (heavy penalty) |
   | local-only bypass | `motor_vehicle=destination` | only if origin/dest on it |
   | obstacle node | `barrier=gate`/`barrier=block` | gate penalty / impassable |

   Time-windowed gates → `motor_vehicle:conditional=…`. Stamp each touched way with `restriction_id=<id>`.
3. Output `derived_wb.pbf`. **Never edit upstream OSM** — keeps the political layer decoupled, auditable, and surviving daily OSM refresh.

Two profiles from one graph: **green-plate** (default) + **permit/yellow-plate** (relaxes permit edges) — Valhalla costing configs, not two graphs.

### 2.4 Refresh cadence
Base OSM weekly (re-fetch + re-clip → rebuild). OSM obstacle seeds (Overpass `military=checkpoint`, `barrier=*`) weekly. OCHA/B'Tselem/Peace Now monthly–annual manual reconcile (their GIS lags). `restrictions.geojson` continuous/curated → triggers tile rebuild. Live checkpoint status continuous (already live via Telegram parser + crowd → `checkpoint_status`).

### 2.5 Where Doroob plugs in later
Doroob/Azmeh are the only near-real-time obstacle sources (800+, minute-level), proprietary/crowdsourced. When obtained they feed **two** places (not the static graph): the **live layer** (flying-checkpoint/gate events → live-tile writes / `exclude_locations`) and **seed corroboration** for `restrictions.geojson` + the checkpoint catalog. Slots behind the *same* `checkpoint_status` ingestion the Telegram parser uses, with its own `source_trust`.

---

## 3. Checkpoint-Aware Cost Model

Two layers: a **static base graph** (rebuilt only when OSM or `restrictions.geojson` changes) + a **live overlay** mutated on every flip with **zero reprocessing**.

### 3.1 Checkpoint → edge mapping (precompute once)
Build `checkpoint_edges`: per checkpoint (lat/lon + optional `gated_road_ref`), snap to geometry, take edges within **R=30 m**, disambiguate by road class (prefer `gated_road_ref`, else highest-class edge), store the **directed edge pair + immediate up/downstream edges** as Valhalla `graph_id`s. `cp_id → [graph_id…]`. Live updates then O(1) — no re-snap at request time.

### 3.2 Live flip → no rebuild (the whole point)
- **A — Live traffic tile (preferred):** a `live-tile writer` daemon (fed by `checkpoint_status`) writes per-edge into Valhalla's mmap live tile — open→clear, congested→`effective_speed`, closed→CLOSED (`closure_factor ×9 ≈ excluded`). Requests pass `speed_types:["current","predicted","constrained","freeflow"]`. One tile write → every next `/route` reroutes. No restart/rebuild.
- **B — Per-request `exclude_locations`** for flying/unmodeled points (point-snap hard avoid; faster than `exclude_polygons`); low-confidence → temp penalty speed with TTL.

Use **A for ~925 known obstacles**, **B for ephemeral points.** *(Today's code uses `exclude_polygons` boxes — the coarse Phase-1 mechanism; Phase 3 migrates known closures → A, flying → B.)*

### 3.3 Congestion → speed (not a flat penalty)
```
delay_s          = BASE_WAIT[status] × confidence × time_of_day_mult
effective_speed  = edge_len / (edge_len/base_speed + delay_s)
```
open 0 · flying 600s (soft+CAUTION) · congested-light 300s · congested-heavy 1800s · closed ∞ (CLOSED ×9).

### 3.4 Confidence, freshness decay, advisory ladder (the edge over Doroob/Azmeh)
Maps onto envelope fields already in `provenance.py` (`live.confidence`, `freshness.age_hours`, `source_trust.trust`):
```
c = 0.4·A + 0.25·R + 0.35·F
  A=(confirms−denials)/(confirms+denials+1)   R=source_trust.trust   F=exp(−age_hours/τ)
```
τ half-lives: closed 6h · congested 25m · flying 15m · open-after-closed 45m. Below `c_min=0.2` → revert to base (60s decay sweeper).

**Hard vs soft (core rule):** `closed & c≥0.6 → HARD`; `closed & c<0.6 → SOFT (CAUTION, could be stale)`; `flying → SOFT (never hard-exclude a rumor)`; `congested → speed override`. Only **prohibited settler roads (static)** + **high-confidence closures (live)** are ever hard-excluded.

**Advisory:** `edge_risk = clamp(severity[status]×c,0,1)` → OK <0.25 · CAUTION 0.25–0.6 · AVOID ≥0.6; route = max. Replaces `_advisory()` (route.py L41-48) with a confidence-weighted version emitting the **same three strings** (UI untouched).

---

## 4. Integration — behind the existing `/v2/route`

The contract is already implemented in `app/routers/route.py`. Everything below is **additive inside `build_route_plan()`** — request/response shapes don't change; RoutePlanner/FollowMe stay unmodified.

**Must NOT change (and won't):** request `{from:{lat,lon}, to:{lat,lon}, avoid_closed:bool}`; response root `routes[]`, `advisory`, `rerouted`, `destination_gateways`, `origin_gateways`; per-route `geometry` (GeoJSON LineString), `distance_km`, `duration_min`, `checkpoints_on_route[]` (`{checkpoint:<15-key envelope>, distance_m, along_km, closed}`), `closed_count`; the 15-key envelope (`_cp_envelope` in v2.py / `provenance.py`); gateway shape (`gateways.py`).

**Changes internally (contract-invisible):** inject `speed_types`+`date_time`+`exclude_locations` in `valhalla_client.route()`; migrate known-closed from `exclude_polygons` → live-tile CLOSED + flying → `exclude_locations`; confidence-weighted `_advisory()`; optional `profile` request field (green-plate default — additive, only if UI exposes plate choice).

**New endpoints (contract-safe):** `/v2/route/steps` (or `?steps=true`) for Valhalla Arabic turn-by-turn (FollowMe); `/v2/matrix` via Valhalla `/sources_to_targets` (nearest-open-gateway ranking).

---

## 5. Phased Build Plan

**Phase 1 — Baseline OSM routing behind `/v2/route`** *(largely DONE in repo)*
Valhalla tiles from the clipped extract; `valhalla` service up on `.114`; `/v2/route` returns routes + `checkpoints_on_route` + gateways.
**Verify:** `curl /v2/route` Nablus→Ramallah returns sane `distance_km`/`duration_min`, `checkpoints_on_route` includes Huwara; frontend `planRouteBackend()` renders without OSRM fallback.

**Phase 2 — Settler/restricted-road avoidance**
Author `restrictions.geojson` (B'Tselem 3-tier, Route 60 corridor first); `scripts/build_derived_pbf.py` conflation → `derived_wb.pbf`; rebuild tiles; ship green-plate + permit profiles.
**Verify:** a route the raw-OSM graph sent down a prohibited bypass now avoids it; permit profile allowed down a `restricted` segment the green-plate penalizes. Snapshot test on 5 known segregated segments.

**Phase 3 — Live-checkpoint dynamic penalties**
Precompute `cp_id → [graph_id…]`; stand up the `live-tile writer` + confidence/decay engine + 60s sweeper; inject `speed_types`/`exclude_locations`; swap `_advisory()` to confidence-weighted.
**Verify:** flip a test checkpoint to `closed` → within one writer tick a fresh `/v2/route` reroutes around it **with no rebuild and no restart**; flip back → route returns; FollowMe re-evaluates on the SSE `checkpoint_update`.

**Phase 4 — Doroob fold-in + turn-by-turn / advisory polish**
Ingest Doroob/Azmeh as a `checkpoint_status` source with its own `source_trust`; add `/v2/route/steps` (Arabic) + `/v2/matrix`; predicted-traffic tiles from feed history (nightly) for depart-at planning.
**Verify:** a Doroob-reported flying checkpoint shows as CAUTION within minutes with correct decay; Arabic turn-by-turn renders; depart-at 07:15 costs a rush-hour checkpoint higher than off-peak.

---

## 6. Risks / Honest Gaps

**Data completeness (biggest risk):** OSM has no plate/nationality tag — the whole restriction layer is hand-curated `restrictions.geojson` (quality = editorial effort, not the engine). OCHA's downloadable closures GIS is years stale; B'Tselem/Kerem Navot are authoritative but PDF-only → manual. The regime is dynamic (flying checkpoints ~70/week, deliberately random) — **never claim to predict flying closures.** Checkpoint→edge snapping mis-assigns at complex interchanges (mitigated by `gated_road_ref`).

**Engine limits:** Valhalla `exclude_polygons` has open correctness/perf issues (#4659, #4387) — mitigated by preferring `exclude_locations` + live-tile CLOSED; polygons are a backstop only. Live-tile writes are global/mmap — needs the decay-sweeper TTL + a kill switch. Two profiles from one graph rely on costing config — verify the permit relaxation flips the right edges.

**Homelab capacity:** `.114` is the single serving point (also runs the GPU voice stack) — routing is light, but not HA; frontend already falls back to public OSRM (graceful degradation: loses checkpoint-awareness, keeps a route). Tile rebuilds spike RAM → build on mainpc + rsync for Phase 2+. No CI on the conflation pass yet — a bad `restrictions.geojson` edit could orphan a village (mitigated by the soft-not-hard rule for `restricted`/`partial`).

**Net:** engine + integration are low-risk and mostly built. The real, persistent work is the **data-curation layer** — exactly where Doroob's feed, once obtained, becomes the differentiator no open dataset provides.

**Key files this design touches:** `app/routers/route.py`, `app/routing/valhalla_client.py`, `app/routing/on_route.py`, `app/serving/provenance.py`, `app/config.py`, `valhalla/docker-compose.valhalla.yml`, new `scripts/build_derived_pbf.py` + `data/restrictions.geojson` + a `live-tile writer` daemon.
