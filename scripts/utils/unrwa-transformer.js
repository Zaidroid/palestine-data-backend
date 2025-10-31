/**
 * UNRWA Data Transformer
 * 
 * Transforms UNRWA (United Nations Relief and Works Agency) data
 * into unified RefugeeData and HumanitarianData formats.
 * 
 * Handles:
 * - Registered refugee statistics
 * - Displacement data
 * - Education facilities and services
 * - Health centers and services
 * - Emergency response data (food, cash, shelter assistance)
 */

import { BaseTransformer } from './base-transformer.js';

/**
 * UNRWA Transformer for refugee and humanitarian data
 */
export class UNRWATransformer extends BaseTransformer {
  constructor() {
    super('refugees');
  }
  
  /**
   * Transform raw UNRWA data to unified format
   */
  transform(rawData, metadata) {
    const dataType = this.detectDataType(rawData, metadata);
    
    switch (dataType) {
      case 'refugees':
        return this.transformRefugeeData(rawData, metadata);
      case 'displacement':
        return this.transformDisplacementData(rawData, metadata);
      case 'education':
        return this.transformEducationData(rawData, metadata);
      case 'health':
        return this.transformHealthData(rawData, metadata);
      case 'emergency':
        return this.transformEmergencyData(rawData, metadata);
      default:
        return this.transformGenericData(rawData, metadata);
    }
  }
  
  /**
   * Detect data type from metadata and content
   */
  detectDataType(rawData, metadata) {
    const title = metadata.title?.toLowerCase() || '';
    const description = metadata.description?.toLowerCase() || '';
    const text = `${title} ${description}`;
    
    if (text.includes('refugee') && text.includes('registered')) return 'refugees';
    if (text.includes('displacement') || text.includes('displaced')) return 'displacement';
    if (text.includes('education') || text.includes('school')) return 'education';
    if (text.includes('health') || text.includes('medical')) return 'health';
    if (text.includes('emergency') || text.includes('assistance')) return 'emergency';
    
    return 'generic';
  }
  
  /**
   * Transform registered refugee statistics
   */
  transformRefugeeData(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : [rawData];
    
    return records.map(record => ({
      id: this.generateId('unrwa-refugee', record),
      type: 'refugee',
      category: 'refugees',
      date: this.normalizeDate(record.date || record.year || record.reporting_date),
      timestamp: new Date().toISOString(),
      
      location: {
        name: record.location || record.field || record.area || 'unknown',
        coordinates: this.extractCoordinates(record),
        admin_levels: {
          level1: record.governorate || record.admin1 || null,
          level2: record.district || record.admin2 || null,
          level3: record.locality || record.admin3 || null,
        },
        region: this.classifyRegion(record.location || record.field),
        camp_name: record.camp || record.camp_name || null,
      },
      
      value: {
        registered_refugees: parseInt(record.registered_refugees || record.total_refugees || record.population || 0),
        families: parseInt(record.families || record.households || 0),
        males: parseInt(record.males || 0),
        females: parseInt(record.females || 0),
        children: parseInt(record.children || 0),
      },
      
      unit: 'persons',
      
      // UNRWA-specific fields
      unrwa_field: record.field || record.area_of_operations || null,
      camp_type: record.camp_type || null,
      registration_status: record.status || 'registered',
      
      sources: [{
        name: 'UNRWA',
        organization: 'United Nations Relief and Works Agency',
        url: metadata.source_url,
        fetched_at: new Date().toISOString(),
      }],
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    }));
  }
  
  /**
   * Transform displacement data
   */
  transformDisplacementData(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : [rawData];
    
    return records.map(record => ({
      id: this.generateId('unrwa-displacement', record),
      type: 'displacement',
      category: 'refugees',
      date: this.normalizeDate(record.date || record.reporting_date),
      timestamp: new Date().toISOString(),
      
      location: {
        name: record.location || record.shelter_location || record.governorate || 'unknown',
        coordinates: this.extractCoordinates(record),
        admin_levels: {
          level1: record.governorate || record.admin1 || null,
          level2: record.district || record.admin2 || null,
        },
        region: this.classifyRegion(record.location || record.governorate),
        shelter_type: record.shelter_type || 'unrwa_shelter',
      },
      
      value: {
        displaced_persons: parseInt(record.displaced || record.idps || record.total_displaced || 0),
        families: parseInt(record.families || record.households || 0),
        in_shelters: parseInt(record.in_shelters || record.sheltered || 0),
        in_host_families: parseInt(record.host_families || 0),
      },
      
      unit: 'persons',
      
      // Displacement-specific fields
      displacement_reason: record.reason || 'conflict',
      shelter_capacity: parseInt(record.capacity || 0),
      shelter_occupancy: parseFloat(record.occupancy || 0),
      
      sources: [{
        name: 'UNRWA',
        organization: 'United Nations Relief and Works Agency',
        url: metadata.source_url,
        fetched_at: new Date().toISOString(),
      }],
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    }));
  }
  
