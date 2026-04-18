import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.resolve(__dirname, '../../../data/keys.db');
const DB_PATH = process.env.KEYS_DB_PATH || DEFAULT_DB_PATH;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    stripe_customer_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER,
    tier TEXT NOT NULL,
    route TEXT NOT NULL,
    status INTEGER NOT NULL,
    bytes INTEGER,
    ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_key_ts ON usage_events(key_id, ts);

CREATE TABLE IF NOT EXISTS usage_daily (
    key_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, date)
);
`;

let _db = null;

function getDb() {
    if (_db) return _db;
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.exec(SCHEMA);
    return _db;
}

export function hashKey(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateKey() {
    const raw = `pdb_live_${crypto.randomBytes(16).toString('hex')}`;
    return { raw, hash: hashKey(raw), prefix: raw.slice(0, 13) };
}

export function upsertCustomer({ email, name = null }) {
    return getDb()
        .prepare(
            `INSERT INTO customers (email, name) VALUES (?, ?)
             ON CONFLICT(email) DO UPDATE SET name = COALESCE(excluded.name, customers.name)
             RETURNING id, email, name`
        )
        .get(email, name);
}

export function issueApiKey({ customerId, tier = 'free' }) {
    const { raw, hash, prefix } = generateKey();
    const info = getDb()
        .prepare(
            'INSERT INTO api_keys (customer_id, key_hash, key_prefix, tier) VALUES (?, ?, ?, ?) RETURNING id'
        )
        .get(customerId, hash, prefix, tier);
    return { raw, id: info.id, prefix, tier };
}

export function findByRawKey(raw) {
    if (!raw) return null;
    const row = getDb()
        .prepare('SELECT id, customer_id, tier, active FROM api_keys WHERE key_hash = ?')
        .get(hashKey(raw));
    if (!row || !row.active) return null;
    return row;
}

export function touchKey(id) {
    try {
        getDb().prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(id);
    } catch {
        // Non-fatal: metrics write
    }
}

export function logUsage({ keyId, tier, route, status, bytes }) {
    try {
        getDb()
            .prepare(
                'INSERT INTO usage_events (key_id, tier, route, status, bytes) VALUES (?, ?, ?, ?, ?)'
            )
            .run(keyId ?? null, tier, route, status, bytes ?? null);
    } catch {
        // Fire-and-forget: usage logging never blocks the request path
    }
}

export function getKeyById(id) {
    return getDb()
        .prepare(
            `SELECT k.id, k.customer_id, k.tier, k.active, k.key_prefix,
                    k.created_at, k.last_used_at, c.email
             FROM api_keys k JOIN customers c ON c.id = k.customer_id
             WHERE k.id = ?`
        )
        .get(id);
}

// Aggregate usage_events for a single key, for the rolling current-month window.
// Falls back to scanning usage_events when usage_daily hasn't been rolled up yet.
export function getCurrentMonthUsage(keyId) {
    const db = getDb();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartIso = monthStart.toISOString().slice(0, 10);

    const fromDaily = db
        .prepare(
            `SELECT COALESCE(SUM(count), 0) AS count, COALESCE(SUM(bytes), 0) AS bytes
             FROM usage_daily
             WHERE key_id = ? AND date >= ?`
        )
        .get(keyId, monthStartIso);

    // Add today's not-yet-rolled-up events.
    const today = new Date().toISOString().slice(0, 10);
    const fromEventsToday = db
        .prepare(
            `SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes
             FROM usage_events
             WHERE key_id = ? AND substr(ts, 1, 10) = ?`
        )
        .get(keyId, today);

    return {
        period_start: monthStartIso,
        count: (fromDaily.count || 0) + (fromEventsToday.count || 0),
        bytes: (fromDaily.bytes || 0) + (fromEventsToday.bytes || 0),
    };
}

export function rollupYesterday() {
    const db = getDb();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = db
        .prepare(
            `SELECT key_id, COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes
             FROM usage_events
             WHERE substr(ts, 1, 10) = ? AND key_id IS NOT NULL
             GROUP BY key_id`
        )
        .all(yesterday);

    const upsert = db.prepare(
        `INSERT INTO usage_daily (key_id, date, count, bytes) VALUES (?, ?, ?, ?)
         ON CONFLICT(key_id, date) DO UPDATE SET
             count = excluded.count, bytes = excluded.bytes`
    );
    const tx = db.transaction((items) => {
        for (const r of items) upsert.run(r.key_id, yesterday, r.count, r.bytes);
    });
    tx(rows);

    // Once rolled up, prune the raw events for that day to keep the table small.
    db.prepare(`DELETE FROM usage_events WHERE substr(ts, 1, 10) = ?`).run(yesterday);

    return { date: yesterday, keys_rolled_up: rows.length };
}

export const _paths = { DB_PATH };
