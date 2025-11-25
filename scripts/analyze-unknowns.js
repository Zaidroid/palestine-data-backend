
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEARCH_INDEX_PATH = path.join(__dirname, '../public/data/search-index.json');

async function analyzeUnknowns() {
    console.log('Reading search index...');
    const content = JSON.parse(await fs.readFile(SEARCH_INDEX_PATH, 'utf-8'));
    const entries = content.index;

    const unknownStats = {};

    entries.forEach(entry => {
        const loc = entry.preview?.location;
        const region = loc?.region || 'Unknown';

        if (region === 'Unknown') {
            const cat = entry.category;
            if (!unknownStats[cat]) {
                unknownStats[cat] = { count: 0, examples: [] };
            }
            unknownStats[cat].count++;
            if (unknownStats[cat].examples.length < 3) {
                unknownStats[cat].examples.push({
                    id: entry.id,
                    text: entry.text,
                    preview: entry.preview
                });
            }
        }
    });

    console.log('\n--- Unknown Location Analysis ---');
    console.table(Object.entries(unknownStats).map(([cat, stats]) => ({ category: cat, count: stats.count })));

    console.log('\nExamples:');
    Object.entries(unknownStats).forEach(([cat, stats]) => {
        console.log(`\nCategory: ${cat}`);
        stats.examples.forEach(ex => {
            console.log(`  - [${ex.id}] ${ex.preview.title} (Loc: ${JSON.stringify(ex.preview.location)})`);
        });
    });
}

analyzeUnknowns().catch(console.error);
