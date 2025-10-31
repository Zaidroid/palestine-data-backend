# Component Guide

## Overview

Palestine Pulse V3 uses a component-based architecture with React, TypeScript, and shadcn/ui. This guide covers component patterns, best practices, and common use cases.

## Component Types

### 1. Dashboard Pages
Top-level pages that orchestrate the entire dashboard view.

**Location**: `src/pages/v3/`

**Example**:
```typescript
// GazaWarDashboard.tsx
export default function GazaWarDashboard() {
  const { consolidatedData, isLoading } = useV3Store();
  
  return (
    <div className="container mx-auto p-4">
      <Tabs defaultValue="humanitarian">
        <TabsList>
          <TabsTrigger value="humanitarian">Humanitarian Crisis</TabsTrigger>
          <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
          <TabsTrigger value="population">Population Impact</TabsTrigger>
          <TabsTrigger value="aid">Aid & Survival</TabsTrigger>
        </TabsList>
        
        <TabsContent value="humanitarian">
          <HumanitarianCrisis data={consolidatedData} />
        </TabsContent>
        {/* ... other tabs */}
      </Tabs>
    </div>
  );
}
```

### 2. Feature Components
Components that represent a complete feature or section.

**Location**: `src/components/v3/[region]/`

**Example**:
```typescript
// components/v3/gaza/HumanitarianCrisis.tsx
export function HumanitarianCrisis({ data }: Props) {
  const casualties = useRecentData('casualties');
  const demographics = useMemo(() => 
    transformDemographics(casualties.data), 
    [casualties.data]
  );
  
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CasualtyOverview data={casualties.data} />
      <DemographicBreakdown data={demographics} />
      <TimelineChart data={casualties.data} />
      <ImpactMetrics data={data} />
    </div>
  );
}
```

### 3. Chart Components
Reusable chart components using Recharts.

**Location**: `src/components/charts/`

**Example**:
```typescript
// components/charts/CasualtyChart.tsx
export function CasualtyChart({ data }: ChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Casualties Over Time</CardTitle>
        <EnhancedDataSourceBadge source="tech4palestine" />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Area 
              type="monotone" 
              dataKey="casualties" 
              stroke="#ef4444" 
              fill="#ef4444" 
              fillOpacity={0.6}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
```

### 4. UI Primitives
Base UI components from shadcn/ui.

**Location**: `src/components/ui/`

**Usage**:
```typescript
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
```

### 5. Shared Components
Components used across multiple dashboards.

**Location**: `src/components/v3/shared/`

**Examples**:
- `EnhancedDataSourceBadge` - Data source attribution
- `AnalyticsPanel` - Analytics insights
- `PerformanceDashboard` - Performance metrics
- `ExportButton` - Export functionality

## Common Patterns

### Data Loading Pattern
```typescript
export function MyComponent() {
  const { data, isLoading, error } = useRecentData('casualties');
  
  if (isLoading) {
    return <Skeleton className="h-[400px]" />;
  }
  
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  
  return <Chart data={data} />;
}
```

### Data Transformation Pattern
```typescript
export function TransformedChart() {
  const { data } = useRecentData('casualties');
  
  const chartData = useMemo(() => {
    if (!data) return [];
    return transformCasualties(data);
  }, [data]);
  
  return <AreaChart data={chartData} />;
}
```

### Responsive Grid Pattern
```typescript
export function DashboardSection() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <MetricCard title="Total" value={1000} />
      <MetricCard title="Children" value={400} />
      <MetricCard title="Women" value={300} />
    </div>
  );
}
```

### Card with Badge Pattern
```typescript
export function DataCard({ data, source }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Casualties</CardTitle>
          <EnhancedDataSourceBadge source={source} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{data.total}</div>
      </CardContent>
    </Card>
  );
}
```

## Chart Types

### Area Chart
Best for: Time series data, trends over time

```typescript
<ResponsiveContainer width="100%" height={300}>
  <AreaChart data={data}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="date" />
    <YAxis />
    <Tooltip />
    <Area 
      type="monotone" 
      dataKey="value" 
      stroke="#3b82f6" 
      fill="#3b82f6" 
      fillOpacity={0.6}
    />
  </AreaChart>
</ResponsiveContainer>
```

### Bar Chart
Best for: Comparisons, categorical data

```typescript
<ResponsiveContainer width="100%" height={300}>
  <BarChart data={data}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="category" />
    <YAxis />
    <Tooltip />
    <Bar dataKey="value" fill="#3b82f6" />
  </BarChart>
</ResponsiveContainer>
```

### Line Chart
Best for: Multiple series, comparisons over time

