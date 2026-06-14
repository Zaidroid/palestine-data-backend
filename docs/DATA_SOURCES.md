# 📊 Data Sources

## Source-trust policy

Every dataset in the databank is classified into one of three trust tiers.
The tier governs how a source may be used — never the other way around.

**Tier 1 — Primary documentation (the authority).** Palestinian official
statistics and on-the-ground documentation, UN agencies, and established
human-rights monitors: PCBS, Gaza Ministry of Health, UNRWA, UN OCHA,
UNHCR, WHO, B'Tselem, Al-Haq, PCHR, Al Mezan, Addameer. Claims about
casualties, demolitions, detentions and displacement must trace to this
tier.

**Tier 2 — Scholarly and curated datasets.** Academic registries and
Palestinian-led data projects with published methodology: UCDP-GED,
Insecurity Insight, Walid Khalidi's *All That Remains*, Salman Abu Sitta's
*Atlas of Palestine*, Zochrot, Palestine Remembered, Palestine Open Maps
(Visualizing Palestine), Tech4Palestine. Used as event/registry backbones,
cited per record.

**Tier 3 — Tertiary aggregators (bootstrap and crosswalk ONLY).** Wikidata,
Wikipedia, GeoNames, OpenStreetMap. Useful for machine-readable
coordinates, name variants and entity crosswalks — never the authority for
contested claims. The English Wikipedia's Israel/Palestine topic area in
particular has a documented history of organized partisan editing; prose
claims from it are not citable here. Where a record was bootstrapped from
Tier 3 (e.g. the first Nakba-villages import), it is upgraded to Tier 1/2
citations as soon as a trusted registry covers it, keeping the Tier 3 id
only as a crosswalk key.

The depopulated-villages registry follows this policy: primary data and
citations come from Palestine Open Maps + Zochrot + Palestine Remembered +
Abu Sitta per village; Wikidata QIDs are retained as crosswalk keys only.

---

This document lists all the external sources integrated into the Palestine Data Backend.

## 1. Tech4Palestine
**Type**: API
**Content**: Real-time casualties, martyrs list, infrastructure damage, press casualties.
- **Endpoints**:
    - `killed-in-gaza.min.json`: Detailed list of martyrs.
    - `casualties_daily.json`: Daily aggregate casualty counts.
    - `infrastructure-damaged.json`: Damage assessments.
    - `press_killed_in_gaza.json`: Journalists killed.

## 2. HDX (Humanitarian Data Exchange)
**Type**: CKAN API
**Content**: Humanitarian aid, displacement, food security, UN OCHA reports.
- **Key Datasets**:
    - **Casualties**: UN OCHA casualty data.
    - **Displacement**: UNRWA/IOM displacement figures.
    - **Food Security**: IPC classification data.

## 3. World Bank
**Type**: API
**Content**: Macroeconomic indicators.
- **Indicators**:
    - GDP, Inflation, Unemployment.
    - Poverty rates, Gini index.
    - Trade statistics.

## 4. WHO (World Health Organization)
**Type**: HDX (Source)
**Content**: Health sector status.
- **Data**:
    - Hospital functionality.
    - Attacks on healthcare.
    - Disease surveillance.

## 5. Good Shepherd Collective
**Type**: API
**Content**: Human rights and settler violence.
- **Data**:
    - Prisoner statistics (administrative detention, child prisoners).
    - Settler violence incidents.

## 6. PCBS (Palestinian Central Bureau of Statistics)
**Type**: Scraper/Static
**Content**: Official demographics and census data.
- **Data**:
    - Population projections.
    - Housing statistics.

## 7. News Feeds (RSS)
**Type**: RSS/Atom
**Content**: Aggregated news updates.
- **Sources**: Al Jazeera, Reuters, UN News, WAFA, etc.

## 8. Water (WASH)
**Type**: HDX HAPI
**Content**: Water access, sanitation, and hygiene indicators.
- **Source**: WHO, UNICEF, WASH Cluster via HDX.

## 9. Cultural Heritage
**Type**: Wikidata SPARQL
**Content**: Heritage sites, monuments, and historical places.
- **Data**: Location, type, and status of cultural sites.

## 10. Land & Settlements
**Type**: HDX CKAN (Peace Now & OCHA)
**Content**: Israeli settlements and movement restrictions.
- **Settlements**: Peace Now "Settlement Watch" data.
- **Checkpoints**: OCHA closure and access data.
