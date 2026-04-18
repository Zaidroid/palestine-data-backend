import express from 'express';
import Stripe from 'stripe';
import { getKeyById } from '../services/keyStore.js';
import { TIERS } from '../config/tiers.js';

const router = express.Router();

// Stripe is optional. Routes return 503 with a clear message until env is set.
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const portalReturnUrl = process.env.STRIPE_PORTAL_RETURN_URL;
const checkoutSuccessUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL;
const checkoutCancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL;

const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2025-01-27.acacia' }) : null;

// Map Stripe Price IDs (set in env) → tier names. Webhook reads the active price
// off the subscription and looks up the matching tier here.
const priceTierMap = {
    [process.env.STRIPE_PRICE_JOURNALIST]: 'journalist',
    [process.env.STRIPE_PRICE_NGO]: 'ngo',
    [process.env.STRIPE_PRICE_ENTERPRISE]: 'enterprise',
};

function ensureStripe(res) {
    if (stripe) return true;
    res.status(503).json({
        error: 'billing_unconfigured',
        message: 'STRIPE_SECRET_KEY is not set on this server. Billing is disabled.',
    });
    return false;
}

function requireKey(req, res) {
    if (req.customer?.keyId) return true;
    res.status(401).json({ error: 'authentication_required' });
    return false;
}

router.post('/checkout', express.json(), async (req, res) => {
    if (!ensureStripe(res)) return;
    if (!requireKey(req, res)) return;

    const { tier } = req.body || {};
    if (!tier || !TIERS[tier]) {
        return res.status(400).json({ error: 'invalid_tier', valid: Object.keys(TIERS) });
    }
    const priceId =
        tier === 'journalist'
            ? process.env.STRIPE_PRICE_JOURNALIST
            : tier === 'ngo'
              ? process.env.STRIPE_PRICE_NGO
              : tier === 'enterprise'
                ? process.env.STRIPE_PRICE_ENTERPRISE
                : null;
    if (!priceId) {
        return res.status(400).json({ error: 'tier_not_purchasable_here', tier });
    }

    const key = getKeyById(req.customer.keyId);
    if (!key) return res.status(404).json({ error: 'key_not_found' });

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            customer_email: key.email,
            client_reference_id: String(key.id),
            success_url: checkoutSuccessUrl || 'https://example.com/success',
            cancel_url: checkoutCancelUrl || 'https://example.com/cancel',
        });
        res.json({ url: session.url, session_id: session.id });
    } catch (e) {
        (req.log || console).error({ err: e }, 'stripe_checkout_failed');
        res.status(502).json({ error: 'stripe_checkout_failed', detail: e.message });
    }
});

router.get('/portal', async (req, res) => {
    if (!ensureStripe(res)) return;
    if (!requireKey(req, res)) return;

    const key = getKeyById(req.customer.keyId);
    if (!key) return res.status(404).json({ error: 'key_not_found' });

    try {
        const customers = await stripe.customers.list({ email: key.email, limit: 1 });
        const stripeCustomer = customers.data[0];
        if (!stripeCustomer) {
            return res.status(404).json({ error: 'no_stripe_customer_for_email' });
        }
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomer.id,
            return_url: portalReturnUrl || 'https://example.com/account',
        });
        res.json({ url: session.url });
    } catch (e) {
        (req.log || console).error({ err: e }, 'stripe_portal_failed');
        res.status(502).json({ error: 'stripe_portal_failed', detail: e.message });
    }
});

// Webhook needs the raw body for signature verification.
router.post(
    '/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        if (!stripe || !webhookSecret) {
            return res.status(503).send('billing not configured');
        }
        let event;
        try {
            event = stripe.webhooks.constructEvent(
                req.body,
                req.headers['stripe-signature'],
                webhookSecret
            );
        } catch (err) {
            (req.log || console).error({ err }, 'stripe_webhook_signature_failed');
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            await handleStripeEvent(event);
            res.json({ received: true });
        } catch (e) {
            (req.log || console).error({ err: e, type: event.type }, 'stripe_webhook_handle_failed');
            res.status(500).send('handler error');
        }
    }
);

async function handleStripeEvent(event) {
    // Lazy import to avoid pulling DB into module top-level (matters for tests).
    const { default: Database } = await import('better-sqlite3');
    const dbPath = process.env.KEYS_DB_PATH || './data/keys.db';
    const db = new Database(dbPath);

    const setTier = db.prepare(`UPDATE api_keys SET tier = ?, active = 1 WHERE id = ?`);
    const deactivate = db.prepare(`UPDATE api_keys SET active = 0 WHERE id = ?`);

    switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
            const sub = event.data.object;
            const priceId = sub.items?.data?.[0]?.price?.id;
            const tier = priceTierMap[priceId];
            const keyId = Number(sub.metadata?.key_id || sub.client_reference_id || 0);
            if (tier && keyId) setTier.run(tier, keyId);
            break;
        }
        case 'customer.subscription.deleted': {
            const sub = event.data.object;
            const keyId = Number(sub.metadata?.key_id || sub.client_reference_id || 0);
            if (keyId) deactivate.run(keyId);
            break;
        }
        default:
            // Ignore other event types.
            break;
    }
    db.close();
}

router.get('/status', (req, res) => {
    res.json({
        configured: Boolean(stripe),
        webhook_configured: Boolean(webhookSecret),
        prices: {
            journalist: Boolean(process.env.STRIPE_PRICE_JOURNALIST),
            ngo: Boolean(process.env.STRIPE_PRICE_NGO),
            enterprise: Boolean(process.env.STRIPE_PRICE_ENTERPRISE),
        },
    });
});

export default router;
