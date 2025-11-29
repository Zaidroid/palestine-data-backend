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

            // Build unified record
            return {
                id: `who-health-${indicator.code}-${year}-${index}`,
                category: 'health',
                date: date,
                source: 'WHO',
                location: {
                    name: record['country_(display)'] || 'Palestine',
                    region: record['region_(display)'] || 'Eastern Mediterranean',
                    country_code: record['country_(code)'] || 'PSE'
                },
                data: {
                    indicator: indicator.name,
                    indicator_code: indicator.code,
                    indicator_url: indicator.url,
                    value: value,
                    low: record.low,
                    high: record.high,
                    year: year,
                    dimension: dimension,
                    unit: this.inferUnit(indicator.name, value)
                },
                metadata: {
                    source_type: 'WHO Health Indicators',
                    data_quality: 'high',
                    confidence: 0.9,
                    year_range: record.startyear && record.endyear ?
                        `${record.startyear}-${record.endyear}` : year.toString()
                }
            };

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
