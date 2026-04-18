/**
 * Conflict Data Transformer (JavaScript)
 * 
 * Transforms conflict and incident data from various sources
 * into the unified ConflictData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class ConflictTransformer extends BaseTransformer {
  constructor() {
    super('conflict');
  }

  /**
   * Transform raw conflict data to unified format
   */
  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData :
      (rawData.data ? rawData.data : []);

    return records
      .filter(record => record && Object.keys(record).length > 0)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  /**
   * Transform a single conflict record
   */
  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(
      record.event_date || record.date || record.timestamp || record.year || record.date_of_death
    );

    const eventType = this.extractEventType(record);
    const killed    = this.extractFatalities(record);
    const injured   = this.extractInjuries(record);
    const actors    = this.extractActors(record);
    const description = this.extractDescription(record);
    const loc       = this.extractLocation(record);
    const severityIndex = this.calculateSeverityIndex(killed, injured, eventType);

    return this.toCanonical({
      id: this.generateId('conflict', { ...record, date }),
      date: date || new Date().toISOString().split('T')[0],
      category: 'conflict',
      event_type: eventType,

      location: {
        name: loc.name,
        governorate: loc.admin_levels?.level1 || null,
        region: loc.region || null,
        lat: loc.coordinates?.lat ?? null,
        lon: loc.coordinates?.lon ?? null,
        precision: loc.coordinates?.lat ? 'city' : 'region',
      },

      metrics: {
        killed,
        injured,
        count: killed + injured,
        unit: 'persons',
      },

      description,
      actors: [actors.actor1, actors.actor2].filter(Boolean),
      severity_index: severityIndex,

      sources: [{
        name: metadata.source || metadata.organization?.title || 'Unknown',
        organization: metadata.organization?.title || metadata.organization || 'Unknown',
        url: metadata.source_url || this.canonicalSourceUrl(metadata),
        license: metadata.license || 'varies',
        fetched_at: new Date().toISOString(),
      }],
    });
  }

  /**
   * Resolve a canonical landing URL when the metadata didn't carry one.
   * Lets a downstream citation point at *something* better than `null`.
   */
  canonicalSourceUrl(metadata) {
    const src = (metadata.source || metadata.organization?.title || '').toLowerCase();
    if (src.includes('tech4palestine') || src.includes('tech for palestine')) {
      return 'https://data.techforpalestine.org';
    }
    if (src.includes("b'tselem") || src.includes('btselem')) {
      return 'https://www.btselem.org';
    }
    if (src.includes('ocha')) {
      return 'https://www.ochaopt.org';
    }
    return null;
  }

  /**
   * Extract event type
   */
  extractEventType(record) {
    const eventType = record.event_type || record.eventType || record.type ||
      record.incident_type || record.incidentType || 'unknown';

    return this.normalizeEventType(eventType);
  }

  /**
   * Normalize event type to standard values
   */
  normalizeEventType(eventType) {
    const normalized = eventType.toLowerCase().trim();

    const typeMap = {
      'airstrike': 'airstrike',
      'air strike': 'airstrike',
      'aerial bombardment': 'airstrike',
      'bombing': 'airstrike',

      'artillery': 'artillery',
      'shelling': 'artillery',
      'mortar': 'artillery',

      'shooting': 'shooting',
      'gunfire': 'shooting',
      'small arms': 'shooting',

      'raid': 'raid',
      'incursion': 'raid',
      'military operation': 'raid',

      'explosion': 'explosion',
      'blast': 'explosion',
      'ied': 'explosion',

      'clash': 'armed clash',
      'armed clash': 'armed clash',
      'firefight': 'armed clash',

      'protest': 'protest',
      'demonstration': 'protest',
    };

    return typeMap[normalized] || eventType;
  }

  /**
   * Extract fatalities
   */
  extractFatalities(record) {
    return parseInt(
      record.fatalities || record.killed || record.deaths ||
      record.casualties || record.dead || record.count || 0
    );
  }

  /**
   * Extract injuries
   */
  extractInjuries(record) {
    return parseInt(
      record.injuries || record.injured || record.wounded || 0
    );
  }

  /**
   * Extract actors
   */
  extractActors(record) {
    return {
      actor1: record.actor1 || record.perpetrator || record.attacker || null,
      actor2: record.actor2 || record.target || record.victim || null,
    };
  }

  /**
   * Extract description.
   *
   * Tech4Palestine's daily-casualty rows are pure aggregate counts — there is
   * no upstream prose to copy. For those rows we synthesize a one-line summary
   * from the structured fields (region + casualty totals + date) so consumers
   * have something readable. Free-text events (B'Tselem incidents, journalist
   * killings) keep their original notes/description fields.
   */
  extractDescription(record) {
    const native = record.notes || record.description || record.event_description ||
      record.details;
    if (native && String(native).trim()) return String(native).trim();

    const eventType = (record.event_type || '').toLowerCase();
    const region = record.region || record.location || record.admin1 || 'Palestine';
    const date = record.date || record.report_date || record.event_date;
    const killed = parseInt(record.killed || record.fatalities || 0);
    const injured = parseInt(record.injured || record.injuries || 0);

    if (eventType === 'daily_casualty_report') {
      const parts = [];
      if (killed) parts.push(`${killed.toLocaleString()} killed (cumulative)`);
      if (injured) parts.push(`${injured.toLocaleString()} injured (cumulative)`);
      const tail = parts.length ? `: ${parts.join(', ')}` : '';
      return `Daily casualty report (${region})${tail}${date ? ` — ${date}` : ''}.`;
    }
    if (eventType === 'summary') {
      const parts = [];
      if (killed) parts.push(`${killed.toLocaleString()} killed total`);
      if (injured) parts.push(`${injured.toLocaleString()} injured total`);
      const tail = parts.length ? `: ${parts.join(', ')}` : '';
      return `Conflict summary (${region})${tail}${date ? ` as of ${date}` : ''}.`;
    }
    if (eventType === 'aggregate_fatality') {
      return `Aggregate fatality record (${region})${killed ? `: ${killed.toLocaleString()} killed` : ''}${date ? ` — ${date}` : ''}.`;
    }
    return '';
  }

  /**
   * Extract location
   */
  extractLocation(record) {
    const coordinates = this.extractCoordinates(record);
    const locationName = record.location || record.admin1 || record.region ||
      record.governorate || record.residence || 'unknown';

    return {
      name: locationName,
      coordinates,
      admin_levels: {
        level1: record.admin1 || record.governorate || this.inferGovernorate(locationName),
        level2: record.admin2 || record.district || null,
        level3: record.admin3 || record.locality || null,
      },
      region: this.classifyRegion(locationName),
    };
  }

  /**
   * Infer governorate from location name
   */
  inferGovernorate(locationName) {
    if (!locationName) return null;

    const name = locationName.toLowerCase();

    // Gaza governorates
    if (name.includes('gaza') && !name.includes('north')) return 'Gaza';
    if (name.includes('north gaza') || name.includes('northern gaza')) return 'North Gaza';
    if (name.includes('deir al-balah') || name.includes('deir al balah')) return 'Deir al-Balah';
    if (name.includes('khan yunis') || name.includes('khan younis')) return 'Khan Yunis';
    if (name.includes('rafah')) return 'Rafah';

    // West Bank governorates
    if (name.includes('jenin')) return 'Jenin';
    if (name.includes('tubas')) return 'Tubas';
    if (name.includes('tulkarm') || name.includes('tulkarem')) return 'Tulkarm';
    if (name.includes('nablus')) return 'Nablus';
    if (name.includes('qalqilya') || name.includes('qalqiliya')) return 'Qalqilya';
    if (name.includes('salfit')) return 'Salfit';
    if (name.includes('ramallah')) return 'Ramallah';
    if (name.includes('jericho')) return 'Jericho';
    if (name.includes('jerusalem')) return 'Jerusalem';
    if (name.includes('bethlehem')) return 'Bethlehem';
    if (name.includes('hebron') || name.includes('al-khalil')) return 'Hebron';

    return null;
  }

  /**
   * Calculate severity index
   */
  calculateSeverityIndex(fatalities, injuries, eventType) {
    let severity = 0;

    // Base severity from casualties
    severity += fatalities * 3; // Fatalities weighted more
    severity += injuries * 1;

    // Event type multiplier
    const eventMultipliers = {
      'airstrike': 1.5,
      'artillery': 1.3,
      'explosion': 1.4,
      'armed clash': 1.2,
      'shooting': 1.0,
      'raid': 0.8,
      'protest': 0.5,
    };

    const multiplier = eventMultipliers[eventType] || 1.0;
    severity *= multiplier;

    // Normalize to 0-10 scale
    return Math.min(10, Math.round(severity / 10));
  }
}

export default ConflictTransformer;
