# Frontend Build Prompt — West Bank Live Tracker

## What You're Building

A **real-time dashboard** for monitoring live conditions in the West Bank, Palestine. The system tracks two data streams simultaneously:

1. **Checkpoint Status** — 317 military/Israeli checkpoints across the West Bank (open, closed, congested, military presence, slow). Updated live from a monitored Telegram channel where local reporters and residents post updates every few minutes.

2. **Security Alerts** — Missile sirens, airstrikes, IDF raids, settler attacks, road closures, injury reports — classified and severity-scored in real-time from a monitored Arabic Telegram channel.

The backend is a live FastAPI server with WebSocket support. The UI must feel **alive** — data pulses, status cards flash when updated, counters animate, and the connection is always real-time. The audience are Palestinians navigating daily movement through checkpoints.

---

## Backend Base URL

```
http://[SERVER_IP]:8080
```

Replace `[SERVER_IP]` with the actual server IP. **Always use `window.location.hostname` to derive the API base URL dynamically** — never hardcode localhost. Like this:

```js
const API = `${location.protocol}//${location.hostname}:8080`;
const WS_BASE = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`;
```

---

## Real-Time Connections (WebSocket)

### Alert WebSocket — `WS /ws`

Connect to `WS_BASE + '/ws'`. Receives events immediately when a new security alert is detected.

**Messages received:**
```json
// New alert
{
  "event": "alert",
  "data": {
    "id": 42,
    "type": "west_bank_siren",
    "severity": "critical",
    "title": "West Bank Alert — Ramallah",
    "body": "صافرات في رام الله...",
    "source": "Almustashaar",
    "area": "Ramallah",
    "timestamp": "2026-04-03T14:30:00"
  }
}

// Keepalive (every 30s, no action needed)
{ "event": "ping", "ts": "2026-04-03T14:30:00" }
```

### Checkpoint WebSocket — `WS /checkpoints/ws`

Connect to `WS_BASE + '/checkpoints/ws'`. Fires only when a checkpoint status **actually changes**.

**Messages received:**
```json
{
  "event": "checkpoint_update",
  "updates": [
    {
      "canonical_key": "حواره",
      "name_raw": "حوارة",
      "status": "closed",
      "status_raw": "مغلق",
      "source_type": "admin",
      "timestamp": "2026-04-03T14:58:03"
    }
  ]
}

// Keepalive
{ "event": "ping", "ts": "..." }
```

**Auto-reconnect both WebSockets** with exponential backoff on disconnect.

---

## REST API Reference

### Health & System Status

#### `GET /health`
```json
{
  "status": "ok",
  "uptime_seconds": 422,
  "ws_clients": 2,
  "sse_clients": 0,
  "cp_ws_clients": 1,
  "cp_sse_clients": 0,
  "monitor": {
    "connected": true,
    "last_message_at": "2026-04-03T14:58:03",
    "messages_today": 47,
    "alerts_today": 3,
    "cp_updates_today": 44
  },
  "checkpoints": {
    "last_update": "2026-04-03T14:58:03",
    "is_stale": false
  },
  "timestamp": "2026-04-03T14:59:00"
}
```

---

### Checkpoint Endpoints

#### `GET /checkpoints/summary`
Lightweight snapshot for header/status bars. Poll every 30s.

```json
{
  "by_status": {
    "open": 229,
    "closed": 65,
    "congested": 6,
    "military": 17
  },
  "fresh_last_1h": 217,
  "fresh_last_6h": 217,
  "total_active": 317,
  "last_update": "2026-04-03T14:58:03",
  "is_data_stale": false,
  "snapshot_at": "2026-04-03T14:59:23"
}
```

#### `GET /checkpoints`
Full checkpoint list. Query params:
- `status` — filter: `open` | `closed` | `congested` | `military` | `slow`
- `region` — filter by region: `nablus` | `ramallah` | `hebron` | `bethlehem` | `tulkarm` | `jerusalem` | `salfit` | `qalqilya` | `jericho`
- `active` — `true` (default) = only checkpoints that have received updates
- `since` — ISO timestamp, only return checkpoints updated after this

