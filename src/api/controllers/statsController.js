import { listCategories, getUnifiedData, readJsonFile } from '../utils/fileService.js';
import { CATEGORIES } from '../../../scripts/utils/canonical-schema.js';
import { loadBaselines } from '../../../scripts/utils/baseline-analyzer.js';

/**
 * GET /api/v1/categories
 * List all available data categories
 */
export async function getCategories(req, res) {
    try {
        const available = await listCategories();
        res.json({
            categories: available,
            total: available.length,
            schema_version: '3.0.0',
        });
    } catch (error) {
        console.error('Error in getCategories:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

const ALERTS_API = process.env.ALERTS_API_URL || 'http://alerts:8080';

/**
 * GET /api/v1/stats
 * Cross-category aggregate statistics
 */
export async function getStats(req, res) {
    try {
        const available = await listCategories();

        const stats = {
            schema_version: '3.0.0',
            generated_at: new Date().toISOString(),
            categories: {},
            totals: {
                records: 0,
                killed: 0,
                injured: 0,
                displaced: 0,
                affected: 0,
                demolished: 0,
                detained: 0,
            },
        };

        for (const category of available) {
            try {
                const result = await getUnifiedData(category);
                const data = result?.data || [];
                const catStats = {
                    records: data.length,
                    killed: 0,
                    injured: 0,
                    displaced: 0,
                    affected: 0,
                    demolished: 0,
                    detained: 0,
                    date_range: { earliest: null, latest: null },
                };

                const dates = data.map(d => d.date).filter(Boolean).sort();
                if (dates.length) {
                    catStats.date_range.earliest = dates[0];
                    catStats.date_range.latest = dates[dates.length - 1];
                }

                for (const item of data) {
                    const m = item.metrics || {};
                    const killed = m.killed || item.fatalities || 0;
                    const injured = m.injured || item.injuries || 0;
                    catStats.displaced += m.displaced || 0;
                    catStats.affected += m.affected || 0;
                    catStats.demolished += m.demolished || 0;
                    catStats.detained += m.detained || 0;

                    // For conflict data: fatalities are cumulative per-region totals, not deltas
                    // Track max per region to avoid summing cumulative values
                    if (category === 'conflict') {
                        const region = item.location?.region || 'Unknown';
                        if (!catStats._maxByRegion) catStats._maxByRegion = {};
                        if (!catStats._maxByRegion[region]) catStats._maxByRegion[region] = { killed: 0, injured: 0 };
                        catStats._maxByRegion[region].killed = Math.max(catStats._maxByRegion[region].killed, killed);
                        catStats._maxByRegion[region].injured = Math.max(catStats._maxByRegion[region].injured, injured);
                    } else {
                        catStats.killed += killed;
                        catStats.injured += injured;
                    }
                }

                // For conflict: sum the max per-region values
                if (category === 'conflict' && catStats._maxByRegion) {
                    for (const region of Object.values(catStats._maxByRegion)) {
                        catStats.killed += region.killed;
                        catStats.injured += region.injured;
                    }
                    delete catStats._maxByRegion;
                }

                stats.categories[category] = catStats;
                stats.totals.records += catStats.records;
                stats.totals.killed += catStats.killed;
                stats.totals.injured += catStats.injured;
                stats.totals.displaced += catStats.displaced;
                stats.totals.affected += catStats.affected;
                stats.totals.demolished += catStats.demolished;
                stats.totals.detained += catStats.detained;
            } catch (err) {
                stats.categories[category] = { error: err.message };
            }
        }

        // Fetch Live Real-Time Checkpoints/Alerts Summary from Proxy Backend
        try {
            const liveRes = await fetch(`${ALERTS_API}/checkpoints/summary`);
            if (liveRes.ok) {
                const liveData = await liveRes.json();
                stats.live_status = {
                    active_checkpoints: liveData.total_active || 0,
                    currently_closed: liveData.by_status?.closed || 0,
                    severe_delays: liveData.by_status?.congested || 0
                };
            }
        } catch (e) {
            console.warn('Could not fetch live alerts for global stats summary:', e.message);
            stats.live_status = { active_checkpoints: 0, currently_closed: 0, severe_delays: 0, error: 'live service unavailable' };
        }

        // Baseline snapshot: top region/event_type keys with current 30d vs 90d weekly avg
        try {
            const baselines = await loadBaselines();
            if (baselines?.baselines) {
                const entries = Object.entries(baselines.baselines)
                    .filter(([, s]) => s.avg_weekly_90d > 0)
                    .map(([key, s]) => {
                        const weeklyRate = s.count_30d / (30 / 7);
                        const delta = ((weeklyRate - s.avg_weekly_90d) / s.avg_weekly_90d) * 100;
                        const trend = delta > 15 ? 'above' : delta < -15 ? 'below' : 'near';
                        return {
                            key,
                            count_30d: s.count_30d,
                            avg_weekly_90d: s.avg_weekly_90d,
                            trend_vs_baseline: trend,
                            delta_pct: Math.round(delta),
                        };
                    })
                    .sort((a, b) => b.count_30d - a.count_30d)
                    .slice(0, 10);
                stats.baseline_snapshot = {
                    window_ends: baselines.window_ends,
                    top_active: entries,
                };
            }
        } catch (e) {
            console.warn('Could not attach baseline snapshot:', e.message);
        }

        res.json(stats);

    } catch (error) {
        console.error('Error in getStats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
