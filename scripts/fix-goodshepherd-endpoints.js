#!/usr/bin/env node

/**
 * Safe Endpoint Replacer for GoodShepherd Data Fetcher
 * 
 * This script updates hardcoded API endpoints in fetch-goodshepherd-data.js
 * to use the correct URLs provided by the user.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_FILE = path.join(__dirname, 'fetch-goodshepherd-data.js');

// Endpoint replacements mapping
const ENDPOINT_REPLACEMENTS = {
    "'/child_prisoners.json'": "'/api/child_prisoners.json'",
    "'/prisoner_data.json'": "'/api/prisoner_data.json'",
    "'/home_demolitions.json'": "'/api/home_demolitions.json'",
    "'/wb_data.json'": "'/api/wb_data.json'",
    "'/healthcare_attacks.json'": "'/api/healthcare_attacks.json'",
    "'/ngo_data.json'": "'/api/ngo_data.json'",
};

async function main() {
    console.log('🔧 GoodShepherd Endpoint Replacer\n');

    try {
        // Read the file
        console.log(`📖 Reading ${TARGET_FILE}...`);
        let content = await fs.readFile(TARGET_FILE, 'utf-8');
        const originalSize = content.length;

        // Perform replacements
        let replacementCount = 0;
        for (const [oldEndpoint, newEndpoint] of Object.entries(ENDPOINT_REPLACEMENTS)) {
            const regex = new RegExp(oldEndpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            const matches = content.match(regex);

            if (matches) {
                console.log(`  ✓ Replacing ${oldEndpoint} → ${newEndpoint} (${matches.length} occurrence(s))`);
                content = content.replace(regex, newEndpoint);
                replacementCount += matches.length;
            } else {
                console.log(`  ℹ No matches found for ${oldEndpoint}`);
            }
        }

        if (replacementCount === 0) {
            console.log('\n⚠️  No replacements made. Endpoints may already be correct.');
            return;
        }

        // Verify file size didn't change dramatically (safety check)
        const newSize = content.length;
        const sizeDiff = Math.abs(newSize - originalSize);
        const sizeChangePercent = (sizeDiff / originalSize) * 100;

        if (sizeChangePercent > 5) {
            throw new Error(`File size changed by ${sizeChangePercent.toFixed(2)}% - aborting for safety`);
        }

        // Create backup
        const backupFile = TARGET_FILE + '.backup';
        console.log(`\n💾 Creating backup: ${backupFile}`);
        await fs.copyFile(TARGET_FILE, backupFile);

        // Write updated content
        console.log(`💾 Writing updated file...`);
        await fs.writeFile(TARGET_FILE, content, 'utf-8');

        console.log(`\n✅ Successfully updated ${replacementCount} endpoint(s)!`);
        console.log(`📄 Backup saved as: ${path.basename(backupFile)}`);
        console.log('\n🧪 Next step: Run "node scripts/fetch-goodshepherd-data.js" to test');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

main();
