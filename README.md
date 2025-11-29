# Palestine Data Backend

A unified, open-source data aggregation system providing comprehensive historical and real-time data on Palestine. This backend aggregates, normalizes, and serves data from multiple international sources, making it easily accessible for researchers, developers, and the public.

## 🚀 System Overview

This system is designed as a **Hybrid Data Server**:
1.  **Static Data Layer**: Pre-processed, optimized JSON files served via CDN (fast, cheap, scalable).
2.  **Dynamic API Layer**: A serverless-ready Express API for advanced search, filtering, and aggregation.

It powers the "Palestine Digital Twin" and other frontend applications by providing a single source of truth for data spanning from **1948 to the Present**.

---

## 📊 Data Catalog

The system currently hosts **62,000+ records** across 13 standardized categories.

### Coverage Highlights
-   **Temporal Range**: 1948 - Present (Daily updates for current events).
-   **Geographic Scope**: West Bank, Gaza Strip, and Historical Palestine.
-   **Unification**: 84% of raw data has been normalized into a consistent schema.

### Categories & Sources

| Category | Description | Key Sources |
| :--- | :--- | :--- |
| **Conflict** | Wars, incidents, and military operations. | OCHA, B'Tselem, Wikipedia |
| **Martyrs** | Detailed records of casualties. | Ministry of Health, B'Tselem |
| **Health** | Hospital status, medical supplies, attacks on healthcare. | WHO, OCHA |
| **Infrastructure** | Damage to buildings, roads, and utilities. | World Bank, UNOSAT |
| **Refugees** | Displacement stats, camp data. | UNRWA |
| **Demographics** | Population, density, and vital statistics. | PCBS (Palestinian Bureau of Statistics) |
| **Land** | Settlements, confiscations, and borders. | OCHA, ARIJ |
| **Water** | Water resources and consumption. | PWA, OCHA |
| **Economic** | Poverty rates, unemployment, aid flows. | World Bank, PCBS |
| **Education** | Schools, universities, and damage reports. | Ministry of Education |
| **Culture** | Heritage sites and cultural centers. | UNESCO |
| **Humanitarian** | Aid trucks, food security. | UNRWA, WFP |
| **Historical** | Key events from 1948, 1967, Intifadas. | Historical Archives |

---

## 🛠 Architecture

### Directory Structure
```
public/data/
├── unified/           # NORMALIZED data (Ready for frontend use)
│   ├── all.json       # Master file (use with caution, large)
│   ├── health.json    # Category-specific files
│   ├── conflict.json
│   └── ...
├── historical/        # Curated historical datasets
├── search-index.json  # Pre-built index for client-side search
└── ...
```

### API Endpoints
The backend exposes a RESTful API (via Netlify Functions or Docker).

-   `GET /data/unified/{category}.json` - Fetch static data (Fastest).
-   `GET /api/v1/search?q={query}` - Full-text search across all records.
-   `GET /api/v1/unified` - Filtered query with pagination.

---

## 💻 Integration Guide

**Frontend Developers:**
We provide a detailed guide on how to consume this data in your React, Vue, or mobile apps.
👉 **[Read the Frontend Integration Guide](docs/frontend-integration.md)**

### Quick Example
```javascript
// Fetch all health-related events
const response = await fetch('https://your-domain.com/data/unified/health.json');
const data = await response.json();
```

---

## 🌍 Deployment

### Netlify (Recommended)
Zero-config deployment is supported.
1.  Connect this repo to Netlify.
2.  It automatically detects `netlify.toml`.
3.  Deploys **Static Data** to CDN and **API** to Netlify Functions.

### Docker
Run locally or on any VPS.
```bash
docker-compose up --build
```

---

## 🔄 Data Pipeline
The data is updated via a robust ETL (Extract, Transform, Load) pipeline:
1.  **Fetch**: Scripts in `scripts/fetch-*.js` pull raw data from APIs (HDX, WHO) and scrapers.
2.  **Process**: `scripts/process-*.js` cleans and normalizes data.
3.  **Unify**: `scripts/populate-unified-data.js` merges everything into the standard schema.
4.  **Validate**: Ensures data integrity before publishing.

To trigger a manual update:
```bash
npm run update-data
```
