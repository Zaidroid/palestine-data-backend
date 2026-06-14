# Curated historical snapshots

Frozen, versioned datasets committed to git (unlike `public/data/`, which is
regenerated nightly). Each snapshot documents provenance and validation.

## btselem-fatalities-2000-2023.csv
- **What**: 11,124 person-level conflict fatalities, 2000-10-02 → 2023-09-24
  (10,092 Palestinian, 1,029 Israeli, 3 other), with name, event/death dates,
  age, gender, citizenship, location + district + region, hostilities
  participation, injury type, ammunition, killed_by, notes.
- **Origin**: B'Tselem fatalities database (statistics.btselem.org), via the
  public Kaggle aggregation, mirrored from
  github.com/EliBrignac/Fatalities_Israel_Palestine_Conflict_Visualization.
- **Validation** (vs B'Tselem published period totals, Palestinians):
  Cast Lead 1,376/1,391 (98.9%) · Protective Edge 2,195/2,251 (97.5%) ·
  Second Intifada 2,693/~3,189 (84% — named-record DB is narrower than the
  headline figure: deaths-of-wounds after the period, perpetrator categories).
- **License**: B'Tselem data is CC-BY-NC — non-commercial. The license
  registry gates it from paid tiers automatically.
- **Why frozen**: B'Tselem's live database continues past 2023 but blocks
  automated access (HTTP 429); this snapshot covers the pre-Oct-2023 era and
  is complementary to Tech4Palestine (which starts 2023-10-07). A live
  fetcher is queued for when access terms allow.
