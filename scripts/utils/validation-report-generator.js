/**
 * Validation Report Generator
 * 
 * Generates comprehensive validation reports for all data sources
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger({ context: 'ValidationReportGenerator' });

/**
 * Read JSON file
 */
async function readJSON(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Write JSON file
 */
async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Scan directory for validation files
 */
async function scanForValidationFiles(directory) {
  const validationFiles = [];
  
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanForValidationFiles(fullPath);
        validationFiles.push(...subFiles);
      } else if (entry.name === 'validation.json') {
        validationFiles.push(fullPath);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
    return validationFiles;
  }
  
  return validationFiles;
}

/**
 * Collect validation results from all sources
 */
async function collectValidationResults(dataDir) {
  await logger.info('Collecting validation results from all data sources...');
  
  const results = {
    hdx: [],
    goodshepherd: [],
    worldbank: [],
    tech4palestine: [],
  };
  
  // Scan HDX directory
  const hdxDir = path.join(dataDir, 'hdx');
  const hdxFiles = await scanForValidationFiles(hdxDir);
  for (const file of hdxFiles) {
    const data = await readJSON(file);
    if (data) {
      results.hdx.push({
        file: path.relative(hdxDir, file),
        ...data,
      });
    }
  }
  
  // Scan Good Shepherd directory
  const gsDir = path.join(dataDir, 'goodshepherd');
  const gsFiles = await scanForValidationFiles(gsDir);
  for (const file of gsFiles) {
    const data = await readJSON(file);
    if (data) {
      results.goodshepherd.push({
        file: path.relative(gsDir, file),
        ...data,
      });
    }
  }
  
  // Scan World Bank directory
  const wbDir = path.join(dataDir, 'worldbank');
  const wbFiles = await fs.readdir(wbDir);
  for (const file of wbFiles) {
    if (file.endsWith('_validation.json')) {
      const data = await readJSON(path.join(wbDir, file));
      if (data) {
        results.worldbank.push({
          file,
          ...data,
        });
      }
    }
  }
  
  await logger.success(`Collected validation results from ${hdxFiles.length + gsFiles.length + results.worldbank.length} files`);
  
  return results;
}

/**
 * Calculate summary statistics
 */
function calculateSummaryStats(validationResults) {
  const stats = {
    totalDatasets: 0,
    passedValidation: 0,
    failedValidation: 0,
    averageQualityScore: 0,
    averageCompleteness: 0,
    averageConsistency: 0,
    averageAccuracy: 0,
    totalErrors: 0,
    totalWarnings: 0,
    bySource: {},
  };
  
  let totalQualityScore = 0;
  let totalCompleteness = 0;
  let totalConsistency = 0;
  let totalAccuracy = 0;
  
  for (const [source, results] of Object.entries(validationResults)) {
    const sourceStats = {
      datasets: results.length,
      passed: 0,
      failed: 0,
      averageQualityScore: 0,
      totalErrors: 0,
      totalWarnings: 0,
    };
    
    let sourceQualityScore = 0;
    
    for (const result of results) {
      stats.totalDatasets++;
      sourceStats.datasets++;
      
      if (result.meetsThreshold) {
        stats.passedValidation++;
        sourceStats.passed++;
      } else {
        stats.failedValidation++;
        sourceStats.failed++;
      }
      
      totalQualityScore += result.qualityScore || 0;
      totalCompleteness += result.completeness || 0;
      totalConsistency += result.consistency || 0;
      totalAccuracy += result.accuracy || 0;
      
      sourceQualityScore += result.qualityScore || 0;
      
      stats.totalErrors += result.errorCount || result.errors?.length || 0;
      stats.totalWarnings += result.warningCount || result.warnings?.length || 0;
      
      sourceStats.totalErrors += result.errorCount || result.errors?.length || 0;
      sourceStats.totalWarnings += result.warningCount || result.warnings?.length || 0;
    }
    
    if (results.length > 0) {
      sourceStats.averageQualityScore = sourceQualityScore / results.length;
    }
    
    stats.bySource[source] = sourceStats;
  }
  
  if (stats.totalDatasets > 0) {
    stats.averageQualityScore = totalQualityScore / stats.totalDatasets;
    stats.averageCompleteness = totalCompleteness / stats.totalDatasets;
    stats.averageConsistency = totalConsistency / stats.totalDatasets;
    stats.averageAccuracy = totalAccuracy / stats.totalDatasets;
  }
  
  return stats;
}

/**
 * Group errors by type
 */
function groupErrorsByType(validationResults) {
  const errorsByType = {};
  const warningsByType = {};
  
  for (const [source, results] of Object.entries(validationResults)) {
    for (const result of results) {
      // Process errors
      if (result.errors && Array.isArray(result.errors)) {
        for (const error of result.errors) {
          const key = `${error.field || 'unknown'}: ${error.message || 'unknown error'}`;
          if (!errorsByType[key]) {
            errorsByType[key] = {
              field: error.field,
              message: error.message,
              severity: error.severity,
              count: 0,
              sources: new Set(),
              datasets: [],
            };
          }
          errorsByType[key].count += error.affectedRecords || 1;
          errorsByType[key].sources.add(source);
          errorsByType[key].datasets.push({
            source,
            dataset: result.datasetType || result.file,
          });
        }
      }
      
      // Process warnings
      if (result.warnings && Array.isArray(result.warnings)) {
        for (const warning of result.warnings) {
          const key = `${warning.field || 'unknown'}: ${warning.message || 'unknown warning'}`;
          if (!warningsByType[key]) {
            warningsByType[key] = {
              field: warning.field,
              message: warning.message,
              severity: warning.severity,
              count: 0,
              sources: new Set(),
              datasets: [],
            };
          }
          warningsByType[key].count += warning.affectedRecords || 1;
          warningsByType[key].sources.add(source);
          warningsByType[key].datasets.push({
            source,
            dataset: result.datasetType || result.file,
          });
        }
      }
    }
  }
  
  // Convert Sets to Arrays for JSON serialization
  for (const error of Object.values(errorsByType)) {
    error.sources = Array.from(error.sources);
  }
  for (const warning of Object.values(warningsByType)) {
    warning.sources = Array.from(warning.sources);
  }
  
  return { errorsByType, warningsByType };
}

