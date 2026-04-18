import express from 'express';
import { getKeyById, getCurrentMonthUsage } from '../services/keyStore.js';
import { getTier } from '../config/tiers.js';

const router = express.Router();

function requireAuth(req, res, next) {
    if (!req.customer || !req.customer.keyId) {
        return res.status(401).json({
            error: 'authentication_required',
            message: 'This endpoint requires a customer API key. Send `Authorization: Bearer pdb_live_<key>`.',
        });
    }
    next();
}

router.get('/usage', requireAuth, (req, res) => {
    const key = getKeyById(req.customer.keyId);
    if (!key) return res.status(404).json({ error: 'key_not_found' });

    const tier = getTier(key.tier);
    const usage = getCurrentMonthUsage(key.id);

    res.json({
        key: {
            id: key.id,
            prefix: key.key_prefix,
            tier: key.tier,
            email: key.email,
            created_at: key.created_at,
            last_used_at: key.last_used_at,
        },
        tier_limits: {
            rpm: tier.rpm,
            daily: tier.daily,
            monthly: tier.monthly,
        },
        current_period: {
            start: usage.period_start,
            requests: usage.count,
            bytes: usage.bytes,
            monthly_remaining: tier.monthly == null ? null : Math.max(0, tier.monthly - usage.count),
        },
    });
});

export default router;
