#!/usr/bin/env node

/**
 * Cultural Heritage Data Fetcher
 * 
 * Fetches data about Palestinian cultural heritage sites from:
 * - Wikidata SPARQL API (Real-time data)
 * - UNESCO World Heritage List (via Wikidata)
 * 
 * Usage: node scripts/fetch-culture-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRateLimitedFetcher } from './utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/culture');
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

// Create rate-limited fetcher
const rateLimitedFetch = createRateLimitedFetcher(RATE_LIMIT_DELAY);

// Simple logger
const logger = {
    info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
    success: (msg, data) => console.log(`✅ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`⚠️  ${msg}`, data || ''),
    error: (msg, data) => console.error(`❌ ${msg}`, data || ''),
};

/**
 * Wikidata SPARQL Query
 * Fetches heritage sites, archaeological sites, and landmarks in Palestine
 */
const WIKIDATA_SPARQL_QUERY = `
SELECT DISTINCT ?item ?itemLabel ?itemDescription ?coord ?image ?article ?sitelinks ?heritage_designation ?heritage_designationLabel WHERE {
  {
    ?item wdt:P131* wd:Q219060. # Located in State of Palestine (or sub-divisions)
  } UNION {
    ?item wdt:P131* wd:Q36678.  # Located in West Bank
  } UNION {
    ?item wdt:P131* wd:Q39760.  # Located in Gaza Strip
  }
  
  # Filter for heritage/cultural significance
  {
    ?item wdt:P31/wdt:P279* wd:Q839954. # Archaeological site
  } UNION {
    ?item wdt:P31/wdt:P279* wd:Q1081138. # Historic site
  } UNION {
    ?item wdt:P31/wdt:P279* wd:Q928830. # World Heritage Site
  } UNION {
    ?item wdt:P31/wdt:P279* wd:Q32815. # Mosque
  } UNION {
    ?item wdt:P31/wdt:P279* wd:Q16970. # Church
  } UNION {
    ?item wdt:P1435 wd:Q9259. # Heritage designation: World Heritage Site
  }

  # Must have coordinates
  ?item wdt:P625 ?coord.
  
  # Optional properties
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P1435 ?heritage_designation. }
  
  # Get Wikipedia article if available
  OPTIONAL {
    ?article schema:about ?item .
    ?article schema:isPartOf <https://en.wikipedia.org/> .
  }
  
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 500
`;

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

/**
 * Write JSON file
 */
async function writeJSON(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        logger.success(`Written: ${path.basename(filePath)}`);
    } catch (error) {
        logger.error(`Failed to write ${filePath}:`, error.message);
        throw error;
    }
}

/**
 * Fetch data from Wikidata SPARQL endpoint
 */
