# Data Directory

This directory contains all the data collected and processed by the Palestine Data Backend.

## Note on Large Files

Some data files are too large for GitHub (>100MB) and are excluded from the repository. These files are automatically generated when you run the data collection scripts.

### Excluded Files (Generated Automatically)

The following files are excluded but will be created when you run `npm run update-data`:

- `data/hdx/refugees/movement-distribution/data.csv.json` (~256 MB)
- `data/hdx/water/open_weekly_water_access/data.csv.json` (~115 MB)
- `data/hdx/water/open_weekly_water_access/transformed.json` (~137 MB)
- `data/unified/water/*.json` (~125 MB each)
- `data/unified/health/*.json` (~54 MB each)

## How to Generate Data

To generate all data files including the large ones:

```bash
# Install dependencies
npm install

# Fetch and process all data
npm run update-data
```

This will:
1. Fetch data from all 9 sources
2. Transform to unified format
3. Generate all data files including large ones
4. Validate data quality

## Data Structure

```
data/
├── sources/              # Raw data from each source
│   ├── worldbank/
│   ├── pcbs/
│   ├── hdx/
│   ├── goodshepherd/
│   ├── who/
│   ├── unrwa/
│   ├── tech4palestine/
│   ├── wfp/
│   └── btselem/
├── unified/              # Transformed unified data
│   ├── economic/
│   ├── conflict/
│   ├── infrastructure/
│   ├── humanitarian/
│   ├── health/          # Large files - generated
│   ├── education/
│   ├── water/           # Large files - generated
│   ├── refugees/
│   └── pcbs/
├── relationships/        # Cross-dataset links
└── manifest.json         # Global data index
```

## File Sizes

- **Total with all data**: ~500 MB
- **Repository size**: ~50 MB (without large generated files)
- **Generated files**: ~450 MB (created by scripts)

## Quick Start

```bash
# Fetch all data
npm run update-data

# Or fetch specific sources
npm run fetch-worldbank
npm run fetch-pcbs
npm run fetch-hdx-ckan
```

See [QUICK_START.md](../QUICK_START.md) for more details.
