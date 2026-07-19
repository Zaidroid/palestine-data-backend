# For risk-intelligence & security operations

**Real-time West Bank ground truth — structured, geolocated alerts and ~245
live checkpoints — at a fraction of the enterprise-feed floor.**

## The problem you have

Duty-of-care and regional desks need to know *now* when a road closes, a raid
starts, or a checkpoint shuts — and where. Dataminr-class feeds start around
$20k/yr and still miss Palestinian-channel signal. Raw Telegram is unstructured,
Arabic-first, and full of noise, commentary, and reposts.

## What you get

- **Structured real-time alerts.** Raids, settler attacks, demolitions, road
  closures, sirens, Gaza strikes — classified from Palestinian channels every
  ~5s, geolocated (lat/lon + precision), typed and severity-scored, each with
  the original source message id.
- **~245 live West Bank checkpoints** with crowd-sourced status (open / closed /
  congested / IDF-present), **freshness-qualified** — a status is never shown
  without its age and trust, so you don't act on stale "open".
- **Push delivery, filtered.** Webhook (raw JSON or Slack/Discord), HMAC-signed,
  retry-with-backoff, filtered to your types/severities/areas — plus
  correction/retraction events to update your board in place.
- **Route-safety layer.** Check whether a planned route crosses a currently
  closed or restricted checkpoint (`/v2/route`, city-gateway model).
- **Published precision.** `/quality/accuracy`: ~85% default-feed precision,
  ~100% on the ground-event core (raids/strikes/flying checkpoints). You know
  the signal quality before you rely on it.

## Why it's different

Signal no enterprise feed carries at this price: 245 live checkpoints and
Palestinian-channel ground truth, structured and geolocated, with the noise
already filtered and the accuracy published. Built and operated from Ramallah.

## Price

**Organization + Alerts $199/mo** — org data access + real-time webhook/digest
delivery + commercial license + best-effort delivery SLA. **Enterprise from
$500/quarter** — custom extracts, named support, integration help. Trial key +
live webhook demo within two working days.

## Start

`api.zaidlab.xyz/pricing.html` · quickstart: `QUICKSTART-alerts.md` ·
accuracy: `ACCURACY.md`, `/quality/accuracy` · questions: `zaidsalem@live.com`
