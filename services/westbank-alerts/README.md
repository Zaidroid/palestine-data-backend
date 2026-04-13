# West Bank Tracker

Real-time checkpoint status, security alerts, and situational awareness for the West Bank. The system monitors Telegram channels for checkpoint updates and security events, classifies them using Arabic NLP, and serves them through a REST API with WebSocket/SSE real-time streaming. A mobile-first PWA frontend provides live dashboards, route planning with checkpoint awareness, and push notifications.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Backend](#backend)
  - [Telegram Monitor](#telegram-monitor)
  - [Alert Classifier](#alert-classifier)
  - [Checkpoint Pipeline](#checkpoint-pipeline)
  - [Database Layer](#database-layer)
  - [API Reference](#api-reference)
  - [External Data Sources](#external-data-sources)
- [Frontend](#frontend)
  - [App Structure](#app-structure)
  - [Screens and Features](#screens-and-features)
  - [Real-Time Data Flow](#real-time-data-flow)
  - [Route System](#route-system)
  - [PWA and Offline](#pwa-and-offline)
- [Data Models](#data-models)
  - [Alert Types](#alert-types)
  - [Severity Levels](#severity-levels)
  - [Checkpoint Statuses](#checkpoint-statuses)
  - [Checkpoint Types](#checkpoint-types)
- [Setup and Deployment](#setup-and-deployment)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Telegram Session Setup](#telegram-session-setup)
  - [Running Locally](#running-locally)
  - [Docker Deployment](#docker-deployment)
  - [Render Deployment](#render-deployment)
- [Project Structure](#project-structure)
- [AI Agent Integration](#ai-agent-integration)

---

## Architecture Overview

The system consists of two main components:

```
Telegram Channels
    |
    v
[Telegram Monitor] ---> polls every 5 seconds
    |
    +--> Security Channels (Almustashaar, WAFA, QudsN)
    |        |
    |        v
    |    [Alert Classifier] ---> Arabic NLP, two-tier classification
    |        |
    |        v
    |    [Alerts DB] (SQLite) ---> /alerts, /incidents, /ws, /stream
    |
    +--> Checkpoint Channel (ahwalaltreq)
         |
         v
     [Checkpoint Parser] ---> whitelist-validated, multi-strategy
         |
         v
     [Checkpoints DB] (SQLite) ---> /checkpoints, /checkpoints/ws

External APIs:
    Bank of Israel    ---> /market/currency
    Open-Meteo        ---> /weather, /air-quality
    AlAdhan           ---> /prayer-times
    IODA (Georgia Tech) -> /internet-status
    TheFuelPrice      ---> /market/fuel
```

**Backend**: Python 3.11, FastAPI, Telethon (Telegram MTProto client), aiosqlite.

**Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Leaflet maps, TanStack Query.

---

## Backend

### Telegram Monitor

File: `app/monitor.py`

The monitor connects to Telegram via Telethon and polls configured channels every 5 seconds using `min_id` parameter to fetch only new messages. On startup, it seeds the last message ID for each channel to avoid replaying history.

Two channel types are handled:

- **Security alert channels**: Messages are routed to the alert classifier. Three channels are configured: Almustashaar (structured military/siren alerts), WAFA/WAFAgency (Palestinian news wire), and QudsN (breaking news).
- **Checkpoint channel**: Messages are routed to the checkpoint parsing pipeline. The primary channel is ahwalaltreq.

The monitor tracks daily statistics (messages processed, alerts created, checkpoint updates) and logs a heartbeat every 5 minutes.

### Alert Classifier

File: `app/classifier.py`

The classifier uses regex-based Arabic NLP with approximately 400 normalized keywords. Arabic text is normalized before matching: alef variants are unified, taa marbuta is collapsed, and diacritics are stripped.

**Two-tier classification:**

**Tier 1 (Missiles and Sirens)**: Detects rocket attacks, siren activations, airstrikes, and explosions. Requires at least one attack verb (from a list of 30+ Arabic and English terms). All missile and siren alerts are treated as local threats because the West Bank and Israel share the same geographic space. A missile hitting Tel Aviv or Haifa is a direct threat to West Bank residents (same airspace, same sirens). These are classified as `west_bank_siren` with `high` severity, not as low-priority regional news.

**Tier 2 (Ground Operations)**: Detects IDF raids, settler attacks, demolitions, road closures, flying checkpoints, injury reports, and arrest campaigns. Uses broader contextual matching including Palestinian-specific markers (occupation forces, settlers, Palestinian cities). Does not require attack verbs since these are ground-level events.

**Channel routing**: All channels can contribute to both tiers. News channels (WAFA, QudsN) receive relaxed noise filtering since their messages naturally contain news attribution phrases that would otherwise be filtered.

**Noise filtering**: Messages are discarded if they contain speculative language, future-tense threats, analysis/summary prefixes, or are dominated by media attribution. Israel conducting outward attacks (bombing Lebanon/Syria) is also filtered as it does not represent an incoming threat.

**Area extraction**: The classifier maps 100+ Arabic place names to English equivalents, covering governorate capitals, villages, refugee camps, settlements, and roads. Matches are sorted by key length so longer (more specific) names win.

**Zone mapping**: Alerts are assigned to north (Nablus/Jenin/Tulkarm/Qalqilya/Salfit/Tubas), middle (Ramallah/Jerusalem/Jericho), or south (Bethlehem/Hebron) sub-zones. Each zone has center coordinates used for map display.

**Content deduplication**: Before classification, new messages are compared against recent alerts (30-minute window) using word-level Jaccard similarity on normalized text (emoji, URLs, and decorators stripped). Messages with similarity above 0.6 are discarded. This prevents repeated messages about the same event (common on Telegram) from generating duplicate alerts.

### Checkpoint Pipeline

The checkpoint system uses a multi-stage pipeline:

1. **Knowledge Base** (`app/checkpoint_knowledge_base.py`): Loads `data/known_checkpoints.json` containing 150+ canonical checkpoints with Arabic names, English names, regions, types, coordinates, and aliases. Provides O(1) lookups by canonical key, Arabic name, or alias.

2. **Whitelist Parser** (`app/checkpoint_whitelist_parser.py`): Primary parser. Scans messages for checkpoint names that match the knowledge base whitelist. Extracts status from surrounding context using colon-format detection ("checkpoint: open"), word-based patterns, and emoji indicators.

3. **Entity Matcher** (`app/checkpoint_matcher.py`): Fallback parser. Uses fuzzy matching to find checkpoint mentions in free-text and infers status from surrounding words.

4. **Strict Validator** (`app/checkpoint_strict_validator.py`): Quality gate that rejects corrupted checkpoint names containing status words, directions, or filler text.

5. **Alias Resolver** (`app/checkpoint_aliases.py`): Handles Arabic spelling variants (taa marbuta, alef variants, hamza differences) to map variant spellings to canonical keys.

6. **Checkpoint DB** (`app/checkpoint_db.py`): Stores checkpoint status with confidence scoring. Admin messages override crowd reports. Checkpoints older than `CHECKPOINT_STALE_HOURS` (default 12) are marked stale.

**Message flow**: Telegram message arrives, the monitor detects the sender (admin or crowd), the whitelist parser extracts checkpoint names and statuses, the strict validator filters bad matches, and the DB upserts the checkpoint status. Changed checkpoints are broadcast via WebSocket/SSE.

### Database Layer

Two SQLite databases are used:

**Alerts DB** (`data/alerts.db`):
- `alerts` table: id, type, severity, title, title_ar, body, source, source_msg_id, area, zone, raw_text, timestamp, created_at, event_subtype, latitude, longitude
- `channels` table: monitored Telegram channel usernames
- `webhooks` table: external webhook delivery targets
- `security_vocab_candidates` table: self-learning vocabulary for the classifier
- Indexed on timestamp (DESC), type, severity, and area
- Auto-pruned to MAX_ALERTS_STORED (default 20,000) entries

**Checkpoints DB** (`data/checkpoints.db`):
- `checkpoint_status` table: current status of each checkpoint with confidence, crowd reports, last update
- `checkpoint_updates` table: full history of all status changes with source attribution
- `checkpoint_vocab` table: learned vocabulary from the checkpoint channel

### API Reference

All endpoints return JSON. CORS is enabled for all origins. The API runs on port 8080 by default.

#### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with uptime, connection status, and monitor stats |
| GET | `/alerts` | List alerts with filtering by type, severity, area, since. Paginated. |
| GET | `/alerts/latest` | Latest N alerts (default 10, max 100) |
| GET | `/alerts/active` | Alerts from the last N hours (default 2) |
| GET | `/alerts/{id}` | Single alert by ID |
| GET | `/stats` | Statistics: total alerts, by type, by severity, by area, monitored channels |
| GET | `/incidents` | Categorized incident feed with filters: category, type, area, zone, severity, hours |
| GET | `/incidents/summary` | Situational summary: counts by category/zone/severity, threat level |
| GET | `/checkpoints` | All checkpoints with current status. Optional status filter. |
| GET | `/checkpoints/closed` | Only closed and military checkpoints |
| GET | `/checkpoints/stats` | Checkpoint statistics: by status, freshness counts |
| GET | `/checkpoints/updates/feed` | Recent checkpoint update feed (last N hours) |
| GET | `/checkpoints/nearby` | Checkpoints near a lat/lon within radius |
| GET | `/checkpoints/geojson` | All checkpoints as GeoJSON FeatureCollection |
| GET | `/checkpoints/regions` | Checkpoints grouped by region |
| GET | `/checkpoints/summary` | Compact summary for dashboard KPIs |
| GET | `/checkpoints/{key}` | Single checkpoint with update history |
| GET | `/zones` | West Bank sub-zone definitions with polygons and centers |
| GET | `/market` | All market data: currency rates, gold prices, fuel prices |
| GET | `/market/currency` | ILS exchange rates from Bank of Israel |
| GET | `/market/gold` | Gold price per gram in ILS (14K, 18K, 21K, 24K) |
| GET | `/market/fuel` | Palestine fuel prices (gasoline, diesel) |
| GET | `/weather` | Current weather for 5 WB cities |
| GET | `/prayer-times` | Prayer times for 5 WB cities (Umm Al-Qura method) |
| GET | `/air-quality` | AQI metrics for WB cities (PM2.5, PM10, US/EU AQI) |
| GET | `/internet-status` | Palestine internet connectivity via IODA |
| GET | `/conditions` | Full situational snapshot combining all data sources |

#### Real-Time Endpoints

| Method | Path | Description |
|--------|------|-------------|
| WebSocket | `/ws` | Alert stream. Events: `alert`, `ping`, `ack`. Keepalive every 30s. |
| GET | `/stream` | SSE alert stream for browser dashboards |
| WebSocket | `/checkpoints/ws` | Checkpoint update stream. Events: `checkpoint_update`, `ping`. |
| GET | `/checkpoints/stream` | SSE checkpoint update stream |

#### Protected Endpoints (require `X-API-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/channels` | List monitored channels |
| POST | `/admin/channels` | Add a channel |
| DELETE | `/admin/channels/{username}` | Remove a channel |
| POST | `/admin/inject` | Manually inject an alert |
| POST | `/admin/analyze-history` | Bulk analyze checkpoint message history |
| POST | `/admin/analyze-security-history` | Bulk analyze security message history |
| GET | `/admin/security-vocab` | View learned security vocabulary candidates |
| GET | `/webhooks` | List webhook targets |
| POST | `/webhooks` | Register a webhook target |
| DELETE | `/webhooks/{id}` | Remove a webhook |

#### Incidents API

The `/incidents` endpoint provides a categorized, severity-sorted feed:

**Categories:**
- `threats`: Missiles, sirens, airstrikes, explosions (`west_bank_siren`, `regional_attack`, `rocket_attack`, `airstrike`, `explosion`)
- `military`: IDF raids, arrest campaigns, military operations (`idf_raid`, `arrest_campaign`, `idf_operation`)
- `attacks`: Settler attacks, shootings, demolitions, injuries (`settler_attack`, `shooting`, `demolition`, `injury_report`)

**Query parameters:**
- `category`: Filter by category name
- `type`: Filter by specific alert type
- `area`: Partial match on area name
- `zone`: Filter by WB sub-zone (north, middle, south)
- `severity`: Minimum severity floor (critical, high, medium, low)
- `hours`: Time window (default 24, max 168)
- `limit`: Max results (default 100, max 500)

The `/incidents/summary` endpoint returns dashboard KPIs including a computed `threat_level` field: `critical` (any critical alerts), `high` (3+ high), `elevated` (any high or 4+ medium), or `normal`.

### External Data Sources

All external APIs are free and require no API keys.

| Source | Endpoint | Cache Duration | Notes |
|--------|----------|---------------|-------|
| Bank of Israel | `/market/currency` | 1 hour | ILS exchange rates (USD, EUR, JOD, EGP) |
| Open-Meteo | `/weather` | 30 minutes | Temperature, wind, conditions for 5 WB cities |
| Open-Meteo Air Quality | `/air-quality` | 1 hour | PM2.5, PM10, US/EU AQI index |
| AlAdhan | `/prayer-times` | 6 hours | Fajr, Dhuhr, Asr, Maghrib, Isha times |
| IODA (Georgia Tech) | `/internet-status` | 15 minutes | BGP, active probing, Google Transparency |
| Exchange-rates.org | `/market/gold` | 1 hour | Gold price USD per ounce, converted to ILS |
| TheFuelPrice.com | `/market/fuel` | 6 hours | Gasoline and diesel prices in Palestine |

---

## Frontend

### App Structure

The frontend is a mobile-first, RTL (Arabic) PWA built with React 18 and TypeScript. It uses a 4-tab navigation shell:

1. **Home** (الرئيسية): Live dashboard with KPI pills, blocked checkpoints, recent updates, route status
2. **Route** (طريقي): Route planner with city selection, checkpoint status per route, navigation mode
3. **Checkpoints** (حواجز): Browse checkpoints by region, filter by status, view details
4. **Alerts** (التنبيهات): Security alerts categorized by type with severity sorting

Additional overlays:
- Fullscreen interactive map (Leaflet with OpenStreetMap tiles)
- Settings sheet (notifications, saved routes, active route)
- KPI detail sheets for each dashboard metric
- First-time onboarding flow

### Screens and Features

**Home Screen** (`src/components/mobile/HomeScreen.tsx`):
- KPI cards showing closed checkpoints, congested checkpoints, and active alerts
- Active route status bar (if a route is selected) with checkpoint health summary
- Blocked checkpoints section showing closed/military checkpoints with expandable details
- Live feed of recent checkpoint updates sorted by freshness
- Quick access to map and route planning

**Checkpoints Screen** (`src/components/mobile/CheckpointsScreen.tsx`):
- Two-view system: region landing with city cards, then drill-down to checkpoint list
- Region cards show checkpoint count and status distribution per city
- Filter by status (open, closed, congested, military, slow)
- Search by checkpoint name (Arabic or English)
- Shared `CheckpointCard` component used across all screens
- Sorted by last update time (freshest first)
- Arabic city names mapped from API region values

**Route Screen** (`src/components/mobile/RouteScreen.tsx`):
- Step 1: Select origin city from vertical card list showing destination counts and checkpoint status
- Step 2: Select destination from city cards showing route distance, time, and checkpoint health
- Step 3: Route summary with checkpoint list and status indicators
- Step 4: Navigation mode with origin/destination markers, distance between checkpoints, user location tracking (blue pulse), and checkpoint status progress bar

**Alerts Screen** (`src/components/mobile/AlertsScreen.tsx`):
- All alerts treated as security incidents (no local vs regional split)
- Filter tabs: All, Missiles and Sirens, Military Operations, Attacks, On Your Route
- Sorted by severity (critical first) then by timestamp
- Expandable alert cards with full details and raw source text

**Onboarding** (`src/components/mobile/OnboardingFlow.tsx`):
- 8-step immersive walkthrough for first-time users
- Animated illustrations for each feature (CSS/SVG, no external assets)
- Swipe navigation with spring-based transitions
- Inline permission prompts for location and notifications
- Shows once per device (localStorage)
- Steps: Welcome, Dashboard, Checkpoints, Route Planning, Alerts, Live Map, Permissions, Ready

### Real-Time Data Flow

File: `src/hooks/useRealtime.ts`

The frontend connects to the backend via SSE (`/stream` and `/checkpoints/stream`) or WebSocket (`/ws` and `/checkpoints/ws`). SSE is preferred for browser compatibility.

Connection lifecycle:
1. On mount, the hook establishes SSE connections to both alert and checkpoint streams
2. Incoming events are parsed and appended to in-memory arrays
3. TanStack Query cache is updated to keep checkpoint status in sync
4. On disconnect, exponential backoff reconnection is attempted
5. Connection status (connected/connecting/disconnected) is displayed in the header

Push notifications (`src/hooks/usePushNotifications.ts`):
- Uses the browser Notification API (not a push server)
- Fires foreground notifications for critical and high severity alerts
- Can be enabled/disabled from settings

### Route System

File: `src/lib/routes.ts`

15 pre-defined routes between major West Bank cities:

| Route | Distance | Time | Checkpoints |
|-------|----------|------|-------------|
| Ramallah to Jerusalem | 15 km | 30 min | DCO, Beit El, Jalazun, Qalandia, Ar-Ram, Shu'fat |
| Ramallah to Nablus | 55 km | 70 min | Atara, Sinjil, Za'tara, Huwara, Burin, Yitzhar |
| Nablus to Jenin | 42 km | 50 min | Homesh, Dotan, Qabatiya, Arraba, Jalama |
| Bethlehem to Hebron | 30 km | 40 min | Beit Fajjar, Arroub, Halhul, Bani Na'im, Ras al-Jora |
| Ramallah to Jericho | 40 km | 50 min | Ein Sinya, Hizma, Jaba', Ma'arjat, Nuwei'ma |
| Nablus to Tulkarm | 45 km | 55 min | Deir Sharaf, Bazzariya, Anabta, Jabara, Beit Lid |
| Nablus to Qalqilya | 50 km | 65 min | Kifl Haris, Bidya, Kafr Thulth, Azzun Gate |
| Tulkarm to Qalqilya | 25 km | 30 min | Shweikeh, Nur Shams, Anabta, Bal'a, Immatain, Azzun |
| Ramallah to Bethlehem | 30 km | 45 min | Ein Sinya, Hizma, Jaba', Container (Wadi Nar) |
| Hebron to Jerusalem | 38 km | 55 min | Arroub, Beit Fajjar, Container, Abu Dis |
| Ramallah to Salfit | 30 km | 40 min | Rawabi, Atara, Marda, Iskaka, Salfit North |
| Nablus to Jericho | 55 km | 75 min | Beit Furik, Awarta, Aqraba, Ein Shibli, Hamra, Fasayil |
| Jenin to Tubas | 25 km | 35 min | Jalbon, Fara'a Camp, Tamun, Aqaba, Tayasir |
| Jenin to Tulkarm | 35 km | 45 min | Ya'bad, Masaliya, Dotan, Beit Lid, Anabta, Jabara |
| Ramallah to Salfit (north) | 35 km | 45 min | Rawabi, Atara, Marda |

Each route includes ordered checkpoint sequences with canonical keys. Helper functions provide route health calculation (counts by status), checkpoint-to-route matching, and area-to-route fuzzy matching for alert filtering.

Saved routes are persisted in localStorage (up to 4). The active route is also persisted and restored on app reload.

### PWA and Offline

The app is installable as a Progressive Web App on Android and iOS.

**Service worker** (via vite-plugin-pwa with Workbox):
- Precaches the app shell (HTML, JS, CSS, fonts, icons)
- Runtime caching for OpenStreetMap tiles (30-day expiry)
- Runtime caching for Google Fonts (1-year expiry)
- API paths (`/alerts`, `/checkpoints`, `/stats`, `/stream`, `/ws`, `/health`) are excluded from caching to ensure fresh data

**Install prompts**:
- Android: Captures `beforeinstallprompt` event and shows a custom install banner after 3 seconds
- iOS: Detects Safari on iOS and shows manual instructions (Share > Add to Home Screen)
- Dismissal is remembered in localStorage

**Update detection**: The service worker checks for updates every 5 minutes. When a new version is available, a banner prompts the user to reload.

**Manifest** (`public/manifest.json`):
- App name: West Bank Tracker (Arabic: متتبع الضفة الغربية)
- Display: standalone
- Language: Arabic, RTL
- Shortcuts: My Route, Alerts
- Icons: 192px and 512px in regular and maskable variants

---

## Data Models

### Alert Types

| Type | Description | Tier | Typical Severity |
|------|-------------|------|------------------|
| `west_bank_siren` | Missile sirens or confirmed impacts affecting the region | 1 | high / critical |
| `regional_attack` | Attacks on MENA countries without clear Israel/WB target | 1 | medium |
| `idf_raid` | IDF forces entering towns, military incursions | 2 | medium / high |
| `settler_attack` | Settler violence against Palestinian communities | 2 | medium / high |
| `road_closure` | Road or route closures (not checkpoint-related) | 2 | low |
| `flying_checkpoint` | Temporary or mobile checkpoints | 2 | low |
| `injury_report` | Confirmed casualties or injuries | 2 | medium / high |
| `demolition` | Home or structure demolitions | 2 | medium |
| `arrest_campaign` | Mass arrest operations | 2 | medium |
| `rocket_attack` | Legacy type for backward compatibility | - | high |
| `airstrike` | Legacy type | - | high |
| `explosion` | Legacy type | - | medium |
| `idf_operation` | Legacy type | - | medium |
| `shooting` | Legacy type | - | medium |
| `general` | Legacy type | - | low |

### Severity Levels

| Level | Meaning | Example |
|-------|---------|---------|
| `critical` | Active threat in your configured city | Sirens in Ramallah (if YOUR_CITY is Ramallah) |
| `high` | Confirmed attack or event anywhere in the region | Missile impact, IDF raid in Jenin, settler attack |
| `medium` | Ongoing situation, moderate risk | Road closure, arrest campaign, demolition |
| `low` | General security update | Flying checkpoint, regional event without clear target |

### Checkpoint Statuses

| Status | Arabic | Meaning |
|--------|--------|---------|
| `open` | مفتوح | Checkpoint is open, traffic flowing normally |
| `closed` | مغلق | Checkpoint is fully closed, no passage |
| `congested` | مزدحم | Checkpoint is open but with significant delays |
| `slow` | بطيء | Checkpoint is open with minor delays |
| `military` | عسكري | Active military presence, unpredictable behavior |
| `unknown` | غير معروف | Status not determined or data is stale |

### Checkpoint Types

| Type | Description |
|------|-------------|
| `checkpoint` | Standard military checkpoint |
| `gate` | Agricultural or access gate |
| `police` | Police checkpoint |
| `traffic_signal` | Traffic control point |
| `roundabout` | Roundabout checkpoint |
| `bridge` | Bridge crossing |
| `entrance` | Town or city entrance |
| `bypass_road` | Settler bypass road intersection |
| `tunnel` | Tunnel checkpoint |
| `crossing` | Border or zone crossing |

---

## Setup and Deployment

### Prerequisites

- Python 3.11 or later
- Node.js 18 or later (for frontend development)
- A Telegram account with API credentials from https://my.telegram.org
- Access to the target Telegram channels (you must join them from the same account)

### Environment Variables

Create a `.env` file in the project root. See `.env.example` for a template.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_API_ID` | Yes | - | Telegram API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | Yes | - | Telegram API hash |
| `TELEGRAM_PHONE` | Yes | - | Phone number for Telegram authentication |
| `TELEGRAM_CHANNELS` | Yes | - | Comma-separated security channel usernames (no @) |
| `CHECKPOINT_CHANNELS` | Yes | - | Comma-separated checkpoint channel usernames (no @) |
| `YOUR_CITY_AR` | No | نابلس | Arabic name of your city for critical alert prioritization |
| `YOUR_CITY_EN` | No | Nablus | English name of your city |
| `API_PORT` | No | 8080 | API server port |
| `API_SECRET_KEY` | Yes | - | Secret key for admin endpoints (X-API-Key header) |
| `DB_PATH` | No | /data/alerts.db | Path to alerts SQLite database |
| `MAX_ALERTS_STORED` | No | 20000 | Maximum alerts before pruning old entries |
| `CHECKPOINT_STALE_HOURS` | No | 12.0 | Hours after which checkpoint data is marked stale |
| `TELEGRAM_SESSION_DIR` | No | /session | Directory for Telegram session file |
| `WEBHOOK_TIMEOUT` | No | 8 | Webhook delivery timeout in seconds |
| `WEBHOOK_MAX_RETRIES` | No | 3 | Maximum webhook delivery retries |

### Telegram Session Setup

Before first run, you must authenticate with Telegram once to generate a session file:

```bash
python3 setup_session.py
```

This will:
1. Read credentials from `.env`
2. Connect to Telegram and send an SMS verification code
3. Prompt you to enter the code
4. Save the session file to `./session/wb_alerts.session`

The session file is reused on subsequent launches. It does not expire unless you revoke it from Telegram settings.

### Running Locally

**Backend:**

```bash
# Install dependencies
pip install -r requirements.txt

# Run the session setup (first time only)
python3 setup_session.py

# Start the API server
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

The API will be available at `http://localhost:8080`. Interactive docs at `http://localhost:8080/docs`.

**Frontend:**

```bash
cd frontend/artifacts/wb-tracker

# Install dependencies
npm install

# Start dev server (proxies API requests to localhost:8080)
npm run dev
```

The frontend dev server starts on port 3000 (or the port specified by the `PORT` environment variable).

### Docker Deployment

```bash
# Build
docker build -t wb-alerts .

# Run
docker run -d \
  --name wb-alerts \
  --env-file .env \
  -v wb-alerts-data:/data \
  -v wb-alerts-session:/session \
  -p 8080:8080 \
  wb-alerts
```

Or using docker-compose:

```bash
docker-compose up -d
```

The compose file mounts persistent volumes for `/data` (databases) and `/session` (Telegram session).

### Render Deployment

A `render.yaml` blueprint is included for one-click deployment to Render.com:

1. Fork this repository
2. Create a new Blueprint on Render.com pointing to the repo
3. Set all required environment variables in the Render dashboard
4. Attach a 1GB persistent disk mounted at `/data`
5. Copy the session file to the persistent disk (or run `setup_session.py` in the shell)

The free tier has cold starts (service sleeps after inactivity). The starter tier ($7/month) keeps the service running.

---

## Project Structure

```
westbank-alerts/
|-- app/
|   |-- main.py                    FastAPI application and all endpoints
|   |-- config.py                  Environment configuration (Pydantic Settings)
|   |-- models.py                  Alert and webhook data models
|   |-- database.py                Alerts database operations
|   |-- db_pool.py                 SQLite connection pool
|   |-- monitor.py                 Telegram polling loop
|   |-- classifier.py              Arabic NLP alert classifier
|   |-- checkpoint_parser.py       Status extraction from Arabic messages
|   |-- checkpoint_matcher.py      Entity matching for checkpoint names
|   |-- checkpoint_whitelist_parser.py  Strict whitelist-validated parser
|   |-- checkpoint_knowledge_base.py   Known checkpoints index
|   |-- checkpoint_aliases.py      Arabic spelling variant resolution
|   |-- checkpoint_strict_validator.py  Name corruption filter
|   |-- checkpoint_models.py       Checkpoint data models
|   |-- checkpoint_db.py           Checkpoint database operations
|   |-- market_data.py             Currency, gold, fuel price fetching
|   |-- weather.py                 Weather data from Open-Meteo
|   |-- prayer_times.py            Prayer times from AlAdhan
|   |-- air_quality.py             AQI from Open-Meteo
|   |-- internet_status.py         Connectivity from IODA
|   |-- webhooks.py                External webhook delivery
|   |-- learner.py                 Self-learning vocabulary cycle
|   |-- history_analyzer.py        Bulk historical message analysis
|
|-- data/
|   |-- known_checkpoints.json     Master checkpoint database (150+ entries)
|   |-- checkpoint_directory.json  Historical frequency and variant data
|   |-- alerts.db                  SQLite alerts database (auto-created)
|   |-- checkpoints.db             SQLite checkpoints database (auto-created)
|
|-- session/
|   |-- wb_alerts.session          Telegram authentication session (auto-created)
|
|-- frontend/artifacts/wb-tracker/
|   |-- src/
|   |   |-- pages/
|   |   |   |-- MobileApp.tsx      Main app shell with tab navigation
|   |   |-- components/
|   |   |   |-- mobile/            Mobile-specific components
|   |   |   |   |-- HomeScreen.tsx
|   |   |   |   |-- CheckpointsScreen.tsx
|   |   |   |   |-- RouteScreen.tsx
|   |   |   |   |-- AlertsScreen.tsx
|   |   |   |   |-- OnboardingFlow.tsx
|   |   |   |   |-- MobileHeader.tsx
|   |   |   |   |-- SettingsSheet.tsx
|   |   |   |   |-- SplashScreen.tsx
|   |   |   |   |-- KpiDetailSheet.tsx
|   |   |   |-- MapView.tsx        Leaflet map component
|   |   |   |-- DetailPanel.tsx    Alert/checkpoint detail panel
|   |   |   |-- PwaInstallPrompt.tsx  Install and update prompts
|   |   |   |-- ErrorBoundary.tsx  Error boundary wrapper
|   |   |   |-- ui/               Radix/shadcn UI primitives
|   |   |-- hooks/                 React hooks for data fetching and state
|   |   |-- lib/
|   |   |   |-- routes.ts         Route database and helper functions
|   |   |   |-- i18n.ts           Arabic/English translations
|   |   |   |-- api/              HTTP client, types, endpoints
|   |   |   |-- realtime/         SSE and WebSocket connection managers
|   |-- public/
|   |   |-- manifest.json         PWA manifest
|   |   |-- icon-*.png            App icons
|   |-- vite.config.ts            Build configuration
|   |-- package.json              Dependencies and scripts
|
|-- setup_session.py               Telegram authentication setup
|-- requirements.txt               Python dependencies
|-- Dockerfile                     Container build
|-- docker-compose.yml             Container orchestration
|-- render.yaml                    Render.com deployment blueprint
|-- .env.example                   Environment variable template
```

---

## AI Agent Integration

This system is designed to be consumed by AI agents and automated systems. Key integration points:

**Polling approach (recommended for agents):**
1. Call `GET /alerts?since=<last_timestamp>` every 30-60 seconds to get new alerts
2. Call `GET /checkpoints` periodically to get current checkpoint status
3. Use `severity=critical` or `severity=high` for urgent-only mode
4. Use `GET /incidents/summary` for a compact situational overview

**Real-time approach:**
1. Connect to `WS /ws` for instant alert delivery (JSON messages)
2. Connect to `WS /checkpoints/ws` for instant checkpoint updates
3. Both streams send keepalive pings every 30 seconds
4. Reconnect on disconnect with exponential backoff

**Structured data for agents:**
- `GET /conditions` returns a complete snapshot combining alerts, checkpoints, weather, market, prayer times, internet status, and air quality in a single response
- `GET /checkpoints/geojson` returns checkpoint data as GeoJSON for map integration
- `GET /incidents?category=threats&hours=1` returns only recent missile/siren events
- `GET /zones` returns WB sub-zone definitions with polygon coordinates

**Webhook delivery:**
- Register a webhook via `POST /webhooks` with your endpoint URL
- Alerts are delivered as POST requests with JSON body and optional HMAC signature
- Configure `alert_types` and `min_severity` filters to reduce noise

**Authentication:**
- Public read endpoints require no authentication
- Admin and webhook management endpoints require an `X-API-Key` header matching the `API_SECRET_KEY` environment variable
