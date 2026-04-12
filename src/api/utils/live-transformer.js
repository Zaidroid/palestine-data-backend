/**
 * Live Alert & Checkpoint Transformer
 * 
 * Transforms raw fastAPI outputs (from westbank-alerts Python service)
 * intro strict Palestine Data Backend Schema v3.0.0 shapes.
 */

import { createEmptyRecord, SCHEMA_VERSION } from '../../../scripts/utils/canonical-schema.js';
import crypto from 'crypto';

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
          region: cp.region || 'West Bank',
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
          region: 'West Bank',
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
}
