import request from 'supertest';
import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Isolated keys.db for this run — set BEFORE importing anything that opens it.
const TMP_DB = path.join(os.tmpdir(), `pdb-access-test-${process.pid}.db`);
process.env.KEYS_DB_PATH = TMP_DB;
delete process.env.NTFY_TOPIC; // no real push during tests

jest.unstable_mockModule('../src/api/services/searchService.js', () => ({
    __esModule: true,
    initializeSearch: () => { },
    search: () => [],
    isSearchReady: () => true,
}));

const { default: app } = await import('../src/api/server.js');
const { listAccessRequests } = await import('../src/api/services/keyStore.js');

afterAll(() => {
    for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
    }
});

describe('POST /api/v1/access-request', () => {
    it('stores a valid request and returns 201', async () => {
        const res = await request(app)
            .post('/api/v1/access-request')
            .send({ name: 'Reporter', org: 'Newsroom', email: 'a@b.com', tier: 'journalist', use_case: 'live map' });
        expect(res.statusCode).toBe(201);
        expect(res.body.ok).toBe(true);
        expect(res.body.notified).toBe(false); // NTFY_TOPIC unset → skipped, not failed
        const rows = listAccessRequests();
        expect(rows.some((r) => r.email === 'a@b.com' && r.tier === 'journalist')).toBe(true);
    });

    it('rejects an invalid email with 400', async () => {
        const res = await request(app).post('/api/v1/access-request').send({ email: 'not-an-email' });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('invalid_email');
    });

    it('coerces an unknown tier to "other"', async () => {
        const res = await request(app).post('/api/v1/access-request').send({ email: 'c@d.com', tier: 'platinum' });
        expect(res.statusCode).toBe(201);
        expect(listAccessRequests().find((r) => r.email === 'c@d.com').tier).toBe('other');
    });

    it('silently drops honeypot submissions without storing', async () => {
        const before = listAccessRequests().length;
        const res = await request(app)
            .post('/api/v1/access-request')
            .send({ email: 'bot@spam.com', website: 'http://spam' });
        expect(res.statusCode).toBe(201);
        expect(listAccessRequests().length).toBe(before);
    });
});
