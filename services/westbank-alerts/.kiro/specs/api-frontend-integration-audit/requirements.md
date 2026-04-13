# Requirements Document: API-Frontend Integration Audit

## Introduction

This document specifies requirements for auditing and improving the West Bank Alert System's API-frontend integration. The backend FastAPI system is fully functional with real-time Telegram data ingestion for security alerts and checkpoint status updates. The frontend was built with mock data and requires proper integration with the production API, including error handling, real-time connection management, performance optimization, and production deployment configuration.

## Glossary

- **Frontend**: React 18 application built with TypeScript, Vite, TanStack Query, Wouter routing, and Leaflet maps
- **Backend_API**: FastAPI application providing REST endpoints, WebSocket, and SSE streams for alerts and checkpoints
- **API_Client**: Frontend module responsible for HTTP communication with Backend_API
- **SSE_Connection**: Server-Sent Events connection for real-time alert and checkpoint updates
- **WebSocket_Connection**: Bidirectional real-time connection with ping/pong keepalive
- **Environment_Config**: Build-time and runtime configuration for API base URLs and feature flags
- **Error_Boundary**: React component that catches and handles JavaScript errors in component tree
- **Retry_Logic**: Mechanism to automatically retry failed HTTP requests with exponential backoff
- **Connection_Manager**: Component managing SSE/WebSocket lifecycle, reconnection, and state
- **Loading_State**: UI feedback indicating data fetch in progress
- **Empty_State**: UI feedback when no data is available
- **Stale_Data**: Data older than configured threshold (6 hours for checkpoints, 2 hours for alerts)
- **Health_Endpoint**: Backend endpoint (/health) providing system status and uptime
- **Summary_Endpoint**: Lightweight endpoint (/checkpoints/summary) for dashboard KPIs
- **GeoJSON_Endpoint**: Endpoint (/checkpoints/geojson) providing map-ready checkpoint data
- **Pagination**: Mechanism to fetch data in chunks to avoid loading all records at once
- **Debouncing**: Technique to delay execution until user stops typing for specified duration
- **Optimistic_Update**: UI update before server confirmation to improve perceived performance
- **Rate_Limit**: Backend restriction on request frequency per client
- **CORS**: Cross-Origin Resource Sharing configuration allowing frontend to access Backend_API
- **Vite_Proxy**: Development-only proxy configuration in vite.config.ts
- **Production_Build**: Compiled frontend assets for deployment with environment variables baked in
- **API_Versioning**: URL path prefix (e.g., /v1/) to support backward compatibility
- **Request_Interceptor**: Middleware that modifies outgoing HTTP requests
- **Response_Interceptor**: Middleware that processes incoming HTTP responses
- **Connection_Status_Indicator**: UI component showing real-time connection health
- **Offline_Indicator**: UI component showing when network is unavailable
- **Clustering**: Map technique to group nearby markers for performance
- **Bounds_Fitting**: Map technique to automatically zoom to show all markers

## Requirements

### Requirement 1: Environment Configuration

**User Story:** As a developer, I want environment-based API configuration, so that the frontend works in development, staging, and production without code changes.

#### Acceptance Criteria

1. THE Environment_Config SHALL define VITE_API_BASE_URL for Backend_API location
2. WHEN VITE_API_BASE_URL is undefined, THE Environment_Config SHALL default to empty string for Vite_Proxy compatibility
3. THE Environment_Config SHALL support VITE_WS_BASE_URL for WebSocket_Connection endpoints
4. THE Environment_Config SHALL support VITE_ENABLE_MOCK_DATA boolean flag
5. THE Frontend SHALL validate required environment variables at build time
6. WHEN required environment variables are missing in Production_Build, THE Frontend SHALL display error message and refuse to start
7. THE Frontend SHALL provide .env.example file documenting all environment variables

### Requirement 2: API Client Abstraction

**User Story:** As a developer, I want a centralized API client, so that all HTTP communication follows consistent patterns and can be modified in one place.

#### Acceptance Criteria