```typescript
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="date" />
    <YAxis />
    <Tooltip />
    <Legend />
    <Line type="monotone" dataKey="series1" stroke="#3b82f6" />
    <Line type="monotone" dataKey="series2" stroke="#ef4444" />
  </LineChart>
</ResponsiveContainer>
```

### Pie/Donut Chart
Best for: Proportions, percentages

```typescript
<ResponsiveContainer width="100%" height={300}>
  <PieChart>
    <Pie
      data={data}
      cx="50%"
      cy="50%"
      innerRadius={60}
      outerRadius={80}
      fill="#3b82f6"
      dataKey="value"
      label
    >
      {data.map((entry, index) => (
        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
      ))}
    </Pie>
    <Tooltip />
  </PieChart>
</ResponsiveContainer>
```

## Data Source Badges

Show data source attribution:

```typescript
import { EnhancedDataSourceBadge } from '@/components/v3/shared/EnhancedDataSourceBadge';

<EnhancedDataSourceBadge 
  source="tech4palestine"
  showQuality={true}
  showLastUpdate={true}
/>
```

Available sources:
- `tech4palestine`
- `goodshepherd`
- `world_bank`
- `wfp`
- `btselem`
- `un_ocha`

## Export Functionality

Add export buttons to charts:

```typescript
import { exportChart, generateChartFilename } from '@/lib/chart-export';

<Button
  onClick={() => {
    const filename = generateChartFilename('casualties', 'png');
    exportChart(chartRef.current, filename, 'png');
  }}
>
  <Download className="mr-2 h-4 w-4" />
  Export PNG
</Button>
```

## Styling

### Tailwind Classes
```typescript
// Layout
className="container mx-auto p-4"
className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
className="flex items-center justify-between"

// Spacing
className="space-y-4"
className="gap-4"
className="p-4"

// Typography
className="text-3xl font-bold"
className="text-sm text-muted-foreground"

// Colors
className="text-destructive"
className="bg-primary text-primary-foreground"
```

### Dark Mode
Components automatically support dark mode via `next-themes`:

```typescript
// Colors adapt automatically
className="bg-background text-foreground"
className="border border-border"
```

## Accessibility

### Keyboard Navigation
```typescript
<Button
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleClick();
    }
  }}
>
  Click Me
</Button>
```

### ARIA Labels
```typescript
<button
  aria-label="Export chart as PNG"
  aria-describedby="export-description"
>
  <Download />
</button>
```

### Screen Reader Support
```typescript
<div role="region" aria-label="Casualties statistics">
  <h2 id="casualties-title">Casualties</h2>
  <div aria-labelledby="casualties-title">
    {/* Content */}
  </div>
</div>
```

## Performance

### Memoization
```typescript
const chartData = useMemo(() => 
  transformData(rawData), 
  [rawData]
);

const handleClick = useCallback(() => {
  // Handler logic
}, [dependencies]);
```

### Lazy Loading
```typescript
const HeavyComponent = lazy(() => import('./HeavyComponent'));

<Suspense fallback={<Skeleton />}>
  <HeavyComponent />
</Suspense>
```

### Virtualization
For large lists:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 50,
});
```

## Best Practices

1. **Keep components small** - Single responsibility
2. **Use TypeScript** - Define prop types
3. **Memoize expensive operations** - useMemo, useCallback
4. **Handle loading states** - Show skeletons
5. **Handle error states** - Show error messages
6. **Add data source badges** - Attribution
7. **Support dark mode** - Use theme colors
8. **Make accessible** - ARIA labels, keyboard nav
9. **Export functionality** - Allow data export
10. **Responsive design** - Mobile-first

## Creating New Components

### 1. Create Component File
```typescript
// src/components/v3/gaza/NewFeature.tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useRecentData } from '@/hooks/useUnifiedData';

interface NewFeatureProps {
  data?: any;
}

export function NewFeature({ data }: NewFeatureProps) {
  const { data: liveData, isLoading } = useRecentData('casualties');
  
  if (isLoading) return <Skeleton className="h-[400px]" />;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>New Feature</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Component content */}
      </CardContent>
    </Card>
  );
}
```

### 2. Add to Dashboard
```typescript
// src/pages/v3/GazaWarDashboard.tsx
import { NewFeature } from '@/components/v3/gaza/NewFeature';

<TabsContent value="humanitarian">
  <div className="grid gap-4">
    <HumanitarianCrisis />
    <NewFeature />
  </div>
</TabsContent>
```

### 3. Test Component
- Check loading state
- Check error state
- Check data display
- Check responsiveness
- Check dark mode
- Check accessibility

## Next Steps

- Read [Development Guide](DEVELOPMENT.md) for workflow
- Read [Data Guide](DATA_GUIDE.md) for data handling
- Check shadcn/ui docs for UI components
- Check Recharts docs for chart options
