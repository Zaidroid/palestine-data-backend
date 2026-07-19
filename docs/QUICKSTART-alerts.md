# Quickstart: live West Bank alerts + checkpoints

The live tracker at `https://wb-alerts.zaidlab.xyz` monitors Palestinian
Telegram news channels every ~5 seconds, classifies events into structured
alerts (raids, settler attacks, road closures, sirens, strikes…), tracks
checkpoint status crowd-sourced from drivers, and pushes everything to
subscribers in real time.

## 1. What's happening right now

```bash
curl -s https://wb-alerts.zaidlab.xyz/alerts/latest | jq
curl -s https://wb-alerts.zaidlab.xyz/checkpoints/summary | jq
```

The checkpoint summary is the headline feature: live open/closed/congested/
IDF-presence status for ~300 West Bank checkpoints, refreshed continuously.

```bash
# One checkpoint's recent status history
curl -s "https://wb-alerts.zaidlab.xyz/checkpoints" | jq '.checkpoints[0]'
curl -s "https://wb-alerts.zaidlab.xyz/checkpoints/<key>/history?from=2026-06-01"
```

## 2. Subscribe to the live stream (SSE — works from any terminal)

```bash
curl -N https://wb-alerts.zaidlab.xyz/stream
```

Events arrive as JSON lines: `{event: "alert", data: {...}}` with a
heartbeat every 25s. Checkpoint changes stream at `/checkpoints/stream`.

JavaScript:

```js
const es = new EventSource('https://wb-alerts.zaidlab.xyz/stream');
es.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.event === 'alert') console.log(msg.data.type, msg.data.area, msg.data.title);
  if (msg.event === 'correction') console.log('RETRACTION/EDIT for', msg.data.id);
};
```

WebSocket lives at `wss://wb-alerts.zaidlab.xyz/ws`.

## 3. Trust signals — read them

Every alert carries:

- `confidence` (0–1): blend of source reliability, severity, locality
  clarity. Filter server-side: `/alerts?min_confidence=0.8`.
- `source_reliability` (0–1): per-channel baseline, published at
  `/channel-reliability`.
- `status`: alerts can be `retracted` or `corrected` after publication —
  a `correction` event is pushed to every live subscriber. Honor it.

The classifier's false-positive test suite runs **publicly** at
`/quality/eval` — you can audit our accuracy without asking us.

## 4. Webhooks (for services)

```bash
curl -s -X POST https://wb-alerts.zaidlab.xyz/webhooks \
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"url": "https://your.app/hook", "alert_types": "idf_raid,settler_attack", "zones": "north", "confidence_min": 0.7}'
```

Filters: `alert_types`, `min_severity`, `areas` (city/camp names),
`zones`, `confidence_min`. Deliveries are HMAC-signed and retried.

## 5. Historical context

The same host serves the long-term entity databank built from this feed +
curated sources — e.g. `GET /databank/people_killed?from=2002-03-01&to=2002-05-01&region=West%20Bank`
(70k+ named individuals, 2000 → present: B'Tselem + Tech4Palestine).
For the full historical databank (14 categories, 1948 → present) see
`https://api.zaidlab.xyz` and QUICKSTART-databank.md.

Note the auth header here is `X-API-Key` (admin/webhook routes only —
reading alerts is public); the databank API at api.zaidlab.xyz uses
`Authorization: Bearer` keys.

## 6. How accurate is this?

Accuracy is measured, not asserted. See:
- **`METHODOLOGY.md`** — how the feed is produced, classified, and served (whitelist-first
  detection, source trust, consensus + freshness, known limitations).
- **`ACCURACY.md`** — the latest measured numbers (classifier precision by type, checkpoint
  agreement, provenance completeness, freshness reality), including the weak spots.
- **`GET /quality/accuracy`** — those numbers served live, with today's pipeline counters.
- **`GET /quality/eval`** — runs the classifier FP-fixture suite on demand.