1. THE API_Client SHALL provide typed functions for all Backend_API endpoints
2. THE API_Client SHALL construct URLs using Environment_Config.VITE_API_BASE_URL
3. THE API_Client SHALL include Request_Interceptor for adding common headers
4. THE API_Client SHALL include Response_Interceptor for handling common errors
5. THE API_Client SHALL export TypeScript interfaces matching Backend_API models
6. FOR ALL API_Client functions, THE API_Client SHALL return typed Promise objects
7. THE API_Client SHALL support request cancellation via AbortController
8. THE API_Client SHALL log request/response details in development mode only

### Requirement 3: Error Handling - HTTP Errors

**User Story:** As a user, I want clear error messages when API requests fail, so that I understand what went wrong and what to do next.

#### Acceptance Criteria

1. WHEN Backend_API returns 404, THE API_Client SHALL throw NotFoundError with resource details
2. WHEN Backend_API returns 401, THE API_Client SHALL throw AuthenticationError
3. WHEN Backend_API returns 429, THE API_Client SHALL throw RateLimitError with retry-after duration
4. WHEN Backend_API returns 500-599, THE API_Client SHALL throw ServerError
5. WHEN network request fails, THE API_Client SHALL throw NetworkError
6. WHEN request timeout exceeds 30 seconds, THE API_Client SHALL throw TimeoutError
7. FOR ALL error types, THE API_Client SHALL include original HTTP status code and response body
8. THE Frontend SHALL display user-friendly error messages translated from error types

### Requirement 4: Error Handling - React Error Boundaries

**User Story:** As a user, I want the application to remain functional when component errors occur, so that one broken feature doesn't crash the entire dashboard.

#### Acceptance Criteria

1. THE Frontend SHALL wrap Dashboard component with Error_Boundary
2. THE Frontend SHALL wrap MapView component with Error_Boundary
3. THE Frontend SHALL wrap LiveFeed component with Error_Boundary
4. WHEN Error_Boundary catches error, THE Error_Boundary SHALL log error details to console
5. WHEN Error_Boundary catches error, THE Error_Boundary SHALL display fallback UI with error message
6. THE Error_Boundary fallback UI SHALL include "Retry" button to reset error state
7. THE Error_Boundary SHALL preserve application state outside the failed component

### Requirement 5: Retry Logic with Exponential Backoff

**User Story:** As a user, I want automatic retry for failed requests, so that temporary network issues don't require manual page refresh.

#### Acceptance Criteria

1. WHEN API request fails with NetworkError, THE Retry_Logic SHALL retry up to 3 times
2. WHEN API request fails with ServerError, THE Retry_Logic SHALL retry up to 3 times
3. WHEN API request fails with TimeoutError, THE Retry_Logic SHALL retry up to 2 times
4. THE Retry_Logic SHALL wait 1 second before first retry
5. THE Retry_Logic SHALL wait 2 seconds before second retry
6. THE Retry_Logic SHALL wait 4 seconds before third retry
7. WHEN API request fails with AuthenticationError, THE Retry_Logic SHALL NOT retry
8. WHEN API request fails with NotFoundError, THE Retry_Logic SHALL NOT retry
9. WHEN all retries exhausted, THE Retry_Logic SHALL throw final error to caller

### Requirement 6: Real-time Connection Management - SSE

**User Story:** As a user, I want reliable real-time updates, so that I see new alerts and checkpoint changes immediately without manual refresh.

#### Acceptance Criteria

1. THE Connection_Manager SHALL establish SSE_Connection to /stream for alerts
2. THE Connection_Manager SHALL establish SSE_Connection to /checkpoints/stream for checkpoint updates
3. WHEN SSE_Connection closes, THE Connection_Manager SHALL attempt reconnection after 2 seconds
4. WHEN SSE_Connection fails twice, THE Connection_Manager SHALL wait 5 seconds before retry
5. WHEN SSE_Connection fails three times, THE Connection_Manager SHALL wait 10 seconds before retry
6. THE Connection_Manager SHALL limit maximum reconnection delay to 30 seconds
7. WHEN SSE_Connection receives heartbeat, THE Connection_Manager SHALL reset reconnection delay
8. THE Connection_Manager SHALL expose connection status as "connected", "connecting", or "disconnected"
9. WHEN user navigates away from page, THE Connection_Manager SHALL close all SSE_Connection instances

