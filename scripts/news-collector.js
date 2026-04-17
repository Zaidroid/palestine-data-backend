#!/usr/bin/env node
/**
 * News Collector Daemon
 *
 * Fetches trusted Palestine-focused RSS feeds every FETCH_INTERVAL_MS,
 * persists articles to SQLite (news.db), dedupes by guid/url, and
 * classifies topic/severity/entities using the shared known_locations KB.
 *
 * Run modes:
 *   - one-shot:   node scripts/news-collector.js --once
 *   - daemon:     node scripts/news-collector.js       (loops forever)
 *
 * DB path: services/westbank-alerts/data/news.db (same volume as alerts.db)
 *
 * Usage:
 *   npm run news:collect          # one-shot
 *   npm run news:daemon           # long-running
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SOURCES_PATH = path.join(__dirname, 'news-sources.json');
const LOCATIONS_PATH = path.resolve(ROOT, 'services/westbank-alerts/data/known_locations.json');
const DB_PATH = process.env.NEWS_DB_PATH || path.resolve(ROOT, 'services/westbank-alerts/data/news.db');

const FETCH_INTERVAL_MS = Number(process.env.NEWS_FETCH_INTERVAL_MS) || 15 * 60 * 1000;
const FEED_TIMEOUT_MS = 15_000;
const FEED_DELAY_MS = 800;

const logger = createLogger({ context: 'News-Collector', logLevel: 'INFO' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guid_hash TEXT UNIQUE NOT NULL,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      language TEXT NOT NULL,
      reliability TEXT NOT NULL,
      category TEXT,
      title TEXT NOT NULL,
      link TEXT,
      description TEXT,
      body TEXT,
      author TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL,
      topics TEXT,
      entities TEXT,
      severity TEXT,
      palestine_relevant INTEGER DEFAULT 1,
      raw_guid TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_articles_pubdate   ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_fetched   ON articles(fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_source    ON articles(source_id);
    CREATE INDEX IF NOT EXISTS idx_articles_lang      ON articles(language);
    CREATE INDEX IF NOT EXISTS idx_articles_severity  ON articles(severity);

    CREATE TABLE IF NOT EXISTS fetch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      feeds_attempted INTEGER DEFAULT 0,
      feeds_ok INTEGER DEFAULT 0,
      articles_seen INTEGER DEFAULT 0,
      articles_new INTEGER DEFAULT 0,
      errors TEXT
    );
  `);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
}

// ─────────────────────────────────────────────────────────────────────────────
// RSS parsing
// ─────────────────────────────────────────────────────────────────────────────
function stripCdata(s) {
  if (!s) return s;
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function stripTags(s) {
  if (!s) return s;
  return decodeEntities(stripCdata(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? stripCdata(m[1].trim()) : null;
}
function extractLink(xml) {
  // RSS <link>…</link>
  const rssLink = extractTag(xml, 'link');
  if (rssLink && /^https?:/i.test(rssLink)) return rssLink;
  // Atom <link href="…"/>
  const atomRe = /<link[^>]+href="([^"]+)"[^>]*\/?>/i;
  const m = xml.match(atomRe);
  if (m) return m[1];
  return rssLink;
}

function parseFeed(xml) {
  const itemRe = /<item[\s\S]*?<\/item>/g;
  const entryRe = /<entry[\s\S]*?<\/entry>/g;
  let blocks = xml.match(itemRe) || xml.match(entryRe) || [];
  return blocks.map((block) => {
    const title = stripTags(extractTag(block, 'title'));
    const link = extractLink(block);
    const description =
      extractTag(block, 'description') ||
      extractTag(block, 'summary') ||
      extractTag(block, 'content');
    const contentEncoded =
      extractTag(block, 'content:encoded') ||
      extractTag(block, 'content');
    const published =
      extractTag(block, 'pubDate') ||
      extractTag(block, 'published') ||
      extractTag(block, 'updated') ||
      extractTag(block, 'dc:date');
    const author =
      extractTag(block, 'dc:creator') ||
      extractTag(block, 'author');
    const rawGuid = extractTag(block, 'guid') || extractTag(block, 'id') || link || title;
    return {
      title,
      link: link ? decodeEntities(link) : null,
      description: description ? stripTags(description) : null,
      body: contentEncoded ? stripTags(contentEncoded) : null,
      published,
      author: author ? stripTags(author) : null,
      rawGuid: rawGuid ? decodeEntities(rawGuid) : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────
const PALESTINE_KEYWORDS = [
  'palestine','palestinian','gaza','west bank','westbank','jerusalem',
  'hebron','nablus','jenin','ramallah','rafah','khan yunis','bethlehem',
  'tulkarm','qalqilya','jericho','israel','israeli','idf','hamas','fatah',
  'unrwa','occupied territories','settler','settlement','al-aqsa',
  // Arabic
  'فلسطين','فلسطيني','غزة','الضفة','القدس','الخليل','نابلس','جنين',
  'رام الله','رفح','بيت لحم','طولكرم','قلقيلية','أريحا','الاحتلال',
  'الأقصى','المستوطن','المستوطنين','حماس','فتح','الجيش الإسرائيلي',
];

function isPalestineRelevant(title, description) {
  const t = `${title || ''} ${description || ''}`.toLowerCase();
  return PALESTINE_KEYWORDS.some(k => t.includes(k));
}

const TOPIC_RULES = [
  ['conflict',    /\b(strike|air\s*strike|bomb|shell|raid|killed|death toll|casualt|clash|wound|injur|attack|assault|massacre|offensive|tank|drone|missile|ambush|assassinat)\w*/i],
  ['conflict',    /(قصف|غارة|استشهاد|مجزرة|اشتباك|اقتحام|جريح|إصابة|اعتداء|اغتيال)/],
  ['humanitarian',/\b(aid|humanitarian|famine|starv|displace|shelter|refugee|water shortage|blockade|crossing|siege)\b/i],
  ['humanitarian',/(مساعدات|نزوح|لاجئ|مجاعة|حصار|جوع|إغاثة)/],
  ['health',      /\b(hospital|medical|doctor|patient|icu|ambulance|vaccine|disease|outbreak|health)\b/i],
  ['health',      /(مستشفى|طبي|طبيب|لقاح|وباء|إصابة مرض)/],
  ['political',   /\b(parliament|knesset|election|cabinet|minister|president|prime minister|negotiat|ceasefire|truce|diploma|UN security|resolution)\b/i],
  ['political',   /(الكنيست|انتخابات|وزير|رئيس|مفاوضات|هدنة|قرار أممي|حكوم)/],
  ['economic',    /\b(economy|gdp|unemploy|market|trade|sanction|export|import|shekel|inflation|tax)\b/i],
  ['economic',    /(اقتصاد|بطالة|تجارة|عقوبات|صادرات|استيراد|شيكل|تضخم|ضرائب)/],
  ['settlements', /\b(settler|settlement|outpost|demolition|eviction|annex)\b/i],
  ['settlements', /(مستوطن|مستوطنة|بؤرة|هدم|إخلاء|ضم)/],
  ['prisoners',   /\b(prisoner|detain|administrative detention|hunger strike|addameer)\b/i],
  ['prisoners',   /(أسير|أسرى|اعتقال إداري|إضراب عن الطعام|معتقل)/],
  ['legal',       /\b(ICJ|ICC|war crime|apartheid|geneva|tribunal|genocide)\b/i],
  ['legal',       /(محكمة العدل|الجنائية الدولية|جرائم حرب|فصل عنصري|إبادة)/],
];

