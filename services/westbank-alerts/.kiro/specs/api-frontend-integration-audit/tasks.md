21w# Implementation Plan: API-Frontend Integration Audit

## Overview

This plan transforms the West Bank Alert System frontend from mock data to production API integration. The implementation follows a layered approach: foundation (environment config, API client), core integration (endpoints, TanStack Query), real-time connections (SSE/WebSocket), error handling, performance optimization, UX improvements, and production readiness.

The backend FastAPI is fully functional. All tasks focus on frontend changes with minimal backend additions (alert geocoding only).

## Tasks

- [x] 1. Foundation: Environment Configuration and API Client Core
  - [x] 1.1 Create environment configuration module
    - Create `src/config/environment.ts` with EnvironmentConfig interface
    - Implement validateEnvironment() function with build-time validation
    - Add support for VITE_API_BASE_URL, VITE_WS_BASE_URL, VITE_API_VERSION
    - Add feature flags: VITE_ENABLE_MOCK_DATA, VITE_DEBUG
    - Create `.env.example` documenting all environment variables
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.2 Create TypeScript type definitions for API models
    - Create `src/lib/api/types.ts` with all interfaces from design
    - Define Alert, Checkpoint, CheckpointUpdate, Stats, Health types
    - Define query parameter interfaces (AlertQueryParams, CheckpointQueryParams)
    - Define response wrapper types (AlertResponse, CheckpointListResponse)
    - Define GeoJSON types (GeoJSONFeature, GeoJSONFeatureCollection)
    - _Requirements: 2.5_

  - [x] 1.3 Implement custom error classes
    - Create `src/lib/api/errors.ts` with APIError base class
    - Implement NetworkError, TimeoutError, NotFoundError classes
    - Implement AuthenticationError, RateLimitError, ServerError classes
    - Include statusCode, responseBody, and retryAfter properties
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 1.4 Build core API client with interceptors
    - Create `src/lib/api/client.ts` with APIClient class
    - Implement constructor accepting APIClientConfig
    - Implement get(), post(), delete() methods with typed responses
    - Add request interceptor for common headers and logging
    - Add response interceptor for error transformation
    - Support AbortController for request cancellation
    - Log requests/responses in development mode only
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 23.1_

  - [ ]* 1.5 Write property test for API client error transformation
    - **Property: Error classification consistency**
    - **Validates: Requirements 3.1-3.7**
    - Test that HTTP status codes map to correct error classes
    - Test that error properties (statusCode, responseBody) are preserved

- [x] 2. Core Integration: API Endpoints and TanStack Query
  - [x] 2.1 Implement typed endpoint functions
    - Create `src/lib/api/endpoints.ts` with all endpoint functions
    - Implement getAlerts(), getLatestAlerts(), getCheckpoints()
    - Implement getCheckpointSummary(), getCheckpointGeoJSON()
    - Implement getStats(), getCheckpointStats(), getHealth()
    - Use Environment_Config for base URL construction
    - Include proper TypeScript return types for all functions
    - _Requirements: 2.1, 2.2, 2.6_

  - [x] 2.2 Implement retry logic with exponential backoff
    - Create `src/lib/api/retry.ts` with retry configuration
    - Implement retry logic for NetworkError, ServerError, TimeoutError
    - Use exponential backoff: 1s, 2s, 4s delays
    - Skip retry for AuthenticationError and NotFoundError
    - Limit retries: 3 for network/server, 2 for timeout
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ]* 2.3 Write property test for retry backoff monotonicity
    - **Property: Backoff delays increase monotonically**
    - **Validates: Requirements 5.4, 5.5, 5.6, 31.7**
    - Test that each retry delay is greater than or equal to previous
    - Test that maximum delay cap is respected

  - [x] 2.4 Configure TanStack Query client
    - Create `src/lib/queryClient.ts` with QueryClient configuration
    - Set staleTime: 5 minutes for static data, 30 seconds for dynamic
    - Configure retry: 3 attempts with exponential backoff
    - Enable refetchOnWindowFocus and refetchOnReconnect
    - Create queryKeys factory for all endpoints
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_

  - [x] 2.5 Create custom query hooks for checkpoints
    - Create `src/hooks/useCheckpoints.ts`
    - Implement useCheckpoints() hook with filter support
    - Implement useCheckpointSummary() with 30s polling
    - Implement useCheckpointGeoJSON() with 60s cache
    - Use queryKeys factory for cache key generation
    - _Requirements: 13.1, 13.2, 13.5_

  - [x] 2.6 Create custom query hooks for alerts
    - Create `src/hooks/useAlerts.ts`
    - Implement useAlerts() hook with pagination support
    - Implement useLatestAlerts() hook
    - Configure appropriate staleTime for alert data
    - _Requirements: 15.1, 24.1_

  - [ ]* 2.7 Write property test for query key uniqueness
    - **Property: Different filters produce different query keys**
    - **Validates: Requirements 24.6, 24.7**
    - Test that query keys include all filter parameters
    - Test that identical filters produce identical keys

