/**
 * Geospatial Enricher
 * 
 * Enriches location data with administrative boundaries, proximity, and context
 */

export class GeospatialEnricher {
  constructor() {
    // Gaza governorates with approximate bounding boxes
    this.governorates = {
      'Gaza': { region: 'gaza', bounds: { minLat: 31.45, maxLat: 31.55, minLon: 34.40, maxLon: 34.50 } },
      'North Gaza': { region: 'gaza', bounds: { minLat: 31.50, maxLat: 31.60, minLon: 34.45, maxLon: 34.55 } },
      'Deir al-Balah': { region: 'gaza', bounds: { minLat: 31.40, maxLat: 31.50, minLon: 34.30, maxLon: 34.40 } },
      'Khan Yunis': { region: 'gaza', bounds: { minLat: 31.30, maxLat: 31.40, minLon: 34.25, maxLon: 34.35 } },
      'Rafah': { region: 'gaza', bounds: { minLat: 31.25, maxLat: 31.35, minLon: 34.20, maxLon: 34.30 } },
      
      // West Bank governorates
      'Jenin': { region: 'west_bank', bounds: { minLat: 32.40, maxLat: 32.50, minLon: 35.25, maxLon: 35.35 } },
      'Tubas': { region: 'west_bank', bounds: { minLat: 32.30, maxLat: 32.40, minLon: 35.35, maxLon: 35.45 } },
      'Tulkarm': { region: 'west_bank', bounds: { minLat: 32.25, maxLat: 32.35, minLon: 35.00, maxLon: 35.10 } },
      'Nablus': { region: 'west_bank', bounds: { minLat: 32.15, maxLat: 32.25, minLon: 35.20, maxLon: 35.30 } },
      'Qalqilya': { region: 'west_bank', bounds: { minLat: 32.10, maxLat: 32.20, minLon: 34.95, maxLon: 35.05 } },
      'Salfit': { region: 'west_bank', bounds: { minLat: 32.05, maxLat: 32.15, minLon: 35.10, maxLon: 35.20 } },
      'Ramallah': { region: 'west_bank', bounds: { minLat: 31.85, maxLat: 31.95, minLon: 35.15, maxLon: 35.25 } },
      'Jericho': { region: 'west_bank', bounds: { minLat: 31.80, maxLat: 31.90, minLon: 35.40, maxLon: 35.50 } },
      'Jerusalem': { region: 'east_jerusalem', bounds: { minLat: 31.75, maxLat: 31.85, minLon: 35.15, maxLon: 35.25 } },
      'Bethlehem': { region: 'west_bank', bounds: { minLat: 31.65, maxLat: 31.75, minLon: 35.15, maxLon: 35.25 } },
      'Hebron': { region: 'west_bank', bounds: { minLat: 31.45, maxLat: 31.55, minLon: 35.05, maxLon: 35.15 } },
    };
  }

  /**
   * Enrich location with full geospatial context
   */
  enrichLocation(location) {
    if (!location) return location;

    const enriched = { ...location };

    // Enrich admin levels if coordinates available
    if (location.coordinates) {
      const [lon, lat] = location.coordinates;
      enriched.admin_levels = {
        ...location.admin_levels,
        level1: location.admin_levels?.level1 || this.findGovernorate(lon, lat),
      };
    }

    // Classify region if not already set
    if (!enriched.region) {
      enriched.region = this.classifyRegion(location.name);
    }

    // Add region type
    enriched.region_type = this.classifyRegionType(location.name);

    // Add proximity information if coordinates available
    if (location.coordinates) {
      enriched.proximity = this.calculateProximity(location.coordinates);
    }

    return enriched;
  }

  /**
   * Find governorate from coordinates
   */
  findGovernorate(lon, lat) {
    for (const [name, data] of Object.entries(this.governorates)) {
      const { bounds } = data;
      if (
        lat >= bounds.minLat &&
        lat <= bounds.maxLat &&
        lon >= bounds.minLon &&
        lon <= bounds.maxLon
      ) {
        return name;
      }
    }
    return null;
  }

