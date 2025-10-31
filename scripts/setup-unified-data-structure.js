#!/usr/bin/env node

/**
 * Setup Unified Data Directory Structure
 * 
 * Creates the complete directory structure for the unified data system:
 * - public/data/unified/ with category subdirectories
 * - public/data/sources/ for source-specific raw data
 * - public/data/relationships/ for cross-dataset links
 * - Initializes metadata.json, all-data.json, recent.json, and partitions/ in each category
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data categories based on the unified data model
const DATA_CATEGORIES = [
  'conflict',
  'economic',
  'infrastructure',
  'humanitarian',
  'education',
  'health',
  'water',
  'refugees'
];

// Data sources
const DATA_SOURCES = [
  'tech4palestine',
  'worldbank',
  'hdx',
  'goodshepherd',
  'who',
  'unrwa',
  'pcbs',
  'wfp',
  'btselem'
];

// Base directories
const BASE_DIR = path.join(path.dirname(__dirname), 'public', 'data');
const UNIFIED_DIR = path.join(BASE_DIR, 'unified');
const SOURCES_DIR = path.join(BASE_DIR, 'sources');
const RELATIONSHIPS_DIR = path.join(BASE_DIR, 'relationships');

/**
 * Create directory if it doesn't exist
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✓ Created directory: ${path.relative(path.dirname(__dirname), dirPath)}`);
    return true;
  }
  console.log(`  Directory already exists: ${path.relative(path.dirname(__dirname), dirPath)}`);
  return false;
}

/**
 * Create file with initial content if it doesn't exist
 */
function ensureFile(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Created file: ${path.relative(path.dirname(__dirname), filePath)}`);
    return true;
  }
  console.log(`  File already exists: ${path.relative(path.dirname(__dirname), filePath)}`);
  return false;
}

/**
 * Create metadata template for a category
 */
function createMetadataTemplate(category) {
  return JSON.stringify({
    id: `unified-${category}`,
    name: `Unified ${category.charAt(0).toUpperCase() + category.slice(1)} Data`,
    category: category,
    description: `Unified and enriched ${category} data from multiple sources`,
    version: '1.0.0',
    last_updated: new Date().toISOString(),
    update_frequency: 'varies',
    record_count: 0,
    date_range: {
      start: null,
      end: null
    },
    quality: {
      score: 0,
      completeness: 0,
      consistency: 0,
      accuracy: 0,
      verified: false,
      confidence: 0
    },
    partitioned: false,
    partition_count: 0,
    fields: [
      { name: 'id', type: 'string', description: 'Unique identifier' },
      { name: 'type', type: 'string', description: 'Data type' },
      { name: 'category', type: 'string', description: 'Data category' },
      { name: 'date', type: 'string', description: 'Date in ISO 8601 format (YYYY-MM-DD)' },
      { name: 'location', type: 'object', description: 'Location data with coordinates and admin levels' },
      { name: 'value', type: 'any', description: 'Primary data value' },
      { name: 'quality', type: 'object', description: 'Quality metrics' },
      { name: 'sources', type: 'array', description: 'Source information' },
      { name: 'related_data', type: 'object', description: 'Links to related data' }
    ],
    relationships: [],
    sources: []
  }, null, 2);
}

/**
 * Create empty data array template
 */
function createDataTemplate() {
  return JSON.stringify({
    data: [],
    metadata: {
      total_records: 0,
      generated_at: new Date().toISOString()
    }
  }, null, 2);
}

/**
 * Create partition index template
 */
function createPartitionIndexTemplate() {
  return JSON.stringify({
    partitions: [],
    total_partitions: 0,
    total_records: 0,
    generated_at: new Date().toISOString()
  }, null, 2);
}

/**
 * Create relationship template
 */
function createRelationshipTemplate(type) {
  return JSON.stringify({
    relationship_type: type,
    description: `Links between ${type.replace('-', ' and ')} datasets`,
    links: [],
    metadata: {
      total_links: 0,
      last_updated: new Date().toISOString(),
      confidence_threshold: 0.7
    }
  }, null, 2);
}

/**
 * Setup unified data structure
 */
function setupUnifiedStructure() {
  console.log('\n=== Setting up Unified Data Structure ===\n');
  
  let created = 0;
  let existing = 0;
  
  // Create main unified directory
  if (ensureDir(UNIFIED_DIR)) created++; else existing++;
  
  // Create category subdirectories with files
  DATA_CATEGORIES.forEach(category => {
    const categoryDir = path.join(UNIFIED_DIR, category);
    const partitionsDir = path.join(categoryDir, 'partitions');
    
    // Create category directory
    if (ensureDir(categoryDir)) created++; else existing++;
    
    // Create partitions subdirectory
    if (ensureDir(partitionsDir)) created++; else existing++;
    
    // Create metadata.json
    const metadataPath = path.join(categoryDir, 'metadata.json');
    if (ensureFile(metadataPath, createMetadataTemplate(category))) created++; else existing++;
    
    // Create all-data.json
    const allDataPath = path.join(categoryDir, 'all-data.json');
    if (ensureFile(allDataPath, createDataTemplate())) created++; else existing++;
    
    // Create recent.json
    const recentPath = path.join(categoryDir, 'recent.json');
    if (ensureFile(recentPath, createDataTemplate())) created++; else existing++;
    
    // Create partition index
    const indexPath = path.join(partitionsDir, 'index.json');
    if (ensureFile(indexPath, createPartitionIndexTemplate())) created++; else existing++;
  });
  
  console.log(`\n✓ Unified structure complete: ${created} created, ${existing} already existed\n`);
}

/**
 * Setup sources structure
 */
function setupSourcesStructure() {
  console.log('=== Setting up Sources Structure ===\n');
  
  let created = 0;
  let existing = 0;
  
  // Create main sources directory
  if (ensureDir(SOURCES_DIR)) created++; else existing++;
  
  // Create source subdirectories
  DATA_SOURCES.forEach(source => {
    const sourceDir = path.join(SOURCES_DIR, source);
    if (ensureDir(sourceDir)) created++; else existing++;
    
    // Create README for each source
    const readmePath = path.join(sourceDir, 'README.md');
    const readmeContent = `# ${source.charAt(0).toUpperCase() + source.slice(1)} Raw Data

This directory contains raw data fetched from ${source} before transformation.

## Structure

- Raw data files are stored here before being transformed to the unified format
- Files are organized by dataset or date as appropriate
- Original data structure is preserved for reference and debugging

## Usage

Data in this directory is processed by the transformation pipeline and converted to the unified format in \`public/data/unified/\`.
`;
    if (ensureFile(readmePath, readmeContent)) created++; else existing++;
  });
  
  console.log(`\n✓ Sources structure complete: ${created} created, ${existing} already existed\n`);
}

