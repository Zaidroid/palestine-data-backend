import request from 'supertest';
import { jest } from '@jest/globals';

// Mock the search service BEFORE importing the app
jest.unstable_mockModule('../src/api/services/searchService.js', () => {
    return {
        __esModule: true,
        initializeSearch: () => { },
        search: () => [],
        isSearchReady: () => true,
    };
});

// Import app dynamically after mocking
const { default: app } = await import('../src/api/server.js');

describe('API Endpoints', () => {
    describe('GET /api/v1/health', () => {
        it('should return 200 OK', async () => {
            const res = await request(app).get('/api/v1/health');
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('status', 'ok');
        });
    });

    describe('GET /api/v1/unified/conflict', () => {
        it('should return 200 or 404 depending on data existence', async () => {
            const res = await request(app).get('/api/v1/unified/conflict');
            expect([200, 404]).toContain(res.statusCode);
        });

        it('should return 404 for unknown category', async () => {
            const res = await request(app).get('/api/v1/unified/unknown-category');
            expect(res.statusCode).toEqual(404);
        });
    });

    describe('GET /api/v1/search', () => {
        it('should return 200 for search query', async () => {
            const res = await request(app).get('/api/v1/search?q=gaza');
            expect(res.statusCode).toEqual(200);
            expect(Array.isArray(res.body.results)).toBe(true);
        });

        it('should return 400 if query is missing', async () => {
            const res = await request(app).get('/api/v1/search');
            expect(res.statusCode).toEqual(400);
        });
    });
});
