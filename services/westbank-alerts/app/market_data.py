"""
Market data layer — currency, gold, fuel prices for Palestine/West Bank.

Data sources:
  Currency: Bank of Israel public XML API (official, free, daily ~15:45 IST)
           Fallback: fawazahmed0/currency-api (community, free)
  Gold:     exchange-rates.org Palestine page (local karat prices in ILS)
           Fallback: Yahoo Finance GC=F spot + BOI cross-rate
  Fuel:     TheFuelPrice.com Palestine page (General Petroleum Corp. official)
           Prices in ILS/liter for Gasoline 95, 98, Diesel

All data cached in-process with TTL.  On fetch failure the last good value
is returned with a `stale: true` flag.
"""

import asyncio
import logging
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

log = logging.getLogger("market_data")

# ── TTL cache ────────────────────────────────────────────────────────────────

@dataclass
class _Cache:
    data: Optional[Dict[str, Any]] = None
    fetched_at: float = 0.0
    ttl: float = 3600.0

    def get(self) -> Optional[Dict[str, Any]]:
        if self.data and (time.time() - self.fetched_at) < self.ttl:
            return self.data
        return None

    def set(self, data: Dict[str, Any]):
        self.data = data
        self.fetched_at = time.time()

    @property
    def age_seconds(self) -> Optional[float]:
        return round(time.time() - self.fetched_at, 1) if self.fetched_at else None


_currency_cache = _Cache(ttl=3600)       # 1 hour
_gold_cache     = _Cache(ttl=900)        # 15 minutes
_fuel_cache     = _Cache(ttl=86400)      # 24 hours

_HEADERS = {"User-Agent": "WestBankAlerts/1.0 (Palestinian conditions API)"}
_TIMEOUT = 12.0


async def _get(url: str, **kwargs) -> httpx.Response:
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=_TIMEOUT, headers=_HEADERS,
    ) as client:
        return await client.get(url, **kwargs)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═════════════════════════════════════════════════════════════════════════════
# CURRENCY  —  Bank of Israel XML API
# ═════════════════════════════════════════════════════════════════════════════

BOI_URL = "https://boi.org.il/PublicApi/GetExchangeRates?asXml=true"
WANTED_CURRENCIES = {"USD", "EUR", "JOD", "GBP", "EGP"}


async def _fetch_currency_boi() -> Dict[str, Any]:
    resp = await _get(BOI_URL)
    resp.raise_for_status()

    root = ET.fromstring(resp.text)
    rates: Dict[str, float] = {}
    last_update = None

    # BOI uses a .NET DataContract XML namespace — strip it for simpler parsing
    ns = {"b": "http://schemas.datacontract.org/2004/07/BOI.Core.Models.HotData"}

    # Try namespaced first, then fall back to bare element names
    entries = root.findall(".//b:ExchangeRateResponseDTO", ns)
    if not entries:
        entries = list(root.iter())  # fallback: walk everything

    for er in entries:
        # Note: Element.__bool__ is falsy for childless elements in Python 3.12,
        # so we must use `is not None` instead of `or` for fallback lookups.
        key_el  = er.find("b:Key", ns)
        if key_el is None:
            key_el = er.find("Key")
        rate_el = er.find("b:CurrentExchangeRate", ns)
        if rate_el is None:
            rate_el = er.find("CurrentExchangeRate")
        unit_el = er.find("b:Unit", ns)
        if unit_el is None:
            unit_el = er.find("Unit")
        date_el = er.find("b:LastUpdate", ns)
        if date_el is None:
            date_el = er.find("LastUpdate")

        if key_el is None or rate_el is None:
            continue
        code = (key_el.text or "").strip().upper()
        if code not in WANTED_CURRENCIES:
            continue
        try:
            rate = float(rate_el.text)
            unit = int(unit_el.text) if unit_el is not None and unit_el.text else 1
            rates[code] = round(rate / unit, 6)
        except (ValueError, TypeError, ZeroDivisionError):
            continue
        if date_el is not None and date_el.text and not last_update:
            last_update = date_el.text.strip()

    if not rates:
        raise ValueError("BOI returned no parseable rates")

    return {
        "rates":       rates,
        "base":        "ILS",
        "source":      "Bank of Israel",
        "source_url":  BOI_URL,
        "last_update": last_update,
        "note":        "Official representative rates, updated daily ~15:45 IST",
    }


