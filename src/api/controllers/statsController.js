import { listCategories, getUnifiedData, readJsonFile } from '../utils/fileService.js';
import { CATEGORIES } from '../../../scripts/utils/canonical-schema.js';

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

        await Promise.all(available.map(async (category) => {
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
                    catStats.killed += m.killed || 0;
                    catStats.injured += m.injured || 0;
                    catStats.displaced += m.displaced || 0;
                    catStats.affected += m.affected || 0;
                    catStats.demolished += m.demolished || 0;
                    catStats.detained += m.detained || 0;
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
        }));

        res.json(stats);

    } catch (error) {
        console.error('Error in getStats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
