"""End-to-end pipeline checks over the SQLite backbone (stdlib unittest only).

    python3 -m tests.test_pipeline      # or: python3 -m unittest -v tests.test_pipeline

Runs against an isolated temp DB so it never touches data/wbkb.db. The
load-bearing safety checks are 04 (route uses the REAL Nablus entrance, never
Huwwara) and 05 (safety invariant excludes forbidden edges); 03/10 prove the
append-only provenance + override semantics.
"""
from __future__ import annotations

import copy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import build_kb
from engine import confidence as C
from engine import db as DB
from engine import router, validate
from engine.kb_io import load_kb, append_fact, fact_history, staleness_worklist, set_live_status, get_live_statuses, now_iso
from ingestion import telegram_adapter as feed

NOW = datetime(2026, 6, 16, tzinfo=timezone.utc)


def _fact(value, source, kind, days_ago):
    ts = (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    return {"value": value, "source": source, "fact_kind": kind, "last_verified": ts}


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="wbkb_test_")
        DB.DATA_DIR = Path(cls.tmp)
        DB.DB_PATH = Path(cls.tmp) / "wbkb.db"
        build_kb.main(["--reset"])
        cls.conn = DB.connect()
        cls.nodes, cls.edges, _ = load_kb(cls.conn)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    # 01 — build produces a connected, well-formed KB
    def test_01_build_integrity(self):
        self.assertGreaterEqual(len(self.nodes), 20)
        self.assertGreaterEqual(len(self.edges), 20)
        self.assertEqual(validate.validate_kb(self.nodes, self.edges), [])

    # 02 — confidence decays with age; trusted source beats weak at equal age
    def test_02_confidence_decay(self):
        self.assertLess(
            C.effective_confidence(_fact(True, "human_local", "edge_gating", 60), NOW),
            C.effective_confidence(_fact(True, "human_local", "edge_gating", 0), NOW),
        )
        self.assertGreater(
            C.effective_confidence(_fact(True, "human_local", "edge_road_exists", 5), NOW),
            C.effective_confidence(_fact(True, "model_inferred", "edge_road_exists", 5), NOW),
        )

    # 03 — a human_local confirmation (a new row) overrides a model seed on reload
    def test_03_confirmation_overrides_seed(self):
        before = load_kb(self.conn)[1]["e_nablus_beit_iba"]["facts"]["permission"]
        self.assertEqual(before["source"], "model_inferred")
        append_fact(self.conn, "edge", "e_nablus_beit_iba", "permission", "forbidden",
                    "human_local", "edge_permission", now_iso(), "test confirmation")
        after = load_kb(self.conn)[1]["e_nablus_beit_iba"]["facts"]["permission"]
        self.assertEqual(after["source"], "human_local")
        self.assertEqual(after["value"], "forbidden")

    # 04 — Ramallah -> Nablus enters via the REAL entrance, NEVER Huwwara (the bug)
    def test_04_nablus_entrance_not_huwwara(self):
        nodes, edges, _ = load_kb(self.conn)
        res = router.route(nodes, edges, "city_ramallah", "city_nablus", {})
        self.assertTrue(res["found"])
        self.assertNotIn("cp_huwwara", res["path_nodes"])
        self.assertEqual(res["edges"][-1]["to"], "city_nablus")
        self.assertIn(res["edges"][-1]["from"], {"cp_murabbaa", "cp_awarta", "cp_sarra", "cp_deir_sharaf"})

    # 05 — safety invariant: a forbidden shortcut is never used, even if fastest
    def test_05_safety_invariant(self):
        nodes, edges = copy.deepcopy(self.nodes), copy.deepcopy(self.edges)
        edges["e_evil_shortcut"] = {
            "id": "e_evil_shortcut", "from": "city_ramallah", "to": "city_nablus",
            "road_ref": "settler bypass", "base_minutes": 1, "passes_settlement": True,
            "facts": {
                "road_exists": _fact(True, "human_local", "edge_road_exists", 0),
                "permission": _fact("settler_road", "human_local", "edge_permission", 0),
                "gating": _fact([], "human_local", "edge_gating", 0),
            },
        }
        res = router.route(nodes, edges, "city_ramallah", "city_nablus", {})
        self.assertNotIn("e_evil_shortcut", [e["id"] for e in res["edges"]])
        validate.assert_safe(res, edges)
        with self.assertRaises(validate.SafetyViolation):
            validate.assert_safe({"found": True, "edges": [{"id": "e_evil_shortcut"}]}, edges)

    # 06 — a closed gating checkpoint forces a reroute through another entrance
    def test_06_closed_gate_reroutes(self):
        nodes, edges, _ = load_kb(self.conn)
        res = router.route(nodes, edges, "city_ramallah", "city_nablus", {"murabbaa": "closed"})
        self.assertTrue(res["found"])
        self.assertNotIn("e_murabbaa_nablus", [e["id"] for e in res["edges"]])
        self.assertEqual(res["edges"][-1]["to"], "city_nablus")

    # 07 — staleness worklist surfaces model_inferred facts, not the human corridor
    def test_07_staleness_worklist(self):
        nodes, edges, _ = load_kb(self.conn)
        wl = staleness_worklist(nodes, edges)
        self.assertTrue(any(r["source"] == "model_inferred" for r in wl))
        self.assertFalse(any(r["entity_id"] == "e_murabbaa_nablus" for r in wl))

    # 08 — feed adapter parses Arabic + English into {feed_key: status}
    def test_08_feed_parsing(self):
        self.assertEqual(feed.parse_message("حاجز المربعة مسكر"), {"murabbaa": "closed"})
        self.assertEqual(feed.parse_message("Zaatara is open now"), {"zaatara": "open"})
        self.assertEqual(feed.parse_message("قلنديا ازمة"), {"qalandiya": "congested"})

    # 09 — live_status: fresh signal flows to the router, stale one is dropped
    def test_09_live_status_ttl(self):
        fresh = NOW.strftime("%Y-%m-%dT%H:%M:%S+00:00")
        stale = (NOW - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
        set_live_status(self.conn, "atara", "congested", fresh)
        set_live_status(self.conn, "zaatara", "open", stale)
        sm = get_live_statuses(self.conn, now=NOW, ttl_days=1.5)
        self.assertEqual(sm.get("atara"), "congested")
        self.assertNotIn("zaatara", sm)

    # 11 — an unmapped live status (e.g. 'police') must never crash the router
    def test_11_unknown_status_no_crash(self):
        nodes, edges, _ = load_kb(self.conn)
        sm = {"atara": "police", "zaatara": "some_new_status", "murabbaa": "open"}
        res = router.route(nodes, edges, "city_ramallah", "city_nablus", sm)
        self.assertTrue(res["found"])
        self.assertEqual(res["edges"][-1]["to"], "city_nablus")

    # 10 — append-only: history is preserved (audit trail / time travel)
    def test_10_append_only_history(self):
        n0 = len(fact_history(self.conn, "edge", "e_lubban_zaatara", "permission"))
        append_fact(self.conn, "edge", "e_lubban_zaatara", "permission", "allowed",
                    "human_local", "edge_permission", now_iso(), "re-confirm")
        hist = fact_history(self.conn, "edge", "e_lubban_zaatara", "permission")
        self.assertEqual(len(hist), n0 + 1)          # nothing overwritten
        self.assertEqual(hist[0]["source"], "human_local")  # original seed still there


if __name__ == "__main__":
    unittest.main(verbosity=2)
