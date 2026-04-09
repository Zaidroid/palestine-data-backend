/**
 * Canonical Unified Schema v3.0.0
 *
 * Single source of truth for record shape across all categories.
 * Every transformer MUST produce records conforming to this via toCanonical().
 */

export const SCHEMA_VERSION = '3.0.0';

export const CATEGORIES = [
  'conflict', 'martyrs', 'health', 'education', 'economic',
  'humanitarian', 'refugees', 'infrastructure', 'water',
  'culture', 'land', 'historical', 'demographics', 'prisoners', 'pcbs', 'news'
];

export const REGIONS = ['Gaza Strip', 'West Bank', 'East Jerusalem', 'Palestine'];

export const CONFLICT_PHASES = [
  'nakba-1948', 'naksa-1967', 'first-intifada', 'oslo-period',
  'second-intifada', 'gaza-2008-2009', 'gaza-2012', 'gaza-2014',
  'gaza-2021', 'pre-escalation-2023', 'gaza-war-2023', 'ongoing'
];

/**
 * Create a blank record with all fields initialised to safe defaults.
 * Transformers spread their computed values over this.
 */
export function createEmptyRecord() {
  return {
    id: null,
    date: null,
    category: null,
    event_type: null,
    schema_version: SCHEMA_VERSION,

    location: {
      name: null,
      governorate: null,
      region: null,
      lat: null,
      lon: null,
      precision: 'unknown',
    },

    metrics: {
      killed: 0,
      injured: 0,
      displaced: 0,
      affected: 0,
      demolished: 0,
      detained: 0,
      count: 0,
      value: 0,
      unit: null,
    },

    description: '',
    actors: [],
    severity_index: 0,

    temporal_context: {
      days_since_baseline: null,
      baseline_date: '2023-10-07',
      conflict_phase: null,
    },

    quality: {
      score: 0,
      completeness: 0,
      consistency: 0,
      accuracy: 0,
      confidence: 'low',
      verified: false,
    },

    sources: [],
  };
}

/**
 * Validate a record against the canonical schema.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateRecord(record) {
  const errors = [];

  if (!record.id) errors.push('missing id');
  if (!record.date) errors.push('missing date');
  if (!record.category) errors.push('missing category');

  if (record.date && isNaN(new Date(record.date).getTime())) {
    errors.push(`invalid date: ${record.date}`);
  }

  if (record.location?.lat != null &&
      (record.location.lat < 29 || record.location.lat > 34)) {
    errors.push(`lat out of Palestine bounds: ${record.location.lat}`);
  }

  if (record.location?.lon != null &&
      (record.location.lon < 33 || record.location.lon > 36.5)) {
    errors.push(`lon out of Palestine bounds: ${record.location.lon}`);
  }

  return { valid: errors.length === 0, errors };
}
