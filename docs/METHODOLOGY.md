# Methodology — West Bank Live Tier

How the live West Bank checkpoint + alerts feed is produced, classified, and served.
This is the reference customers cite. Companion: `ACCURACY.md` (measured numbers) and
`DATA_SOURCES.md` (source-trust policy).

## 1. Pipeline

```
Telegram channels + RSS feeds
        │  (poll)
        ▼
 dedup (id + content-hash)
        │
        ├─ security path ──►  is_security_relevant → classify (tier-1: sirens/strikes)
        │                     └─ else → classify_wb_operational (tier-2: raids, settler
        │                        attacks, demolitions, arrests, closures, checkpoints)
        │                     → Alert (type, severity, area, provenance)
        │
        └─ checkpoint path ─►  parse_checkpoint_message (whitelist-first, strict)
                               → per-(checkpoint,direction) status with trust + freshness
        ▼
 consensus + freshness decay  →  serving (/checkpoints, /v2/*, alert feed, SSE)
```

- **Sources.** Checkpoint channels (road/traffic Telegram channels) and security/news
  channels + RSS wires. The live monitored set is stored in the `channels` table and the
  RSS registry, each with a curated trust prior (`channel_reliability`, see §3).
- **Dedup.** Every message is deduplicated by source + external id and by content hash,
  so reposts and cross-channel copies do not double-count.

## 2. Checkpoint detection — whitelist-first (strict-or-nothing)

Checkpoint status is only ever emitted for checkpoints already in the curated catalog
(`known_checkpoints.json`, 234 entries). A message naming a checkpoint not in the catalog
produces **nothing** — it is captured as a *candidate* for human review, never served.

This is deliberate. An earlier permissive parser minted user statements
("they-opened-the-checkpoint") as their own checkpoints; the whitelist-first rule
(shared strict parser for both the live monitor and startup catch-up) makes that class
of error impossible. New checkpoints enter the catalog only through the
candidate → vet → promote review loop.

Coordinates come only from authoritative geodata (OpenStreetMap, resident confirmation) —
never from an LLM.

## 3. Source trust

Each channel carries a trust prior (`channel_reliability`), assigned from what the source
is: official agencies (WAFA 0.9, PA/IDF communiqué aggregators 1.0) rank above high-volume
aggregators (0.7–0.8) above framing-biased wires (RT 0.45). Trust priors combine with
report recency and cross-channel corroboration at serving time. The full source-trust
policy — primary docs > scholarship > aggregators — is in `DATA_SOURCES.md`.

## 4. Consensus and freshness

For each checkpoint direction, recent reports are combined with a recency (freshness)
decay so the served status reflects the most current corroborated picture. Every served
status carries:

- `freshness.age_hours` and a `freshness_band` (live / recent / stale / none),
- `source_trust` (the report's channel trust),
- full `provenance` (source channel, message id, timestamp).

Permanent closures (e.g. Huwara, closed since 2023-10) are encoded as
`permanent_status` and override live reports via `effective_status`.

## 5. Serving surfaces

- `/checkpoints`, `/checkpoints/summary`, `/checkpoints/stats` — v1 checkpoint state.
- `/v2/checkpoints`, `/v2/incidents`, `/v2/cities`, `/v2/route` — normalized v2 feed with
  freshness bands, source-trust, provenance, and `effective_status`.
- Alert feed + SSE — real-time security/operational events.
- `/quality/eval`, `/quality/checkpoints`, `/quality/accuracy` — self-audit endpoints
  (run the same fixtures CI runs; serve the measured accuracy numbers from `ACCURACY.md`).

## 6. Known limitations (see ACCURACY.md for numbers)

- **Crowd data is mostly not real-time-fresh.** At any moment most checkpoints were last
  reported hours ago; the freshness fields make this explicit. Consumers should read
  `age_hours` / `freshness_band`, not just the status.
- **Alert precision varies sharply by type.** Ground-event types (raids, strikes, flying
  checkpoints) are high-precision; siren and regional types currently over-capture events
  outside the West Bank/Gaza. Per-type precision is published in ACCURACY.md.
- **Coverage is bounded by the catalog.** New checkpoints appear as reviewed candidates
  before they are served; the catalog grows through vetting, not automatically.
- **Source geography is MENA-wide.** Some channels report regional (Lebanon/Iran) events;
  these are being separated from the WB/Gaza safety scope.

## 7. Verify it yourself

- `GET /quality/eval` — runs the classifier fixture suite live (FP families).
- `GET /quality/checkpoints` — freshness/coverage metrics.
- `GET /quality/accuracy` — the latest measured accuracy numbers + today's live counters.
- Every record carries its provenance — trace any served value back to its source message.
