/**
 * Culture & Heritage Data Transformer
 * 
 * Transforms cultural heritage site data from UNESCO, Ministry of Tourism,
 * and NGO reports into the unified CultureData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class CultureTransformer extends BaseTransformer {
  constructor() {
    super('culture');
  }

  /**
   * Transform raw culture data to unified format
   */
  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : 
      (rawData.sites ? rawData.sites : []);

    return records
      .filter(record => record && record.name)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  /**
   * Transform a single heritage site record
   */
  transformRecord(record, metadata, index) {
    const date = record.date || record.last_updated || new Date().toISOString().split('T')[0];
    
    return {
      // Identity
      id: this.generateId('culture', { ...record, date }),
      type: 'culture',
      category: 'culture',

      // Temporal
      date: date,
      timestamp: new Date(date).toISOString(),
      period: {
        type: 'point',
        value: date,
      },

      // Spatial
      location: {
        name: record.location || record.city || 'Palestine',
        admin_levels: {
          level1: record.region || this.classifyRegion(record.location || ''),
          level2: record.city || record.location,
        },
        region: this.classifyRegion(record.location || record.city || ''),
        coordinates: record.coordinates || {
          lat: record.latitude,
          lon: record.longitude,
        },
      },

      // Culture-specific data
      name: record.name,
      site_type: this.normalizeSiteType(record.type || record.site_type),
      status: this.normalizeStatus(record.status),
      
      // Historical context
      historical_period: record.historical_period || record.period || 'Unknown',
      construction_date: record.construction_date || record.built_date,
      significance: record.significance || record.importance,
      
      // Description
      description: record.description || record.summary,
      history_summary: record.history || record.historical_context,
      
      // Protection & Status
      unesco_status: record.unesco_status || record.world_heritage_status,
      protection_level: record.protection_level || 'Unknown',
      
      // Damage assessment (if applicable)
      damage: record.damage ? {
        status: this.normalizeStatus(record.damage.status || record.status),
        severity: record.damage.severity || this.assessDamageSeverity(record.status),
        date_damaged: record.damage.date || record.damage_date,
        description: record.damage.description || record.damage_details,
        before_images: record.damage.before_images || [],
        after_images: record.damage.after_images || [],
      } : null,

      // Media
      images: record.images || record.photos || [],
      virtual_tour: record.virtual_tour || record.tour_url,
      
      // Quality
      quality: this.enrichQuality({
        id: this.generateId('culture', record),
        date,
        location: { name: record.location || 'Palestine' },
        name: record.name,
      }).quality,

      // Provenance
      sources: [
        {
          name: metadata.source || 'Cultural Heritage Database',
          organization: metadata.organization || 'Palestine Ministry of Tourism',
          url: metadata.url || record.source_url,
          fetched_at: new Date().toISOString(),
        },
      ],

      // Metadata
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  /**
   * Normalize site type to standard categories
   */
  normalizeSiteType(type) {
    if (!type) return 'Unknown';
    
    const typeStr = type.toLowerCase();
    
    // Religious sites
    if (typeStr.includes('mosque') || typeStr.includes('church') || 
        typeStr.includes('monastery') || typeStr.includes('shrine') ||
        typeStr.includes('religious')) {
      return 'Religious';
    }
    
    // Archaeological sites
    if (typeStr.includes('archaeological') || typeStr.includes('ruins') ||
        typeStr.includes('ancient') || typeStr.includes('tell')) {
      return 'Archaeological';
    }
    
    // Historical buildings
    if (typeStr.includes('palace') || typeStr.includes('fortress') ||
        typeStr.includes('castle') || typeStr.includes('building')) {
      return 'Historical Building';
    }
    
    // Cultural centers
    if (typeStr.includes('museum') || typeStr.includes('library') ||
        typeStr.includes('cultural center')) {
      return 'Cultural Center';
    }
    
    // Natural sites
    if (typeStr.includes('natural') || typeStr.includes('landscape') ||
        typeStr.includes('garden')) {
      return 'Natural Heritage';
    }
    
    return type;
  }

  /**
   * Normalize site status
   */
  normalizeStatus(status) {
    if (!status) return 'Unknown';
    
    const statusStr = status.toLowerCase();
    
    if (statusStr.includes('destroyed') || statusStr.includes('demolished')) {
      return 'Destroyed';
    }
    if (statusStr.includes('severe') || statusStr.includes('heavily damaged')) {
      return 'Severely Damaged';
    }
    if (statusStr.includes('damaged') || statusStr.includes('partial')) {
      return 'Damaged';
    }
    if (statusStr.includes('at risk') || statusStr.includes('threatened')) {
      return 'At Risk';
    }
    if (statusStr.includes('intact') || statusStr.includes('good') || statusStr.includes('preserved')) {
      return 'Intact';
    }
    
    return status;
  }

  /**
   * Assess damage severity from status
   */
  assessDamageSeverity(status) {
    if (!status) return null;
    
    const statusStr = status.toLowerCase();
    
    if (statusStr.includes('destroyed')) return 'total';
    if (statusStr.includes('severe')) return 'severe';
    if (statusStr.includes('damaged')) return 'moderate';
    if (statusStr.includes('minor')) return 'minor';
    
    return null;
  }

  /**
   * Get category-specific required fields for quality assessment
   */
  getCategoryRequiredFields() {
    return ['name', 'location', 'site_type', 'status'];
  }

  /**
   * Enrich culture data with additional context
   */
  enrich(data) {
    return data.map(record => ({
      ...record,
      ...this.enrichTemporal(record),
      ...this.enrichSpatial(record),
      context: this.enrichCulturalContext(record),
    }));
  }

  /**
   * Add cultural context enrichment
   */
  enrichCulturalContext(record) {
    return {
      historical_importance: this.assessHistoricalImportance(record),
      cultural_significance: this.assessCulturalSignificance(record),
      tourism_potential: record.status === 'Intact' ? 'High' : 
                         record.status === 'Damaged' ? 'Medium' : 'None',
      preservation_priority: this.assessPreservationPriority(record),
    };
  }

  /**
   * Assess historical importance
   */
  assessHistoricalImportance(record) {
    let score = 'Medium';
    
    if (record.unesco_status || record.significance?.toLowerCase().includes('world heritage')) {
      score = 'Very High';
    } else if (record.historical_period?.includes('ancient') || 
               record.construction_date && parseInt(record.construction_date) < 1000) {
      score = 'High';
    } else if (record.significance?.toLowerCase().includes('national')) {
      score = 'High';
    }
    
    return score;
  }

  /**
   * Assess cultural significance
   */
  assessCulturalSignificance(record) {
    const factors = [];
    
    if (record.unesco_status) factors.push('UNESCO Listed');
    if (record.site_type === 'Religious') factors.push('Religious Significance');
    if (record.site_type === 'Archaeological') factors.push('Archaeological Value');
    if (record.protection_level && record.protection_level !== 'Unknown') {
      factors.push('Legally Protected');
    }
    
    return factors.length > 0 ? factors : ['Local Heritage'];
  }

  /**
   * Assess preservation priority
   */
  assessPreservationPriority(record) {
    // Higher priority for damaged or at-risk sites with high significance
    const isAtRisk = record.status === 'At Risk' || 
                     record.status === 'Damaged' || 
                     record.status === 'Severely Damaged';
    
    const isSignificant = record.unesco_status || 
                          this.assessHistoricalImportance(record) === 'Very High' ||
                          this.assessHistoricalImportance(record) === 'High';
    
    if (isAtRisk && isSignificant) return 'Critical';
    if (isAtRisk) return 'High';
    if (isSignificant) return 'Medium';
    
    return 'Standard';
  }
}

export default CultureTransformer;
