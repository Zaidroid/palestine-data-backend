/**
 * Live Alert & Checkpoint Transformer
 * 
 * Transforms raw fastAPI outputs (from westbank-alerts Python service)
 * intro strict Palestine Data Backend Schema v3.0.0 shapes.
 */

import { createEmptyRecord, SCHEMA_VERSION } from '../../../scripts/utils/canonical-schema.js';
import { loadBaselines, lookupContext } from '../../../scripts/utils/baseline-analyzer.js';
import crypto from 'crypto';

const GAZA_ZONES = new Set([
  'gaza_north', 'gaza_city', 'middle_gaza', 'khan_younis', 'rafah', 'gaza_strip',
]);

const GAZA_AREA_PATTERNS = [
  'gaza', 'rafah', 'khan younis', 'khan yunis', 'jabalia',
  'beit hanoun', 'beit lahia', 'deir al-balah', 'deir al balah',
  'nuseirat', 'bureij', 'maghazi', 'shujaiya', 'shati',
  'rimal', 'tuffah', 'zaytoun', 'tel al-sultan', 'al-mawasi',
  'north gaza',
];

function resolveRegion(alertOrCp) {
  const zone = (alertOrCp.zone || '').toLowerCase();
  if (GAZA_ZONES.has(zone)) return 'Gaza Strip';
  if (zone === 'west_bank' || zone.startsWith('north') || zone === 'middle' || zone === 'south') {
    return 'West Bank';
  }
  const area = (alertOrCp.area || alertOrCp.name || '').toLowerCase();
  if (area && GAZA_AREA_PATTERNS.some(p => area.includes(p))) return 'Gaza Strip';
  return 'West Bank';
}

export class LiveTransformer {
  /**
   * Process Checkpoints feed
   */
  static transformCheckpoints(fastAPIResponse) {
    if (!fastAPIResponse || !Array.isArray(fastAPIResponse.checkpoints)) {
      return fastAPIResponse;
    }

    const canonicalRecords = fastAPIResponse.checkpoints.map(cp => {
      const base = createEmptyRecord();
      
      const record = {
        ...base,
        id: `cp-${cp.id || crypto.randomBytes(4).toString('hex')}`,
        schema_version: SCHEMA_VERSION,
        date: cp.last_update ? new Date(cp.last_update).toISOString() : new Date().toISOString(),
        category: 'infrastructure',
        event_type: 'checkpoint_status',
        location: {
          name: cp.name || cp.key_name || 'Unknown',
          region: cp.region || resolveRegion(cp),
          governorate: cp.district || null,
          lat: cp.latitude || null,
          lon: cp.longitude || null,
        },
        description: `Status: ${cp.status || 'unknown'}. ${cp.last_message || ''}`,
        metrics: {
          ...base.metrics,
          blocked: cp.status === 'closed' || cp.status === 'blocked' ? 1 : 0, 
        },
        sources: [
          {
            name: 'Westbank Live Alerts',
            organization: 'Telegram Channels Network',
            url: null
          }
        ],
        raw_status: cp.status // preserving original metadata
      };
      
      return record;
    });

    return {
      data: canonicalRecords,
      total: fastAPIResponse.total || canonicalRecords.length,
      schema: SCHEMA_VERSION,
      type: 'FeatureCollection'
    };
  }

  /**
   * Process Alert feed
   */
  static transformAlerts(fastAPIResponse) {
    const alerts = Array.isArray(fastAPIResponse) ? fastAPIResponse : (fastAPIResponse.alerts || []);
    
    const canonicalRecords = alerts.map(alert => {
      const base = createEmptyRecord();
      
      return {
        ...base,
        id: `alert-${alert.id || crypto.randomBytes(4).toString('hex')}`,
        schema_version: SCHEMA_VERSION,
        date: alert.timestamp ? new Date(alert.timestamp).toISOString() : new Date().toISOString(),
        category: 'conflict',
        event_type: alert.type || 'general_alert',
        location: {
          name: alert.area || 'Unknown',
          region: resolveRegion(alert),
          zone: alert.zone || null,
        },
        description: alert.body || alert.raw_text || alert.title || '',
        metrics: {
          ...base.metrics,
          severity: alert.severity === 'critical' ? 3 : alert.severity === 'high' ? 2 : 1
        },
        sources: [
          {
            name: alert.source || 'Telegram',
            organization: 'Westbank Live Alerts',
            url: null
          }
        ],
      };
    });

    return {
      data: canonicalRecords,
      total: canonicalRecords.length,
      schema: SCHEMA_VERSION
    };
  }

  /**
   * Enrich transformed alerts with rolling baseline context.
   * Each record gets a `historical_context` block with 30d count + 90d weekly avg
   * + delta classification ("above"/"near"/"below") vs. the baseline for its
   * (region|area, event_type) key.
   */
  static async enrichAlertsWithBaseline(fastAPIResponse) {
    const transformed = LiveTransformer.transformAlerts(fastAPIResponse);
    const baselines = await loadBaselines();
    if (!baselines) return { ...transformed, baseline_available: false };

    const enriched = transformed.data.map(rec => {
      const ctx = lookupContext(
        baselines,
        rec.location?.region,
        rec.event_type,
        rec.location?.name
      );
      if (!ctx) return rec;
      return {
        ...rec,
        historical_context: {
          summary: ctx.summary,
          count_30d: ctx.count_30d,
          avg_weekly_90d: ctx.avg_weekly_90d,
          p90_weekly_12m: ctx.p90_weekly_12m,
          trend_vs_baseline: ctx.avg_weekly_90d > 0
            ? (ctx.count_30d / (30 / 7) > ctx.avg_weekly_90d * 1.15 ? 'above'
               : ctx.count_30d / (30 / 7) < ctx.avg_weekly_90d * 0.85 ? 'below'
               : 'near')
            : 'insufficient_history',
        },
      };
    });

    return {
      ...transformed,
      data: enriched,
      baseline_available: true,
      baseline_window_ends: baselines.window_ends,
    };
  }
}
