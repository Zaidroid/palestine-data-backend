import { RateLimiterMemory } from 'rate-limiter-flexible';
import { TIERS } from '../config/tiers.js';

function makeLimiter(points, durationSeconds) {
    if (!points) return null;
    return new RateLimiterMemory({ points, duration: durationSeconds });
}

// One short-window (per-minute) limiter per tier. In-memory is fine for a
// single-instance home-server deployment; swap to RateLimiterRedis later.
const minuteLimiters = Object.fromEntries(
    Object.entries(TIERS).map(([tier, def]) => [tier, makeLimiter(def.rpm, 60)])
);

// Daily limiter only enforced for tiers with a `daily` cap (currently anon + free).
const dailyLimiters = Object.fromEntries(
    Object.entries(TIERS)
        .filter(([, def]) => def.daily)
        .map(([tier, def]) => [tier, makeLimiter(def.daily, 24 * 60 * 60)])
);

function consumerKey(req) {
    if (req.customer?.keyId) return `key:${req.customer.keyId}`;
    return `ip:${req.ip}`;
}

function setHeaders(res, result, limit, headerPrefix) {
    if (!result || limit == null) return;
    res.setHeader(`X-RateLimit-${headerPrefix}-Limit`, limit);
    res.setHeader(`X-RateLimit-${headerPrefix}-Remaining`, Math.max(0, result.remainingPoints));
    res.setHeader(`X-RateLimit-${headerPrefix}-Reset`, Math.ceil(result.msBeforeNext / 1000));
}

export function tieredRateLimit(req, res, next) {
    const tier = req.customer?.tier || 'anonymous';
    const key = consumerKey(req);

    const minute = minuteLimiters[tier] || minuteLimiters.anonymous;
    const daily = dailyLimiters[tier] || null;
    const tierDef = TIERS[tier] || TIERS.anonymous;

    Promise.all([
        minute ? minute.consume(key, 1) : Promise.resolve(null),
        daily ? daily.consume(key, 1) : Promise.resolve(null),
    ])
        .then(([m, d]) => {
            setHeaders(res, m, tierDef.rpm, 'Minute');
            setHeaders(res, d, tierDef.daily, 'Daily');
            next();
        })
        .catch((rejection) => {
            const retryAfter = Math.ceil((rejection.msBeforeNext || 1000) / 1000);
            res.setHeader('Retry-After', retryAfter);
            res.setHeader('X-RateLimit-Tier', tier);
            res.status(429).json({
                error: 'rate_limited',
                tier,
                retry_after_seconds: retryAfter,
                message: `Tier "${tier}" rate limit exceeded. Upgrade tier or retry after ${retryAfter}s.`,
            });
        });
}
