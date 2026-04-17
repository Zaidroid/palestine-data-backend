#!/usr/bin/env node

/**
 * Gaza Daily Bulletin Builder
 *
 * Fetches Tech4Palestine daily casualty data (which aggregates Gaza MoH
 * bulletins) and produces a clean Gaza-specific daily time-series with
 * demographic breakdown (children, women, medics, press, civil defence,
 * famine, aid seekers) plus computed per-day deltas.
 *
 * Output: public/data/gaza/daily.json, public/data/gaza/summary.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../public/data');
const OUT_DIR = path.join(DATA_DIR, 'gaza');
const BASELINE_DATE = '2023-10-07';

const T4P_DAILY = 'https://data.techforpalestine.org/api/v2/casualties_daily.json';
const T4P_SUMMARY = 'https://data.techforpalestine.org/api/v3/summary.json';

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function diff(curr, prev) {
  if (curr == null || prev == null) return null;
  return Math.max(0, curr - prev);
}

async function main() {
  await ensureDir(OUT_DIR);

  console.log('📥 Fetching T4P daily casualties + summary...');
  const [dailyRes, summaryRes] = await Promise.all([
    fetch(T4P_DAILY),
    fetch(T4P_SUMMARY),
  ]);

  if (!dailyRes.ok) throw new Error(`T4P daily HTTP ${dailyRes.status}`);
  if (!summaryRes.ok) throw new Error(`T4P summary HTTP ${summaryRes.status}`);

  const daily = await dailyRes.json();
  const summary = await summaryRes.json();

  // Filter Oct-7+ and sort by date ascending
  const sorted = daily
    .filter(r => (r.report_date || r.date) >= BASELINE_DATE)
    .sort((a, b) => (a.report_date || a.date).localeCompare(b.report_date || b.date));

  // Build clean daily records with deltas
  const records = [];
  let prev = null;
  for (const r of sorted) {
    const date = r.report_date || r.date;
    const killedCum = r.ext_killed_cum ?? r.killed_cum ?? null;
    const injuredCum = r.ext_injured_cum ?? r.injured_cum ?? null;
    const childrenCum = r.ext_killed_children_cum ?? null;
    const womenCum = r.ext_killed_women_cum ?? null;
    const medicsCum = r.ext_med_killed_cum ?? r.med_killed_cum ?? null;
    const pressCum = r.ext_press_killed_cum ?? r.press_killed_cum ?? null;
    const civdefCum = r.ext_civdef_killed_cum ?? null;
    const famineCum = r.famine_cum ?? null;
    const childFamineCum = r.child_famine_cum ?? null;
    const aidSeekerKilledCum = r.aid_seeker_killed_cum ?? null;
    const aidSeekerInjuredCum = r.aid_seeker_injured_cum ?? null;
    const massacresCum = r.ext_massacres_cum ?? null;

    const rec = {
      date,
      region: 'Gaza Strip',
      source: 'tech4palestine',
      source_upstream: r.report_source || 'mohtel',
      cumulative: {
        killed: killedCum,
        injured: injuredCum,
        children_killed: childrenCum,
        women_killed: womenCum,
        medics_killed: medicsCum,
        press_killed: pressCum,
        civil_defence_killed: civdefCum,
        massacres: massacresCum,
        famine_deaths: famineCum,
        child_famine_deaths: childFamineCum,
        aid_seekers_killed: aidSeekerKilledCum,
        aid_seekers_injured: aidSeekerInjuredCum,
      },
      daily_delta: {
        killed: prev ? diff(killedCum, prev.cumulative.killed) : killedCum,
        injured: prev ? diff(injuredCum, prev.cumulative.injured) : injuredCum,
        children_killed: prev ? diff(childrenCum, prev.cumulative.children_killed) : null,
        women_killed: prev ? diff(womenCum, prev.cumulative.women_killed) : null,
        medics_killed: prev ? diff(medicsCum, prev.cumulative.medics_killed) : null,
        press_killed: prev ? diff(pressCum, prev.cumulative.press_killed) : null,
      },
    };
    records.push(rec);
    prev = rec;
  }

  // Main time-series
  const dailyOut = {
    metadata: {
      source: 'tech4palestine',
      upstream: 'Gaza Ministry of Health (aggregated by T4P)',
      baseline_date: BASELINE_DATE,
      record_count: records.length,
      generated_at: new Date().toISOString(),
      schema_version: '1.0.0',
    },
    data: records,
  };
  await fs.writeFile(path.join(OUT_DIR, 'daily.json'), JSON.stringify(dailyOut, null, 2));
  console.log(`✓ Wrote gaza/daily.json (${records.length} records)`);

  // Compact summary of latest day + rollups
  const latest = records.at(-1);
  const last7 = records.slice(-7);
  const last30 = records.slice(-30);
  const sumField = (arr, field) =>
    arr.reduce((a, r) => a + (r.daily_delta[field] ?? 0), 0);

  const summaryOut = {
    generated_at: new Date().toISOString(),
    source: 'tech4palestine (upstream: Gaza MoH bulletins)',
    latest_bulletin_date: latest?.date,
    cumulative: latest?.cumulative ?? {},
    last_7_days: {
      killed: sumField(last7, 'killed'),
      injured: sumField(last7, 'injured'),
      children_killed: sumField(last7, 'children_killed'),
      women_killed: sumField(last7, 'women_killed'),
      medics_killed: sumField(last7, 'medics_killed'),
      press_killed: sumField(last7, 'press_killed'),
    },
    last_30_days: {
      killed: sumField(last30, 'killed'),
      injured: sumField(last30, 'injured'),
      children_killed: sumField(last30, 'children_killed'),
      women_killed: sumField(last30, 'women_killed'),
    },
    official_totals: summary.gaza ?? null,
  };
  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summaryOut, null, 2));
  console.log(`✓ Wrote gaza/summary.json`);
  console.log(`  Latest (${latest?.date}): total killed=${latest?.cumulative.killed}, children=${latest?.cumulative.children_killed}, women=${latest?.cumulative.women_killed}`);
}

main().catch(err => {
  console.error('❌ fetch-gaza-daily failed:', err);
  process.exit(1);
});