**Each checkpoint object:**
```json
{
  "canonical_key": "عطاره",
  "name_ar": "عطاره",
  "name_en": "Atara",
  "region": "ramallah",
  "latitude": 32.015,
  "longitude": 35.187,
  "status": "closed",
  "status_raw": "مسكره",
  "confidence": "high",
  "crowd_reports_1h": 1,
  "last_updated": "2026-04-03T14:58:03",
  "last_source_type": "admin",
  "last_active_hours": 0.0,
  "is_stale": false
}
```

**Field meanings:**
- `status`: `open` | `closed` | `congested` | `military` | `slow` | `unknown`
- `confidence`: `high` = came from an admin/official reporter | `medium` = multiple crowd reports agree | `low` = single crowd report
- `last_source_type`: `admin` | `crowd`
- `last_active_hours`: hours since last update (float)
- `is_stale`: true if no update in 12+ hours
- `status_raw`: the original Arabic word/emoji that triggered this status (e.g. `مغلق`, `سالك`, `✅`, `❌`)
- `crowd_reports_1h`: number of crowd-sourced reports in the last hour

#### `GET /checkpoints/closed`
Shortcut — all closed checkpoints (same schema as above).

#### `GET /checkpoints/stats`
```json
{
  "total_checkpoints": 317,
  "total_directory": 854,
  "total_with_geo": 65,
  "by_status": { "open": 229, "closed": 65, "congested": 6, "military": 17 },
  "by_confidence": { "high": 280, "medium": 12, "low": 25 },
  "updates_last_1h": 217,
  "updates_last_24h": 799,
  "admin_updates_24h": 790,
  "monitored_channel": "ahwalaltreq",
  "snapshot_at": "2026-04-03T14:59:00"
}
```

#### `GET /checkpoints/regions`
```json
{
  "regions": [
    { "region": "nablus",     "total": 32, "active": 29 },
    { "region": "ramallah",   "total": 12, "active": 12 },
    { "region": "hebron",     "total": 7,  "active": 7  },
    { "region": "salfit",     "total": 5,  "active": 5  },
    { "region": "bethlehem",  "total": 3,  "active": 3  },
    { "region": "tulkarm",    "total": 2,  "active": 2  },
    { "region": "jerusalem",  "total": 2,  "active": 2  },
    { "region": "qalqilya",   "total": 1,  "active": 1  },
    { "region": "jericho",    "total": 1,  "active": 1  }
  ]
}
```

#### `GET /checkpoints/geojson`
GeoJSON FeatureCollection for map overlays. Only includes checkpoints with coordinates (~65 currently). Optional `?status=` filter.

```json
{
  "type": "FeatureCollection",
  "metadata": { "total": 7, "snapshot_at": "2026-04-03T14:59:58" },
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [35.187, 32.015] },
      "properties": {
        "canonical_key": "عطاره",
        "name_ar": "عطاره",
        "name_en": "Atara",
        "region": "ramallah",
        "status": "closed",
        "confidence": "high",
        "last_updated": "2026-04-03T14:58:03",
        "last_source_type": "admin"
      }
    }
  ]
}
```

#### `GET /checkpoints/{canonical_key}`
Single checkpoint + full history. Example: `GET /checkpoints/حواره`

```json
{
  "checkpoint": { /* full checkpoint object */ },
  "history": [
    {
      "id": 642,
      "canonical_key": "حواره",
      "name_raw": "حوارة",
      "status": "military",
      "status_raw": "شرطه",
      "source_type": "crowd",
      "source_channel": "ahwalaltreq",
      "raw_line": "شرطة ع شارع حوارة الجديد",
      "raw_message": "شرطة ع شارع حوارة الجديد",
      "timestamp": "2026-04-03T07:41:06",
      "created_at": "2026-04-03T14:42:33"
    }
  ],
  "total": 12
}
```

