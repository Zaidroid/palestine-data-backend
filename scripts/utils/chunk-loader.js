/**
 * Chunk Loader Utility
 * 
 * Provides functions to load and manage chunked datasets
 * for efficient handling of large data files
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Load chunk index from a chunked dataset
 * @param {string} chunksDir - Directory containing chunks
 * @returns {Promise<Object>} Chunk index metadata
 */
export async function loadChunkIndex(chunksDir) {
  try {
    const indexPath = path.join(chunksDir, 'index.json');
    const content = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load chunk index: ${error.message}`);
  }
}

/**
 * Load a specific chunk from a chunked dataset
 * @param {string} chunksDir - Directory containing chunks
 * @param {number} chunkNumber - Chunk number to load (1-indexed)
 * @returns {Promise<Array>} Chunk data
 */
export async function loadChunk(chunksDir, chunkNumber) {
  try {
    const chunkPath = path.join(chunksDir, `chunk-${chunkNumber}.json`);
    const content = await fs.readFile(chunkPath, 'utf-8');
    const chunkData = JSON.parse(content);
    return chunkData.data || [];
  } catch (error) {
    throw new Error(`Failed to load chunk ${chunkNumber}: ${error.message}`);
  }
}

/**
 * Load all chunks from a chunked dataset
 * @param {string} chunksDir - Directory containing chunks
 * @returns {Promise<Array>} All data from all chunks
 */
export async function loadAllChunks(chunksDir) {
  try {
    const index = await loadChunkIndex(chunksDir);
    const allData = [];
    
    for (let i = 1; i <= index.total_chunks; i++) {
      const chunkData = await loadChunk(chunksDir, i);
      allData.push(...chunkData);
    }
    
    return allData;
  } catch (error) {
    throw new Error(`Failed to load all chunks: ${error.message}`);
  }
}

/**
 * Load chunks in a specific range
 * @param {string} chunksDir - Directory containing chunks
 * @param {number} startChunk - Starting chunk number (1-indexed)
 * @param {number} endChunk - Ending chunk number (1-indexed)
 * @returns {Promise<Array>} Data from specified chunk range
 */
export async function loadChunkRange(chunksDir, startChunk, endChunk) {
  try {
    const index = await loadChunkIndex(chunksDir);
    
    if (startChunk < 1 || endChunk > index.total_chunks) {
      throw new Error(`Invalid chunk range: ${startChunk}-${endChunk} (total: ${index.total_chunks})`);
    }
    
    const data = [];
    for (let i = startChunk; i <= endChunk; i++) {
      const chunkData = await loadChunk(chunksDir, i);
      data.push(...chunkData);
    }
    
    return data;
  } catch (error) {
    throw new Error(`Failed to load chunk range: ${error.message}`);
  }
}

/**
 * Check if a dataset has chunks
 * @param {string} datasetDir - Dataset directory
 * @returns {Promise<boolean>} True if chunks exist
 */
export async function hasChunks(datasetDir) {
  try {
    const chunksDir = path.join(datasetDir, 'chunks');
    const indexPath = path.join(chunksDir, 'index.json');
    await fs.access(indexPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get chunk metadata without loading data
 * @param {string} chunksDir - Directory containing chunks
 * @returns {Promise<Object>} Chunk metadata
 */
export async function getChunkMetadata(chunksDir) {
  try {
    const index = await loadChunkIndex(chunksDir);
    return {
      totalRecords: index.total_records,
      totalChunks: index.total_chunks,
      chunkSize: index.chunk_size,
      chunks: index.chunks,
      createdAt: index.created_at,
    };
  } catch (error) {
    throw new Error(`Failed to get chunk metadata: ${error.message}`);
  }
}
