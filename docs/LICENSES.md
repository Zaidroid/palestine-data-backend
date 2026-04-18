# Upstream Source Licenses

This document summarises the redistribution and commercial-use terms for every upstream data source the Palestine Data API ingests. The same information is served machine-readably at `GET /api/v1/licenses` and at `GET /api/v1/licenses/:source_id`.

Entries flagged **verify_required: true** have not been fully confirmed with the source operator and must be reviewed before the data is exposed to paid-tier customers. See `docs/COMPLIANCE.md` for the per-source compliance decisions that gate paid routing.

> **Customer obligation:** consumers of the paid API must reproduce the `attribution_text` for each source whose data appears in a response. The required strings are returned inline in the `sources[]` field on every record and summarised below.

---

## Open / commercially redistributable (high confidence)

| Source | License | Attribution |
|---|---|---|
| `tech4palestine` | CC-BY-4.0 | Data: Tech4Palestine (data.techforpalestine.org), licensed CC-BY-4.0. |
| `worldbank` | CC-BY-4.0 | Data: The World Bank (data.worldbank.org), licensed CC-BY-4.0. |
| `ocha` | CC-BY 3.0 IGO | Data: UN OCHA oPt (ochaopt.org), licensed CC-BY 3.0 IGO. |
| `unesco` | CC-BY-SA 3.0 IGO | Data: UNESCO (whc.unesco.org), licensed CC-BY-SA 3.0 IGO. Share-alike applies to derivatives. |

## Non-commercial — gated out of paid tier by default

| Source | License | Notes |
|---|---|---|
| `who` | CC-BY-NC-SA 3.0 IGO | Paid-tier responses either exclude WHO records or require a separate WHO licence. |
| `btselem` | CC-BY-NC 4.0 | Paid-tier responses exclude B'Tselem-origin records or require a commercial permission. |

## Headlines-only (news RSS)

Headlines and source links are redistributed under fair-use; full article text is **not** included. Commercial redistribution requires a separate content agreement with the publisher.

- `al_jazeera_rss`, `reuters_rss`, `wafa_rss`, `un_news_rss`

## Varies / verify required

These sources aggregate multiple datasets or have per-dataset licensing. Each ingested dataset is reviewed individually before paid-tier exposure.

- `hdx` — HDX hosts datasets under CC-BY, CC-BY-IGO, CC0, ODC-BY, and others.
- `goodshepherd` — license not publicly stated; verification pending.
- `pcbs` — public statistics; verify per dataset.
- `unrwa` — UN attribution; commercial use varies.
- `gaza_moh` — public health record; verification pending.
- `historical_archives` — per-record source recorded in `sources[]`.

---

## Machine-readable registry

The authoritative registry lives at [`src/api/data/licenses.json`](../src/api/data/licenses.json) and is served at:

- `GET /api/v1/licenses` — full registry
- `GET /api/v1/licenses/:source_id` — single entry

CI asserts every `source_id` referenced in any record's `sources[]` array resolves in this registry; new sources must be added here before their data can flow through the pipeline.

## Updating

When adding a new upstream source:

1. Add an entry to `src/api/data/licenses.json` with `license_id`, `attribution_text`, `redistribution_allowed`, `commercial_use`, and `verify_required`.
2. Add a row to the table above.
3. If paid-tier gating is needed (e.g. non-commercial), add a decision row to `docs/COMPLIANCE.md`.