/**
 * Setup relationships structure
 */
function setupRelationshipsStructure() {
  console.log('=== Setting up Relationships Structure ===\n');
  
  let created = 0;
  let existing = 0;
  
  // Create main relationships directory
  if (ensureDir(RELATIONSHIPS_DIR)) created++; else existing++;
  
  // Create relationship files
  const relationships = [
    { file: 'conflict-infrastructure.json', type: 'conflict-infrastructure' },
    { file: 'infrastructure-humanitarian.json', type: 'infrastructure-humanitarian' },
    { file: 'economic-social.json', type: 'economic-social' },
    { file: 'conflict-casualties.json', type: 'conflict-casualties' },
    { file: 'health-infrastructure.json', type: 'health-infrastructure' },
    { file: 'water-humanitarian.json', type: 'water-humanitarian' },
    { file: 'education-conflict.json', type: 'education-conflict' }
  ];
  
  relationships.forEach(({ file, type }) => {
    const filePath = path.join(RELATIONSHIPS_DIR, file);
    if (ensureFile(filePath, createRelationshipTemplate(type))) created++; else existing++;
  });
  
  // Create README
  const readmePath = path.join(RELATIONSHIPS_DIR, 'README.md');
  const readmeContent = `# Cross-Dataset Relationships

This directory contains relationship mappings between different datasets in the unified data system.

## Relationship Types

- **conflict-infrastructure**: Links conflict incidents to damaged infrastructure
- **infrastructure-humanitarian**: Links infrastructure damage to humanitarian needs
- **economic-social**: Links economic indicators to social indicators
- **conflict-casualties**: Links conflict events to casualty data
- **health-infrastructure**: Links health facilities to infrastructure status
- **water-humanitarian**: Links water infrastructure to humanitarian needs
- **education-conflict**: Links education facilities to conflict events

## Structure

Each relationship file contains:
- \`relationship_type\`: Type of relationship
- \`description\`: Description of the relationship
- \`links\`: Array of relationship links with IDs, confidence scores, and metadata
- \`metadata\`: Overall relationship metadata

## Usage

Relationships are automatically generated by the DataLinker class during data transformation and enrichment.
`;
  if (ensureFile(readmePath, readmeContent)) created++; else existing++;
  
  console.log(`\n✓ Relationships structure complete: ${created} created, ${existing} already existed\n`);
}

/**
 * Create main README
 */
