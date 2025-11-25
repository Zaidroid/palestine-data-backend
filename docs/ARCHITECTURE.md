# 🏗️ System Architecture

## Overview
The **Palestine Data Backend** is designed as a **static data pipeline**. Instead of a dynamic server querying a database on every request, it runs a scheduled "build" process that generates static JSON files. These files are then served via a CDN (or GitHub Pages), ensuring high availability, low latency, and zero maintenance cost.

## 🔄 The Pipeline
The core of the system is the `update-all-data.sh` script, which orchestrates the following stages:

### 1. Fetch (`scripts/fetch-*.js`)
Connects to external APIs and downloads raw data.
- **Inputs**: External APIs (HDX, World Bank, Tech4Palestine, etc.)
- **Outputs**: Raw JSON files in `public/data/[source]/`

### 2. Transform (`scripts/populate-unified-data.js`)
Reads the raw data, cleans it, normalizes it, and maps it to the Unified Schema.
- **Inputs**: Raw data from Stage 1.
- **Outputs**: Standardized JSON files in `public/data/unified/`

### 3. Generate (`scripts/generate-geojson-layers.js`)
Converts the unified data into GeoJSON format for mapping applications.
- **Inputs**: Unified data from Stage 2.
- **Outputs**: GeoJSON files in `public/data/geojson/`

### 4. Manifest (`scripts/generate-manifest.js`)
Creates a master index (`manifest.json`) of all available data, including versions, timestamps, and file paths.
- **Outputs**: `public/data/manifest.json`

### 5. Validate (`scripts/validate-data.js`)
Runs a suite of tests to ensure data quality (schema validation, date checks, consistency checks).
- **Outputs**: Validation report in `public/data/validation-report.json`

## 📂 Directory Structure

```
palestine-data-backend/
├── .github/workflows/   # CI/CD Automation
├── public/data/         # The "Database" (Generated Files)
│   ├── unified/         # Standardized Data (by category)
│   ├── geojson/         # Map Layers (by category)
│   ├── hdx/             # Raw HDX Data
│   ├── techforpalestine/# Raw TechForPalestine Data
│   ├── wikidata/        # Raw Culture Data
│   └── manifest.json    # Master Index
├── scripts/             # Pipeline Scripts
│   ├── utils/           # Shared Helpers (Transformers, Enrichers)
│   ├── fetch-*.js       # Data Fetchers
│   └── update-all-data.sh # Master Script
└── docs/                # Documentation
```

## 🤖 Automation
The pipeline runs automatically every day at **00:00 UTC** via GitHub Actions.
- **Workflow**: `.github/workflows/update-data.yml`
- **Action**: Checks out code, installs dependencies, runs `update-all-data.sh`, and commits the changes back to the repo.
