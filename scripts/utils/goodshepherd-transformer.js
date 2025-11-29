/**
 * Good Shepherd Data Transformer
 * 
 * Transforms data from Good Shepherd sources (prisoners, healthcare, etc.)
 * into the Unified Data Format.
 */

export class GoodShepherdTransformer {
    constructor() {
        this.source = 'Good Shepherd';
    }

    /**
     * Transform a record
     * @param {Object} record Raw record
     * @param {Object} context Additional context (category, etc.)
     */
    transform(record, context = {}) {
        const category = context.category || 'conflict';

        // Base structure
        const unified = {
            id: record.id || this.generateId(record),
            source: this.source,
            category: category,
            date: this.extractDate(record),
            location: this.extractLocation(record),
            event_type: this.extractEventType(record, category),
            metrics: {},
            metadata: {
                original_source: 'Good Shepherd',
                ...record
            }
        };

        // Category specific transformations
        if (category === 'conflict' || category === 'prisoners') {
            this.transformPrisonerData(unified, record);
        } else if (category === 'health' || category === 'healthcare') {
            this.transformHealthData(unified, record);
        } else if (category === 'ngo') {
            this.transformNGOData(unified, record);
        }

        return unified;
    }

    transformPrisonerData(unified, record) {
        unified.category = 'conflict'; // Map prisoners to conflict or create new category? Let's use conflict for now or 'prisoners' if supported
        unified.event_type = 'detention_report';

        // Map common fields
        if (record.total_prisoners) unified.metrics.total_prisoners = parseInt(record.total_prisoners);
        if (record.administrative_detainees) unified.metrics.administrative_detainees = parseInt(record.administrative_detainees);
        if (record.child_prisoners) unified.metrics.child_prisoners = parseInt(record.child_prisoners);
        if (record.female_prisoners) unified.metrics.female_prisoners = parseInt(record.female_prisoners);

        // If it's a specific incident
        if (record.arrests) unified.metrics.arrests = parseInt(record.arrests);
    }

    transformHealthData(unified, record) {
        unified.category = 'health';
        unified.event_type = 'healthcare_status';

        if (record.hospitals_functioning) unified.metrics.hospitals_functioning = parseInt(record.hospitals_functioning);
        if (record.clinics_functioning) unified.metrics.clinics_functioning = parseInt(record.clinics_functioning);
        if (record.attacks_on_healthcare) unified.metrics.attacks = parseInt(record.attacks_on_healthcare);
    }

    transformNGOData(unified, record) {
        unified.category = 'humanitarian';
        unified.event_type = 'ngo_activity';

        if (record.funding_amount) unified.metrics.funding = parseFloat(record.funding_amount);
        if (record.beneficiaries) unified.metrics.beneficiaries = parseInt(record.beneficiaries);
    }

    extractDate(record) {
        // Try to find a date field
        if (record.date) return record.date;
        if (record.report_date) return record.report_date;
        if (record.timestamp) return new Date(record.timestamp).toISOString().split('T')[0];

        // Handle Quarter format (e.g., "2024-Q1")
        if (record.period) {
            const match = record.period.match(/(\d{4})-Q(\d)/);
            if (match) {
                const year = match[1];
                const quarter = match[2];
                // Return end of quarter date approx
                const month = quarter * 3;
                return `${year}-${month.toString().padStart(2, '0')}-30`;
            }
        }

        return new Date().toISOString().split('T')[0]; // Fallback to today
    }

    extractLocation(record) {
        if (record.location) return record.location;
        if (record.region) return record.region;
        return 'Palestine'; // Default
    }

    extractEventType(record, category) {
        if (record.event_type) return record.event_type;
        return `${category}_report`;
    }

    generateId(record) {
        return `gs-${Math.random().toString(36).substr(2, 9)}`;
    }
}
