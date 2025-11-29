/**
 * Safe ZIP Extraction Utility
 */

import AdmZip from 'adm-zip';
import path from 'path';

const MAX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 100;
const ALLOWED_EXTENSIONS = ['.csv', '.json', '.geojson', '.txt'];

export function extractZipSafely(zipBuffer, options = {}) {
  const maxSize = options.maxSize || MAX_UNCOMPRESSED_SIZE;
  const maxFileSize = options.maxFileSize || MAX_FILE_SIZE;
  const maxFiles = options.maxFiles || MAX_FILES;

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  if (entries.length > maxFiles) {
    throw new Error(`ZIP contains too many files: ${entries.length}`);
  }

  let totalSize = 0;
  const validEntries = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const entryPath = entry.entryName;
    if (entryPath.includes('..') || path.isAbsolute(entryPath)) {
      console.warn(`Skipping suspicious path: ${entryPath}`);
      continue;
    }

    const ext = path.extname(entryPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      // console.log(`Skipping non-data file: ${entryPath}`);
      continue;
    }

    const uncompressedSize = entry.header.size;
    if (uncompressedSize > maxFileSize) {
      console.warn(`Skipping large file: ${entryPath}`);
      continue;
    }

    totalSize += uncompressedSize;
    validEntries.push(entry);
  }

  if (totalSize > maxSize) {
    throw new Error(`Total uncompressed size too large: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  }

  if (validEntries.length === 0) {
    throw new Error('No valid data files found in ZIP');
  }

  console.log(`Extracting ${validEntries.length} files`);

  const extractedFiles = [];
  for (const entry of validEntries) {
    try {
      const data = entry.getData();
      extractedFiles.push({
        name: path.basename(entry.entryName),
        path: entry.entryName,
        data: data,
        size: data.length,
      });
      console.log(`  ✓ Extracted: ${entry.entryName}`);
    } catch (error) {
      console.warn(`  ⚠️  Failed to extract ${entry.entryName}`);
    }
  }

  return extractedFiles;
}

export async function downloadAndExtractZip(url, options = {}) {
  const maxDownloadSize = options.maxDownloadSize || 50 * 1024 * 1024;

  console.log(`Downloading ZIP from: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const sizeInMB = parseInt(contentLength) / (1024 * 1024);
    if (parseInt(contentLength) > maxDownloadSize) {
      throw new Error(`ZIP file too large: ${sizeInMB.toFixed(1)} MB`);
    }
    console.log(`ZIP size: ${sizeInMB.toFixed(1)} MB`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB, extracting...`);

  return extractZipSafely(buffer, options);
}

export function parseExtractedFile(file) {
  const ext = path.extname(file.name).toLowerCase();
  const content = file.data.toString('utf-8');

  if (ext === '.json' || ext === '.geojson') {
    return {
      format: ext === '.geojson' ? 'geojson' : 'json',
      data: JSON.parse(content),
      fileName: file.name,
    };
  } else if (ext === '.csv') {
    return {
      format: 'csv',
      data: content,
      fileName: file.name,
    };
  } else if (ext === '.txt') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return {
        format: 'json',
        data: JSON.parse(content),
        fileName: file.name,
      };
    } else {
      return {
        format: 'csv',
        data: content,
        fileName: file.name,
      };
    }
  }

  return {
    format: 'unknown',
    data: content,
    fileName: file.name,
  };
}
