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
    if (!locationName) return 'unknown';
    
    const name = locationName.toLowerCase();
    
    if (name.includes('gaza')) return 'gaza';
    if (name.includes('west bank') || name.includes('westbank')) return 'west_bank';
    if (name.includes('jerusalem')) return 'east_jerusalem';
    
    return 'unknown';
  }
  
  /**
   * Add quality metrics
   */
  enrichQuality(record) {
    const completeness = this.calculateCompleteness(record);
    const consistency = this.calculateConsistency(record);
    
    return {
      quality: {
        score: (completeness + consistency) / 2,
        completeness,
        consistency,
        verified: false,
        confidence: 0.8,
      },
    };
  }
  
  /**
   * Calculate data completeness (0-1)
   */
  calculateCompleteness(record) {
    const requiredFields = ['id', 'type', 'category', 'date', 'location', 'value'];
    let present = 0;
    
    for (const field of requiredFields) {
      if (record[field] !== null && record[field] !== undefined) {
        present++;
      }
    }
    
    return present / requiredFields.length;
  }
  
  /**
   * Calculate data consistency (0-1)
   */
  calculateConsistency(record) {
    let score = 1.0;
    
    // Check date validity
    if (record.date) {
      const date = new Date(record.date);
      if (isNaN(date.getTime()) || date > new Date()) {
        score -= 0.3;
      }
    }
    
    // Check location validity
    if (record.location?.coordinates) {
      const [lon, lat] = record.location.coordinates;
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        score -= 0.3;
      }
    }
    
    return Math.max(0, score);
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
