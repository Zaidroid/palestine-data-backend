# Quickstart: your first databank query in 5 minutes

The unified databank serves **132,219 records across 14 categories,
1948 → present** at `https://api.zaidlab.xyz/api/v1`. No key is needed to
explore (anonymous tier: 10 requests/min, 1,000/day).

## 1. See what exists

```bash
curl -s https://api.zaidlab.xyz/api/v1/categories
curl -s https://api.zaidlab.xyz/api/v1/quality | jq '.categories.conflict'
```

`/quality` tells you, per category, how fresh the data is and where it has
gaps — the API tells you its own weaknesses.

## 2. Query a category

```bash
# Conflict events in Jenin governorate since 2024, newest first
curl -s "https://api.zaidlab.xyz/api/v1/unified/conflict?admin2=jenin&start_date=2024-01-01&limit=5" | jq '.data[] | {date, event_type, description}'
```

Useful filters on every `/unified/:category`:

| Param | Example | Meaning |
|---|---|---|
| `admin2` | `jenin` | OCHA governorate (exact, case-insensitive) |
| `gazetteer_key` | `jenin_camp` | precise place key (camps ≠ cities) |
| `region` | `West Bank` | coarse region |
| `event_type` | `village_depopulation` | category-specific type |
| `start_date` / `end_date` | `1948-01-01` / `1948-12-31` | date window |
| `fields` | `id,date,location` | sparse responses |
| `as_of` | `2026-06-10` | pinned daily snapshot (reproducible queries) |

Yes, that 1948 example works:

```bash
curl -s "https://api.zaidlab.xyz/api/v1/unified/conflict?event_type=village_depopulation&limit=3" | jq '.data[] | {name: .location.name, date, displaced: .metrics.displaced, sources: [.sources[].organization]}'
```

Every record carries citations (`sources[]`), a permanent id, and shared
geographic keys.

## 3. Follow the connections

```bash
# A record is a permalink…
curl -s "https://api.zaidlab.xyz/api/v1/record/conflict/<stable_id>"

# …and links to everything that happened at the same place that week:
curl -s "https://api.zaidlab.xyz/api/v1/record/conflict/<stable_id>/related"

# Or browse place+week event clusters directly:
curl -s "https://api.zaidlab.xyz/api/v1/events?admin2=gaza&min_categories=2&limit=3"
```

## 4. Search everything

```bash
curl -s "https://api.zaidlab.xyz/api/v1/search?q=deir%20yassin&limit=5"
```

## 5. When you need more: API keys

Registered tiers raise rate limits (free: 30/min) and paid tiers
(journalist $29 / NGO $149) license the data for commercial reuse —
with non-commercial sources (WHO, B'Tselem) automatically excluded from
paid responses, and required attributions listed in `/api/v1/licenses`.

```bash
curl -s -H "Authorization: Bearer pdb_live_YOURKEY" \
  "https://api.zaidlab.xyz/api/v1/unified/health?limit=5"
curl -s -H "Authorization: Bearer pdb_live_YOURKEY" \
  "https://api.zaidlab.xyz/api/v1/me/usage"
```

Note the header: `Authorization: Bearer …` (the live-alerts service at
`wb-alerts.zaidlab.xyz` uses `X-API-Key` instead — different service).

## The honesty contract

- Stale categories answer with a `Warning: 299` header — check it.
- `metadata.records_hidden_by_license` tells paid tiers what was excluded.
- Counts in docs are snapshots; `/api/v1/quality` is the source of truth.