/**
 * Identify datasets with quality issues
 */
function identifyQualityIssues(validationResults, threshold = 0.85) {
  const issues = {
    lowQuality: [],
    highErrorCount: [],
    lowCompleteness: [],
    failedValidation: [],
  };
  
  for (const [source, results] of Object.entries(validationResults)) {
    for (const result of results) {
      const dataset = {
        source,
        dataset: result.datasetType || result.file,
        qualityScore: result.qualityScore,
        completeness: result.completeness,
        errorCount: result.errorCount || result.errors?.length || 0,
        warningCount: result.warningCount || result.warnings?.length || 0,
      };
      
      if (result.qualityScore < threshold) {
        issues.lowQuality.push(dataset);
      }
      
      if ((result.errorCount || result.errors?.length || 0) > 10) {
        issues.highErrorCount.push(dataset);
      }
      
      if (result.completeness < 0.95) {
        issues.lowCompleteness.push(dataset);
      }
      
      if (!result.meetsThreshold) {
        issues.failedValidation.push(dataset);
      }
    }
  }
  
  // Sort by quality score (lowest first)
  issues.lowQuality.sort((a, b) => a.qualityScore - b.qualityScore);
  issues.highErrorCount.sort((a, b) => b.errorCount - a.errorCount);
  issues.lowCompleteness.sort((a, b) => a.completeness - b.completeness);
  
  return issues;
}

/**
 * Generate comprehensive validation report
 */
export async function generateValidationReport(dataDir, outputPath) {
  await logger.info('Generating comprehensive validation report...');
  
  try {
    // Collect validation results
    const validationResults = await collectValidationResults(dataDir);
    
    // Calculate summary statistics
    const summaryStats = calculateSummaryStats(validationResults);
    
    // Group errors and warnings
    const { errorsByType, warningsByType } = groupErrorsByType(validationResults);
    
    // Identify quality issues
    const qualityIssues = identifyQualityIssues(validationResults);
    
    // Generate report
    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        totalDatasets: summaryStats.totalDatasets,
        passedValidation: summaryStats.passedValidation,
        failedValidation: summaryStats.failedValidation,
        passRate: summaryStats.totalDatasets > 0 
          ? `${((summaryStats.passedValidation / summaryStats.totalDatasets) * 100).toFixed(1)}%`
          : '0%',
        averageQualityScore: summaryStats.averageQualityScore,
        averageCompleteness: summaryStats.averageCompleteness,
        averageConsistency: summaryStats.averageConsistency,
        averageAccuracy: summaryStats.averageAccuracy,
        totalErrors: summaryStats.totalErrors,
        totalWarnings: summaryStats.totalWarnings,
      },
      bySource: summaryStats.bySource,
      qualityIssues: {
        lowQualityDatasets: qualityIssues.lowQuality.length,
        highErrorCountDatasets: qualityIssues.highErrorCount.length,
        lowCompletenessDatasets: qualityIssues.lowCompleteness.length,
        failedValidationDatasets: qualityIssues.failedValidation.length,
        details: qualityIssues,
      },
      commonErrors: Object.entries(errorsByType)
        .map(([key, error]) => ({
          field: error.field,
          message: error.message,
          severity: error.severity,
          affectedRecords: error.count,
          sources: error.sources,
          datasetCount: error.datasets.length,
        }))
        .sort((a, b) => b.affectedRecords - a.affectedRecords)
        .slice(0, 20), // Top 20 errors
      commonWarnings: Object.entries(warningsByType)
        .map(([key, warning]) => ({
          field: warning.field,
          message: warning.message,
          severity: warning.severity,
          affectedRecords: warning.count,
          sources: warning.sources,
          datasetCount: warning.datasets.length,
        }))
        .sort((a, b) => b.affectedRecords - a.affectedRecords)
        .slice(0, 20), // Top 20 warnings
      detailedResults: validationResults,
    };
    
    // Save report
    await writeJSON(outputPath, report);
    
    await logger.success(`Validation report saved to ${outputPath}`);
    await logger.info('Report Summary:');
    await logger.info(`  Total datasets: ${report.summary.totalDatasets}`);
    await logger.info(`  Passed validation: ${report.summary.passedValidation} (${report.summary.passRate})`);
    await logger.info(`  Failed validation: ${report.summary.failedValidation}`);
    await logger.info(`  Average quality score: ${(report.summary.averageQualityScore * 100).toFixed(1)}%`);
    await logger.info(`  Total errors: ${report.summary.totalErrors}`);
    await logger.info(`  Total warnings: ${report.summary.totalWarnings}`);
    
    if (qualityIssues.failedValidation.length > 0) {
      await logger.warn(`  Datasets with quality issues: ${qualityIssues.failedValidation.length}`);
    }
    
    return report;
    
  } catch (error) {
    await logger.error('Failed to generate validation report', error);
    throw error;
  }
}

export default generateValidationReport;