function createMainReadme() {
  console.log('=== Creating Main README ===\n');
  
  const readmePath = path.join(BASE_DIR, 'UNIFIED_DATA_STRUCTURE.md');
  const readmeContent = `# Unified Data System Structure

This document describes the unified data directory structure for Palestine Pulse.

## Directory Structure

\`\`\`
public/data/
├── unified/                    # Unified data store
│   ├── conflict/
│   │   ├── metadata.json      # Dataset metadata
│   │   ├── all-data.json      # Complete dataset
│   │   ├── recent.json        # Last 90 days
│   │   └── partitions/        # Quarterly partitions
│   │       └── index.json     # Partition index
│   ├── economic/
│   ├── infrastructure/
│   ├── humanitarian/
│   ├── education/
│   ├── health/
│   ├── water/
│   └── refugees/
├── sources/                    # Source-specific raw data
│   ├── tech4palestine/
│   ├── worldbank/
│   ├── hdx/
│   ├── goodshepherd/
│   ├── who/
│   ├── unrwa/
│   ├── pcbs/
│   ├── wfp/
│   └── btselem/
└── relationships/              # Cross-dataset links
    ├── conflict-infrastructure.json
    ├── infrastructure-humanitarian.json
    ├── economic-social.json
    └── README.md
\`\`\`

## Data Categories

### Unified Data Categories

1. **conflict**: Conflict incidents, violence, and security events
2. **economic**: Economic indicators and financial data
3. **infrastructure**: Infrastructure status, damage, and capacity
4. **humanitarian**: Humanitarian needs, assistance, and displacement
5. **education**: Education facilities, enrollment, and access
6. **health**: Health facilities, services, and health indicators
7. **water**: Water and sanitation infrastructure and access
8. **refugees**: Refugee statistics and services

### Data Sources

1. **tech4palestine**: Real-time conflict and casualty data
2. **worldbank**: Economic and development indicators
3. **hdx**: Humanitarian data exchange datasets
4. **goodshepherd**: Healthcare attacks and home demolitions
5. **who**: World Health Organization health indicators
6. **unrwa**: UN Relief and Works Agency refugee data
7. **pcbs**: Palestinian Central Bureau of Statistics
8. **wfp**: World Food Programme food security data
9. **btselem**: Israeli human rights organization data

## File Formats

### metadata.json

Contains dataset metadata including:
- Dataset identification and description
- Update frequency and last update timestamp
- Record count and date range
- Quality metrics
- Field definitions
- Relationship information
- Source attribution

### all-data.json

Contains the complete dataset with:
- \`data\`: Array of all data points
- \`metadata\`: Generation metadata

### recent.json

Contains recent data (last 90 days) for quick access with the same structure as all-data.json.

### partitions/

Contains quarterly partitions (YYYY-Q1, YYYY-Q2, etc.) for large datasets:
- Individual partition files (e.g., 2024-Q1.json)
- index.json with partition metadata

### Relationship Files

Contains cross-dataset links with:
- \`relationship_type\`: Type of relationship
- \`description\`: Relationship description
- \`links\`: Array of relationship links
- \`metadata\`: Relationship metadata

## Usage

### Accessing Unified Data

Use the unified data service:

\`\`\`typescript
import { getConflictData, getEconomicData } from '@/services/unifiedDataService';

// Get conflict data
const conflictData = await getConflictData({
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  region: 'gaza'
});

// Get economic data
const economicData = await getEconomicData({
  indicators: ['GDP', 'unemployment'],
  qualityThreshold: 0.8
});
\`\`\`

### Using React Query Hooks

\`\`\`typescript
import { useConflictData, useEconomicData } from '@/hooks/useUnifiedData';

function MyComponent() {
  const { data: conflicts, isLoading } = useConflictData({
    startDate: '2024-01-01',
    region: 'gaza'
  });
  
  return <div>{/* Use data */}</div>;
}
\`\`\`

## Data Pipeline

1. **Fetch**: Scripts fetch raw data from external sources
2. **Transform**: Data is transformed to unified format
3. **Enrich**: Additional fields and relationships are added
4. **Validate**: Data quality is checked
5. **Partition**: Large datasets are split into chunks
6. **Store**: Data is saved to appropriate directories
7. **Access**: Services and hooks provide typed access

## Maintenance

- Raw data is preserved in \`sources/\` for reference
- Unified data is regenerated when sources are updated
- Relationships are recalculated during data updates
- Quality metrics are tracked over time

## Related Documentation

- [Requirements Document](.kiro/specs/unified-data-system/requirements.md)
- [Design Document](.kiro/specs/unified-data-system/design.md)
- [Implementation Tasks](.kiro/specs/unified-data-system/tasks.md)
`;
  
  if (ensureFile(readmePath, readmeContent)) {
    console.log('✓ Main README created\n');
  } else {
    console.log('  Main README already exists\n');
  }
}

/**
 * Main execution
 */
function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Unified Data Directory Structure Setup                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  try {
    setupUnifiedStructure();
    setupSourcesStructure();
    setupRelationshipsStructure();
    createMainReadme();
    
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  ✓ Setup Complete!                                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    console.log('Next steps:');
    console.log('1. Run fetch scripts to populate source data');
    console.log('2. Run transformation scripts to generate unified data');
    console.log('3. Use unified data services to access data in your application\n');
    
  } catch (error) {
    console.error('\n✗ Error during setup:', error.message);
    process.exit(1);
  }
}

// Run if called directly
main();

export { main };