#### `GET /checkpoints/updates/feed`
Raw stream of every status report received. Query params: `source=admin|crowd`, `checkpoint=canonical_key`, `since=ISO`, `page`, `per_page`.

```json
{
  "updates": [
    {
      "id": 799,
      "canonical_key": "المجدل",
      "name_raw": "المجدل",
      "status": "open",
      "status_raw": "سالك",
      "source_type": "admin",
      "source_channel": "ahwalaltreq",
      "raw_line": "المجدل سالك",
      "timestamp": "2026-04-03T14:48:29",
      "created_at": "2026-04-03T14:48:33"
    }
  ],
  "total": 799,
  "page": 1,
  "per_page": 50
}
```

#### `GET /checkpoints/nearby?lat=32.15&lng=35.25&radius_km=10`
Checkpoints within radius of a point, sorted by distance. Same checkpoint schema plus `distance_km` field.

---

### Alert Endpoints

#### `GET /alerts/active?hours=2`
Alerts from the last N hours (default 2). Returns empty list when calm.

```json
{
  "alerts": [
    {
      "id": 11,
      "type": "regional_attack",
      "severity": "low",
      "title": "Regional Attack — Haifa",
      "body": "صواريخ على حيفا...",
      "source": "Almustashaar",
      "source_msg_id": 90024,
      "area": "Haifa",
      "raw_text": "...",
      "timestamp": "2026-04-03T14:00:00",
      "created_at": "2026-04-03T14:00:01",
      "event_subtype": null
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 200
}
```

**Alert `type` values:**
| Type | Meaning |
|------|---------|
| `west_bank_siren` | Missile siren / confirmed impact in the West Bank |
| `regional_attack` | Attack on neighboring MENA country or Israel interior |
| `idf_raid` | IDF forces entering a West Bank town |
| `settler_attack` | Settler violence against Palestinians |
| `road_closure` | Road/route closure by military |
| `flying_checkpoint` | Temporary / mobile checkpoint set up |
| `injury_report` | Confirmed casualties / injuries |

**Alert `severity` values:**
| Severity | Meaning |
|---------|---------|
| `critical` | Active threat in Ramallah area (configured city) |
| `high` | Confirmed attack anywhere in West Bank |
| `medium` | Nearby, unconfirmed, or movement reports |
| `low` | Regional/situational awareness only |

**`event_subtype`** — optional detail on `idf_raid` type:
- `arrest` — arrest operation
- `raid` — armed incursion / search

#### `GET /alerts?type=west_bank_siren&severity=high&area=Nablus&since=ISO&page=1&per_page=50`
Filtered alert list, paginated. Same alert schema.

#### `GET /alerts/latest?n=10`
Returns last N alerts (array, no pagination wrapper).

#### `GET /stats`
```json
{
  "total_alerts": 11,
  "alerts_last_24h": 11,
  "alerts_last_hour": 0,
  "by_type": {
    "west_bank_siren": 4,
    "regional_attack": 3,
    "idf_raid": 2,
    "rocket_attack": 2
  },
  "by_severity": { "critical": 1, "high": 4, "medium": 3, "low": 3 },
  "by_area": { "Ramallah": 3, "Nablus": 2, "Haifa": 1 },
  "monitored_channels": ["Almustashaar"],
  "uptime_seconds": 3600
}
```

---

## Status Color System

Use these consistently throughout the UI:

| Status | Color | Emoji | Arabic |
|--------|-------|-------|--------|
| `open` | Green `#3fb950` | ✅ | مفتوح / سالك |
| `closed` | Red `#f85149` | 🔴 ❌ | مغلق |
| `congested` | Orange `#d29922` | 🟠 | ازدحام / زحمة |
| `military` | Purple `#bc8cff` | 🟣 | جيش / عسكري |
| `slow` | Yellow `#e3b341` | 🟡 | بطيء |
| `unknown` | Gray `#8b949e` | ⬜ | غير معروف |

