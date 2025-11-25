/**
 * WHO Health Data Transformer
 * 
 * Transforms WHO health indicator data from HDX into the unified HealthData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class WHOTransformer extends BaseTransformer {
    constructor() {
        super('health');
    }

    /**
     * Transform raw WHO data to unified format
     */
    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData :
            (rawData.data ? rawData.data : []);

        return records
            .filter(record => record && this.isValidRecord(record))
            .map((record, index) => this.transformRecord(record, metadata, index));
    }

    /**
   * Check if record is valid
   */
    isValidRecord(record) {
        // Must have some data value (WHO uses 'Value' field)
        return record && (
            record.Value !== null && record.Value !== undefined ||
            record.value !== null && record.value !== undefined
        );
    }

    /**
     * Transform a single WHO health record
     */
    transformRecord(record, metadata, index) {
        const year = record.year || record.TimeDim || new Date().getFullYear();
        const date = `${year}-01-01`;

        // Extract indicator information
        const indicatorCode = record.IndicatorCode || record.indicator_code || 'UNKNOWN';
        const indicatorName = record.Indicator || record.indicator_name || 'Unknown Health Indicator';

        // Extract location
        const locationName = record.SpatialDim || record.location || 'Palestine';

        return {
            // Identity
            id: this.generateId('health', { ...record, date }),
            type: 'health',
            category: 'health',

            // Temporal
            date: date,
            timestamp: new Date(date).toISOString(),
            period: {
                type: 'year',
                value: year.toString(),
            },

            // Spatial
            location: {
                name: locationName,
                coordinates: null,
                admin_levels: {
                    level1: 'Palestine',
                    level2: null,
                    level3: null,
                },
                region: this.classifyRegion(locationName),
                region_type: null,
            },

            // Health-specific data
            indicator_code: indicatorCode,
            indicator_name: indicatorName,
            value: parseFloat(record.Value || record.value || 0),
            unit: this.detectUnit(indicatorName),

            // Additional WHO fields
            sex: record.Dim1 || null,
            age_group: record.Dim2 || null,
            data_source_type: record.DataSourceDimType || null,

            // Quality
            quality: this.enrichQuality({
                id: this.generateId('health', record),
                date,
                location: { name: locationName },
                value: record.Value || record.value,
            }).quality,

            // Provenance
            sources: [{
                name: metadata.source || 'WHO',
                organization: metadata.organization || 'World Health Organization',
                fetched_at: new Date().toISOString(),
            }],

            // Metadata
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
        };
    }

    /**
     * Detect unit from indicator name
     */
    detectUnit(indicatorName) {
        if (!indicatorName) return 'number';

        const name = indicatorName.toLowerCase();

        if (name.includes('per 100') || name.includes('per 1000') || name.includes('per 10000')) {
            return 'rate';
        }
        if (name.includes('%') || name.includes('percent')) {
            return 'percentage';
        }
        if (name.includes('years')) {
            return 'years';
        }
        if (name.includes('deaths')) {
            return 'deaths';
        }
        if (name.includes('cases')) {
            return 'cases';
        }
        if (name.includes('births')) {
            return 'births';
        }

        return 'number';
    }

    /**
     * Enrich WHO data with additional context
     */
    enrich(data) {
        // Group by indicator for trend analysis
        const byIndicator = {};
        data.forEach(record => {
            const code = record.indicator_code;
            if (!byIndicator[code]) byIndicator[code] = [];
            byIndicator[code].push(record);
        });

        // Add trend analysis to each record
        return data.map(record => {
            const timeSeries = byIndicator[record.indicator_code] || [];
            const analysis = this.calculateTrendAnalysis(timeSeries, record);

            return {
                ...record,
                analysis,
            };
        });
    }

    /**
     * Calculate trend analysis for health indicators
     */
    calculateTrendAnalysis(timeSeries, currentRecord) {
        if (timeSeries.length < 2) return null;

        // Sort by date
        const sorted = [...timeSeries].sort((a, b) => a.date.localeCompare(b.date));
        const values = sorted.map(r => r.value);

        // Calculate simple trend
        const firstValue = values[0];
        const lastValue = values[values.length - 1];
        const change = lastValue - firstValue;
        const percentChange = firstValue !== 0 ? (change / firstValue) * 100 : 0;

        let trend = 'stable';
        if (percentChange > 5) trend = 'increasing';
        else if (percentChange < -5) trend = 'decreasing';

        return {
            trend,
            percent_change: percentChange,
            first_value: firstValue,
            last_value: lastValue,
            data_points: values.length,
        };
    }
}

export default WHOTransformer;
