
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../public/data');

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);

    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });

    return arrayOfFiles;
}

async function analyzeData() {
    console.log('Starting Data Analysis...');
    const allFiles = getAllFiles(DATA_DIR);
    const unifiedFiles = allFiles.filter(f => f.endsWith('unified-data.json') || f.endsWith('unified-historical-data.json'));

    const stats = {
        totalRecords: 0,
        categories: {},
        timeline: {
            min: new Date().toISOString(),
            max: new Date(0).toISOString()
        }
    };

    for (const file of unifiedFiles) {
        try {
            const content = JSON.parse(fs.readFileSync(file, 'utf8'));
            const records = content.data || [];

            stats.totalRecords += records.length;

            records.forEach(record => {
                // Category Stats
                const cat = record.category || 'unknown';
                if (!stats.categories[cat]) {
                    stats.categories[cat] = { count: 0, types: new Set(), minDate: record.date, maxDate: record.date };
                }
                stats.categories[cat].count++;
                stats.categories[cat].types.add(record.event_type);

                // Timeline Stats
                if (record.date < stats.categories[cat].minDate) stats.categories[cat].minDate = record.date;
                if (record.date > stats.categories[cat].maxDate) stats.categories[cat].maxDate = record.date;

                if (record.date < stats.timeline.min) stats.timeline.min = record.date;
                if (record.date > stats.timeline.max) stats.timeline.max = record.date;
            });

        } catch (e) {
            console.error(`Error reading ${file}:`, e.message);
        }
    }

    const report = [];
    report.push('=== DATA COVERAGE REPORT ===');
    report.push(`Total Unified Records: ${stats.totalRecords}`);
    report.push(`Overall Timeline: ${stats.timeline.min.split('T')[0]} to ${stats.timeline.max.split('T')[0]}`);
    report.push('\n--- Category Breakdown ---');

    Object.entries(stats.categories).forEach(([cat, data]) => {
        report.push(`\nCategory: ${cat.toUpperCase()}`);
        report.push(`  Records: ${data.count}`);
        report.push(`  Timeline: ${data.minDate.split('T')[0]} to ${data.maxDate.split('T')[0]}`);
        report.push(`  Types: ${Array.from(data.types).join(', ')}`);
    });

    fs.writeFileSync(path.join(__dirname, 'analysis_report.txt'), report.join('\n'));
    console.log('Analysis complete. Report saved to scripts/analysis_report.txt');
}

analyzeData();