| Alert Severity | Color |
|---------------|-------|
| `critical` | Red `#f85149` + pulsing glow |
| `high` | Orange `#d29922` |
| `medium` | Yellow `#e3b341` |
| `low` | Muted gray `#8b949e` |

| Alert Type Color Accent |
|------------------------|
| `west_bank_siren` → Red |
| `idf_raid` → Purple |
| `settler_attack` → Orange |
| `road_closure` → Blue |
| `flying_checkpoint` → Blue |
| `injury_report` → Dark red |
| `regional_attack` → Gray |

---

## Confidence System

The `confidence` field tells you how reliable the checkpoint status is:

- `high` 🔒 — Came from a verified admin/official reporter (trust it)
- `medium` 🔑 — Multiple independent crowd reports agree
- `low` 💬 — Single crowd-sourced message (treat as unverified)

Visualize this as a small icon or opacity reduction on low-confidence cards.

---

## UI Concepts to Implement

### Core Views

**1. Command Center (default view)**
Full-screen dark dashboard. Split layout:
- Left sidebar: scrolling live alert feed, newest on top. Each alert card slides in with a subtle animation. Critical alerts have a red pulsing left border. The card shows: alert type badge, severity, title (English), area, time ago.
- Main area: checkpoint status grid — dense card layout, each card shows Arabic name, English name (if available), status badge with color, confidence icon, "X min ago" timestamp. Cards flash/pulse briefly when their status changes via WebSocket. Filter tabs at top (All / Open / Closed / Military / Congested). Search box filters in real-time.
- Top status bar: animated counters (Open: 229 ↑, Closed: 65, Military: 17, Congested: 6), connection indicator (green pulsing dot = WebSocket live), last update timestamp.

**2. Map View**
Interactive map (use Leaflet.js with a dark tile layer like CartoDB Dark Matter) centered on the West Bank (~lat 31.9, lng 35.2, zoom 9).
- Colored circle markers for each checkpoint with coordinates (~65 checkpoints have geo data)
- Marker color = status color
- Click a marker → side panel slides in with checkpoint name, current status, confidence, last update, and the last 5 status history entries
- Animate markers with a brief pulse when they receive a live update via WebSocket
- Legend overlay in corner

**3. Alert Detail / Expanded View**
Clicking an alert card expands or navigates to a detail view showing:
- Alert type, severity badge, area
- Full Arabic original text (`raw_text` field)
- Source channel, timestamp
- A "related checkpoints" section if the area matches any checkpoint regions

**4. Region Drill-Down**
Click a region name (Nablus, Ramallah, Hebron, etc.) to filter the checkpoint grid to just that region. Show a mini header: "Nablus — 29 active checkpoints — 24 open / 5 closed / 0 military"

---

### Animations & Interactions

- **Status change flash**: when a checkpoint WebSocket update arrives, the card briefly flashes from its current background to a bright highlight (blue or status color) then fades back. Duration: ~600ms.
- **Alert slide-in**: new alert cards slide down from the top of the feed with a smooth ease-out, pushing older cards down.
- **Counter animations**: when checkpoint counts change, the numbers animate (count up/down) smoothly over 400ms.
- **Critical alert pulse**: `critical` severity alerts have a slow red box-shadow pulse animation on loop.
- **Connection status**: top-right badge — "🟢 Live" (WebSocket connected), "🟡 Polling" (fallback), "🔴 Reconnecting" (retry). Animate the dot for live.
- **Ticker bar**: optional bottom strip showing the last event received: `"✅ حوارة → Open (admin) — 2m ago"` — slides in from the right like a news ticker.
- **Map marker pulse**: when a checkpoint's marker updates via WebSocket, it does a brief ripple animation (CSS keyframe expanding circle that fades).
- **Staleness indicator**: checkpoints with `is_stale: true` get a subtle desaturated/dimmed look and a small ⚠️ icon.

