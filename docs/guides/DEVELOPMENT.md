# Development Guide

## Development Workflow

### Daily Development

```bash
# 1. Start development server
npm run dev

# 2. Open browser
# http://localhost:5173

# 3. Make changes
# Vite will hot-reload automatically

# 4. Test changes
# Check both Gaza and West Bank dashboards
```

### Before Committing

```bash
# 1. Lint code
npm run lint

# 2. Build to check for errors
npm run build

# 3. Test the build
npm run preview

# 4. Update data if needed
npm run update-data
```

## Project Commands

### Development
```bash
npm run dev              # Start dev server (port 5173)
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run ESLint
```

### Data Management
```bash
npm run update-data              # Fetch all + validate
npm run fetch-all-data           # Fetch from all sources
npm run fetch-goodshepherd       # Fetch Good Shepherd data
npm run fetch-worldbank          # Fetch World Bank data
npm run fetch-hdx-data           # Fetch HDX/OCHA data
npm run validate-data            # Validate downloaded data
npm run generate-manifest        # Generate manifest.json
```

### B'Tselem Data
```bash
npm run update-btselem-data      # Scrape B'Tselem checkpoints
```

## Making Changes

### Adding a New Component

1. **Create component file**
```bash
# Gaza component
src/components/v3/gaza/NewFeature.tsx

# West Bank component
src/components/v3/westbank/NewFeature.tsx

# Shared component
src/components/v3/shared/NewFeature.tsx
```

2. **Implement component**
```typescript
import { Card } from '@/components/ui/card';
import { useRecentData } from '@/hooks/useUnifiedData';

export function NewFeature() {
  const { data, isLoading } = useRecentData('casualties');
  
  if (isLoading) return <Skeleton />;
  
  return (
    <Card>
      {/* Component content */}
    </Card>
  );
}
```

3. **Add to dashboard**
```typescript
// src/pages/v3/GazaWarDashboard.tsx
import { NewFeature } from '@/components/v3/gaza/NewFeature';

<TabsContent value="humanitarian">
  <NewFeature />
</TabsContent>
```

4. **Test**
- Check loading state
- Check error handling
- Check responsiveness
- Check dark mode

### Adding a New Data Source

1. **Create fetch script**
```javascript
// scripts/fetch-newsource-data.js
import fs from 'fs';
import path from 'path';

async function fetchNewSourceData() {
  try {
    const response = await fetch('https://api.newsource.org/data');
    const data = await response.json();
    
    const outputDir = 'public/data/newsource';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(outputDir, 'data.json'),
      JSON.stringify(data, null, 2)
    );
    
    console.log('✅ New source data fetched successfully');
  } catch (error) {
    console.error('❌ Error fetching new source:', error);
  }
}

fetchNewSourceData();
```

2. **Add to package.json**
```json
{
  "scripts": {
    "fetch-newsource": "node scripts/fetch-newsource-data.js"
  }
}
```

3. **Create service**
```typescript
// src/services/newSourceService.ts
export async function fetchNewSourceData() {
  const response = await fetch('/data/newsource/data.json');
  if (!response.ok) throw new Error('Failed to fetch');
  return response.json();
}
```

4. **Create hook**
```typescript
// src/hooks/useNewSource.ts
import { useQuery } from '@tanstack/react-query';
import { fetchNewSourceData } from '@/services/newSourceService';

export function useNewSourceData() {
  return useQuery({
    queryKey: ['newsource'],
    queryFn: fetchNewSourceData,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
```

5. **Use in components**
```typescript
import { useNewSourceData } from '@/hooks/useNewSource';

const { data } = useNewSourceData();
```

### Modifying Existing Components

1. **Find the component**
```bash
# Gaza components
src/components/v3/gaza/

# West Bank components
src/components/v3/westbank/

# Shared components
src/components/v3/shared/
```

2. **Make changes**
- Update component logic
- Update styles
- Update data handling

3. **Test changes**
- Check in browser
- Test loading states
- Test error states
- Check responsiveness

### Adding a New Chart

1. **Choose chart type**
- Area Chart - Time series
- Bar Chart - Comparisons
- Line Chart - Multiple series
- Pie Chart - Proportions

2. **Create chart component**
```typescript
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

export function MyChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Area 
          type="monotone" 
          dataKey="value" 
          stroke="#3b82f6" 
          fill="#3b82f6" 
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

3. **Add to component**
```typescript
<Card>
  <CardHeader>
    <CardTitle>My Chart</CardTitle>
    <EnhancedDataSourceBadge source="tech4palestine" />
  </CardHeader>
  <CardContent>
    <MyChart data={chartData} />
  </CardContent>
