# West Bank Routing Knowledge Base (wbkb)

A self-maintaining knowledge base + routing engine for realistic Palestinian
(green-plate) travel across the West Bank, with entrances, checkpoints, and gates.

This is **not** a geometric router. A generic shortest-path engine (OSRM/Valhalla)
has no concept of *which entrance is real for a green plate*, so it routes into
Nablus via Huwwara (closed, bypassed) instead of the real entrances. This system
encodes corridors, entrances, gating checkpoints, permissions, and **provenance**,
and converges on ground truth instead of guessing once.

## The core idea: confidence with provenance

Every fact (a checkpoint exists, a road is traversable, a road is forbidden to
green plates, a checkpoint gates an edge) carries a **source**, a
**last_verified** timestamp, and a **fact_kind** that selects a **half life**, so
confidence **decays over time**:

    effective = base(source) × 0.5 ** (age_days / half_life_days)

Dynamic facts (which checkpoint controls an edge — 30-day half life) decay fast;
physical roads + policy (700-day half life) decay slowly. When confidence drops
below `STALE_THRESHOLD` (0.40) the fact appears on the **staleness worklist** to
be re-confirmed. Conflicts resolve by **authority rank**:

    human_local > live_feed > ocha_hdx > rights_doc > osm > model_inferred

So one local confirmation instantly overrides a model seed or even OCHA.

## Safety invariant

The router can **never** return a route that traverses a road forbidden to green
plates or a settlement road (`engine/validate.assert_safe`, tested in
`tests/test_pipeline.py::test_05`). If the only path is low-confidence the route
is returned but flagged "verify before travel"; if no permissible path exists it
returns verdict **`hold`** — never an improvised forbidden road.

## What is verified today vs not

Only the **Ramallah↔Nablus corridor and its REAL entrances** are `human_local`:
the Nablus entrance is **Al-Murabba'a / Awarta / Sarra / Deir Sharaf — NOT
Huwwara** (Huwwara is a node but has *no entrance edge into Nablus*, so the
router structurally cannot repeat the bug). A few well-known checkpoints carry
`ocha_hdx`. **Everything else is `model_inferred` at 0.30 and is on the worklist.**
The seed is a scaffold, not an answer — accuracy comes from the ingestion loop.

## How it stays up to date

1. **Live feed** (`ingestion/telegram_adapter.py`): your channels → `{feed_key: status}`,
   Arabic + English (`حاجز المربعة مسكر` → `{murabbaa: closed}`). Authoritative for
   OPEN/CLOSED right now; expires after ~1.5 days → reverts to cautious `partial`.
2. **OCHA obstacles** (`ingestion/ocha_loader.py`): HDX survey → existence + coords.
   Monthly.
3. **OpenStreetMap** (`ingestion/osm_extract.py`): real barrier nodes + geometry,
   snapped to KB nodes. Weekly.
4. **Human confirmation** (`ingestion/confirm_cli.py`): you or a trusted local walk
   the worklist and confirm/correct. Apex authority — this is what drives accuracy.

## Database & reliability

The backbone is **SQLite** (`data/wbkb.db`, WAL) — the same engine the rest of
westbank-alerts already runs (checkpoints.db / alerts.db), so it inherits the
nightly backup on `.114`. Tables:

- `nodes`, `edges` — structure (refreshed from the source graph on build).
- `facts` — **append-only** provenance log. Never updated/deleted; the "current"
  KB is a derived view (highest authority, then most recent / highest effective
  confidence per slot). This gives an audit trail, time travel, and the
  confirmation-override semantics for free.
- `live_status` — bounded, last-status-wins per `feed_key`; the feed worker
  writes it, the router reads it (TTL'd so stale signals revert to cautious).

Why not Postgres or a graph DB? At this scale (hundreds of facts, a 35-edge
graph, single node, read-heavy) SQLite+WAL is more reliable to operate and the
A* runs in-memory in microseconds. The pure engine (`confidence`/`router`/
`validate`) never touches the DB — `kb_io` is the only seam.

## Run it

```
cd wbkb
python3 build_kb.py             # init data/wbkb.db + seed from the source graph (idempotent)
python3 build_kb.py --reset     # wipe + reseed to clean ground truth
python3 run.py                  # build → ingest demo feed → route Ramallah→Nablus → validate
python3 -m tests.test_pipeline  # 10/10 checks (safety + Huwwara exclusion + append-only + TTL)
python3 -m engine.kb_io         # the staleness worklist — what to verify next
```

Drop real data into `data/`:
- `feed.json` — `[{text, channel?, ts?}, ...]` from your channels
- `ocha_obstacles.geojson` (HDX) → `python3 -m ingestion.ocha_loader data/ocha_obstacles.geojson`
- `overpass_result.json` → `python3 -m ingestion.osm_extract` (prints the query first run, snaps once saved)
- `confirmations.json` — `[{entity, id, slot, value, note}]` → `python3 -m ingestion.confirm_cli data/confirmations.json`

## Layout

```
wbkb/
  build_kb.py                 init + idempotent seed of data/wbkb.db from the source graph
  run.py                      one entrypoint: build → ingest → confirm → route → validate
  kb/
    _source_graph_v1_1.json   the human-authored seed (compact facts) — SOURCE OF TRUTH
    nodes.json / edges.json   generated snapshot of the current DB view (gitignored)
  engine/
    db.py                     SQLite schema + connection (WAL, append-only facts)
    confidence.py             sources, decay, conflict resolution (the trust core)
    kb_io.py                  DB load (resolve current view), append_fact, worklist, live status
    router.py                 confidence-aware A* with the safety invariant
    validate.py               KB integrity + safety-invariant assertion
  ingestion/
    telegram_adapter.py  ocha_loader.py  osm_extract.py  confirm_cli.py  sources.yaml
  tests/test_pipeline.py      10/10, runs on an isolated temp DB
  data/wbkb.db                the live KB (gitignored; back up like the other .114 DBs)
```

## Path to full coverage (no code changes)

1. Load the full OCHA set → every checkpoint/gate appears with coordinates.
2. Run the OSM extract → snap nodes + pull real geometry.
3. Bind `feed_key`s → live status flows in.
4. Work the worklist with local confirmation, governorate by governorate, starting
   with the corridors you travel most. Each confirmation permanently raises that
   part of the KB to ground truth.

## Honesty note

The engine, schema, safety net, and the verified Ramallah↔Nablus seed are real.
The rest of the West Bank is `model_inferred` low-confidence scaffold and **must**
be confirmed via feed / OCHA / OSM / local confirmation before being trusted for
safety routing. Reconcile against your own sources before relying on it.

## Wiring into the live app (next step, not yet done)

`/v2/route` on `.114` currently calls Valhalla. To serve wbkb instead, expose
`engine.router.route()` behind the same endpoint (status_map fed from the live
checkpoint stream by `feed_key`) and return the path + verdict + per-leg flags.
Keep Valhalla as the geometry fallback for pairs the KB doesn't yet cover.
```
