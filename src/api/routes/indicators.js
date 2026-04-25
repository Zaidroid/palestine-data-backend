/**
 * /api/v1/indicators — long-term socioeconomic + humanitarian indicators.
 *
 * Combines:
 *   - World Bank combined indicators for West Bank and Gaza (2,501
 *     indicators × time series)
 *   - FAO DIEM household surveys (PSE-only rows across 4 themes)
 *
 * Public reads. Backed by public/data/indicators/*.json refreshed
 * nightly by scripts/sources/{world-bank-wbg,fao-diem-pse}.js.
 *
 * Endpoints:
 *   GET /indicators                              — index
 *   GET /indicators/world-bank                   — list of all indicator codes
 *       ?q=<substring>&limit=&offset=
 *   GET /indicators/world-bank/:code             — time series for one indicator
 *   GET /indicators/fao-diem/:theme              — DIEM rows for a theme
 *       (theme ∈ food-security|income-shocks|livestock|crop)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/indicators');

const router = express.Router();

const FAO_THEMES = new Set(['food-security', 'income-shocks', 'livestock', 'crop']);

const cache = new Map();

async function loadFile(filename) {
    const target = path.join(DATA_DIR, filename);
    let stat;
    try { stat = await fs.stat(target); } catch { return null; }
    const cached = cache.get(filename);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(target, 'utf8'));
    cache.set(filename, { mtimeMs: stat.mtimeMs, data });
    return data;
}

router.get('/', async (_req, res) => {
    const wbList = await loadFile('world-bank-wbg-list.json');
    const fao = await loadFile('fao-diem-pse-manifest.json');
    res.json({
        sources: [
            {
                source: 'world-bank',
                name: 'World Bank Combined Indicators for West Bank and Gaza',
                indicator_count: wbList?.indicator_count ?? 0,
                attribution: wbList?.attribution || 'World Bank via HDX (CC-BY-4.0).',
                endpoints: {
                    list:        '/api/v1/indicators/world-bank',
                    time_series: '/api/v1/indicators/world-bank/:code',
                    search:      '/api/v1/indicators/world-bank?q=<substring>',
                },
            },
            {
                source: 'fao-diem',
                name: 'FAO DIEM Household Surveys (PSE)',
                themes: (fao?.themes || []).map(t => ({
                    theme: t.theme,
                    pse_rows: t.pse_rows,
                    endpoint: `/api/v1/indicators/fao-diem/${t.theme}`,
                })),
                attribution: 'FAO via HDX.',
            },
        ],
    });
});

router.get('/world-bank', async (req, res) => {
    const list = await loadFile('world-bank-wbg-list.json');
    if (!list) return res.status(503).json({ error: 'data_unavailable' });
    let items = list.indicators || [];
    const q = String(req.query.q || '').toLowerCase();
    if (q) items = items.filter(i => i.name.toLowerCase().includes(q)
                                   || i.code.toLowerCase().includes(q));
    const total  = items.length;
    const limit  = Math.min(parseInt(req.query.limit, 10) || 200, 5000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json({
        attribution: list.attribution,
        total, limit, offset,
        indicators: items.slice(offset, offset + limit),
    });
});

router.get('/world-bank/:code', async (req, res) => {
    const all = await loadFile('world-bank-wbg-by-indicator.json');
    if (!all) return res.status(503).json({ error: 'data_unavailable' });
    const code = String(req.params.code || '');
    const series = all[code];
    if (!series) {
        return res.status(404).json({
            error: 'unknown_indicator',
            hint: 'List candidates via /api/v1/indicators/world-bank?q=<substring>',
        });
    }
    res.json({
        code: series.code,
        name: series.name,
        latest_year: series.latest_year,
        attribution: 'World Bank via HDX (CC-BY-4.0).',
        values: series.values,
    });
});

router.get('/fao-diem/:theme', async (req, res) => {
    const theme = String(req.params.theme || '').toLowerCase();
    if (!FAO_THEMES.has(theme)) {
        return res.status(404).json({
            error: 'unknown_theme',
            available: [...FAO_THEMES],
        });
    }
    const data = await loadFile(`fao-diem-pse-${theme}.json`);
    if (!data) return res.status(503).json({ error: 'data_unavailable' });
    res.json({
        theme,
        attribution: data.attribution,
        source_dataset: data.source_dataset,
        source_url: data.source_url,
        row_count: data.row_count,
        rows: data.rows,
    });
});

export default router;
