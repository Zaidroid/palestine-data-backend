/**
 * Tier definitions for API access.
 *
 * `rpm`     — short-window burst protection (per minute)
 * `monthly` — soft monthly cap (enforced via usage_daily rollup; null = unlimited)
 * `daily`   — hard daily cap for anonymous traffic (per IP)
 * `price_usd_monthly` — public sticker price
 *
 * Anonymous traffic falls into `anonymous` (per-IP). Authenticated traffic
 * uses the customer's tier from api_keys.tier.
 */
export const TIERS = Object.freeze({
    anonymous: {
        rpm: 10,
        daily: 1000,
        monthly: null,
        price_usd_monthly: 0,
        description: 'Anonymous (per-IP). Strict limits to keep the public surface usable.',
    },
    free: {
        rpm: 30,
        daily: 5000,
        monthly: 100_000,
        price_usd_monthly: 0,
        description: 'Free (registered). Higher daily ceiling than anonymous; one key.',
    },
    journalist: {
        rpm: 60,
        daily: null,
        monthly: 50_000,
        price_usd_monthly: 29,
        description: 'Journalist tier — solo reporters and freelance newsrooms.',
    },
    ngo: {
        rpm: 300,
        daily: null,
        monthly: 500_000,
        price_usd_monthly: 149,
        description: 'NGO tier — humanitarian and research organizations.',
    },
    enterprise: {
        rpm: 1500,
        daily: null,
        monthly: null,
        price_usd_monthly: null,
        description: 'Enterprise — custom contract; rate limits effectively unlimited.',
    },
});

export function getTier(name) {
    return TIERS[name] || TIERS.anonymous;
}

export function tierList() {
    return Object.entries(TIERS).map(([id, def]) => ({ id, ...def }));
}
