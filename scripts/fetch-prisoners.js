import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADDAMEER_OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'static', 'prisoners-addameer.json');

async function fetchAddameerData() {
    console.log('Fetching Addameer statistics...');
    try {
        const response = await fetch('https://www.addameer.ps/statistics');
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }
        
        const html = await response.text();
        
        // Find all data-chart attributes
        const chartRegex = /data-chart="([^"]+)"/g;
        let match;
        
        const extractedData = {
            total_prisoners: 0,
            administrative_detainees: 0,
            child_prisoners: 0,
            female_prisoners: 0,
            last_updated: new Date().toISOString()
        };

        const todayTimestamp = new Date().toISOString();

        while ((match = chartRegex.exec(html)) !== null) {
            const rawJsonStr = match[1].replace(/&quot;/g, '"');
            try {
                const chartData = JSON.parse(rawJsonStr);
                const series = chartData.series && chartData.series[0];
                if (series && series.name && series.data && series.data.length > 0) {
                    const latestValue = series.data[0]; // Assuming first is latest based on '2026-03' being first in categories
                    
                    if (series.name.toLowerCase().includes('total number')) {
                        extractedData.total_prisoners = latestValue;
                    } else if (series.name.toLowerCase().includes('administrative')) {
                        extractedData.administrative_detainees = latestValue;
                    } else if (series.name.toLowerCase().includes('child')) {
                        extractedData.child_prisoners = latestValue;
                    } else if (series.name.toLowerCase().includes('female')) {
                        extractedData.female_prisoners = latestValue;
                    }
                }
            } catch (e) {
                console.warn('Failed to parse chart json', e.message);
            }
        }

        // Add fallback textual extraction for child and female counts if charts don't have them
        try {
            const cheerio = await import('cheerio');
            const $ = cheerio.load(html);
            let textContent = $('body').text().replace(/\n/g, ' ').replace(/\s+/g, ' ');
            
            // Remove colliding '1948 Territories' string that breaks the female prisoners number
            textContent = textContent.replace(/1948\s*Territories/gi, ' ');
            
            // Regex for e.g. "Child prisoners 350"
            const childMatch = textContent.match(/Child\s*prisoners\s*(\d+)/i);
            if (childMatch && childMatch[1]) {
                extractedData.child_prisoners = parseInt(childMatch[1], 10);
            }
            
            // Regex for e.g. "Female prisoners 73"
            const femaleMatch = textContent.match(/Female\s*prisoners\s*(\d+)/i);
            if (femaleMatch && femaleMatch[1]) {
                extractedData.female_prisoners = parseInt(femaleMatch[1], 10);
            }
        } catch (e) {
            console.warn('Failed to extract textual data:', e.message);
        }

        // Addameer metrics formatted into canonical structure
        const combinedResults = [
            {
                "id": "addameer_total",
                "date": todayTimestamp.split('T')[0],
                "report_date": todayTimestamp.split('T')[0],
                "governorate": "West Bank & Gaza",
                "total_arrests": extractedData.total_prisoners,
                "administrative_detainees": extractedData.administrative_detainees,
                "child_prisoners": extractedData.child_prisoners,
                "female_prisoners": extractedData.female_prisoners,
                "notes": "Data sourced directly from Addameer Statistics dashboard.",
                "source": "Addameer Prisoner Support and Human Rights Association"
            }
        ];
        
        fs.writeFileSync(ADDAMEER_OUTPUT_PATH, JSON.stringify(combinedResults, null, 2));
        console.log(`Addameer data saved to ${ADDAMEER_OUTPUT_PATH}`);
        
    } catch (error) {
        console.error('Error fetching Addameer data:', error);
        process.exit(1);
    }
}

fetchAddameerData();
