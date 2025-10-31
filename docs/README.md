# Palestine Pulse V3 Documentation

Real-time humanitarian data visualization platform for Palestine.

## Quick Links

- **[Getting Started](START_HERE.md)** - Setup and first steps
- **[Project Structure](guides/PROJECT_STRUCTURE.md)** - Understanding the codebase
- **[Data Guide](guides/DATA_GUIDE.md)** - Working with data sources
- **[Development Guide](guides/DEVELOPMENT.md)** - Development workflow
- **[Deployment](guides/DEPLOYMENT.md)** - Production deployment

## Overview

Palestine Pulse V3 is a React-based dashboard application that visualizes humanitarian data from multiple trusted sources. The application features two main dashboards:

### Gaza War Dashboard
Tracks the humanitarian situation in Gaza through:
- Humanitarian Crisis metrics
- Infrastructure Destruction data
- Population Impact statistics
- Aid & Survival indicators

### West Bank Dashboard
Documents the occupation through:
- Occupation Metrics (settlements, checkpoints)
- Settler Violence tracking
- Economic Strangulation indicators
- Prisoners & Detention statistics

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui
- **State**: Zustand + TanStack Query
- **Charts**: Recharts + D3.js + Leaflet
- **Data**: Local JSON files (fetched via scripts)

### Data Flow
```
External APIs
    ↓
scripts/fetch-*.js (Download data)
    ↓
public/data/*.json (Local storage)
    ↓
Services (Load & transform)
    ↓
Hooks (React Query)
    ↓
Components (Display)
```

## Data Sources

| Source | Status | Description |
|--------|--------|-------------|
| Tech for Palestine | ✅ Active | Core casualty and infrastructure data |
| Good Shepherd Collective | ✅ Active | Violence, demolitions, detentions |
| World Bank | ✅ Active | Economic indicators (70+ indicators) |
| WFP | ✅ Active | Food security data |
| B'Tselem | ✅ Active | Checkpoint data |
| UN OCHA (HDX) | ✅ Active | Humanitarian access data (40+ datasets) |
| WHO | ✅ Active | Health indicators (via HDX) |
| **PCBS** | **✅ Active** | **Official statistics (67 indicators, 845 records)** |
| UNRWA | ✅ Active | Refugee data and services |

**Total**: 9 active data sources, fully automated with daily updates

## Key Features

- **Dual Dashboard System** - Separate Gaza and West Bank views
- **Real-Time Data** - Automatic data refresh system
- **Interactive Visualizations** - 15+ chart types
- **Data Transparency** - Source attribution and quality indicators
- **Offline Support** - IndexedDB caching
- **Responsive Design** - Mobile-first approach
- **Internationalization** - Multi-language support (i18n ready)

## Project Structure

```
palestine-pulse/
├── src/
│   ├── components/        # React components
│   │   ├── v3/           # V3 dashboard components
│   │   ├── charts/       # Chart components
│   │   └── ui/           # UI primitives
│   ├── pages/            # Page components
│   │   └── v3/           # Gaza & West Bank dashboards
│   ├── services/         # Data services
│   ├── hooks/            # Custom React hooks
│   ├── utils/            # Utility functions
│   ├── store/            # Zustand stores
│   └── types/            # TypeScript types
├── public/
│   └── data/             # Local data files
├── scripts/              # Data fetching scripts
└── docs/                 # Documentation
```

## Development

### Prerequisites
- Node.js 18+
- npm or bun

### Quick Start
```bash
# Install dependencies
npm install

# Fetch data
npm run update-data

# Start dev server
npm run dev
```

### Available Scripts
```bash
npm run dev              # Start development server
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run ESLint

# Data Management
npm run update-data      # Complete pipeline (fetch + transform + validate)
npm run fetch-all-data   # Fetch from all 9 data sources
npm run populate-unified # Transform to unified format
npm run validate-data    # Validate data quality

# Individual Sources
npm run fetch-pcbs       # Fetch PCBS official statistics
npm run fetch-who        # Fetch WHO health data
npm run fetch-unrwa      # Fetch UNRWA refugee data
npm run fetch-worldbank  # Fetch World Bank indicators
npm run fetch-hdx-data   # Fetch HDX humanitarian data
```

## Documentation

- **[Getting Started](START_HERE.md)** - Setup guide
- **[Project Structure](guides/PROJECT_STRUCTURE.md)** - Codebase organization
- **[Data Guide](guides/DATA_GUIDE.md)** - Working with data
- **[Development Guide](guides/DEVELOPMENT.md)** - Development workflow
- **[Component Guide](guides/COMPONENTS.md)** - Component architecture
- **[Deployment](guides/DEPLOYMENT.md)** - Production deployment
- **[API Reference](api/)** - API integration docs
- **[Troubleshooting](troubleshooting/)** - Common issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License
