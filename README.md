# Palestine Data Backend

Backend data aggregation system for Palestine Data.

## Features
- **Unified Data**: Aggregates data from UN OCHA, PCBS, WHO, and more.
- **API Layer**: RESTful API with search, filtering, and pagination.
- **Search**: In-memory full-text search using MiniSearch.
- **Documentation**: Swagger UI at `/api-docs`.

## Getting Started

### Prerequisites
- Node.js 22+
- NPM

### Installation
```bash
npm install
```

### Running the API
```bash
npm run start-api
```
The API will be available at `http://localhost:3000/api/v1`.

### Running Data Pipeline
```bash
npm run update-data
```

### Data Optimization
To reduce the deployment size (e.g., for static hosting):
```bash
# Remove raw data (HDX, WHO, etc.)
node scripts/clean-raw-data.js

# Remove large JSON files (keep partitions)
node scripts/optimize-unified-data.js

# Create lite search index
node scripts/optimize-search-index.js
```

## Deployment

### Hugging Face Spaces (Recommended)
This project is configured for deployment on [Hugging Face Spaces](https://huggingface.co/spaces) using Docker.

1. Create a new Space on Hugging Face.
2. Select **Docker** as the SDK.
3. Choose **Blank** template.
4. Upload the files from this repository (or connect your GitHub repo).
5. The Space will build and run automatically.

### Local Docker
```bash
docker-compose up --build
```
The API will be available at `http://localhost:3000`.