### Requirement 7: Real-time Connection Management - WebSocket

**User Story:** As a developer, I want WebSocket support as alternative to SSE, so that clients can choose the most appropriate real-time protocol.

#### Acceptance Criteria

1. THE Connection_Manager SHALL support WebSocket_Connection to /ws as alternative to SSE
2. THE Connection_Manager SHALL send ping message every 25 seconds to keep WebSocket_Connection alive
3. WHEN WebSocket_Connection receives ping from server, THE Connection_Manager SHALL respond with pong
4. WHEN WebSocket_Connection closes, THE Connection_Manager SHALL apply same reconnection logic as SSE_Connection
5. THE Connection_Manager SHALL parse incoming WebSocket messages as JSON
6. WHEN WebSocket message parsing fails, THE Connection_Manager SHALL log error and continue listening
7. THE Connection_Manager SHALL allow configuration to choose between SSE_Connection and WebSocket_Connection

### Requirement 8: Loading States and Skeletons

**User Story:** As a user, I want visual feedback during data loading, so that I know the application is working and not frozen.

#### Acceptance Criteria

1. WHEN Dashboard fetches initial data, THE Dashboard SHALL display Loading_State for each section
2. THE Loading_State SHALL use skeleton components matching final content layout
3. THE CheckpointList SHALL display skeleton items while fetching checkpoints
4. THE AlertList SHALL display skeleton items while fetching alerts
5. THE MapView SHALL display loading spinner while fetching GeoJSON data
6. THE KpiStrip SHALL display skeleton numbers while fetching statistics
7. WHEN data fetch completes, THE Frontend SHALL replace Loading_State with actual content within 100ms

### Requirement 9: Empty States

**User Story:** As a user, I want clear messaging when no data is available, so that I understand the system status rather than seeing blank screens.

#### Acceptance Criteria

1. WHEN CheckpointList has zero checkpoints, THE CheckpointList SHALL display Empty_State with message
2. WHEN AlertList has zero alerts, THE AlertList SHALL display Empty_State with message
3. WHEN MapView has zero markers, THE MapView SHALL display Empty_State overlay
4. THE Empty_State SHALL include icon, heading, and description
5. WHEN Empty_State is due to filters, THE Empty_State SHALL include "Clear filters" button
6. WHEN Empty_State is due to no data, THE Empty_State SHALL include "Refresh" button

### Requirement 10: Connection Status Indicator

**User Story:** As a user, I want visible connection status, so that I know whether I'm seeing live data or stale information.

#### Acceptance Criteria

1. THE Connection_Status_Indicator SHALL display in Header component
2. WHEN Connection_Manager status is "connected", THE Connection_Status_Indicator SHALL show green indicator
3. WHEN Connection_Manager status is "connecting", THE Connection_Status_Indicator SHALL show yellow indicator with animation
4. WHEN Connection_Manager status is "disconnected", THE Connection_Status_Indicator SHALL show red indicator
5. THE Connection_Status_Indicator SHALL include tooltip with last update timestamp
6. WHEN user clicks Connection_Status_Indicator, THE Frontend SHALL display connection details modal
7. THE connection details modal SHALL show uptime, message counts, and reconnection attempts

### Requirement 11: Offline Detection

**User Story:** As a user, I want notification when my internet connection is lost, so that I know data is not updating.

#### Acceptance Criteria

1. THE Frontend SHALL listen to browser online/offline events
2. WHEN browser fires offline event, THE Frontend SHALL display Offline_Indicator banner
3. THE Offline_Indicator SHALL appear at top of viewport with high z-index
4. THE Offline_Indicator SHALL include message "No internet connection"
5. WHEN browser fires online event, THE Offline_Indicator SHALL disappear after 2 seconds
6. WHEN connection restored, THE Frontend SHALL automatically refetch critical data

