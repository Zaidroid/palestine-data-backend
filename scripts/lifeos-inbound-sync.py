#!/usr/bin/env python3
"""Sync PDB inbound access-requests into the LifeOS CRM funnel.

Reads new rows from the palestine-data-api keys.db `access_requests` table and
creates a crm_org in LifeOS for each, so pricing-page requests land in the OS
funnel automatically instead of only pinging ntfy. Idempotent via a high-water-
mark file — it never writes keys.db (so no permission/lock issues with the
running api container).

Runs on `main`, where both the keys.db and LifeOS live. The LifeOS write token
is read from ~/lifeos/state.json (NOT hard-coded here), or from $LIFEOS_TOKEN.

    python3 scripts/lifeos-inbound-sync.py

Enable as a cron only once inbound volume warrants it (Decision Log: no premature
machinery). Until then a manual run is enough.
"""
import json
import os
import pathlib
import sqlite3
import urllib.request

KEYS_DB = os.environ.get("KEYS_DB_PATH", "/opt/stacks/palestine/data/keys.db")
LIFEOS = os.environ.get("LIFEOS_URL", "http://127.0.0.1:8377")
STATE = pathlib.Path(os.environ.get("PDB_INBOUND_STATE", os.path.expanduser("~/.pdb_inbound_last")))


def lifeos_token():
    tok = os.environ.get("LIFEOS_TOKEN")
    if tok:
        return tok
    # Fall back to the claude actor token in LifeOS state.json (never in this repo).
    with open(os.path.expanduser("~/lifeos/state.json")) as fh:
        d = json.load(fh)
    return (d.get("actor_tokens") or {}).get("claude") or d.get("token")


def last_synced_id():
    try:
        return int(STATE.read_text().strip())
    except Exception:
        return 0


def create_crm_org(token, req):
    org = req.get("org") or req.get("email")
    body = {
        "name": f"{org} (PDB inbound)",
        "contact_person": req.get("email") or "",
        "channel": "pricing form",
        "warmth": "warm",
        "coi_status": "clear",
        "status": "not_contacted",
        "owner": "zaid",
        "notes": (
            f"[PDB INBOUND] tier={req.get('tier')} · "
            f"use_case={req.get('use_case') or '-'} · requested {req.get('created_at')}"
        ),
    }
    r = urllib.request.Request(
        f"{LIFEOS}/api/crm/orgs",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"X-Token": token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=8) as resp:
        return resp.status


def main():
    if not os.path.exists(KEYS_DB):
        print(f"keys.db not found at {KEYS_DB} — nothing to sync")
        return
    token = lifeos_token()
    con = sqlite3.connect(f"file:{KEYS_DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    since = last_synced_id()
    rows = con.execute(
        "SELECT id, name, org, email, tier, use_case, created_at "
        "FROM access_requests WHERE id > ? ORDER BY id",
        (since,),
    ).fetchall()
    con.close()

    if not rows:
        print(f"no new access_requests (last synced id {since})")
        return

    high = since
    for row in rows:
        req = dict(row)
        try:
            status = create_crm_org(token, req)
            print(f"req {req['id']} <{req['email']}> -> CRM HTTP {status}")
            high = max(high, req["id"])
        except Exception as e:
            # Stop at first failure; do not advance the high-water mark past it,
            # so the next run retries this request.
            print(f"req {req['id']} FAILED: {e}")
            break

    STATE.write_text(str(high))
    print(f"synced up to access_request id {high}")


if __name__ == "__main__":
    main()
