"""Phase E / E2 — OSM/OCHA obstacle ingest dedup (app/ingest.py).

The merge must be idempotent and non-duplicating: an imported obstacle that is the
same place as a curated checkpoint (by external_ref already seen, by name, or by
proximity) is matched/skipped, not added again; only genuinely new obstacles become
seed entries (tagged with their source_layer).

Run:  pytest test_ingest.py -v
"""
from app.ingest import parse_overpass, dedupe_obstacles


class _KB:
    def __init__(self, known):
        self._known = set(known)

    def find_checkpoint(self, name):
        return name if name in self._known else None


def test_parse_overpass_node_and_way():
    elements = [
        {"type": "node", "id": 111, "lat": 32.16, "lon": 35.25,
         "tags": {"barrier": "checkpoint", "name:ar": "حوارة", "name": "Huwara"}},
        {"type": "way", "id": 222, "center": {"lat": 32.0, "lon": 35.05},
         "tags": {"military": "checkpoint", "name": "Atara"}},
        {"type": "node", "id": 333, "lat": 31.9, "lon": 35.2, "tags": {}},  # no name → dropped
    ]
    obs = parse_overpass(elements)
    assert len(obs) == 2
    assert obs[0]["external_ref"] == "osm:node/111"
    assert obs[0]["name_ar"] == "حوارة"
    assert obs[1]["external_ref"] == "osm:way/222"
    assert obs[1]["lat"] == 32.0


EXISTING = [
    {"canonical_key": "حواره", "latitude": 32.1587, "longitude": 35.2538, "external_ref": None},
    {"canonical_key": "عطاره", "latitude": 32.015, "longitude": 35.187,
     "external_ref": "osm:way/222"},
]


def test_dedupe_matches_by_proximity():
    # an OSM Huwara ~250m from the curated one → matched, not seeded
    obs = [{"name_ar": "حوارة الجديدة", "name_en": "Huwara new", "lat": 32.1565,
            "lon": 35.2538, "external_ref": "osm:node/999", "obstacle_type": "checkpoint"}]
    out = dedupe_obstacles(obs, EXISTING, _KB([]), max_km=0.3)
    assert out["to_seed"] == []
    assert out["matched"] == 1


def test_dedupe_skips_already_imported_external_ref():
    obs = [{"name_ar": "عطارة", "lat": 32.015, "lon": 35.187,
            "external_ref": "osm:way/222", "obstacle_type": "checkpoint"}]
    out = dedupe_obstacles(obs, EXISTING, _KB([]), max_km=0.3)
    assert out["to_seed"] == []
    assert out["skipped"] == 1


def test_dedupe_matches_by_name_via_kb():
    obs = [{"name_ar": "حواره", "lat": 30.0, "lon": 34.0,   # far, but name resolves
            "external_ref": "osm:node/888", "obstacle_type": "checkpoint"}]
    out = dedupe_obstacles(obs, EXISTING, _KB(["حواره"]), max_km=0.3)
    assert out["to_seed"] == []
    assert out["matched"] == 1


def test_dedupe_seeds_genuinely_new_obstacle_with_source_layer():
    obs = [{"name_ar": "بوابة جديدة", "name_en": "New Gate", "lat": 32.40, "lon": 35.30,
            "external_ref": "osm:node/777", "obstacle_type": "road_gate"}]
    out = dedupe_obstacles(obs, EXISTING, _KB([]), max_km=0.3, source_layer="osm")
    assert out["matched"] == 0 and out["skipped"] == 0
    assert len(out["to_seed"]) == 1
    seed = out["to_seed"][0]
    assert seed["source_layer"] == "osm"
    assert seed["external_ref"] == "osm:node/777"
    assert seed["obstacle_type"] == "road_gate"
    assert seed["latitude"] == 32.40