async function fetchWikidataSites() {
    const endpointUrl = 'https://query.wikidata.org/sparql';
    const fullUrl = `${endpointUrl}?query=${encodeURIComponent(WIKIDATA_SPARQL_QUERY)}&format=json`;

    logger.info('Fetching cultural heritage data from Wikidata...');

    try {
        const response = await fetch(fullUrl, {
            headers: {
                'User-Agent': 'PalestineDataBackend/1.0 (mailto:contact@example.com)',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Wikidata API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.results.bindings;
    } catch (error) {
        logger.error('Failed to fetch from Wikidata:', error.message);
        throw error;
    }
}

/**
 * Transform Wikidata result to unified format
 */
function transformWikidataItem(item) {
    // Extract coordinates from "Point(lon lat)" string
    let lat = null, lon = null;
    if (item.coord?.value) {
        const match = item.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
        if (match) {
            lon = parseFloat(match[1]);
            lat = parseFloat(match[2]);
        }
    }

    // Determine type based on description or designation
    let type = 'Cultural';
    let site_type = 'Historic Site';
    const desc = item.itemDescription?.value?.toLowerCase() || '';
    const label = item.itemLabel?.value?.toLowerCase() || '';

    if (desc.includes('mosque') || label.includes('mosque')) {
        type = 'Religious';
        site_type = 'Mosque';
    } else if (desc.includes('church') || label.includes('church') || desc.includes('monastery')) {
        type = 'Religious';
        site_type = 'Church';
    } else if (desc.includes('archaeolog') || label.includes('ruin') || label.includes('tell ')) {
        type = 'Archaeological';
        site_type = 'Archaeological Site';
    } else if (desc.includes('museum')) {
        type = 'Cultural Center';
        site_type = 'Museum';
    }

    // Check for UNESCO status
    let unesco_status = null;
    let protection_level = 'National Heritage';
    if (item.heritage_designationLabel?.value?.includes('World Heritage')) {
        unesco_status = 'World Heritage Site';
        protection_level = 'UNESCO Protected';
    }

    // Determine region (rough approximation if not explicit)
    let region = 'West Bank'; // Default
    if (desc.includes('gaza') || label.includes('gaza')) {
        region = 'Gaza Strip';
    } else if (desc.includes('jerusalem') || label.includes('jerusalem')) {
        region = 'East Jerusalem';
    } else if (lat && lon) {
        // Rough bounding box check
        if (lat < 31.6 && lon < 34.6) region = 'Gaza Strip';
        else if (lat > 31.7 && lat < 31.9 && lon > 35.1 && lon < 35.3) region = 'East Jerusalem'; // Very rough
    }

    return {
        name: item.itemLabel?.value || 'Unknown Site',
        location: region, // Simplified
        city: null, // Hard to extract reliably without more queries
        region: region,
        coordinates: (lat && lon) ? { lat, lon } : null,
        type: type,
        site_type: site_type,
        status: 'Intact', // Default, hard to know from Wikidata
        unesco_status: unesco_status,
        protection_level: protection_level,
        description: item.itemDescription?.value || 'No description available',
        wikidata_id: item.item?.value?.split('/').pop(),
        wikipedia_url: item.article?.value || null,
        image_url: item.image?.value || null,
        source: 'Wikidata',
        last_updated: new Date().toISOString().split('T')[0],
    };
}

/**
 * Fetch cultural heritage data
 */
async function fetchCultureData() {
    try {
        logger.info('Starting cultural heritage data fetch...');

        // Ensure output directory exists
        await ensureDir(DATA_DIR);

        // Fetch real data
        const bindings = await fetchWikidataSites();
        logger.success(`Fetched ${bindings.length} raw records from Wikidata`);

        // Transform data
        const sites = bindings.map(transformWikidataItem).filter(site => site.coordinates !== null);

        // Deduplicate by name
        const uniqueSites = [];
        const seenNames = new Set();
        for (const site of sites) {
            if (!seenNames.has(site.name)) {
                seenNames.add(site.name);
                uniqueSites.push(site);
            }
        }

        logger.success(`Processed ${uniqueSites.length} unique sites after transformation`);

        // Add unique IDs
        const sitesWithIds = uniqueSites.map((site, index) => ({
            ...site,
            id: `culture-${index + 1}`,
            fetched_at: new Date().toISOString(),
        }));

        // Write main data file
        await writeJSON(path.join(DATA_DIR, 'heritage-sites.json'), {
            metadata: {
                source: 'Wikidata (SPARQL)',
                description: 'Palestinian cultural heritage sites, archaeological sites, and landmarks',
                total_sites: sitesWithIds.length,
                fetched_at: new Date().toISOString(),
                query_type: 'Real-time SPARQL',
            },
            sites: sitesWithIds,
        });

        // Generate summary statistics
        const summary = {
            total_sites: sitesWithIds.length,
            by_type: {
                religious: sitesWithIds.filter(s => s.type === 'Religious').length,
                archaeological: sitesWithIds.filter(s => s.type === 'Archaeological').length,
                cultural: sitesWithIds.filter(s => s.type === 'Cultural').length,
                unesco: sitesWithIds.filter(s => s.unesco_status).length,
            },
            by_region: {
                gaza: sitesWithIds.filter(s => s.region === 'Gaza Strip').length,
                west_bank: sitesWithIds.filter(s => s.region === 'West Bank').length,
                jerusalem: sitesWithIds.filter(s => s.region === 'East Jerusalem').length,
            },
            last_updated: new Date().toISOString(),
        };

        await writeJSON(path.join(DATA_DIR, 'summary.json'), summary);

        logger.success('✅ Cultural heritage data fetch completed!');
        logger.info('Summary:', JSON.stringify(summary, null, 2));

        return {
            success: true,
            sites_count: sitesWithIds.length,
            summary,
        };

    } catch (error) {
        logger.error('Failed to fetch cultural heritage data:', error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        const result = await fetchCultureData();
        logger.success(`Fetched ${result.sites_count} cultural heritage sites`);
        process.exit(0);
    } catch (error) {
        logger.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { fetchCultureData };
