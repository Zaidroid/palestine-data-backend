import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../..');

const DB_PATH =
  process.env.NEWS_DB_PATH ||
  path.resolve(ROOT, 'services/westbank-alerts/data/news.db');

// Lazy-open (DB may not exist until collector runs once).
// Open RW because WAL-mode DBs need to touch -shm/-wal; api never writes rows.
let _db = null;
function db() {
  if (_db) return _db;
  try {
    _db = new DatabaseSync(DB_PATH);
  } catch (e) {
    return null;
  }
  return _db;
}

function parseJSONSafe(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
function rowToArticle(r) {
  return {
    id: r.id,
    source_id: r.source_id,
    source_name: r.source_name,
    language: r.language,
    reliability: r.reliability,
    category: r.category,
    title: r.title,
    link: r.link,
    description: r.description,
    body: r.body,
    author: r.author,
    published_at: r.published_at,
    fetched_at: r.fetched_at,
    topics: parseJSONSafe(r.topics) || [],
    entities: parseJSONSafe(r.entities) || [],
    severity: r.severity,
  };
}

const router = express.Router();

// GET /api/v1/news/latest
// Query: limit, offset, source, language, topic, severity, q, since
router.get('/latest', (req, res) => {
  const d = db();
  if (!d) return res.json({ count: 0, articles: [], note: 'news.db not yet available' });

  const limit  = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { source, language, topic, severity, q, since } = req.query;

  const where = ['palestine_relevant = 1'];
  const params = [];
  if (source)   { where.push('source_id = ?');            params.push(source); }
  if (language) { where.push('language = ?');             params.push(language); }
  if (severity) { where.push('severity = ?');             params.push(severity); }
  if (topic)    { where.push('topics LIKE ?');            params.push(`%"${topic}"%`); }
  if (since)    { where.push('published_at >= ?');        params.push(since); }
  if (q) {
    where.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const sql = `
    SELECT * FROM articles
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(published_at, fetched_at) DESC
    LIMIT ? OFFSET ?`;
  try {
    const rows = d.prepare(sql).all(...params, limit, offset);
    const total = d.prepare(`SELECT COUNT(*) as c FROM articles WHERE ${where.join(' AND ')}`).get(...params).c;
    res.json({
      count: rows.length,
      total,
      limit,
      offset,
      articles: rows.map(rowToArticle),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v1/news/sources — per-source counts, latest pub date, reliability
router.get('/sources', (req, res) => {
  const d = db();
  if (!d) return res.json({ sources: [] });
  try {
    const rows = d.prepare(`
      SELECT source_id, source_name, language, reliability,
             COUNT(*) AS article_count,
             MAX(published_at) AS latest_published,
             MAX(fetched_at)   AS latest_fetched
      FROM articles
      GROUP BY source_id
      ORDER BY article_count DESC
    `).all();
    res.json({ sources: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v1/news/stats — aggregate overview
router.get('/stats', (req, res) => {
  const d = db();
  if (!d) return res.json({ total: 0, by_language: {}, by_severity: {}, last_fetch: null });
  try {
    const total = d.prepare('SELECT COUNT(*) c FROM articles').get().c;
    const by_language = Object.fromEntries(
      d.prepare('SELECT language, COUNT(*) c FROM articles GROUP BY language').all().map(r => [r.language, r.c])
    );
    const by_severity = Object.fromEntries(
      d.prepare('SELECT severity, COUNT(*) c FROM articles GROUP BY severity').all().map(r => [r.severity, r.c])
    );
    const last_run = d.prepare('SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 1').get() || null;
    const topics_raw = d.prepare('SELECT topics FROM articles WHERE topics IS NOT NULL').all();
    const by_topic = {};
    for (const r of topics_raw) {
      for (const t of (parseJSONSafe(r.topics) || [])) by_topic[t] = (by_topic[t] || 0) + 1;
    }
    const last_24h = d.prepare(
      "SELECT COUNT(*) c FROM articles WHERE fetched_at >= datetime('now','-1 day')"
    ).get().c;
    res.json({
      total,
      last_24h,
      by_language,
      by_severity,
      by_topic,
      last_fetch: last_run,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v1/news/:id
router.get('/:id', (req, res) => {
  const d = db();
  if (!d) return res.status(404).json({ error: 'news.db not available' });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const row = d.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(rowToArticle(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