# Fallback: fawazahmed0 community API (free, no key)
FAWAZ_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/ils.json"


async def _fetch_currency_fallback() -> Dict[str, Any]:
    resp = await _get(FAWAZ_URL)
    resp.raise_for_status()
    data = resp.json()
    ils_rates = data.get("ils", {})

    # This API gives ILS → X.  We want X → ILS (how many ILS per 1 unit).
    rates: Dict[str, float] = {}
    for code in WANTED_CURRENCIES:
        val = ils_rates.get(code.lower())
        if val and float(val) > 0:
            rates[code] = round(1.0 / float(val), 6)

    if not rates:
        raise ValueError("Fallback returned no rates")

    return {
        "rates":      rates,
        "base":       "ILS",
        "source":     "fawazahmed0/currency-api (community)",
        "source_url": FAWAZ_URL,
        "note":       "Community-maintained fallback, ~daily updates",
    }


async def get_currency() -> Dict[str, Any]:
    """Return ILS exchange rates (ILS per 1 unit of foreign currency)."""
    cached = _currency_cache.get()
    if cached:
        return {**cached, "cached": True}

    # Try BOI first, then fallback
    for fetcher, label in [
        (_fetch_currency_boi, "BOI"),
        (_fetch_currency_fallback, "fallback"),
    ]:
        try:
            result = await fetcher()
            result["fetched_at"] = _now_iso()
            _currency_cache.set(result)
            log.info(f"Currency refreshed from {label}: {list(result['rates'].keys())}")
            return result
        except Exception as e:
            log.warning(f"Currency fetch from {label} failed: {e}")

    # Return stale data if available
    if _currency_cache.data:
        return {**_currency_cache.data, "stale": True, "stale_age_s": _currency_cache.age_seconds}

    return {"rates": {}, "base": "ILS", "source": "unavailable", "error": "all sources failed"}


# ═════════════════════════════════════════════════════════════════════════════
# GOLD  —  local Palestine karat prices + international spot
# ═════════════════════════════════════════════════════════════════════════════

TROY_OZ_GRAMS = 31.1035

# Primary: exchange-rates.org — Palestine gold in ILS per gram by karat
EXRATES_GOLD_URL = "https://www.exchange-rates.org/precious-metals/gold-price/palestine"

# Karat labels we look for in the scraped table
_KARAT_KEYWORDS = {"24k", "22k", "21k", "18k", "14k", "10k"}


async def _fetch_gold_local() -> Dict[str, Any]:
    """Scrape Palestine gold prices in ILS/gram by karat from exchange-rates.org."""
    from bs4 import BeautifulSoup

    resp = await _get(EXRATES_GOLD_URL, timeout=15.0)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    karats: Dict[str, float] = {}
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            label = cells[0].get_text(strip=True).lower().replace(" ", "")
            # Match patterns like "24K", "24k", "24 Karat"
            for k in _KARAT_KEYWORDS:
                if k in label:
                    # Find the price cell — look for a number with ₪ or just a float
                    for cell in cells[1:]:
                        text = cell.get_text(strip=True).replace("₪", "").replace(",", "").strip()
                        try:
                            price = float(text)
                            if 10 < price < 2000:  # sanity: ILS/gram range
                                karats[k.upper()] = round(price, 2)
                                break
                        except ValueError:
                            continue
                    break

    if not karats:
        raise ValueError("No karat prices found on exchange-rates.org")

    return {
        "karats_ils_gram": karats,
        "currency":        "ILS",
        "source":          "exchange-rates.org (Palestine)",
        "source_url":      EXRATES_GOLD_URL,
        "note":            "Local Palestine gold prices by karat, updated throughout the day",
    }


