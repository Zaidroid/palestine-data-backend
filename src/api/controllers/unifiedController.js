import { getUnifiedData, getUnifiedMetadata, categoryExists } from '../utils/fileService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesLocation(item, locationQuery) {
    if (!locationQuery) return true;
    const q = locationQuery.toLowerCase();
    const loc = item.location;
    if (!loc) return false;
    const name = (loc.name || '').toLowerCase();
    const region = (loc.region || '').toLowerCase();
    const gov = (loc.governorate || '').toLowerCase();
    return name.includes(q) || region.includes(q) || gov.includes(q);
}

function selectFields(item, fields) {
    if (!fields) return item;
    const wanted = fields.split(',').map(f => f.trim()).filter(Boolean);
    const result = {};
    wanted.forEach(f => { if (f in item) result[f] = item[f]; });
    return result;
}

// ---------------------------------------------------------------------------
// GET /unified/:category
// ---------------------------------------------------------------------------
export async function getData(req, res) {
    try {
        const { category } = req.params;
        const {
            page = 1,
            limit = 50,
            location,
            region,
            event_type,
            start_date,
            end_date,
            min_killed,
            fields,
            sort_by = 'date',
            order = 'desc',
        } = req.query;

        if (!await categoryExists(category)) {
            return res.status(404).json({ error: 'Category not found' });
        }

        const result = await getUnifiedData(category);

        if (!result || !result.data) {
            return res.status(404).json({ error: 'Data not found' });
        }

        let data = result.data;

        // --- Filtering ---
        if (location) {
            data = data.filter(item => matchesLocation(item, location));
        }

        if (region) {
            const r = region.toLowerCase();
            data = data.filter(item => (item.location?.region || '').toLowerCase().includes(r));
        }

        if (event_type) {
            data = data.filter(item => item.event_type === event_type);
        }

        if (start_date) {
            const d = new Date(start_date);
            data = data.filter(item => new Date(item.date) >= d);
        }

        if (end_date) {
            const d = new Date(end_date);
            data = data.filter(item => new Date(item.date) <= d);
        }

        if (min_killed) {
            const mk = parseInt(min_killed);
            data = data.filter(item => (item.metrics?.killed || 0) >= mk);
        }

        // --- Sorting ---
        data.sort((a, b) => {
            let valA, valB;
            // Support nested dot paths like metrics.killed
            if (sort_by.includes('.')) {
                const [obj, key] = sort_by.split('.');
                valA = a[obj]?.[key];
                valB = b[obj]?.[key];
            } else {
                valA = a[sort_by];
                valB = b[sort_by];
            }

            if (valA == null) return 1;
            if (valB == null) return -1;
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        // --- Pagination ---
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(500, Math.max(1, parseInt(limit)));
        const startIndex = (pageNum - 1) * limitNum;
        const paginatedData = data.slice(startIndex, startIndex + limitNum);

        // --- Field selection ---
        const responseData = fields
            ? paginatedData.map(item => selectFields(item, fields))
            : paginatedData;

        res.json({
            data: responseData,
            pagination: {
                total: data.length,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(data.length / limitNum),
            },
            metadata: result.metadata,
        });

    } catch (error) {
        console.error('Error in getData:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// ---------------------------------------------------------------------------
// GET /unified/:category/metadata
// ---------------------------------------------------------------------------
export async function getMetadata(req, res) {
    try {
        const { category } = req.params;

        if (!await categoryExists(category)) {
            return res.status(404).json({ error: 'Category not found' });
        }

        const metadata = await getUnifiedMetadata(category);

        if (!metadata) {
            return res.status(404).json({ error: 'Metadata not found' });
        }

        res.json(metadata);

    } catch (error) {
        console.error('Error in getMetadata:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// ---------------------------------------------------------------------------
// GET /unified/:category/summary
// ---------------------------------------------------------------------------
export async function getSummary(req, res) {
    try {
        const { category } = req.params;

        if (!await categoryExists(category)) {
            return res.status(404).json({ error: 'Category not found' });
        }

        const result = await getUnifiedData(category);
        if (!result?.data) {
            return res.status(404).json({ error: 'Data not found' });
        }

        const data = result.data;
        const summary = {
            category,
            total_records: data.length,
            date_range: {
                earliest: null,
                latest: null,
            },
            metrics_totals: {
                killed: 0, injured: 0, displaced: 0, affected: 0,
                demolished: 0, detained: 0, count: 0,
            },
            by_region: {},
            by_event_type: {},
        };

        // Find date range
        const dates = data.map(d => d.date).filter(Boolean).sort();
        if (dates.length) {
            summary.date_range.earliest = dates[0];
            summary.date_range.latest = dates[dates.length - 1];
        }

        // Aggregate metrics and group-bys
        for (const item of data) {
            const m = item.metrics || {};
            summary.metrics_totals.killed += m.killed || 0;
            summary.metrics_totals.injured += m.injured || 0;
            summary.metrics_totals.displaced += m.displaced || 0;
            summary.metrics_totals.affected += m.affected || 0;
            summary.metrics_totals.demolished += m.demolished || 0;
            summary.metrics_totals.detained += m.detained || 0;
            summary.metrics_totals.count += m.count || 0;

            const regionKey = item.location?.region || 'Unknown';
            summary.by_region[regionKey] = (summary.by_region[regionKey] || 0) + 1;

            const etKey = item.event_type || 'unknown';
            summary.by_event_type[etKey] = (summary.by_event_type[etKey] || 0) + 1;
        }

        res.json(summary);

    } catch (error) {
        console.error('Error in getSummary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// ---------------------------------------------------------------------------
// GET /unified/:category/timeseries
// ---------------------------------------------------------------------------
export async function getTimeseries(req, res) {
    try {
        const { category } = req.params;
        const { metric = 'killed', interval = 'month', region } = req.query;

        if (!await categoryExists(category)) {
            return res.status(404).json({ error: 'Category not found' });
        }

        const result = await getUnifiedData(category);
        if (!result?.data) {
            return res.status(404).json({ error: 'Data not found' });
        }

        let data = result.data.filter(item => item.date);

        if (region) {
            const r = region.toLowerCase();
            data = data.filter(item => (item.location?.region || '').toLowerCase().includes(r));
        }

        // Build time buckets
        const buckets = {};
        for (const item of data) {
            const d = new Date(item.date);
            let key;
            if (interval === 'year') {
                key = `${d.getUTCFullYear()}`;
            } else if (interval === 'week') {
                // ISO week
                const dayOfYear = Math.floor((d - new Date(d.getUTCFullYear(), 0, 0)) / 86400000);
                const week = Math.ceil(dayOfYear / 7);
                key = `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
            } else {
                // default: month
                key = `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
            }

            if (!buckets[key]) buckets[key] = { date: key, value: 0, count: 0 };

            // Accumulate the requested metric
            const metricVal = item.metrics?.[metric] ?? item[metric] ?? 0;
            buckets[key].value += typeof metricVal === 'number' ? metricVal : 0;
            buckets[key].count += 1;
        }

        const series = Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));

        res.json({
            category,
            metric,
            interval,
            region: region || 'all',
            data: series,
        });

    } catch (error) {
        console.error('Error in getTimeseries:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
