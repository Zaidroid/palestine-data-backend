#!/usr/bin/env node

/**
 * Test Data Validation Utilities
 * 
 * Quick test to verify validation functions work correctly
 */

import { validateDataset, VALIDATION_SCHEMAS } from './utils/data-validator.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger({ context: 'ValidationTest', logLevel: 'INFO' });

// Test data samples
const testData = {
    casualties: [
        { date: '2023-10-07', killed: 10, injured: 25, location: 'Gaza', region: 'Gaza Strip' },
        { date: '2023-10-08', killed: 5, injured: 15, location: 'West Bank' },
        { date: '2023-10-09', killed: 0, injured: 3, location: 'Jerusalem', incident_type: 'raid' },
    ],

    demolitions: [
        { date: '2023-10-10', location: 'Hebron', structures: 2, structure_type: 'residential', people_affected: 8 },
        { date: '2023-10-11', location: 'Nablus', structures: 1, reason: 'punitive' },
    ],

    healthcare: [
        { date: '2023-10-12', facility_name: 'Al-Shifa Hospital', incident_type: 'bombing', facility_type: 'hospital', casualties: 5 },
        { date: '2023-10-13', facility_name: 'Gaza Clinic', incident_type: 'raid', damage: 'damaged' },
    ],

    worldbank: [
        { year: 2020, value: 15234.5, country: 'Palestine', indicator: 'NY.GDP.MKTP.CD' },
        { year: 2021, value: 16789.2, country: 'Palestine', indicator: 'NY.GDP.MKTP.CD' },
        { year: 2022, value: 18123.7, country: 'Palestine', indicator: 'NY.GDP.MKTP.CD' },
    ],

    // Invalid data for testing
    invalidCasualties: [
        { date: 'invalid-date', killed: 'not-a-number', injured: 10 },
        { killed: 5, injured: 3 }, // missing date
        { date: '2023-10-07', killed: -5, injured: 1000000 }, // out of range
    ],
};

async function runTests() {
    await logger.info('🧪 Testing Data Validation Utilities');
    await logger.info('====================================\n');

    let passedTests = 0;
    let failedTests = 0;

    // Test 1: Valid casualties data
    await logger.info('Test 1: Valid casualties data');
    try {
        const result = await validateDataset(testData.casualties, 'casualties');
        if (result.meetsThreshold && result.qualityScore > 0.9) {
            await logger.success(`✓ PASSED - Quality score: ${(result.qualityScore * 100).toFixed(1)}%`);
            passedTests++;
        } else {
            await logger.error(`✗ FAILED - Quality score too low: ${(result.qualityScore * 100).toFixed(1)}%`);
            failedTests++;
        }
    } catch (error) {
        await logger.error('✗ FAILED - Exception thrown', error);
        failedTests++;
    }

    // Test 2: Valid demolitions data
    await logger.info('\nTest 2: Valid demolitions data');
    try {
        const result = await validateDataset(testData.demolitions, 'demolitions');
        if (result.meetsThreshold) {
            await logger.success(`✓ PASSED - Quality score: ${(result.qualityScore * 100).toFixed(1)}%`);
            passedTests++;
        } else {
            await logger.error(`✗ FAILED - Quality score too low: ${(result.qualityScore * 100).toFixed(1)}%`);
            failedTests++;
        }
    } catch (error) {
        await logger.error('✗ FAILED - Exception thrown', error);
        failedTests++;
    }

    // Test 3: Valid healthcare data
    await logger.info('\nTest 3: Valid healthcare data');
    try {
        const result = await validateDataset(testData.healthcare, 'healthcare');
        if (result.meetsThreshold) {
            await logger.success(`✓ PASSED - Quality score: ${(result.qualityScore * 100).toFixed(1)}%`);
            passedTests++;
        } else {
            await logger.error(`✗ FAILED - Quality score too low: ${(result.qualityScore * 100).toFixed(1)}%`);
            failedTests++;
        }
    } catch (error) {
        await logger.error('✗ FAILED - Exception thrown', error);
        failedTests++;
    }

    // Test 4: Valid World Bank data
    await logger.info('\nTest 4: Valid World Bank data');
    try {
        const result = await validateDataset(testData.worldbank, 'worldbank');
        if (result.meetsThreshold && result.qualityScore === 1.0) {
            await logger.success(`✓ PASSED - Quality score: ${(result.qualityScore * 100).toFixed(1)}%`);
            passedTests++;
        } else {
            await logger.error(`✗ FAILED - Quality score: ${(result.qualityScore * 100).toFixed(1)}%`);
            failedTests++;
        }
    } catch (error) {
        await logger.error('✗ FAILED - Exception thrown', error);
        failedTests++;
    }

    // Test 5: Invalid data should fail validation
    await logger.info('\nTest 5: Invalid casualties data (should fail)');
    try {
        const result = await validateDataset(testData.invalidCasualties, 'casualties');
        if (!result.meetsThreshold && result.errors.length > 0) {
            await logger.success(`✓ PASSED - Correctly identified ${result.errors.length} errors`);
            passedTests++;
        } else {
            await logger.error('✗ FAILED - Should have failed validation');
            failedTests++;
        }
    } catch (error) {
        await logger.error('✗ FAILED - Exception thrown', error);
        failedTests++;
    }

    // Test 6: Schema detection
    await logger.info('\nTest 6: Schema detection');
    try {
        const schemas = ['casualties', 'demolitions', 'healthcare', 'worldbank', 'conflict', 'infrastructure', 'humanitarian', 'ngo'];
        let allFound = true;
        for (const schemaType of schemas) {
            if (!VALIDATION_SCHEMAS[schemaType]) {
                await logger.error(`✗ Schema not found: ${schemaType}`);
                allFound = false;
            }
        }
        if (allFound) {
            await logger.success(`✓ PASSED - All ${schemas.length} schemas found`);
            passedTests++;
        } else {
            await logger.error('✗ FAILED - Some schemas missing');
            failedTests++;
        }
    } catch (error) {
        await logger.error('✗ FAILED - Exception thrown', error);
        failedTests++;
    }

    // Test 7: Empty data handling
    await logger.info('\nTest 7: Empty data handling');
    try {
        const result = await validateDataset([], 'casualties');
        if (result.qualityScore === 0 && result.recordCount === 0) {
            await logger.success('✓ PASSED - Empty data handled correctly');
            passedTests++;
        } else {
            await logger.error('✗ FAILED - Empty data not handled correctly');
            failedTests++;
        }
    } catch (error) {
        await logger.error('✗ FAILED - Exception thrown', error);
        failedTests++;
    }

    // Summary
    await logger.info('\n====================================');
    await logger.info('Test Summary:');
    await logger.info(`  Total Tests: ${passedTests + failedTests}`);
    await logger.info(`  Passed: ${passedTests}`);
    await logger.info(`  Failed: ${failedTests}`);

    if (failedTests === 0) {
        await logger.success('\n✅ All tests passed!');
    } else {
        await logger.error(`\n❌ ${failedTests} test(s) failed`);
        process.exit(1);
    }

    await logger.logSummary();
}

runTests();