- [x] 3. Checkpoint - Ensure core API integration works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Real-time Connections: SSE and WebSocket Management
  - [x] 4.1 Implement SSE Connection Manager
    - Create `src/lib/realtime/SSEConnectionManager.ts`
    - Implement ConnectionManager interface with status tracking
    - Handle EventSource lifecycle: connect, disconnect, reconnect
    - Implement exponential backoff: 2s, 5s, 10s, max 30s
    - Parse incoming messages and emit typed events
    - Reset reconnection delay on successful heartbeat
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 4.2 Implement WebSocket Connection Manager
    - Create `src/lib/realtime/WebSocketConnectionManager.ts`
    - Implement ConnectionManager interface for WebSocket
    - Send ping every 25 seconds for keepalive
    - Handle pong responses from server
    - Apply same reconnection logic as SSE
    - Parse JSON messages with error handling
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 4.3 Create useRealtime custom hook
    - Create `src/hooks/useRealtime.ts` with connection type selection
    - Manage alerts and checkpointUpdates state
    - Expose connectionStatus and reconnect function
    - Support onAlert and onCheckpointUpdate callbacks
    - Clean up connections on unmount
    - _Requirements: 6.8, 6.9_

  - [x] 4.4 Integrate real-time updates with TanStack Query
    - Update useRealtime to invalidate queries on new data
    - Invalidate checkpoint queries on checkpoint_update events
    - Invalidate alert queries on new alert events
    - Update MapView markers on checkpoint status changes
    - _Requirements: 17.4, 17.5, 24.7_

  - [ ]* 4.5 Write property test for connection state transitions
    - **Property: Connection state is always valid**
    - **Validates: Requirements 6.8, 31.3**
    - Test that status is always one of: connected, connecting, disconnected
    - Test that state transitions follow valid paths

- [x] 5. Error Handling: Boundaries and User Feedback
  - [x] 5.1 Implement Error Boundary component
    - Create `src/components/ErrorBoundary.tsx` as class component
    - Implement getDerivedStateFromError and componentDidCatch
    - Add reset() method to clear error state
    - Support custom fallback render function
    - Support onError callback for logging
    - _Requirements: 4.4, 4.5, 4.6_

  - [x] 5.2 Create error fallback UI components
    - Create `src/components/AppErrorFallback.tsx` for app-level errors
    - Create `src/components/ComponentErrorFallback.tsx` for component errors
    - Include error message, stack trace (dev only), and retry button
    - Style with appropriate error colors and icons
    - _Requirements: 4.5, 4.6_

  - [x] 5.3 Wrap application with Error Boundaries
    - Wrap App root with ErrorBoundary in `src/App.tsx`
    - Wrap MapView with ErrorBoundary in Dashboard
    - Wrap LiveFeed with ErrorBoundary in Dashboard
    - Ensure boundaries preserve state outside failed component
    - _Requirements: 4.1, 4.2, 4.3, 4.7_

  - [x] 5.4 Implement user-friendly error messages
    - Create `src/lib/errorMessages.ts` with error type to message mapping
    - Translate APIError types to user-friendly text
    - Include actionable guidance (e.g., "Check your connection")
    - Support internationalization structure for future i18n
    - _Requirements: 3.8_

  - [x] 5.5 Add rate limit handling with countdown
    - Detect RateLimitError and extract retry-after duration
    - Display notification with countdown timer
    - Reduce polling frequency during rate limit
    - Resume normal frequency when limit clears
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7_

  - [x] 5.6 Implement API version mismatch handling
    - Detect 426 Upgrade Required response
    - Extract required version from response
    - Display version mismatch error with current and required versions
    - Include "Refresh page" button to reload application
    - _Requirements: 21.5, 21.6, 21.7_

