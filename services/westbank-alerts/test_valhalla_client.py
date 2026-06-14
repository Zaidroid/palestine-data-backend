"""Phase D — Valhalla routing client (app/routing/valhalla_client.py).

Tests the response parsing + polyline decoding with an injected fake HTTP call
(the real wire call is verified at deploy). The polyline decoder is validated with
the canonical precision-5 reference string.

Run:  pytest test_valhalla_client.py -v
"""
import asyncio

from app.routing import valhalla_client as V


def _run(coro):
    return asyncio.run(coro)


# Canonical Google-polyline example (precision 5):
# decodes to (38.5,-120.2), (40.7,-120.95), (43.252,-126.453)
CLASSIC5 = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


def test_decode_polyline_precision5_reference():
    pts = V.decode_polyline(CLASSIC5, precision=5)   # returns [lon, lat]
    assert len(pts) == 3
    assert abs(pts[0][1] - 38.5) < 1e-4 and abs(pts[0][0] - (-120.2)) < 1e-4
    assert abs(pts[2][1] - 43.252) < 1e-4 and abs(pts[2][0] - (-126.453)) < 1e-4


def test_route_parses_single_trip():
    fixture = {"trip": {"legs": [
        {"shape": CLASSIC5, "summary": {"length": 12.5, "time": 600}}]}}

    async def fake_post(payload):
        return fixture

    routes = _run(V.route([(31.9, 35.2), (32.2, 35.26)], precision=5, post=fake_post))
    assert len(routes) == 1
    r = routes[0]
    assert r["distance_km"] == 12.5
    assert r["duration_min"] == 10.0
    assert len(r["coords"]) == 3
    assert r["coords"][0] == [round(-120.2, 6), round(38.5, 6)]   # [lon, lat]


def test_route_includes_alternates():
    fixture = {
        "trip": {"legs": [{"shape": CLASSIC5, "summary": {"length": 10, "time": 600}}]},
        "alternates": [
            {"trip": {"legs": [{"shape": CLASSIC5, "summary": {"length": 14, "time": 540}}]}}],
    }

    async def fake_post(payload):
        return fixture

    routes = _run(V.route([(31.9, 35.2), (32.2, 35.26)], precision=5, post=fake_post))
    assert len(routes) == 2
    assert routes[1]["distance_km"] == 14


def test_route_passes_exclude_polygons_into_payload():
    captured = {}

    async def fake_post(payload):
        captured.update(payload)
        return {"trip": {"legs": [{"shape": CLASSIC5, "summary": {"length": 1, "time": 60}}]}}

    polys = [[[35.25, 32.15], [35.26, 32.15], [35.26, 32.16], [35.25, 32.16], [35.25, 32.15]]]
    _run(V.route([(31.9, 35.2), (32.2, 35.26)], exclude_polygons=polys, precision=5, post=fake_post))
    assert captured.get("exclude_polygons") == polys
    assert captured["locations"][0] == {"lat": 31.9, "lon": 35.2}


def test_route_returns_empty_on_post_failure():
    async def boom(payload):
        raise RuntimeError("valhalla down")

    routes = _run(V.route([(31.9, 35.2), (32.2, 35.26)], precision=5, post=boom))
    assert routes == []
