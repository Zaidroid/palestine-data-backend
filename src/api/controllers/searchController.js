import { search, isSearchReady } from '../services/searchService.js';

const MAX_LIMIT = 100;
const SEARCH_TIMEOUT_MS = 2000;

function withTimeout(work, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('search_timeout')), ms);
        Promise.resolve()
            .then(work)
            .then((value) => { clearTimeout(timer); resolve(value); })
            .catch((err) => { clearTimeout(timer); reject(err); });
    });
}

export async function searchController(req, res) {
    try {
        const { q, fuzzy, category } = req.query;

        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        if (!isSearchReady()) {
            return res.status(503).json({ error: 'Search service is initializing, please try again shortly' });
        }

        const requested = parseInt(req.query.limit ?? 20, 10);
        const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 20, MAX_LIMIT);

        const options = { limit };
        if (fuzzy) options.fuzzy = parseFloat(fuzzy);
        if (category) options.filter = (result) => result.category === category;

        const results = await withTimeout(() => search(q, options), SEARCH_TIMEOUT_MS);

        res.json({ query: q, count: results.length, limit, results });

    } catch (error) {
        if (error?.message === 'search_timeout') {
            return res.status(504).json({ error: 'Search timed out', limit_ms: SEARCH_TIMEOUT_MS });
        }
        (req.log || console).error({ err: error }, 'search_failed');
        res.status(500).json({ error: 'Internal server error' });
    }
}
