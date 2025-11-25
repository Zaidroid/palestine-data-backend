import MiniSearch from 'minisearch';
import { getSearchIndex } from '../utils/fileService.js';

let miniSearch = null;
let isReady = false;

/**
 * Initialize search index
 */
export async function initializeSearch() {
    console.log('Initializing search index...');
    try {
        const searchData = await getSearchIndex();

        if (!searchData) {
            console.error('Failed to load search index');
            return;
        }

        // Configure MiniSearch
        miniSearch = new MiniSearch({
            fields: ['text', 'category'], // fields to index for full-text search
            storeFields: ['id', 'category', 'preview', 'ref'], // fields to return with search results
            searchOptions: {
                boost: { text: 2, category: 1 },
                fuzzy: 0.2
            }
        });

        // Index data
        // Check if searchData is array or object with index property
        let items = [];
        if (Array.isArray(searchData)) {
            items = searchData;
        } else if (searchData.index && Array.isArray(searchData.index)) {
            items = searchData.index;
        }

        if (items.length > 0) {
            // Deduplicate items by ID
            const uniqueItems = Array.from(new Map(items.map(item => [item.id, item])).values());
            console.log(`Deduplicated ${items.length} items to ${uniqueItems.length} unique items`);

            // Add items in batches to avoid blocking event loop too long
            const BATCH_SIZE = 10000;
            for (let i = 0; i < uniqueItems.length; i += BATCH_SIZE) {
                const batch = uniqueItems.slice(i, i + BATCH_SIZE);
                miniSearch.addAll(batch);
                if (i % 50000 === 0) console.log(`Indexed ${i} items...`);
            }

            console.log(`Search index initialized with ${uniqueItems.length} items`);
            isReady = true;
        } else {
            console.warn('No items found to index');
        }

    } catch (error) {
        console.error('Error initializing search:', error);
    }
}

/**
 * Search the index
 * @param {string} query 
 * @param {object} options 
 */
export function search(query, options = {}) {
    if (!isReady || !miniSearch) {
        throw new Error('Search index not ready');
    }

    const defaultOptions = {
        fuzzy: 0.2,
        prefix: true,
        boost: { text: 2 },
        limit: 20
    };

    const searchOptions = { ...defaultOptions, ...options };

    return miniSearch.search(query, searchOptions);
}

export function isSearchReady() {
    return isReady;
}
