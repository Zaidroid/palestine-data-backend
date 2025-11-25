
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEARCH_INDEX_PATH = path.join(__dirname, '../public/data/search-index.json');

async function analyzeData() {
    console.log('Reading search index...');
    const content = JSON.parse(await fs.readFile(SEARCH_INDEX_PATH, 'utf-8'));
    const entries = content.index;

    console.log(`Total entries: ${entries.length}`);

    const stats = {
        categories: {},
        dates: {
            min: null,
            max: null,
            byYearMonth: {},
            invalid: 0
        },
        locations: {
            total: 0,
            missing: 0,
            byRegion: {}
        },
        correlations: {
            byDateLocation: {}
        }
    };

    entries.forEach(entry => {
        // Category Stats
        stats.categories[entry.category] = (stats.categories[entry.category] || 0) + 1;

        // Date Stats
        const dateStr = entry.preview?.date;
        if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                if (!stats.dates.min || date < stats.dates.min) stats.dates.min = date;
                if (!stats.dates.max || date > stats.dates.max) stats.dates.max = date;

                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                stats.dates.byYearMonth[key] = (stats.dates.byYearMonth[key] || 0) + 1;
            } else {
                stats.dates.invalid++;
            }
        } else {
            stats.dates.invalid++;
        }

        // Location Stats
        const loc = entry.preview?.location;
        if (loc) {
            stats.locations.total++;
            const region = loc.region || 'Unknown';
            stats.locations.byRegion[region] = (stats.locations.byRegion[region] || 0) + 1;
        } else {
            stats.locations.missing++;
        }

        // Correlation Stats (Date + Location Key)
        if (dateStr && loc && loc.region) {
            const key = `${dateStr}|${loc.region}`;
            if (!stats.correlations.byDateLocation[key]) {
                stats.correlations.byDateLocation[key] = new Set();
            }
            stats.correlations.byDateLocation[key].add(entry.category);
        }
    });

    // Process Correlation Results
    let multiCategoryDays = 0;
    let maxCategoriesOnDay = 0;
    const categoryOverlaps = {};

    Object.values(stats.correlations.byDateLocation).forEach(categories => {
        if (categories.size > 1) {
            multiCategoryDays++;
            if (categories.size > maxCategoriesOnDay) maxCategoriesOnDay = categories.size;

            // Track specific overlaps
            const cats = Array.from(categories).sort();
            for (let i = 0; i < cats.length; i++) {
                for (let j = i + 1; j < cats.length; j++) {
                    const pair = `${cats[i]}+${cats[j]}`;
                    categoryOverlaps[pair] = (categoryOverlaps[pair] || 0) + 1;
                }
            }
        }
    });

    console.log('\n--- Analysis Results ---');

    console.log('\nCategory Distribution:');
    console.table(stats.categories);

    console.log('\nTimeline Continuity:');
    console.log(`Range: ${stats.dates.min?.toISOString().split('T')[0]} to ${stats.dates.max?.toISOString().split('T')[0]}`);
    console.log(`Invalid/Missing Dates: ${stats.dates.invalid}`);
    console.log('Top 5 Months by Volume:');
    Object.entries(stats.dates.byYearMonth)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

    console.log('\nFilterability (Location):');
    console.log(`Missing Location: ${stats.locations.missing}`);
    console.log('Regions:');
    console.table(stats.locations.byRegion);

    console.log('\nCorrelations:');
    console.log(`Days with Multi-Category Data (same region): ${multiCategoryDays}`);
    console.log(`Max Categories on Single Day/Region: ${maxCategoriesOnDay}`);
    console.log('Top Category Overlaps:');
    Object.entries(categoryOverlaps)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

}

analyzeData().catch(console.error);
