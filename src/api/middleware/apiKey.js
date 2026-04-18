import { findByRawKey, touchKey, logUsage } from '../services/keyStore.js';

const BEARER_RE = /^Bearer\s+(pdb_live_[a-f0-9]{32})$/;
const ANON = Object.freeze({ tier: 'anonymous' });

export function apiKey(req, res, next) {
    const header = req.headers['authorization'] || '';
    const match = header.match(BEARER_RE);
    const raw = match ? match[1] : null;
    const record = raw ? findByRawKey(raw) : null;

    if (record) {
        req.customer = { id: record.customer_id, keyId: record.id, tier: record.tier };
        touchKey(record.id);
    } else {
        req.customer = ANON;
    }

    res.on('finish', () => {
        const bytes = parseInt(res.getHeader('content-length') || '0', 10) || null;
        logUsage({
            keyId: req.customer.keyId ?? null,
            tier: req.customer.tier,
            route: req.route?.path || req.baseUrl + req.path,
            status: res.statusCode,
            bytes,
        });
    });

    next();
}
