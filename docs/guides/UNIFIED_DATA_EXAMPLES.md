# Unified Data System - Component Examples

## Overview

This document provides practical examples of using the Unified Data System in React components. Each example demonstrates common patterns and best practices.

## Table of Contents

- [Basic Data Display](#basic-data-display)
- [Charts and Visualizations](#charts-and-visualizations)
- [Maps and Geospatial](#maps-and-geospatial)
- [Filtering and Search](#filtering-and-search)
- [Data Export](#data-export)
- [Real-time Updates](#real-time-updates)
- [Error Handling](#error-handling)
- [Performance Optimization](#performance-optimization)

## Basic Data Display

### Example 1: Simple Data List

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { Card } from '@/components/ui/card';

function ConflictList() {
  const { data, isLoading, error } = useConflictData({
    region: 'gaza',
    qualityThreshold: 0.8,
  });
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  if (error) {
    return <div>Error: {error.message}</div>;
  }
  
  if (!data || data.data.length === 0) {
    return <div>No data available</div>;
  }
  
  return (
    <div className="space-y-4">
      {data.data.map(incident => (
        <Card key={incident.id} className="p-4">
          <h3 className="font-bold">{incident.event_type}</h3>
          <p className="text-sm text-gray-600">{incident.date}</p>
          <p>{incident.location.name}</p>
          <p>Fatalities: {incident.fatalities}, Injuries: {incident.injuries}</p>
          <div className="mt-2">
            <span className="text-xs bg-blue-100 px-2 py-1 rounded">
              Quality: {(incident.quality.score * 100).toFixed(0)}%
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

### Example 2: Data Table with Sorting

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { useState, useMemo } from 'react';

function ConflictTable() {
  const { data, isLoading } = useConflictData();
  const [sortBy, setSortBy] = useState<'date' | 'fatalities'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const sortedData = useMemo(() => {
    if (!data) return [];
    
    return [...data.data].sort((a, b) => {
      const aVal = sortBy === 'date' ? a.date : a.fatalities;
      const bVal = sortBy === 'date' ? b.date : b.fatalities;
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  }, [data, sortBy, sortOrder]);
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th onClick={() => setSortBy('date')}>Date</th>
          <th>Location</th>
          <th>Event Type</th>
          <th onClick={() => setSortBy('fatalities')}>Fatalities</th>
          <th>Injuries</th>
        </tr>
      </thead>
      <tbody>
        {sortedData.map(incident => (
          <tr key={incident.id}>
            <td>{incident.date}</td>
            <td>{incident.location.name}</td>
            <td>{incident.event_type}</td>
            <td>{incident.fatalities}</td>
            <td>{incident.injuries}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Charts and Visualizations

### Example 3: Time Series Chart

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useMemo } from 'react';

function CasualtyTrendChart() {
  const { data, isLoading } = useConflictData({
    dateRange: {
      start: '2024-01-01',
      end: '2024-12-31',
    },
  });
  
  const chartData = useMemo(() => {
    if (!data) return [];
    
    // Group by date
    const grouped = data.data.reduce((acc, incident) => {
      const date = incident.date;
      if (!acc[date]) {
        acc[date] = { date, fatalities: 0, injuries: 0 };
      }
      acc[date].fatalities += incident.fatalities;
      acc[date].injuries += incident.injuries;
      return acc;
    }, {} as Record<string, any>);
    
    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);
  
  if (isLoading) return <div>Loading chart...</div>;
  
  return (
    <LineChart width={800} height={400} data={chartData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="date" />
      <YAxis />
      <Tooltip />
      <Legend />
      <Line type="monotone" dataKey="fatalities" stroke="#ef4444" name="Fatalities" />
      <Line type="monotone" dataKey="injuries" stroke="#f59e0b" name="Injuries" />
    </LineChart>
  );
}
```

### Example 4: Bar Chart with Categories

```typescript
import { useInfrastructureData } from '@/hooks/useUnifiedData';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useMemo } from 'react';

function InfrastructureDamageChart() {
  const { data, isLoading } = useInfrastructureData({
    region: 'gaza',
  });
  
  const chartData = useMemo(() => {
    if (!data) return [];
    
    // Group by structure type and damage level
    const grouped = data.data.reduce((acc, item) => {
      const type = item.structure_type;
      if (!acc[type]) {
        acc[type] = {
          type,
          destroyed: 0,
          severe: 0,
          moderate: 0,
          minor: 0,
        };
      }
      
      if (item.damage_level === 'destroyed') acc[type].destroyed++;
      else if (item.damage_level === 'severe') acc[type].severe++;
      else if (item.damage_level === 'moderate') acc[type].moderate++;
      else if (item.damage_level === 'minor') acc[type].minor++;
      
      return acc;
    }, {} as Record<string, any>);
    
    return Object.values(grouped);
  }, [data]);
  
  if (isLoading) return <div>Loading chart...</div>;
  
  return (
    <BarChart width={800} height={400} data={chartData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="type" />
      <YAxis />
      <Tooltip />
      <Legend />
      <Bar dataKey="destroyed" fill="#dc2626" name="Destroyed" />
      <Bar dataKey="severe" fill="#ea580c" name="Severe" />
      <Bar dataKey="moderate" fill="#f59e0b" name="Moderate" />
      <Bar dataKey="minor" fill="#fbbf24" name="Minor" />
    </BarChart>
  );
}
```

### Example 5: Pie Chart

```typescript
import { useEconomicData } from '@/hooks/useUnifiedData';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { useMemo } from 'react';

function EconomicSectorChart() {
  const { data, isLoading } = useEconomicData();
  
  const chartData = useMemo(() => {
    if (!data) return [];
    
    // Filter for sector indicators
    const sectorData = data.data.filter(d => 
      d.indicator_name.includes('Agriculture') ||
      d.indicator_name.includes('Industry') ||
      d.indicator_name.includes('Services')
    );
    
    return sectorData.map(d => ({
      name: d.indicator_name,
      value: d.value as number,
    }));
  }, [data]);
  
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28'];
  
  if (isLoading) return <div>Loading chart...</div>;
  
  return (
    <PieChart width={400} height={400}>
      <Pie
        data={chartData}
        cx={200}
        cy={200}
        labelLine={false}
        label={(entry) => entry.name}
        outerRadius={80}
        fill="#8884d8"
        dataKey="value"
      >
        {chartData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
        ))}
      </Pie>
      <Tooltip />
      <Legend />
    </PieChart>
  );
}
```

## Maps and Geospatial

### Example 6: Interactive Map with Markers

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function ConflictMap() {
  const { data, isLoading } = useConflictData({
    region: 'gaza',
  });
  
  if (isLoading) return <div>Loading map...</div>;
  
  const incidents = data?.data.filter(d => d.location.coordinates) || [];
  
  return (
    <MapContainer
      center={[31.5, 34.4668]}
      zoom={10}
      style={{ height: '600px', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      
      {incidents.map(incident => (
        <Marker
          key={incident.id}
          position={[incident.location.coordinates![1], incident.location.coordinates![0]]}
        >
          <Popup>
            <div>
              <h3 className="font-bold">{incident.event_type}</h3>
              <p>{incident.date}</p>
              <p>{incident.location.name}</p>
              <p>Fatalities: {incident.fatalities}</p>
              <p>Injuries: {incident.injuries}</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
```

### Example 7: Heatmap

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { MapContainer, TileLayer } from 'react-leaflet';
import { HeatmapLayer } from 'react-leaflet-heatmap-layer-v3';

function ConflictHeatmap() {
  const { data, isLoading } = useConflictData({
    region: 'gaza',
  });
  
  if (isLoading) return <div>Loading heatmap...</div>;
  
  const points = data?.data
    .filter(d => d.location.coordinates)
    .map(d => ({
      lat: d.location.coordinates![1],
      lng: d.location.coordinates![0],
      intensity: d.fatalities + d.injuries,
    })) || [];
  
  return (
    <MapContainer
      center={[31.5, 34.4668]}
      zoom={10}
      style={{ height: '600px', width: '100%' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <HeatmapLayer
        points={points}
        longitudeExtractor={(p) => p.lng}
        latitudeExtractor={(p) => p.lat}
        intensityExtractor={(p) => p.intensity}
      />
    </MapContainer>
  );
}
```

## Filtering and Search

### Example 8: Advanced Filters

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { useState } from 'react';

function FilteredConflictList() {
  const [filters, setFilters] = useState({
    region: 'gaza' as const,
    dateRange: {
      start: '2024-01-01',
      end: '2024-12-31',
    },
    qualityThreshold: 0.8,
  });
  
  const { data, isLoading } = useConflictData(filters);
  
  return (
    <div>
      <div className="mb-4 space-y-2">
        <select
          value={filters.region}
          onChange={(e) => setFilters({ ...filters, region: e.target.value as any })}
          className="border p-2 rounded"
        >
          <option value="gaza">Gaza</option>
          <option value="west_bank">West Bank</option>
          <option value="east_jerusalem">East Jerusalem</option>
        </select>
        
        <input
          type="date"
          value={filters.dateRange.start}
          onChange={(e) => setFilters({
            ...filters,
            dateRange: { ...filters.dateRange, start: e.target.value },
          })}
          className="border p-2 rounded"
        />
        
        <input
          type="date"
          value={filters.dateRange.end}
          onChange={(e) => setFilters({
            ...filters,
            dateRange: { ...filters.dateRange, end: e.target.value },
          })}
          className="border p-2 rounded"
        />
        
        <label className="flex items-center gap-2">
          Quality Threshold:
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={filters.qualityThreshold}
            onChange={(e) => setFilters({
              ...filters,
              qualityThreshold: parseFloat(e.target.value),
            })}
          />
          {(filters.qualityThreshold * 100).toFixed(0)}%
        </label>
      </div>
      
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p className="mb-2">Found {data?.data.length} incidents</p>
          {data?.data.map(incident => (
            <div key={incident.id} className="border p-2 mb-2">
              {incident.event_type} - {incident.date}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Example 9: Search with Debounce

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { useState, useMemo } from 'react';
import { useDebounce } from '@/hooks/useDebounce';

function SearchableConflictList() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  
  const { data, isLoading } = useConflictData();
  
  const filteredData = useMemo(() => {
    if (!data || !debouncedSearch) return data?.data || [];
    
    const term = debouncedSearch.toLowerCase();
    return data.data.filter(incident =>
      incident.location.name.toLowerCase().includes(term) ||
      incident.event_type.toLowerCase().includes(term) ||
      incident.description.toLowerCase().includes(term)
    );
  }, [data, debouncedSearch]);
  
  return (
    <div>
      <input
        type="text"
        placeholder="Search incidents..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full border p-2 rounded mb-4"
      />
      
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p className="mb-2">Found {filteredData.length} incidents</p>
          {filteredData.map(incident => (
            <div key={incident.id} className="border p-2 mb-2">
              <h3 className="font-bold">{incident.event_type}</h3>
              <p>{incident.location.name} - {incident.date}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

## Data Export

### Example 10: Export Button

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { exportToJSON, exportToCSV, downloadExport } from '@/services/exportService';
import { Button } from '@/components/ui/button';

function ExportableConflictData() {
  const { data } = useConflictData();
  
  const handleExportJSON = () => {
    if (!data) return;
    
    const result = exportToJSON(data.data, data.metadata, {
      includeMetadata: true,
      includeRelationships: true,
      prettyPrint: true,
    });
    
    if (result.success) {
      downloadExport(result);
    } else {
      alert('Export failed: ' + result.error);
    }
  };
  
  const handleExportCSV = () => {
    if (!data) return;
    
    const result = exportToCSV(data.data, data.metadata, {
      csvDelimiter: ',',
      csvIncludeHeaders: true,
    });
    
    if (result.success) {
      downloadExport(result);
    }
  };
  
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <Button onClick={handleExportJSON}>Export JSON</Button>
        <Button onClick={handleExportCSV}>Export CSV</Button>
      </div>
      
      {/* Your data display */}
    </div>
  );
}
```

### Example 11: Bulk Export with Progress

```typescript
import { useConflictData, useEconomicData, useInfrastructureData } from '@/hooks/useUnifiedData';
import { bulkExport } from '@/services/exportService';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

function BulkExportButton() {
  const conflict = useConflictData();
  const economic = useEconomicData();
  const infrastructure = useInfrastructureData();
  
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  
  const handleBulkExport = async () => {
    if (!conflict.data || !economic.data || !infrastructure.data) return;
    
    setExporting(true);
    
    const datasets = [
      { data: conflict.data.data, metadata: conflict.data.metadata, format: 'json' as const },
      { data: economic.data.data, metadata: economic.data.metadata, format: 'csv' as const },
      { data: infrastructure.data.data, metadata: infrastructure.data.metadata, format: 'geojson' as const },
    ];
    
    const result = await bulkExport(datasets, {
      archiveFormat: 'zip',
      includeManifest: true,
      onProgress: (prog) => {
        setProgress(prog.percentage);
        setStatus(prog.status);
      },
    });
    
    setExporting(false);
    
    if (result.success) {
      alert('Bulk export complete!');
    } else {
      alert('Export failed: ' + result.error);
    }
  };
  
  return (
    <div>
      <Button onClick={handleBulkExport} disabled={exporting}>
        {exporting ? 'Exporting...' : 'Bulk Export All Data'}
      </Button>
      
      {exporting && (
        <div className="mt-4">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-600 mt-2">{status}</p>
        </div>
      )}
    </div>
  );
}
```

## Real-time Updates

### Example 12: Auto-refresh Data

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { useEffect } from 'react';

function AutoRefreshConflictData() {
  const { data, isLoading, refetch } = useConflictData();
  
  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [refetch]);
  
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2>Conflict Data (Auto-refreshing)</h2>
        <button onClick={() => refetch()} className="text-blue-600">
          Refresh Now
        </button>
      </div>
      
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          {data?.data.map(incident => (
            <div key={incident.id}>{incident.event_type}</div>
          ))}
        </div>
      )}
    </div>
  );
}
```

## Error Handling

### Example 13: Comprehensive Error Handling

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { Alert } from '@/components/ui/alert';

function RobustConflictDisplay() {
  const { data, isLoading, error, refetch } = useConflictData();
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }
  
  if (error) {
    return (
      <Alert variant="destructive">
        <h3 className="font-bold">Error Loading Data</h3>
        <p>{error.message}</p>
        <button onClick={() => refetch()} className="mt-2 underline">
          Try Again
        </button>
      </Alert>
    );
  }
  
  if (!data || data.data.length === 0) {
    return (
      <Alert>
        <h3 className="font-bold">No Data Available</h3>
        <p>There is no conflict data matching your filters.</p>
      </Alert>
    );
  }
  
  // Check data quality
  const lowQualityCount = data.data.filter(d => d.quality.score < 0.7).length;
  
  return (
    <div>
      {lowQualityCount > 0 && (
        <Alert variant="warning" className="mb-4">
          <p>{lowQualityCount} records have low quality scores (&lt; 70%)</p>
        </Alert>
      )}
      
      {data.data.map(incident => (
        <div key={incident.id} className="border p-4 mb-2">
          <h3>{incident.event_type}</h3>
          <p>{incident.location.name} - {incident.date}</p>
          
          {incident.quality.score < 0.7 && (
            <span className="text-xs text-yellow-600">⚠️ Low Quality</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Performance Optimization

### Example 14: Virtualized List

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { FixedSizeList } from 'react-window';

function VirtualizedConflictList() {
  const { data, isLoading } = useConflictData();
  
  if (isLoading) return <div>Loading...</div>;
  if (!data) return null;
  
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const incident = data.data[index];
    
    return (
      <div style={style} className="border-b p-2">
        <h3 className="font-bold">{incident.event_type}</h3>
        <p className="text-sm">{incident.location.name} - {incident.date}</p>
      </div>
    );
  };
  
  return (
    <FixedSizeList
      height={600}
      itemCount={data.data.length}
      itemSize={80}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}
```

### Example 15: Memoized Calculations

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';
import { useMemo } from 'react';

function ConflictStatistics() {
  const { data, isLoading } = useConflictData();
  
  const statistics = useMemo(() => {
    if (!data) return null;
    
    const totalFatalities = data.data.reduce((sum, d) => sum + d.fatalities, 0);
    const totalInjuries = data.data.reduce((sum, d) => sum + d.injuries, 0);
    const avgQuality = data.data.reduce((sum, d) => sum + d.quality.score, 0) / data.data.length;
    
    const byRegion = data.data.reduce((acc, d) => {
      const region = d.location.region;
      if (!acc[region]) acc[region] = 0;
      acc[region]++;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalIncidents: data.data.length,
      totalFatalities,
      totalInjuries,
      avgQuality,
      byRegion,
    };
  }, [data]);
  
  if (isLoading) return <div>Loading...</div>;
  if (!statistics) return null;
  
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="border p-4">
        <h3 className="font-bold">Total Incidents</h3>
        <p className="text-3xl">{statistics.totalIncidents}</p>
      </div>
      
      <div className="border p-4">
        <h3 className="font-bold">Total Fatalities</h3>
        <p className="text-3xl">{statistics.totalFatalities}</p>
      </div>
      
      <div className="border p-4">
        <h3 className="font-bold">Total Injuries</h3>
        <p className="text-3xl">{statistics.totalInjuries}</p>
      </div>
      
      <div className="border p-4">
        <h3 className="font-bold">Avg Quality</h3>
        <p className="text-3xl">{(statistics.avgQuality * 100).toFixed(0)}%</p>
      </div>
    </div>
  );
}
```

## Additional Resources

- [Unified Data System Guide](./UNIFIED_DATA_SYSTEM.md)
- [API Reference](./UNIFIED_DATA_API.md)
- [Component Guide](./COMPONENTS.md)
- [Development Guide](./DEVELOPMENT.md)

