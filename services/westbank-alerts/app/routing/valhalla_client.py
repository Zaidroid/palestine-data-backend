"""Valhalla routing client (Phase D).

Talks to a self-hosted Valhalla `/route` endpoint. Valhalla supports
`exclude_polygons` at request time (with service_limits.allow_hard_exclusions=true),
which we use to route AROUND closed checkpoints. Fails safe: any error → [].

Geometry is returned as [lon, lat] lists to match GeoJSON and on_route.py.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from ..config import settings

log = logging.getLogger("valhalla")


def decode_polyline(encoded: str, precision: int = 6) -> list:
    """Decode an encoded polyline into [[lon, lat], ...]. Valhalla uses precision 6."""
    if not encoded:
        return []
    factor = float(10 ** precision)
    coords = []
    index = lat = lon = 0
    length = len(encoded)
    while index < length:
        for is_lon in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append([round(lon / factor, 6), round(lat / factor, 6)])
    return coords


def _parse_routes(data: dict, precision: int) -> list:
    if not data:
        return []
    trips = []
    if data.get("trip"):
        trips.append(data["trip"])
    for alt in data.get("alternates", []) or []:
        if alt.get("trip"):
            trips.append(alt["trip"])

    routes = []
    for trip in trips:
        coords, dist_km, dur_s = [], 0.0, 0.0
        for leg in trip.get("legs", []):
            coords.extend(decode_polyline(leg.get("shape", ""), precision))
            summ = leg.get("summary", {})
            dist_km += summ.get("length", 0) or 0
            dur_s += summ.get("time", 0) or 0
        routes.append({
            "coords": coords,
            "distance_km": round(dist_km, 3),
            "duration_min": round(dur_s / 60.0, 2),
        })
    return routes


async def _post(payload: dict) -> dict:
    url = f"{settings.VALHALLA_URL.rstrip('/')}/route"
    async with httpx.AsyncClient(timeout=settings.MINIMAX_TIMEOUT_S) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()


async def route(locations: list, *, exclude_polygons: Optional[list] = None,
                alternates: int = 1, costing: str = "auto",
                precision: int = 6, post=None) -> list:
    """Compute route(s). `locations` is [(lat, lon), ...]. Returns a list of
    {coords:[[lon,lat]], distance_km, duration_min}; [] on any failure."""
    post = post or _post
    payload = {
        "locations": [{"lat": lat, "lon": lon} for (lat, lon) in locations],
        "costing": costing,
        "alternates": alternates,
        "directions_options": {"units": "kilometers"},
    }
    if exclude_polygons:
        payload["exclude_polygons"] = exclude_polygons
    try:
        data = await post(payload)
    except Exception as e:  # noqa: BLE001 — fail safe
        log.warning("Valhalla route failed (%s)", e)
        return []
    return _parse_routes(data, precision)
