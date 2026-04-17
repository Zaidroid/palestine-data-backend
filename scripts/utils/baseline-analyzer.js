/**
 * Baseline Analyzer
 *
 * Reads unified conflict records and produces per-(region, event_type)
 * rolling baselines so that live alerts can be enriched with historical
 * context ("Nth raid in Jenin this month vs 90d avg of X").
 *
 * Output: public/data/analytics/baselines.json
 * Shape:
 *   {
 *     generated_at: ISO,
 *     window_ends: YYYY-MM-DD,
 *     baselines: {
 *       "West Bank:idf_raid":  { count_30d, avg_weekly_90d, avg_weekly_12m, p90_weekly_12m },
 *       "Gaza Strip:airstrike": {...}
 *     },
 *     by_area: {
 *       "Jenin:idf_raid": {...}
 *     }
 *   }
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNIFIED_DIR = path.join(__dirname, '../../public/data/unified');
const OUT_PATH = path.join(__dirname, '../../public/data/analytics/baselines.json');

const DAY = 24 * 60 * 60 * 1000;

function daysBetween(aISO, bISO) {
  return Math.floor((new Date(bISO) - new Date(aISO)) / DAY);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function emptyStat() {
  return {
    count_30d: 0,
    count_90d: 0,
    count_12m: 0,
    avg_weekly_90d: 0,
    avg_weekly_12m: 0,
    p90_weekly_12m: 0,
    total_observed: 0,
    earliest: null,
    latest: null,
  };
}

function finalize(stat, weeklyCounts) {
  const sorted = [...weeklyCounts].sort((a, b) => a - b);
  const sum = weeklyCounts.reduce((a, b) => a + b, 0);
  stat.avg_weekly_12m = weeklyCounts.length ? sum / weeklyCounts.length : 0;
  stat.p90_weekly_12m = percentile(sorted, 0.9);
  // Round to 2 decimals for readability
  stat.avg_weekly_90d = Math.round(stat.avg_weekly_90d * 100) / 100;
  stat.avg_weekly_12m = Math.round(stat.avg_weekly_12m * 100) / 100;
  return stat;
}

async function loadConflict() {
  const p = path.join(UNIFIED_DIR, 'conflict/all-data.json');
  const raw = await fs.readFile(p, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.data || []);
}

/**
 * Pull granular alerts from the Python alerts service.
 * These have much finer granularity than the aggregate unified records
 * (individual raids, settler attacks, injuries, etc.) so they give
 * meaningful baselines for the /live/enriched endpoint.
 */
async function loadLiveAlerts(alertsApi, pageSize = 100, maxPages = 20) {
  const out = [];
  try {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${alertsApi}/alerts?page=${page}&per_page=${pageSize}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) break;
      const body = await res.json();
      const alerts = body.alerts || [];
      if (alerts.length === 0) break;
      out.push(...alerts);
      if (alerts.length < pageSize) break;
    }
  } catch (err) {
    console.warn(`  ⚠  live alerts unavailable (${err.message}) — baselines built from unified only`);
    return [];
  }
  return out;
}

function normalizeLiveAlert(a) {
  const zone = (a.zone || '').toLowerCase();
  const gazaZones = new Set(['gaza_north', 'gaza_city', 'middle_gaza', 'khan_younis', 'rafah', 'gaza_strip']);
  const region = gazaZones.has(zone) ? 'Gaza Strip' : 'West Bank';
  const date = a.timestamp ? String(a.timestamp).split('T')[0] : null;
  return {
    date,
    event_type: a.type,
    location: { name: a.area, region },
  };
}

