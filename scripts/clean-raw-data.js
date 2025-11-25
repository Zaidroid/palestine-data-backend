import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');

const DIRS_TO_REMOVE = [
    'hdx',
    'who',
    'pcbs',
    'worldbank',
    'tech4palestine',
    'westbank',
    'historical',
    'news',
    'infrastructure',
    'culture',
    'land',
    'water' // The raw water directory, not unified/water
];

async function cleanRawData() {
    console.log('🧹 Cleaning raw data directories...');

    let totalFreed = 0;

    for (const dir of DIRS_TO_REMOVE) {
        const dirPath = path.join(DATA_DIR, dir);
        try {
            await fs.access(dirPath);

            // Calculate size before deleting (approximate)
            // We'll just delete it to be fast
            console.log(`Removing ${dir}...`);
            await fs.rm(dirPath, { recursive: true, force: true });
            console.log(`✅ Removed ${dir}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`❌ Error removing ${dir}:`, error.message);
            } else {
                console.log(`ℹ️  ${dir} already gone`);
            }
        }
    }

    console.log('✨ Raw data cleanup complete.');
}

cleanRawData();
