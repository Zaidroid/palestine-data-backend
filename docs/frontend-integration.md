# Frontend Integration Guide

This backend provides two ways to access data: **Static Data** (fast, cacheable) and **Dynamic API** (search, filtering).

## 1. Base URL
Once deployed to Netlify, your backend will have a URL like:
`https://your-site-name.netlify.app`

## 2. Accessing Static Data (Recommended)
Use this for loading initial data, charts, or maps. It's the fastest method because it serves pre-generated JSON files directly.

**Endpoint Pattern:** `{BASE_URL}/data/{path_to_file}`

### Examples

**Fetch Unified Data (All Categories):**
```javascript
const response = await fetch('https://your-site-name.netlify.app/data/unified/all.json');
const data = await response.json();
// Result: Array of all unified events
```

**Fetch Specific Category (e.g., Health):**
```javascript
const response = await fetch('https://your-site-name.netlify.app/data/unified/health.json');
const data = await response.json();
```

**Fetch Historical Events:**
```javascript
const response = await fetch('https://your-site-name.netlify.app/data/historical/historical-events.json');
```

## 3. Accessing Dynamic API
Use this for features that require server-side logic, like full-text search across large datasets.

**Endpoint Pattern:** `{BASE_URL}/api/v1/{endpoint}`

### Examples

**Search Data:**
```javascript
// Search for "Gaza"
const response = await fetch('https://your-site-name.netlify.app/api/v1/search?q=Gaza');
const results = await response.json();
```

**Advanced Search (with filters):**
```javascript
const response = await fetch('https://your-site-name.netlify.app/api/v1/search?q=hospital&category=health&startDate=2023-10-07');
```

## 4. CORS Configuration
CORS (Cross-Origin Resource Sharing) is already configured in `netlify.toml`.
- **Allowed Origins**: `*` (All domains)
- **Allowed Methods**: `GET`, `POST`, `OPTIONS`

This means you can make requests to this backend from **any** frontend (localhost, GitHub Pages, Vercel, etc.) without getting browser errors.

## 5. Quick Start (React Example)

```jsx
import { useState, useEffect } from 'react';

const API_URL = 'https://your-site-name.netlify.app';

function DataViewer() {
  const [data, setData] = useState([]);

  useEffect(() => {
    // Load static data on mount
    fetch(`${API_URL}/data/unified/all.json`)
      .then(res => res.json())
      .then(setData)
      .catch(console.error);
  }, []);

  return (
    <div>
      <h1>Palestine Data ({data.length} records)</h1>
      <ul>
        {data.slice(0, 5).map(item => (
          <li key={item.id}>{item.title} - {item.date}</li>
        ))}
      </ul>
    </div>
  );
}
```
