#!/usr/bin/env node
/**
 * Nightly usage rollup. Aggregates yesterday's usage_events into usage_daily
 * (one row per key+date), then prunes the raw events for that day.
 *
 * Cron example (00:30 UTC):
 *   30 0 * * * cd ~/palestine-data-backend && KEYS_DB_PATH=/app/data/keys.db node scripts/rollup-usage.js >> ~/usage-rollup.log 2>&1
 */
import { rollupYesterday } from '../src/api/services/keyStore.js';

const result = rollupYesterday();
console.log(`[${new Date().toISOString()}] usage_rollup date=${result.date} keys=${result.keys_rolled_up}`);
