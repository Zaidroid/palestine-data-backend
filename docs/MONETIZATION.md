# Monetization — Decision Memo

**Decided 2026-07-08 (Zaid + Claude). Model: ACLED-style — public access free forever;
organizations pay for granularity, freshness, SLA, and support.** This memo is the
canonical reference for any model or person doing revenue work on this product.
Research basis: primary-source sweep 2026-07-08 (rails, comparables, grants); the three
load-bearing claims (Paddle country policy, Liveuamap pricing, OTF terms) were
independently re-verified. Unverified items are marked and listed in §8.

## 1. The decision

- The **free public tier is immutable**. It exists because the data should exist. It is
  also the marketing: every paying customer discovers the product through it.
- Revenue comes from **organizations** buying convenience and reliability, not from the
  data itself (most sources are open; what's sold is the engineering: unified schema,
  provenance, validation, freshness, alerts, support).
- **No self-serve checkout is required to start.** Institutions pay wire invoices as
  normal procurement (UNDP/World Bank standard: net-30 against invoice). P5's job is a
  pricing page + request-access flow + manual key issuance — not Stripe.
- **Grants are the parallel lane and the realistic big money** — one OTF award
  ($50k–200k sweet spot) dwarfs years of subscription revenue. Both lanes reuse the
  same positioning: verified, provenance-first Palestine data infrastructure.

## 2. Who pays — and who never will

| Segment | Pays? | What they buy |
|---|---|---|
| Newsrooms / data journalists | YES — the first market | API access, alert feeds, custom extracts on deadline |
| University labs / researchers | YES (grant-funded budgets) | Full-granularity historical data, stable IDs, citations |
| Risk-intel / security firms | YES (highest willingness) | Real-time alerts, SLA — the gap under Dataminr's ~$20k/yr floor |
| Commercial users of the free tier | YES via license clause | ACLED-style: "commercial use requires a license" |
| Field NGOs / humanitarian orgs | NO — never charge them | INSO norm: donor-subsidized safety data is free to NGOs. Charging them poisons the mission and the brand. Their HQs/donors may fund custom work instead. |
| Individuals / activists / Palestinians | NO — free forever | The point of the whole thing. |

## 3. Tiers and prices (anchored to Liveuamap's verified $150/mo API Pro)

| Tier | Price | What's in it |
|---|---|---|
| **Public** | Free | Current public behavior: aggregated data, standard rate limits, attribution required. Never degrades. |
| **Researcher** | Free, registered | Full granularity for academic/journalistic use, higher rate limits, citation requirement. (Registration = the lead-generation funnel.) |
| **Organization** | **$99/mo** intro → $150/mo list | Full granularity + freshness, priority rate limits, email support, invoice billing. |
| **Org + Alerts** | **$199/mo** | Organization + real-time alert feeds (webhook/email) from the alerts service, best-effort SLA. |
| **Enterprise / custom** | from **$500/quarter** | Custom extracts (Parquet/CSV drops), commercial license, integration help, named support. |

Billing quarterly by default (amortizes the ~$30 SWIFT fee to <5% of invoice value).
First 3 customers get founding-org pricing locked for a year — in exchange for a named
testimonial and permission to list them.

## 4. Billing mechanics (ranked rails — West Bank reality)

1. **Invoice + SWIFT USD wire** (primary): Bank of Palestine / Arab Bank hold US
   correspondent relationships. Institutions treat wire-against-invoice as default
   procurement. Invoice template: P5-PLAN.md §3. *Risk to watch: correspondent-bank
   de-risking (the Israeli indemnity waiver had only short rolling extensions into
   March 2026 — status beyond that UNVERIFIED).*
2. **Paddle** (merchant of record — self-serve card payments): the ONE MoR whose
   official unsupported-countries list does NOT exclude Palestine; pays out via SWIFT
   or Payoneer. **Action: open the account and pass KYC before relying on it
   (UNVERIFIED for a West Bank ID — this is the empirical test).**