export async function buildBaselines(nowISO = new Date().toISOString(), opts = {}) {
  const alertsApi = opts.alertsApi || process.env.ALERTS_API_URL || 'http://localhost:8080';
  const unified = await loadConflict();
  const liveRaw = await loadLiveAlerts(alertsApi);
  const liveNormalized = liveRaw.map(normalizeLiveAlert).filter(r => r.date && r.event_type);
  const records = [...unified, ...liveNormalized];
  const now = new Date(nowISO);
  const windowEnds = now.toISOString().split('T')[0];
  const cutoff30 = new Date(now - 30 * DAY).toISOString().split('T')[0];
  const cutoff90 = new Date(now - 90 * DAY).toISOString().split('T')[0];
  const cutoff12m = new Date(now - 365 * DAY).toISOString().split('T')[0];

  // key → { count_30d, count_90d, weekly_counts[], total_observed, earliest, latest }
  const regionBuckets = new Map();
  const areaBuckets = new Map();

  // Weekly counts buckets: weekKey = YYYY-WW
  const regionWeekly = new Map(); // regionKey → Map(weekKey → count)
  const areaWeekly = new Map();

  function weekKey(dateStr) {
    const d = new Date(dateStr);
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - oneJan) / DAY);
    const w = Math.ceil((days + oneJan.getDay() + 1) / 7);
    return `${d.getFullYear()}-${String(w).padStart(2, '0')}`;
  }

  function bump(map, key) {
    const cur = map.get(key) || emptyStat();
    map.set(key, cur);
    return cur;
  }

  function bumpWeekly(map, key, date) {
    let wm = map.get(key);
    if (!wm) { wm = new Map(); map.set(key, wm); }
    const wk = weekKey(date);
    wm.set(wk, (wm.get(wk) || 0) + 1);
  }

  let processed = 0;
  for (const r of records) {
    const date = r.date;
    if (!date || date > windowEnds) continue;
    const region = r.location?.region || 'Palestine';
    const eventType = r.event_type || 'unknown';
    const area = r.location?.name || r.location?.governorate;

    const regionKey = `${region}:${eventType}`;
    const areaKey = area ? `${area}:${eventType}` : null;

    const rStat = bump(regionBuckets, regionKey);
    rStat.total_observed += 1;
    if (!rStat.earliest || date < rStat.earliest) rStat.earliest = date;
    if (!rStat.latest || date > rStat.latest) rStat.latest = date;
    if (date >= cutoff30) rStat.count_30d += 1;
    if (date >= cutoff90) rStat.count_90d += 1;
    if (date >= cutoff12m) {
      rStat.count_12m += 1;
      bumpWeekly(regionWeekly, regionKey, date);
    }

    if (areaKey) {
      const aStat = bump(areaBuckets, areaKey);
      aStat.total_observed += 1;
      if (!aStat.earliest || date < aStat.earliest) aStat.earliest = date;
      if (!aStat.latest || date > aStat.latest) aStat.latest = date;
      if (date >= cutoff30) aStat.count_30d += 1;
      if (date >= cutoff90) aStat.count_90d += 1;
      if (date >= cutoff12m) {
        aStat.count_12m += 1;
        bumpWeekly(areaWeekly, areaKey, date);
      }
    }
    processed += 1;
  }

  function finalizeMap(bucketMap, weeklyMap) {
    const out = {};
    for (const [key, stat] of bucketMap) {
      stat.avg_weekly_90d = stat.count_90d / (90 / 7);
      const weeks = Array.from((weeklyMap.get(key) || new Map()).values());
      finalize(stat, weeks);
      out[key] = stat;
    }
    return out;
  }

  const baselines = finalizeMap(regionBuckets, regionWeekly);
  const byArea = finalizeMap(areaBuckets, areaWeekly);

  const out = {
    generated_at: new Date().toISOString(),
    window_ends: windowEnds,
    records_processed: processed,
    baselines,
    by_area: byArea,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  return out;
}

export async function loadBaselines() {
  try {
    return JSON.parse(await fs.readFile(OUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function lookupContext(baselines, region, eventType, area) {
  if (!baselines) return null;
  const regionStat = baselines.baselines?.[`${region}:${eventType}`];
  const areaStat = area ? baselines.by_area?.[`${area}:${eventType}`] : null;
  if (!regionStat && !areaStat) return null;

  const primary = areaStat || regionStat;
  const avgWeekly = primary.avg_weekly_90d || 0;
  const thisMonth = primary.count_30d || 0;

  let context = '';
  if (avgWeekly > 0) {
    const weeklyRate = thisMonth / (30 / 7);
    const delta = avgWeekly > 0 ? ((weeklyRate - avgWeekly) / avgWeekly) * 100 : 0;
    const dir = delta > 15 ? 'above' : delta < -15 ? 'below' : 'near';
    context = `${thisMonth} ${eventType.replace(/_/g, ' ')}(s) in ${area || region} over last 30d — ${dir} 90d avg of ${avgWeekly.toFixed(2)}/wk`;
  } else if (thisMonth > 0) {
    context = `${thisMonth} ${eventType.replace(/_/g, ' ')}(s) in ${area || region} over last 30d`;
  }

  return {
    area_context: areaStat,
    region_context: regionStat,
    summary: context,
    count_30d: thisMonth,
    avg_weekly_90d: avgWeekly,
    p90_weekly_12m: primary.p90_weekly_12m,
  };
}

// CLI entry
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildBaselines()
    .then(out => {
      console.log(`✓ Baselines written: ${Object.keys(out.baselines).length} region keys, ${Object.keys(out.by_area).length} area keys`);
      console.log(`  Window ends: ${out.window_ends}, records processed: ${out.records_processed} (unified + live alerts)`);
    })
    .catch(err => {
      console.error('❌ baseline-analyzer failed:', err);
      process.exit(1);
    });
}
