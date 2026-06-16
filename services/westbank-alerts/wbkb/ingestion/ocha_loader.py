"""OCHA HDX obstacle dataset -> KB nodes (existence + coordinates).

Authoritative for which checkpoints/gates EXIST and where. Tolerant of the HDX
schema variations: pulls a name + obstacle type from properties and a point from
geometry, then upserts an ``exists`` fact at ``ocha_hdx`` authority (never
downgrades a human_local confirmation). Run monthly.

    python -m ingestion.ocha_loader data/ocha_obstacles.geojson
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone

from engine import db as DB
from engine.kb_io import append_fact

_TYPE_FIELDS = ["closure_type", "Closure_Type", "Type", "type", "OBSTACLE", "obstacle_type", "ObstacleType", "Category"]
_NAME_FIELDS = ["name", "Name", "NAME_EN", "name_en", "Location", "Checkpoint"]
_ID_FIELDS = ["restriction_id", "id", "OBJECTID", "Q"]


def _verified_stamp(props: dict, default: str) -> str:
    """OCHA carries last_verified like '2025-12'; expand to an ISO timestamp."""
    lv = str(props.get("last_verified") or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}", lv):
        return f"{lv}-01T00:00:00+00:00"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", lv):
        return f"{lv}T00:00:00+00:00"
    return default


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")
    return s or "obstacle"


def _first(props: dict, fields: list[str]) -> str | None:
    for f in fields:
        if props.get(f):
            return str(props[f])
    return None


def _point(geom: dict) -> tuple[float, float] | None:
    if not geom:
        return None
    if geom.get("type") == "Point":
        lng, lat = geom["coordinates"][:2]
        return lat, lng
    if geom.get("type") in ("MultiPoint", "LineString") and geom.get("coordinates"):
        lng, lat = geom["coordinates"][0][:2]
        return lat, lng
    return None


def load(path: str, now: datetime | None = None, conn=None) -> dict:
    now = now or datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    fc = json.loads(open(path, encoding="utf-8").read())
    own = conn is None
    conn = conn or DB.connect()
    try:
        existing = {r["id"] for r in conn.execute("SELECT id FROM nodes")}
        added = 0
        for feat in fc.get("features", []):
            props = feat.get("properties") or {}
            pt = _point(feat.get("geometry") or {})
            if not pt:
                continue
            name = _first(props, _NAME_FIELDS) or "OCHA obstacle"
            otype = _first(props, _TYPE_FIELDS) or "obstacle"
            ident = _first(props, _ID_FIELDS) or name
            nid = "cp_ocha_" + _slug(ident)
            lv = _verified_stamp(props, stamp)
            conn.execute(
                "INSERT OR REPLACE INTO nodes(id,type,subtype,name_en,name_ar,governorate,lat,lng,coord_source,status_class,feed_key,notes) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (nid, "obstacle", _slug(otype), name, props.get("name_ar") or name,
                 str(props.get("Governorate") or props.get("governorate") or ""), pt[0], pt[1], "ocha_hdx", None, None, f"OCHA {otype}"),
            )
            if nid not in existing:
                added += 1
                existing.add(nid)
            append_fact(conn, "node", nid, "exists", True, "ocha_hdx", "node_exists_permanent", lv, f"OCHA HDX survey: {otype}")
        conn.commit()
        return {"features": len(fc.get("features", [])), "nodes_added": added}
    finally:
        if own:
            conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python -m ingestion.ocha_loader data/ocha_obstacles.geojson")
        raise SystemExit(2)
    print(json.dumps(load(sys.argv[1]), ensure_ascii=False, indent=2))
