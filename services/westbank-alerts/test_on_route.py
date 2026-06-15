"""Phase D — checkpoint-on-route detection (app/routing/on_route.py).

Replaces the frontend's fixed 400m perpendicular buffer. Engine-agnostic: takes a
route polyline ([lon,lat]) + the FULL catalog of checkpoint envelopes, returns the
checkpoints within a configurable corridor, ordered along the route, flagging the
closed ones (live closed OR permanent closure like Huwara) so the caller can build
avoid-polygons for a reroute.

Run:  pytest test_on_route.py -v
"""
from app.routing import on_route as R


# A simplified Ramallah→Nablus polyline ([lon, lat]) passing through three real gates.
ROUTE = [
    [35.200, 31.950],
    [35.187, 32.015],   # Atara
    [35.2456, 32.1347],  # Za'tara
    [35.2538, 32.1587],  # Huwara
    [35.260, 32.220],   # Nablus
]


def _cp(key, lat, lon, effective="open", permanent=None):
    return {
        "canonical_key": key,
        "coordinates": {"lat": lat, "lon": lon, "precision": "checkpoint"},
        "effective_status": effective,
        "permanent_status": permanent,
    }


CATALOG = [
    _cp("عطاره", 32.015, 35.187),
    _cp("زعتره", 32.1347, 35.2456),
    _cp("حواره", 32.1587, 35.2538, effective="closed", permanent="closed_since:2023-10"),
    _cp("nearmiss", 32.1587, 35.258),     # ~400m east of the Huwara segment
    _cp("فرش_الهوي", 31.53, 35.10),        # Hebron — far from route
]


def test_on_route_finds_corridor_checkpoints_ordered():
    out = R.checkpoints_on_route(ROUTE, CATALOG, corridor_m=300)
    keys = [o["checkpoint"]["canonical_key"] for o in out]
    assert keys == ["عطاره", "زعتره", "حواره"]          # ordered along route, far one excluded
    assert "nearmiss" not in keys                        # ~400m > 300m corridor
    assert "فرش_الهوي" not in keys


def test_along_km_is_monotonic_and_distance_small():
    out = R.checkpoints_on_route(ROUTE, CATALOG, corridor_m=300)
    alongs = [o["along_km"] for o in out]
    assert alongs == sorted(alongs)
    for o in out:
        assert o["distance_m"] <= 300


def test_closed_flag_set_for_permanent_closure():
    out = R.checkpoints_on_route(ROUTE, CATALOG, corridor_m=300)
    huwara = next(o for o in out if o["checkpoint"]["canonical_key"] == "حواره")
    assert huwara["closed"] is True
    atara = next(o for o in out if o["checkpoint"]["canonical_key"] == "عطاره")
    assert atara["closed"] is False


def test_wider_corridor_catches_near_miss():
    out = R.checkpoints_on_route(ROUTE, CATALOG, corridor_m=600)
    keys = [o["checkpoint"]["canonical_key"] for o in out]
    assert "nearmiss" in keys


def test_checkpoints_without_coords_are_skipped():
    cat = CATALOG + [{"canonical_key": "nocoord",
                      "coordinates": {"lat": None, "lon": None}, "effective_status": "open"}]
    out = R.checkpoints_on_route(ROUTE, cat, corridor_m=300)
    assert all(o["checkpoint"]["canonical_key"] != "nocoord" for o in out)


def test_dedup_collapses_near_duplicates():
    # two near-identical points (~120m apart) + one distinct → collapse the pair
    near = [
        {"checkpoint": {"canonical_key": "حواره", "coordinates": {"lat": 32.1587, "lon": 35.2538}}, "distance_m": 50, "along_km": 40.0, "closed": True},
        {"checkpoint": {"canonical_key": "بوابه_حواره", "coordinates": {"lat": 32.1595, "lon": 35.2545}}, "distance_m": 80, "along_km": 40.1, "closed": False},
        {"checkpoint": {"canonical_key": "عطاره", "coordinates": {"lat": 32.015, "lon": 35.187}}, "distance_m": 30, "along_km": 5.0, "closed": False},
    ]
    out = R.dedup_on_route(near, min_gap_m=200)
    keys = [o["checkpoint"]["canonical_key"] for o in out]
    assert "عطاره" in keys
    assert len(out) == 2  # the two Huwara points collapse to one
    # the collapsed one keeps the closed=True member (more important)
    huwara_grp = [o for o in out if o["checkpoint"]["canonical_key"] in ("حواره", "بوابه_حواره")]
    assert len(huwara_grp) == 1 and huwara_grp[0]["closed"] is True


def test_closed_checkpoints_and_exclude_polygons():
    out = R.checkpoints_on_route(ROUTE, CATALOG, corridor_m=300)
    closed = R.closed_checkpoints(out)
    assert [c["checkpoint"]["canonical_key"] for c in closed] == ["حواره"]
    polys = R.exclude_polygons(closed, box_m=200)
    assert len(polys) == 1
    ring = polys[0]
    # a closed polygon ring (first == last), 5 points, around Huwara
    assert len(ring) == 5 and ring[0] == ring[-1]
    lons = [pt[0] for pt in ring]
    lats = [pt[1] for pt in ring]
    assert min(lons) < 35.2538 < max(lons)
    assert min(lats) < 32.1587 < max(lats)
