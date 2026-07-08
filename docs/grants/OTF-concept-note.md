# OTF Internet Freedom Fund — Concept Note (ready to paste)

Submit at: apply.opentech.fund (Internet Freedom Fund, rolling — concept notes
reviewed monthly). Fields below map to their form. Paste-ready; ⟨FILL⟩ = only
Zaid can supply. Log on submission: `pitch | grant OTF concept note`.

---

**Project title:** Palestine Open Data Infrastructure — verified, provenance-first
access to civic and safety information

**Applicant:** Zaid Salem (individual; Ramallah, West Bank). Fiscal hosting via
Open Source Collective ⟨FILL: in progress / confirmed⟩.

**Amount requested:** $92,000 · **Duration:** 12 months

**Synopsis (~150 words):**
Palestinians navigate daily life through fragmented, unverifiable information:
safety-critical movement conditions circulate across dozens of informal Telegram
channels, while decades of human-rights and humanitarian data sit in incompatible
silos, effectively inaccessible to the public that lives inside those numbers.
This project maintains and hardens two live, open systems built and operated from
Ramallah: (1) a real-time West Bank alerts platform that ingests 17+ Arabic-language
channels, classifies and geocodes reports with strict false-positive control, and
serves a free public map with checkpoint-aware routing; and (2) a unified open
databank — 132,000+ verified records, 1948→present, across 14 categories — with
per-record provenance, cross-source validation, and a free public API. Funding
converts a working one-person system into resilient public infrastructure:
expanded verified sources, offline-capable clients for connectivity crises, a
security audit, and sustainability through an organizational-subscriber model
that keeps public access free forever.

**The problem (internet freedom relevance):**
- **Access to information under movement restriction:** checkpoint and road
  conditions determine daily safety for millions, yet exist only as unstructured
  rumor across informal channels. Verified, structured, freely accessible
  movement data is an information-access problem, not a convenience.
- **Information integrity:** contested casualty figures and event narratives are
  a disinformation battleground. Per-record provenance, published validation
  checks, and a codified source-trust policy (primary documents > scholarship >
  aggregators) make verification inspectable by anyone.
- **Resilience:** connectivity in Palestine degrades precisely when information
  matters most. The architecture (pre-baked static datasets + live API) already
  tolerates outages; this project extends it to offline-first clients.
- **Data sovereignty:** the platform is built, hosted, and governed from
  Palestine, on infrastructure the maintainer operates — not dependent on any
  platform that has frozen or excluded Palestinian accounts.

**What exists today (all live, verifiable):** api.zaidlab.xyz (databank API +
docs + public status page), palboard.net (public explorer), live.zaidlab.xyz
(alerts map). Open source; nightly refresh pipeline; tiered API keys; cross-source
validation that has caught real upstream errors; ~300 checkpoints tracked live.

**Objectives & activities (12 months):**
1. **Harden the alerts pipeline** — redundancy for ingestion, rate limiting,
   monitoring, and a documented failover runbook (M1–3).
2. **Expand verified sources** — B'Tselem live fatalities, OCHA demolitions,
   PCBS census layers, UNOSAT damage assessments; each with provenance and
   validation gates (M2–8).
3. **Offline-capable public clients** — installable PWA with cached datasets
   and delta sync for low/no-connectivity use (M4–9).
4. **Independent security audit** of the public services and operational
   practices, with published remediations (M6–9).
5. **Bilingual documentation & community onboarding** (Arabic/English) so
   journalists, researchers, and developers can self-serve (M3–12).
6. **Sustainability:** organizational subscriptions (newsrooms, research labs)
   under an ACLED-style model — public tier free forever, institutions fund
   operations (M1–12, policy already published).

**Beneficiaries:** Palestinian residents making daily movement decisions;
Arabic- and English-language journalists; human-rights researchers and
academics; humanitarian responders; the broader open-data community.

**Budget sketch:** lead developer/maintainer (majority allocation, 12 mo) ·
part-time data verification/QA · infrastructure and hosting · independent
security audit · documentation/translation · fiscal-host fee.

**Why us:** the systems are already built and running in production under real
constraints — this is a maintenance-and-hardening grant for working public
infrastructure with demonstrated uptime, not a proposal to build something new.

**Risks & mitigations:** platform account exclusion (self-hosted core, no
critical dependency on excluded platforms) · connectivity loss (static-bake +
offline clients) · single-maintainer risk (this grant funds documentation,
runbooks, and QA redundancy — reducing exactly that risk).

---

*Prep before submitting (10 min):* confirm OSC fiscal-hosting status line,
attach links, and read the current IFF guidebook page once for any new fields.
