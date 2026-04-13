"""
Weather for key West Bank cities via Open-Meteo.

Open-Meteo is completely free, requires no API key, and has good resolution
for Palestine.  We query 5 cities and cache results for 30 minutes.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger("weather")

# ── City definitions ─────────────────────────────────────────────────────────

CITIES: List[Dict[str, Any]] = [
    {"name": "Nablus",     "name_ar": "نابلس",     "lat": 32.2211, "lon": 35.2544},
    {"name": "Ramallah",   "name_ar": "رام الله",   "lat": 31.9026, "lon": 35.2034},
    {"name": "Hebron",     "name_ar": "الخليل",     "lat": 31.5326, "lon": 35.0998},
    {"name": "Jenin",      "name_ar": "جنين",       "lat": 32.4604, "lon": 35.2966},
    {"name": "Jericho",    "name_ar": "أريحا",      "lat": 31.8496, "lon": 35.4618},
    {"name": "Tulkarm",    "name_ar": "طولكرم",     "lat": 32.3104, "lon": 35.0286},
    {"name": "Bethlehem",  "name_ar": "بيت لحم",    "lat": 31.7054, "lon": 35.2024},
    {"name": "Qalqilya",   "name_ar": "قلقيلية",    "lat": 32.1892, "lon": 34.9714},
]

# ── WMO weather code descriptions ───────────────────────────────────────────

WMO_CODES: Dict[int, str] = {
    0:  "Clear sky",
    1:  "Mainly clear",
    2:  "Partly cloudy",
    3:  "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}

WMO_CODES_AR: Dict[int, str] = {
    0:  "سماء صافية",
    1:  "صافية غالباً",
    2:  "غائمة جزئياً",
    3:  "غائمة",
    45: "ضباب",
    51: "رذاذ خفيف",
    53: "رذاذ معتدل",
    55: "رذاذ كثيف",
    61: "مطر خفيف",
    63: "مطر معتدل",
    65: "مطر غزير",
    80: "زخات مطر خفيفة",
    81: "زخات مطر معتدلة",
    82: "زخات مطر غزيرة",
    95: "عاصفة رعدية",
    96: "عاصفة رعدية مع برد",
    99: "عاصفة رعدية مع برد شديد",
}

# ── Cache ────────────────────────────────────────────────────────────────────

BASE_URL  = "https://api.open-meteo.com/v1/forecast"
CACHE_TTL = 1800  # 30 minutes

_cache: Optional[Dict[str, Any]] = None
_cache_time: float = 0.0

# ── Fetcher ──────────────────────────────────────────────────────────────────


async def _fetch_city(city: Dict[str, Any], client: httpx.AsyncClient) -> Dict[str, Any]:
    resp = await client.get(BASE_URL, params={
        "latitude":        city["lat"],
        "longitude":       city["lon"],
        "current_weather": "true",
        "wind_speed_unit": "kmh",
        "timezone":        "Asia/Jerusalem",
    })
    resp.raise_for_status()
    cw = resp.json()["current_weather"]
    code = int(cw.get("weathercode", 0))

    return {
        "name":         city["name"],
        "name_ar":      city["name_ar"],
        "lat":          city["lat"],
        "lon":          city["lon"],
        "temp_c":       round(cw["temperature"], 1),
        "wind_kmh":     round(cw["windspeed"], 1),
        "wind_dir_deg": cw.get("winddirection"),
        "weather_code": code,
        "condition":    WMO_CODES.get(code, f"Code {code}"),
        "condition_ar": WMO_CODES_AR.get(code, WMO_CODES.get(code, f"رمز {code}")),
        "is_day":       bool(cw.get("is_day", 1)),
    }


async def get_weather(cities: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Return current weather for West Bank cities.

    Args:
        cities: optional list of city names to filter (English).
                If None, returns all cities.
    """
    global _cache, _cache_time

    if _cache and (time.time() - _cache_time) < CACHE_TTL:
        result = _cache
        if cities:
            result = {
                **result,
                "cities": [c for c in result["cities"] if c["name"].lower() in {n.lower() for n in cities}],
            }
        return {**result, "cached": True}

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            results = await asyncio.gather(
                *[_fetch_city(city, client) for city in CITIES],
                return_exceptions=True,
            )

        ok_cities = []
        for r in results:
            if isinstance(r, dict):
                ok_cities.append(r)
            else:
                log.warning(f"Weather fetch error for a city: {r}")

        if not ok_cities:
            raise ValueError("all city fetches failed")

        _cache = {
            "cities":     ok_cities,
            "source":     "Open-Meteo",
            "source_url": BASE_URL,
            "note":       "Free, no API key required. WMO weather codes.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        _cache_time = time.time()
        log.info(f"Weather refreshed for {len(ok_cities)} cities")

        result = _cache
        if cities:
            result = {
                **result,
                "cities": [c for c in result["cities"] if c["name"].lower() in {n.lower() for n in cities}],
            }
        return result

    except Exception as e:
        log.warning(f"Weather fetch failed: {e}")

    if _cache:
        return {**_cache, "stale": True}

    return {"cities": [], "source": "unavailable", "error": "fetch failed"}
