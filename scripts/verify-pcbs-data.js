#!/usr/bin/env node

/**
 * PCBS Data Verification Script
 * 
 * Verifies that all PCBS datasets are:
 * - Present and not empty
 * - Properly formatted
 * - Contain valid data
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/pcbs');
const UNIFIED_DIR = path.join(__dirname, '../public/data/unified/pcbs');

async function verifyFile(filePath, fileName) {
  const issues = [];
  const warnings = [];
  
  try {
    // Check if file exists
    const stats = await fs.stat(filePath);
    
    // Check if file is empty
    if (stats.size === 0) {
      issues.push(`File is empty (0 bytes)`);
      return { fileName, exists: true, empty: true, valid: false, issues, warnings };
    }
    
    // Check if file is too small (likely invalid JSON)
    if (stats.size < 10) {
      issues.push(`File is suspiciously small (${stats.size} bytes)`);
    }
    
    // Try to parse JSON
    const content = await fs.readFile(filePath, 'utf-8');
    let data;
    
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      issues.push(`Invalid JSON: ${parseError.message}`);
      return { fileName, exists: true, empty: false, valid: false, size: stats.size, issues, warnings };
    }
    
    // Verify data structure
    if (fileName.endsWith('.json') && fileName !== 'metadata.json' && fileName !== 'manual-data-template.json') {
      // Check for data array
      if (!data.data || !Array.isArray(data.data)) {
        issues.push('Missing or invalid "data" array');
      } else if (data.data.length === 0) {
        warnings.push('Data array is empty');
      }
      
      // Check for metadata
      if (!data.metadata) {
        warnings.push('Missing metadata object');
      }
      
      // Check for indicator info
      if (!data.indicator && !data.category) {
        warnings.push('Missing indicator or category information');
      }
      
      // Verify data records have required fields
      if (data.data && data.data.length > 0) {
        const firstRecord = data.data[0];
        const requiredFields = ['year', 'value', 'indicator', 'source'];
        const missingFields = requiredFields.filter(field => !(field in firstRecord));
        
        if (missingFields.length > 0) {
          warnings.push(`Data records missing fields: ${missingFields.join(', ')}`);
        }
        
        // Check for null values
        const nullValues = data.data.filter(r => r.value === null || r.value === undefined);
        if (nullValues.length > 0) {
          warnings.push(`${nullValues.length} records have null values`);
        }
      }
    }
    
    return {
      fileName,
      exists: true,
      empty: false,
      valid: issues.length === 0,
      size: stats.size,
      recordCount: data.data ? data.data.length : null,
      issues,
      warnings,
    };
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { fileName, exists: false, empty: true, valid: false, issues: ['File does not exist'], warnings: [] };
    }
    return { fileName, exists: true, empty: false, valid: false, issues: [error.message], warnings: [] };
  }
}

async function verifyTransformedFile(filePath, fileName) {
  const issues = [];
  const warnings = [];
  
  try {
    const stats = await fs.stat(filePath);
    
    if (stats.size === 0) {
      issues.push(`File is empty (0 bytes)`);
      return { fileName, exists: true, empty: true, valid: false, issues, warnings };
    }
    
    const content = await fs.readFile(filePath, 'utf-8');
    let data;
    
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      issues.push(`Invalid JSON: ${parseError.message}`);
      return { fileName, exists: true, empty: false, valid: false, size: stats.size, issues, warnings };
    }
    
    // Verify transformed data structure
    if (!data.data || !Array.isArray(data.data)) {
      issues.push('Missing or invalid "data" array');
    } else if (data.data.length === 0) {
      warnings.push('Data array is empty');
    }
    
    // Check transformed record structure
    if (data.data && data.data.length > 0) {
      const firstRecord = data.data[0];
      const requiredFields = ['id', 'type', 'category', 'date', 'value', 'location', 'sources', 'quality'];
      const missingFields = requiredFields.filter(field => !(field in firstRecord));
      
      if (missingFields.length > 0) {
        issues.push(`Transformed records missing fields: ${missingFields.join(', ')}`);
      }
      
      // Check for analysis
      const withAnalysis = data.data.filter(r => r.analysis).length;
      if (withAnalysis === 0) {
        warnings.push('No records have trend analysis');
      }
      
      // Check for PCBS metadata
      const withPCBSMetadata = data.data.filter(r => r.pcbs_metadata).length;
      if (withPCBSMetadata === 0) {
        warnings.push('No records have PCBS metadata');
      }
    }
    
    return {
      fileName,
      exists: true,
      empty: false,
      valid: issues.length === 0,
      size: stats.size,
      recordCount: data.data ? data.data.length : null,
      withAnalysis: data.data ? data.data.filter(r => r.analysis).length : 0,
      issues,
      warnings,
    };
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { fileName, exists: false, empty: true, valid: false, issues: ['File does not exist'], warnings: [] };
    }
    return { fileName, exists: true, empty: false, valid: false, issues: [error.message], warnings: [] };
  }
}

async function verifyAllData() {
  console.log('========================================');
  console.log('PCBS Data Verification');
  console.log('========================================\n');
  
  // Get all files in PCBS directory
  console.log('Checking raw PCBS data files...\n');
  const files = await fs.readdir(DATA_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  
  console.log(`Found ${jsonFiles.length} JSON files\n`);
  
  const results = [];
  for (const file of jsonFiles) {
    const filePath = path.join(DATA_DIR, file);
    const result = await verifyFile(filePath, file);
    results.push(result);
  }
  
  // Summary
  const valid = results.filter(r => r.valid);
  const invalid = results.filter(r => !r.valid);
  const empty = results.filter(r => r.empty);
  const withWarnings = results.filter(r => r.warnings.length > 0);
  
  console.log('Raw Data Summary:');
  console.log(`  Total files: ${results.length}`);
  console.log(`  Valid: ${valid.length}`);
  console.log(`  Invalid: ${invalid.length}`);
  console.log(`  Empty: ${empty.length}`);
  console.log(`  With warnings: ${withWarnings.length}\n`);
  
  // Show invalid files
  if (invalid.length > 0) {
    console.log('❌ Invalid Files:');
    invalid.forEach(r => {
      console.log(`  ${r.fileName}:`);
      r.issues.forEach(issue => console.log(`    - ${issue}`));
    });
    console.log('');
  }
  
  // Show files with warnings
  if (withWarnings.length > 0) {
    console.log('⚠️  Files with Warnings:');
    withWarnings.forEach(r => {
      console.log(`  ${r.fileName}:`);
      r.warnings.forEach(warning => console.log(`    - ${warning}`));
    });
    console.log('');
  }
  
  // Show valid files with record counts
  if (valid.length > 0) {
    console.log('✅ Valid Files (sample):');
    valid.slice(0, 10).forEach(r => {
      const recordInfo = r.recordCount !== null ? ` (${r.recordCount} records)` : '';
      const sizeInfo = r.size ? ` [${(r.size / 1024).toFixed(2)} KB]` : '';
      console.log(`  ${r.fileName}${recordInfo}${sizeInfo}`);
    });
    if (valid.length > 10) {
      console.log(`  ... and ${valid.length - 10} more`);
    }
    console.log('');
  }
  
  // Verify transformed data
  console.log('========================================');
  console.log('Checking transformed PCBS data files...\n');
  
  try {
    const transformedFiles = await fs.readdir(UNIFIED_DIR);
    const transformedJsonFiles = transformedFiles.filter(f => f.endsWith('.json'));
    
    console.log(`Found ${transformedJsonFiles.length} transformed JSON files\n`);
    
    const transformedResults = [];
    for (const file of transformedJsonFiles) {
      const filePath = path.join(UNIFIED_DIR, file);
      const result = await verifyTransformedFile(filePath, file);
      transformedResults.push(result);
    }
    
    // Summary
    const tValid = transformedResults.filter(r => r.valid);
    const tInvalid = transformedResults.filter(r => !r.valid);
    const tEmpty = transformedResults.filter(r => r.empty);
    const tWithWarnings = transformedResults.filter(r => r.warnings.length > 0);
    
    console.log('Transformed Data Summary:');
    console.log(`  Total files: ${transformedResults.length}`);
    console.log(`  Valid: ${tValid.length}`);
    console.log(`  Invalid: ${tInvalid.length}`);
    console.log(`  Empty: ${tEmpty.length}`);
    console.log(`  With warnings: ${tWithWarnings.length}\n`);
    
    // Show invalid files
    if (tInvalid.length > 0) {
      console.log('❌ Invalid Transformed Files:');
      tInvalid.forEach(r => {
        console.log(`  ${r.fileName}:`);
        r.issues.forEach(issue => console.log(`    - ${issue}`));
      });
      console.log('');
    }
    
    // Show files with warnings
    if (tWithWarnings.length > 0) {
      console.log('⚠️  Transformed Files with Warnings:');
      tWithWarnings.forEach(r => {
        console.log(`  ${r.fileName}:`);
        r.warnings.forEach(warning => console.log(`    - ${warning}`));
      });
      console.log('');
    }
    
    // Show valid transformed files
    if (tValid.length > 0) {
      console.log('✅ Valid Transformed Files:');
      tValid.forEach(r => {
        const recordInfo = r.recordCount !== null ? ` (${r.recordCount} records)` : '';
        const analysisInfo = r.withAnalysis ? `, ${r.withAnalysis} with analysis` : '';
        const sizeInfo = r.size ? ` [${(r.size / 1024).toFixed(2)} KB]` : '';
        console.log(`  ${r.fileName}${recordInfo}${analysisInfo}${sizeInfo}`);
      });
      console.log('');
    }
    
  } catch (error) {
    console.log(`⚠️  Transformed data directory not found or inaccessible: ${error.message}\n`);
  }
  
  // Overall summary
  console.log('========================================');
  console.log('Overall Verification Result');
  console.log('========================================');
  
  const totalIssues = invalid.length + empty.length;
  
  if (totalIssues === 0) {
    console.log('✅ All PCBS data files are valid and properly formatted!');
    console.log(`   ${valid.length} raw data files verified`);
    console.log(`   Total records: ${valid.reduce((sum, r) => sum + (r.recordCount || 0), 0)}`);
  } else {
    console.log(`❌ Found ${totalIssues} issues with PCBS data files`);
    console.log(`   ${invalid.length} invalid files`);
    console.log(`   ${empty.length} empty files`);
  }
  
  console.log('========================================\n');
  
  // Exit with error code if there are issues
  if (totalIssues > 0) {
    process.exit(1);
  }
}

// Run verification
verifyAllData().catch(error => {
  console.error('Verification failed:', error);
  process.exit(1);
});
