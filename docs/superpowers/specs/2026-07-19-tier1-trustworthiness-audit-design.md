# Tier 1 Trustworthiness Audit — Design

**Date:** 2026-07-19
**Scope decided with Zaid:** Harden the existing West Bank live tier (services/westbank-alerts) to
data-trustworthiness quality first; Gaza live coverage is designed here but built in a later round.
Commercial plumbing (rate limiting, request-access form, digests) is explicitly a later round.
**Approach decided:** Measure-first audit — no fix ships without a measured problem behind it.

## Why (context)

The product's revenue model is ACLED-style (docs/MONETIZATION.md): public free forever, orgs pay
for reliability and support. ACLED's moat is published methodology and verifiable accuracy —
trust IS the product. Today the live tier is healthy and ingesting (~1,100+ msgs/day) but its
actual accuracy is unmeasured: on 2026-07-19, 626 of 867 checkpoint messages (72%) missed the
whitelist and 557 of 632 security messages (88%) were discarded, and nobody can currently say
whether those rates are healthy noise rejection or product-breaking gaps. June's audit numbers
predate three pipeline phases (per-channel trust, consensus/freshness decay, noise-robust name
recovery), so they are stale.

## Phase 0 — Ground-truth snapshot (read-only)

Pull from .114 into `analysis/audit-2026-07-19/` locally:

- Copies of `/opt/stacks/palestine/services/westbank-alerts` live DBs: `checkpoints.db`,
  `alerts.db` (via `scp` of a `sqlite3 .backup` — never the live file mid-write).
- `checkpoint_candidates` table (Phase 3a captures every whitelist miss — the miss stream is
  already persisted).
- Prod's `known_checkpoints.json` and `city_gateways.json`, diffed against the repo copies.
- `/health` and `/quality/checkpoints` snapshots.

Constraints: read-only; no writes to `/opt/stacks/palestine`; never copy Telegram `session/`,
`keys.db`, or `.env`.

## Phase 1 — Eight measurements

Each measurement has a method and produces a number that goes in ACCURACY.md.

| # | Measurement | Method | Output |
|---|---|---|---|
| 1 | Classifier accuracy | Hand-label ~250 recent raw messages across channels (Arabic read directly); compare to classifier output; also re-score the 92-fixture CI set to detect staleness | FP/FN per class |
| 2 | Whitelist-miss composition | Categorize the candidates stream: junk / real-but-uncataloged checkpoint / parse failure | % split + concrete coverage-gap list |
| 3 | Status/consensus correctness | For ~50 checkpoint-hours with multiple reports, does served status match the report stream? | agreement rate |
| 4 | Staleness honesty | Trace every serving path (v1 list/summary/stats, v2, gateways, SSE) for stale-as-live leaks | leak list (target: zero) |
| 5 | Alert discard audit | Sample ~150 discarded security messages for false negatives (missed real alerts = worst failure of a safety product) | FN rate on discards |
| 6 | Channel health | Per-channel volume 30d, dead/dying channels, Phase-1 trust-score sanity | channel scorecard |
| 7 | Provenance completeness | % of served records with full chain (channel, msg id, timestamp, trust) | completeness % |
| 8 | Coordinate spot-check | Re-check the June coordinate fixes + sample for new drift | regression list |

## Phase 2 — Findings report

Findings ranked by **trust impact**: "would a paying analyst catch this and stop trusting us?"
Report presented to Zaid before any fix. Lives in `analysis/audit-2026-07-19/FINDINGS.md`.
The fix cut-off (which findings make this round vs. the backlog) is agreed with Zaid at this
review — not assumed.

## Phase 3 — Ranked fixes with regression gates

- Fixes proceed in ranked order, TDD (superpowers:test-driven-development).
- Every fix lands with a regression test wired into the existing classifier-eval CI gate.
- Deploys to .114 are batched as numbered `!`-prefix commands for Zaid (auto-mode cannot write
  to `/opt/stacks/palestine`); verification between steps per the prod-deploy protocol.

## Phase 4 — Published trust artifacts (the sellable output)

- `docs/METHODOLOGY.md` — source → classification → consensus → serving, the whitelist-first
  detection doctrine, source-trust policy reference, update cadences, known limitations.
- `docs/ACCURACY.md` — this audit's measured numbers, honestly stated including the ugly ones,
  with measurement dates. Re-measured after fixes so before/after is visible.
- Key metrics wired into the live `/quality/checkpoints` endpoint so trust claims are
  verifiable at runtime, not static marketing.

## Phase 5 — Gaza live coverage (design sketch only, built next round)

Reuse the exact trust framework (whitelist-first catalog → classifier → consensus → freshness →
provenance) with Gaza-appropriate sources. Candidate source classes to validate at build time
(none verified yet):

- Telegram: Gaza news channels (high-volume, Arabic; need per-channel trust calibration and a
  Gaza place-name catalog seeded from the existing gazetteer's 5 Gaza governorates).
- Official/institutional: OCHA flash updates & sitreps, PRCS, Gaza MoH statements, UNRWA
  situation reports (slower cadence; high trust; good consensus anchors).
- Wire/news: existing news ingestion extended with Gaza geo-tagging.

Key design difference from WB: no checkpoint catalog — the live entities are incidents,
evacuation orders, aid distribution points, and service status (hospitals, bakeries, water).
The entity catalog concept still applies (known facilities list instead of known checkpoints).

## Success criteria

1. All 8 measurements have numbers in ACCURACY.md.
2. Top-ranked findings fixed, each verified live on .114, each with a CI regression gate.
3. METHODOLOGY.md + ACCURACY.md published on the live docs surface.
4. `/quality` serves the trust metrics live.
5. Gaza build round can start from Phase 5 without new discovery.

## Non-goals (this round)

- Alerts API rate limiting, request-access form, webhook digests, uptime monitoring, billing —
  all deferred to the commercial-plumbing round (P5-PLAN.md).
- Building Gaza ingestion.
- Frontend work (live.zaidlab.xyz).
- Any prod schema/infra migration not required by a ranked finding.
