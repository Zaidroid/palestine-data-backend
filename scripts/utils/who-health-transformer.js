/**
 * WHO Health Data Transformer
 * 
 * Specialized transformer for WHO (World Health Organization) health indicator data.
 * WHO data has a unique schema with fields like gho_(code), year_(display), numeric, etc.
 */

import { BaseTransformer } from './base-transformer.js';

export class WHOHealthTransformer extends BaseTransformer {
    constructor() {
        super('health');
    }

    /**
     * Transform WHO CSV data structure
     * WHO data comes as: { data: { csv: [...] } }
     */
    transform(rawData, metadata) {
        // WHO data is wrapped in data.csv
        let records = [];

        if (rawData.data && rawData.data.csv && Array.isArray(rawData.data.csv)) {
            records = rawData.data.csv;
        } else if (Array.isArray(rawData)) {
            records = rawData;
        } else {
            return [];
        }

        return records
            .filter(record => record && this.isValidWHORecord(record))
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => record !== null);
    }

    /**
     * Check if WHO record has minimum required fields
     */
    isValidWHORecord(record) {
        // Must have indicator code and value
        const hasIndicator = record['gho_(code)'] || record['gho_(display)'];
        const hasValue = record.numeric !== null && record.numeric !== undefined;
        const hasYear = record['year_(display)'] || record.startyear;

        return hasIndicator && hasValue && hasYear;
    }

    /**
     * Transform single WHO record to unified format
     */
    transformRecord(record, metadata, index) {
        try {
            // Extract year from year_(display) or startyear
            const year = this.extractYear(record);
            if (!year) return null;

            // Drop WHO "projection" rows dated past today — these are baseline
            // forecasts (e.g. tobacco-control 2030 targets), not measurements,
            // and they poison /quality with false freshness.
            const currentYear = new Date().getUTCFullYear();
            if (year > currentYear) return null;

            // Create date from year
            const date = `${year}-01-01`;

            // Extract indicator information
            const indicator = {
                code: record['gho_(code)'] || 'unknown',
                name: record['gho_(display)'] || 'Unknown Indicator',
                url: record['gho_(url)'] || null
            };

            // Extract value
            const value = record.numeric !== null ? record.numeric : record.value;
            if (value === null || value === undefined) return null;

            // Extract dimension/breakdown info
            const dimension = this.extractDimension(record);

            const locationName = record['country_(display)'] || 'Palestine';
            return this.toCanonical({
                id: `who-health-${indicator.code}-${year}-${index}`,
                date,
                category: 'health',
                event_type: 'health_indicator',
                location: {
                    name: locationName,
                    governorate: null,
                    region: this.classifyRegion(locationName),
                    lat: null,
                    lon: null,
                    precision: 'region',
                },
                metrics: {
                    value,
                    unit: this.inferUnit(indicator.name, value),
                    count: 1,
                },
                description: indicator.name,
                indicator_code: indicator.code,
                indicator_name: indicator.name,
                indicator_url: indicator.url || null,
                value_low: record.low || null,
                value_high: record.high || null,
                dimension,
                sources: [{
                    name: 'WHO',
                    organization: 'World Health Organization',
                    url: indicator.url || null,
                    license: 'public-domain',
                    fetched_at: new Date().toISOString(),
                }],
            });

        } catch (error) {
            console.warn(`Error transforming WHO record ${index}:`, error.message);
            return null;
        }
    }

    /**
     * Extract year from WHO date fields
     */
    extractYear(record) {
        // Try year_(display) first
        if (record['year_(display)']) {
            const yearDisplay = record['year_(display)'];

            // If it's already a number
            if (typeof yearDisplay === 'number') {
                return parseInt(yearDisplay);
            }

            // If it's a string, extract year
            if (typeof yearDisplay === 'string') {
                const yearMatch = yearDisplay.match(/\d{4}/);
                if (yearMatch) return parseInt(yearMatch[0]);
            }
        }

        // Try startyear
        if (record.startyear) {
            return parseInt(record.startyear);
        }

        // Try endyear
        if (record.endyear) {
            return parseInt(record.endyear);
        }

        return null;
    }

    /**
     * Extract dimension/breakdown information
     */
    extractDimension(record) {
        const dimension = {};

        if (record['dimension_(type)']) {
            dimension.type = record['dimension_(type)'];
        }

        if (record['dimension_(code)']) {
            dimension.code = record['dimension_(code)'];
        }

        if (record['dimension_(name)']) {
            dimension.name = record['dimension_(name)'];
        }

        return Object.keys(dimension).length > 0 ? dimension : null;
    }

    /**
     * Infer unit from indicator name
     */
    inferUnit(indicatorName, value) {
        const name = indicatorName.toLowerCase();

        if (name.includes('percent') || name.includes('%') || name.includes('rate')) {
            return 'percentage';
        }

        if (name.includes('per 1000') || name.includes('per 10000')) {
            return 'per_capita';
        }

        if (name.includes('years') && name.includes('expectancy')) {
            return 'years';
        }

        if (name.includes('usd') || name.includes('dollars')) {
            return 'currency_usd';
        }

        if (value >= 0 && value <= 100 && !Number.isInteger(value)) {
            // Likely a percentage
            return 'percentage';
        }

        return 'number';
    }
}
