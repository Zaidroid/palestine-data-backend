# Palestine Data Frontend: Immersive Showcase Plan

This document outlines the architecture, design system, and implementation strategy for a fully immersive, interactive frontend designed to showcase the unified data provided by the Palestine Data Backend. This plan focuses on creating a "wow" experience that turns raw data into an engaging narrative.

## 1. System Architecture & Tech Stack

*   **Framework:** **Next.js 14+ (App Router)** or **Vite + React**. Next.js is recommended for built-in SEO, route-based code splitting, and edge caching (helpful for the 62,000+ records).
*   **Styling:** **Vanilla CSS** with CSS Modules or tailored **Tailwind CSS**. Emphasis is on custom glassmorphism, dynamic gradients, and precision spacing.
*   **Data Fetching:** **SWR** or **React Query**. It will prioritize hitting the static JSON endpoints (`/data/unified/*.json`) for maps/charts, falling back to the dynamic `/api/v1/search` API for explicit queries.
*   **Visualizations:**
    *   **Mapbox GL JS** or **Deck.gl:** High-performance, WebGL-powered interactive mapping capable of rendering tens of thousands of points smoothly.
    *   **D3.js / Recharts:** For rich, interactive charting (bar, line, donut, flow charts).
    *   **Framer Motion:** For fluid layout transitions, micro-interactions, and scroll-linked animations.

## 2. Design Aesthetics & Visual "Wow Factor"

The application must feel like a premium, state-of-the-art interactive digital twin or interactive documentary.

*   **Theme:** Focused **Dark Mode** (`#0D1117` base) to allow the data highlights to act as luminous accents.
*   **Color Palette:**
    *   *Accent Colors:* High-contrast data colors (e.g., Luminous Crimson for conflict/martyrs, Vibrant Teal for health/water, Golden Sand for historical data).
    *   *UI Elements:* Translucent panels (Glassmorphism), heavy background blurring, and glowing borders.
*   **Typography:** Modern, highly legible sans-serif for UI elements (e.g., **Inter** or **Outfit**) paired with a striking Serif for historical context headers.
*   **Interactivity:** Tangible micro-animations on hover, smooth layout transitions between data categories, and scroll-linked narrative animations. No static UI elements—the dashboard should feel "alive".

## 3. Core Features & Interface Views

### A. The "Digital Twin" Map (Main Route `/`)
A cinematic, full-screen map encompassing Historical Palestine, the West Bank, and the Gaza Strip.
*   **Data Overlays:** Heatmaps and clustered data points.
*   **Time Machine Scrubber:** A highly visible timeline slider at the bottom of the screen to step through time (1948 - Present), watching the map update and animate dynamically based on the year.
*   **Category Toggles:** Floating, frosted-glass pill buttons to toggle Health, Conflict, Water, or Demographic data layers on and off.

### B. The Narrative Timeline (`/timeline`)
A vertical, scroll-driven interactive timeline utilizing Framer Motion.
*   Displays major events with rich media, pulling directly from the `Historical` and `Conflict` categories.
*   Backgrounds and ambient data points shift dynamically as the user scrolls through the decades.

### C. Category Deep-Dives (`/category/[slug]`)
Detailed dashboards for each of the 13 tracked categories.
*   **Health:** Impact grids, hospital status visuals, and graphs showing attacks on healthcare.
*   **Demographics & Refugees:** Interactive flow-maps showing displacement statistics and camp growth.
*   **Land & Water:** Spatial comparison sliders (Before/After) showing settlement expansion or water consumption ratios.
*   **KPIs:** Animated "count-up" statistics on load.

### D. Global Search & Data Explorer
*   A command-palette interface (Cmd/Ctrl + K) accessible globally.
*   Directly hooks into the `/api/v1/search` endpoint.
*   Auto-categorizes results intuitively (e.g., "Events", "Locations", "Demographics").

## 4. Implementation Phasing

### Phase 1: Foundation
*   Scaffold Next.js / Vite application.
*   Define global CSS tokens, setup the dark mode, and implement the typography/glassmorphic utility classes.
*   Integrate Mapbox/Deck.gl base map and bind it to the `all.json` static data endpoint.

### Phase 2: Core Components & Visualization
*   Build reusable UI components (KPI Cards, Time Slider, Global Search Bar).
*   Develop the interactive Timeline view.
*   Build category-specific templates using Recharts/D3.js for visual data representation.

### Phase 3: Polish & Narrative Integration
*   Wire up the dynamic search API.
*   Implement data pagination schemas for high-density categories to prevent browser lag.
*   Add micro-animations, loading skeletons, and fluid transition polish using Framer Motion.

### Phase 4: Performance & SEO Optimization
*   Lazy load heavy map libraries and charting engines.
*   Optimize initial payload sizes from the `unified` dataset.
*   Implement comprehensive SEO best practices (Title Tags, Meta Descriptions, OpenGraph images, Semantic HTML5 hierarchy).

## 5. Next Steps & Requirements
1.  **Framework Choice:** Confirm preference between Next.js (better SEO/Performance scaling) vs. a simpler Vite SPA.
2.  **Repo Structure:** Determine if this should be a standalone repository, a Next.js frontend within this monorepo, or built purely out of static files served from the `public/` directory here.
3.  **Localization:** Confirm if Bilingual support (English / Arabic) is required for version 1.0.
