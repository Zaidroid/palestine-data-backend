import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REFUGEES_OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'static', 'unrwa-refugees.json');

async function fetchRefugeesData() {
    console.log('Fetching UNRWA Refugee statistics from Wikipedia...');
    try {
        const response = await fetch('https://en.wikipedia.org/wiki/Palestinian_refugee_camps');
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const results = [];
        const todayTimestamp = new Date().toISOString();

        // Find the main wikitable containing camp populations
        $('table.wikitable.sortable tbody tr').each((index, element) => {
            if (index === 0) return; // Skip header
            
            const tds = $(element).find('td, th');
            if (tds.length >= 6) {
                let name = $(tds[0]).text().trim();
                let founded = $(tds[1]).text().trim();
                let location = $(tds[2]).text().trim();
                let status = $(tds[3]).text().trim();
                let populationRaw = $(tds[5]).text().replace(/,/g, '').trim();
                
                // Remove citations like [8]
                name = name.replace(/\[\d+\]/g, '').trim();
                populationRaw = populationRaw.replace(/\[\d+\]/g, '').trim();
                
                let population = parseInt(populationRaw, 10);
                
                // If it's a valid camp with population
                if (!isNaN(population) && name && location) {
                    // Standardize governorate/region format to match unified schema
                    let governorate = location;
                    if (location.includes("Gaza")) governorate = "Gaza Strip";
                    else if (location.includes("West Bank")) governorate = "West Bank";
                    else if (location.includes("Syria")) governorate = "Syria";
                    else if (location.includes("Lebanon")) governorate = "Lebanon";
                    else if (location.includes("Jordan")) governorate = "Jordan";

                    results.push({
                        id: `camp_${name.toLowerCase().replace(/\s+/g, '_')}`,
                        date: todayTimestamp.split('T')[0],
                        report_date: todayTimestamp.split('T')[0],
                        governorate: governorate,
                        camp_name: name,
                        founded: founded,
                        status: status,
                        total_population: population,
                        source: 'UNRWA via Wikipedia Aggregation'
                    });
                }
            }
        });

        fs.writeFileSync(REFUGEES_OUTPUT_PATH, JSON.stringify(results, null, 2));
        console.log(`Refugees data saved to ${REFUGEES_OUTPUT_PATH}. Found ${results.length} camps.`);
        
    } catch (error) {
        console.error('Error fetching Refugees data:', error);
        process.exit(1);
    }
}

fetchRefugeesData();
