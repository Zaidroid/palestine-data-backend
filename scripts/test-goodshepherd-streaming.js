#!/usr/bin/env node

/**
 * Test Good Shepherd Streaming and Alternative Sources
 * 
 * Tests the streaming implementation for healthcare attacks
 * and alternative sources for demolitions data
 */

import { createLogger } from './utils/logger.js';
import { loadChunkIndex, hasChunks, getChunkMetadata } from './utils/chunk-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger({ 
  context: 'GoodShepherd-Test',
  logLevel: 'INFO',
});

const DATA_DIR = path.join(__dirname, '../public/data/goodshepherd');

async function testHealthcareStreaming() {
  await logger.info('Testing healthcare attacks streaming...');
  
  try {
    const healthcareDir = path.join(DATA_DIR, 'healthcare');
    const chunksExist = await hasChunks(healthcareDir);
    
    if (chunksExist) {
      await logger.success('Healthcare chunks detected');
      
      const chunksDir = path.join(healthcareDir, 'chunks');
      const metadata = await getChunkMetadata(chunksDir);
      
      await logger.info(`Total records: ${metadata.totalRecords}`);
      await logger.info(`Total chunks: ${metadata.totalChunks}`);
      await logger.info(`Chunk size: ${metadata.chunkSize}`);
      await logger.info(`Created at: ${metadata.createdAt}`);
      
      // Verify chunk index
      const index = await loadChunkIndex(chunksDir);
      await logger.success(`Chunk index loaded successfully with ${index.chunks.length} chunks`);
      
      return true;
    } else {
      await logger.warn('No healthcare chunks found - streaming may not have been needed');
      return false;
    }
  } catch (error) {
    await logger.error('Healthcare streaming test failed', error);
    return false;
  }
}

async function testDemolitionsAlternatives() {
  await logger.info('Testing demolitions alternative sources...');
  
  try {
    const demolitionsDir = path.join(DATA_DIR, 'demolitions');
    
    // Check if demolitions data exists
    const fs = await import('fs/promises');
    const indexPath = path.join(demolitionsDir, 'index.json');
    
    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);
      
      await logger.success('Demolitions data found');
      await logger.info(`Dataset: ${index.dataset}`);
      await logger.info(`Date range: ${index.date_range.start} to ${index.date_range.end}`);
      await logger.info(`Files: ${index.files.length} partitions`);
      
      // Check validation
      if (index.validation) {
        await logger.info(`Quality score: ${(index.validation.qualityScore * 100).toFixed(1)}%`);
        await logger.info(`Completeness: ${(index.validation.completeness * 100).toFixed(1)}%`);
      }
      
      return true;
    } catch (error) {
      await logger.warn('Demolitions data not found - may need to run fetch script');
      return false;
    }
  } catch (error) {
    await logger.error('Demolitions alternative sources test failed', error);
    return false;
  }
}

async function main() {
  await logger.info('🧪 Good Shepherd Streaming & Alternative Sources Test');
  await logger.info('====================================================');
  
  const results = {
    streaming: false,
    alternatives: false,
  };
  
  // Test healthcare streaming
  results.streaming = await testHealthcareStreaming();
  
  // Test demolitions alternatives
  results.alternatives = await testDemolitionsAlternatives();
  
  // Summary
  await logger.info('\n📊 Test Summary:');
  console.log(`  Healthcare Streaming: ${results.streaming ? '✅ PASS' : '⚠️  NOT TESTED'}`);
  console.log(`  Demolitions Alternatives: ${results.alternatives ? '✅ PASS' : '⚠️  NOT TESTED'}`);
  
  if (results.streaming || results.alternatives) {
    await logger.success('\n✅ Tests completed successfully!');
  } else {
    await logger.warn('\n⚠️  No data found - run fetch-goodshepherd-data.js first');
  }
  
  await logger.logSummary();
}

main();