  /**
   * Transform education facility data
   */
  transformEducationData(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : [rawData];
    
    return records.map(record => ({
      id: this.generateId('unrwa-education', record),
      type: 'education',
      category: 'education',
      date: this.normalizeDate(record.date || record.academic_year),
      timestamp: new Date().toISOString(),
      
      location: {
        name: record.location || record.school_location || record.governorate || 'unknown',
        coordinates: this.extractCoordinates(record),
        admin_levels: {
          level1: record.governorate || record.admin1 || null,
        },
        region: this.classifyRegion(record.location || record.governorate),
      },
      
      value: {
        schools: parseInt(record.schools || record.facilities || 1),
        students: parseInt(record.students || record.enrollment || 0),
        teachers: parseInt(record.teachers || record.staff || 0),
        classrooms: parseInt(record.classrooms || 0),
      },
      
      unit: 'facilities',
      
      // Education-specific fields
      facility_type: record.facility_type || 'school',
      education_level: record.level || record.education_level || null,
      operational_status: record.status || 'operational',
      
      sources: [{
        name: 'UNRWA',
        organization: 'United Nations Relief and Works Agency',
        url: metadata.source_url,
        fetched_at: new Date().toISOString(),
      }],
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    }));
  }
  
  /**
   * Transform health facility data
   */
  transformHealthData(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : [rawData];
    
    return records.map(record => ({
      id: this.generateId('unrwa-health', record),
      type: 'health',
      category: 'health',
      date: this.normalizeDate(record.date || record.reporting_date),
      timestamp: new Date().toISOString(),
      
      location: {
        name: record.location || record.facility_location || record.governorate || 'unknown',
        coordinates: this.extractCoordinates(record),
        admin_levels: {
          level1: record.governorate || record.admin1 || null,
        },
        region: this.classifyRegion(record.location || record.governorate),
      },
      
      value: {
        health_centers: parseInt(record.health_centers || record.facilities || 1),
        patients: parseInt(record.patients || record.consultations || 0),
        medical_staff: parseInt(record.staff || record.doctors || 0),
        services_provided: parseInt(record.services || 0),
      },
      
      unit: 'facilities',
      
      // Health-specific fields
      facility_type: record.facility_type || 'health_center',
      services: record.services_list || [],
      operational_status: record.status || 'operational',
      
      sources: [{
        name: 'UNRWA',
        organization: 'United Nations Relief and Works Agency',
        url: metadata.source_url,
        fetched_at: new Date().toISOString(),
      }],
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    }));
  }
  
  /**
   * Transform emergency response data
   */
  transformEmergencyData(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : [rawData];
    
    return records.map(record => ({
      id: this.generateId('unrwa-emergency', record),
      type: 'humanitarian',
      category: 'humanitarian',
      date: this.normalizeDate(record.date || record.reporting_date),
      timestamp: new Date().toISOString(),
      
      location: {
        name: record.location || record.area || record.governorate || 'unknown',
        coordinates: this.extractCoordinates(record),
        admin_levels: {
          level1: record.governorate || record.admin1 || null,
        },
        region: this.classifyRegion(record.location || record.governorate),
      },
      
      value: {
        beneficiaries: parseInt(record.beneficiaries || record.people_reached || 0),
        food_assistance: parseInt(record.food_assistance || 0),
        cash_assistance: parseFloat(record.cash_assistance || 0),
        shelter_assistance: parseInt(record.shelter_assistance || 0),
      },
      
      unit: 'beneficiaries',
      
      // Emergency-specific fields
      sector: record.sector || 'emergency_response',
      assistance_type: record.assistance_type || 'multi-sector',
      people_in_need: parseInt(record.people_in_need || 0),
      people_targeted: parseInt(record.people_targeted || 0),
      people_reached: parseInt(record.people_reached || record.beneficiaries || 0),
      
      sources: [{
        name: 'UNRWA',
        organization: 'United Nations Relief and Works Agency',
        url: metadata.source_url,
        fetched_at: new Date().toISOString(),
      }],
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    }));
  }
  
  /**
   * Transform generic UNRWA data
   */
  transformGenericData(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : [rawData];
    
    return records.map(record => ({
      id: this.generateId('unrwa-data', record),
      type: 'humanitarian',
      category: 'humanitarian',
      date: this.normalizeDate(record.date || record.reporting_date),
      timestamp: new Date().toISOString(),
      
      location: {
        name: record.location || record.area || 'unknown',
        coordinates: this.extractCoordinates(record),
        admin_levels: {
          level1: record.governorate || record.admin1 || null,
        },
        region: this.classifyRegion(record.location),
      },
      
      value: record.value || record.total || 0,
      unit: record.unit || 'count',
      
      // Keep original data
      original_data: record,
      
      sources: [{
        name: 'UNRWA',
        organization: 'United Nations Relief and Works Agency',
        url: metadata.source_url,
        fetched_at: new Date().toISOString(),
      }],
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    }));
  }
  
  /**
   * Classify UNRWA field/region
   */
  classifyRegion(locationName) {
    if (!locationName) return 'unknown';
    
    const name = locationName.toLowerCase();
    
    // UNRWA fields
    if (name.includes('gaza')) return 'gaza';
    if (name.includes('west bank') || name.includes('westbank')) return 'west_bank';
    if (name.includes('jordan')) return 'jordan';
    if (name.includes('lebanon')) return 'lebanon';
    if (name.includes('syria')) return 'syria';
    
    // Governorates
    if (name.includes('jerusalem')) return 'east_jerusalem';
    
    return super.classifyRegion(locationName);
  }
}

export default UNRWATransformer;
