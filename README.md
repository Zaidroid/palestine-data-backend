# Palestine Data Backend

A unified, open-source data aggregation system providing comprehensive historical and real-time data on Palestine. This backend aggregates, normalizes, and serves data from multiple international sources through a single performant API layer.

## 🚀 System Overview

The system is designed as a **Hybrid Data Platform**:

1. **Static Data Layer** — Pre-processed, optimized JSON files partitioned by quarter for fast reads.
2. **Dynamic API Layer** — Express.js API with filtering, pagination, time-series aggregation, and full-text search.
3. **Real-Time Alerts Layer** — Python/FastAPI service monitoring Telegram channels for live checkpoint and incident data from the West Bank.

It powers the Palestine Data Frontend by providing a single source of truth for data spanning from **1948 to the Present**.

---

## 📊 Data Catalog

The system currently hosts **184,000+ unified records** across **16 standardized categories**, sourced from 10+ international organizations.

### Coverage Highlights

- **Temporal Range**: 1948 – Present (daily updates for current events)
- **Geographic Scope**: West Bank, Gaza Strip, East Jerusalem, Historical Palestine, Diaspora (Jordan, Lebanon, Syria)
- **Schema**: Canonical Schema v3.0.0 — all records normalized to a unified format with `id`, `date`, `category`, `event_type`, `location`, `metrics`, `sources`
- **Pipeline**: 21 task pipeline, 0 failures, full fault isolation per category

### Categories & Sources

| # | Category | Records | Key Sources | Date Range |
|:--|:---------|--------:|:------------|:-----------|
| 1 | **Conflict** | 2,101 | Tech4Palestine, OCHA, B'Tselem | 2000 – Present |
| 2 | **Martyrs** | 60,199 | Tech4Palestine (Killed in Gaza) | Oct 2023 |
| 3 | **Health** | 38,232 | WHO, HDX, Good Shepherd | 1975 – 2030 |
| 4 | **Water/WASH** | 72,603 | HDX WASH Cluster | Nov 2024 – Present |
| 5 | **Education** | 2,990 | HDX, West Bank Schools Dataset | Current |
| 6 | **Infrastructure** | 1,333 | Tech4Palestine (damage reports) | Oct 2023 – Present |
| 7 | **Economic** | 1,516 | World Bank (92 indicators) | 2010 – 2024 |
| 8 | **West Bank** | 2,962 | HDX (schools, villages, barrier) | Current |
| 9 | **PCBS** | 875 | Palestinian Central Bureau of Statistics | 2010 – 2024 |
| 10 | **Land** | 691 | OCHA, B'Tselem, Peace Now | 2025 – Present |
| 11 | **Humanitarian** | 598 | HDX (HRP Projects) | 2020 – 2023 |
| 12 | **Culture** | 333 | UNESCO, Ministry of Tourism | Current |
| 13 | **News** | ~75 | Middle East Eye, Al Jazeera | Rolling 30 days |
| 14 | **Historical** | 68 | Historical Archives, Nakba data | 1948 – 1949 |
| 15 | **Refugees** | 8 | UNRWA (static camp dataset) | 2023 |
| 16 | **Prisoners** | 5 | Addameer / PCBS (static fallback) | Oct 2023 – Apr 2024 |

---

## 🛠 Architecture

```
palestine-data-backend/
├── src/api/                    # Express.js API server
│   ├── routes/
│   │   ├── unified.js          # /api/v1/unified/:category — paginated data
│   │   ├── search.js           # /api/v1/search — full-text search
│   │   ├── alerts-proxy.js     # /api/v1/live/* — proxy to Python alerts
│   │   └── index.js            # Route registry + /health + /health-deep
│   ├── controllers/
│   │   ├── unifiedController.js  # Filter, sort, paginate, time-series
│   │   └── statsController.js    # Cross-category aggregate statistics
│   └── utils/
│       ├── fileService.js        # JSON file reader with caching
│       └── live-transformer.js   # Real-time alert normalization
├── scripts/
│   ├── fetch-all-data.js         # Master fetcher (13 data sources)
│   ├── populate-unified-data.js  # 21-task ETL pipeline
│   ├── generate-manifest.js      # Source-level manifest generator
│   ├── generate-unified-manifest.js  # Unified manifest generator
│   └── utils/
│       ├── canonical-schema.js       # Schema v3.0.0 definition
│       ├── unified-pipeline.js       # Transform → Enrich → Validate → Partition
│       ├── infrastructure-transformer.js
│       ├── goodshepherd-transformer.js
│       ├── hdx-transformers.js
│       └── base-transformer.js
├── services/
│   └── westbank-alerts/          # Python FastAPI + Telethon (Telegram monitoring)
│       ├── app.py                # FastAPI endpoints
│       ├── monitor.py            # Telegram channel polling
│       └── Dockerfile
├── public/data/
│   ├── unified/                  # ← NORMALIZED output (16 category dirs)
│   │   ├── conflict/all-data.json
│   │   ├── martyrs/all-data.json
│   │   ├── ...
│   │   └── unified-manifest.json
│   ├── hdx/                      # Raw HDX CKAN data (150 files)
│   ├── tech4palestine/           # Raw T4P data (partitioned by quarter)
│   ├── worldbank/                # Raw World Bank indicators
│   ├── goodshepherd/             # Raw Good Shepherd Collective data
│   └── static/                   # Static fallback datasets
│       ├── unrwa-refugees.json
│       └── prisoners-statistics.json
├── docker-compose.yml            # Unified deployment (API + Alerts)
└── Dockerfile                    # Node.js API container
```