# Fallback: Yahoo Finance gold futures (GC=F) + BOI cross-rate
YF_GOLD_URL = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1m&range=1d"


async def _fetch_gold_spot_usd() -> float:
    """Return international gold spot USD/oz from Yahoo Finance."""
    resp = await _get(YF_GOLD_URL)
    resp.raise_for_status()
    data = resp.json()
    meta = data["chart"]["result"][0]["meta"]
    price = meta.get("regularMarketPrice") or meta.get("previousClose")
    if not price:
        raise ValueError("Yahoo Finance returned no gold price")
    return float(price)


async def get_gold() -> Dict[str, Any]:
    """
    Return gold prices — local Palestine karat rates in ILS + international spot.

    Primary source: exchange-rates.org Palestine page (ILS/gram by karat).
    Fallback: Yahoo Finance spot + BOI cross-rate for calculated ILS prices.
    """
    cached = _gold_cache.get()
    if cached:
        return {**cached, "cached": True}

    result: Dict[str, Any] = {"fetched_at": _now_iso()}

    # Try local karat prices first (most useful for Palestinian users)
    local_ok = False
    try:
        local = await _fetch_gold_local()
        result.update(local)
        local_ok = True
        log.info(f"Gold local prices: {local['karats_ils_gram']}")
    except Exception as e:
        log.warning(f"Gold local (exchange-rates.org) failed: {e}")

    # Always try international spot for USD reference
    try:
        spot_usd = await _fetch_gold_spot_usd()
        result["usd_per_oz"]   = round(spot_usd, 2)
        result["usd_per_gram"] = round(spot_usd / TROY_OZ_GRAMS, 2)
        result["spot_source"]  = "Yahoo Finance (GC=F)"

        # If local scrape failed, calculate ILS prices from spot + BOI rate
        if not local_ok:
            try:
                currency = await get_currency()
                usd_ils = currency.get("rates", {}).get("USD")
                if usd_ils:
                    ils_per_gram = (spot_usd / TROY_OZ_GRAMS) * usd_ils
                    result["karats_ils_gram"] = {
                        "24K": round(ils_per_gram, 2),
                        "22K": round(ils_per_gram * 22 / 24, 2),
                        "21K": round(ils_per_gram * 21 / 24, 2),
                        "18K": round(ils_per_gram * 18 / 24, 2),
                    }
                    result["currency"] = "ILS"
                    result["source"]   = "Yahoo Finance spot + BOI cross-rate (calculated)"
                    result["note"]     = "Calculated from international spot, not local market"
            except Exception as e:
                log.warning(f"Gold ILS cross-rate failed: {e}")
    except Exception as e:
        log.warning(f"Gold spot (Yahoo) failed: {e}")

    if result.get("karats_ils_gram") or result.get("usd_per_oz"):
        _gold_cache.set(result)
        return result

    # All sources failed
    if _gold_cache.data:
        return {**_gold_cache.data, "stale": True, "stale_age_s": _gold_cache.age_seconds}
    return {"source": "unavailable", "error": "all gold sources failed"}


# ═════════════════════════════════════════════════════════════════════════════
# FUEL  —  TheFuelPrice.com (General Petroleum Corporation of Palestine)
# ═════════════════════════════════════════════════════════════════════════════

# Primary: TheFuelPrice.com — official Palestine prices in ILS/liter
TFP_URL = "https://www.thefuelprice.com/Fps/en"

# Fuel type keywords we look for in table rows
_FUEL_TYPES = {
    "gasoline 95": "gasoline_95",
    "gasoline 98": "gasoline_98",
    "diesel":      "diesel",
}


