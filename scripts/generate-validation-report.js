#!/usr/bin/env node

/**
 * Generate Validation Report
 * 
 * Scans all data sources and generates a comprehensive validation report
 * 
 * Usage: node scripts/generate-validation-report.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { generateValidationReport } from './utils/validation-report-generator.js';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');
const OUTPUT_PATH = path.join(DATA_DIR, 'validation-report.json');

const logger = createLogger({ 
  context: 'ValidationReport',
  logLevel: 'INFO',
});

async function main() {
  await logger.info('🔍 Validation Report Generator');
  await logger.info('================================');
  await logger.info(`Data Directory: ${DATA_DIR}`);
  await logger.info(`Output: ${OUTPUT_PATH}`);
  
  try {
    const report = await generateValidationReport(DATA_DIR, OUTPUT_PATH);
    
    await logger.success('✅ Validation report generated successfully!');
    
    // Display key findings
    await logger.info('\n📊 Key Findings:');
    await logger.info('================');
    
    // Overall statistics
    await logger.info('\nOverall Statistics:');
    await logger.info(`  Total Datasets: ${report.summary.totalDatasets}`);
    await logger.info(`  Passed: ${report.summary.passedValidation} (${report.summary.passRate})`);
    await logger.info(`  Failed: ${report.summary.failedValidation}`);
    await logger.info(`  Average Quality Score: ${(report.summary.averageQualityScore * 100).toFixed(1)}%`);
    await logger.info(`  Average Completeness: ${(report.summary.averageCompleteness * 100).toFixed(1)}%`);
    await logger.info(`  Average Consistency: ${(report.summary.averageConsistency * 100).toFixed(1)}%`);
    await logger.info(`  Average Accuracy: ${(report.summary.averageAccuracy * 100).toFixed(1)}%`);
    
    // By source
    await logger.info('\nBy Data Source:');
    for (const [source, stats] of Object.entries(report.bySource)) {
      if (stats.datasets > 0) {
        await logger.info(`  ${source}:`);
        await logger.info(`    Datasets: ${stats.datasets}`);
        await logger.info(`    Passed: ${stats.passed}`);
        await logger.info(`    Failed: ${stats.failed}`);
        await logger.info(`    Avg Quality: ${(stats.averageQualityScore * 100).toFixed(1)}%`);
        await logger.info(`    Errors: ${stats.totalErrors}`);
        await logger.info(`    Warnings: ${stats.totalWarnings}`);
      }
    }
    
    // Quality issues
    if (report.qualityIssues.failedValidationDatasets > 0) {
      await logger.warn('\n⚠️  Quality Issues:');
      await logger.warn(`  Low Quality Datasets: ${report.qualityIssues.lowQualityDatasets}`);
      await logger.warn(`  High Error Count: ${report.qualityIssues.highErrorCountDatasets}`);
      await logger.warn(`  Low Completeness: ${report.qualityIssues.lowCompletenessDatasets}`);
      await logger.warn(`  Failed Validation: ${report.qualityIssues.failedValidationDatasets}`);
      
      // Show top 5 datasets with issues
      if (report.qualityIssues.details.failedValidation.length > 0) {
        await logger.warn('\n  Top Datasets with Issues:');
        report.qualityIssues.details.failedValidation.slice(0, 5).forEach((dataset, i) => {
          logger.warn(`    ${i + 1}. ${dataset.source}/${dataset.dataset}`);
          logger.warn(`       Quality: ${(dataset.qualityScore * 100).toFixed(1)}%, Errors: ${dataset.errorCount}`);
        });
      }
    }
    
    // Common errors
    if (report.commonErrors.length > 0) {
      await logger.info('\n🔴 Top 5 Common Errors:');
      report.commonErrors.slice(0, 5).forEach((error, i) => {
        logger.info(`  ${i + 1}. ${error.field}: ${error.message}`);
        logger.info(`     Affected Records: ${error.affectedRecords}`);
        logger.info(`     Sources: ${error.sources.join(', ')}`);
      });
    }
    
    // Common warnings
    if (report.commonWarnings.length > 0) {
      await logger.info('\n⚠️  Top 5 Common Warnings:');
      report.commonWarnings.slice(0, 5).forEach((warning, i) => {
        logger.info(`  ${i + 1}. ${warning.field}: ${warning.message}`);
        logger.info(`     Affected Records: ${warning.affectedRecords}`);
        logger.info(`     Sources: ${warning.sources.join(', ')}`);
      });
    }
    
    await logger.info(`\n📄 Full report saved to: ${OUTPUT_PATH}`);
    
    // Log operation summary
    await logger.logSummary();
    
  } catch (error) {
    await logger.error('Failed to generate validation report', error);
    await logger.logSummary();
    process.exit(1);
  }
}

// Run
main();
