/**
 * Base Data Transformer
 * 
 * Abstract base class for transforming raw data from various sources
 * into the unified data model format.
 */

/**
 * Base transformer class with common transformation logic
 */
export class BaseTransformer {
  constructor(category) {
    this.category = category;
  }

  /**
   * Transform raw data to unified format
   * Must be implemented by subclasses
   */
  transform(rawData, metadata) {
    throw new Error('transform() must be implemented by subclass');
  }

  /**
   * Validate transformed data
   */
  validate(data) {
    // Basic validation - can be overridden
    if (!Array.isArray(data)) {
      return {
        valid: false,
        errors: ['Data must be an array'],
      };
    }

    return {
      valid: true,
      errors: [],
    };
  }

  /**
   * Enrich data with calculated fields
   */
  enrich(data) {
    return data.map(record => ({
      ...record,
      ...this.enrichTemporal(record),
      ...this.enrichSpatial(record),
      ...this.enrichQuality(record),
    }));
  }

  /**
   * Add temporal enrichment (baseline comparison, conflict phase, etc.)
   */
  enrichTemporal(record) {
    const baselineDate = '2023-10-07';

    if (!record.date) return {};

    const recordDate = new Date(record.date);
    const baseline = new Date(baselineDate);
    const daysSinceBaseline = Math.floor((recordDate - baseline) / (1000 * 60 * 60 * 24));

    return {
      temporal_context: {
        days_since_baseline: daysSinceBaseline,
        baseline_period: recordDate < baseline ? 'before_baseline' : 'after_baseline',
        conflict_phase: this.determineConflictPhase(record.date),
      },
    };
  }

  /**
   * Determine conflict phase based on date
   */
  determineConflictPhase(date) {
    const recordDate = new Date(date);
    const baseline = new Date('2023-10-07');

    if (recordDate < baseline) {
      return 'pre-escalation';
    } else if (recordDate < new Date('2024-01-01')) {
      return 'active-conflict';
    } else {
      return 'ongoing-conflict';
    }
  }

  /**
   * Add spatial enrichment (admin levels, proximity, etc.)
   */
  enrichSpatial(record) {
    if (!record.location) return {};

    return {
      location: {
        ...record.location,
        region: this.classifyRegion(record.location.name),
      },
    };
  }

  /**
   * Classify region (Gaza, West Bank, East Jerusalem)
   */
  classifyRegion(locationName) {
    if (!locationName || typeof locationName !== 'string') return 'Unknown';

    // Normalize: trim, remove extra spaces and special characters like pipes
    const name = locationName.toLowerCase().trim().replace(/\s*\|\s*/g, '').trim();

    if (!name || name === '') return 'Unknown';

    // Gaza Strip Governorates
    if (name.includes('gaza') || name.includes('rafah') || name.includes('khan yunis') || name.includes('khan younis') || name.includes('deir al-balah') || name.includes('jabalia')) return 'Gaza Strip';

    // West Bank Governorates
    if (name.includes('west bank') || name.includes('westbank') || name.includes('ramallah') || name.includes('hebron') || name.includes('nablus') || name.includes('jenin') || name.includes('tulkarm') || name.includes('qalqilya') || name.includes('tubas') || name.includes('salfit') || name.includes('bethlehem') || name.includes('jericho')) return 'West Bank';

    // Jerusalem
    if (name.includes('jerusalem') || name.includes('al-quds')) return 'East Jerusalem';

    if (name.includes('palestine') || name === 'pse') return 'Palestine';

    return 'Unknown';
  }

  /**
   * Add quality metrics
   */
  enrichQuality(record) {
    const completeness = this.calculateCompleteness(record);
    const consistency = this.calculateConsistency(record);
    const accuracy = this.calculateAccuracy(record);

    return {
      quality: {
        score: (completeness + consistency + accuracy) / 3,
        completeness,
        consistency,
        accuracy,
        verified: false,
        confidence: 0.8,
      },
    };
  }

  /**
   * Calculate data completeness (0-1)
   */
  calculateCompleteness(record) {
    // Use category-specific required fields
    const baseFields = ['id', 'date'];
    const categoryFields = this.getCategoryRequiredFields();
    const requiredFields = [...baseFields, ...categoryFields];

    let present = 0;
    for (const field of requiredFields) {
      if (record[field] !== null && record[field] !== undefined && record[field] !== '') {
        present++;
      }
    }

    return present / requiredFields.length;
  }

  /**
   * Get category-specific required fields
   */
  getCategoryRequiredFields() {
    const categoryFields = {
      conflict: ['type', 'location'],
      economic: ['value', 'unit'],
      education: ['facility_name'],
      health: ['facility_name'],
      water: ['facility_name'],
      humanitarian: ['people_in_need'],
      infrastructure: ['structure_type'],
      refugee: ['displaced_population'],
    };

    return categoryFields[this.category] || ['type', 'value'];
  }

  /**
   * Calculate data consistency (0-1)
   */
  calculateConsistency(record) {
    let score = 1.0;

    // Check date validity
    if (record.date) {
      const date = new Date(record.date);
      if (isNaN(date.getTime())) {
        score -= 0.4;
      } else if (date > new Date()) {
        score -= 0.2; // Future dates are suspicious but not invalid
      }
    }

    // Check location validity
    if (record.location?.coordinates) {
      const [lon, lat] = record.location.coordinates;
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        score -= 0.4;
      }
    }

    // Check value ranges for numeric fields
    if (typeof record.value === 'number') {
      if (record.value < 0) score -= 0.2;
      if (record.value > 1000000000) score -= 0.1; // Very large values suspicious
    }

    return Math.max(0, score);
  }

  /**
   * Calculate data accuracy (0-1)
   */
  calculateAccuracy(record) {
    let score = 1.0;

    // Check for data source reliability
    if (record.sources && Array.isArray(record.sources)) {
      // Prefer official sources
      const hasOfficialSource = record.sources.some(source =>
        source.organization?.toLowerCase().includes('un') ||
        source.organization?.toLowerCase().includes('who') ||
        source.organization?.toLowerCase().includes('world bank') ||
        source.organization?.toLowerCase().includes('ocha')
      );
      if (hasOfficialSource) score += 0.1;
    }

    // Check for reasonable date ranges (post-2020)
    if (record.date) {
      const date = new Date(record.date);
      if (date < new Date('2020-01-01')) {
        score -= 0.1; // Older data might be less accurate
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Normalize date to ISO 8601 YYYY-MM-DD format
   */
  normalizeDate(dateValue) {
    if (!dateValue) return null;

    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return null;
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  /**
   * Extract coordinates from various formats
   */
  extractCoordinates(record) {
    // Try different coordinate field names
    if (record.latitude && record.longitude) {
      return [parseFloat(record.longitude), parseFloat(record.latitude)];
    }
    if (record.lat && record.lon) {
      return [parseFloat(record.lon), parseFloat(record.lat)];
    }
    if (record.coordinates && Array.isArray(record.coordinates)) {
      return record.coordinates;
    }

    return null;
  }

  /**
   * Generate unique ID for a record
   */
  generateId(prefix, record) {
    const timestamp = record.date || new Date().toISOString();
    const location = record.location?.name || 'unknown';
    const hash = this.simpleHash(`${timestamp}-${location}-${JSON.stringify(record)}`);
    return `${prefix}-${hash}`;
  }

  /**
   * Simple hash function for generating IDs
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

export default BaseTransformer;
