import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory for data
// Assuming this file is in src/api/utils/
// We need to go up to root then public/data
const DATA_DIR = path.resolve(__dirname, '../../../public/data');
const UNIFIED_DIR = path.join(DATA_DIR, 'unified');

/**
 * Read a JSON file safely
 * @param {string} filePath - Path relative to data directory
 * @returns {Promise<any>} Parsed JSON content or null
 */
export async function readJsonFile(filePath) {
    try {
        const fullPath = path.join(DATA_DIR, filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Get unified data for a category
 * @param {string} category - Category name
 * @returns {Promise<any>} Data object
 */
export async function getUnifiedData(category) {
    const filePath = path.join('unified', category, 'all-data.json');
    return readJsonFile(filePath);
}

/**
 * Get metadata for a category
 * @param {string} category - Category name
 * @returns {Promise<any>} Metadata object
 */
export async function getUnifiedMetadata(category) {
    const filePath = path.join('unified', category, 'metadata.json');
    return readJsonFile(filePath);
}

/**
 * Get search index
 * @returns {Promise<any>} Search index
 */
export async function getSearchIndex() {
    return readJsonFile('search-index.json');
}

/**
 * Check if a category exists
 * @param {string} category 
 * @returns {Promise<boolean>}
 */
export async function categoryExists(category) {
    try {
        const dirPath = path.join(UNIFIED_DIR, category);
        await fs.access(dirPath);
        return true;
    } catch {
        return false;
    }
}
