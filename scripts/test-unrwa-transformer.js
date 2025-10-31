#!/usr/bin/env node

/**
 * Test UNRWA Transformer
 * 
 * Demonstrates the UNRWA transformer with sample data
 */

import { UNRWATransformer } from './utils/unrwa-transformer.js';

console.log('========================================');
console.log('UNRWA Transformer Test');
console.log('========================================\n');

const transformer = new UNRWATransformer();

// Test 1: Refugee Data
console.log('Test 1: Refugee Data Transformation');
console.log('------------------------------------');

const sampleRefugeeData = [{
  date: '2024-01-01',
  location: 'Gaza Strip',
  field: 'Gaza',
  registered_refugees: 1500000,
  families: 300000,
  males: 750000,
  females: 750000,
  children: 600000,
  camp: 'Jabalia Camp',
  camp_type: 'official',
  status: 'registered'
}];

const refugeeMetadata = {
  title: 'UNRWA Registered Refugees Gaza',
  description: 'Registered refugee statistics for Gaza Strip',
  source_url: 'https://data.humdata.org/dataset/test-refugees'
};

const transformedRefugees = transformer.transform(sampleRefugeeData, refugeeMetadata);
console.log('Input:', JSON.stringify(sampleRefugeeData[0], null, 2));
console.log('\nOutput:', JSON.stringify(transformedRefugees[0], null, 2));
console.log('\n✓ Refugee data transformed successfully\n');

// Test 2: Displacement Data
console.log('Test 2: Displacement Data Transformation');
console.log('----------------------------------------');

const sampleDisplacementData = [{
  date: '2024-01-15',
  location: 'Gaza City',
  governorate: 'Gaza',
  displaced: 50000,
  families: 10000,
  in_shelters: 35000,
  host_families: 15000,
  shelter_type: 'unrwa_shelter',
  reason: 'conflict',
  capacity: 40000,
  occupancy: 87.5
}];

const displacementMetadata = {
  title: 'Displaced Persons in UNRWA Shelters',
  description: 'Displacement tracking data',
  source_url: 'https://data.humdata.org/dataset/test-displacement'
};

const transformedDisplacement = transformer.transform(sampleDisplacementData, displacementMetadata);
console.log('Input:', JSON.stringify(sampleDisplacementData[0], null, 2));
console.log('\nOutput:', JSON.stringify(transformedDisplacement[0], null, 2));
console.log('\n✓ Displacement data transformed successfully\n');

// Test 3: Education Data
console.log('Test 3: Education Data Transformation');
console.log('-------------------------------------');

const sampleEducationData = [{
  date: '2023-09-01',
  location: 'West Bank',
  governorate: 'Ramallah',
  schools: 25,
  students: 15000,
  teachers: 750,
  classrooms: 500,
  facility_type: 'school',
  level: 'primary',
  status: 'operational'
}];

const educationMetadata = {
  title: 'UNRWA Schools West Bank',
  description: 'Education facilities and enrollment',
  source_url: 'https://data.humdata.org/dataset/test-education'
};

const transformedEducation = transformer.transform(sampleEducationData, educationMetadata);
console.log('Input:', JSON.stringify(sampleEducationData[0], null, 2));
console.log('\nOutput:', JSON.stringify(transformedEducation[0], null, 2));
console.log('\n✓ Education data transformed successfully\n');

// Test 4: Health Data
console.log('Test 4: Health Data Transformation');
console.log('----------------------------------');

const sampleHealthData = [{
  date: '2024-01-01',
  location: 'Gaza',
  governorate: 'Gaza',
  health_centers: 10,
  patients: 50000,
  staff: 200,
  services: 75000,
  facility_type: 'health_center',
  services_list: ['primary care', 'maternal health', 'vaccinations'],
  status: 'operational'
}];

const healthMetadata = {
  title: 'UNRWA Health Centers Gaza',
  description: 'Health facilities and services',
  source_url: 'https://data.humdata.org/dataset/test-health'
};

const transformedHealth = transformer.transform(sampleHealthData, healthMetadata);
console.log('Input:', JSON.stringify(sampleHealthData[0], null, 2));
console.log('\nOutput:', JSON.stringify(transformedHealth[0], null, 2));
console.log('\n✓ Health data transformed successfully\n');

// Test 5: Emergency Response Data
console.log('Test 5: Emergency Response Data Transformation');
console.log('----------------------------------------------');

const sampleEmergencyData = [{
  date: '2024-01-20',
  location: 'Gaza Strip',
  governorate: 'Gaza',
  beneficiaries: 100000,
  food_assistance: 80000,
  cash_assistance: 5000000,
  shelter_assistance: 20000,
  sector: 'emergency_response',
  assistance_type: 'multi-sector',
  people_in_need: 150000,
  people_targeted: 120000,
  people_reached: 100000
}];

const emergencyMetadata = {
  title: 'UNRWA Emergency Response Gaza',
  description: 'Emergency assistance data',
  source_url: 'https://data.humdata.org/dataset/test-emergency'
};

const transformedEmergency = transformer.transform(sampleEmergencyData, emergencyMetadata);
console.log('Input:', JSON.stringify(sampleEmergencyData[0], null, 2));
console.log('\nOutput:', JSON.stringify(transformedEmergency[0], null, 2));
console.log('\n✓ Emergency response data transformed successfully\n');

// Summary
console.log('========================================');
console.log('Test Summary');
console.log('========================================');
console.log('✓ All 5 data types transformed successfully');
console.log('  - Refugee data');
console.log('  - Displacement data');
console.log('  - Education data');
console.log('  - Health data');
console.log('  - Emergency response data');
console.log('========================================\n');
