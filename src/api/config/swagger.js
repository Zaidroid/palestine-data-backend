const CATEGORIES = [
    'water', 'martyrs_snapshot_2023', 'health', 'funding', 'education',
    'westbank', 'conflict', 'economic', 'infrastructure', 'refugees',
    'pcbs', 'land', 'culture', 'news',
];

const tagged = (tags, summary, params = [], extra = {}) => ({
    tags, summary, parameters: params,
    responses: {
        200: { description: 'Success', content: { 'application/json': {} } },
        404: { description: 'Not found' },
        503: { description: 'Upstream unavailable' },
    },
    ...extra,
});

const param = (name, where, description, schema = { type: 'string' }, required = false, example) => ({
    name, in: where, description, required, schema, ...(example !== undefined ? { example } : {}),
});

const categoryParam = param('category', 'path', 'Dataset category', { type: 'string', enum: CATEGORIES }, true, 'conflict');
const sinceParam = param('since', 'query', 'ISO date filter (records on/after)', { type: 'string', format: 'date' }, false, '2025-01-01');
const untilParam = param('until', 'query', 'ISO date filter (records on/before)', { type: 'string', format: 'date' }, false, '2026-01-01');
const limitParam = param('limit', 'query', 'Page size', { type: 'integer', default: 100, maximum: 1000 });
const offsetParam = param('offset', 'query', 'Pagination offset', { type: 'integer', default: 0 });
const regionParam = param('region', 'query', 'Filter by region', { type: 'string', enum: ['Gaza Strip', 'West Bank', 'East Jerusalem'] });

