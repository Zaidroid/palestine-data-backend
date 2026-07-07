# P5 — Productization Plan (for any model to execute)

Companion to `docs/MONETIZATION.md` (the WHY and the prices — read it first).
This is the HOW. Written 2026-07-08. Everything here uses infrastructure that
already exists; verify each claim against the code before building on it.

## What already exists (verified 2026-07-08)

- **Tier enforcement**: `src/api/config/tiers.js` — `anonymous`, `free`,
  `journalist` ($29), `ngo` ($149 sticker), `enterprise`. Rate limits enforced
  per tier via `src/api/middleware/apiKey.js` (auth = `Authorization: Bearer
  pdb_live_…`; the alerts service separately uses `X-API-Key`).
- **Key issuance**: `node scripts/manage-keys.js issue <email> [tier]` — creates
  the customer and prints the key. Run ON MAIN inside the api container
  (`docker exec` into `palestine-data-api`; keys live in `keys.db`, which
  deploys NEVER touch — `scripts/deploy-to-main.sh` excludes it).
- **Stripe billing routes**: `src/api/routes/billing.js` exists but stays
  DORMANT (returns 503 without env keys). Do NOT wire Stripe — it does not
  serve Palestinian accounts. The memo's rails are invoice+SWIFT, Paddle
  (after KYC test), and Request Finance. If Paddle passes KYC, a future
  Paddle-webhook route can mirror billing.js's shape.
- **Pricing page**: `public/pricing.html` (shipped with this plan). Request
  access = mailto for now.
- **Test key to revoke** before first real customer: `pdb_live_5044…d846`
  (ngo tier, in prod keys.db).

## Step 1 — Empirical rail tests (Zaid, ~1h total, this week)

1. Open a Paddle account (paddle.com) with West Bank details. PASS/FAIL is the
   data point. If PASS: card self-serve becomes possible later.
2. Open a Request Finance account (request.finance). Same test.
3. Confirm with Bank of Palestine/Arab Bank what an inbound $300 USD SWIFT
   costs on the receiving end and what compliance questions freelance/service
   income triggers. (Also feeds the freelance lane — same rail.)
Log each result: `papers | rail test: <rail> <pass/fail + notes>`.

## Step 2 — Request-access flow upgrade (any model, ~2h)

Replace the mailto with a small form on pricing.html POSTing to a new endpoint
`POST /api/v1/access-request` (name, org, email, tier, use case) that:
- appends to a `access_requests` table (same SQLite pattern as keyStore),
- fires an ntfy push to Zaid's existing ntfy.sh topic (see homelab-mcp
  `ntfy_send` or plain HTTP POST to ntfy.sh) so requests arrive on his phone.
Keep it dependency-free; rate-limit it like other anonymous endpoints.

## Step 3 — Invoice kit (any model, ~1h)

`docs/invoice-template.md`: header (Zaid Salem, licensed operator no. ⟨FILL
after مشتغل مرخص registration — REQUIRED before first invoice, Decision Log
2026-07-06⟩), line items matching pricing.html tiers, quarterly billing,
IBAN/SWIFT of the receiving account, net-30 terms, USDT wallet as alternate.
Generate per-customer copies into `~/lifeos/drafts/` on main so the LifeOS
pipeline sees them.

## Step 4 — Issuance runbook (document, then it's a 5-min task each time)

On acceptance of an access request:
1. `ssh zaid@100.99.243.75`, `docker exec -it palestine-data-api node
   scripts/manage-keys.js issue <email> <tier>`
2. Email the key + QUICKSTART link + invoice (Step 3).
3. Log `client | pdb key issued: <org> <tier>` to LifeOS.
4. First 3 customers: founding pricing ($99 on ngo tier), noted on invoice,
   testimonial asked at day 30.

## Step 5 — Alerts add-on ($199 tier)

The alerts service (`services/westbank-alerts/`) already supports X-API-Key
auth. To sell it: per-customer webhook or email digest. Simplest honest v1:
a customer-specific ntfy.sh topic bridged from the existing alert stream —
zero new infra. Add rate limiting on the alerts API before selling access
(open item from P5 backlog).

## Step 6 — Grants sprint (Zaid + any model, highest EV)

1. OTF Internet Freedom Fund concept note (rolling, monthly review). Draft
   from MONETIZATION.md §5 + DATA_SOURCES.md trust policy. ~2 pages. Submit.
2. Register the project as a Digital Public Good (digitalpublicgoods.net).
3. Apply for Open Source Collective fiscal hosting; ask support explicitly
   about payout to a Palestinian bank BEFORE relying on it.
4. Email Meedan (CGMRF@Protonmail.com) asking if the 2026 IMRF cycle is open.
Each submission logs `pitch | grant <name>`.

## Step 7 — Ops hardening (background, not blocking sales)

- Backup restore drill: restore `keys.db` + alerts DBs from the 03:15 backup
  onto a scratch path, verify a key authenticates against a local api run.
- Alerts service rate limiting (Step 5 dependency).
- Uptime: status.html is browser-probe only; wire Uptime-Kuma (ThinkPad) to
  probe api + alerts once the box is reachable.

## Order of operations

Step 1 (rails) and Step 6.1 (OTF note) FIRST — both are Zaid-gated and
highest-value. Steps 2–5 are model-executable any time. Nothing here blocks
the freelance lane, which remains the primary income path (LIFE-PLAN-2026).