- [x] 6. Performance Optimization: Pagination, Debouncing, Caching
  - [x] 6.1 Implement pagination for AlertList
    - Update AlertList to fetch 50 items per page
    - Add infinite scroll with intersection observer
    - Display "Loading more..." indicator during fetch
    - Show "No more items" when all pages loaded
    - Preserve scroll position on page load
    - _Requirements: 15.1, 15.3, 15.4, 15.5, 15.7_

  - [x] 6.2 Implement pagination for CheckpointList
    - Update CheckpointList to fetch 100 items per page
    - Support both infinite scroll and "Load more" button
    - Handle pagination state with TanStack Query
    - _Requirements: 15.2, 15.6_

  - [ ]* 6.3 Write property test for pagination invariant
    - **Property: Sum of page items equals total count**
    - **Validates: Requirements 31.4**
    - Test that paginated results sum to total
    - Test that no items are duplicated across pages

  - [x] 6.4 Implement search debouncing
    - Add 300ms debounce to search inputs
    - Cancel pending requests when new search starts
    - Show "Searching..." indicator during debounce delay
    - Clear filters immediately when search is empty
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 6.5 Add search query persistence in URL
    - Store search query in URL query parameters
    - Restore search query from URL on navigation back
    - Update URL without triggering page reload
    - _Requirements: 16.6, 16.7_

  - [x] 6.6 Optimize MapView with GeoJSON endpoint
    - Update MapView to use getCheckpointGeoJSON()
    - Cache GeoJSON response for 60 seconds
    - Render all markers within 500ms of data load
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 6.7 Implement map marker clustering
    - Add clustering when marker count exceeds 50
    - Decluster progressively on zoom in
    - Use appropriate cluster styling
    - _Requirements: 17.6, 17.7_

  - [x] 6.8 Implement optimistic updates for user actions
    - Apply immediate UI updates for filter changes using cached data
    - Show subtle pending indicator during server confirmation
    - Revert to previous state on failure with error notification
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6_

- [x] 7. Checkpoint - Ensure performance optimizations work
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. UX Improvements: Loading, Empty States, Connection Indicators
  - [ ] 8.1 Create skeleton loading components
    - Create skeleton components matching final content layout
    - Add skeleton for CheckpointList items
    - Add skeleton for AlertList items
    - Add skeleton for KpiStrip numbers
    - Add loading spinner for MapView
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 8.2 Integrate loading states in Dashboard
    - Display Loading_State for each section during initial fetch
    - Replace skeletons with content within 100ms of data arrival
    - Ensure smooth transition from loading to content
    - _Requirements: 8.1, 8.7_

  - [ ] 8.3 Create empty state components
    - Create Empty component with icon, heading, description
    - Add "Clear filters" button for filter-induced empty states
    - Add "Refresh" button for no-data empty states
    - Style appropriately with muted colors
    - _Requirements: 9.4, 9.5, 9.6_

  - [ ] 8.4 Integrate empty states in lists and map
    - Add empty state to CheckpointList when zero checkpoints
    - Add empty state to AlertList when zero alerts
    - Add empty state overlay to MapView when zero markers
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ] 8.5 Implement connection status indicator
    - Create ConnectionIndicator component for Header
    - Show green/yellow/red indicator based on connection status
    - Add animation for "connecting" state
    - Include tooltip with last update timestamp
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 8.6 Create connection details modal
    - Display modal on ConnectionIndicator click
    - Show uptime, message counts, reconnection attempts
    - Include connection type (SSE/WebSocket) and status
    - _Requirements: 10.6, 10.7_

  - [ ] 8.7 Implement offline detection banner
    - Listen to browser online/offline events
    - Display banner at top of viewport when offline
    - Auto-hide banner 2 seconds after reconnection
    - Include role="alert" for accessibility
    - Trigger data refetch on reconnection
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 8.8 Implement stale data detection and indicators
    - Mark checkpoints as stale when last_updated > 6 hours
    - Mark alerts as stale when timestamp > 2 hours
    - Display stale badge on affected items
    - Dim stale items in lists
    - Reduce opacity of stale markers on map
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ] 8.9 Add stale data warning banner
    - Check Health endpoint for is_data_stale flag
    - Display warning banner when data is stale
    - Include last update timestamp and "Refresh" button
    - _Requirements: 12.6, 12.7_

  - [ ] 8.10 Implement map bounds fitting
    - Auto-fit bounds to show all markers on initial load
    - Add 10% padding around bounds
    - Disable auto-fit when user manually pans/zooms
    - Add "Reset view" button to reapply bounds fitting
    - Reapply bounds on filter changes
    - Default to West Bank view when zero markers
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

