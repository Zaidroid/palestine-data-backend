# 📊 Data Sources

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