3. **Request Finance** (crypto invoicing, non-custodial → self-custody wallet → local
   USDT OTC): the hedge if correspondent banking degrades. Palestine absent from its
   restricted list (KYC UNVERIFIED). Avoid custodial exchanges (documented Palestinian
   account freezes at Binance/Wise).
4. **Blocked — do not build on:** Stripe, PayPal, Payoneer-direct, Wise, Lemon Squeezy,
   Gumroad, GitHub Sponsors. (Post-Egyptian-citizenship: Polar.sh and Freemius open up.)

## 5. Grants lane (do these regardless of sales)

| Grant | Size | Status | Action |
|---|---|---|---|
| **OTF Internet Freedom Fund** | $50k–200k sweet spot | Rolling, monthly review; individuals eligible; Global South preference | **Submit concept note now** — the single highest-EV action in this memo |
| **NLnet Commons Fund** | €5k–50k | Open call reopens after summer 2026 | Prepare application; frame the "European dimension" (EU researchers/newsrooms use the API) |
| **Meedan Independent Media Response Fund** | ~$5k | 2026 cycle UNVERIFIED | Email CGMRF@Protonmail.com — quick win if open |
| ARIJ investigative grants | ~$2.5k | Rolling | Pitch with a journalist partner |
| Pulitzer Center data journalism | $5–10k+ | Rolling | Needs journalist partner + outlet — pursue via first newsroom customer |

**Enablers first:** register the project as a **Digital Public Good** and get fiscal
hosting via **Open Source Collective** (solves the no-legal-entity problem for grants;
confirm PS payout with OSC support before relying — UNVERIFIED). Dead ends checked and
closed: Prototype Fund (DE residency), GNI (dormant), Mozilla/MOSS (hiatus), Code for
Africa (Africa-only), Sloan/Ford DIF (closed).

## 6. Ethical guardrails (non-negotiable)

1. Public tier never shrinks to push upgrades. Paid tiers ADD (freshness, granularity,
   SLA, support) — they never subtract from public.
2. Source-trust policy (docs/DATA_SOURCES.md) applies identically to all tiers. No
   paid-only "exclusive data" that compromises verification standards.
3. Never charge field NGOs or individuals. Commercial-license clause targets companies
   profiting from the data, ACLED-style.
4. No customer gets influence over what data is collected or published. Editorial
   independence is the product.
5. Licensed-operator registration (مشتغل مرخص) BEFORE the first invoice (Decision Log
   2026-07-06 — same rule as the donor-reporting company).

## 7. First three customers — the outreach plan

Positioning line: *"The only unified, provenance-first API for Palestine data — 132k+
verified records, 1948→present, plus real-time West Bank alerts. Built and operated
from Ramallah."*

1. **A data-journalism desk** covering Palestine (e.g., the teams behind existing
   trackers at major outlets, or agencies like AFP/Reuters graphics desks). Entry:
   the journalist who already cited/used palboard or the tracker. Offer: founding-org
   $99/mo + a custom extract free in month one.
2. **A university lab / research institute** doing conflict quantification (peace &
   conflict studies programs, MENA centers). Entry: cold email with the QUICKSTART +
   a citation-ready dataset sample. Their grant budgets pay for exactly this.
3. **A risk-intelligence shop** covering the region (the tier below Dataminr). Entry:
   the alerts feed demo — 302 live checkpoints is something they cannot buy elsewhere
   at this price.

Sequence: pricing page live → OTF concept note submitted → 10 targeted emails (not
mass) → first invoice. Every outreach email logs `pitch | pdb <org>` in LifeOS.

## 8. Unverified — test empirically before relying

- Paddle KYC with West Bank ID (open account = the test)
- Request Finance KYC for PS individuals
- OSC payout to a Palestinian bank
- Meedan IMRF 2026 cycle open?
- Correspondent-banking/indemnity-waiver status after March 2026
- FastSpring / 2Checkout signup reality (backups only)
