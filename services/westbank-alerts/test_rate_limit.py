"""Tiered rate limiting for the alerts API (P5 Step 5 prerequisite).

The public safety feed stays generous; paid keys buy a higher ceiling; exempt
paths (liveness, SSE) are never limited. A frozen clock makes the per-minute
window deterministic.

Run:  pytest test_rate_limit.py -v
"""
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.middleware.rate_limit import RateLimitMiddleware
from app.tiers import tier_rpm


class FrozenClock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def _app(customer, clock):
    async def ok(request):
        return PlainTextResponse("ok")

    routes = [
        Route("/alerts", ok),
        Route("/health", ok),
        Route("/checkpoints/stream", ok),
    ]
    app = Starlette(routes=routes)

    class InjectCustomer(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            request.state.customer = customer
            return await call_next(request)

    # RateLimit inner, InjectCustomer outer (runs first → sets customer).
    app.add_middleware(RateLimitMiddleware, clock=clock)
    app.add_middleware(InjectCustomer)
    return TestClient(app)


def test_anonymous_limited_at_ceiling():
    client = _app({"tier": "anonymous"}, FrozenClock())
    rpm = tier_rpm("anonymous")
    for i in range(rpm):
        assert client.get("/alerts").status_code == 200, i
    r = client.get("/alerts")
    assert r.status_code == 429
    assert r.json()["error"] == "rate_limited"
    assert r.headers["X-RateLimit-Tier"] == "anonymous"
    assert int(r.headers["Retry-After"]) >= 1


def test_higher_tier_gets_higher_ceiling():
    # ngo (keyed) tolerates far more than an anonymous IP would.
    client = _app({"tier": "ngo", "key_id": 7}, FrozenClock())
    for i in range(tier_rpm("anonymous") + 50):
        assert client.get("/alerts").status_code == 200, i


def test_enterprise_unlimited_no_headers():
    client = _app({"tier": "enterprise", "key_id": 1}, FrozenClock())
    for _ in range(2000):
        assert client.get("/alerts").status_code == 200
    assert "X-RateLimit-Limit" not in client.get("/alerts").headers


def test_exempt_paths_never_limited():
    client = _app({"tier": "anonymous"}, FrozenClock())
    for _ in range(tier_rpm("anonymous") + 20):
        assert client.get("/health").status_code == 200
        assert client.get("/checkpoints/stream").status_code == 200


def test_window_resets_next_minute():
    clock = FrozenClock()
    client = _app({"tier": "anonymous"}, clock)
    rpm = tier_rpm("anonymous")
    for _ in range(rpm):
        assert client.get("/alerts").status_code == 200
    assert client.get("/alerts").status_code == 429
    clock.t += 61  # advance past the window
    assert client.get("/alerts").status_code == 200


def test_separate_ips_get_separate_buckets():
    client = _app({"tier": "anonymous"}, FrozenClock())
    rpm = tier_rpm("anonymous")
    for _ in range(rpm):
        assert client.get("/alerts", headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    assert client.get("/alerts", headers={"x-forwarded-for": "1.1.1.1"}).status_code == 429
    # A different client IP is unaffected by the first IP's exhaustion.
    assert client.get("/alerts", headers={"x-forwarded-for": "2.2.2.2"}).status_code == 200
