import { getUnifiedData, getUnifiedMetadata, categoryExists } from '../utils/fileService.js';

/**
 * Get data for a specific category
 */
export async function getData(req, res) {
    try {
        const { category } = req.params;
        const {
            page = 1,
            limit = 50,
            location,
            start_date,
            end_date,
            sort_by = 'date',
            order = 'desc'
        } = req.query;

        if (!await categoryExists(category)) {
            return res.status(404).json({ error: 'Category not found' });
        }

        const result = await getUnifiedData(category);

        if (!result || !result.data) {
            return res.status(404).json({ error: 'Data not found' });
        }

        let data = result.data;

        // Filtering
        if (location) {
            data = data.filter(item =>
                item.location && typeof item.location === 'string' && item.location.toLowerCase().includes(location.toLowerCase())
            );
        }

        if (start_date) {
            data = data.filter(item => new Date(item.date) >= new Date(start_date));
        }

        if (end_date) {
            data = data.filter(item => new Date(item.date) <= new Date(end_date));
        }

        // Sorting
        data.sort((a, b) => {
            const valA = a[sort_by];
            const valB = b[sort_by];

            if (!valA) return 1;
            if (!valB) return -1;

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        // Pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = pageNum * limitNum;
        const paginatedData = data.slice(startIndex, endIndex);

        res.json({
            data: paginatedData,
            pagination: {
                total: data.length,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(data.length / limitNum)
            },
            metadata: result.metadata
        });

    } catch (error) {
        console.error('Error in getData:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get metadata for a category
 */
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
