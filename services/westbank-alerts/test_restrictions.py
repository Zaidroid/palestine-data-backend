"""Phase 2 — static restriction layer geometry parsing (app/routing/restrictions.py).

The OCHA closures are POINT obstacles (closed road gates, roadblocks, earthmounds),
not just the 2022 linear segments — so _feature_segments must turn a prohibited Point
into a single-vertex segment that avoid_polygons boxes like a closed road node.

Run:  pytest test_restrictions.py -v
"""
from app.routing.restrictions import _feature_segments, avoid_polygons


def _feat(geom_type, coords, cls="prohibited"):
    return {"type": "Feature", "properties": {"class": cls},
            "geometry": {"type": geom_type, "coordinates": coords}}


def test_point_obstacle_becomes_single_vertex_segment():
    segs = _feature_segments([_feat("Point", [35.25, 32.10])])
    assert segs == [[[35.25, 32.10]]]


def test_point_obstacle_inside_bbox_emits_one_box():
    segs = _feature_segments([_feat("Point", [35.25, 32.10])])
    polys = avoid_polygons((32.0, 35.20), (32.2, 35.30), segments=segs)
    assert len(polys) == 1
    assert len(polys[0]) == 5            # closed ring (4 corners + repeat)


def test_point_outside_bbox_emits_no_box():
    segs = [[[36.5, 33.5]]]              # far from the route bbox
    assert avoid_polygons((32.0, 35.20), (32.2, 35.30), segments=segs) == []


def test_non_prohibited_point_ignored():
    assert _feature_segments([_feat("Point", [35.25, 32.10], cls="open")]) == []


def test_multipoint_each_point_is_its_own_segment():
    segs = _feature_segments([_feat("MultiPoint", [[35.25, 32.10], [35.26, 32.11]])])
    assert segs == [[[35.25, 32.10]], [[35.26, 32.11]]]


def test_linestring_and_multilinestring_still_supported():
    line = _feature_segments([_feat("LineString", [[35.25, 32.10], [35.26, 32.11]])])
    assert line == [[[35.25, 32.10], [35.26, 32.11]]]
    multi = _feature_segments([_feat("MultiLineString", [[[35.0, 32.0], [35.1, 32.1]]])])
    assert multi == [[[35.0, 32.0], [35.1, 32.1]]]