async def _fetch_fuel_tfp() -> Dict[str, Any]:
    """Scrape Palestine fuel prices (ILS/liter) from TheFuelPrice.com."""
    from bs4 import BeautifulSoup

    resp = await _get(TFP_URL, timeout=15.0)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    prices: Dict[str, float] = {}
    effective_date = None

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue

            # Join all cell text to find fuel type
            row_text = " ".join(c.get_text(strip=True) for c in cells).lower()

            for keyword, key in _FUEL_TYPES.items():
                if keyword in row_text:
                    # Find the price — first numeric value in the row
                    for cell in cells:
                        text = cell.get_text(strip=True)
                        # Strip trend arrows (▲▼) and whitespace
                        cleaned = text.replace("▲", "").replace("▼", "").replace("△", "").replace("▽", "").strip()
                        try:
                            price = float(cleaned)
                            if 1.0 < price < 20.0:  # sanity: ILS/liter range
                                prices[key] = round(price, 2)
                                break
                        except ValueError:
                            continue
                    break

            # Look for date in row
            if not effective_date:
                for cell in cells:
                    text = cell.get_text(strip=True)
                    # Match dates like "01 April 2026"
                    if any(m in text for m in ["January", "February", "March", "April",
                                                "May", "June", "July", "August",
                                                "September", "October", "November", "December"]):
                        effective_date = text
                        break

    if not prices:
        raise ValueError("No fuel prices found on TheFuelPrice.com")

    # Convert to USD as well
    usd_prices: Dict[str, float] = {}
    try:
        currency = await get_currency()
        usd_ils = currency.get("rates", {}).get("USD")
        if usd_ils and usd_ils > 0:
            for key, ils_price in prices.items():
                usd_prices[f"{key}_usd"] = round(ils_price / usd_ils, 3)
    except Exception:
        pass

    return {
        "prices_ils_liter": prices,
        "prices_usd_liter": usd_prices if usd_prices else None,
        "currency":         "ILS",
        "effective_date":   effective_date,
        "source":           "TheFuelPrice.com (General Petroleum Corporation)",
        "source_url":       TFP_URL,
        "note":             "Official Palestine retail fuel prices, updated monthly",
    }


async def get_fuel() -> Dict[str, Any]:
    """Return Palestine fuel prices in ILS and USD per liter."""
    cached = _fuel_cache.get()
    if cached:
        return {**cached, "cached": True}

    try:
        result = await _fetch_fuel_tfp()
        result["fetched_at"] = _now_iso()
        _fuel_cache.set(result)
        log.info(f"Fuel refreshed: {result['prices_ils_liter']}")
        return result
    except ImportError:
        log.warning("beautifulsoup4 not installed — fuel scraping disabled")
    except Exception as e:
        log.warning(f"Fuel fetch (TheFuelPrice.com) failed: {e}")

    if _fuel_cache.data:
        return {**_fuel_cache.data, "stale": True, "stale_age_s": _fuel_cache.age_seconds}

    return {
        "source": "unavailable",
        "error":  "scraper failed or beautifulsoup4 not installed",
        "note":   "pip install beautifulsoup4 to enable fuel price scraping",
    }


# ═════════════════════════════════════════════════════════════════════════════
# COMBINED
# ═════════════════════════════════════════════════════════════════════════════

async def get_all_market_data() -> Dict[str, Any]:
    """Fetch currency, gold, and fuel in parallel.  Always returns a dict."""
    currency, gold, fuel = await asyncio.gather(
        get_currency(), get_gold(), get_fuel(),
        return_exceptions=True,
    )
    return {
        "currency":   currency if isinstance(currency, dict) else {"error": str(currency)},
        "gold":       gold     if isinstance(gold, dict)     else {"error": str(gold)},
        "fuel":       fuel     if isinstance(fuel, dict)     else {"error": str(fuel)},
        "fetched_at": _now_iso(),
    }
