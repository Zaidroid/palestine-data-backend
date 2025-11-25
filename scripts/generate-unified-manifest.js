/**
 * Generate Unified Manifest
 * 
 * Scans the unified data directory and generates a comprehensive manifest
 * for the frontend to consume. This allows the frontend to know exactly
 * what data is available, its date range, and other metadata without
 * having to check multiple files.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNIFIED_DIR = path.join(__dirname, '../public/data/unified');
const MANIFEST_PATH = path.join(UNIFIED_DIR, 'unified-manifest.json');

async function generateManifest() {
    console.log('📋 Generating unified manifest...');

    const manifest = {
        generated_at: new Date().toISOString(),
        categories: {},
        total_records: 0,
        regions: new Set(),
    };

    try {
        // Get all category directories
        const entries = await fs.readdir(UNIFIED_DIR, { withFileTypes: true });
        const categories = entries.filter(e => e.isDirectory()).map(e => e.name);

        for (const category of categories) {
            const categoryPath = path.join(UNIFIED_DIR, category);
            const allDataPath = path.join(categoryPath, 'all-data.json');

            try {
                // Read all-data.json
                const fileContent = await fs.readFile(allDataPath, 'utf-8');
                const data = JSON.parse(fileContent);
                const records = data.data || [];

                if (records.length === 0) continue;

                // Calculate metadata for this category
                const dates = records.map(r => r.date).filter(d => d).sort();
                const categoryRegions = new Set(records.map(r => r.location?.region || r.location?.name).filter(r => r));

                // Add to global regions
                categoryRegions.forEach(r => manifest.regions.add(r));

                manifest.categories[category] = {
                    count: records.length,
                    date_range: {
                        start: dates[0] || null,
                        end: dates[dates.length - 1] || null,
                    },
                    regions: Array.from(categoryRegions).sort(),
                    last_updated: data.metadata?.generated_at || new Date().toISOString(),
                    sources: data.metadata?.sources || [],
                };

                manifest.total_records += records.length;
                console.log(`  ✓ ${category}: ${records.length} records`);

            } catch (error) {
                console.warn(`  ⚠️ Could not process ${category}: ${error.message}`);
            }
        }

        // Convert Set to Array for JSON
        manifest.regions = Array.from(manifest.regions).sort();

        // Write manifest
        await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
        console.log(`✅ Manifest generated at ${MANIFEST_PATH}`);
        console.log(`   Total records: ${manifest.total_records}`);
        console.log(`   Categories: ${Object.keys(manifest.categories).join(', ')}`);

    } catch (error) {
        console.error('❌ Error generating manifest:', error);
        process.exit(1);
    }
}

generateManifest();