function classifyTopics(title, description, body) {
  const text = `${title || ''}\n${description || ''}\n${body || ''}`;
  const topics = new Set();
  for (const [topic, re] of TOPIC_RULES) {
    if (re.test(text)) topics.add(topic);
  }
  if (topics.size === 0) topics.add('general');
  return [...topics];
}

function deriveSeverity(topics, text) {
  const t = text.toLowerCase();
  const criticalRe = /(killed|death toll|massacre|إبادة|مجزرة|استشهاد|famine|starvation|مجاعة|airstrike|قصف جوي)/i;
  const highRe = /(raid|wounded|injured|غارة|اقتحام|جريح|إصابة|demolition|هدم|displace|نزوح)/i;
  if (criticalRe.test(text)) return 'critical';
  if (topics.includes('conflict') && highRe.test(text)) return 'high';
  if (topics.includes('conflict') || topics.includes('humanitarian')) return 'medium';
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity extraction (cities/governorates from known_locations.json)
// ─────────────────────────────────────────────────────────────────────────────
let LOCATIONS = null;
let LOCATION_INDEX = null;

async function loadLocations() {
  try {
    const raw = await fs.readFile(LOCATIONS_PATH, 'utf8');
    LOCATIONS = JSON.parse(raw);
  } catch (e) {
    await logger.warn(`known_locations.json not readable: ${e.message}`);
    LOCATIONS = [];
  }
  LOCATION_INDEX = [];
  for (const loc of LOCATIONS) {
    const names = new Set([loc.name_en, loc.name_ar, ...(loc.aliases || [])].filter(Boolean));
    for (const n of names) {
      LOCATION_INDEX.push({
        needle: n.toLowerCase(),
        canonical: loc.canonical_key,
        name_en: loc.name_en,
        name_ar: loc.name_ar,
      });
    }
  }
}

function extractEntities(title, description, body) {
  const text = `${title || ''} ${description || ''} ${body || ''}`.toLowerCase();
  const hits = new Map();
  for (const { needle, canonical, name_en, name_ar } of LOCATION_INDEX) {
    if (needle.length < 3) continue;
    if (text.includes(needle)) {
      hits.set(canonical, { canonical, name_en, name_ar });
    }
  }
  return [...hits.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────────
async function fetchFeed(feed) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PalestineDataBackend/2.0; +news-collector)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

function guidHash(feed, item) {
  const basis = (item.rawGuid || item.link || item.title || '') + '|' + feed.id;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

function normalizeDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────────────────────────────────────
async function runOnce(db, sources) {
  const startedAt = new Date().toISOString();
  const runStmt = db.prepare(
    'INSERT INTO fetch_runs (started_at, feeds_attempted, feeds_ok, articles_seen, articles_new) VALUES (?, 0, 0, 0, 0)'
  );
  const runInfo = runStmt.run(startedAt);
  const runId = Number(runInfo.lastInsertRowid);

  let feedsAttempted = 0, feedsOk = 0, articlesSeen = 0, articlesNew = 0;
  const errors = [];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO articles
      (guid_hash, source_id, source_name, language, reliability, category,
       title, link, description, body, author, published_at, fetched_at,
       topics, entities, severity, palestine_relevant, raw_guid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const feed of sources) {
    feedsAttempted++;
    try {
      const xml = await fetchFeed(feed);
      const items = parseFeed(xml);
      feedsOk++;
      await logger.info(`${feed.name}: ${items.length} items`);

      for (const item of items) {
        if (!item.title) continue;
        articlesSeen++;
        const relevant = isPalestineRelevant(item.title, item.description || item.body);
        if (!relevant) continue;

        const topics = classifyTopics(item.title, item.description, item.body);
        const severity = deriveSeverity(
          topics,
          `${item.title || ''} ${item.description || ''} ${item.body || ''}`
        );
        const entities = extractEntities(item.title, item.description, item.body);

        const info = insert.run(
          guidHash(feed, item),
          feed.id,
          feed.name,
          feed.language,
          feed.reliability,
          feed.category || null,
          item.title,
          item.link,
          item.description,
          item.body,
          item.author,
          normalizeDate(item.published),
          new Date().toISOString(),
          JSON.stringify(topics),
          JSON.stringify(entities),
          severity,
          1,
          item.rawGuid
        );
        if (info.changes > 0) articlesNew++;
      }
    } catch (e) {
      errors.push(`${feed.id}: ${e.message}`);
      await logger.warn(`${feed.name} failed: ${e.message}`);
    }
    await sleep(FEED_DELAY_MS);
  }

  db.prepare(
    'UPDATE fetch_runs SET finished_at=?, feeds_attempted=?, feeds_ok=?, articles_seen=?, articles_new=?, errors=? WHERE id=?'
  ).run(
    new Date().toISOString(),
    feedsAttempted,
    feedsOk,
    articlesSeen,
    articlesNew,
    errors.length ? JSON.stringify(errors) : null,
    runId
  );

  await logger.success(
    `run #${runId} done: feeds ${feedsOk}/${feedsAttempted}, articles seen=${articlesSeen}, new=${articlesNew}, errors=${errors.length}`
  );
  return { feedsAttempted, feedsOk, articlesSeen, articlesNew, errors };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const once = args.has('--once');

  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  initDb(db);

  const sources = JSON.parse(await fs.readFile(SOURCES_PATH, 'utf8')).feeds;
  await loadLocations();
  await logger.info(`loaded ${sources.length} feeds, ${LOCATIONS.length} locations → db ${DB_PATH}`);

  // graceful shutdown for daemon mode
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await runOnce(db, sources);
  if (once) { db.close(); return; }

  await logger.info(`daemon mode — interval ${Math.round(FETCH_INTERVAL_MS / 1000)}s`);
  while (!stopping) {
    // sleep in 1s chunks so SIGTERM cuts through quickly
    const until = Date.now() + FETCH_INTERVAL_MS;
    while (!stopping && Date.now() < until) await sleep(1000);
    if (stopping) break;
    try { await runOnce(db, sources); }
    catch (e) { await logger.error(`run failed: ${e.message}`, e); }
  }
  db.close();
  await logger.info('stopped');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    await logger.error('fatal', e);
    process.exit(1);
  });
}

export { runOnce, initDb };
