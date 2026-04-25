/**
 * Databank totals — official headline numbers.
 *
 * The detail tables (people_killed, people_injured, etc.) carry both
 * named-individual rosters and daily-aggregate rows. Consumers asking
 * "how many were killed in Gaza?" want the official Gaza MoH cumulative
 * total, not a row count or a sum that mixes data sources.
 *
 * This endpoint surfaces those headline numbers explicitly, with sourcing
 * + as-of dates, so there is no ambiguity between:
 *   - 72,345 cumulative killed in Gaza (Gaza MoH, official total)
 *   - 60,199 named individuals identified in the Tech4Palestine roster (subset)
 *
 * Backed by public/data/gaza/summary.json (refreshed by the data pipeline)
 * and public/data/unified/martyrs_snapshot_2023/all-data.json.
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA = path.resolve(__dirname, '../../../public/data');

const router = express.Router();

async function readJsonSafe(p) {
    try {
        return JSON.parse(await fs.readFile(p, 'utf8'));
    } catch {
        return null;
    }
}

router.get('/', async (req, res) => {
    const gazaSummary = await readJsonSafe(path.join(PUBLIC_DATA, 'gaza/summary.json'));
    const martyrsAll = await readJsonSafe(path.join(PUBLIC_DATA, 'unified/martyrs_snapshot_2023/all-data.json'));
    const prisonersFile = await readJsonSafe(path.join(PUBLIC_DATA, 'static/prisoners-addameer.json'));

    const gazaCumulative = gazaSummary?.cumulative ?? null;
    const martyrSummary = martyrsAll?.data?.find?.((r) => r.event_type === 'cumulative_summary') ?? null;
    const wbCumulative = martyrSummary?.cumulative?.west_bank ?? null;
    const namedRosterSize = martyrSummary?.cumulative?.identified_in_gaza_database
        ?? (martyrsAll?.data?.filter?.((r) => r.event_type === 'identified_killed').length ?? null);

    // Latest Addameer monthly snapshot per metric
    const prisonersLatest = (prisonersFile || []).reduce((acc, r) => {
        const m = r.metric_type;
        if (!m) return acc;
        const existing = acc[m];
        if (!existing || (r.date && r.date > existing.date)) acc[m] = { count: r.count, date: r.date };
        return acc;
    }, {});

    res.json({
        notice: 'Headline cumulative totals — these supersede any row-count of the detail tables. ' +
            'For named individuals, time-series, or filtered queries see /databank/people_killed etc.',
        gaza: gazaCumulative ? {
            cumulative_killed: gazaCumulative.killed,
            cumulative_injured: gazaCumulative.injured,
            children_killed: gazaCumulative.children_killed,
            women_killed: gazaCumulative.women_killed,
            medics_killed: gazaCumulative.medics_killed,
            press_killed: gazaCumulative.press_killed,
            civil_defence_killed: gazaCumulative.civil_defence_killed,
            massacres: gazaCumulative.massacres,
            famine_deaths: gazaCumulative.famine_deaths,
            child_famine_deaths: gazaCumulative.child_famine_deaths,
            aid_seekers_killed: gazaCumulative.aid_seekers_killed,
            aid_seekers_injured: gazaCumulative.aid_seekers_injured,
            named_individuals_identified: namedRosterSize,
            named_vs_cumulative_note:
                namedRosterSize && gazaCumulative.killed
                    ? `${namedRosterSize.toLocaleString()} of ${gazaCumulative.killed.toLocaleString()} killed have been identified by name (${(namedRosterSize / gazaCumulative.killed * 100).toFixed(1)}%); identification lags due to forensic capacity. The named roster is a strict subset of the cumulative total.`
                    : null,
            as_of: gazaSummary.latest_bulletin_date,
            source: 'Gaza Ministry of Health daily bulletins, mirrored by Tech4Palestine (CC-BY-4.0)',
            source_url: 'https://data.techforpalestine.org/api/v3/summary.json',
        } : null,
        west_bank: wbCumulative ? {
            cumulative_killed: wbCumulative.killed,
            children_killed: wbCumulative.children,
            cumulative_injured: wbCumulative.injured,
            injured_children: wbCumulative.injured_children,
            settler_attacks: wbCumulative.settler_attacks,
            as_of: martyrSummary.date,
            source: 'Tech4Palestine West Bank cumulative summary (CC-BY-4.0)',
            source_url: 'https://data.techforpalestine.org/api/v3/summary.json',
        } : null,
        prisoners: Object.keys(prisonersLatest).length ? {
            total:          prisonersLatest.total?.count ?? null,
            administrative: prisonersLatest.administrative?.count ?? null,
            child:          prisonersLatest.child?.count ?? null,
            female:         prisonersLatest.female?.count ?? null,
            as_of: Object.values(prisonersLatest).reduce((d, v) => v.date > d ? v.date : d, ''),
            source: 'Addameer Prisoner Support and Human Rights Association',
            source_url: 'https://www.addameer.ps/statistics',
        } : null,
        last_refreshed: new Date().toISOString(),
    });
});

export default router;
