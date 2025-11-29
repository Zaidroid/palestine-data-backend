/**
 * Data Enricher Utility
 * 
 * Enriches data with:
 * - Geolocation (City -> Lat/Lon)
 * - Confidence Scores
 * - Standardized Date Formats
 * - Demographic Inference
 */

const PALESTINE_CITIES = {
    'Gaza City': { lat: 31.5, lon: 34.4667 },
    'Rafah': { lat: 31.2968, lon: 34.2455 },
    'Khan Yunis': { lat: 31.3462, lon: 34.3063 },
    'Jabalia': { lat: 31.529, lon: 34.482 },
    'Beit Lahia': { lat: 31.545, lon: 34.496 },
    'Deir al-Balah': { lat: 31.417, lon: 34.35 },
    'Ramallah': { lat: 31.9038, lon: 35.2034 },
    'Nablus': { lat: 32.2211, lon: 35.2544 },
    'Hebron': { lat: 31.5326, lon: 35.0998 },
    'Jenin': { lat: 32.4604, lon: 35.2956 },
    'Tulkarm': { lat: 32.3086, lon: 35.0285 },
    'Bethlehem': { lat: 31.7054, lon: 35.2024 },
    'Jericho': { lat: 31.8611, lon: 35.4617 },
    'Qalqilya': { lat: 32.196, lon: 34.9815 },
    'Salfit': { lat: 32.085, lon: 35.181 },
    'Tubas': { lat: 32.321, lon: 35.369 }
};

const SOURCE_CONFIDENCE = {
    'UN OCHA': 0.95,
    'B\'Tselem': 0.9,
    'PCHR': 0.85,
    'Al-Mezan': 0.85,
    'TechForPalestine': 0.9,
    'MoH': 0.8
};

export function enrichData(record) {
    const enriched = { ...record };

    // Geolocation
    if (!enriched.location && enriched.city && PALESTINE_CITIES[enriched.city]) {
        enriched.location = PALESTINE_CITIES[enriched.city];
    }

    // Confidence Score
    if (enriched.source && SOURCE_CONFIDENCE[enriched.source]) {
        enriched.confidence = SOURCE_CONFIDENCE[enriched.source];
    } else {
        enriched.confidence = 0.7; // Default
    }

    // Infer Demographics (Safe Calculation)
    if (enriched.casualties) {
        const { killed, children_killed, women_killed } = enriched.casualties;

        // If we have total, children, and women, we can infer men
        if (typeof killed === 'number' && typeof children_killed === 'number' && typeof women_killed === 'number') {
            if (enriched.casualties.men_killed === undefined) {
                enriched.casualties.men_killed = Math.max(0, killed - children_killed - women_killed);
            }
        }
    }

    return enriched;
}

export function enrichDataset(dataset) {
    return dataset.map(enrichData);
}
