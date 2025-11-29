import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '../public/data/historical/nakba');

// Representative list of major depopulated villages/towns
// Source: Historical records (Walid Khalidi, Palestine Remembered)
const NAKBA_VILLAGES = [
    { name: "Deir Yassin", district: "Jerusalem", population_1948: 610, depopulation_date: "1948-04-09", coord: [35.17, 31.78] },
    { name: "Ein al-Zaytun", district: "Safad", population_1948: 820, depopulation_date: "1948-05-01", coord: [35.49, 32.98] },
    { name: "Saffuriya", district: "Nazareth", population_1948: 4330, depopulation_date: "1948-07-16", coord: [35.27, 32.74] },
    { name: "Al-Tantura", district: "Haifa", population_1948: 1490, depopulation_date: "1948-05-22", coord: [34.92, 32.60] },
    { name: "Lydda (Lod)", district: "Ramle", population_1948: 18250, depopulation_date: "1948-07-11", coord: [34.89, 31.95] },
    { name: "Ramle", district: "Ramle", population_1948: 15160, depopulation_date: "1948-07-12", coord: [34.87, 31.93] },
    { name: "Al-Majdal (Ashkelon)", district: "Gaza", population_1948: 9910, depopulation_date: "1948-11-04", coord: [34.56, 31.66] },
    { name: "Isdud", district: "Gaza", population_1948: 4630, depopulation_date: "1948-10-28", coord: [34.64, 31.78] },
    { name: "Bayt Daras", district: "Gaza", population_1948: 2750, depopulation_date: "1948-05-11", coord: [34.68, 31.72] },
    { name: "Al-Faluja", district: "Gaza", population_1948: 4640, depopulation_date: "1949-03-01", coord: [34.75, 31.60] },
    { name: "Lifta", district: "Jerusalem", population_1948: 2550, depopulation_date: "1948-02-01", coord: [35.19, 31.79] },
    { name: "Al-Maliha", district: "Jerusalem", population_1948: 1940, depopulation_date: "1948-07-15", coord: [35.18, 31.75] },
    { name: "Al-Walaja", district: "Jerusalem", population_1948: 1650, depopulation_date: "1948-10-21", coord: [35.16, 31.73] },
    { name: "Lubya", district: "Tiberias", population_1948: 2350, depopulation_date: "1948-07-16", coord: [35.44, 32.77] },
    { name: "Hittin", district: "Tiberias", population_1948: 1190, depopulation_date: "1948-07-17", coord: [35.46, 32.80] },
    { name: "Zir'in", district: "Jenin", population_1948: 1420, depopulation_date: "1948-05-28", coord: [35.32, 32.55] },
    { name: "Al-Kabisri", district: "Safad", population_1948: 260, depopulation_date: "1948-05-01", coord: [35.51, 33.00] }
];

async function fetchNakbaData() {
    console.log('🏛️  Generating Nakba (1948) village data...');

    try {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });

        const processedData = NAKBA_VILLAGES.map(village => ({
            ...village,
            event_type: "depopulation",
            period: "Nakba",
            year: 1948
        }));

        const outputPath = path.join(OUTPUT_DIR, 'nakba-villages.json');
        await fs.writeFile(outputPath, JSON.stringify(processedData, null, 2));

        console.log(`✅ Saved ${processedData.length} Nakba village records to ${outputPath}`);
    } catch (error) {
        console.error('❌ Error generating Nakba data:', error);
        process.exit(1);
    }
}

fetchNakbaData();
