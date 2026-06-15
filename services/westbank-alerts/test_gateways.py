"""Phase F — city-gateway engine (app/serving/gateways.py).

The domain model Palestinians actually navigate by: each city has entry/exit
gateways; resolve each to its live status and produce an advisory — which gateways
are open, which are closed, and the detour for the closed ones.

Run:  pytest test_gateways.py -v
"""
from app.serving import gateways as G


class _KB:
    """name_ar -> canonical_key, only for catalogued gateways."""
    def __init__(self, mapping):
        self._m = mapping

    def find_checkpoint(self, name_ar):
        return self._m.get(name_ar)


NABLUS = {
    "name_ar": "نابلس", "name_en": "Nablus",
    "gateways": [
        {"name_ar": "دير شرف", "name_en": "Deir Sharaf", "side": "west", "connects_to": "Tulkarem", "role": "primary", "detour_if_closed": "Sarra", "confidence": "high"},
        {"name_ar": "صرة", "name_en": "Sarra", "side": "west", "role": "alternate", "detour_if_closed": "Deir Sharaf", "confidence": "high"},
        {"name_ar": "حوارة", "name_en": "Huwara", "side": "south", "connects_to": "Ramallah", "role": "closed", "detour_if_closed": "Awarta", "confidence": "high"},
        {"name_ar": "عورتا", "name_en": "Awarta", "side": "south", "connects_to": "Ramallah", "role": "primary", "detour_if_closed": "Beit Furik", "confidence": "high"},
    ],
}

KB = _KB({"دير شرف": "دير_شرف", "حوارة": "حواره", "عورتا": "عورتا"})  # صرة not catalogued


def test_open_gateway_state():
    status = {"دير_شرف": "open", "حواره": "closed", "عورتا": "open"}
    out = G.build_city_gateway_status(NABLUS, status, kb=KB)
    by = {g["name_en"]: g for g in out["gateways"]}
    assert by["Deir Sharaf"]["state"] == "open"
    assert by["Deir Sharaf"]["canonical_key"] == "دير_شرف"
    assert by["Awarta"]["state"] == "open"


def test_permanently_closed_gateway_uses_detour():
    status = {"دير_شرف": "open", "حواره": "open", "عورتا": "open"}  # even if a live "open" leaks for Huwara
    out = G.build_city_gateway_status(NABLUS, status, kb=KB)
    huwara = next(g for g in out["gateways"] if g["name_en"] == "Huwara")
    assert huwara["state"] == "closed"           # role=closed wins
    assert huwara["detour_if_closed"] == "Awarta"
    assert any("Huwara" in c["name_en"] for c in out["closed_gateways"])


def test_uncatalogued_gateway_is_unknown_and_flagged():
    status = {"دير_شرف": "open", "حواره": "closed", "عورتا": "open"}
    out = G.build_city_gateway_status(NABLUS, status, kb=KB)
    sarra = next(g for g in out["gateways"] if g["name_en"] == "Sarra")
    assert sarra["in_catalog"] is False
    assert sarra["state"] == "unknown"


def test_live_closed_gateway_marked_closed():
    status = {"دير_شرف": "closed", "حواره": "closed", "عورتا": "open"}
    out = G.build_city_gateway_status(NABLUS, status, kb=KB)
    ds = next(g for g in out["gateways"] if g["name_en"] == "Deir Sharaf")
    assert ds["state"] == "closed"


def test_advisory_lists_open_and_closed_with_detours():
    status = {"دير_شرف": "open", "حواره": "closed", "عورتا": "open"}
    out = G.build_city_gateway_status(NABLUS, status, kb=KB)
    assert "Deir Sharaf" in out["open_gateways"] and "Awarta" in out["open_gateways"]
    assert out["advisory"]  # non-empty human-readable string
    assert "Huwara" in out["advisory"] and "Awarta" in out["advisory"]  # closed + its detour named