- [ ] 9. Backend Enhancement: Alert Geocoding
  - [ ] 9.1 Add latitude and longitude fields to Alert model
    - Update Alert SQLAlchemy model in `app/models.py`
    - Add latitude and longitude as optional Float columns
    - Update Pydantic schema to include coordinate fields
    - _Requirements: 19.1_

  - [ ] 9.2 Implement alert geocoding logic
    - Create geocoding function in `app/classifier.py`
    - Match alert area to checkpoint directory coordinates
    - Use region centroid when no exact match found
    - Apply geocoding during alert classification
    - _Requirements: 19.2, 19.3, 19.4_

  - [ ] 9.3 Update frontend to display alert markers on map
    - Add alert markers to MapView with distinct icon
    - Color-code alert markers by severity
    - Display alert details in popup on marker click
    - _Requirements: 19.5, 19.6, 19.7_

- [ ] 10. Production Readiness: Build Config, Monitoring, Accessibility
  - [ ] 10.1 Configure production build settings
    - Update `vite.config.ts` for production optimization
    - Remove console.log statements except errors
    - Enable minification for JS and CSS
    - Generate separate source map files
    - Add cache-busting hashes to asset filenames
    - Configure output directory to dist/public
    - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.6_

  - [ ] 10.2 Add build-time environment validation
    - Call validateEnvironment() in production builds
    - Fail build if required variables missing
    - Display clear error message with missing variable names
    - _Requirements: 20.1, 20.7_

  - [ ] 10.3 Implement health polling
    - Poll /health endpoint every 60 seconds
    - Display system warning when status != "ok"
    - Display "Data source offline" when monitor disconnected
    - Show critical error banner after 3 consecutive failures
    - Include retry countdown in error banner
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6_

  - [ ] 10.4 Add health metrics to connection details
    - Display backend uptime in connection modal
    - Show WebSocket and SSE client counts
    - Display monitor connection status
    - _Requirements: 14.4_

  - [ ] 10.5 Implement performance monitoring
    - Measure time to first render and time to interactive
    - Measure API request duration per endpoint
    - Track SSE reconnection frequency
    - Log metrics to console in development mode
    - Expose metrics via window.__PERF__ object
    - Log warning for requests exceeding 5 seconds
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7_

  - [ ] 10.6 Add comprehensive error logging
    - Log all request URLs and methods in development
    - Log response status codes and timing
    - Log full error details including stack traces
    - Include request ID in logs when provided by backend
    - Log connection state changes for SSE/WebSocket
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5_

  - [ ] 10.7 Implement debug mode toggle
    - Add debug mode toggle in UI for production troubleshooting
    - Display request/response details in console when enabled
    - Persist debug mode preference in localStorage
    - _Requirements: 28.6, 28.7_

  - [ ] 10.8 Ensure accessibility compliance
    - Add aria-live="polite" to loading states
    - Add aria-live="assertive" to error boundaries
    - Add aria-label to connection status indicator
    - Add role="alert" to offline indicator
    - Add descriptive text to empty states for screen readers
    - Add aria-label to retry buttons
    - Maintain keyboard focus during error recovery
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.5, 30.6, 30.7_

  - [ ] 10.9 Configure API versioning support
    - Add VITE_API_VERSION to environment config (default "v1")
    - Prepend version to all endpoint paths when set
    - Include X-API-Version header in requests
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [ ] 10.10 Validate CORS configuration
    - Verify Access-Control-Allow-Origin in backend responses
    - Verify Access-Control-Allow-Methods includes GET, POST, DELETE
    - Verify Access-Control-Allow-Headers includes Content-Type, X-API-Key
    - Test OPTIONS preflight requests return 200
    - Add CORS error logging with debugging info
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6_

  - [ ] 10.11 Configure development proxy
    - Update `vite.config.ts` with proxy to localhost:8080
    - Preserve request headers and body in proxy
    - Forward WebSocket upgrade requests
    - Forward SSE connections with proper headers
    - Add clear error message when proxy target unreachable
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6_

