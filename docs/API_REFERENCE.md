# 🔌 API Reference

The data is served as static JSON files. You can access them directly via HTTP.

## Base URL
When running locally: `http://localhost:3000/data`
In production: `https://[your-domain]/data`

## 1. Manifest (Entry Point)
Start here to discover available data.
**URL**: `/manifest.json`

```json
{
  "last_updated": "2023-11-24T12:00:00Z",
  "version": "1.0.0",
  "baseline_date": "2023-10-07",
  "datasets": {
    "casualties": { "path": "unified/casualties/index.json" },
    "infrastructure": { "path": "unified/infrastructure/index.json" }
  }
}
```

## 2. Unified Data
Data is organized by category in the `unified/` directory.

### Casualties
**Index**: `/unified/casualties/index.json`
**Schema**:
```json
{
  "date": "2023-11-01",
  "killed": 100,
  "injured": 200,
  "location": "Gaza Strip",
  "source": "MOH"
}
```

### Martyrs (Detailed List)
**Index**: `/unified/martyrs/index.json`
**Schema**:
```json
{
  "name": "Name",
  "age": 25,
  "gender": "M",
  "date_of_death": "2023-11-01",
  "location": "Gaza"
}
```

### Infrastructure
**Index**: `/unified/infrastructure/index.json`
**Schema**:
```json
{
  "date": "2023-11-01",
  "type": "residential",
  "status": "destroyed",
  "count": 50,
  "location": "North Gaza"
}
```

### Water (WASH)
**Index**: `/unified/water/index.json`
**Schema**:
```json
{
  "date": "2023-11-01",
  "indicator": "water_access",
  "value": 3.5,
  "unit": "liters_per_person",
  "location": "Gaza Strip"
}
```

### Culture
**Index**: `/unified/culture/index.json`
**Schema**:
```json
{
  "name": "Great Omari Mosque",
  "type": "mosque",
  "status": "damaged",
  "location": "Gaza City"
}
```

### Land (Settlements & Checkpoints)
**Index**: `/unified/land/index.json`
**Schema**:
```json
{
  "name": "Ariel",
  "type": "settlement",
  "status": "authorized",
  "area": 2500,
  "location": "West Bank"
}
```

## 3. GeoJSON Layers
Ready-to-use map layers.

- **Conflict Events**: `/geojson/conflict/all.geojson`
- **Infrastructure Damage**: `/geojson/infrastructure/all.geojson`
- **Cultural Heritage**: `/geojson/culture/all.geojson`
- **Land (Settlements/Checkpoints)**: `/geojson/land/all.geojson`

**Properties**:
```json
{
  "type": "Feature",
  "properties": {
    "date": "2023-11-01",
    "type": "airstrike",
    "fatalities": 5
  },
  "geometry": { ... }
}
```