### Requirement 12: Stale Data Detection

**User Story:** As a user, I want visual indication of stale data, so that I don't rely on outdated information for safety decisions.

#### Acceptance Criteria

1. WHEN checkpoint last_updated exceeds 6 hours, THE Frontend SHALL mark checkpoint as Stale_Data
2. WHEN alert timestamp exceeds 2 hours, THE Frontend SHALL mark alert as Stale_Data
3. THE Frontend SHALL display Stale_Data indicator badge on affected items
4. THE Frontend SHALL dim Stale_Data items in lists
5. THE Frontend SHALL show Stale_Data markers with reduced opacity on MapView
6. WHEN Health_Endpoint indicates stale checkpoint data, THE Frontend SHALL display warning banner
7. THE warning banner SHALL include last update timestamp and "Refresh" button

### Requirement 13: Optimized Data Fetching - Summary Endpoint

**User Story:** As a developer, I want to use lightweight endpoints for dashboard KPIs, so that the application loads quickly and reduces server load.

#### Acceptance Criteria

1. THE Dashboard SHALL fetch Summary_Endpoint instead of full checkpoint list for KpiStrip
2. THE Dashboard SHALL poll Summary_Endpoint every 30 seconds
3. WHEN Summary_Endpoint returns is_data_stale true, THE Dashboard SHALL display warning
4. THE Dashboard SHALL fetch full checkpoint list only when user navigates to checkpoints tab
5. THE Dashboard SHALL cache Summary_Endpoint response for 30 seconds
6. WHEN Summary_Endpoint request fails, THE Dashboard SHALL continue using cached data

### Requirement 14: Optimized Data Fetching - Health Polling

**User Story:** As a developer, I want to monitor backend health, so that the frontend can detect and display system issues proactively.

#### Acceptance Criteria

1. THE Frontend SHALL poll Health_Endpoint every 60 seconds
2. WHEN Health_Endpoint returns status other than "ok", THE Frontend SHALL display system warning
3. WHEN Health_Endpoint indicates monitor disconnected, THE Frontend SHALL display "Data source offline" warning
4. THE Frontend SHALL display Health_Endpoint uptime in connection details modal
5. WHEN Health_Endpoint request fails 3 consecutive times, THE Frontend SHALL display critical error banner
6. THE critical error banner SHALL include "Backend unavailable" message and retry countdown

### Requirement 15: Pagination Implementation

**User Story:** As a user, I want paginated data loading, so that large datasets don't slow down the interface.

#### Acceptance Criteria

1. THE AlertList SHALL fetch alerts in pages of 50 items
2. THE CheckpointList SHALL fetch checkpoints in pages of 100 items
3. WHEN user scrolls to bottom of list, THE Frontend SHALL fetch next page automatically
4. THE Frontend SHALL display "Loading more..." indicator during Pagination fetch
5. WHEN all pages loaded, THE Frontend SHALL display "No more items" message
6. THE Frontend SHALL support "Load more" button as alternative to infinite scroll
7. THE Frontend SHALL preserve scroll position when new page loads

### Requirement 16: Search Debouncing

**User Story:** As a user, I want responsive search without excessive API calls, so that filtering is smooth and efficient.

#### Acceptance Criteria

1. WHEN user types in search input, THE Frontend SHALL wait 300ms before triggering search
2. WHEN user types again within 300ms, THE Frontend SHALL reset Debouncing timer
3. THE Frontend SHALL show "Searching..." indicator during Debouncing delay
4. THE Frontend SHALL cancel pending search request when new search starts
5. WHEN search query is empty, THE Frontend SHALL clear filters immediately without Debouncing
6. THE Frontend SHALL preserve search query in URL query parameters
7. WHEN user navigates back, THE Frontend SHALL restore search query from URL

### Requirement 17: Map Performance - GeoJSON Endpoint

**User Story:** As a user, I want fast map loading, so that I can quickly assess checkpoint locations and status.

