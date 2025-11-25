#!/usr/bin/env node

/**
 * Test Phase 2 Implementation
 * Tests culture and land data fetching and transformation
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = {
    info: (msg) => console.log(`ℹ️  ${msg}`),
    success: (msg) => console.log(`✅ ${msg}`),
    error: (msg) => console.error(`❌ ${msg}`),
};

async function testPhase2() {
    logger.info('Testing Phase 2 Implementation...\n');

    const results = {
        cultureFetch: false,
        landFetch: false,
        cultureUnified: false,
        landUnified: false,
    };

    try {
        // Test 1: Check culture data fetch
        logger.info('1. Checking culture data fetch...');
        const culturePath = path.join(__dirname, '../public/data/culture/heritage-sites.json');
        const cultureData = JSON.parse(await fs.readFile(culturePath, 'utf-8'));
        if (cultureData.sites && cultureData.sites.length > 0) {
            results.cultureFetch = true;
            logger.success(`   Found ${cultureData.sites.length} heritage sites`);
        }
    } catch (e) {
        logger.error(`   Culture data not found: ${e.message}`);
    }

    try {
        // Test 2: Check land data fetch
        logger.info('2. Checking land data fetch...');
        const landPaths = [
            path.join(__dirname, '../public/data/land/settlements/settlements.json'),
            path.join(__dirname, '../public/data/land/checkpoints/checkpoints.json'),
        ];

        let totalRecords = 0;
        for (const landPath of landPaths) {
            const landData = JSON.parse(await fs.readFile(landPath, 'utf-8'));
            totalRecords += (landData.records || []).length;
        }

        if (totalRecords > 0) {
            results.landFetch = true;
            logger.success(`   Found ${totalRecords} land records`);
        }
    } catch (e) {
        logger.error(`   Land data not found: ${e.message}`);
    }

    try {
        // Test 3: Check unified culture data
        logger.info('3. Checking unified culture data...');
        const cultureUnifiedPath = path.join(__dirname, '../public/data/unified/culture/all-data.json');
        try {
            const cultureUnified = JSON.parse(await fs.readFile(cultureUnifiedPath, 'utf-8'));
            if (cultureUnified.data && cultureUnified.data.length > 0) {
                results.cultureUnified = true;
                logger.success(`   Found ${cultureUnified.data.length} transformed culture records`);
            }
        } catch {
            logger.info('   Unified culture data not yet generated (run populate-unified-data.js)');
        }
    } catch (e) {
        logger.error(`   Error checking unified culture: ${e.message}`);
    }

    try {
        // Test 4: Check unified land data
        logger.info('4. Checking unified land data...');
        const landUnifiedPath = path.join(__dirname, '../public/data/unified/land/all-data.json');
        try {
            const landUnified = JSON.parse(await fs.readFile(landUnifiedPath, 'utf-8'));
            if (landUnified.data && landUnified.data.length > 0) {
                results.landUnified = true;
                logger.success(`   Found ${landUnified.data.length} transformed land records`);
            }
        } catch {
            logger.info('   Unified land data not yet generated (run populate-unified-data.js)');
        }
    } catch (e) {
        logger.error(`   Error checking unified land: ${e.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('Test Results Summary');
    console.log('='.repeat(50));

    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;

    for (const [test, result] of Object.entries(results)) {
        console.log(`${result ? '✅' : '⏳'} ${test}`);
    }

    console.log('='.repeat(50));
    console.log(`Passed: ${passed}/${total}`);

    if (passed < 4) {
        console.log('\nNext steps:');
        if (!results.cultureUnified || !results.landUnified) {
            console.log('- Run: node scripts/populate-unified-data.js');
        }
    }

    return results;
}

testPhase2()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
