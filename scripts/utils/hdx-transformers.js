/**
 * HDX Category Transformers (JavaScript)
 * 
 * Provides transformers for all HDX data categories
 */

import { BaseTransformer } from './base-transformer.js';

/**
 * Infrastructure Data Transformer
 */
export class InfrastructureTransformer extends BaseTransformer {
  constructor() {
    super('infrastructure');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(
      record.damage_date || record.incident_date || record.date || record.assessment_date
    );

    return {
      id: this.generateId('infrastructure', { ...record, date }),
      type: 'infrastructure',
      category: 'infrastructure',
      date: date || new Date().toISOString().split('T')[0],
      location: this.extractLocation(record),
      value: parseFloat(record.estimated_cost || record.damage_cost || 0),
      unit: 'usd',
      
      // Infrastructure-specific
      structure_type: record.type || record.structure_type || record.building_type || 'building',
      damage_level: record.damage || record.damage_level || record.damage_assessment || 'unknown',
      damage_date: date,
      estimated_cost: parseFloat(record.cost || record.damage_cost || record.estimated_cost || 0),
      people_affected: parseInt(record.people_affected || record.affected_population || 0),
      status: record.status || record.current_status || 'damaged',
      
      quality: this.enrichQuality({ id: this.generateId('infrastructure', record), date, location: this.extractLocation(record), value: 0 }).quality,
      sources: [{ name: metadata.organization?.title || 'HDX', organization: metadata.organization?.title || 'HDX', fetched_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  extractLocation(record) {
    return {
      name: record.location || record.governorate || record.area || 'unknown',
      coordinates: this.extractCoordinates(record),
      admin_levels: {
        level1: record.admin1 || record.governorate || null,
        level2: record.admin2 || record.district || null,
        level3: record.admin3 || record.locality || null,
      },
      region: this.classifyRegion(record.location || record.governorate || ''),
    };
  }
}

/**
 * Education Data Transformer
 */
export class EducationTransformer extends BaseTransformer {
  constructor() {
    super('education');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(record.assessment_date || record.last_updated || record.date);

    return {
      id: this.generateId('education', { ...record, date }),
      type: 'education',
      category: 'education',
      date: date || new Date().toISOString().split('T')[0],
      location: this.extractLocation(record),
      value: parseInt(record.students || record.enrollment || record.capacity || 0),
      unit: 'students',
      
      // Education-specific
      facility_name: record.name || record.facility_name || record.school_name || 'unknown',
      facility_type: record.type || record.facility_type || 'school',
      status: record.status || record.operational_status || 'unknown',
      damage_level: record.damage || record.damage_level || record.damage_assessment || null,
      students: parseInt(record.students || record.enrollment || record.capacity || 0),
      staff: parseInt(record.staff || record.teachers || 0),
      
      quality: this.enrichQuality({ id: this.generateId('education', record), date, location: this.extractLocation(record), value: 0 }).quality,
      sources: [{ name: metadata.organization?.title || 'HDX', organization: metadata.organization?.title || 'HDX', fetched_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  extractLocation(record) {
    return {
      name: record.location || record.governorate || record.region || 'unknown',
      coordinates: this.extractCoordinates(record),
      admin_levels: {
        level1: record.admin1 || record.governorate || null,
        level2: record.admin2 || null,
        level3: record.admin3 || null,
      },
      region: this.classifyRegion(record.location || record.governorate || ''),
    };
  }
}

/**
 * Health Data Transformer
 */
export class HealthTransformer extends BaseTransformer {
  constructor() {
    super('health');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(record.assessment_date || record.last_updated || record.date);

    return {
      id: this.generateId('health', { ...record, date }),
      type: 'health',
      category: 'health',
      date: date || new Date().toISOString().split('T')[0],
      location: this.extractLocation(record),
      value: parseInt(record.bed_capacity || record.beds || record.capacity || 0),
      unit: 'beds',
      
      // Health-specific
      facility_name: record.name || record.facility_name || record.hospital_name || 'unknown',
      facility_type: record.type || record.facility_type || 'health_facility',
      status: record.status || record.operational_status || 'unknown',
      damage_level: record.damage || record.damage_level || null,
      bed_capacity: parseInt(record.beds || record.bed_capacity || record.capacity || 0),
      staff_count: parseInt(record.staff || record.healthcare_workers || 0),
      
      quality: this.enrichQuality({ id: this.generateId('health', record), date, location: this.extractLocation(record), value: 0 }).quality,
      sources: [{ name: metadata.organization?.title || 'HDX', organization: metadata.organization?.title || 'HDX', fetched_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  extractLocation(record) {
    return {
      name: record.location || record.governorate || record.area || 'unknown',
      coordinates: this.extractCoordinates(record),
      admin_levels: {
        level1: record.admin1 || record.governorate || null,
        level2: record.admin2 || null,
        level3: record.admin3 || null,
      },
      region: this.classifyRegion(record.location || record.governorate || ''),
    };
  }
}

/**
 * Water Data Transformer
 */
export class WaterTransformer extends BaseTransformer {
  constructor() {
    super('water');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(record.assessment_date || record.last_updated || record.date);

    return {
      id: this.generateId('water', { ...record, date }),
      type: 'water',
      category: 'water',
      date: date || new Date().toISOString().split('T')[0],
      location: this.extractLocation(record),
      value: parseFloat(record.capacity || record.daily_capacity || 0),
      unit: 'cubic_meters',
      
      // Water-specific
      facility_name: record.name || record.facility_name || 'unknown',
      facility_type: record.type || record.facility_type || 'water',
      status: record.status || record.operational_status || 'unknown',
      capacity: parseFloat(record.capacity || record.daily_capacity || 0),
      population_served: parseInt(record.population_served || record.beneficiaries || 0),
      
      quality: this.enrichQuality({ id: this.generateId('water', record), date, location: this.extractLocation(record), value: 0 }).quality,
      sources: [{ name: metadata.organization?.title || 'HDX', organization: metadata.organization?.title || 'HDX', fetched_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  extractLocation(record) {
    return {
      name: record.location || record.governorate || record.area || 'unknown',
      coordinates: this.extractCoordinates(record),
      admin_levels: {
        level1: record.admin1 || record.governorate || null,
        level2: record.admin2 || null,
        level3: record.admin3 || null,
      },
      region: this.classifyRegion(record.location || record.governorate || ''),
    };
  }
}

/**
 * Humanitarian Data Transformer
 */
export class HumanitarianTransformer extends BaseTransformer {
  constructor() {
    super('humanitarian');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(record.date || record.reporting_date || record.assessment_date);

    return {
      id: this.generateId('humanitarian', { ...record, date }),
      type: 'humanitarian',
      category: 'humanitarian',
      date: date || new Date().toISOString().split('T')[0],
      location: this.extractLocation(record),
      value: parseInt(record.people_in_need || record.pin || record.affected || 0),
      unit: 'people',
      
      // Humanitarian-specific
      sector: record.sector || record.cluster || 'multi-sector',
      people_in_need: parseInt(record.people_in_need || record.pin || record.affected || 0),
      people_targeted: parseInt(record.people_targeted || record.target || 0),
      people_reached: parseInt(record.people_reached || record.reached || 0),
      severity: record.severity || record.severity_level || null,
      priority: record.priority || record.priority_level || null,
      
      quality: this.enrichQuality({ id: this.generateId('humanitarian', record), date, location: this.extractLocation(record), value: 0 }).quality,
      sources: [{ name: metadata.organization?.title || 'HDX', organization: metadata.organization?.title || 'HDX', fetched_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  extractLocation(record) {
    return {
      name: record.location || record.governorate || record.area || 'unknown',
      coordinates: this.extractCoordinates(record),
      admin_levels: {
        level1: record.admin1 || record.governorate || null,
        level2: record.admin2 || null,
        level3: record.admin3 || null,
      },
      region: this.classifyRegion(record.location || record.governorate || ''),
    };
  }
}

/**
 * Refugee Data Transformer
 */
export class RefugeeTransformer extends BaseTransformer {
  constructor() {
    super('refugee');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(record.date || record.reporting_date || record.timestamp);

    return {
      id: this.generateId('refugee', { ...record, date }),
      type: 'refugee',
      category: 'refugee',
      date: date || new Date().toISOString().split('T')[0],
      location: this.extractLocation(record),
      value: parseInt(record.idps || record.displaced || record.population || 0),
      unit: 'people',
      
      // Refugee-specific
      displaced_population: parseInt(record.idps || record.displaced || record.population || 0),
      refugees: parseInt(record.refugees || 0),
      displacement_type: record.displacement_type || record.type || 'internal',
      
      quality: this.enrichQuality({ id: this.generateId('refugee', record), date, location: this.extractLocation(record), value: 0 }).quality,
      sources: [{ name: metadata.organization?.title || 'HDX', organization: metadata.organization?.title || 'HDX', fetched_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  extractLocation(record) {
    return {
      name: record.location || record.governorate || record.area || 'unknown',
      coordinates: this.extractCoordinates(record),
      admin_levels: {
        level1: record.admin1 || record.governorate || null,
        level2: record.admin2 || null,
        level3: record.admin3 || null,
      },
      region: this.classifyRegion(record.location || record.governorate || ''),
    };
  }
}

/**
 * Shelter Data Transformer
 */
export class ShelterTransformer extends BaseTransformer {
  constructor() {
    super('shelter');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    
    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(record.damage_date || record.incident_date || record.date || record.assessment_date);

    return {
      id: this.generateId('shelter', { ...record, date }),
      type: 'infrastructure', // Shelter is a type of infrastructure
      category: 'infrastructure',
      date: date || new Date().toISOString().split('T')[0],
      location: this.extractLocation(record),
      value: parseInt(record.capacity || record.housing_units || 0),
      unit: 'units',
      
      // Shelter-specific
      shelter_name: record.name || record.shelter_name || record.building_name || 'unknown',
      shelter_type: record.type || record.shelter_type || record.housing_type || 'housing',
      status: record.status || record.housing_status || 'unknown',
      damage_level: record.damage || record.damage_level || record.damage_assessment || null,
      capacity: parseInt(record.capacity || record.housing_units || 0),
      occupancy: parseInt(record.occupancy || record.residents || record.population || 0),
      displaced_persons: parseInt(record.idps || record.displaced || 0),
      
      quality: this.enrichQuality({ id: this.generateId('shelter', record), date, location: this.extractLocation(record), value: 0 }).quality,
      sources: [{ name: metadata.organization?.title || 'HDX', organization: metadata.organization?.title || 'HDX', fetched_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  extractLocation(record) {
    return {
      name: record.location || record.governorate || record.area || 'unknown',
      coordinates: this.extractCoordinates(record),
      admin_levels: {
        level1: record.admin1 || record.governorate || null,
        level2: record.admin2 || null,
        level3: record.admin3 || null,
      },
      region: this.classifyRegion(record.location || record.governorate || ''),
    };
  }
}

// Export all transformers
export default {
  InfrastructureTransformer,
  EducationTransformer,
  HealthTransformer,
  WaterTransformer,
  HumanitarianTransformer,
  RefugeeTransformer,
  ShelterTransformer,
};