#### Acceptance Criteria

1. THE MapView SHALL fetch GeoJSON_Endpoint instead of parsing checkpoint list
2. THE MapView SHALL cache GeoJSON_Endpoint response for 60 seconds
3. WHEN GeoJSON_Endpoint returns data, THE MapView SHALL render all markers within 500ms
4. THE MapView SHALL update markers when SSE_Connection receives checkpoint updates
5. WHEN checkpoint status changes, THE MapView SHALL update marker color without refetching GeoJSON
6. THE MapView SHALL apply Clustering when marker count exceeds 50
7. WHEN user zooms in, THE MapView SHALL decluster markers progressively

### Requirement 18: Map Performance - Bounds Fitting

**User Story:** As a user, I want the map to automatically show all relevant checkpoints, so that I don't have to manually zoom and pan.

#### Acceptance Criteria

1. WHEN MapView loads initial data, THE MapView SHALL apply Bounds_Fitting to show all markers
2. THE MapView SHALL add 10% padding around Bounds_Fitting area
3. WHEN user manually pans or zooms, THE MapView SHALL disable automatic Bounds_Fitting
4. THE MapView SHALL provide "Reset view" button to reapply Bounds_Fitting
5. WHEN filter changes, THE MapView SHALL reapply Bounds_Fitting to visible markers
6. WHEN zero markers visible, THE MapView SHALL zoom to West Bank default view

### Requirement 19: Alert Geocoding

**User Story:** As a user, I want to see alerts on the map, so that I can understand geographic context of security events.

#### Acceptance Criteria

1. THE Backend_API SHALL add latitude and longitude fields to Alert model
2. THE Backend_API SHALL geocode alert area field using checkpoint directory
3. WHEN alert area matches checkpoint name, THE Backend_API SHALL use checkpoint coordinates
4. WHEN alert area has no coordinate match, THE Backend_API SHALL use region centroid
5. THE MapView SHALL display alert markers with distinct icon from checkpoint markers
6. THE MapView SHALL color-code alert markers by severity
7. WHEN user clicks alert marker, THE MapView SHALL display alert details in popup

### Requirement 20: Production Configuration

**User Story:** As a developer, I want production-ready build configuration, so that the frontend deploys correctly without development dependencies.

#### Acceptance Criteria

1. THE Production_Build SHALL include VITE_API_BASE_URL from environment variable
2. THE Production_Build SHALL remove all console.log statements except errors
3. THE Production_Build SHALL minify JavaScript and CSS assets
4. THE Production_Build SHALL generate source maps in separate files
5. THE Production_Build SHALL include cache-busting hashes in asset filenames
6. THE Production_Build SHALL output static files to dist/public directory
7. THE Production_Build SHALL validate all required environment variables before compilation

### Requirement 21: API Versioning Support

**User Story:** As a developer, I want API version support, so that frontend and backend can evolve independently without breaking changes.

#### Acceptance Criteria

1. THE API_Client SHALL support optional API_Versioning prefix in URLs
2. THE Environment_Config SHALL define VITE_API_VERSION (default "v1")
3. WHEN VITE_API_VERSION is set, THE API_Client SHALL prepend version to all endpoint paths
4. THE API_Client SHALL include API version in request headers as X-API-Version
5. WHEN Backend_API returns 426 Upgrade Required, THE API_Client SHALL display version mismatch error
6. THE version mismatch error SHALL include required version and current version
7. THE version mismatch error SHALL include "Refresh page" button to reload application

### Requirement 22: Rate Limit Handling

**User Story:** As a user, I want graceful handling of rate limits, so that temporary throttling doesn't break the application.

#### Acceptance Criteria

1. WHEN Backend_API returns 429 with Retry-After header, THE API_Client SHALL wait specified duration
2. WHEN Backend_API returns 429 without Retry-After header, THE API_Client SHALL wait 60 seconds
3. THE Frontend SHALL display "Too many requests" notification during rate limit wait
4. THE notification SHALL include countdown timer showing seconds until retry
5. THE Frontend SHALL reduce polling frequency when rate limit encountered
6. WHEN rate limit clears, THE Frontend SHALL resume normal polling frequency
7. THE Frontend SHALL log rate limit events for debugging

