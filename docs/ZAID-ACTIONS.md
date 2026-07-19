# Zaid-gated actions — the path to first revenue

Everything a model **cannot** do for you, consolidated from the ACLED-packaging
run (2026-07-20). Ordered by leverage. Companion to [`P5-PLAN.md`](./P5-PLAN.md),
[`MONETIZATION.md`](./MONETIZATION.md), [`PACKAGES.md`](./PACKAGES.md). The
engineering (tiers, funnel, packages, audit) is done and committed on `main`,
unpushed — see "Deploy" below.

---

## 0. Deploy Phase 1 (make the tiers real) — NOW, ~10 min

Local `main` has 6 commits ready (rate limiting, access-request funnel, packages,
grant refresh, Tier 2 encoding fix, Gaza spec). Run these (verify between each):

```
! cd ~/Zlab/palestine-data-backend && git push origin main
! ssh zaid@100.99.243.75 "bash /opt/stacks/palestine/deploy.sh"
! curl -sS https://wb-alerts.zaidlab.xyz/health && echo
! curl -sS -D- -o/dev/null https://wb-alerts.zaidlab.xyz/alerts/latest | grep -i x-ratelimit
```

**Set the ntfy topic** so access requests hit your phone (the endpoint stores the
request either way, but skips the push until this is set). On the databank
container's env (`/opt/stacks/palestine/docker-compose.override.yml`, the
`api`/`palestine-data-api` service), add:

```
- NTFY_TOPIC=<your-ntfy-topic>
# optional if self-hosted: - NTFY_URL=https://ntfy.yourhost
```
then `docker compose up -d --force-recreate api`.

**Verify the funnel end-to-end:**
```
! curl -sS -X POST https://api.zaidlab.xyz/api/v1/access-request -H 'Content-Type: application/json' -d '{"email":"you@example.com","org":"self-test","tier":"organization","use_case":"deploy smoke test"}'
```
Expect `{"ok":true,...,"notified":true}` and an ntfy push. Then open
`https://api.zaidlab.xyz/pricing.html` and submit the form once.

**Watch after deploy:** confirm the public live map (live.zaidlab.xyz) still loads
— rate limiting is per-visitor (X-Forwarded-For), so it should; if the map 429s,
cloudflared isn't passing XFF and the anonymous ceiling needs raising in
`services/westbank-alerts/app/tiers.py`.

---

## 1. Legal + billing rails — HARD GATES before the first invoice

1. **Licensed-operator registration (مشتغل مرخص)** — REQUIRED before invoicing
   (Decision Log 2026-07-06). Status unconfirmed; this is the true blocker on
   revenue, not engineering. Confirm/complete.
2. **Paddle KYC test** — open a Paddle account with West Bank details; PASS/FAIL
   is the data point (self-serve card payments depend on it).
3. **Request Finance** — open an account (crypto-invoicing hedge).
4. **Bank of Palestine / Arab Bank** — confirm inbound-USD-SWIFT cost + compliance
   questions for service income.
5. **Revoke the test key** before the first real customer:
   `docker exec palestine-data-api node scripts/manage-keys.js` — revoke
   `pdb_live_5044…d846` (ngo tier, in prod keys.db).

## 2. Grants — highest EV, parallel to sales

1. **Submit the OTF concept note** — `docs/grants/OTF-concept-note.md` is refreshed
   with the current numbers (295k records, published accuracy, enforced tiers).
   Fill the one ⟨FILL⟩ (OSC status), then submit at apply.opentech.fund.
2. **Register as a Digital Public Good** (digitalpublicgoods.net).
3. **Open Source Collective fiscal hosting** — apply; ask support explicitly about
   payout to a Palestinian bank before relying on it.
4. **Meedan IMRF** — send the paste-ready email in `docs/grants/GRANTS-PACK.md`.

## 3. Data pipeline refreshes (Tier 2 audit remediation)

From `analysis/databank-audit-2026-07-20/FINDINGS.md`:

1. **Flush the westbank mojibake** (fix is committed): re-run the West Bank
   shapefile fetch → re-populate → deploy, so served Arabic is clean.
   `npm run fetch:westbank` (or the pipeline equivalent) then the unified rebuild.
2. **Refresh stale categories:** `settlements` (931d), `aid_access` (549d),
   `pcbs` (564d) most; `health`/`food` moderate.
3. Optional: decide the annual-bucket date convention (D3) so future-dated
   annual rows stop inflating `date_range.latest`.

## 4. Gaza live — approve the spec + provide inputs

`docs/superpowers/specs/2026-07-20-gaza-live-design.md` is ready for review. To
unblock the build round, provide (§9):

1. **Gaza Telegram channel list** to whitelist (needs your Telegram account).
2. Confirm **OCHA / WHO / UNRWA** facility/shelter/zone datasets are fetchable +
   their licenses.
3. Pick the **evacuation-order source(s)** to trust.
4. Confirm the v1 scope (casualties + facility-status + evacuation; defer
   aid-convoy/displacement to v2).

## 5. Checkpoint accuracy (in progress) — resident confirmation

Task #33. Batch 1 (top 15 checkpoints by report frequency) was presented and
awaits your coordinate corrections. Then: apply as `geo_precision: checkpoint`,
re-seed, continue batches; merge the 4 duplicate pairs; fix the
`كراميلو الطيبه` coord (~70km off — should be Jericho المعرجات, not Jenin lat).

## 6. Outreach — the funnel bottleneck ("Zaid sending, not systems")

Once §0–1 are done, send **10 targeted emails** (not mass) using the sell sheets
in `docs/sell-sheets/`:

- **Newsroom** (`newsroom.md`) → a data-journalism desk covering Palestine.
- **University lab** (`university-lab.md`) → a conflict-quantification / MENA lab.
- **Risk-intel** (`risk-intel.md`) → a regional risk shop (lead with the live
  webhook demo — 245 checkpoints is the thing they can't buy elsewhere).

First 3 customers: founding-org $99/mo locked 12 months for a named testimonial.
Log each: `pitch | pdb <org>`.
