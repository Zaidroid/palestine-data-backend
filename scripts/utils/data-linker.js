/**
 * Data Linker
 * 
 * Links related data across different datasets based on spatial and temporal proximity
 */

export class DataLinker {
  constructor(options = {}) {
    this.spatialRadius = options.spatialRadius || 1000; // 1km default
    this.temporalWindow = options.temporalWindow || 7; // 7 days default
  }

  /**
   * Link related data across datasets
   */
  linkRelatedData(primaryData, allDatasets) {
    return primaryData.map(record => ({
      ...record,
      related_data: this.findRelatedData(record, allDatasets),
    }));
  }

  /**
   * Find related data for a single record
   */
  findRelatedData(record, allDatasets) {
    const related = {};

    // Link conflict to infrastructure
    if (record.type === 'conflict' && allDatasets.has('infrastructure')) {
      const nearbyInfrastructure = this.findNearbyInfrastructure(
        record,
        allDatasets.get('infrastructure'),
        this.spatialRadius,
        this.temporalWindow
      );
      if (nearbyInfrastructure.length > 0) {
        related.infrastructure = nearbyInfrastructure.map(r => r.id);
      }
    }

    // Link infrastructure to humanitarian
    if (record.type === 'infrastructure' && allDatasets.has('humanitarian')) {
      const relatedDisplacement = this.findRelatedDisplacement(
        record,
        allDatasets.get('humanitarian'),
        this.temporalWindow
      );
      if (relatedDisplacement.length > 0) {
        related.humanitarian = relatedDisplacement.map(r => r.id);
      }
    }

    // Link economic to social indicators
    if (record.type === 'economic' && allDatasets.has('social')) {
      const relatedSocial = this.linkEconomicSocial(
        record,
        allDatasets.get('social')
      );
      if (relatedSocial.length > 0) {
        related.social = relatedSocial.map(r => r.id);
      }
    }

    return Object.keys(related).length > 0 ? related : undefined;
  }

  /**
   * Find nearby infrastructure within radius and time window
   */
  findNearbyInfrastructure(conflictRecord, infrastructureData, radiusMeters, dayWindow) {
    if (!conflictRecord.location?.coordinates) return [];

    return infrastructureData.filter(infra => {
      // Check spatial proximity
      const spatialMatch = this.isWithinRadius(
        conflictRecord.location.coordinates,
        infra.location?.coordinates,
        radiusMeters
      );

      // Check temporal proximity
      const temporalMatch = this.isWithinDays(
        conflictRecord.date,
        infra.date,
        dayWindow
      );

      return spatialMatch && temporalMatch;
    });
  }

  /**
   * Find related displacement data
   */
  findRelatedDisplacement(infrastructureRecord, humanitarianData, dayWindow) {
    return humanitarianData.filter(humanitarian => {
      // Check if same location
      const sameLocation =
        infrastructureRecord.location?.name === humanitarian.location?.name ||
        infrastructureRecord.location?.admin_levels?.level1 === humanitarian.location?.admin_levels?.level1;

      // Check temporal proximity
      const temporalMatch = this.isWithinDays(
        infrastructureRecord.date,
        humanitarian.date,
        dayWindow
      );

      return sameLocation && temporalMatch;
    });
  }

  /**
   * Link economic and social indicators
   */
  linkEconomicSocial(economicRecord, socialData) {
    // Link indicators from the same time period
    return socialData.filter(social => {
      const sameYear =
        new Date(economicRecord.date).getFullYear() === new Date(social.date).getFullYear();

      return sameYear;
    });
  }

  /**
   * Check if two coordinates are within a radius
   */
  isWithinRadius(coords1, coords2, radiusMeters) {
    if (!coords1 || !coords2) return false;
    if (coords1.length !== 2 || coords2.length !== 2) return false;

    const [lon1, lat1] = coords1;
    const [lon2, lat2] = coords2;

    const distance = this.haversineDistance(lat1, lon1, lat2, lon2);
    return distance <= radiusMeters;
  }

  /**
   * Check if two dates are within a day window
   */
  isWithinDays(date1, date2, dayWindow) {
    if (!date1 || !date2) return false;

    const d1 = new Date(date1);
    const d2 = new Date(date2);

    const diffDays = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
    return diffDays <= dayWindow;
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

export default DataLinker;
