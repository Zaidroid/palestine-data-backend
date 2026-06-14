"""Phase A — /v2 canonical feed integration (app/routers/v2.py).

Drives the real DB → _CHECKPOINT_SELECT → _row_to_checkpoint → provenance →
endpoint path against a temp SQLite pool. Endpoint functions are called directly
with explicit args (overriding the FastAPI Query defaults).

Run:  pytest test_v2_feeds.py -v
"""
import asyncio
from datetime import datetime, timedelta

from app import db_pool, database
from app import checkpoint_db as cpdb
from app import incident_db
from app.routers import v2


def _run(coro):
    return asyncio.run(coro)


_CP_COLS = ("canonical_key,name_ar,name_en,region,checkpoint_type,latitude,longitude,"
            "created_at,source_layer,obstacle_type,permanent_status")
_ST_COLS = ("canonical_key,direction,name_ar,status,status_raw,confidence,"
            "crowd_reports_1h,last_updated,last_source_type,last_msg_id")


async def _seed_checkpoints():
    now = datetime.utcnow()
    async with db_pool.get_checkpoint_db() as db:
        async def cp(vals):
            await db.execute(
                f"INSERT INTO checkpoints ({_CP_COLS}) VALUES ({','.join('?'*11)})", vals)

        async def st(vals):
            await db.execute(
                f"INSERT INTO checkpoint_status ({_ST_COLS}) VALUES ({','.join('?'*10)})", vals)

        # Huwara — permanently closed, yet a FRESH crowd "open" report exists.
        await cp(("حواره", "حوارة", "Huwara", "nablus", "checkpoint", 32.1587, 35.2538,
                  now.isoformat(), "telegram", None, "closed_since:2023-10"))
        await st(("حواره", "", "حوارة", "open", "سالك", "low", 0, now.isoformat(), "crowd", 101))

        # Za'tara — stale (30h old) "closed".
        await cp(("زعتره", "زعترة", "Zaatara", "nablus", "checkpoint", 32.1153, 35.2547,
                  now.isoformat(), "telegram", None, None))
        await st(("زعتره", "", "زعترة", "closed", "مغلق", "high", 0,
                  (now - timedelta(hours=30)).isoformat(), "admin", 55))

        # Atara — never reported (no status row), has coords.
        await cp(("عطاره", "عطارة", "Atara", "ramallah", "checkpoint", 32.015, 35.187,
                  now.isoformat(), "telegram", None, None))

        # Beit Iba — OCHA static base obstacle, NO coords (must drop from geojson).
        await cp(("بيت_ايبا", "بيت إيبا", "Beit Iba", "nablus", "checkpoint", None, None,
                  now.isoformat(), "ocha", "road_gate", None))
        await db.commit()


async def _seed_incident():
    now = datetime.utcnow()
    async with db_pool.get_alerts_db() as db:
        for aid, src, conf, trust in [(1, "qudsn", 0.6, 0.5), (2, "wafa", 0.8, 0.7),
                                      (3, "qudsn", 0.55, 0.4)]:
            await db.execute(
                "INSERT INTO alerts (id,type,severity,title,body,source,raw_text,timestamp,"
                "created_at,status,confidence,trust_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (aid, "idf_raid", "high", "Raid in Jenin", "b", src, "x",
                 now.isoformat(), now.isoformat(), "active", conf, trust))
        await db.execute(
            "INSERT INTO incidents (id,incident_type,area,area_ar,zone,latitude,longitude,"
            "severity,status,alert_count,first_alert_id,last_alert_id,started_at,last_updated,"
            "narrative) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (5, "idf_raid", "Jenin", "جنين", "north", 32.46, 35.30, "high", "active",
             3, 1, 3, now.isoformat(), now.isoformat(), "raid summary"))
        for aid in (1, 2, 3):
            await db.execute("INSERT INTO incident_alerts(incident_id,alert_id) VALUES(?,?)", (5, aid))
        await db.commit()


def test_v2_checkpoints_effective_status(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "alerts.db"), str(tmp_path / "checkpoints.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed_checkpoints()
            return await v2.v2_checkpoints(region=None, status=None)
        finally:
            await db_pool.close_pool()

    res = _run(go())
    by_key = {e["canonical_key"]: e for e in res["checkpoints"]}
    assert res["total"] == 4
    assert by_key["حواره"]["effective_status"] == "closed"      # permanent wins over fresh "open"
    assert by_key["حواره"]["live"]["status"] == "open"           # raw live status preserved
    assert by_key["زعتره"]["effective_status"] == "unknown"      # stale → not painted live
    assert by_key["زعتره"]["freshness"]["freshness_band"] == "stale"
    assert by_key["عطاره"]["effective_status"] == "unknown"      # never reported
    assert by_key["عطاره"]["freshness"]["freshness_band"] == "none"
    assert by_key["بيت_ايبا"]["source_layer"] == "ocha"
    assert by_key["بيت_ايبا"]["obstacle_type"] == "road_gate"


def test_v2_checkpoints_status_filter(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "alerts.db"), str(tmp_path / "checkpoints.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed_checkpoints()
            return await v2.v2_checkpoints(region=None, status="closed")
        finally:
            await db_pool.close_pool()

    res = _run(go())
    keys = {e["canonical_key"] for e in res["checkpoints"]}
    assert keys == {"حواره"}   # only the permanently-closed one is effective_status closed


def test_v2_geojson_drops_coordless_and_orders_lonlat(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "alerts.db"), str(tmp_path / "checkpoints.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed_checkpoints()
            return await v2.v2_checkpoints_geojson(region=None)
        finally:
            await db_pool.close_pool()

    fc = _run(go())
    assert fc["type"] == "FeatureCollection"
    keys = {f["properties"]["canonical_key"] for f in fc["features"]}
    assert "بيت_ايبا" not in keys          # no coords → dropped
    assert "حواره" in keys
    h = next(f for f in fc["features"] if f["properties"]["canonical_key"] == "حواره")
    assert h["geometry"]["coordinates"] == [35.2538, 32.1587]   # [lon, lat]


def test_v2_incidents_envelope(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "alerts.db"), str(tmp_path / "checkpoints.db"))
        try:
            await database.init_db()
            await incident_db.init_incident_tables()
            await _seed_incident()
            listed = await v2.v2_incidents(limit=50)
            detail = await v2.v2_incident_detail(5)
            return listed, detail
        finally:
            await db_pool.close_pool()

    listed, detail = _run(go())
    assert listed["total"] == 1
    inc = listed["incidents"][0]
    assert inc["confidence"] == 0.8                              # max across members
    assert inc["trust_score"] == 0.7
    assert inc["source_trust"]["distinct_sources"] == 2         # qudsn, wafa
    assert inc["corroboration"]["distinct_channel_count"] == 2
    assert set(inc["provenance"]["member_alert_ids"]) == {1, 2, 3}
    assert inc["narrative"] == "raid summary"
    assert detail["id"] == 5
