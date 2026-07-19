"""Tiered per-minute rate limiting for the alerts API.

Mirrors src/api/middleware/rateLimit.js on the Node side: one fixed per-minute
window per consumer, keyed by API-key id when present (set by ApiKeyMiddleware)
or by client IP for anonymous traffic. In-memory is fine for the single-instance
home-server deployment.

Runs AFTER ApiKeyMiddleware (which tags request.state.customer) so it can read
the customer's tier. Liveness, static info pages and long-lived SSE streams are
exempt — throttling a browser's heartbeat or the public map's poll would break
the safety feed, which is the opposite of the point.
"""

import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ..tiers import tier_rpm

# Exact paths never rate-limited: liveness + the static info/landing surfaces.
_EXEMPT_EXACT = {
    "/",
    "/health",
    "/dashboard",
    "/tracker",
    "/map",
    "/go",
    "/api",
    "/notifications/vapid-public-key",
}


def _is_exempt(path: str, method: str) -> bool:
    if method == "OPTIONS":  # CORS preflight
        return True
    if path in _EXEMPT_EXACT:
        return True
    # SSE streams are single long-lived connections, not per-request traffic.
    if path == "/stream" or path.endswith("/stream"):
        return True
    return False


def _consumer(request):
    """Return (bucket_key, tier). Keyed by API-key id when authenticated, else
    by client IP (honouring the cloudflared X-Forwarded-For chain)."""
    cust = getattr(request.state, "customer", None) or {}
    tier = cust.get("tier", "anonymous")
    key_id = cust.get("key_id")
    if key_id is not None:
        return f"key:{key_id}", tier
    xff = request.headers.get("x-forwarded-for")
    if xff:
        ip = xff.split(",")[0].strip()
    elif request.client:
        ip = request.client.host
    else:
        ip = "unknown"
    return f"ip:{ip}", tier


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, clock=time.time):
        super().__init__(app)
        self._clock = clock
        self._buckets = {}  # bucket_key -> [window_minute, count]

    def _prune(self, window):
        if len(self._buckets) <= 5000:
            return
        for k in [k for k, v in self._buckets.items() if v[0] < window]:
            del self._buckets[k]

    async def dispatch(self, request, call_next):
        if _is_exempt(request.url.path, request.method):
            return await call_next(request)

        ckey, tier = _consumer(request)
        rpm = tier_rpm(tier)
        if rpm is None:  # enterprise / unlimited
            return await call_next(request)

        now = self._clock()
        window = int(now // 60)
        bucket = self._buckets.get(ckey)
        if bucket is None or bucket[0] != window:
            self._prune(window)
            bucket = self._buckets[ckey] = [window, 0]
        bucket[1] += 1

        if bucket[1] > rpm:
            retry = 60 - int(now % 60)
            resp = JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limited",
                    "tier": tier,
                    "retry_after_seconds": retry,
                    "message": (
                        f'Tier "{tier}" rate limit exceeded ({rpm}/min). '
                        f"Retry after {retry}s, or use a higher-tier API key."
                    ),
                },
            )
            resp.headers["Retry-After"] = str(retry)
            resp.headers["X-RateLimit-Limit"] = str(rpm)
            resp.headers["X-RateLimit-Remaining"] = "0"
            resp.headers["X-RateLimit-Tier"] = tier
            return resp

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(rpm)
        response.headers["X-RateLimit-Remaining"] = str(max(0, rpm - bucket[1]))
        response.headers["X-RateLimit-Tier"] = tier
        return response
