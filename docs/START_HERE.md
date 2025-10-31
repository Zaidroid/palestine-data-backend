# Getting Started with Palestine Pulse V3

## Quick Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Fetch Data
```bash
npm run update-data
```

This will:
- Download data from all sources
- Store it in `public/data/`
- Generate a manifest file
- Validate the data

### 3. Start Development Server
```bash
npm run dev
```

Open http://localhost:5173

### 4. Explore the Dashboards

**Gaza Dashboard**: http://localhost:5173/gaza
- Humanitarian Crisis
- Infrastructure Destruction
- Population Impact
- Aid & Survival

**West Bank Dashboard**: http://localhost:5173/west-bank
- Occupation Metrics
- Settler Violence
- Economic Strangulation
- Prisoners & Detention

## Project Structure

```
palestine-pulse/
├── src/
│   ├── pages/v3/              # Main dashboards
│   │   ├── GazaWarDashboard.tsx
│   │   └── WestBankDashboard.tsx
│   ├── components/v3/         # Dashboard components
│   │   ├── gaza/             # Gaza-specific
│   │   ├── westbank/         # West Bank-specific
│   │   └── shared/           # Shared components
│   ├── services/             # Data services
│   ├── hooks/                # Custom hooks
│   └── utils/                # Transformations
├── public/data/              # Local data files
└── scripts/                  # Data fetching
```

## Understanding the Data Flow

1. **Fetch Scripts** (`scripts/fetch-*.js`)
   - Download data from external APIs
   - Store as JSON in `public/data/`

2. **Services** (`src/services/`)
   - Load local JSON files
   - Transform and normalize data

3. **Hooks** (`src/hooks/`)
   - Use React Query for caching
   - Provide data to components

4. **Components** (`src/components/v3/`)
   - Display data with charts
   - Handle user interactions

## Key Concepts

### Data Sources
All data is fetched locally (no runtime API calls):
- Tech for Palestine - Casualties, infrastructure
- Good Shepherd - Violence, demolitions, prisoners
- World Bank - Economic indicators
- WFP - Food security
- B'Tselem - Checkpoints

### Data Updates
```bash
# Update all data sources
npm run update-data

# Update specific source
npm run fetch-goodshepherd
npm run fetch-worldbank
```

### State Management
- **Zustand** - Global state (v3Store)
- **TanStack Query** - Data fetching and caching
- **IndexedDB** - Offline storage

## Common Tasks

### Adding a New Chart
1. Create component in `src/components/v3/[region]/`
2. Use data from hooks (`useUnifiedData`, etc.)
3. Import in dashboard page
4. Add to appropriate tab

### Modifying Data Transformations
1. Find transformation in `src/utils/*Transformations.ts`
2. Update transformation logic
3. Test with real data

### Updating Data Sources
1. Modify fetch script in `scripts/fetch-*.js`
2. Run `npm run update-data`
3. Verify data in `public/data/`

## Development Workflow

### Daily Development
```bash
# Start dev server
npm run dev

# In another terminal, watch for changes
# (Vite handles hot reload automatically)
```

### Before Committing
```bash
# Lint code
npm run lint

# Build to check for errors
npm run build

# Test the build
npm run preview
```

### Updating Data
```bash
# Update all sources (recommended weekly)
npm run update-data

# Or update individually
npm run fetch-goodshepherd
npm run fetch-worldbank
npm run fetch-hdx-data
```

## Next Steps

1. **Explore the Code**
   - Read [Project Structure](guides/PROJECT_STRUCTURE.md)
   - Check [Component Guide](guides/COMPONENTS.md)

2. **Understand Data**
   - Read [Data Guide](guides/DATA_GUIDE.md)
   - Check data files in `public/data/`

3. **Start Developing**
   - Read [Development Guide](guides/DEVELOPMENT.md)
   - Make your first change

4. **Deploy**
   - Read [Deployment Guide](guides/DEPLOYMENT.md)
   - Deploy to Netlify

## Troubleshooting

### Data Not Loading
```bash
# Re-fetch data
npm run update-data

# Check data files exist
ls public/data/
```

### Build Errors
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Port Already in Use
```bash
# Vite will automatically use next available port
# Or specify port: npm run dev -- --port 3000
```

## Getting Help

- Check [Troubleshooting Guide](troubleshooting/DATA_SOURCE_TROUBLESHOOTING.md)
- Review [Development Guide](guides/DEVELOPMENT.md)
- Check component examples in `src/components/v3/`

## Resources

- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [Recharts](https://recharts.org)
- [TanStack Query](https://tanstack.com/query)
