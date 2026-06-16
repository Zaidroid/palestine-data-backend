# Valhalla routing — deploy & enable (Phase D)

The `/v2/route` endpoint is **dark-launched**: it returns `503` until you both
stand up Valhalla and flip `ROUTING_ENABLED=true`. Until then the app and the
existing frontend OSRM path are unaffected.

## 1. Stand up Valhalla on the server (192.168.1.114)

```bash
cd /opt/stacks/palestine
mkdir -p valhalla_tiles
# Merge valhalla/docker-compose.valhalla.yml into the stack compose (or `-f` it):
docker compose -f docker-compose.yml -f services/westbank-alerts/valhalla/docker-compose.valhalla.yml up -d valhalla
# First boot downloads the Palestine PBF (~116 MB) and BUILDS TILES (a few minutes,
# ~1–3 GB RAM). Watch:
docker logs -f wb-valhalla        # wait for "running tile service"
curl -s localhost:8002/status     # {"version":...} when ready
```

`scripts/fetch_osm_extract.sh` can pre-download the PBF into `valhalla_tiles/` if you
prefer not to let the container fetch it.

## 2. Exclusion limits (avoid-closed reroute + restriction layer)

This gis-ops image (the one running on .114) honors `exclude_polygons` **natively — no
flag needed**. ⚠️ Do NOT add `service_limits.allow_hard_exclusions`: this build's config
parser does not recognise it and the engine **crash-loops on startup**
(`No such node (service_limits.allow_hard_exclusions.max_locations)`). Verified
2026-06-16 — a one-box `exclude_polygons` request detours the route ~17 km as expected.
(The instruction to set that flag was for a newer Valhalla; it is wrong for this image.)

The real tunable is **`service_limits.max_exclude_polygons_length`** — the max *summed
circumference in METRES* of all exclude polygons (NOT vertex count; engine returns
`error 167` when exceeded). Each 60 m restriction box ≈ 240 m perimeter, so the default
`10000` caps ~41 boxes and dense WB routes (70–150 boxes) would silently fail-open with
no restrictions applied. Raised to **`50000`** on .114 (covers the app's `max_polys=150`
cap → 150 × 240 = 36000 m, with headroom). To change: edit `valhalla_tiles/valhalla.json`,
then `docker restart wb-valhalla`. (The gis-ops image regenerates the config only when
missing, so the edit persists.)

## 3. Point the alerts service at it & enable routing

In `/opt/stacks/palestine` `.env` (or the alerts service environment):

```
ROUTING_ENABLED=true
VALHALLA_URL=http://valhalla:8002
ROUTE_CORRIDOR_M=300
ROUTE_EXCLUDE_BOX_M=200
```

Redeploy alerts: `bash /opt/stacks/palestine/deploy.sh`.

## 4. Verify

```bash
# engine itself (Ramallah → Nablus, lon,lat order for Valhalla locations is lat/lon in our client):
curl -s -X POST localhost:8081/v2/route \
  -H 'Content-Type: application/json' \
  -d '{"from":{"lat":31.90,"lon":35.20},"to":{"lat":32.22,"lon":35.26},"avoid_closed":true}' | jq '.advisory, .rerouted, [.routes[0].checkpoints_on_route[].checkpoint.canonical_key]'
```

Expect the corridor checkpoints (عطاره, زعتره, حواره, …) listed, `advisory:"AVOID"`
when a closed gate is on the line, and `rerouted:true` with a route that no longer
includes حواره (Huwara, permanently closed).

## 5. Frontend cutover (separate, after the above verifies)

`src/westbank/route/engine.ts` still uses the public OSRM demo. Switch `osrmRoutes`
to call `POST /v2/route` and consume `routes[].checkpoints_on_route`, keeping the OSRM
path as a fallback when `/v2/route` returns non-200. Deploy via
`npm run build && netlify deploy --prod --dir=dist`. (Deferred from the backend work
so the engine is verified live first.)

## Rollback

`ROUTING_ENABLED=false` (endpoint 503s; frontend keeps OSRM) and/or
`docker compose stop valhalla`. Nothing else depends on Valhalla.