- [ ] 11. Testing and Mock Data Support
  - [ ] 11.1 Implement mock data mode
    - Create `src/lib/api/mockData.ts` with mock responses
    - Match Backend_API response schemas exactly
    - Include realistic timestamps and IDs
    - Simulate network latency (100-500ms)
    - _Requirements: 32.1, 32.2, 32.3, 32.4_

  - [ ] 11.2 Add mock mode toggle and indicator
    - Check VITE_ENABLE_MOCK_DATA flag in API client
    - Return mock data instead of HTTP requests when enabled
    - Display "Mock Mode" indicator in Header
    - Add UI toggle for development mode
    - _Requirements: 32.1, 32.6, 32.7_

  - [ ] 11.3 Support mock error simulation
    - Allow simulating error responses via query parameters
    - Support testing 404, 429, 500 error scenarios
    - Support testing network timeout scenarios
    - _Requirements: 32.5_

  - [ ]* 11.4 Write property test for round-trip consistency
    - **Property: Parse then serialize produces equivalent data**
    - **Validates: Requirements 31.1**
    - Test that API response parsing is lossless
    - Test for all endpoint response types

  - [ ]* 11.5 Write property test for filter monotonicity
    - **Property: Filtered results ≤ unfiltered results**
    - **Validates: Requirements 31.5**
    - Test that applying filters never increases result count
    - Test for all filter combinations

  - [ ]* 11.6 Write property test for request isolation
    - **Property: Concurrent requests are independent**
    - **Validates: Requirements 31.6**
    - Test that simultaneous requests don't interfere
    - Test that responses match their requests

- [ ] 12. Documentation and Deployment
  - [ ] 12.1 Document environment variables in README
    - Add section explaining all VITE_* variables
    - Include examples for development and production
    - Document required vs optional variables
    - _Requirements: 33.1_

  - [ ] 12.2 Document API client usage patterns
    - Add section with code examples for API client
    - Document error handling patterns
    - Document real-time connection setup
    - Include troubleshooting guide for common issues
    - _Requirements: 33.2, 33.3, 33.4, 33.6_

  - [ ] 12.3 Add JSDoc comments to custom hooks
    - Document all parameters and return types
    - Include usage examples in comments
    - Document error conditions and edge cases
    - _Requirements: 33.5_

  - [ ] 12.4 Document production deployment steps
    - Create deployment guide with environment configuration
    - Document build process and output structure
    - Include nginx/Apache configuration examples
    - Document CORS requirements for production
    - _Requirements: 33.7, 27.7_

- [ ] 13. Final checkpoint - Ensure all integration complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties
- The implementation is TypeScript-based (React frontend)
- Backend changes are minimal (only alert geocoding in task 9)
- Focus is on production-grade integration patterns
