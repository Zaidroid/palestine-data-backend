# For university labs & research institutes

**Citable, reproducible Palestine data infrastructure — unified schema, stable
ids, pinned snapshots, published provenance and accuracy.**

## The problem you have

Conflict-quantification and MENA research burns weeks on data engineering:
reconciling ACLED, OCHA HAPI, UNHCR, IDMC, World Bank, PCBS into one comparable
schema, chasing coordinate precision, and documenting provenance well enough to
survive peer review. Then a source revises and your figures no longer reproduce.

## What you get

- **22 unified categories, 1948 → present**, one schema (`schema_version`),
  deduplicated, with normalized admin levels and coordinate precision flags.
- **Reproducibility built in.** Stable per-record ids, per-record permalinks,
  and **pinned daily snapshots** (`/snapshots?as_of=YYYY-MM-DD`) so a paper's
  figures reproduce exactly, years later.
- **Full provenance + license registry.** `/api/v1/sources` (every upstream,
  cadence, coverage, freshness) and `/api/v1/licenses` (per-source terms,
  commercial/non-commercial) — methods-section-ready.
- **Measured accuracy, published.** `METHODOLOGY.md` + `/quality/accuracy`:
  precision/recall by event type, method disclosed, limitations stated.
- **Time-series + event-cluster endpoints** for panel construction and
  place-week aggregation.

## Why it's different

We publish our error rates and our method, and we pin snapshots for
reproducibility — the things a reviewer asks for and most sources can't provide.
Provenance-first by design.

## Price

**Researcher — free, registered** (full granularity, higher limits, citation
requirement). **Organization $99/mo intro** when a grant budget covers
production use, custom extracts, and the commercial/redistribution license.
Grant-funded labs: ask about a citation-ready dataset sample for your proposal.

## Start

`api.zaidlab.xyz/pricing.html` · quickstart: `QUICKSTART-databank.md` ·
data sources + licensing: `DATA_SOURCES.md`, `/api/v1/licenses` ·
questions: `zaidsalem@live.com`
