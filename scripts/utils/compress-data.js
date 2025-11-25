#!/usr/bin/env node

/**
 * Data Compression Utility
 *
 * Compresses large JSON files to optimize storage
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { compressDirectory, getCompressionStats } from './compression.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../public/data');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');

  try {
    console.log('🗜️  Palestine Pulse Data Compression Utility');
    console.log('==========================================');
    console.log('');

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No files will be modified');
      console.log('');
    }

    // Get compression stats before
    console.log('📊 Analyzing current compression status...');
    const beforeStats = await getCompressionStats(DATA_DIR);

    console.log(`   Files: ${beforeStats.totalFiles}`);
    console.log(`   Compressed: ${beforeStats.compressedFiles}`);
    console.log(`   Total Size: ${(beforeStats.totalOriginalSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`   Savings: ${beforeStats.formatted.totalSavings}`);
    console.log(`   Ratio: ${beforeStats.formatted.compressionRatio}`);
    console.log('');

    // Compress large files
    console.log('🔄 Compressing large files...');
    const results = await compressDirectory(DATA_DIR, { dryRun });

    if (results.length === 0) {
      console.log('✅ No files need compression');
    } else {
      console.log(`📦 Processed ${results.length} files:`);

      let totalSavings = 0;
      let successful = 0;

      for (const result of results) {
        if (result.success) {
          successful++;
          totalSavings += result.compressionRatio * result.originalSize;
          console.log(`   ✅ ${path.basename(result.path)}: ${(result.compressionRatio * 100).toFixed(1)}% reduction`);
        } else {
          console.log(`   ❌ ${path.basename(result.path)}: ${result.error}`);
        }
      }

      console.log('');
      console.log(`📈 Compression Summary:`);
      console.log(`   Successful: ${successful}/${results.length}`);
      console.log(`   Total Savings: ${(totalSavings / 1024 / 1024).toFixed(1)} MB`);
    }

    // Get compression stats after
    if (!dryRun) {
      console.log('');
      console.log('📊 Updated compression status...');
      const afterStats = await getCompressionStats(DATA_DIR);

      console.log(`   Files: ${afterStats.totalFiles}`);
      console.log(`   Compressed: ${afterStats.compressedFiles}`);
      console.log(`   Total Size: ${(afterStats.totalOriginalSize / 1024 / 1024).toFixed(1)} MB`);
      console.log(`   Savings: ${afterStats.formatted.totalSavings}`);
      console.log(`   Ratio: ${afterStats.formatted.compressionRatio}`);
    }

    console.log('');
    console.log('✅ Compression utility completed');

    if (dryRun) {
      console.log('');
      console.log('💡 To apply compression, run without --dry-run flag');
    }

  } catch (error) {
    console.error('❌ Compression failed:', error.message);
    process.exit(1);
  }
}

main();