export const specs = {
    openapi: '3.0.0',
    info: {
        title: 'Palestine Data API',
        version: '1.0.0',
        description: [
            'Unified historical datasets + real-time operational alerts for Palestine.',
            '',
            '## What this API serves',
            '- **14 unified categories** of normalized historical data (~194k records): water, conflict, education, refugees, funding, etc.',
            '- **Real-time alerts proxy** (`/live/*`) for West Bank + Gaza events: sirens, raids, settler attacks, road closures, demolitions, checkpoint status.',
            '- **Live streams** via WebSocket (`wss://wb-alerts.zaidlab.xyz/ws`) and SSE (`/api/v1/live/stream`).',
            '',
            '## Authentication',
            'Most read endpoints are open and rate-limited per IP. Paid-tier endpoints (bulk export, premium webhooks) require an API key:',
            '```',
            'Authorization: Bearer YOUR_API_KEY',
            '```',
            '',
            '## Freshness & licensing',
            'Stale categories (>90 days since latest record) return a `Warning: 299` header and `metadata.stale: true`. Per-source licenses surfaced at `/licenses` — some sources are non-commercial (WHO, certain news, B\'Tselem records).',
            '',
            '## Quick start',
            '```bash',
            'curl https://api.zaidlab.xyz/api/v1/                    # endpoint index',
            'curl https://api.zaidlab.xyz/api/v1/categories          # available datasets',
            'curl https://api.zaidlab.xyz/api/v1/unified/conflict?limit=5',
            'curl https://api.zaidlab.xyz/api/v1/live/alerts/latest  # most recent alerts',
            'curl https://api.zaidlab.xyz/api/v1/live/checkpoints    # current checkpoint status',
            '```',
        ].join('\n'),
        contact: { name: 'Repository', url: 'https://github.com/zaidsalem/palestine-data-backend' },
        license: { name: 'Per-source (see /licenses)', url: 'https://api.zaidlab.xyz/api/v1/licenses' },
    },
    servers: [
        { url: 'https://api.zaidlab.xyz/api/v1', description: 'Production' },
        { url: 'http://localhost:7860/api/v1', description: 'Local' },
    ],
    tags: [
        { name: 'Discovery', description: 'Index, health, version, registries' },
        { name: 'Unified Data', description: 'Historical datasets across 14 categories' },
        { name: 'Search', description: 'Full-text search across all datasets' },
        { name: 'Gaza', description: 'Daily Gaza casualty bulletin' },
        { name: 'News', description: 'Aggregated news headlines (fair-use)' },
        { name: 'Live Alerts', description: 'Real-time West Bank + Gaza events (proxied from alerts service)' },
        { name: 'Live Checkpoints', description: 'Live checkpoint status + history' },
        { name: 'Live Context', description: 'Weather, market, prayer times, air quality, conditions' },
        { name: 'Trust', description: 'Snapshot pinning, citable IDs, license registry' },
        { name: 'Account', description: 'API key usage and billing (auth required)' },
    ],
    components: {
        securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', description: 'API key issued via Stripe checkout (paid tiers only)' },
        },
        schemas: {
            UnifiedRecord: {
                type: 'object',
                description: 'Canonical schema v3 — one record from any unified category',
                properties: {
                    id: { type: 'string', description: 'Deterministic stable_id (sha256 hash)' },
                    date: { type: 'string', format: 'date' },
                    category: { type: 'string', enum: CATEGORIES },
                    event_type: { type: 'string' },
                    location: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            governorate: { type: 'string', nullable: true },
                            region: { type: 'string' },
                            lat: { type: 'number', nullable: true },
                            lon: { type: 'number', nullable: true },
                            precision: { type: 'string', enum: ['exact', 'region'] },
                        },
                    },
                    metrics: { type: 'object', additionalProperties: true },
                    description: { type: 'string' },
                    sources: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                organization: { type: 'string' },
                                url: { type: 'string', nullable: true },
                                license: { type: 'string' },
                                fetched_at: { type: 'string', format: 'date-time' },
                            },
                        },
                    },
                },
            },
            UnifiedResponse: {
                type: 'object',
                properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/UnifiedRecord' } },
                    metadata: {
                        type: 'object',
                        properties: {
                            category: { type: 'string' },
                            total_records: { type: 'integer' },
                            returned_records: { type: 'integer' },
                            offset: { type: 'integer' },
                            limit: { type: 'integer' },
                            stale: { type: 'boolean' },
                            latest_record_at: { type: 'string', format: 'date' },
                            freshness_days_since_latest: { type: 'integer' },
                            generated_at: { type: 'string', format: 'date-time' },
                        },
                    },
                },
            },
            Alert: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    type: { type: 'string', enum: ['west_bank_siren', 'gaza_strike', 'regional_attack', 'idf_raid', 'settler_attack', 'road_closure', 'flying_checkpoint', 'injury_report', 'demolition', 'arrest_campaign'] },
                    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                    text: { type: 'string', description: 'Original Arabic text' },
                    text_en: { type: 'string', nullable: true },
                    area: { type: 'string', nullable: true },
                    zone: { type: 'string', nullable: true },
                    lat: { type: 'number', nullable: true },
                    lon: { type: 'number', nullable: true },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    source_reliability: { type: 'number', minimum: 0, maximum: 1 },
                    source: { type: 'string', description: 'Telegram channel name' },
                    timestamp: { type: 'string', format: 'date-time' },
                    status: { type: 'string', enum: ['active', 'retracted', 'corrected'] },
                },
            },
            Checkpoint: {
                type: 'object',
                properties: {
                    key: { type: 'string', example: 'hizma' },
                    name: { type: 'string', example: 'Hizma Checkpoint' },
                    name_ar: { type: 'string' },
                    region: { type: 'string', enum: ['north', 'middle', 'south'] },
                    status: { type: 'string', enum: ['open', 'closed', 'restricted', 'unknown'] },
                    last_update: { type: 'string', format: 'date-time' },
                    lat: { type: 'number' },
                    lon: { type: 'number' },
                },
            },
            Error: {
                type: 'object',
                properties: { error: { type: 'string' }, detail: { type: 'string' } },
            },
        },
    },
    paths: {
        '/': { get: tagged(['Discovery'], 'API index — list of all endpoints grouped by purpose') },
        '/health': { get: tagged(['Discovery'], 'Liveness probe') },
        '/health-deep': { get: tagged(['Discovery'], 'Pipeline freshness + alerts service connectivity') },
        '/version': { get: tagged(['Discovery'], 'Build SHA + pipeline generated-at timestamp') },
        '/categories': { get: tagged(['Discovery'], 'List of available unified categories with record counts') },
        '/stats': { get: tagged(['Discovery'], 'Cross-category aggregate statistics') },
        '/quality': { get: tagged(['Discovery'], 'Per-category freshness + coverage snapshot') },
        '/licenses': { get: tagged(['Discovery'], 'License registry for all data sources (commercial-use boolean, attribution text, SPDX-like ID)') },

        '/unified/{category}': {
            get: tagged(['Unified Data'], 'Paginated records from a category',
                [categoryParam, sinceParam, untilParam, regionParam,
                    param('location', 'query', 'Filter by location name (substring match)'),
                    param('event_type', 'query', 'Filter by event_type'),
                    limitParam, offsetParam,
                    param('as_of', 'query', 'Read from a pinned daily snapshot (YYYY-MM-DD)', { type: 'string', format: 'date' })],
                {
                    responses: {
                        200: { description: 'Paginated records', content: { 'application/json': { schema: { $ref: '#/components/schemas/UnifiedResponse' } } } },
                        404: { description: 'Unknown category' },
                    },
                }),
        },
        '/unified/{category}/summary': { get: tagged(['Unified Data'], 'Aggregated metrics for a category', [categoryParam, sinceParam, untilParam, regionParam]) },
        '/unified/{category}/timeseries': {
            get: tagged(['Unified Data'], 'Time-series buckets',
                [categoryParam,
                    param('metric', 'query', 'Metric to aggregate (count, sum of metrics.value, etc.)', { type: 'string', default: 'count' }),
                    param('interval', 'query', 'Bucket interval', { type: 'string', enum: ['day', 'week', 'month', 'year'], default: 'month' }),
                    regionParam, sinceParam, untilParam]),
        },
        '/unified/{category}/metadata': { get: tagged(['Unified Data'], 'Schema + provenance for a category', [categoryParam]) },

        '/search': {
            get: tagged(['Search'], 'Full-text search across all categories',
                [param('q', 'query', 'Search query', { type: 'string' }, true, 'Ramallah'),
                    param('category', 'query', 'Limit to a single category', { type: 'string', enum: CATEGORIES }),
                    limitParam]),
        },
        '/record/{category}/{id}': {
            get: tagged(['Trust'], 'Fetch one record by deterministic stable_id',
                [categoryParam, param('id', 'path', 'sha256-derived stable_id', { type: 'string' }, true)]),
        },
        '/snapshots': { get: tagged(['Trust'], 'List retained daily snapshots (used with ?as_of= on /unified routes)') },

        '/gaza/daily': {
            get: tagged(['Gaza'], 'Daily Gaza casualty bulletin with demographic breakdown',
                [param('since', 'query', 'Filter days on/after (YYYY-MM-DD)', { type: 'string', format: 'date' })]),
        },
        '/gaza/summary': { get: tagged(['Gaza'], 'Cumulative Gaza casualty summary') },

        '/news': {
            get: tagged(['News'], 'Aggregated news headlines from 11 outlets (Al Jazeera, BBC ME, Haaretz, ToI, Mondoweiss, Amnesty, HRW, ReliefWeb, MEE, MEMonitor, EI). Fair-use only — not redistributable.',
                [limitParam, param('source', 'query', 'Filter by outlet')]),
        },

        '/live/alerts/latest': {
            get: {
                tags: ['Live Alerts'],
                summary: 'Most recent alerts (capped at ~200)',
                parameters: [
                    param('limit', 'query', 'Page size', { type: 'integer', default: 50, maximum: 200 }),
                    param('min_confidence', 'query', 'Minimum confidence score', { type: 'number', minimum: 0, maximum: 1 }),
                ],
                responses: { 200: { description: 'Recent alerts', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Alert' } } } } } },
            },
        },
        '/live/alerts': {
            get: {
                tags: ['Live Alerts'],
                summary: 'Paginated alerts (with filters)',
                parameters: [
                    sinceParam, untilParam,
                    param('type', 'query', 'Filter by alert type', { type: 'string' }),
                    param('area', 'query', 'Filter by area name (substring)'),
                    param('zone', 'query', 'Filter by zone (north/middle/south or gaza_*)'),
                    param('min_confidence', 'query', 'Minimum confidence', { type: 'number' }),
                    param('per_page', 'query', 'Page size (max 200)', { type: 'integer', default: 50, maximum: 200 }),
                    param('page', 'query', 'Page number', { type: 'integer', default: 1 }),
                ],
                responses: { 200: { description: 'Paginated alerts', content: { 'application/json': {} } } },
            },
        },
        '/live/alerts/{id}': { get: tagged(['Live Alerts'], 'Fetch a single alert by ID', [param('id', 'path', 'Alert ID', { type: 'integer' }, true)]) },
        '/live/alerts/active': { get: tagged(['Live Alerts'], 'Currently-active alerts only (not retracted, recent)') },
        '/live/sirens': { get: tagged(['Live Alerts'], 'Recent siren events only') },
        '/live/incidents': { get: tagged(['Live Alerts'], 'Grouped incidents (alerts clustered by location/time)') },
        '/live/incidents/live': { get: tagged(['Live Alerts'], 'Currently-active incidents') },
        '/live/incidents/summary': { get: tagged(['Live Alerts'], 'Incident summary statistics') },
        '/live/areas/status': { get: tagged(['Live Alerts'], 'Per-area status across the West Bank') },
        '/live/areas/status/{region}': { get: tagged(['Live Alerts'], 'Area status for a specific region', [param('region', 'path', 'Region name', { type: 'string' }, true)]) },

        '/live/checkpoints': {
            get: {
                tags: ['Live Checkpoints'],
                summary: 'Current status of all checkpoints',
                responses: { 200: { description: 'Checkpoints', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Checkpoint' } } } } } },
            },
        },
        '/live/checkpoints/closed': { get: tagged(['Live Checkpoints'], 'Currently-closed checkpoints') },
        '/live/checkpoints/stats': { get: tagged(['Live Checkpoints'], 'Aggregate checkpoint statistics') },
        '/live/checkpoints/summary': { get: tagged(['Live Checkpoints'], 'Per-region checkpoint summary') },
        '/live/checkpoints/regions': { get: tagged(['Live Checkpoints'], 'List of regions with checkpoint counts') },
        '/live/checkpoints/geojson': { get: tagged(['Live Checkpoints'], 'All checkpoints as GeoJSON FeatureCollection') },
        '/live/checkpoints/nearby': {
            get: tagged(['Live Checkpoints'], 'Checkpoints near a coordinate',
                [param('lat', 'query', 'Latitude', { type: 'number' }, true, 31.9),
                    param('lon', 'query', 'Longitude', { type: 'number' }, true, 35.2),
                    param('radius_km', 'query', 'Search radius', { type: 'number', default: 10 })]),
        },
        '/live/checkpoints/{key}': { get: tagged(['Live Checkpoints'], 'Single checkpoint detail', [param('key', 'path', 'Checkpoint key', { type: 'string' }, true, 'hizma')]) },

        '/live/weather': { get: tagged(['Live Context'], 'Current weather across Palestine') },
        '/live/market': { get: tagged(['Live Context'], 'Market summary (currency + gold + fuel)') },
        '/live/market/currency': { get: tagged(['Live Context'], 'Currency exchange rates') },
        '/live/market/gold': { get: tagged(['Live Context'], 'Gold prices') },
        '/live/market/fuel': { get: tagged(['Live Context'], 'Fuel prices') },
        '/live/prayer-times': { get: tagged(['Live Context'], 'Daily prayer times') },
        '/live/air-quality': { get: tagged(['Live Context'], 'Air quality readings') },
        '/live/internet-status': { get: tagged(['Live Context'], 'ISP / internet availability status') },
        '/live/conditions': { get: tagged(['Live Context'], 'Combined daily-life conditions snapshot') },
        '/live/zones': { get: tagged(['Live Context'], 'Geographic zone definitions used in alerts') },
        '/live/stats/alerts': { get: tagged(['Live Alerts'], 'Aggregate alert statistics') },
        '/live/stats/today': { get: tagged(['Live Alerts'], 'Today\'s alert statistics') },
        '/live/stream': {
            get: {
                tags: ['Live Alerts'],
                summary: 'Server-Sent Events stream of alerts (text/event-stream). Use EventSource client.',
                responses: { 200: { description: 'SSE stream', content: { 'text/event-stream': {} } } },
            },
        },
        '/live/checkpoints/stream': { get: tagged(['Live Checkpoints'], 'SSE stream of checkpoint status changes') },
        '/live/areas/stream': { get: tagged(['Live Alerts'], 'SSE stream of per-area status changes') },

        '/me/usage': {
            get: {
                tags: ['Account'],
                summary: 'Current API key usage stats',
                security: [{ bearerAuth: [] }],
                responses: { 200: { description: 'Usage', content: { 'application/json': {} } }, 401: { description: 'Missing/invalid API key' } },
            },
        },
        '/billing/checkout': {
            post: {
                tags: ['Account'],
                summary: 'Create a Stripe Checkout session',
                requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { tier: { type: 'string', enum: ['journalist', 'ngo', 'enterprise'] } } } } } },
                responses: { 200: { description: 'Stripe checkout URL', content: { 'application/json': {} } } },
            },
        },
        '/billing/portal': {
            get: {
                tags: ['Account'],
                summary: 'Stripe billing portal URL for an existing customer',
                security: [{ bearerAuth: [] }],
                responses: { 200: { description: 'Portal URL', content: { 'application/json': {} } } },
            },
        },
        '/billing/status': { get: tagged(['Account'], 'Current subscription status (Stripe wiring deferred — returns scaffolded response)') },
    },
};
