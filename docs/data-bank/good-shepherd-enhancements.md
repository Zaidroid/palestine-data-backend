# Good Shepherd Data Enhancements

This document describes the enhancements made to the Good Shepherd data fetcher to handle inactive endpoints and large datasets.

## Overview

The Good Shepherd Collective provides valuable data on various aspects of the Palestine situation. However, some endpoints face challenges:

1. **Healthcare Attacks Endpoint**: Returns very large datasets that can cause memory issues
2. **Home Demolitions Endpoint**: Sometimes unavailable or returns incomplete data

## Enhancements Implemented

### 1. Streaming Support for Healthcare Attacks

**Problem**: The healthcare attacks endpoint can return datasets larger than 10MB, causing memory issues and slow loading times.

**Solution**: Implemented chunk-based streaming with the following features:

#### Features

- **Automatic Size Detection**: Checks response size before loading
- **Chunk-Based Processing**: Splits large datasets into 10,000-record chunks
- **Incremental Saving**: Saves chunks as they're processed to prevent memory issues
- **Chunk Index**: Creates an index file for efficient chunk navigation

#### Implementation Details

```javascript
// Streaming is automatically triggered for datasets > 10MB
const CHUNK_SIZE = 10000;

// Chunks are saved in: public/data/goodshepherd/healthcare/chunks/
// - chunk-1.json
// - chunk-2.json
// - chunk-N.json
// - index.json (chunk metadata)
```

#### Chunk Structure

Each chunk file contains:
```json
{
  "metadata": {
    "chunk_number": 1,
    "total_chunks": 5,
    "record_count": 10000,
    "record_range": { "start": 0, "end": 9999 },
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "data": [...]
}
```

#### Chunk Index Structure

The index.json file contains:
```json
{
  "total_records": 50000,
  "total_chunks": 5,
  "chunk_size": 10000,
  "chunks": [
    {
      "chunk_number": 1,
      "file": "chunk-1.json",
      "record_count": 10000,
      "record_range": { "start": 0, "end": 9999 }
    }
  ],
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### 2. Alternative Sources for Home Demolitions

**Problem**: The Good Shepherd home demolitions endpoint is sometimes unavailable or returns incomplete data.

**Solution**: Implemented a fallback chain with multiple data sources:

#### Fallback Strategy

1. **Primary**: Good Shepherd API (`/api/home_demolitions.json`)
2. **Secondary**: Good Shepherd Local Fallback (`src/data/demolitions-pre.json`)
3. **Tertiary**: HDX (Humanitarian Data Exchange)
4. **Quaternary**: B'Tselem (Israeli human rights organization)

#### HDX Integration

The system searches HDX for demolition-related datasets:
- Searches for "demolition+palestine" datasets
- Attempts to fetch JSON or CSV resources
- Transforms data to match the unified format

#### B'Tselem Integration

Attempts to fetch from known B'Tselem data sources:
- Checks multiple potential B'Tselem endpoints
- Falls back gracefully if unavailable
- Note: B'Tselem doesn't have a public API, so this relies on data aggregators

#### Data Transformation

All sources are transformed to a unified format:
```javascript
{
  date: "2024-01-01",
  location: "Locality Name",
  homes_demolished: 5,
  people_affected: 25,
  reason: "Administrative demolition",
  structure_type: "residential",
  source: "hdx" // or "btselem", "goodshepherd-api", etc.
}
```

## Usage

### Running the Fetcher

```bash
node scripts/fetch-goodshepherd-data.js
```

The script will:
1. Attempt to fetch from all sources
2. Automatically apply streaming for large datasets
3. Fall back to alternative sources when needed
4. Save data with appropriate metadata

### Testing the Enhancements

```bash
node scripts/test-goodshepherd-streaming.js
```

This test script verifies:
- Healthcare chunks are created correctly
- Demolitions data is fetched from available sources
- Metadata is properly structured

### Loading Chunked Data

Use the chunk loader utility:

```javascript
import { loadChunkIndex, loadChunk, loadAllChunks } from './utils/chunk-loader.js';

// Load chunk index
const index = await loadChunkIndex('public/data/goodshepherd/healthcare/chunks');

// Load specific chunk
const chunk1 = await loadChunk('public/data/goodshepherd/healthcare/chunks', 1);

// Load all chunks (use with caution for very large datasets)
const allData = await loadAllChunks('public/data/goodshepherd/healthcare/chunks');
```

## Metadata Structure

The enhanced metadata includes information about streaming and alternative sources:

```json
{
  "datasets": {
    "healthcare": {
      "streaming": {
        "enabled": true,
        "chunk_size": 10000,
        "chunks_directory": "chunks/",
        "description": "Large datasets are automatically chunked for efficient loading"
      }
    },
    "demolitions": {
      "alternative_sources": {
        "enabled": true,
        "sources": ["hdx", "btselem"],
        "fallback_strategy": "goodshepherd -> hdx -> btselem -> local"
      }
    }
  }
}
```

## Benefits

### Streaming Benefits

1. **Memory Efficiency**: Processes large datasets without loading everything into memory
2. **Faster Initial Load**: Can load and display first chunk while others are processing
3. **Scalability**: Handles datasets of any size
4. **Progressive Loading**: Frontend can implement progressive data loading

### Alternative Sources Benefits

1. **Reliability**: Multiple fallback options ensure data availability
2. **Data Completeness**: Can combine data from multiple sources
3. **Resilience**: System continues to work even if primary source is down
4. **Data Quality**: Can cross-reference data from multiple sources

## Future Enhancements

### Potential Improvements

1. **Parallel Chunk Loading**: Load multiple chunks simultaneously
2. **Smart Caching**: Cache frequently accessed chunks
3. **Compression**: Compress chunks to reduce storage and transfer size
4. **Incremental Updates**: Update only changed chunks instead of full refetch
5. **B'Tselem API**: Implement proper B'Tselem integration when API becomes available
6. **HDX CSV Parsing**: Add CSV parsing for HDX resources
7. **Data Merging**: Merge data from multiple sources with deduplication

## Troubleshooting

### Chunks Not Created

If chunks aren't created for healthcare data:
- Check if dataset size is > 10MB
- Verify write permissions to `public/data/goodshepherd/healthcare/chunks/`
- Check logs for streaming errors

### Alternative Sources Not Working

If demolitions fallback fails:
- Verify network connectivity
- Check HDX API availability
- Review logs for specific error messages
- Ensure fallback data file exists at `src/data/demolitions-pre.json`

### Memory Issues

If still experiencing memory issues:
- Reduce `CHUNK_SIZE` (currently 10,000 records)
- Implement streaming for other large datasets
- Use chunk loader to load data incrementally

## Related Files

- `scripts/fetch-goodshepherd-data.js` - Main fetcher with enhancements
- `scripts/utils/chunk-loader.js` - Utility for loading chunked data
- `scripts/test-goodshepherd-streaming.js` - Test script for enhancements
- `docs/data-bank/good-shepherd-enhancements.md` - This documentation
