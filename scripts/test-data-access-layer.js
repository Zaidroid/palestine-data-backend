#!/usr/bin/env node

/**
 * Data Access Layer Test
 * 
 * Tests the unified data service functions and React Query hooks:
 * - Service functions return correct data
 * - Filtering and querying functionality
 * - Error handling and fallbacks
 * - Pagination
 * - Multi-category queries
 * 
 * Note: This tests the service layer logic. React Query hooks would need
 * a React testing environment (e.g., @testing-library/react).
 * 
 * Usage: node scripts/test-data-access-layer.js
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================
// MOCK DATA SETUP
// ============================================

/**
 * Create mock unified data structure for testing
 */
async function setupMockData() {
  const testDataDir = path.join(process.cwd(), 'public', 'data', 'unified', 'test-access');
  
  // Create directories
  await fs.mkdir(path.join(testDataDir, 'conflict'), { recursive: true });
  await fs.mkdir(path.join(testDataDir, 'economic'), { recursive: true });
  await fs.mkdir(path.join(testDataDir, 'conflict', 'partitions'), { recursive: true });
  
  // Create mock conflict data
  const conflictData = [];
  for (let i = 0; i < 100; i++) {
    const date = new Date('2024-01-01');
    date.setDate(date.getDate() + i);
    
    conflictData.push({
      id: `conflict-${i}`,
      type: 'conflict',
      category: 'conflict',
      date: date.toISOString().split('T')[0],
      location: {
        name: i % 2 === 0 ? 'Gaza City' : 'Jenin',
        region: i % 2 === 0 ? 'gaza' : 'west_bank',
        admin_levels: {
          level1: i % 2 === 0 ? 'Gaza' : 'Jenin',
        },
        coordinates: [34.5, 31.5],
      },
      value: Math.floor(Math.random() * 10),
      unit: 'casualties',
      event_type: 'airstrike',
      fatalities: Math.floor(Math.random() * 5),
      injuries: Math.floor(Math.random() * 10),
      actors: { actor1: 'Military' },
      description: `Test incident ${i}`,
      quality: {
        score: 0.8 + (Math.random() * 0.2),
        completeness: 0.9,
        consistency: 0.85,
        accuracy: 0.8,
        verified: true,
        confidence: 0.85,
      },
      sources: [{
        name: 'Test Source',
        organization: 'Test Org',
        fetched_at: new Date().toISOString(),
      }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });
  }
  
  // Save conflict data
  await fs.writeFile(
    path.join(testDataDir, 'conflict', 'recent.json'),
    JSON.stringify({ data: conflictData }, null, 2)
  );
  
  // Create conflict metadata
  const conflictMetadata = {
    id: 'conflict_data',
    name: 'Conflict Data',
    category: 'conflict',
    source: 'Test Source',
    organization: 'Test Org',
    description: 'Test conflict data',
    last_updated: 