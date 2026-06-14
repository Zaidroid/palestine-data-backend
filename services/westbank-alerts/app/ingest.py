"""OSM / OCHA obstacle ingest (Phase E / E2).

Brings authoritative static obstacle data in as a base geographic layer WITHOUT
duplicating the Telegram-tracked curated catalog. The dedup is the careful part:
an imported obstacle that is the same place as an existing checkpoint (already-seen
external_ref, name resolves in the KB, or within `max_km`) is matched/skipped; only
genuinely new obstacles become seed entries tagged with their source_layer.

`parse_overpass` + `dedupe_obstacles` are pure and unit-tested; the network fetch
lives in scripts/ingest_osm_overpass.py.
"""
from __future__ import annotations

from typing import Optional

import logging

import httpx

from . import checkpoint_db as cpdb
from .checkpoint_db import _haversine_km

log = logging.getLogger("ingest")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# West Bank bbox: South, West, North, East
WB_BBOX = (31.3, 34.8, 32.6, 35.6)


def parse_overpass(elements: list) -> list:
    """Overpass JSON elements → obstacle dicts. Unnamed elements are dropped (a name
    is required to be useful as a checkpoint)."""
    obs = []
    for el in elements or []:
        tags = el.get("tags") or {}
        name_ar = tags.get("name:ar")
        name_en = tags.get("name:en") or tags.get("name")
        name = name_ar or name_en
        if not name:
            continue
        if el.get("type") == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        obstacle_type = tags.get("barrier") or tags.get("military") or "checkpoint"
        obs.append({
            "name_ar": name_ar or name_en,
            "name_en": name_en,
            "lat": lat, "lon": lon,
            "external_ref": f"osm:{el.get('type')}/{el.get('id')}",
            "obstacle_type": obstacle_type,
        })
    return obs


def dedupe_obstacles(obstacles: list, existing: list, kb, *, max_km: float = 0.3,
                     source_layer: str = "osm") -> dict:
    """Decide which obstacles are new. Returns {to_seed, matched, skipped}.

    to_seed entries are ready for checkpoint_db.bulk_seed_checkpoints (canonical_key,
    name_ar, latitude, longitude, source_layer, obstacle_type, external_ref)."""
    seen_refs = {e.get("external_ref") for e in existing if e.get("external_ref")}
    to_seed, matched, skipped = [], 0, 0

    for ob in obstacles:
        ref = ob.get("external_ref")
        if ref and ref in seen_refs:
            skipped += 1
            continue
        name = ob.get("name_ar") or ob.get("name_en")
        # 1) name resolves to a curated checkpoint
        if name and kb is not None and kb.find_checkpoint(name):
            matched += 1
            continue
        # 2) within max_km of an existing checkpoint → same place
        lat, lon = ob.get("lat"), ob.get("lon")
        near = False
        if lat is not None and lon is not None:
            for e in existing:
                elat, elon = e.get("latitude"), e.get("longitude")
                if elat is None or elon is None:
                    continue
                if _haversine_km(lat, lon, elat, elon) <= max_km:
                    near = True
                    break
        if near:
            matched += 1
            continue
        # 3) genuinely new
        key = (name or ref).replace(" ", "_")
        to_seed.append({
            "canonical_key": key,
            "name_ar": ob.get("name_ar") or name,
            "name_en": ob.get("name_en"),
            "latitude": lat, "longitude": lon,
            "source_layer": source_layer,
            "obstacle_type": ob.get("obstacle_type"),
            "external_ref": ref,
        })
        seen_refs.add(ref)

    return {"to_seed": to_seed, "matched": matched, "skipped": skipped}


async def fetch_osm_obstacles(bbox=WB_BBOX, *, timeout: float = 60.0) -> list:
    s, w, n, e = bbox
    box = f"({s},{w},{n},{e})"
    query = (
        "[out:json][timeout:60];("
        f'node["barrier"="checkpoint"]{box};way["barrier"="checkpoint"]{box};'
        f'node["military"="checkpoint"]{box};way["military"="checkpoint"]{box};'
        ");out center;"
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(OVERPASS_URL, data={"data": query})
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
    return parse_overpass(elements)


async def run_osm_ingest() -> dict:
    """Fetch OSM obstacles, dedupe against the live catalog, seed the genuinely-new
    ones as a static 'osm' layer. Idempotent via external_ref."""
    from .db_pool import get_checkpoint_db
    from .checkpoint_knowledge_base import get_knowledge_base

    obstacles = await fetch_osm_obstacles()
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT canonical_key, latitude, longitude, external_ref FROM checkpoints")
        existing = [{"canonical_key": r[0], "latitude": r[1], "longitude": r[2],
                     "external_ref": r[3]} for r in await cur.fetchall()]
    result = dedupe_obstacles(obstacles, existing, get_knowledge_base(),
                              max_km=0.3, source_layer="osm")
    if result["to_seed"]:
        await cpdb.bulk_seed_checkpoints(result["to_seed"])
    summary = {"fetched": len(obstacles), "seeded": len(result["to_seed"]),
               "matched": result["matched"], "skipped": result["skipped"]}
    log.info("[INGEST/OSM] %s", summary)
    return summary
