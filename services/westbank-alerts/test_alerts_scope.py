"""F5 — regional events are a separate tagged feed. The default /alerts feed
excludes regional (regional_attack + northern_israel_siren); ?scope=regional
returns only those; ?scope=all returns everything. No schema change — scope is
derived from alert type.

Run:  pytest test_alerts_scope.py -v
"""
import asyncio
from datetime import datetime

from app import db_pool, database
from app.main import list_alerts, REGIONAL_ALERT_TYPES, scope_to_exclude_types


# --- pure helper ---
def test_scope_helper_default_excludes_regional():
    assert set(scope_to_exclude_types(None)) == set(REGIONAL_ALERT_TYPES)
    assert set(scope_to_exclude_types("wb_gaza")) == set(REGIONAL_ALERT_TYPES)

def test_scope_helper_regional_and_all():
    assert scope_to_exclude_types("all") == []
    # regional scope is handled by include, not exclude → no exclusions here
    assert scope_to_exclude_types("regional") == []


async def _seed():
    now = datetime.utcnow().isoformat()
    async with db_pool.get_alerts_db() as db:
        rows = [
            (1, "west_bank_siren", "wb siren"),
            (2, "regional_attack", "lebanon strike"),
            (3, "northern_israel_siren", "galilee siren"),
            (4, "gaza_strike", "gaza airstrike"),
            (5, "idf_raid", "jenin raid"),
        ]
        for aid, typ, title in rows:
            await db.execute(
                "INSERT INTO alerts (id,type,severity,title,body,source,raw_text,timestamp,"
                "created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (aid, typ, "high", title, "b", "qudsn", "x", now, now, "active"))
        await db.commit()


def _types(resp):
    return sorted(a.type.value if hasattr(a.type, "value") else a.type for a in resp.alerts)


def test_default_feed_excludes_regional(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await database.init_db()
            await _seed()
            kw = dict(type=None, severity=None, area=None, since=None, until=None,
                      min_confidence=None, status=None, page=1, per_page=50)
            default = await list_alerts(scope=None, **kw)        # default → wb_gaza
            regional = await list_alerts(scope="regional", **kw)
            everything = await list_alerts(scope="all", **kw)
            return _types(default), _types(regional), _types(everything)
        finally:
            await db_pool.close_pool()
    default, regional, everything = asyncio.run(go())
    assert "regional_attack" not in default and "northern_israel_siren" not in default
    assert set(default) == {"west_bank_siren", "gaza_strike", "idf_raid"}
    assert set(regional) == {"regional_attack", "northern_israel_siren"}
    assert len(everything) == 5