</Card>
```

## Testing

### Manual Testing Checklist

**For Each Change:**
- [ ] Component renders correctly
- [ ] Loading state works
- [ ] Error state works
- [ ] Data displays correctly
- [ ] Responsive on mobile
- [ ] Works in dark mode
- [ ] Accessible (keyboard nav)

**For Data Changes:**
- [ ] Data fetches successfully
- [ ] Data validates correctly
- [ ] Data transforms correctly
- [ ] Charts display correctly

**Before Deployment:**
- [ ] Build succeeds
- [ ] No console errors
- [ ] All dashboards work
- [ ] Data is up-to-date
- [ ] Performance is good

### Testing Data Sources

```bash
# Fetch and validate
npm run update-data

# Check data files
ls public/data/

# Check manifest
cat public/data/manifest.json

# Test in browser
npm run dev
# Navigate to dashboards
```

## Debugging

### Common Issues

**Data Not Loading:**
```bash
# 1. Check if data exists
ls public/data/

# 2. Re-fetch data
npm run update-data

# 3. Check browser console
# Open DevTools > Console

# 4. Check network tab
# Open DevTools > Network
```

**Build Errors:**
```bash
# 1. Check TypeScript errors
npm run build

# 2. Fix type errors
# Update types in src/types/

# 3. Check imports
# Verify all imports are correct
```

**Component Not Rendering:**
```typescript
// 1. Add console.log
console.log('Component rendering', { data, isLoading });

// 2. Check React DevTools
// Install React DevTools extension

// 3. Check props
// Verify props are passed correctly
```

### Browser DevTools

**Console:**
- Check for errors
- Check for warnings
- Add console.log for debugging

**Network:**
- Check data file requests
- Check response status
- Check response data

**React DevTools:**
- Inspect component tree
- Check component props
- Check component state

**Performance:**
- Check render times
- Check memory usage
- Profile components

## Code Style

### TypeScript

```typescript
// Use interfaces for props
interface MyComponentProps {
  data: CasualtyData[];
  isLoading?: boolean;
}

// Use type for unions
type Status = 'loading' | 'success' | 'error';

// Export types
export type { MyComponentProps, Status };
```

### React

```typescript
// Use functional components
export function MyComponent({ data }: Props) {
  // Hooks at top
  const [state, setState] = useState();
  const { data } = useQuery();
  
  // Memoized values
  const computed = useMemo(() => transform(data), [data]);
  
  // Callbacks
  const handleClick = useCallback(() => {}, []);
  
  // Effects
  useEffect(() => {}, []);
  
  // Render
  return <div>{/* JSX */}</div>;
}
```

### Styling

```typescript
// Use Tailwind classes
className="container mx-auto p-4"

// Use cn() for conditional classes
import { cn } from '@/lib/utils';

className={cn(
  "base-classes",
  isActive && "active-classes",
  variant === "primary" && "primary-classes"
)}
```

## Git Workflow

### Branching

```bash
# Create feature branch
git checkout -b feature/new-feature

# Make changes
git add .
git commit -m "Add new feature"

# Push to remote
git push origin feature/new-feature

# Create pull request
# On GitHub/GitLab
```

### Commit Messages

```bash
# Format: type(scope): message

# Examples:
git commit -m "feat(gaza): add new casualty chart"
git commit -m "fix(data): correct prisoner data transformation"
git commit -m "docs: update development guide"
git commit -m "style: improve dashboard layout"
git commit -m "refactor(hooks): simplify data fetching"
```

## Performance

### Optimization Tips

1. **Memoize expensive computations**
```typescript
const chartData = useMemo(() => 
  transformData(rawData), 
  [rawData]
);
```

2. **Use React Query caching**
```typescript
useQuery({
  queryKey: ['data'],
  queryFn: fetchData,
  staleTime: 1000 * 60 * 5, // 5 minutes
});
```

3. **Lazy load heavy components**
```typescript
const HeavyChart = lazy(() => import('./HeavyChart'));
```

4. **Virtualize long lists**
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
```

5. **Optimize images**
- Use WebP format
- Compress images
- Use appropriate sizes

## Deployment

See [Deployment Guide](DEPLOYMENT.md) for production deployment.

## Resources

- [React Docs](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [Recharts](https://recharts.org)
- [TanStack Query](https://tanstack.com/query)
- [Vite](https://vitejs.dev)

## Getting Help

- Check [Troubleshooting](../troubleshooting/DATA_SOURCE_TROUBLESHOOTING.md)
- Review component examples in `src/components/v3/`
- Check existing implementations
- Read library documentation
