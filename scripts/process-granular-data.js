import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrichData } from './utils/data-enricher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_CSV = path.join(__dirname, '../public/data/historical/raw/fatalities_isr_pse_conflict_2000_to_2023.csv');
const OUTPUT_JSON = path.join(__dirname, '../public/data/historical/unified-historical-data.json');

// Helper to parse CSV line with quotes
function parseCSVLine(line) {
    const values = [];
    let inQuote = false;
    let val = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuote && line[i + 1] === '"') {
                val += '"'; // Escaped quote
                i++;
            } else {
                inQuote = !inQuote;
            }
        } else if (char === ',' && !inQuote) {
            values.push(val.trim());
            val = '';
        } else {
            val += char;
        }
    }
    values.push(val.trim());
    return values;
}

function parseCSV(content) {
    const lines = content.split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        const record = {};
        headers.forEach((h, index) => {
            record[h] = values[index] || '';
        });
        records.push(record);
    }
    return records;
}

async function processData() {
    console.log('Reading CSV...');
    const csvContent = fs.readFileSync(INPUT_CSV, 'utf-8');
    const rawRecords = parseCSV(csvContent);
    console.log(`Parsed ${rawRecords.length} records.`);

    const granularData = rawRecords.map((row, index) => {
        // Map fields
        const date = row.date_of_event;
        const location = row.event_location;
        const district = row.event_location_district;
        const region = row.event_location_region;

        // Construct full location string
        const fullLocation = [location, district, region].filter(Boolean).join(', ');

        // Demographics
        const age = parseInt(row.age) || null;
        const gender = row.gender === 'M' ? 'Male' : (row.gender === 'F' ? 'Female' : row.gender);

        // Base record
        const record = {
            id: `btselem-${2000 + index}`, // Unique ID
            date: date,
            category: 'Conflict Event',
            event_type: 'Fatality',
            location: fullLocation,
            city: district, // For enrichment mapping
            metrics: {
                killed: 1,
                injured: 0
            },
            demographics: {
                age: age,
                gender: gender,
                citizenship: row.citizenship,
                residence: row.place_of_residence
            },
            details: row.notes || `Fatality in ${location}`,
            source: "B'Tselem",
            source_link: 'https://statistics.btselem.org/en/all-fatalities',
            metadata: {
                killed_by: row.killed_by,
                injury_type: row.type_of_injury,
                ammunition: row.ammunition
            }
        };

        // Enrich
        return enrichData(record);
    });

    console.log('Loading existing unified data...');
    let existingData = [];
    let metadata = {};

    if (fs.existsSync(OUTPUT_JSON)) {
        const fileContent = fs.readFileSync(OUTPUT_JSON, 'utf-8');
        try {
            const json = JSON.parse(fileContent);
            if (Array.isArray(json)) {
                existingData = json;
            } else if (json.data && Array.isArray(json.data)) {
                existingData = json.data;
                metadata = { ...json };
                delete metadata.data; // Separate metadata
            }
        } catch (e) {
            console.error('Error parsing existing JSON:', e);
        }
    }

    // Filter out old data for 2000-2023 to avoid duplication:
    // 1. Remove "Conflict Event" summaries (to be replaced with granular data)
    // 2. Remove existing B'Tselem records (to prevent duplicates on re-run)
    // 3. Keep "Statistical Indicators" (World Bank data)
    const filteredData = existingData.filter(item => {
        const itemYear = new Date(item.date).getFullYear();
        const isConflict = item.category === 'Conflict Event';
        const isInPeriod = itemYear >= 2000 && itemYear <= 2023;

        // Check if it's a summary or B'Tselem record
        const isSummary = item.source === 'Summary' || (item.id && item.id.toString().toLowerCase().includes('summary'));
        const isBTselem = item.source === "BTselem" || (item.id && item.id.toString().startsWith('btselem-'));

        // Remove conflict events in 2000-2023 that are summaries or B'Tselem (will be replaced)
        if (isConflict && isInPeriod && (isSummary || isBTselem)) {
            return false;
        }
        return true;
    });

    console.log(`Removed ${existingData.length - filteredData.length} old records (summaries + existing B'Tselem).`);

    // Merge
    const finalData = [...filteredData, ...granularData];

    // Sort by date
    finalData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Construct final output object
    const output = {
        source: "Unified Historical Data (World Bank + B'Tselem + Summaries)",
        category: 'historical',
        transformed_at: new Date().toISOString(),
        record_count: finalData.length,
        data: finalData
    };

    console.log(`Writing ${finalData.length} total records to ${OUTPUT_JSON}...`);
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));
    console.log('Done.');
}

processData().catch(console.error);
