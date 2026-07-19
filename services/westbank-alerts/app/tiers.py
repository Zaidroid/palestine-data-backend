"""Rate-limit tiers for the alerts API — mirrors src/api/config/tiers.js on the
Node databank side, but with a deliberately GENEROUS anonymous ceiling.

The public West Bank / Gaza safety feed (map polling, alert reads, checkpoint
status) must never be throttled into uselessness — that is the whole point of
the project and an explicit guardrail (docs/MONETIZATION.md §6.1: paid tiers
only ever ADD). Paid keys buy a higher ceiling and burst headroom, NOT access:
access to the public feed is free forever.

`rpm` is a per-minute request ceiling. `None` means unlimited (enterprise).
Tier names match the `tier` column in the shared keys.db api_keys table, so a
customer's tier flows straight from ApiKeyMiddleware → this table.
"""

# Per-minute request ceilings by tier. anonymous is generous on purpose.
TIERS = {
    "anonymous": {"rpm": 120},
    "free": {"rpm": 300},
    "journalist": {"rpm": 600},
    "ngo": {"rpm": 1200},
    "enterprise": {"rpm": None},  # unlimited — custom contract
}


def tier_rpm(name):
    """Per-minute ceiling for a tier name; unknown tiers fall back to anonymous."""
    return (TIERS.get(name) or TIERS["anonymous"])["rpm"]
