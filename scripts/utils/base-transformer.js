/**
 * Base Data Transformer
 *
 * Abstract base class for transforming raw data from various sources
 * into the unified data model format (canonical schema v3.0.0).
 */

import { createEmptyRecord, SCHEMA_VERSION, CONFLICT_PHASES } from './canonical-schema.js';

export class BaseTransformer {
  constructor(category) {
    this.category = category;
  }

  /**
   * Transform raw data to unified format.
   * Must be implemented by subclasses.
   */
  transform(rawData, metadata) {
    throw new Error('transform() must be implemented by subclass');
  }

  /**
   * Merge partial transformer output into the canonical record shape.
   * Every transformer should end transformRecord() with return this.toCanonical({...})
   */
  toCanonical(partial) {
    const base = createEmptyRecord();
    return {
      ...base,
      ...partial,
      schema_version: SCHEMA_VERSION,
      // Deep-merge nested objects so missing sub-fields get defaults
      location: { ...base.location, ...(partial.location || {}) },
      metrics:  { ...base.metrics,  ...(partial.metrics  || {}) },
      temporal_context: { ...base.temporal_context, ...(partial.temporal_context || {}) },
      quality:  { ...base.quality,  ...(partial.quality  || {}) },
      sources:  Array.isArray(partial.sources) ? partial.sources : [],
      actors:   Array.isArray(partial.actors)  ? partial.actors  : [],
    };
  }

  /**
   * Validate a single record. Override for category-specific rules.
   */
  validate(data) {
    if (!Array.isArray(data)) {
      return { valid: false, errors: ['Data must be an array'] };
    }
    return { valid: true, errors: [] };
  }

  /**
   * Enrich an array of already-transformed records.
   */
  enrich(data) {
    return data.map(record => {
      const temporal = this.enrichTemporal(record);
      const spatial  = this.enrichSpatial(record);
      const quality  = this.enrichQuality(record);
      return {
        ...record,
        temporal_context: { ...record.temporal_context, ...temporal.temporal_context },
        location: { ...record.location, ...spatial.location },
        quality:  { ...record.quality,  ...quality.quality },
      };
    });
  }

  // ─── Temporal ─────────────────────────────────────────────────────────────

  enrichTemporal(record) {
    if (!record.date) return {};
    const baseline = new Date('2023-10-07');
    const d = new Date(record.date);
    const daysSinceBaseline = Math.floor((d - baseline) / 86400000);
    return {
      temporal_context: {
        days_since_baseline: daysSinceBaseline,
        baseline_date: '2023-10-07',
        conflict_phase: this.determineConflictPhase(record.date),
      },
    };
  }

  determineConflictPhase(date) {
    const d = new Date(date);
    if (isNaN(d)) return null;
    const y = d.getUTCFullYear();
    if (y <= 1949) return 'nakba-1948';
    if (y <= 1967) return 'naksa-1967';
    if (y <= 1993) return 'first-intifada';
    if (y <= 2000) return 'oslo-period';
    if (y <= 2005) return 'second-intifada';
    if (d < new Date('2009-01-19')) return 'gaza-2008-2009';
    if (d < new Date('2012-12-01')) return 'gaza-2012';
    if (d < new Date('2014-09-01')) return 'gaza-2014';
    if (d < new Date('2021-06-01')) return 'gaza-2021';
    if (d < new Date('2023-10-07')) return 'pre-escalation-2023';
    if (d < new Date('2025-01-20')) return 'gaza-war-2023';
    return 'ongoing';
  }

  // ─── Spatial ──────────────────────────────────────────────────────────────

  enrichSpatial(record) {
    if (!record.location) return {};
    const region = record.location.region || this.classifyRegion(record.location.name);
    return { location: { ...record.location, region } };
  }

  classifyRegion(locationName) {
    if (!locationName || typeof locationName !== 'string') return 'Palestine';
    const n = locationName.toLowerCase().trim();
    if (n.includes('gaza') || n.includes('rafah') || n.includes('khan yun') ||
        n.includes('deir al-balah') || n.includes('jabalia') || n.includes('beit lahiya') ||
        n.includes('beit hanoun')) return 'Gaza Strip';
    if (n.includes('west bank') || n.includes('westbank') || n.includes('ramallah') ||
        n.includes('hebron') || n.includes('nablus') || n.includes('jenin') ||
        n.includes('tulkarm') || n.includes('qalqilya') || n.includes('tubas') ||
        n.includes('salfit') || n.includes('bethlehem') || n.includes('jericho') ||
        n.includes('al-khalil') || n.includes('ariha')) return 'West Bank';
    if (n.includes('jerusalem') || n.includes('al-quds') || n.includes('east jerusalem')) return 'East Jerusalem';
    return 'Palestine';
  }

  // ─── Quality ──────────────────────────────────────────────────────────────

  enrichQuality(record) {
    const completeness = this.calculateCompleteness(record);
    const consistency  = this.calculateConsistency(record);
    const accuracy     = this.calculateAccuracy(record);
    const score = (completeness + consistency + accuracy) / 3;
    return {
      quality: {
        score,
        completeness,
        consistency,
        accuracy,
        confidence: score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low',
        verified: false,
      },
    };
  }

  calculateCompleteness(record) {
    const required = ['id', 'date', 'category'];
    const optional = ['event_type', 'description', 'location.name', 'location.region'];
    let score = 0;
    for (const f of required) {
      if (record[f] != null && record[f] !== '') score += 2;
    }
    for (const f of optional) {
      const val = f.includes('.') ? record[f.split('.')[0]]?.[f.split('.')[1]] : record[f];
      if (val != null && val !== '') score += 1;
    }
    return Math.min(1, score / (required.length * 2 + optional.length));
  }

  calculateConsistency(record) {
    let score = 1.0;
    if (record.date) {
      const d = new Date(record.date);
      if (isNaN(d.getTime())) score -= 0.4;
      else if (d > new Date()) score -= 0.2;
    }
    if (record.location?.lat != null) {
      if (record.location.lat < 29 || record.location.lat > 34) score -= 0.3;
    }
    if (record.location?.lon != null) {
      if (record.location.lon < 33 || record.location.lon > 36.5) score -= 0.3;
    }
    return Math.max(0, score);
  }

  calculateAccuracy(record) {
    let score = 0.8;
    const orgLower = (record.sources?.[0]?.organization || '').toLowerCase();
    if (['un', 'who', 'world bank', 'ocha', 'pcbs', 'unrwa'].some(o => orgLower.includes(o))) {
      score = 1.0;
    } else if (['btselem', 'amnesty', 'hrw', 'tech4palestine'].some(o => orgLower.includes(o))) {
      score = 0.9;
    }
    return score;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  normalizeDate(dateValue) {
    if (!dateValue) return null;
    try {
      // Handle year-only values (e.g. 2020)
      if (/^\d{4}$/.test(String(dateValue))) return `${dateValue}-01-01`;
      const d = new Date(dateValue);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  extractCoordinates(record) {
    const lat = parseFloat(record.latitude || record.lat || record.y);
    const lon = parseFloat(record.longitude || record.lon || record.x);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    return { lat: null, lon: null };
  }

  generateId(prefix, record) {
    const key = `${record.date || ''}-${record.location?.name || ''}-${JSON.stringify(record).slice(0, 80)}`;
    return `${prefix}-${this.simpleHash(key)}`;
  }

  simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return Math.abs(h).toString(36);
  }
}

export default BaseTransformer;
