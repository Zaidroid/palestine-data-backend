/**
 * Unified Data Schema for Palestine Data Backend
 * 
 * This schema ensures consistency across all data sources (HDX, PCBS, UNRWA, WHO, World Bank, etc.)
 * and provides a flat, easy-to-consume format for the frontend.
 * 
 * Version: 2.0.0 (Unified)
 * Updated: 2025-11-27
 */

const unifiedSchema = {
  // Root level metadata structure
  metadata: {
    source: "string", // e.g., "OCHA", "ACLED", "PCBS"
    dataset_id: "string",
    generated_at: "string", // ISO timestamp
    record_count: "number",
    time_period: {
      start: "string",
      end: "string"
    }
  },

  // The Unified Event / Metric Structure
  // This is the target format for ALL data ingestion
  definitions: {
    UnifiedEvent: {
      id: "string", // Unique ID (e.g., "acled-12345")
      date: "string", // ISO-8601 (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)

      // Categorization
      category: "string", // conflict, health, education, infrastructure, economy, displacement
      event_type: "string", // e.g., "air_strike", "demolition", "school_damage"

      // Location (Normalized)
      location: {
        governorate: "string", // Gaza, North Gaza, Khan Younis, Ramallah, etc.
        district: "string", // Optional sub-district
        city: "string", // Specific city/village if known
        lat: "number",
        lon: "number",
        precision: "string" // exact, approximate, governorate_level
      },

      // Quantitative Data (Flexible but standardized keys)
      metrics: {
        killed: "number",
        injured: "number",
        displaced: "number",
        affected: "number",
        cost_usd: "number",
        count: "number", // Generic count if applicable
        value: "number" // For single-value metrics (e.g. GDP)
      },

      // Context
      details: "string", // Description or notes
      source_link: "string", // URL to original data
      confidence: "string" // high, medium, low
    }
  }
};

// Export utilities for working with the schema
const schemaUtils = {
  /**
   * Validate a record against the UnifiedEvent schema
   */
  validateRecord: (record) => {
    const errors = [];

    // Required fields
    if (!record.id) errors.push("Missing 'id'");
    if (!record.date) errors.push("Missing 'date'");
    if (!record.category) errors.push("Missing 'category'");
    if (!record.event_type) errors.push("Missing 'event_type'");

    // Location validation
    if (!record.location) {
      errors.push("Missing 'location' object");
    } else {
      if (record.location.lat && (record.location.lat < 29 || record.location.lat > 34)) {
        errors.push("Latitude out of Palestine range");
      }
      if (record.location.lon && (record.location.lon < 34 || record.location.lon > 36)) {
        errors.push("Longitude out of Palestine range");
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  },

  /**
   * Create a standard UnifiedEvent object
   * Helper to ensure all fields exist (even if null)
   */
  createEvent: (data) => {
    return {
      id: data.id || `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      date: data.date || new Date().toISOString(),
      category: data.category || "uncategorized",
      event_type: data.event_type || "unknown",
      location: {
        governorate: data.location?.governorate || null,
        district: data.location?.district || null,
        city: data.location?.city || null,
        lat: data.location?.lat || null,
        lon: data.location?.lon || null,
        precision: data.location?.precision || "unknown"
      },
      metrics: {
        killed: data.metrics?.killed || 0,
        injured: data.metrics?.injured || 0,
        displaced: data.metrics?.displaced || 0,
        affected: data.metrics?.affected || 0,
        cost_usd: data.metrics?.cost_usd || 0,
        count: data.metrics?.count || 0,
        value: data.metrics?.value || 0
      },
      details: data.details || "",
      source_link: data.source_link || "",
      confidence: data.confidence || "unknown"
    };
  }
};

export { unifiedSchema, schemaUtils };
export default unifiedSchema;