### Requirement 23: Request Cancellation

**User Story:** As a developer, I want to cancel in-flight requests, so that navigation and filter changes don't cause race conditions.

#### Acceptance Criteria

1. THE API_Client SHALL accept AbortController signal for all requests
2. WHEN component unmounts, THE Frontend SHALL cancel pending requests for that component
3. WHEN user changes filters, THE Frontend SHALL cancel previous filter request
4. WHEN user navigates to different tab, THE Frontend SHALL cancel requests for previous tab
5. WHEN request is cancelled, THE API_Client SHALL NOT throw error
6. THE Frontend SHALL log cancelled requests in development mode only

### Requirement 24: TanStack Query Integration

**User Story:** As a developer, I want proper TanStack Query configuration, so that caching, refetching, and error handling follow best practices.

#### Acceptance Criteria

1. THE Frontend SHALL configure TanStack Query with 5 minute stale time for static data
2. THE Frontend SHALL configure TanStack Query with 30 second stale time for dynamic data
3. THE Frontend SHALL configure TanStack Query with 3 retry attempts
4. THE Frontend SHALL configure TanStack Query to refetch on window focus
5. THE Frontend SHALL configure TanStack Query to refetch on network reconnection
6. THE Frontend SHALL use query keys that include filter parameters
7. WHEN filter changes, THE Frontend SHALL invalidate affected queries

### Requirement 25: Optimistic Updates for User Actions

**User Story:** As a user, I want instant feedback for my actions, so that the interface feels responsive even with network latency.

#### Acceptance Criteria

1. WHEN user marks alert as read, THE Frontend SHALL apply Optimistic_Update immediately
2. WHEN user filters checkpoints, THE Frontend SHALL show filtered results immediately using cached data
3. WHEN Optimistic_Update fails, THE Frontend SHALL revert to previous state
4. WHEN Optimistic_Update fails, THE Frontend SHALL display error notification
5. THE Frontend SHALL show subtle indicator during Optimistic_Update pending confirmation
6. WHEN server confirms Optimistic_Update, THE Frontend SHALL remove pending indicator

### Requirement 26: CORS Configuration Validation

**User Story:** As a developer, I want to verify CORS configuration, so that frontend can access Backend_API from different origins.

#### Acceptance Criteria

1. THE Backend_API SHALL include Access-Control-Allow-Origin header in all responses
2. THE Backend_API SHALL include Access-Control-Allow-Methods header with GET, POST, DELETE
3. THE Backend_API SHALL include Access-Control-Allow-Headers header with Content-Type, X-API-Key
4. THE Backend_API SHALL respond to OPTIONS preflight requests with 200 status
5. WHEN Frontend makes cross-origin request, THE browser SHALL NOT block response
6. THE Frontend SHALL log CORS errors with actionable debugging information

### Requirement 27: Development vs Production Proxy

**User Story:** As a developer, I want seamless API access in development and production, so that I can test locally without backend modifications.

#### Acceptance Criteria

1. WHEN running in development mode, THE Vite_Proxy SHALL forward API requests to localhost:8080
2. WHEN running in production mode, THE Frontend SHALL use VITE_API_BASE_URL for API requests
3. THE Vite_Proxy SHALL preserve request headers and body
4. THE Vite_Proxy SHALL forward WebSocket upgrade requests
5. THE Vite_Proxy SHALL forward SSE connections with proper headers
6. WHEN Vite_Proxy target is unreachable, THE Frontend SHALL display clear error message
7. THE Frontend SHALL document proxy configuration in README

### Requirement 28: Error Logging and Debugging

**User Story:** As a developer, I want comprehensive error logging, so that I can diagnose integration issues quickly.

#### Acceptance Criteria

