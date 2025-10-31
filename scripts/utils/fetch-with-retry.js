/**
 * Fetch with Retry Utility
 * 
 * Provides robust HTTP fetching with exponential backoff and rate limit handling
 */

import { createLogger } from './logger.js';

const logger = createLogger({ context: 'FetchWithRetry' });

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch with retry logic and exponential backoff
 * 
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} retryConfig - Retry configuration
 * @param {number} retryConfig.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} retryConfig.initialDelay - Initial delay in ms before first retry (default: 1000)
 * @param {number} retryConfig.backoffMultiplier - Multiplier for exponential backoff (default: 2)
 * @param {number} retryConfig.maxDelay - Maximum delay between retries in ms (default: 30000)
 * @param {Function} retryConfig.onRetry - Callback function called before each retry
 * @returns {Promise<Response>} - Fetch response
 */
export async function fetchWithRetry(url, options = {}, retryConfig = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    backoffMultiplier = 2,
    maxDelay = 30000,
    onRetry = null,
  } = retryConfig;
  
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Log attempt
      if (attempt === 0) {
        await logger.debug(`Fetching: ${url}`);
      } else {
        await logger.info(`Retry attempt ${attempt}/${maxRetries} for: ${url}`);
      }
      
      // Make the request
      const response = await fetch(url, options);
      
      // Handle rate limiting (HTTP 429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay);
        
        await logger.warn(`Rate limit hit (429) for ${url}, waiting ${delay}ms before retry`);
        
        if (attempt < maxRetries) {
          if (onRetry) {
            await onRetry(attempt + 1, delay, 'rate_limit');
          }
          await sleep(delay);
          continue;
        }
        
        throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
      }
      
      // Handle other HTTP errors
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.statusText = response.statusText;
        error.url = url;
        
        // Don't retry on client errors (4xx except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          await logger.error(`Client error (${response.status}) for ${url}, not retrying`, error);
          throw error;
        }
        
        // Retry on server errors (5xx) and other errors
        if (attempt < maxRetries) {
          const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay);
          await logger.warn(`HTTP ${response.status} for ${url}, retrying in ${delay}ms`);
          
          if (onRetry) {
            await onRetry(attempt + 1, delay, 'http_error');
          }
          await sleep(delay);
          continue;
        }
        
        throw error;
      }
      
      // Success
      if (attempt > 0) {
        await logger.success(`Successfully fetched ${url} after ${attempt} retries`);
      } else {
        await logger.debug(`Successfully fetched ${url}`);
      }
      
      return response;
      
    } catch (error) {
      lastError = error;
      
      // Network errors, timeouts, etc.
      if (attempt < maxRetries) {
        const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay);
        await logger.warn(`Fetch failed for ${url}: ${error.message}, retrying in ${delay}ms`);
        
        if (onRetry) {
          await onRetry(attempt + 1, delay, 'network_error');
        }
        await sleep(delay);
        continue;
      }
      
      // Max retries exceeded
      await logger.error(`Failed to fetch ${url} after ${maxRetries} retries`, error);
      throw error;
    }
  }
  
  // Should never reach here, but just in case
  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

/**
 * Fetch JSON with retry logic
 * 
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} retryConfig - Retry configuration
 * @returns {Promise<any>} - Parsed JSON response
 */
export async function fetchJSONWithRetry(url, options = {}, retryConfig = {}) {
  const response = await fetchWithRetry(url, options, retryConfig);
  
  try {
    const data = await response.json();
    return data;
  } catch (error) {
    await logger.error(`Failed to parse JSON from ${url}`, error);
    throw new Error(`Failed to parse JSON response: ${error.message}`);
  }
}

/**
 * Fetch text with retry logic
 * 
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} retryConfig - Retry configuration
 * @returns {Promise<string>} - Text response
 */
export async function fetchTextWithRetry(url, options = {}, retryConfig = {}) {
  const response = await fetchWithRetry(url, options, retryConfig);
  
  try {
    const text = await response.text();
    return text;
  } catch (error) {
    await logger.error(`Failed to read text from ${url}`, error);
    throw new Error(`Failed to read text response: ${error.message}`);
  }
}

/**
 * Create a rate-limited fetcher that respects a minimum delay between requests
 * 
 * @param {number} minDelay - Minimum delay in ms between requests
 * @returns {Function} - Rate-limited fetch function
 */
export function createRateLimitedFetcher(minDelay = 1000) {
  let lastRequestTime = 0;
  
  return async function rateLimitedFetch(url, options = {}, retryConfig = {}) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < minDelay) {
      const waitTime = minDelay - timeSinceLastRequest;
      await logger.debug(`Rate limiting: waiting ${waitTime}ms before next request`);
      await sleep(waitTime);
    }
    
    lastRequestTime = Date.now();
    return fetchWithRetry(url, options, retryConfig);
  };
}

/**
 * Batch fetch multiple URLs with retry logic
 * 
 * @param {Array<string>} urls - Array of URLs to fetch
 * @param {Object} options - Fetch options
 * @param {Object} retryConfig - Retry configuration
 * @param {number} concurrency - Maximum concurrent requests (default: 5)
 * @returns {Promise<Array>} - Array of responses
 */
export async function batchFetchWithRetry(urls, options = {}, retryConfig = {}, concurrency = 5) {
  const results = [];
  const errors = [];
  
  await logger.info(`Batch fetching ${urls.length} URLs with concurrency ${concurrency}`);
  
  // Process URLs in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    
    const batchResults = await Promise.allSettled(
      batch.map(url => fetchWithRetry(url, options, retryConfig))
    );
    
    batchResults.forEach((result, index) => {
      const url = batch[index];
      if (result.status === 'fulfilled') {
        results.push({ url, response: result.value, success: true });
      } else {
        results.push({ url, error: result.reason, success: false });
        errors.push({ url, error: result.reason });
      }
    });
  }
  
  await logger.info(`Batch fetch completed: ${results.filter(r => r.success).length}/${urls.length} successful`);
  
  if (errors.length > 0) {
    await logger.warn(`${errors.length} URLs failed to fetch`, { errors: errors.map(e => e.url) });
  }
  
  return results;
}

export default fetchWithRetry;
