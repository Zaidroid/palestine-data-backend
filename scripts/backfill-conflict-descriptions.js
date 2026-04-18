/**
 * Backfill: synthesize descriptions for already-emitted conflict records that
 * have an empty `description`. The transformer was updated to do this on
 * future pipeline runs (conflict-transformer.js); this script applies the
 * same logic to the on-disk dataset without forcing a full re-fetch.
 *
 * After backfilling, runs the stable-id sweep so /record/ permalinks reflect
 * the new content.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { attachStableIds, buildStableIdIndex } from './utils/stable-id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFLICT_FILE = path.resolve(__dirname, '../public/data/unified/conflict/all-data.json');
const INDEX_FILE = path.resolve(__dirname, '../public/data/unified/conflict/stable-id-index.json');

function regionLabel(record) {
    return (
        record.location?.governorate ||
        record.location?.region ||
        record.location?.name ||
        'Palestine'
    );
}

function synthesize(record) {
    if (record.description && String(record.description).trim()) return record.description;
    const eventType = (record.event_type || '').toLowerCase();
    const region = regionLabel(record);
    const date = record.date;
    const killed = Number(record.metrics?.killed || 0);
    const injured = Number(record.metrics?.injured || 0);

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
    return record.description || '';
}

async function main() {
    const doc = JSON.parse(await fs.readFile(CONFLICT_FILE, 'utf-8'));
    const records = Array.isArray(doc.data) ? doc.data : [];

    let filled = 0;
    let urlsFilled = 0;
    for (const r of records) {
        const before = r.description || '';
        const after = synthesize(r);
        if (after !== before) {
            r.description = after;
            filled += 1;
        }
        // Backfill canonical T4P URL when source.url is null
        if (Array.isArray(r.sources)) {
            for (const s of r.sources) {
                if (!s.url) {
                    const name = String(s.name || s.organization || '').toLowerCase();
                    if (name.includes('tech4palestine') || name.includes('tech for palestine')) {
                        s.url = 'https://data.techforpalestine.org';
                        urlsFilled += 1;
                    } else if (name.includes("b'tselem") || name.includes('btselem')) {
                        s.url = 'https://www.btselem.org';
                        urlsFilled += 1;
                    } else if (name.includes('ocha')) {
                        s.url = 'https://www.ochaopt.org';
                        urlsFilled += 1;
                    }
                }
            }
        }
    }

    // Re-attach stable IDs since description / source.url are part of the
    // fingerprint — IDs would otherwise drift on the next pipeline run.
    attachStableIds(records);
    const { index, collisions, total } = buildStableIdIndex(records);

    await fs.writeFile(CONFLICT_FILE, JSON.stringify({ ...doc, data: records }, null, 2), 'utf-8');
    await fs.writeFile(
        INDEX_FILE,
        JSON.stringify({
            generated_at: new Date().toISOString(),
            category: 'conflict',
            total,
            collisions,
            index,
        }, null, 2),
        'utf-8'
    );

    console.log(`[OK] backfilled ${filled} descriptions, ${urlsFilled} source URLs across ${records.length} records`);
    console.log(`[OK] re-indexed ${total} stable IDs (${collisions} collisions)`);
}

main().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});
