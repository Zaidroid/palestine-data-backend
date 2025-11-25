import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');
const SEARCH_INDEX_PATH = path.join(DATA_DIR, 'search-index.json');
const SEARCH_INDEX_LITE_PATH = path.join(DATA_DIR, 'search-index-lite.json');

async function optimizeSearchIndex() {
    console.log('🔍 Optimizing search index...');

    try {
        const content = await fs.readFile(SEARCH_INDEX_PATH, 'utf-8');
        const searchData = JSON.parse(content);

        let items = [];
        if (Array.isArray(searchData)) {
            items = searchData;
        } else if (searchData.index && Array.isArray(searchData.index)) {
            items = searchData.index;
        }

        console.log(`Loaded ${items.length} items. Creating lite index...`);

        // Create lite index: ID, Title, Category only
        const liteItems = items.map(item => ({
            id: item.id,
            t: item.preview?.title || item.title || 'Unknown', // t for title (save bytes)
            c: item.category, // c for category
            // We might want a snippet or date?
            d: item.preview?.date // d for date
        }));

        await fs.writeFile(SEARCH_INDEX_LITE_PATH, JSON.stringify(liteItems), 'utf-8');

        const originalSize = (await fs.stat(SEARCH_INDEX_PATH)).size / 1024 / 1024;
        const liteSize = (await fs.stat(SEARCH_INDEX_LITE_PATH)).size / 1024 / 1024;

        console.log(`✅ Generated search-index-lite.json`);
        console.log(`Original: ${originalSize.toFixed(2)} MB`);
        console.log(`Lite:     ${liteSize.toFixed(2)} MB`);
        console.log(`Reduction: ${((1 - liteSize / originalSize) * 100).toFixed(1)}%`);

    } catch (error) {
        console.error('❌ Error optimizing search index:', error.message);
    }
}

optimizeSearchIndex();
