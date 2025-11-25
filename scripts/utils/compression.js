/**
 * Data Compression Utilities
 *
 * Provides compression/decompression for large JSON files
 * to optimize storage and loading performance.
 */

import fs from 'fs/promises';
import path from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Compression settings
const COMPRESSION_THRESHOLD = 50 * 1024 * 1024; // 50MB
const COMPRESSION_EXT = '.gz';

/**
 * Check if a file should be compressed
 */
export async function shouldCompress(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size > COMPRESSION_THRESHOLD && !filePath.endsWith(COMPRESSION_EXT);
  } catch {
    return false;
  }
}

/**
 * Compress a JSON file
 */
export async function compressFile(filePath) {
  const compressedPath = `${filePath}${COMPRESSION_EXT}`;

  try {
    const readStream = fs.createReadStream(filePath);
    const writeStream = fs.createWriteStream(compressedPath);
    const gzipStream = createGzip();

    await pipeline(readStream, gzipStream, writeStream);

    // Verify compression was successful
    const originalStats = await fs.stat(filePath);
    const compressedStats = await fs.stat(compressedPath);

    const compressionRatio = (originalStats.size - compressedStats.size) / originalStats.size;

    console.log(`✅ Compressed ${path.basename(filePath)}: ${(compressionRatio * 100).toFixed(1)}% reduction`);

    // Replace original with compressed version
    await fs.unlink(filePath);
    await fs.rename(compressedPath, filePath + COMPRESSION_EXT);

    return {
      success: true,
      originalSize: originalStats.size,
      compressedSize: compressedStats.size,
      compressionRatio,
    };
  } catch (error) {
    console.error(`❌ Failed to compress ${filePath}:`, error.message);

    // Clean up failed compression
    try {
      await fs.unlink(compressedPath);
    } catch {}

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Decompress a compressed file
 */
export async function decompressFile(compressedPath) {
  if (!compressedPath.endsWith(COMPRESSION_EXT)) {
    throw new Error('File is not compressed');
  }

  const originalPath = compressedPath.slice(0, -COMPRESSION_EXT.length);

  try {
    const readStream = fs.createReadStream(compressedPath);
    const writeStream = fs.createWriteStream(originalPath);
    const gunzipStream = createGunzip();

    await pipeline(readStream, gunzipStream, writeStream);

    console.log(`✅ Decompressed ${path.basename(compressedPath)}`);

    return {
      success: true,
      path: originalPath,
    };
  } catch (error) {
    console.error(`❌ Failed to decompress ${compressedPath}:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Read a potentially compressed JSON file
 */
export async function readCompressedJSON(filePath) {
  const compressedPath = `${filePath}${COMPRESSION_EXT}`;

  try {
    // Try compressed version first
    const stats = await fs.stat(compressedPath);
    if (stats.isFile()) {
      const content = await fs.readFile(compressedPath);
      const decompressed = await new Promise((resolve, reject) => {
        const gunzip = createGunzip();
        const chunks = [];

        gunzip.on('data', chunk => chunks.push(chunk));
        gunzip.on('end', () => resolve(Buffer.concat(chunks)));
        gunzip.on('error', reject);

        gunzip.write(content);
        gunzip.end();
      });

      return JSON.parse(decompressed.toString());
    }
  } catch {}

  // Fall back to uncompressed version
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

/**
 * Write a JSON file with optional compression
 */
export async function writeCompressedJSON(filePath, data, options = {}) {
  const { compress = false } = options;
  const jsonString = JSON.stringify(data, null, 2);

  if (compress || jsonString.length > COMPRESSION_THRESHOLD) {
    // Compress the data
    const compressed = await new Promise((resolve, reject) => {
      const gzip = createGzip();
      const chunks = [];

      gzip.on('data', chunk => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks)));
      gzip.on('error', reject);

      gzip.write(jsonString);
      gzip.end();
    });

    await fs.writeFile(`${filePath}${COMPRESSION_EXT}`, compressed);

    const originalSize = Buffer.byteLength(jsonString);
    const compressedSize = compressed.length;
    const compressionRatio = (originalSize - compressedSize) / originalSize;

    console.log(`💾 Compressed JSON saved: ${path.basename(filePath)} (${(compressionRatio * 100).toFixed(1)}% reduction)`);

    return {
      path: `${filePath}${COMPRESSION_EXT}`,
      compressed: true,
      originalSize,
      compressedSize,
      compressionRatio,
    };
  } else {
    // Save uncompressed
    await fs.writeFile(filePath, jsonString);
    return {
      path: filePath,
      compressed: false,
      size: Buffer.byteLength(jsonString),
    };
  }
}

/**
 * Compress all large files in a directory
 */
export async function compressDirectory(dirPath, options = {}) {
  const { recursive = true, dryRun = false } = options;
  const results = [];

  async function processDir(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory() && recursive) {
        await processDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith(COMPRESSION_EXT)) {
        const shouldCompressFile = await shouldCompress(fullPath);

        if (shouldCompressFile) {
          if (dryRun) {
            const stats = await fs.stat(fullPath);
            console.log(`📦 Would compress: ${path.relative(dirPath, fullPath)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            results.push({
              path: fullPath,
              action: 'compress',
              dryRun: true,
              size: stats.size,
            });
          } else {
            const result = await compressFile(fullPath);
            results.push({
              path: fullPath,
              ...result,
            });
          }
        }
      }
    }
  }

  await processDir(dirPath);
  return results;
}

/**
 * Get compression statistics for a directory
 */
export async function getCompressionStats(dirPath) {
  let totalFiles = 0;
  let compressedFiles = 0;
  let totalOriginalSize = 0;
  let totalCompressedSize = 0;

  async function scanDir(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.json') && !entry.name.endsWith(COMPRESSION_EXT)) {
          totalFiles++;
          const stats = await fs.stat(fullPath);
          totalOriginalSize += stats.size;
        } else if (entry.name.endsWith(`${COMPRESSION_EXT}`)) {
          compressedFiles++;
          const stats = await fs.stat(fullPath);
          totalCompressedSize += stats.size;
        }
      }
    }
  }

  await scanDir(dirPath);

  const totalSavings = totalOriginalSize - totalCompressedSize;
  const compressionRatio = totalOriginalSize > 0 ? totalSavings / totalOriginalSize : 0;

  return {
    totalFiles,
    compressedFiles,
    totalOriginalSize,
    totalCompressedSize,
    totalSavings,
    compressionRatio,
    formatted: {
      totalSavings: `${(totalSavings / 1024 / 1024).toFixed(1)}MB`,
      compressionRatio: `${(compressionRatio * 100).toFixed(1)}%`,
    },
  };
}

export default {
  shouldCompress,
  compressFile,
  decompressFile,
  readCompressedJSON,
  writeCompressedJSON,
  compressDirectory,
  getCompressionStats,
  COMPRESSION_THRESHOLD,
  COMPRESSION_EXT,
};
