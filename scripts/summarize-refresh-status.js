#!/usr/bin/env node
/**
 * Consolidate refresh-events.ndjson → refresh-status.json.
 *
 * Each line of the ndjson is one fetcher run event (label, outcome,
 * duration_s, rc, at). We aggregate per-fetcher: latest outcome,
 * total runs, success count, failure count, success_rate, recent
 * 10-run window, consecutive_failures (count of trailing FAIL).
 *
 * Read by /api/v1/sources to surface live fetcher health.
 *
 * Idempotent. Rotates events older than 30 days out of the ndjson on
 * each run so the file doesn't grow unbounded.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const NDJSON = path.join(REPO_ROOT, 'public/data/refresh-events.ndjson');
const STATUS = path.join(REPO_ROOT, 'public/data/refresh-status.json');
const RETENTION_DAYS = 30;

async function readEvents() {
    let raw;
    try {
        raw = await fs.readFile(NDJSON, 'utf-8');
    } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
    }
    return raw.split('\n')
        .filter(Boolean)
        .map((line) => {
            try { return JSON.parse(line); }
            catch { return null; }
        })
        .filter(Boolean);
}

async function main() {
    const all = await readEvents();
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    const recent = all.filter((e) => Date.parse(e.at) >= cutoff);

    // Per-fetcher rollup
    const byLabel = new Map();
    for (const e of recent) {
        const arr = byLabel.get(e.label) || [];
        arr.push(e);
        byLabel.set(e.label, arr);
    }

    const fetchers = {};
    for (const [label, events] of byLabel) {
        events.sort((a, b) => a.at.localeCompare(b.at));
        const latest = events[events.length - 1];
        const total = events.length;
        const successes = events.filter((e) => e.outcome === 'OK').length;
        const failures = total - successes;
        // Trailing consecutive failures (most recent runs)
        let consecutiveFailures = 0;
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].outcome !== 'OK') consecutiveFailures += 1;
            else break;
        }
        const last10 = events.slice(-10).map((e) => ({
            outcome: e.outcome,
            duration_s: e.duration_s,
            at: e.at,
        }));
        fetchers[label] = {
            latest_outcome: latest.outcome,
            latest_at: latest.at,
            latest_duration_s: latest.duration_s,
            latest_rc: latest.rc,
            total_runs_30d: total,
            successes_30d: successes,
            failures_30d: failures,
            success_rate_30d: total ? +(successes / total).toFixed(3) : null,
            consecutive_failures: consecutiveFailures,
            health: consecutiveFailures >= 3 ? 'failing'
                  : consecutiveFailures >= 1 ? 'flaky'
                  : 'healthy',
            recent_runs: last10,
        };
    }

    const status = {
        generated_at: new Date().toISOString(),
        retention_days: RETENTION_DAYS,
        total_events: recent.length,
        fetcher_count: Object.keys(fetchers).length,
        fetchers,
    };

    await fs.writeFile(STATUS, JSON.stringify(status, null, 2));
    // Rotate the ndjson — keep only retained-window events on disk
    if (recent.length !== all.length) {
        await fs.writeFile(
            NDJSON,
            recent.map((e) => JSON.stringify(e)).join('\n') + '\n',
        );
    }
    console.log(`[refresh-status] ${Object.keys(fetchers).length} fetchers tracked, ${recent.length} events in window`);
}

main().catch((e) => {
    console.error('[refresh-status] FATAL:', e.message);
    process.exit(1);
});
