import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '../public/data/btselem');

// Aggregate data based on B'Tselem and UN reports
const CONFLICT_PERIODS = [
    {
        name: "Second Intifada",
        start_date: "2000-09-28",
        end_date: "2005-02-08",
        killed: 3189, // Approx Palestinian fatalities
        description: "Major uprising against occupation",
        region: "West Bank & Gaza"
    },
    {
        name: "Operation Cast Lead",
        start_date: "2008-12-27",
        end_date: "2009-01-18",
        killed: 1391,
        description: "War on Gaza",
        region: "Gaza Strip"
    },
    {
        name: "Operation Pillar of Defense",
        start_date: "2012-11-14",
        end_date: "2012-11-21",
        killed: 167,
        description: "War on Gaza",
        region: "Gaza Strip"
    },
    {
        name: "Operation Protective Edge",
        start_date: "2014-07-08",
        end_date: "2014-08-26",
        killed: 2251,
        description: "War on Gaza",
        region: "Gaza Strip"
    },
    {
        name: "Great March of Return",
        start_date: "2018-03-30",
        end_date: "2019-12-27",
        killed: 223,
        description: "Border protests",
        region: "Gaza Strip"
    },
    {
        name: "Operation Guardian of the Walls",
        start_date: "2021-05-10",
        end_date: "2021-05-21",
        killed: 256,
        description: "War on Gaza",
        region: "Gaza Strip"
    }
];

async function fetchBtselemData() {
    console.log('🕊️  Generating B\'Tselem aggregate data (2000-2023)...');

    try {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });

        // Expand aggregates into "representative" daily records or keep as aggregate events?
        // For now, we'll create a special "aggregate" type that the frontend can visualize as a block or bar.
        // However, to fit the "martyrs" schema which is usually individual, we might want to create a separate file
        // or just store them as "event summaries".

        // Let's store them as "summary records" which might be different from individual martyr records.
        // But to ensure they show up in the timeline, we'll format them to be compatible.

        const processedData = CONFLICT_PERIODS.map(period => ({
            name: period.name,
            date_of_death: period.start_date, // Anchor to start date
            end_date: period.end_date,
            age: null,
            gender: null,
            residence: period.region,
            killed_by: "Israeli Forces",
            source: "B'Tselem (Aggregate)",
            count: period.killed, // Special field for aggregates
            type: "aggregate_fatality"
        }));

        const outputPath = path.join(OUTPUT_DIR, 'btselem-aggregates.json');
        await fs.writeFile(outputPath, JSON.stringify(processedData, null, 2));

        console.log(`✅ Saved ${processedData.length} aggregate conflict periods to ${outputPath}`);
    } catch (error) {
        console.error('❌ Error generating B\'Tselem data:', error);
        process.exit(1);
    }
}

fetchBtselemData();
