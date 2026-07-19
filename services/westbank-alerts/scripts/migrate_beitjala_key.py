"""F11 — rename the corrupted Beit Jala canonical_key (ب<U+FFFD><U+FFFD>ت_جالا) to
the clean form (بيت_جالا) across the live tables, so it stops being a garbled key.
Merges rather than duplicates if the clean key already exists. Idempotent.

Run in-container:
  docker exec params-alerts-api python /tmp/migrate_beitjala.py [--apply]
"""
import argparse, sqlite3

CLEAN = "بيت_جالا"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--db", default="/data/checkpoints.db")
    args = ap.parse_args()

    con = sqlite3.connect(args.db, timeout=60)
    con.execute("PRAGMA busy_timeout=60000")
    # corrupted keys = Beit-Jala-shaped keys carrying the U+FFFD replacement char
    corrupt = [r[0] for r in con.execute(
        "SELECT DISTINCT canonical_key FROM checkpoints WHERE canonical_key LIKE '%جالا%' AND canonical_key != ?",
        (CLEAN,)) if "�" in r[0]]
    corrupt += [r[0] for r in con.execute(
        "SELECT DISTINCT canonical_key FROM checkpoint_status WHERE canonical_key LIKE '%جالا%' AND canonical_key != ?",
        (CLEAN,)) if "�" in r[0]]
    corrupt = sorted(set(corrupt))
    print(f"corrupted Beit-Jala keys found: {[repr(k) for k in corrupt]}")
    if not corrupt:
        print("nothing to migrate.")
        return

    clean_exists = con.execute("SELECT 1 FROM checkpoints WHERE canonical_key=?", (CLEAN,)).fetchone()
    for bad in corrupt:
        for tbl in ("checkpoint_status", "checkpoint_updates"):
            n = con.execute(f"SELECT COUNT(*) FROM {tbl} WHERE canonical_key=?", (bad,)).fetchone()[0]
            print(f"  {tbl}: {n} rows on corrupted key")
            if args.apply:
                con.execute(f"UPDATE {tbl} SET canonical_key=? WHERE canonical_key=?", (CLEAN, bad))
        if args.apply:
            if clean_exists:
                con.execute("DELETE FROM checkpoints WHERE canonical_key=?", (bad,))
            else:
                con.execute("UPDATE checkpoints SET canonical_key=? WHERE canonical_key=?", (CLEAN, bad))
                clean_exists = True
    if args.apply:
        con.commit()
        print(f"APPLIED: migrated {len(corrupt)} corrupted key(s) -> {CLEAN}")
    else:
        print("DRY RUN — pass --apply to write.")
    con.close()


if __name__ == "__main__":
    main()
