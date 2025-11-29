#!/usr/bin/env node

/**
 * Data Coverage Report Generator (Enhanced)
 * 
 * Analyzes unified-historical-data.json and generates a detailed, era-based report.
 * Distinguishes between "Conflict Events" and "Statistical Indicators".
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNIFIED_DIR = path.join(__dirname, '../public/data/unified');
const REPORT_FILE = path.join(__dirname, '../public/data/historical/coverage-report.md');

// Initialize logger
const logger = createLogger({
    context: 'Coverage-Reporter',
    logLevel: 'INFO',
});

const ERAS = [
    { name: 'Pre-1967', start: 1948, end: 1966 },
    { name: 'Occupation Begins', start: 1967, end: 1986 },
    { name: 'First Intifada', start: 1987, end: 1993 },
    { name: 'Oslo Period', start: 1994, end: 1999 },
    { name: 'Second Intifada', start: 2000, end: 2005 },
    { name: 'Gaza Blockade & Wars', start: 2006, end: 2023 }
];

async function readJSON(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

async function main() {
    try {
        await logger.info('Generating detailed coverage report...');

        // Read from multiple unified sources
        const sources = [
            path.join(UNIFIED_DIR, 'historical/all-data.json'),
            path.join(UNIFIED_DIR, 'conflict/all-data.json'),
            path.join(UNIFIED_DIR, 'martyrs/all-data.json')
        ];

        let allRecords = [];
        for (const src of sources) {
            const content = await readJSON(src);
            if (content && content.data) {
                allRecords = allRecords.concat(content.data);
            }
        }

        if (allRecords.length === 0) {
            await logger.error('No unified data found in any category.');
            return;
        }

        const stats = {
            total: allRecords.length,
            conflictRecords: 0,
            statisticalRecords: 0,
            eras: {}
        };

        // Initialize eras
        ERAS.forEach(era => {
            stats.eras[era.name] = {
                conflictCount: 0,
                statsCount: 0,
                casualties: { killed: 0, injured: 0 },
                sources: new Set()
            };
        });

        // Analyze data
        allRecords.forEach(record => {
            let year = 0;
            if (record.year) year = record.year;
            else if (record.date) year = parseInt(record.date.substring(0, 4));
            else if (record.date_of_death) year = parseInt(record.date_of_death.substring(0, 4));

            const isConflict = [
                'war', 'incident', 'Fatality', 'depopulation', 'aggregate_fatality',
                'killing of journalist', 'summary', 'daily_casualty_report',
                'uprising', 'political'
            ].includes(record.event_type);

            if (isConflict) stats.conflictRecords++;
            else stats.statisticalRecords++;

            // Find Era
            const era = ERAS.find(e => year >= e.start && year <= e.end);
            if (era) {
                const eraStats = stats.eras[era.name];
                if (isConflict) {
                    eraStats.conflictCount++;
                    // Handle different casualty fields
                    let killed = 0;
                    let injured = 0;

                    if (record.metrics) {
                        killed = record.metrics.killed || 0;
                        injured = record.metrics.injured || 0;
                    } else {
                        killed = record.fatalities || record.killed || (record.count && record.type === 'aggregate_fatality' ? record.count : 0) || 0;
                        injured = record.injuries || record.injured || 0;
                    }

                    eraStats.casualties.killed += killed;
                    eraStats.casualties.injured += injured;
                } else {
                    eraStats.statsCount++;
                }
                if (record.source || record.source_link) eraStats.sources.add(record.source || record.source_link);
            }
        });

        // Generate Markdown
        let report = `# Historical Data Coverage Report\n\n`;
        report += `**Generated:** ${new Date().toISOString()}\n\n`;

        report += `## Executive Summary\n`;
        report += `We have a total of **${stats.total} records** spanning 1948-2023.\n`;
        report += `- **Conflict Events:** ${stats.conflictRecords} (Wars, Incidents, Depopulation)\n`;
        report += `- **Statistical Indicators:** ${stats.statisticalRecords} (Demographics, Health, Economy)\n\n`;

        report += `## Coverage by Historical Era\n\n`;
        report += `| Era | Period | Conflict Records | Casualties (Killed) | Statistical Records | Status |\n`;
        report += `|-----|--------|------------------|---------------------|---------------------|--------|\n`;

        ERAS.forEach(era => {
            const s = stats.eras[era.name];
            const status = s.conflictCount > 0 ? '✅ Covered' : '⚠️ Gap';
            report += `| **${era.name}** | ${era.start}-${era.end} | ${s.conflictCount} | ${s.casualties.killed.toLocaleString()} | ${s.statsCount} | ${status} |\n`;
        });
        report += `\n`;

        report += `## Detailed Gap Analysis\n\n`;

        ERAS.forEach(era => {
            const s = stats.eras[era.name];
            if (s.conflictCount === 0) {
                report += `### 🔴 Gap: ${era.name} (${era.start}-${era.end})\n`;
                report += `- **Missing:** No specific conflict events or casualty records.\n`;
                report += `- **Available:** ${s.statsCount} statistical indicators.\n`;
                report += `- **Action:** Need to find sources for this period.\n\n`;
            } else {
                report += `### ✅ Covered: ${era.name} (${era.start}-${era.end})\n`;
                report += `- **Conflict Events:** ${s.conflictCount} records.\n`;
                report += `- **Casualties:** ${s.casualties.killed.toLocaleString()} killed.\n\n`;
            }
        });

        report += `## Data Sources Used\n`;
        const allSources = new Set();
        Object.values(stats.eras).forEach(e => e.sources.forEach(s => allSources.add(s)));
        allSources.forEach(source => {
            report += `- ${source}\n`;
        });

        await fs.writeFile(REPORT_FILE, report, 'utf-8');
        await logger.success(`Detailed report generated at ${REPORT_FILE}`);

    } catch (error) {
        await logger.error('Failed to generate report', error);
    }
}

main();
