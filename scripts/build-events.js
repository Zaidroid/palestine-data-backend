/**
 * Event clustering — groups unified records across categories into place+time
 * event clusters, the queryable answer to "what happened in Jenin that week?"
 *
 * Generalizes the alerts service's incident-grouping pattern to the
 * historical databank, riding on the shared geographic keys stamped by
 * attach-locations.js (gazetteer_key, OCHA admin2) and the deterministic
 * stable_ids from attach-stable-ids.js.
 *
 * Clustering key: (place_key × ISO week). place_key prefers the gazetteer
 * key (village/town-level); records with only an admin stamp cluster at
 * governorate level (place_kind: "admin2"). Records with neither, or
 * without a date, can't be placed and are skipped (counted in metadata).
 *
 * Participating categories are the event-shaped ones: conflict,
 * infrastructure, land, news, refugees. Indicator/registry categories
 * (water, health, pcbs, economic, education, westbank, culture, funding)
 * and the dateless martyrs roster are not events.
 *
 * Output (public/data/events/ — deliberately OUTSIDE unified/ so the
 * category machinery doesn't serve clusters as records):
 *   events.json        { generated_at, total, skipped, data: [cluster…] }
 *   member-index.json  { <stable_id>: [<cluster_id>…] }
 *
 * Cluster shape:
 *   { cluster_id, place_key, place_kind, place_name, admin1, admin2,
 *     week, period: {start, end}, categories: [...],
 *     record_count, members: { <category>: [{stable_id, date, event_type}] },
 *     aggregated: { killed, injured, displaced, demolished, detained } }
 *
 * Idempotent; runs after attach-stable-ids.js in refresh-data.sh.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNIFIED_DIR = path.resolve(__dirname, '../public/data/unified');
const EVENTS_DIR = path.resolve(__dirname, '../public/data/events');

const EVENT_CATEGORIES = ['conflict', 'infrastructure', 'land', 'news', 'refugees'];
const METRIC_KEYS = ['killed', 'injured', 'displaced', 'demolished', 'detained'];

function isoWeek(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    // ISO-8601 week number, with the week's Monday as the period start.
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((d.getUTCDay() || 7) - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = (x) => x.toISOString().slice(0, 10);
    return {
        key: `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
        start: fmt(monday),
        end: fmt(sunday),
    };
}

async function loadCategory(cat) {
    const allDataPath = path.join(UNIFIED_DIR, cat, 'all-data.json');
    try {
        const doc = JSON.parse(await fs.readFile(allDataPath, 'utf-8'));
        return Array.isArray(doc.data) ? doc.data : [];
    } catch {
        return [];
    }
}

async function main() {
    const clusters = new Map();
    let placed = 0;
    let skipped = 0;

    const addToCluster = (ck, kind, placeName, loc, week, cat, rec) => {
        let cluster = clusters.get(ck);
        if (!cluster) {
            cluster = {
                cluster_id: `ev-${crypto.createHash('sha256').update(ck).digest('hex').slice(0, 16)}`,
                place_key: ck.split('|')[0],
                place_kind: kind,
                place_name: placeName,
                admin1: loc.admin1 || null,
                admin2: loc.admin2 || null,
                week: week.key,
                period: { start: week.start, end: week.end },
                categories: [],
                record_count: 0,
                members: {},
                aggregated: Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])),
            };
            clusters.set(ck, cluster);
        }
        if (!cluster.members[cat]) {
            cluster.members[cat] = [];
            cluster.categories.push(cat);
        }
        cluster.members[cat].push({
            stable_id: rec.stable_id,
            date: rec.date,
            event_type: rec.event_type || null,
        });
        cluster.record_count++;
        for (const k of METRIC_KEYS) {
            const v = rec.metrics?.[k];
            if (typeof v === 'number' && Number.isFinite(v)) cluster.aggregated[k] += v;
        }
        if (!cluster.admin1 && loc.admin1) cluster.admin1 = loc.admin1;
        if (!cluster.admin2 && loc.admin2) cluster.admin2 = loc.admin2;
    };

    for (const cat of EVENT_CATEGORIES) {
        const records = await loadCategory(cat);
        for (const rec of records) {
            const loc = rec.location || {};
            const week = rec.date ? isoWeek(rec.date) : null;
            if (!week || !rec.stable_id || (!loc.gazetteer_key && !loc.admin2)) {
                skipped++;
                continue;
            }
            placed++;

            // Two granularities, both useful: a precise place-level cluster
            // ("Jenin camp, week 24") AND a governorate rollup ("Jenin
            // governorate, week 24"). Records sit in both; rollups are where
            // cross-dataset joins concentrate because every dataset resolves
            // admin2 even when place spellings differ.
            if (loc.gazetteer_key) {
                addToCluster(`${loc.gazetteer_key}|${week.key}`, 'gazetteer', loc.name || loc.gazetteer_key, loc, week, cat, rec);
            }
            if (loc.admin2) {
                addToCluster(`admin2:${loc.admin2.toLowerCase()}|${week.key}`, 'admin2', loc.admin2, loc, week, cat, rec);
            }
        }
    }

    const data = [...clusters.values()].sort((a, b) =>
        b.period.start.localeCompare(a.period.start) || b.record_count - a.record_count
    );

    const memberIndex = {};
    for (const c of data) {
        for (const members of Object.values(c.members)) {
            for (const m of members) {
                (memberIndex[m.stable_id] ||= []).push(c.cluster_id);
            }
        }
    }

    await fs.mkdir(EVENTS_DIR, { recursive: true });
    await fs.writeFile(
        path.join(EVENTS_DIR, 'events.json'),
        JSON.stringify({
            generated_at: new Date().toISOString(),
            total: data.length,
            records_placed: placed,
            records_skipped_unplaceable: skipped,
            categories: EVENT_CATEGORIES,
            data,
        }, null, 2),
        'utf-8'
    );
    await fs.writeFile(
        path.join(EVENTS_DIR, 'member-index.json'),
        JSON.stringify(memberIndex),
        'utf-8'
    );

    const multi = data.filter((c) => c.categories.length >= 2).length;
    console.log(`[OK]    Event clustering: ${data.length} clusters from ${placed} records ` +
        `(${skipped} unplaceable) — ${multi} clusters span 2+ categories`);
}

main().catch((err) => {
    console.error('[FATAL] build-events failed:', err);
    process.exit(1);
});