  /**
   * Classify region (Gaza, West Bank, East Jerusalem)
   */
  classifyRegion(locationName) {
    if (!locationName) return 'unknown';

    // Handle object with value property
    const nameStr = typeof locationName === 'object' && locationName.value 
      ? locationName.value 
      : locationName;
    
    if (typeof nameStr !== 'string') return 'unknown';

    const name = nameStr.toLowerCase();

    if (name.includes('gaza')) return 'gaza';
    if (name.includes('west bank') || name.includes('westbank')) return 'west_bank';
    if (name.includes('jerusalem')) return 'east_jerusalem';

    // Check against governorate list
    for (const [govName, data] of Object.entries(this.governorates)) {
      if (name.includes(govName.toLowerCase())) {
        return data.region;
      }
    }

    return 'unknown';
  }

  /**
   * Classify region type (urban, rural, camp)
   */
  classifyRegionType(locationName) {
    if (!locationName) return null;

    // Handle object with value property
    const nameStr = typeof locationName === 'object' && locationName.value 
      ? locationName.value 
      : locationName;
    
    if (typeof nameStr !== 'string') return null;

    const name = nameStr.toLowerCase();

    if (name.includes('camp') || name.includes('refugee')) return 'camp';
    if (name.includes('city') || name.includes('gaza city') || name.includes('ramallah')) return 'urban';
    if (name.includes('village') || name.includes('rural')) return 'rural';

    // Major cities
    const urbanAreas = ['gaza', 'khan yunis', 'rafah', 'jenin', 'nablus', 'hebron', 'bethlehem', 'ramallah'];
    if (urbanAreas.some(city => name.includes(city))) return 'urban';

    return null;
  }

  /**
   * Calculate proximity to key locations
   */
  calculateProximity(coordinates) {
    if (!coordinates || coordinates.length !== 2) return null;

    const [lon, lat] = coordinates;

    return {
      nearest_city: this.findNearestCity(lon, lat),
      distance_to_border: this.calculateDistanceToBorder(lon, lat),
    };
  }

  /**
   * Find nearest major city
   */
  findNearestCity(lon, lat) {
    const cities = {
      'Gaza City': [34.45, 31.50],
      'Khan Yunis': [34.30, 31.35],
      'Rafah': [34.25, 31.30],
      'Ramallah': [35.20, 31.90],
      'Nablus': [35.25, 32.20],
      'Hebron': [35.10, 31.50],
      'Bethlehem': [35.20, 31.70],
      'Jenin': [35.30, 32.45],
    };

    let nearestCity = null;
    let minDistance = Infinity;

    for (const [cityName, [cityLon, cityLat]] of Object.entries(cities)) {
      const distance = this.haversineDistance(lat, lon, cityLat, cityLon);
      if (distance < minDistance) {
        minDistance = distance;
        nearestCity = cityName;
      }
    }

    return nearestCity;
  }

  /**
   * Calculate distance to nearest border (simplified)
   */
  calculateDistanceToBorder(lon, lat) {
    // Gaza borders (approximate)
    if (lon >= 34.2 && lon <= 34.6 && lat >= 31.2 && lat <= 31.6) {
      // In Gaza - calculate distance to edges
      const distances = [
        Math.abs(lat - 31.2), // South
        Math.abs(lat - 31.6), // North
        Math.abs(lon - 34.2), // West
        Math.abs(lon - 34.6), // East
      ];
      return Math.min(...distances) * 111000; // Convert degrees to meters (approximate)
    }

    // West Bank borders (approximate)
    if (lon >= 34.9 && lon <= 35.6 && lat >= 31.3 && lat <= 32.6) {
      const distances = [
        Math.abs(lat - 31.3), // South
        Math.abs(lat - 32.6), // North
        Math.abs(lon - 34.9), // West
        Math.abs(lon - 35.6), // East
      ];
      return Math.min(...distances) * 111000;
    }

    return null;
  }

  /**
   * Haversine distance calculation (in meters)
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
}

export default GeospatialEnricher;
