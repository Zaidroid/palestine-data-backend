/**
 * POST /api/v1/access-request — the pricing-page "request access" funnel.
 *
 * Persists the request to keys.db (survives redeploys) and pings Zaid's ntfy
 * topic so it lands on his phone. Dependency-free: uses global fetch. The ntfy
 * topic is read from env; if unset the request is still stored (funnel never
 * drops a lead) and the push is simply skipped — we never hard-code a topic.
 *
 * Already rate-limited by the global anonymous tier limiter (server.js).
 */
import express from 'express';
import { createAccessRequest } from '../services/keyStore.js';

const router = express.Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Tier the requester is asking for. Kept loose ('other' fallback) — the display
// names on pricing.html map to key tiers at issuance time, not here.
const VALID_TIERS = new Set([
    'researcher', 'journalist', 'organization', 'org_alerts', 'enterprise', 'other',
]);

async function notifyZaid(row) {
    const topic = process.env.NTFY_TOPIC;
    if (!topic) return { sent: false, reason: 'NTFY_TOPIC unset' };
    const base = process.env.NTFY_URL || 'https://ntfy.sh';
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        await fetch(`${base}/${topic}`, {
            method: 'POST',
            headers: {
                Title: `PDB access request: ${row.org || row.email}`,
                Tags: 'moneybag',
                Priority: 'high',
            },
            body:
                `${row.name || '(no name)'} <${row.email}>\n` +
                `Org:  ${row.org || '-'}\n` +
                `Tier: ${row.tier}\n` +
                `Use:  ${row.use_case || '-'}`,
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return { sent: true };
    } catch (e) {
        return { sent: false, reason: e.message };
    }
}

router.post('/', async (req, res) => {
    const { name, org, email, tier, use_case, website } = req.body || {};

    // Honeypot: bots fill hidden fields. Accept silently, store nothing.
    if (website) return res.status(201).json({ ok: true, message: 'Request received.' });

    if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({
            error: 'invalid_email',
            message: 'A valid email address is required.',
        });
    }

    const t = String(tier || 'other').toLowerCase();
    const clip = (v, n) => (v ? String(v).slice(0, n) : null);

    let row;
    try {
        row = createAccessRequest({
            name: clip(name, 200),
            org: clip(org, 200),
            email: email.slice(0, 200),
            tier: VALID_TIERS.has(t) ? t : 'other',
            use_case: clip(use_case, 2000),
            ip: req.ip || null,
        });
    } catch {
        return res.status(500).json({ error: 'store_failed' });
    }

    const notify = await notifyZaid(row);
    res.status(201).json({
        ok: true,
        id: row.id,
        message: "Request received. You'll get an answer and a trial key within two working days.",
        notified: notify.sent,
    });
});

export default router;
