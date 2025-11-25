import { search, isSearchReady } from '../services/searchService.js';

/**
 * Search across all data
 */
export async function searchController(req, res) {
    try {
        const { q, limit = 20, fuzzy, category } = req.query;

        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        if (!isSearchReady()) {
            return res.status(503).json({ error: 'Search service is initializing, please try again shortly' });
        }

        const options = {
            limit: parseInt(limit)
        };

        if (fuzzy) {
            options.fuzzy = parseFloat(fuzzy);
        }

        if (category) {
            options.filter = (result) => result.category === category;
        }

        const results = search(q, options);

        res.json({
            query: q,
            count: results.length,
            results
        });

    } catch (error) {
        console.error('Error in search:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
