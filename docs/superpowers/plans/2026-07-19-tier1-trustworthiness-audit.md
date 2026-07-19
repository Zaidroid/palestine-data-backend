# Tier 1 Trustworthiness Audit — Implementation Plan (Plan A: measure + publish)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the real accuracy of the live WB tier (8 metrics), report findings ranked by trust impact, and publish the methodology + accuracy artifacts that make Tier 1 sellable.

**Architecture:** Read-only snapshot of prod DBs + a Telethon corpus re-pull, then offline replay of the exact prod classifier/parser code against the corpus, joined against what prod actually served. Hand-labeled samples turn the joins into FP/FN numbers. Everything lands in `analysis/audit-2026-07-19/`; public artifacts land in `docs/` and one new `/quality/accuracy` endpoint.

**Tech Stack:** Python 3 (stdlib + the service's own `app/` modules), SQLite, bash/ssh/scp, pytest for the endpoint task.

**Spec:** `docs/superpowers/specs/2026-07-19-tier1-trustworthiness-audit-design.md`. This plan implements spec Phases 0–2 + 5 and the *measurement* half of Phase 4 (discovery sweep). Spec Phase 3 (fixes) and the *build* half of Phase 4 (shadow-ingest, promotions) get **Plan B**, written after Zaid sets the fix cut-off at the findings gate — fixes cannot be planned before the measurements exist.

## Global Constraints

- **Prod is read-only this entire plan.** No writes under `/opt/stacks/palestine` except `/tmp` inside the container. Never copy `session/`, `keys.db`, or any `.env`.
- Anything that must run on .114 that auto-mode blocks → present to Zaid as **numbered `!`-prefix commands**, verify output between steps.
- Prod host: `zaid@100.99.243.75` (Tailscale). Alerts container: `params-alerts-api`. Live DBs in-container: `/data/checkpoints.db`, `/data/alerts.db`. Corpus dir in-container: `/data/corpus/`.
- All analysis outputs → `analysis/audit-2026-07-19/` (committed). Snapshot DB copies → `analysis/audit-2026-07-19/snapshot/` (**git-ignored** — add to `.gitignore` in Task 1; DB copies contain full message text, keep them local-only).
- Commit after every task, on `main`, message prefix `audit(tier1):`. Do not push (Zaid pushes).
- Replay must run with `cwd = services/westbank-alerts` (the KB loads its catalog relative to the service dir) and must use the **prod catalog** if it differs from the repo copy (Task 2 checks).

---

### Task 1: Audit workspace + local replay environment

**Files:**
- Create: `analysis/audit-2026-07-19/README.md`
- Modify: `.gitignore` (append snapshot dir)
- Create: `services/westbank-alerts/.venv-audit/` (git-ignored already via standard venv patterns — verify)

**Interfaces:**
- Produces: a venv whose python can `from app.classifier import classify` — every later replay/analysis script uses `services/westbank-alerts/.venv-audit/bin/python`.

- [ ] **Step 1: Create workspace + gitignore entry**

```bash
mkdir -p analysis/audit-2026-07-19/snapshot
cat > analysis/audit-2026-07-19/README.md <<'EOF'
# Tier 1 trustworthiness audit — 2026-07-19
Working dir for the measure-first audit (spec: docs/superpowers/specs/2026-07-19-tier1-trustworthiness-audit-design.md).
- snapshot/ = read-only prod copies (git-ignored, local only)
- *.py = measurement instruments, run with services/westbank-alerts/.venv-audit/bin/python
- outputs (*.md, *.json summaries) are committed
EOF
grep -q "audit-2026-07-19/snapshot" .gitignore || echo "analysis/audit-2026-07-19/snapshot/" >> .gitignore
```

- [ ] **Step 2: Create venv and install service requirements**

```bash
cd services/westbank-alerts
python3 -m venv .venv-audit
.venv-audit/bin/pip install -r requirements.txt pytest
```

Expected: install completes. (June note: full app boot also wanted `telethon sentry-sdk feedparser pywebpush pytesseract` — install these too if the next step's import fails on them.)

- [ ] **Step 3: Prove the offline import path with the existing test suite**

```bash
cd services/westbank-alerts
.venv-audit/bin/python -m pytest test_classifier_fp_audit.py test_checkpoint_whitelist.py -q
```

Expected: PASS (92 FP fixtures + whitelist tests). This proves `classify()` and `parse_checkpoint_message()` run offline exactly as CI runs them.

- [ ] **Step 4: Commit**

```bash
git add analysis/audit-2026-07-19/README.md .gitignore
git commit -m "audit(tier1): workspace + replay venv"
```

---

### Task 2: Read-only prod snapshot

**Files:**
- Create: `analysis/audit-2026-07-19/pull_snapshot.sh`
- Output (git-ignored): `snapshot/checkpoints.db`, `snapshot/alerts.db`, `snapshot/known_checkpoints.prod.json`, `snapshot/city_gateways.prod.json`, `snapshot/health.json`, `snapshot/quality_eval.json`, `snapshot/v2_checkpoints.json`, `snapshot/prod_env_channels.txt`

**Interfaces:**
- Produces: `snapshot/*.db` (SQLite, consistent `.backup` copies) and `snapshot/*.json` — every measurement script reads these paths relative to `analysis/audit-2026-07-19/`.

- [ ] **Step 1: Write the puller**

```bash
cat > analysis/audit-2026-07-19/pull_snapshot.sh <<'EOF'
#!/usr/bin/env bash
# Read-only prod snapshot for the Tier 1 audit. Safe: sqlite backup API via
# python inside the container, output to /tmp only, scp back. Never touches
# session/, keys.db, or .env.
set -euo pipefail
HOST=zaid@100.99.243.75
C=params-alerts-api
OUT="$(dirname "$0")/snapshot"
mkdir -p "$OUT"

for db in checkpoints alerts; do
  ssh "$HOST" "docker exec $C python -c \"import sqlite3; s=sqlite3.connect('/data/${db}.db'); d=sqlite3.connect('/tmp/${db}_audit.db'); s.backup(d); d.close()\""
  ssh "$HOST" "docker cp $C:/tmp/${db}_audit.db /tmp/${db}_audit.db"
  scp -q "$HOST:/tmp/${db}_audit.db" "$OUT/${db}.db"
  ssh "$HOST" "rm -f /tmp/${db}_audit.db; docker exec $C rm -f /tmp/${db}_audit.db"
done

ssh "$HOST" "docker exec $C cat /app/data/known_checkpoints.json" > "$OUT/known_checkpoints.prod.json"
ssh "$HOST" "docker exec $C cat /app/data/city_gateways.json"     > "$OUT/city_gateways.prod.json"
ssh "$HOST" "docker exec $C env" | grep -E "CHANNELS" > "$OUT/prod_env_channels.txt"

curl -sS -m 30 https://wb-alerts.zaidlab.xyz/health                    > "$OUT/health.json"
curl -sS -m 60 "https://wb-alerts.zaidlab.xyz/quality/eval?force=true" > "$OUT/quality_eval.json"
curl -sS -m 60 "https://wb-alerts.zaidlab.xyz/v2/checkpoints?limit=500" > "$OUT/v2_checkpoints.json"
echo "snapshot complete: $(ls -la "$OUT" | wc -l) files"
EOF
chmod +x analysis/audit-2026-07-19/pull_snapshot.sh
```

- [ ] **Step 2: Run it**

```bash
bash analysis/audit-2026-07-19/pull_snapshot.sh
```

Expected: both `.db` files land (checkpoints.db likely 1–20 MB), all JSONs non-empty. If the in-container catalog path differs (`/app/data/...` wrong), find it with `ssh $HOST "docker exec $C find / -name known_checkpoints.json -not -path '*/node_modules/*' 2>/dev/null"` and fix the script.

- [ ] **Step 3: Sanity-check row counts + catalog diff**

```bash
S=analysis/audit-2026-07-19/snapshot
sqlite3 "$S/checkpoints.db" "SELECT 'updates', COUNT(*) FROM checkpoint_updates UNION ALL SELECT 'status', COUNT(*) FROM checkpoint_status UNION ALL SELECT 'candidates', COUNT(*) FROM checkpoint_candidates;"
sqlite3 "$S/alerts.db" "SELECT 'alerts', COUNT(*) FROM alerts UNION ALL SELECT 'channel_reliability', COUNT(*) FROM channel_reliability;"
diff <(python3 -m json.tool "$S/known_checkpoints.prod.json") <(python3 -m json.tool services/westbank-alerts/data/known_checkpoints.json) > "$S/catalog.diff"; wc -l "$S/catalog.diff"
```

Expected: non-zero counts everywhere; note the numbers in README.md. If `catalog.diff` is non-empty, **all replay tasks must point the KB at the prod copy** (copy it over `services/westbank-alerts/data/known_checkpoints.json` in the working tree during replay, restore after — do NOT commit it).

- [ ] **Step 4: Commit**

```bash
git add analysis/audit-2026-07-19/pull_snapshot.sh analysis/audit-2026-07-19/README.md
git commit -m "audit(tier1): read-only prod snapshot puller + baseline counts"
```

---

### Task 3: Inventory — what is actually persisted

**Files:**
- Create: `analysis/audit-2026-07-19/inventory.py`
- Create (committed): `analysis/audit-2026-07-19/INVENTORY.md`

**Interfaces:**
- Consumes: `snapshot/*.db` from Task 2.
- Produces: `INVENTORY.md` — table list, row counts, date ranges, per-channel 30-day volumes. Later tasks cite it for feasibility.

- [ ] **Step 1: Write inventory.py**

```python
#!/usr/bin/env python3
"""Enumerate what the prod snapshot actually contains -> INVENTORY.md."""
import sqlite3, pathlib

BASE = pathlib.Path(__file__).parent
out = ["# Snapshot inventory — 2026-07-19\n"]

for name in ("checkpoints", "alerts"):
    db = sqlite3.connect(BASE / "snapshot" / f"{name}.db")
    out.append(f"\n## {name}.db\n")
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for t in tables:
        n = db.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
        # find a usable time column for the date range
        cols = [c[1] for c in db.execute(f"PRAGMA table_info([{t}])")]
        tcol = next((c for c in ("timestamp", "created_at", "last_seen", "last_updated") if c in cols), None)
        rng = ""
        if tcol and n:
            lo, hi = db.execute(f"SELECT MIN([{tcol}]), MAX([{tcol}]) FROM [{t}]").fetchone()
            rng = f" — {tcol}: {str(lo)[:10]} → {str(hi)[:10]}"
        out.append(f"- `{t}`: {n} rows{rng}")
    db.close()

db = sqlite3.connect(BASE / "snapshot" / "checkpoints.db")
out.append("\n## checkpoint_updates per channel, last 30 days\n")
for ch, n in db.execute("""SELECT source_channel, COUNT(*) FROM checkpoint_updates
        WHERE timestamp >= datetime('now', '-30 days') GROUP BY 1 ORDER BY 2 DESC"""):
    out.append(f"- {ch}: {n}")

db2 = sqlite3.connect(BASE / "snapshot" / "alerts.db")
out.append("\n## alerts per source, last 30 days\n")
for ch, n in db2.execute("""SELECT source, COUNT(*) FROM alerts
        WHERE timestamp >= datetime('now', '-30 days') GROUP BY 1 ORDER BY 2 DESC"""):
    out.append(f"- {ch}: {n}")

(BASE / "INVENTORY.md").write_text("\n".join(out) + "\n")
print(f"wrote INVENTORY.md ({len(out)} lines)")
```

- [ ] **Step 2: Run + read the output**

```bash
services/westbank-alerts/.venv-audit/bin/python analysis/audit-2026-07-19/inventory.py
cat analysis/audit-2026-07-19/INVENTORY.md
```

Expected: every table listed with counts. **Confirm from the output:** `checkpoint_updates.raw_message` coverage (measurement 3 feasible), `checkpoint_candidates` volume (measurement 2 feasible), and that discarded security messages appear in NO table (why Task 4's corpus dump is required for measurement 5).

- [ ] **Step 3: Commit**

```bash
git add analysis/audit-2026-07-19/inventory.py analysis/audit-2026-07-19/INVENTORY.md
git commit -m "audit(tier1): snapshot inventory — persistence ground truth"
```

---

### Task 4: Corpus re-pull + channel discovery (Zaid-gated, ~5-min monitor pause)

**Files:**
- Create: `analysis/audit-2026-07-19/CORPUS-COMMANDS.md` (the numbered `!` commands)
- Output (git-ignored): `snapshot/corpus/*.jsonl`, `snapshot/corpus/discovery.json`, `snapshot/corpus/corpus.db`

**Interfaces:**
- Consumes: `scripts/discover_and_corpus.py` (existing: `--discover`, `--corpus ch1,ch2 --limit N` → `/data/corpus/<channel>.jsonl`; **must run while the monitor is stopped** — shares the Telethon session) and `scripts/build_corpus_db.py` (existing: corpus dir → `corpus.db` with `messages(channel,msg_id,date,text,views,fwd_from_channel)`).
- Produces: `snapshot/corpus/corpus.db` — the raw-message ground truth every replay/labeling task reads.

- [ ] **Step 1: Assemble the channel list from the Task 2 env capture**

Read `snapshot/prod_env_channels.txt` and build the comma-separated union of `TELEGRAM_CHANNELS` + `CHECKPOINT_CHANNELS` (+ `GAZA_BULLETIN_CHANNELS` if set). Write the exact command list:

```bash
cat > analysis/audit-2026-07-19/CORPUS-COMMANDS.md <<'EOF'
# Corpus re-pull — run these as `!` commands in order (monitor down ~5 min)
# 1. stop the service (frees the Telethon session):
! ssh zaid@100.99.243.75 "cd /opt/stacks/palestine && docker compose stop alerts"
# 2. dump last ~3000 msgs/channel (REPLACE <CHANNELS> with the union from prod_env_channels.txt):
! ssh zaid@100.99.243.75 "cd /opt/stacks/palestine && docker compose run --rm --entrypoint python alerts /app/scripts/discover_and_corpus.py --corpus <CHANNELS> --limit 3000"
# 3. discovery sweep (source-expansion input):
! ssh zaid@100.99.243.75 "cd /opt/stacks/palestine && docker compose run --rm --entrypoint python alerts /app/scripts/discover_and_corpus.py --discover"
# 4. restart the service:
! ssh zaid@100.99.243.75 "cd /opt/stacks/palestine && docker compose up -d alerts"
# 5. verify it's ingesting again (monitor.connected true, messages_today climbing):
! curl -sS https://wb-alerts.zaidlab.xyz/health
EOF
```

Note: if the in-container script path is `/scripts/...` not `/app/scripts/...` (check the Dockerfile COPY layout first: `grep -n "scripts" services/westbank-alerts/Dockerfile`), fix the commands before presenting them.

- [ ] **Step 2: Present the numbered commands to Zaid, wait, verify each output**

After command 2: expect per-channel dump lines. After command 4: `/health` must show `monitor.connected: true` within ~2 min and `last_message_at` advancing. **Do not proceed while the monitor is down.**

- [ ] **Step 3: Pull the corpus local + build corpus.db**

```bash
scp -r zaid@100.99.243.75:/opt/stacks/palestine/data/corpus analysis/audit-2026-07-19/snapshot/corpus
# (if the bind-mount host path differs, locate it: ssh zaid@100.99.243.75 "docker inspect params-alerts-api --format '{{json .Mounts}}'")
services/westbank-alerts/.venv-audit/bin/python services/westbank-alerts/scripts/build_corpus_db.py analysis/audit-2026-07-19/snapshot/corpus
```

Expected: `corpus.db: N messages ... FTS smoke test — messages mentioning سالك: >0`.

- [ ] **Step 4: Commit**

```bash
git add analysis/audit-2026-07-19/CORPUS-COMMANDS.md
git commit -m "audit(tier1): corpus re-pull runbook + local corpus build"
```

---

### Task 5: Offline replay harness — replay prod code over the corpus, join vs prod outcomes

**Files:**
- Create: `analysis/audit-2026-07-19/replay.py`
- Output: `snapshot/replay.jsonl` (git-ignored), `analysis/audit-2026-07-19/REPLAY-SUMMARY.md` (committed)

**Interfaces:**
- Consumes: `classify(raw_text: str, source: str) -> Optional[dict]` (`app/classifier.py`), `parse_checkpoint_message(text, knowledge_base, misses=None) -> list[dict]` (`app/checkpoint_whitelist_parser.py`), `CheckpointKnowledgeBase()` (no-arg, loads the catalog — instantiate with `cwd=services/westbank-alerts`), `snapshot/corpus/corpus.db`, `snapshot/alerts.db` (`alerts(source, source_msg_id, type, ...)`), `snapshot/checkpoints.db` (`checkpoint_updates(source_channel, source_msg_id, canonical_key, status, ...)`).
- Produces: `replay.jsonl` — one line per corpus message: `{"channel","msg_id","date","text","kind","replay_alert","replay_cp","replay_misses","prod_alert","prod_cp"}`. The labeling tasks (6, 7) sample from this file, keyed on the four-cell agreement (`replay×prod fired/none`).

- [ ] **Step 1: Write replay.py**

```python
#!/usr/bin/env python3
"""Replay the exact service code over the corpus; join against prod outcomes.
Run from services/westbank-alerts:  .venv-audit/bin/python ../../analysis/audit-2026-07-19/replay.py
"""
import json, sqlite3, sys, pathlib, collections
sys.path.insert(0, ".")
from app.classifier import classify
from app.checkpoint_whitelist_parser import parse_checkpoint_message
from app.checkpoint_knowledge_base import CheckpointKnowledgeBase

AUDIT = pathlib.Path(__file__).parent
SNAP = AUDIT / "snapshot"

env = (SNAP / "prod_env_channels.txt").read_text()
def _chans(var):
    for line in env.splitlines():
        if line.startswith(var + "="):
            return {c.strip().lstrip("@") for c in line.split("=", 1)[1].split(",") if c.strip()}
    return set()
CP_CH = _chans("CHECKPOINT_CHANNELS")
SEC_CH = _chans("TELEGRAM_CHANNELS")

kb = CheckpointKnowledgeBase()
corpus = sqlite3.connect(SNAP / "corpus" / "corpus.db")
alerts = sqlite3.connect(SNAP / "alerts.db")
cps = sqlite3.connect(SNAP / "checkpoints.db")

prod_alert = {(r[0], r[1]): r[2] for r in alerts.execute(
    "SELECT source, source_msg_id, type FROM alerts WHERE source_msg_id IS NOT NULL")}
prod_cp = collections.defaultdict(list)
for r in cps.execute("SELECT source_channel, source_msg_id, canonical_key, status FROM checkpoint_updates WHERE source_msg_id IS NOT NULL"):
    prod_cp[(r[0], r[1])].append({"key": r[2], "status": r[3]})

n = 0
with open(SNAP / "replay.jsonl", "w", encoding="utf-8") as f:
    for ch, mid, date, text in corpus.execute("SELECT channel, msg_id, date, text FROM messages WHERE length(text) >= 10"):
        kind = ("checkpoint" if ch in CP_CH else "security" if ch in SEC_CH else "other")
        rec = {"channel": ch, "msg_id": mid, "date": date, "text": text, "kind": kind,
               "replay_alert": None, "replay_cp": [], "replay_misses": [],
               "prod_alert": prod_alert.get((ch, mid)), "prod_cp": prod_cp.get((ch, mid), [])}
        if kind == "checkpoint":
            misses = []
            rec["replay_cp"] = [{"key": u.get("canonical_key"), "status": u.get("status")}
                                for u in parse_checkpoint_message(text, kb, misses=misses)]
            rec["replay_misses"] = misses
        elif kind == "security":
            a = classify(text, ch)
            rec["replay_alert"] = {"type": a.get("type"), "severity": a.get("severity")} if a else None
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        n += 1
print(f"replayed {n} messages -> {SNAP/'replay.jsonl'}")
```

- [ ] **Step 2: Run it (with the prod catalog if catalog.diff was non-empty)**

```bash
cd services/westbank-alerts && .venv-audit/bin/python ../../analysis/audit-2026-07-19/replay.py
```

Expected: `replayed <N> messages` with N in the thousands. If any import needs an env var (e.g. MiniMax key), the classifier layer must fail-safe to rules — that is its documented design; if it *crashes* instead, record that as **finding #1** and stub the env var to proceed.

- [ ] **Step 3: Summarize the four-cell agreement**

Append to replay.py run (small follow-up script or a `--summary` flag): counts per kind of {replay+prod, replay-only, prod-only, neither} → write `REPLAY-SUMMARY.md` with the table and 5 example messages per cell. `prod-only` on security = the deployed image diverges from repo HEAD (image staleness — check with `ssh zaid@100.99.243.75 "docker images palestine-api --format '{{.CreatedAt}}'"` equivalent for `wb-alerts` image) or dedup suppressed the replay… note both hypotheses in the summary, don't conclude yet.

- [ ] **Step 4: Commit**

```bash
git add analysis/audit-2026-07-19/replay.py analysis/audit-2026-07-19/REPLAY-SUMMARY.md
git commit -m "audit(tier1): offline replay harness + prod agreement matrix"
```

---

### Task 6: Measurements 1 + 5 — labeled classifier accuracy and discard false-negative rate

**Files:**
- Create: `analysis/audit-2026-07-19/sample_for_labeling.py`, `analysis/audit-2026-07-19/score_labels.py`
- Output (committed): `analysis/audit-2026-07-19/labels_m1.jsonl`, `labels_m5.jsonl`, `M1-M5-RESULTS.md`

**Interfaces:**
- Consumes: `snapshot/replay.jsonl` from Task 5.
- Produces: `M1-M5-RESULTS.md` + a machine block `accuracy_numbers.json` (`{"m1": {"per_class": {...}, "fp_rate": x, "fn_rate": y, "n": 250}, "m5": {"discard_fn_rate": z, "n": 150}}`) consumed by Task 10 (ACCURACY.md) and Task 11 (endpoint data file).

- [ ] **Step 1: Write sample_for_labeling.py**

```python
#!/usr/bin/env python3
"""Stratified samples for hand-labeling.
m1: 250 security-kind messages stratified by channel x agreement-cell.
m5: 150 messages where BOTH replay and prod produced nothing (the discard pile).
Deterministic: seeded by (channel, msg_id) hash — reruns give identical samples.
"""
import json, hashlib, pathlib, collections

SNAP = pathlib.Path(__file__).parent / "snapshot"
rows = [json.loads(l) for l in open(SNAP / "replay.jsonl", encoding="utf-8")]
sec = [r for r in rows if r["kind"] == "security"]

def cell(r):
    return ("replay" if r["replay_alert"] else "none") + "+" + ("prod" if r["prod_alert"] else "none")

def pick(pool, k):
    return sorted(pool, key=lambda r: hashlib.sha1(f"{r['channel']}:{r['msg_id']}".encode()).hexdigest())[:k]

by_cell = collections.defaultdict(list)
for r in sec:
    by_cell[cell(r)].append(r)

m1 = []
quota = {"replay+prod": 80, "replay+none": 60, "none+prod": 30, "none+none": 80}
for c, k in quota.items():
    got = pick(by_cell.get(c, []), k)
    m1 += got
    print(f"m1 cell {c}: wanted {k}, got {len(got)}")
# m5 draws from the SAME hash-sorted none+none pool, AFTER m1's slice — no overlap.
nn_sorted = pick(by_cell.get("none+none", []), len(by_cell.get("none+none", [])))
m5 = nn_sorted[quota["none+none"]:quota["none+none"] + 150]

for name, sample in (("m1", m1), ("m5", m5)):
    with open(pathlib.Path(__file__).parent / f"labels_{name}.jsonl", "w", encoding="utf-8") as f:
        for r in sample:
            f.write(json.dumps({"channel": r["channel"], "msg_id": r["msg_id"], "text": r["text"],
                                "replay_alert": r["replay_alert"], "prod_alert": r["prod_alert"],
                                "gold_is_alert": None, "gold_type": None, "note": ""},
                               ensure_ascii=False) + "\n")
    print(f"{name}: {len(sample)} rows to label")
```

- [ ] **Step 2: Run it; verify quotas**

Expected: `labels_m1.jsonl` ~250 rows (cells short on volume report honestly), `labels_m5.jsonl` 150 rows.

- [ ] **Step 3: Hand-label both files** (the executing agent labels — read the Arabic text directly; `gold_is_alert`: true/false, `gold_type`: the alert taxonomy value or null, `note` for anything ambiguous; mark genuinely undecidable rows `"gold_is_alert": "unsure"` and exclude from rates but report the count)

- [ ] **Step 4: Write score_labels.py**

```python
#!/usr/bin/env python3
"""Turn labeled jsonl into FP/FN rates -> M1-M5-RESULTS.md + accuracy_numbers.json."""
import json, pathlib, collections

BASE = pathlib.Path(__file__).parent
def load(p): return [json.loads(l) for l in open(p, encoding="utf-8")]

m1 = [r for r in load(BASE / "labels_m1.jsonl") if r["gold_is_alert"] in (True, False)]
tp = sum(1 for r in m1 if r["replay_alert"] and r["gold_is_alert"])
fp = sum(1 for r in m1 if r["replay_alert"] and not r["gold_is_alert"])
fn = sum(1 for r in m1 if not r["replay_alert"] and r["gold_is_alert"])
tn = sum(1 for r in m1 if not r["replay_alert"] and not r["gold_is_alert"])
per_type = collections.Counter((r["replay_alert"] or {}).get("type") for r in m1 if r["replay_alert"] and not r["gold_is_alert"])

m5 = [r for r in load(BASE / "labels_m5.jsonl") if r["gold_is_alert"] in (True, False)]
m5_fn = sum(1 for r in m5 if r["gold_is_alert"])

numbers = {
    "measured_at": "2026-07-19",
    "m1": {"n": len(m1), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
           "precision": round(tp / (tp + fp), 3) if tp + fp else None,
           "recall": round(tp / (tp + fn), 3) if tp + fn else None,
           "fp_by_type": dict(per_type)},
    "m5": {"n": len(m5), "discard_fn": m5_fn, "discard_fn_rate": round(m5_fn / len(m5), 3) if m5 else None},
}
(BASE / "accuracy_numbers.json").write_text(json.dumps(numbers, indent=2, ensure_ascii=False))
md = [f"# M1 classifier accuracy + M5 discard FN — labeled {numbers['measured_at']}",
      f"- M1 (n={numbers['m1']['n']}): precision {numbers['m1']['precision']}, recall {numbers['m1']['recall']} (tp {tp} / fp {fp} / fn {fn} / tn {tn})",
      f"- M1 FP by type: {dict(per_type)}",
      f"- M5 (n={numbers['m5']['n']}): {m5_fn} real alerts found in the discard pile → discard FN rate {numbers['m5']['discard_fn_rate']}",
      "", "Interpretation and examples: see FINDINGS.md."]
(BASE / "M1-M5-RESULTS.md").write_text("\n".join(md) + "\n")
print(json.dumps(numbers, indent=2))
```

- [ ] **Step 5: Run + verify the numbers are populated (no None where n>0), commit**

```bash
services/westbank-alerts/.venv-audit/bin/python analysis/audit-2026-07-19/score_labels.py
git add analysis/audit-2026-07-19/sample_for_labeling.py analysis/audit-2026-07-19/score_labels.py analysis/audit-2026-07-19/labels_m1.jsonl analysis/audit-2026-07-19/labels_m5.jsonl analysis/audit-2026-07-19/M1-M5-RESULTS.md analysis/audit-2026-07-19/accuracy_numbers.json
git commit -m "audit(tier1): M1 classifier accuracy + M5 discard FN — labeled ground truth"
```

---

### Task 7: Measurement 2 — whitelist-miss composition + coverage-gap list

**Files:**
- Create: `analysis/audit-2026-07-19/miss_composition.py`
- Output (committed): `analysis/audit-2026-07-19/M2-MISSES.md`

**Interfaces:**
- Consumes: `snapshot/checkpoints.db` (`checkpoint_candidates(raw_name, normalized, mentions, llm_verdict, llm_confidence, status, governorate, first_seen, last_seen)`), `snapshot/replay.jsonl` (`replay_misses`).
- Produces: `M2-MISSES.md` with the junk/real/parse-failure split and a ranked coverage-gap table (name, mentions, governorate guess) — Plan B's promotion queue.

- [ ] **Step 1: Write miss_composition.py**

```python
#!/usr/bin/env python3
"""Decompose the whitelist-miss stream: junk vs real-but-uncataloged vs parse failure."""
import json, sqlite3, pathlib, collections

BASE = pathlib.Path(__file__).parent
db = sqlite3.connect(BASE / "snapshot" / "checkpoints.db")

cands = list(db.execute("""SELECT raw_name, normalized, mentions, llm_verdict, llm_confidence,
        status, governorate, first_seen, last_seen FROM checkpoint_candidates ORDER BY mentions DESC"""))
by_verdict = collections.Counter(r[3] or "unvetted" for r in cands)

misses = collections.Counter()
for line in open(BASE / "snapshot" / "replay.jsonl", encoding="utf-8"):
    r = json.loads(line)
    for m in r.get("replay_misses", []):
        misses[str(m)] += 1

md = ["# M2 — whitelist-miss composition\n",
      f"candidates table: {len(cands)} distinct names; verdicts: {dict(by_verdict)}\n",
      f"replay misses (corpus window): {sum(misses.values())} hits / {len(misses)} distinct names\n",
      "## Top 40 candidates by mentions (promotion queue input)\n",
      "| raw_name | mentions | llm_verdict | conf | status | governorate |", "|---|---|---|---|---|---|"]
for r in cands[:40]:
    md.append(f"| {r[0]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {r[6]} |")
md += ["\n## Top 30 replay-window misses\n"] + [f"- {k}: {v}" for k, v in misses.most_common(30)]
(BASE / "M2-MISSES.md").write_text("\n".join(md) + "\n")
print(f"candidates={len(cands)} distinct_replay_misses={len(misses)}")
```

- [ ] **Step 2: Run it, then hand-classify the top 40** — annotate each top-40 row in M2-MISSES.md with `junk` / `real-uncataloged` / `variant-of-cataloged` / `parse-failure` (read the raw names; cross-check variants against `known_checkpoints.prod.json`). Add the summary split at the top: "of top 40 by mentions: X real-uncataloged, Y junk, Z variants, W parse failures".

- [ ] **Step 3: Commit**

```bash
git add analysis/audit-2026-07-19/miss_composition.py analysis/audit-2026-07-19/M2-MISSES.md
git commit -m "audit(tier1): M2 whitelist-miss composition + coverage-gap queue"
```

---

### Task 8: Measurements 3 + 4 — served-status correctness and staleness honesty

**Files:**
- Create: `analysis/audit-2026-07-19/consensus_check.py`, `analysis/audit-2026-07-19/staleness_probe.py`
- Output (committed): `analysis/audit-2026-07-19/M3-M4-RESULTS.md`

**Interfaces:**
- Consumes: `snapshot/checkpoints.db` (`checkpoint_updates`, `checkpoint_status`), live endpoints `https://wb-alerts.zaidlab.xyz` (`/checkpoints`, `/checkpoints/summary`, `/checkpoints/stats`, `/v2/checkpoints`, `/v2/cities`).
- Produces: `M3-M4-RESULTS.md` — M3 agreement rate + disagreement examples; M4 leak list per endpoint (target: empty).

- [ ] **Step 1: Write consensus_check.py**

```python
#!/usr/bin/env python3
"""M3: does the served status match the evidence stream?
For each (canonical_key, direction) the snapshot serves, compare checkpoint_status
against the majority status of its checkpoint_updates in the 60 min before
last_updated. Disagreement != bug (trust weighting is intentional) — every
disagreement is listed for hand-review."""
import sqlite3, pathlib, collections

BASE = pathlib.Path(__file__).parent
db = sqlite3.connect(BASE / "snapshot" / "checkpoints.db")
rows = list(db.execute("SELECT canonical_key, direction, status, last_updated FROM checkpoint_status"))
agree = disagree = thin = 0
details = []
for key, direction, served, at in rows:
    upd = [r[0] for r in db.execute("""SELECT status FROM checkpoint_updates
        WHERE canonical_key=? AND IFNULL(direction,'')=IFNULL(?, '')
          AND timestamp BETWEEN datetime(?, '-60 minutes') AND ?""", (key, direction, at, at))]
    if len(upd) < 2:
        thin += 1
        continue
    majority = collections.Counter(upd).most_common(1)[0][0]
    if majority == served:
        agree += 1
    else:
        disagree += 1
        details.append(f"- {key}/{direction or '-'}: served={served} majority={majority} window={upd}")
total = agree + disagree
md = ["# M3 — served status vs evidence stream\n",
      f"- checkpoint-hours with >=2 reports: {total} (agree {agree} / disagree {disagree}); thin(<2 reports): {thin}",
      f"- agreement rate: {round(agree/total, 3) if total else 'n/a'}\n",
      "## Disagreements (hand-review each — trust-weighting may be correct)\n"] + details
(BASE / "M3-M4-RESULTS.md").write_text("\n".join(md) + "\n")
print(f"agree={agree} disagree={disagree} thin={thin}")
```

- [ ] **Step 2: Write staleness_probe.py**

```python
#!/usr/bin/env python3
"""M4: staleness honesty — does ANY serving path paint a stale checkpoint as live?
Rule under test (June design): stale/never-reported must serve effective_status
'unknown' (v2) or carry is_stale/last_active flags (v1)."""
import json, urllib.request, pathlib
from datetime import datetime, timezone

B = "https://wb-alerts.zaidlab.xyz"
def get(p):
    with urllib.request.urlopen(B + p, timeout=60) as r:
        return json.load(r)

leaks = []
now = datetime.now(timezone.utc)
def age_h(ts):
    if not ts: return None
    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if t.tzinfo is None: t = t.replace(tzinfo=timezone.utc)
    return (now - t).total_seconds() / 3600

v2 = get("/v2/checkpoints?limit=500")
for c in v2.get("checkpoints", []):
    a = c.get("freshness", {}).get("age_hours")
    if a is not None and a > 6 and c.get("effective_status") not in ("unknown", "closed"):
        leaks.append(f"- /v2/checkpoints: {c['canonical_key']} age={a}h effective_status={c['effective_status']}")

v1 = get("/checkpoints")
items = v1 if isinstance(v1, list) else v1.get("checkpoints", [])
for c in items:
    a = age_h(c.get("last_updated"))
    if a and a > 6 and c.get("status") not in ("unknown",) and not c.get("is_stale"):
        leaks.append(f"- /checkpoints (v1): {c.get('canonical_key') or c.get('name_ar')} age={round(a,1)}h status={c.get('status')} is_stale missing")

for path in ("/checkpoints/summary", "/checkpoints/stats", "/v2/cities"):
    doc = get(path)
    out = pathlib.Path(__file__).parent / "snapshot" / (path.strip("/").replace("/", "_") + ".json")
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    # summaries aggregate counts — hand-review saved copies for stale-inflated counts

md = pathlib.Path(__file__).parent / "M3-M4-RESULTS.md"
with open(md, "a") as f:
    f.write("\n# M4 — staleness leaks\n" + ("\n".join(leaks) + "\n" if leaks else "NO leaks found on probed endpoints.\n")
            + "\n(summary/stats/cities saved to snapshot/ for hand-review of aggregates)\n")
print(f"leaks={len(leaks)}")
```

- [ ] **Step 3: Run both; hand-review M3 disagreements and the M4 aggregate files; write the verdict lines into M3-M4-RESULTS.md**

```bash
services/westbank-alerts/.venv-audit/bin/python analysis/audit-2026-07-19/consensus_check.py
services/westbank-alerts/.venv-audit/bin/python analysis/audit-2026-07-19/staleness_probe.py
```

Expected: both print counts; M3 agreement rate and M4 leak count exist. (If v1 `/checkpoints` response shape differs from the script's assumption, fix the accessor — the endpoint's true shape is in `snapshot/v2_checkpoints.json`'s sibling captures.)

- [ ] **Step 4: Commit**

```bash
git add analysis/audit-2026-07-19/consensus_check.py analysis/audit-2026-07-19/staleness_probe.py analysis/audit-2026-07-19/M3-M4-RESULTS.md
git commit -m "audit(tier1): M3 consensus correctness + M4 staleness honesty"
```

---

### Task 9: Measurements 6 + 7 + 8 — channel health, provenance completeness, coordinate regressions

**Files:**
- Create: `analysis/audit-2026-07-19/channel_provenance_coords.py`
- Output (committed): `analysis/audit-2026-07-19/M6-M7-M8-RESULTS.md`

**Interfaces:**
- Consumes: `snapshot/corpus/corpus.db`, `snapshot/alerts.db` (`channel_reliability`), `snapshot/checkpoints.db`, `snapshot/v2_checkpoints.json`, `snapshot/known_checkpoints.prod.json`, git history of `services/westbank-alerts/data/known_checkpoints.json` (June coord fixes, commits `7c76657`, `dba57da`).
- Produces: `M6-M7-M8-RESULTS.md` — channel scorecard, provenance %, coord regression list.

- [ ] **Step 1: Write channel_provenance_coords.py**

```python
#!/usr/bin/env python3
"""M6 channel health, M7 provenance completeness, M8 coord regressions."""
import json, sqlite3, pathlib, subprocess

BASE = pathlib.Path(__file__).parent
SNAP = BASE / "snapshot"
md = ["# M6 — channel health (last 30d)\n",
      "| channel | msgs 30d | msgs last 7d | verdict |", "|---|---|---|---|"]

corpus = sqlite3.connect(SNAP / "corpus" / "corpus.db")
for ch, n30, n7 in corpus.execute("""SELECT channel,
        SUM(CASE WHEN date >= datetime('now','-30 days') THEN 1 ELSE 0 END),
        SUM(CASE WHEN date >= datetime('now','-7 days') THEN 1 ELSE 0 END)
        FROM messages GROUP BY channel ORDER BY 2 DESC"""):
    verdict = "DEAD" if not n7 else ("dying" if n7 < n30 / 8 else "active")
    md.append(f"| {ch} | {n30} | {n7} | {verdict} |")

alerts = sqlite3.connect(SNAP / "alerts.db")
md.append("\n## channel_reliability (trust scores as served)\n")
for row in alerts.execute("SELECT * FROM channel_reliability"):
    md.append(f"- {row}")

md.append("\n# M7 — provenance completeness\n")
v2 = json.load(open(SNAP / "v2_checkpoints.json"))["checkpoints"]
full = sum(1 for c in v2 if c.get("provenance", {}).get("last_msg_id") and c.get("provenance", {}).get("source_channel")
           and c.get("freshness", {}).get("last_updated"))
md.append(f"- /v2/checkpoints: {full}/{len(v2)} records with full provenance chain ({round(full/len(v2)*100)}%)")
n_alerts, n_prov = alerts.execute("SELECT COUNT(*), SUM(CASE WHEN source_msg_id IS NOT NULL AND raw_text != '' THEN 1 ELSE 0 END) FROM alerts WHERE timestamp >= datetime('now','-30 days')").fetchone()
md.append(f"- alerts (30d): {n_prov}/{n_alerts} with source_msg_id + raw_text ({round((n_prov or 0)/n_alerts*100) if n_alerts else 0}%)")

md.append("\n# M8 — coordinate regressions\n")
fixes = {  # June's authoritative OSM/resident-confirmed fixes (commit 7c76657 + follow-ups)
    "حواره": (32.178, 35.273), "زعتره": (32.1153, 35.2547),
}
prod = json.load(open(SNAP / "known_checkpoints.prod.json"))
entries = prod if isinstance(prod, dict) else {e.get("canonical_key"): e for e in prod}
for key, (lat, lon) in fixes.items():
    e = entries.get(key) or {}
    got = (e.get("lat") or e.get("latitude"), e.get("lon") or e.get("longitude"))
    ok = got[0] and abs(got[0] - lat) < 0.005 and abs(got[1] - lon) < 0.005
    md.append(f"- {key}: expected ~({lat},{lon}), prod={got} -> {'OK' if ok else 'REGRESSED'}")
md.append("- full June fix list: run `git log --oneline -5 -- services/westbank-alerts/data/known_checkpoints.json` and diff prod vs each fixed key (hand-step below)")

(BASE / "M6-M7-M8-RESULTS.md").write_text("\n".join(md) + "\n")
print("wrote M6-M7-M8-RESULTS.md")
```

- [ ] **Step 2: Run it; then complete M8 by hand** — `git show 7c76657 -- services/westbank-alerts/data/known_checkpoints.json` lists all 10 June-fixed keys; verify each against `known_checkpoints.prod.json`, append the verdicts. Optionally run `services/westbank-alerts/scripts/reconcile_coords.py` (dry-run, needs network) for fresh OSM drift and append its summary.

- [ ] **Step 3: Commit**

```bash
git add analysis/audit-2026-07-19/channel_provenance_coords.py analysis/audit-2026-07-19/M6-M7-M8-RESULTS.md
git commit -m "audit(tier1): M6 channel health + M7 provenance + M8 coords"
```

---

### Task 10: FINDINGS.md — ranked report → ZAID GATE

**Files:**
- Create (committed): `analysis/audit-2026-07-19/FINDINGS.md`

**Interfaces:**
- Consumes: every `M*-RESULTS.md`, `INVENTORY.md`, `REPLAY-SUMMARY.md`, `accuracy_numbers.json`.
- Produces: the ranked findings list whose accepted subset defines Plan B.

- [ ] **Step 1: Write FINDINGS.md** with this exact structure:

```markdown
# Tier 1 audit findings — 2026-07-19

## Scorecard (one line per measurement, the number + one-line verdict)
| # | Metric | Value | Verdict |

## Findings (ranked by trust impact)
For each: **F<N> [severity: breaks-trust / erodes-trust / cosmetic]** — what,
evidence (link to M*-RESULTS section + 2-3 example messages), affected surface
(which endpoints/customers see it), proposed fix direction (1-2 lines, NOT a design).

## Coverage-gap promotion queue (from M2, top real-uncataloged names)

## Source-expansion inputs (discovery.json summary — feeds SOURCES-SHORTLIST)

## Proposed Plan B cut line
"Fix F1–F<k> this round" recommendation + why.
```

Ranking rubric: breaks-trust = a paying analyst would catch it and stop trusting the feed (false alerts served, stale painted live, wrong status, missed major events); erodes-trust = provenance holes, dead channels, coverage gaps; cosmetic = everything else.

- [ ] **Step 2: Commit, then STOP and present to Zaid**

```bash
git add analysis/audit-2026-07-19/FINDINGS.md
git commit -m "audit(tier1): ranked findings report"
```

Present the scorecard + top findings + proposed cut line. **Do not start any fix. Plan B is written only after Zaid sets the cut.**

---

### Task 11: METHODOLOGY.md + ACCURACY.md (public trust artifacts)

*(Runs before or in parallel with the gate — depends only on measurements, not on the cut line.)*

**Files:**
- Create: `docs/METHODOLOGY.md`, `docs/ACCURACY.md`
- Modify: `docs/QUICKSTART-alerts.md` (add a "How accurate is this?" section linking both)

**Interfaces:**
- Consumes: `accuracy_numbers.json`, all `M*-RESULTS.md`, existing `docs/DATA_SOURCES.md` (source-trust tiers), `docs/ARCHITECTURE.md`.
- Produces: the two public docs the sales motion cites; ACCURACY.md's numbers table mirrors `accuracy_numbers.json` exactly.

- [ ] **Step 1: Write docs/METHODOLOGY.md** — sections, all content real (pull from code + DATA_SOURCES.md, no aspirational claims):
  1. Pipeline: Telegram channels → dedup → classifier (rules, MiniMax fallback hallucination-guarded) → whitelist-first checkpoint parser (catalog-only, strict-or-nothing) → per-channel dynamic trust → consensus with freshness decay → serving with `effective_status` honesty rule.
  2. The whitelist-first doctrine and why (the 2026-06 minted-checkpoints incident, stated plainly).
  3. Source trust tiers (reference DATA_SOURCES.md) + per-channel reliability scoring.
  4. Freshness bands and the staleness rule (stale/never-reported → `unknown`).
  5. Known limitations (from the audit: whatever M1–M8 showed — e.g. discard FN rate, coverage gaps by governorate, coordinate precision bounds).
  6. Update cadence + how to verify claims yourself (`/quality/eval`, `/quality/accuracy` once Task 12 lands).

- [ ] **Step 2: Write docs/ACCURACY.md** — dated measurement report: the Task 10 scorecard table verbatim, method one-liner per metric (sample sizes, labeling protocol), the ugly numbers included, "measured 2026-07-19, re-measured after each fix round" footer.

- [ ] **Step 3: Link from QUICKSTART-alerts.md; commit**

```bash
git add docs/METHODOLOGY.md docs/ACCURACY.md docs/QUICKSTART-alerts.md
git commit -m "audit(tier1): public METHODOLOGY + ACCURACY artifacts"
```

---

### Task 12: `/quality/accuracy` endpoint — serve the measured numbers live (TDD)

**Files:**
- Create: `services/westbank-alerts/data/accuracy_audit.json` (copy of `accuracy_numbers.json`)
- Create: `services/westbank-alerts/test_quality_accuracy.py`
- Modify: `services/westbank-alerts/app/main.py` (one new route beside `quality_eval`, ~line 1168)

**Interfaces:**
- Consumes: `accuracy_numbers.json` schema from Task 6; `monitor.get_stats()`-style live counters already exposed in `/health` (`monitor._stats` via the existing health path — reuse exactly how `/health` reads them).
- Produces: `GET /quality/accuracy` → `{"audit": <accuracy_audit.json contents>, "live": {"messages_today", "cp_whitelist_miss_today", "cp_messages_seen_today", "security_seen_today", "security_discarded_today"}, "docs": "/docs/ACCURACY.md"}`.

- [ ] **Step 1: Write the failing test**

```python
# services/westbank-alerts/test_quality_accuracy.py
from fastapi.testclient import TestClient
from app.main import app

def test_quality_accuracy_serves_audit_and_live_counters():
    client = TestClient(app)
    r = client.get("/quality/accuracy")
    assert r.status_code == 200
    body = r.json()
    assert body["audit"]["measured_at"] == "2026-07-19"
    assert "m1" in body["audit"] and "m5" in body["audit"]
    for k in ("messages_today", "security_discarded_today", "cp_whitelist_miss_today"):
        assert k in body["live"]
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd services/westbank-alerts && .venv-audit/bin/python -m pytest test_quality_accuracy.py -q
```

Expected: FAIL (404).

- [ ] **Step 3: Implement the route** (in `app/main.py`, next to `quality_eval`; mirror the file-loading + stats-access idioms already used in that section)

```python
@app.get("/quality/accuracy", tags=["quality"])
async def quality_accuracy():
    """Measured accuracy from the latest hand-labeled audit (static, dated)
    plus today's live pipeline counters. Methodology: docs/METHODOLOGY.md."""
    import json as _json
    from pathlib import Path as _Path
    audit_path = _Path(__file__).resolve().parent.parent / "data" / "accuracy_audit.json"
    audit = _json.loads(audit_path.read_text()) if audit_path.exists() else {"error": "no audit on disk"}
    from . import monitor as _monitor
    live = {k: _monitor._stats.get(k) for k in (
        "messages_today", "cp_messages_seen_today", "cp_whitelist_miss_today",
        "security_seen_today", "security_discarded_today")}
    return {"audit": audit, "live": live, "docs": "/docs/ACCURACY.md"}
```

(If `/health` accesses the counters through a public accessor instead of `_stats`, use that accessor — match the existing idiom, don't invent a second path.)

- [ ] **Step 4: Copy the numbers file + run tests**

```bash
cp analysis/audit-2026-07-19/accuracy_numbers.json services/westbank-alerts/data/accuracy_audit.json
cd services/westbank-alerts && .venv-audit/bin/python -m pytest test_quality_accuracy.py -q && .venv-audit/bin/python -m pytest test_v2_feeds.py -q
```

Expected: new test PASS; v2 suite still green.

- [ ] **Step 5: Commit** (deploy of this endpoint rides with Plan B's first deploy — no solo prod deploy for it)

```bash
git add services/westbank-alerts/test_quality_accuracy.py services/westbank-alerts/app/main.py services/westbank-alerts/data/accuracy_audit.json
git commit -m "audit(tier1): /quality/accuracy — measured numbers served live"
```

---

### Task 13: SOURCES-SHORTLIST.md — expansion inputs for Plan B

**Files:**
- Create (committed): `analysis/audit-2026-07-19/SOURCES-SHORTLIST.md`

**Interfaces:**
- Consumes: `snapshot/corpus/discovery.json` (Task 4 `--discover` output: username, title, participants, matched_query, last_post), M6 channel scorecard (dead channels to replace), M2 governorate gaps.
- Produces: the vetted candidate list Plan B's shadow-ingest phase starts from.

- [ ] **Step 1: Build the shortlist** — for each discovery candidate: participants, last_post recency, governorate/topic guess from title, and a KEEP/SKIP verdict with one-line reason. Cross-reference M6: every DEAD monitored channel gets a replacement candidate or an explicit "no replacement found". Add the non-Telegram queue from the spec (WAFA/Quds/Ma'an wires, OCHA flash, PRCS) each with URL + feed format + cadence checked (fetch each once to confirm it's parseable — record the HTTP status and format seen).

- [ ] **Step 2: Commit**

```bash
git add analysis/audit-2026-07-19/SOURCES-SHORTLIST.md
git commit -m "audit(tier1): source-expansion shortlist (discovery + gap-driven)"
```

---

## Self-review checklist (run after writing, before executing)

1. **Spec coverage:** Phase 0 → Tasks 1–4; M1–M8 → Tasks 5–9; Phase 2 gate → Task 10; Phase 5 artifacts → Tasks 11–12; Phase 4 measurement half → Tasks 4 (discovery) + 13. Phase 3 + Phase 4 build half → Plan B (explicit, by design). Phase 6 (Gaza sketch) → already in the spec itself, no task needed.
2. **Placeholder scan:** done — every script is complete; the two "hand-X" steps (labeling, top-40 classification) are real executor actions, not deferred work.
3. **Type consistency:** `replay.jsonl` record shape defined in Task 5 and consumed by name in Tasks 6–7; `accuracy_numbers.json` schema defined in Task 6, consumed in Tasks 11–12.
