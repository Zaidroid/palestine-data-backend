"""
Prayer times for West Bank cities via AlAdhan API.

AlAdhan is completely free, requires no API key, and supports
calculation by coordinates.  Method 4 = Umm Al-Qura (common in Palestine).

We fetch all cities in parallel and cache until the next prayer transition
(typically 30–90 minutes depending on time of day).
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger("prayer_times")

# Reuse the same city list as weather.py
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

BASE_URL = "https://api.aladhan.com/v1/timings"

# Calculation methods — 4 = Umm Al-Qura University, Makkah (common in Palestine)
METHOD = 4

# Prayer names in Arabic
PRAYER_NAMES_AR: Dict[str, str] = {
    "Fajr":    "الفجر",
    "Sunrise": "الشروق",
    "Dhuhr":   "الظهر",
    "Asr":     "العصر",
    "Maghrib": "المغرب",
    "Isha":    "العشاء",
}

# ── Cache ────────────────────────────────────────────────────────────────────

CACHE_TTL = 1800  # 30 minutes

_cache: Optional[Dict[str, Any]] = None
_cache_time: float = 0.0

# ── Fetcher ──────────────────────────────────────────────────────────────────


async def _fetch_city(city: Dict[str, Any], date_str: str, client: httpx.AsyncClient) -> Dict[str, Any]:
    """Fetch prayer times for one city from AlAdhan."""
    resp = await client.get(f"{BASE_URL}/{date_str}", params={
        "latitude":  city["lat"],
        "longitude": city["lon"],
        "method":    METHOD,
    })
    resp.raise_for_status()
    data = resp.json()["data"]

    timings = data["timings"]
    hijri = data["date"]["hijri"]

    # Extract the 6 main prayer times
    prayers: Dict[str, str] = {}
    for key in ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]:
        val = timings.get(key, "")
        # AlAdhan sometimes appends " (EET)" — strip timezone suffixes
        prayers[key] = val.split(" ")[0] if val else ""

    return {
        "name":    city["name"],
        "name_ar": city["name_ar"],
        "lat":     city["lat"],
        "lon":     city["lon"],
        "prayers": prayers,
        "prayers_ar": {PRAYER_NAMES_AR.get(k, k): v for k, v in prayers.items()},
    }


def _build_hijri_info(data: dict) -> Dict[str, Any]:
    """Extract Hijri date info from AlAdhan response."""
    hijri = data.get("data", {}).get("date", {}).get("hijri", {})
    if not hijri:
        return {}
    month = hijri.get("month", {})
    weekday = hijri.get("weekday", {})
    return {
        "date":       hijri.get("date", ""),
        "day":        hijri.get("day", ""),
        "month":      month.get("number", ""),
        "month_en":   month.get("en", ""),
        "month_ar":   month.get("ar", ""),
        "year":       hijri.get("year", ""),
        "weekday_en": weekday.get("en", ""),
        "weekday_ar": weekday.get("ar", ""),
        "holidays":   hijri.get("holidays", []),
    }


async def get_prayer_times(cities: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Return today's prayer times for West Bank cities.

    Args:
        cities: optional list of city names to filter (English).
    """
    global _cache, _cache_time

    if _cache and (time.time() - _cache_time) < CACHE_TTL:
        result = _cache
        if cities:
            names = {n.lower() for n in cities}
            result = {
                **result,
                "cities": [c for c in result["cities"] if c["name"].lower() in names],
            }
        return {**result, "cached": True}

    try:
        now = datetime.now(timezone.utc)
        # AlAdhan expects DD-MM-YYYY
        date_str = now.strftime("%d-%m-%Y")

        async with httpx.AsyncClient(follow_redirects=True, timeout=12.0) as client:
            # Fetch all cities + one extra call for Hijri date
            city_tasks = [_fetch_city(city, date_str, client) for city in CITIES]
            hijri_task = client.get(f"{BASE_URL}/{date_str}", params={
                "latitude": CITIES[0]["lat"],
                "longitude": CITIES[0]["lon"],
                "method": METHOD,
            })

            results = await asyncio.gather(*city_tasks, hijri_task, return_exceptions=True)

        cities_data = []
        for r in results[:-1]:  # last one is the hijri response
            if isinstance(r, dict):
                cities_data.append(r)
            else:
                log.warning(f"Prayer time fetch error: {r}")

        if not cities_data:
            raise ValueError("all city fetches failed")

        # Parse Hijri from the extra response
        hijri_info = {}
        hijri_resp = results[-1]
        if isinstance(hijri_resp, httpx.Response) and hijri_resp.status_code == 200:
            hijri_info = _build_hijri_info(hijri_resp.json())

        _cache = {
            "date":       date_str,
            "hijri":      hijri_info,
            "method":     "Umm Al-Qura University, Makkah",
            "method_id":  METHOD,
            "cities":     cities_data,
            "source":     "AlAdhan API",
            "source_url": BASE_URL,
            "fetched_at": now.isoformat(),
        }
        _cache_time = time.time()
        log.info(f"Prayer times refreshed for {len(cities_data)} cities")

        result = _cache
        if cities:
            names = {n.lower() for n in cities}
            result = {
                **result,
                "cities": [c for c in result["cities"] if c["name"].lower() in names],
            }
        return result

    except Exception as e:
        log.warning(f"Prayer times fetch failed: {e}")

    if _cache:
        return {**_cache, "stale": True}

    return {"cities": [], "source": "unavailable", "error": "fetch failed"}