---

## 🔌 API Endpoints

Base URL: `http://<host>:7860/api/v1`

### Unified Data

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/unified/:category` | Paginated data with filters |
| `GET` | `/unified/:category/summary` | Aggregated metrics totals |
| `GET` | `/unified/:category/timeseries` | Time-series with `metric`, `interval`, `region` params |
| `GET` | `/unified/:category/metadata` | Category metadata |

**Query Parameters** for `/unified/:category`:
- `page` (default: 1), `limit` (default: 50, max: 500)
- `location`, `region`, `event_type` — filters
- `start_date`, `end_date` — date range
- `min_killed` — minimum casualty threshold
- `sort_by` (default: `date`), `order` (`asc`/`desc`)
- `fields` — comma-separated field selection

### Search & Stats

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/search?q=...` | Full-text search across all categories |
| `GET` | `/categories` | List available categories |
| `GET` | `/stats` | Cross-category aggregate statistics with live alerts |

### Real-Time Alerts (Proxy to Python backend)

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/live/checkpoints` | Active checkpoint statuses |
| `GET` | `/live/checkpoints/:id` | Specific checkpoint detail |
| `GET` | `/live/alerts` | Recent Telegram-sourced alerts |

### Health

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/health` | Basic health check |
| `GET` | `/health-deep` | Deep health: pipeline freshness + alerts connectivity |

---

## 💻 Quick Start

### Prerequisites
- Node.js 22+
- Python 3.11+ (for alerts service)
- Docker & Docker Compose (for deployment)

### Local Development

```bash
# Install dependencies
npm install

# Fetch all raw data from APIs (HDX, WHO, T4P, World Bank, etc.)
npm run fetch:all

# Process and unify all data into canonical schema
npm run transform

# Generate manifests
node scripts/generate-manifest.js
node scripts/generate-unified-manifest.js

# Start the API server
npm start
```

### Docker Deployment

```bash
# Build and run both services (Node API + Python Alerts)
docker compose up -d --build

# Services will be available at:
#   API:    http://localhost:7860
#   Alerts: http://localhost:8080
```

---

## 🔄 Data Pipeline

The ETL pipeline runs 21 isolated tasks with full fault tolerance — a failure in one category does not block others.

```
Fetch (13 sources)  →  Transform  →  Enrich  →  Validate  →  Partition  →  Merge
     ↓                    ↓            ↓           ↓            ↓           ↓
  HDX CKAN            Canonical    Geospatial   Quality     Quarterly    all-data.json
  Tech4Palestine      Schema v3    + Temporal    Score       Buckets     + manifest
  World Bank API
  WHO GHO
  Good Shepherd
  B'Tselem
  PCBS
  Middle East Eye
  UNRWA (static)
  Addameer (static)
```

### Pipeline Commands

```bash
npm run fetch:all     # Pull fresh data from all sources
npm run transform     # Process and unify all data
npm run manifest      # Generate source manifests
```

### Pipeline Report

After each run, a detailed report is saved to `public/data/pipeline-report.json` with per-category status, record counts, and timing.

---

## 🌍 Deployment (Production)

The production server runs at `192.168.0.118` with two Docker containers in a unified compose group:

| Container | Image | Port | Role |
|:----------|:------|:-----|:-----|
| `palestine-data-api` | Node.js 22 | 7860 | Express API serving unified data |
| `params-alerts-api` | Python 3.11 | 8080 | FastAPI + Telethon for live Telegram monitoring |

### Updating the Server

```bash
# Sync code to server
rsync -avz --exclude 'node_modules' --exclude '.git' \
  ./ admin@192.168.0.118:/home/admin/palestine-data-backend/

# Rebuild and restart containers
ssh admin@192.168.0.118 'cd /home/admin/palestine-data-backend && docker compose up -d --build'
```

---

## 🔧 Environment Variables

### Node API (`.env`)
```
PORT=7860
ALERTS_API_URL=http://alerts:8080
```

### Alerts Service (`services/westbank-alerts/.env`)
```
TELEGRAM_API_ID=<your-api-id>
TELEGRAM_API_HASH=<your-api-hash>
TELEGRAM_PHONE=<your-phone>
TELEGRAM_CHANNELS=Almustashaar,WAFAgency,QudsN
CHECKPOINT_CHANNELS=ahwalaltreq
YOUR_CITY_AR=نابلس
YOUR_CITY_EN=Nablus
DB_PATH=/data/alerts.db
```

---

## 📄 License

Open source — contributions welcome. Data sourced from publicly available international organizations and humanitarian agencies.