---

### Key UX Principles

1. **Bilingual**: Arabic names are primary (show large), English names secondary (smaller, muted). UI chrome can be English. Checkpoint names must render correctly in Arabic script.
2. **RTL aware**: Arabic text should render right-to-left. Use `dir="rtl"` on Arabic text elements but don't flip the whole layout.
3. **Dark theme only**: This is a professional monitoring tool. Use a dark background (#0d1117 or similar). Color is used only for status, not decoration.
4. **Density**: Users need to scan many checkpoints quickly. Cards should be compact. Prioritize information density over whitespace.
5. **Always-on**: The system never needs manual refresh. WebSocket keeps everything live. Show clearly when the connection is live vs polling.
6. **Mobile-friendly**: The map view and checkpoint grid should work on phone for someone actually at a checkpoint needing to check nearby status.

---

## Data Polling Strategy

Use WebSockets as primary. Fall back to polling if WebSocket fails:

```js
// Initial load
GET /checkpoints?active=true           // all checkpoints
GET /alerts/latest?n=20                // recent alert history

// WebSocket (primary real-time)
WS  /ws                                // new alerts
WS  /checkpoints/ws                    // checkpoint status changes

// Polling fallback (if WebSocket unavailable)
GET /checkpoints/summary               // every 30s (lightweight)
GET /alerts/active?hours=2             // every 60s
GET /checkpoints?since={lastPoll}      // every 30s for changed items only

// Periodic full refresh (even with WebSocket active)
GET /checkpoints                       // every 5 minutes (catch anything missed)
GET /alerts                            // every 2 minutes
```

---

## Example: Handling a Live Checkpoint Update

```js
ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.event !== 'checkpoint_update') return;

  for (const upd of msg.updates) {
    // upd = { canonical_key, name_raw, status, status_raw, source_type, timestamp }

    // 1. Update your local state
    checkpoints[upd.canonical_key] = {
      ...checkpoints[upd.canonical_key],
      status: upd.status,
      last_updated: upd.timestamp,
      last_source_type: upd.source_type,
      last_active_hours: 0,
      is_stale: false,
    };

    // 2. Flash the card in the UI
    const card = document.getElementById(`cp-${upd.canonical_key}`);
    card?.classList.add('status-changed');
    setTimeout(() => card?.classList.remove('status-changed'), 600);

    // 3. Update summary counter
    updateSummaryCounts();

    // 4. Update ticker
    showTicker(`${statusEmoji(upd.status)} ${upd.name_raw} → ${statusLabel(upd.status)}`);
  }
};
```

---

## Tech Stack Suggestions

- **Framework**: React + TypeScript, or Vue 3, or SvelteKit — any modern framework works
- **Styling**: Tailwind CSS (fastest for dark/dense UIs) or CSS modules
- **Map**: Leaflet.js with CartoDB Dark Matter tiles (free, no API key) — import via CDN
- **WebSocket**: Native browser WebSocket API — no library needed
- **State**: Zustand (React) or Pinia (Vue) for checkpoint/alert store
- **Animations**: Framer Motion (React) or CSS keyframes for card transitions

---

## Notes for Accuracy

- All checkpoint `canonical_key` values are Arabic (e.g. `حواره`, `عين_سينيا`) — use them as React keys and DOM IDs
- `status_raw` is the original Arabic word/emoji that triggered the status — useful to show as a tooltip or sub-label
- The `history` array in single checkpoint endpoint is newest-first
- `crowd_reports_1h` can be used to show "3 people reported this" style social proof
- `last_active_hours: 0.0` means updated within the last few minutes — show as "just now"
- About 65 of 317 checkpoints currently have coordinates — the map will show those 65, the grid shows all 317
- Alert `body` may be in Arabic — use `dir="auto"` on the text element
- The server has CORS enabled for all origins (`*`) — no proxy needed
