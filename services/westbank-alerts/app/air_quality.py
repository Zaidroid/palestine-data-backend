"""
Air quality for West Bank cities via Open-Meteo Air Quality API.

Same provider as our weather module — free, no API key.
Returns PM2.5, PM10, US AQI, and European AQI per city.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger("air_quality")

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

BASE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

# US AQI categories
AQI_CATEGORIES = [
    (50,  "Good",                      "جيد",         "green"),
    (100, "Moderate",                   "معتدل",       "yellow"),
    (150, "Unhealthy for Sensitive",    "غير صحي للحساسين", "orange"),
    (200, "Unhealthy",                  "غير صحي",     "red"),
    (300, "Very Unhealthy",             "غير صحي جداً",  "purple"),
    (500, "Hazardous",                  "خطر",         "maroon"),
]


def _aqi_category(aqi: Optional[float]) -> Dict[str, str]:
    """Return category label and color for a US AQI value."""
    if aqi is None:
        return {"label": "Unknown", "label_ar": "غير معروف", "color": "gray"}
    for threshold, label, label_ar, color in AQI_CATEGORIES:
        if aqi <= threshold:
            return {"label": label, "label_ar": label_ar, "color": color}
    return {"label": "Hazardous", "label_ar": "خطر", "color": "maroon"}


# ── Cache ────────────────────────────────────────────────────────────────────

CACHE_TTL = 3600  # 1 hour (AQ data updates hourly)

_cache: Optional[Dict[str, Any]] = None
_cache_time: float = 0.0

# ── Fetcher ──────────────────────────────────────────────────────────────────


async def _fetch_city(city: Dict[str, Any], client: httpx.AsyncClient) -> Dict[str, Any]:
    resp = await client.get(BASE_URL, params={
        "latitude":  city["lat"],
        "longitude": city["lon"],
        "current":   "pm10,pm2_5,us_aqi,european_aqi",
    })
    resp.raise_for_status()
    data = resp.json()
    current = data.get("current", {})

    us_aqi = current.get("us_aqi")
    category = _aqi_category(us_aqi)

    return {
        "name":         city["name"],
        "name_ar":      city["name_ar"],
        "lat":          city["lat"],
        "lon":          city["lon"],
        "pm2_5":        current.get("pm2_5"),
        "pm10":         current.get("pm10"),
        "us_aqi":       us_aqi,
        "european_aqi": current.get("european_aqi"),
        "category":     category["label"],
        "category_ar":  category["label_ar"],
        "category_color": category["color"],
    }


async def get_air_quality(cities: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Return current air quality for West Bank cities.

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
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            results = await asyncio.gather(
                *[_fetch_city(city, client) for city in CITIES],
                return_exceptions=True,
            )

        cities_data = []
        for r in results:
            if isinstance(r, dict):
                cities_data.append(r)
            else:
                log.warning(f"Air quality fetch error: {r}")

        if not cities_data:
            raise ValueError("all city fetches failed")

        # Compute region-wide summary
        aqi_values = [c["us_aqi"] for c in cities_data if c["us_aqi"] is not None]
        avg_aqi = round(sum(aqi_values) / len(aqi_values), 1) if aqi_values else None
        max_aqi = max(aqi_values) if aqi_values else None
        worst_city = None
        if max_aqi is not None:
            worst_city = next((c["name"] for c in cities_data if c["us_aqi"] == max_aqi), None)

        summary_cat = _aqi_category(avg_aqi)

        _cache = {
            "summary": {
                "avg_us_aqi":      avg_aqi,
                "max_us_aqi":      max_aqi,
                "worst_city":      worst_city,
                "category":        summary_cat["label"],
                "category_ar":     summary_cat["label_ar"],
                "category_color":  summary_cat["color"],
            },
            "cities":     cities_data,
            "source":     "Open-Meteo Air Quality API",
            "source_url": BASE_URL,
            "note":       "PM2.5/PM10 in µg/m³. US AQI scale 0-500.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        _cache_time = time.time()
        log.info(f"Air quality refreshed for {len(cities_data)} cities (avg AQI={avg_aqi})")

        result = _cache
        if cities:
            names = {n.lower() for n in cities}
            result = {
                **result,
                "cities": [c for c in result["cities"] if c["name"].lower() in names],
            }
        return result

    except Exception as e:
        log.warning(f"Air quality fetch failed: {e}")

    if _cache:
        return {**_cache, "stale": True}

    return {"cities": [], "source": "unavailable", "error": "fetch failed"}
