import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNIFIED_DIR = path.join(__dirname, '../public/data/unified');
const MAX_FILE_SIZE_MB = 10;

async function optimizeUnifiedData() {
    console.log('📦 Optimizing unified data...');

    const categories = await fs.readdir(UNIFIED_DIR);

    for (const category of categories) {
        const catDir = path.join(UNIFIED_DIR, category);
        const stats = await fs.stat(catDir);

        if (!stats.isDirectory()) continue;

        const allDataPath = path.join(catDir, 'all-data.json');

        try {
            const fileStats = await fs.stat(allDataPath);
            const sizeMB = fileStats.size / 1024 / 1024;

            if (sizeMB > MAX_FILE_SIZE_MB) {
                console.log(`⚠️  ${category}/all-data.json is ${sizeMB.toFixed(2)}MB. Checking for partitions...`);

                // Check if partitions exist
                const partitionsDir = path.join(catDir, 'partitions');
                try {
                    await fs.access(partitionsDir);
                    const partitions = await fs.readdir(partitionsDir);

                    if (partitions.length > 0) {
                        console.log(`✅ Partitions exist for ${category}. Removing large all-data.json...`);
                        await fs.unlink(allDataPath);
                        console.log(`🗑️  Deleted ${category}/all-data.json`);
                    } else {
                        console.warn(`⚠️  No partitions found for ${category}. Keeping large file.`);
                    }
                } catch {
                    console.warn(`⚠️  No partitions directory for ${category}. Keeping large file.`);
                }
            } else {
                console.log(`✅ ${category}/all-data.json is safe (${sizeMB.toFixed(2)}MB)`);
            }
        } catch (e) {
            // File might not exist, which is fine
        }
    }
}

optimizeUnifiedData();
