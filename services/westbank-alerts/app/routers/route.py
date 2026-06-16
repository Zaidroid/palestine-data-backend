"""Phase D — routing endpoint (/v2/route).

Self-hosted Valhalla route(s) + checkpoint-on-route detection against the FULL
catalog + dynamic avoid-closed rerouting. Dark-launched behind ROUTING_ENABLED so
the engine + tiles can be deployed before the frontend is switched over.

`build_route_plan` is the pure-ish orchestrator (route function injectable) so the
reroute logic is unit-tested without Valhalla or the DB.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import checkpoint_db as cpdb
from ..config import settings
from ..routing import kb_service
from ..routing import on_route as OR
from ..routing import restrictions as RES
from ..routing import valhalla_client
from ..serving import gateways as GW
from .v2 import _cp_envelope

router = APIRouter(prefix="/v2", tags=["route"])


def _route_obj(r: dict, onr: list, *, avoids_closed: bool = False) -> dict:
    closed = [o for o in onr if o["closed"]]
    obj = {
        "geometry": {"type": "LineString", "coordinates": r["coords"]},
        "distance_km": r["distance_km"],
        "duration_min": r["duration_min"],
        "checkpoints_on_route": onr,
        "closed_count": len(closed),
    }
    if avoids_closed:
        obj["avoids_closed"] = True
    return obj


def _advisory(route_obj: dict) -> str:
    onr = route_obj["checkpoints_on_route"]
    if any(o["closed"] for o in onr):
        return "AVOID"
    if any((o["checkpoint"].get("effective_status") in ("congested", "idf", "inspection"))
           for o in onr):
        return "CAUTION"
    return "OK"


async def build_route_plan(from_latlon, to_latlon, *, avoid_closed: bool, envelopes: list,
                           route_fn, corridor_m: float, box_m: float,
                           restriction_polys: Optional[list] = None) -> dict:
    rp = restriction_polys or []
    base = await route_fn([from_latlon, to_latlon], exclude_polygons=(rp or None), alternates=2)
    if not base and rp:                       # fail-open: a (possibly stale) closed road orphaned the route
        base = await route_fn([from_latlon, to_latlon], alternates=2)
    if not base:
        return {"routes": [], "advisory": "UNKNOWN", "rerouted": False}

    routes_out = [_route_obj(r, OR.checkpoints_on_route(r["coords"], envelopes, corridor_m))
                  for r in base]

    rerouted = False
    primary_onr = routes_out[0]["checkpoints_on_route"]
    closed = OR.closed_checkpoints(primary_onr)
    if avoid_closed and closed:
        polys = rp + OR.exclude_polygons(closed, box_m=box_m)
        alt = await route_fn([from_latlon, to_latlon], exclude_polygons=polys, alternates=0)
        if alt:
            ar = alt[0]
            aonr = OR.checkpoints_on_route(ar["coords"], envelopes, corridor_m)
            if not any(o["closed"] for o in aonr):     # only adopt if it truly avoids them
                routes_out.insert(0, _route_obj(ar, aonr, avoids_closed=True))
                rerouted = True

    return {"routes": routes_out, "advisory": _advisory(routes_out[0]), "rerouted": rerouted}


# ── FastAPI endpoint ─────────────────────────────────────────────────────────
class _LatLon(BaseModel):
    lat: float
    lon: float


class RouteRequest(BaseModel):
    from_: _LatLon = Field(..., alias="from")
    to: _LatLon
    avoid_closed: bool = True

    class Config:
        populate_by_name = True


@router.post("/route")
async def v2_route(req: RouteRequest):
    if not settings.ROUTING_ENABLED:
        raise HTTPException(status_code=503, detail="Routing engine not enabled")

    cps = await cpdb.get_all_checkpoints()
    envelopes = [_cp_envelope(c) for c in cps]

    # KB-first: the checkpoint-aware knowledge-base router (correct green-plate
    # entrances, never a forbidden/settlement road). Confidence-gated + additive —
    # returns None for any pair it doesn't cover or on any error, falling back to
    # the Valhalla geometry router below. Kill-switch: WBKB_ROUTE_ENABLED=0.
    plan = None
    if os.environ.get("WBKB_ROUTE_ENABLED", "1") != "0":
        plan = await kb_service.plan((req.from_.lat, req.from_.lon), (req.to.lat, req.to.lon),
                                     envelopes, route_fn=valhalla_client.route)

    if plan is None:
        plan = await build_route_plan(
            (req.from_.lat, req.from_.lon), (req.to.lat, req.to.lon),
            avoid_closed=req.avoid_closed, envelopes=envelopes,
            route_fn=valhalla_client.route,
            corridor_m=settings.ROUTE_CORRIDOR_M, box_m=settings.ROUTE_EXCLUDE_BOX_M,
            restriction_polys=RES.avoid_polygons((req.from_.lat, req.from_.lon), (req.to.lat, req.to.lon)),
        )
        # Collapse near-duplicate catalog variants of one gate (Huwara / gate / bypass …).
        for r in plan["routes"]:
            r["checkpoints_on_route"] = OR.dedup_on_route(r["checkpoints_on_route"])
            r["closed_count"] = len([o for o in r["checkpoints_on_route"] if o["closed"]])
    # Attach the authoritative gateway advisories for the origin (how to LEAVE) and
    # destination (how to ENTER) cities — independent of route geometry/coords.
    dest_city = GW.nearest_city(req.to.lat, req.to.lon)
    origin_city = GW.nearest_city(req.from_.lat, req.from_.lon)
    if dest_city:
        plan["destination_gateways"] = await GW.get_city_gateways(dest_city)
    if origin_city and origin_city != dest_city:
        plan["origin_gateways"] = await GW.get_city_gateways(origin_city)
    return plan