1. THE API_Client SHALL log all request URLs and methods in development mode
2. THE API_Client SHALL log response status codes and timing in development mode
3. WHEN request fails, THE API_Client SHALL log full error details including stack trace
4. THE Frontend SHALL include request ID in error logs when provided by Backend_API
5. THE Frontend SHALL log connection state changes for SSE_Connection and WebSocket_Connection
6. THE Frontend SHALL provide debug mode toggle in UI for production troubleshooting
7. WHEN debug mode enabled, THE Frontend SHALL display request/response details in console

### Requirement 29: Performance Monitoring

**User Story:** As a developer, I want to monitor frontend performance, so that I can identify and fix slow operations.

#### Acceptance Criteria

1. THE Frontend SHALL measure time to first render
2. THE Frontend SHALL measure time to interactive
3. THE Frontend SHALL measure API request duration for each endpoint
4. THE Frontend SHALL measure SSE_Connection reconnection frequency
5. THE Frontend SHALL log performance metrics to console in development mode
6. THE Frontend SHALL expose performance metrics via window.__PERF__ object
7. WHEN API request exceeds 5 seconds, THE Frontend SHALL log slow request warning

### Requirement 30: Accessibility Compliance

**User Story:** As a user with disabilities, I want accessible error messages and loading states, so that I can use the application with assistive technologies.

#### Acceptance Criteria

1. THE Loading_State SHALL include aria-live="polite" announcement
2. THE Error_Boundary SHALL include aria-live="assertive" announcement
3. THE Connection_Status_Indicator SHALL include aria-label describing current status
4. THE Offline_Indicator SHALL include role="alert" for screen reader announcement
5. THE Empty_State SHALL include descriptive text for screen readers
6. THE retry buttons SHALL include aria-label describing retry action
7. THE Frontend SHALL maintain keyboard focus during error recovery

### Requirement 31: Integration Testing Properties

**User Story:** As a developer, I want property-based tests for API integration, so that edge cases and error conditions are thoroughly validated.

#### Acceptance Criteria

1. FOR ALL API_Client functions, parsing then serializing response data SHALL produce equivalent data (round-trip property)
2. FOR ALL retry scenarios, final error SHALL match last attempt error (error preservation property)
3. FOR ALL connection state transitions, state SHALL be one of valid states (state invariant)
4. FOR ALL pagination requests, sum of page items SHALL equal total count (pagination invariant)
5. FOR ALL filter combinations, result count SHALL be less than or equal to unfiltered count (filter monotonicity)
6. FOR ALL concurrent requests to same endpoint, responses SHALL be independent (request isolation)
7. FOR ALL SSE reconnection attempts, delay SHALL increase monotonically up to maximum (backoff monotonicity)

### Requirement 32: Mock Data Toggle

**User Story:** As a developer, I want to toggle between real API and mock data, so that I can develop and test without backend dependency.

#### Acceptance Criteria

1. WHEN VITE_ENABLE_MOCK_DATA is true, THE API_Client SHALL return mock data instead of making HTTP requests
2. THE mock data SHALL match Backend_API response schemas exactly
3. THE mock data SHALL include realistic timestamps and IDs
4. THE mock data SHALL simulate network latency between 100-500ms
5. THE mock data SHALL support simulating error responses via query parameters
6. WHEN mock mode enabled, THE Frontend SHALL display "Mock Mode" indicator in Header
7. THE Frontend SHALL provide UI toggle to switch between mock and real API in development mode

### Requirement 33: Documentation and Examples

**User Story:** As a developer, I want comprehensive integration documentation, so that I can understand and maintain the API integration layer.

#### Acceptance Criteria

1. THE Frontend SHALL include README section documenting environment variables
2. THE Frontend SHALL include README section documenting API_Client usage patterns
3. THE Frontend SHALL include code examples for error handling
4. THE Frontend SHALL include code examples for real-time connection setup
5. THE Frontend SHALL document all custom hooks with JSDoc comments
6. THE Frontend SHALL include troubleshooting guide for common integration issues
7. THE Frontend SHALL document production deployment steps including environment configuration

