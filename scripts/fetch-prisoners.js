import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// addameer.ps periodically serves an expired TLS cert (e.g. expired 2026-03-23,
// unrenewed). When the direct fetch fails, fall back to the latest Wayback
// Machine snapshot — same page over valid TLS; data is monthly so a snapshot
// a few weeks old is acceptable.
async function fetchStatisticsHtml() {
    const directUrl = 'https://www.addameer.ps/statistics';
    try {
        const response = await fetch(directUrl);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        return { html: await response.text(), via: 'direct' };
    } catch (err) {
        console.warn(`Direct fetch failed (${err.cause?.code || err.message}); trying Wayback snapshot...`);
        const avail = await fetch('https://archive.org/wayback/available?url=addameer.ps/statistics');
        const closest = (await avail.json())?.archived_snapshots?.closest;
        if (!closest?.available) throw err;
        const snapUrl = closest.url.replace(/^http:/, 'https:');
        const response = await fetch(snapUrl);
        if (!response.ok) throw new Error(`Wayback fetch failed: ${response.status}`);
        console.log(`Using Wayback snapshot ${closest.timestamp}`);
        return { html: await response.text(), via: `wayback_${closest.timestamp}` };
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADDAMEER_OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'static', 'prisoners-addameer.json');

// Map Addameer chart series-name → canonical metric_type.
function classifyMetric(seriesName) {
    const n = (seriesName || '').toLowerCase();
    if (n.includes('total number') || n.includes('total prisoners')) return 'total';
    if (n.includes('administrative')) return 'administrative';
    if (n.includes('child')) return 'child';
    if (n.includes('female') || n.includes('women')) return 'female';
    return null;
}

// Addameer chart categories arrive as 'YYYY-MM\n' (newest first). Convert to ISO date.
function monthToDate(label) {
    if (!label) return null;
    const m = String(label).trim().match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return null;
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-01`;
}

async function fetchAddameerData() {
    console.log('Fetching Addameer statistics...');
    const { html } = await fetchStatisticsHtml();

    const records = [];
    const seen = new Set();

    // Extract every <... data-chart="..." ...> block. Each chart has a series with
    // categories (months, newest first) + data (counts in same order).
    const chartRegex = /data-chart="([^"]+)"/g;
    let match;
    while ((match = chartRegex.exec(html)) !== null) {
        const rawJson = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        let chart;
        try {
            chart = JSON.parse(rawJson);
        } catch {
            continue;
        }
        // xAxis is an array of axis objects; categories live on the first one.
        const xAxis = Array.isArray(chart.xAxis) ? chart.xAxis[0] : chart.xAxis;
        const categories = (xAxis && xAxis.categories) || chart.categories || [];
        const series = chart.series || [];
        for (const s of series) {
            const metric = classifyMetric(s.name);
            if (!metric || !Array.isArray(s.data)) continue;
            // Pair each month with its value. Some chart variants use x/y objects;
            // others raw numbers. Handle both.
            for (let i = 0; i < s.data.length; i++) {
                const monthLabel = categories[i];
                const date = monthToDate(monthLabel);
                if (!date) continue;
                const point = s.data[i];
                const count = typeof point === 'number' ? point : point?.y;
                if (!Number.isFinite(count)) continue;
                const key = `${date}|${metric}`;
                if (seen.has(key)) continue;
                seen.add(key);
                records.push({
                    id: `addameer_${metric}_${date}`,
                    date,
                    governorate: 'West Bank & Gaza',
                    metric_type: metric,
                    count,
                    source: 'Addameer Prisoner Support and Human Rights Association',
                    source_url: 'https://www.addameer.ps/statistics',
                });
            }
        }
    }

    // Cross-check the latest month with textual fallbacks (their charts sometimes
    // omit child/female series even though the page text shows them).
    try {
        const cheerioMod = await import('cheerio');
        const $ = cheerioMod.load(html);
        const textContent = $('body').text()
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/1948\s*Territories/gi, ' ');
        const today = new Date().toISOString().slice(0, 7);
        const todayDate = `${today}-01`;
        const ensure = (metric, count) => {
            const key = `${todayDate}|${metric}`;
            if (!Number.isFinite(count) || seen.has(key)) return;
            seen.add(key);
            records.push({
                id: `addameer_${metric}_${todayDate}`,
                date: todayDate,
                governorate: 'West Bank & Gaza',
                metric_type: metric,
                count,
                source: 'Addameer Prisoner Support and Human Rights Association',
                source_url: 'https://www.addameer.ps/statistics',
                source_extraction: 'page_text_fallback',
            });
        };
        const childMatch = textContent.match(/Child\s*prisoners\s*(\d+)/i);
        if (childMatch) ensure('child', parseInt(childMatch[1], 10));
        const femaleMatch = textContent.match(/Female\s*prisoners\s*(\d+)/i);
        if (femaleMatch) ensure('female', parseInt(femaleMatch[1], 10));
    } catch (e) {
        console.warn('Cheerio fallback skipped:', e.message);
    }

    // Sort newest-first for human readability when inspecting the file.
    records.sort((a, b) => b.date.localeCompare(a.date) || a.metric_type.localeCompare(b.metric_type));

    fs.mkdirSync(path.dirname(ADDAMEER_OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(ADDAMEER_OUTPUT_PATH, JSON.stringify(records, null, 2));

    const months = new Set(records.map((r) => r.date)).size;
    const metrics = new Set(records.map((r) => r.metric_type)).size;
    console.log(`Addameer: wrote ${records.length} records (${months} months × ${metrics} metrics) → ${ADDAMEER_OUTPUT_PATH}`);
}

fetchAddameerData().catch((err) => {
    console.error('Error fetching Addameer data:', err);
    process.exit(1);
});
