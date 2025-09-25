/**
 * Pool Detail API Client
 * Provides access to detailed pool information including TVL, volume, and pricing data
 */

import { logger } from '../utils/logger';
import { ENDPOINTS, buildQueryUrl, getEndpointConfig } from './endpoints';
import { PoolDetailResponse } from './types';

export interface PoolDetailCache {
  data: PoolDetailResponse['data'];
  timestamp: number;
}

/**
 * Error classes for pool detail API
 */
export class PoolDetailError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'PoolDetailError';
  }
}

/**
 * Pool Detail API Client
 *
 * Fetches detailed pool information from the GalaSwap explore/pool endpoint
 * with intelligent caching and error handling.
 *
 * @example
 * ```typescript
 * const client = createPoolDetailClient();
 * const poolData = await client.getPoolDetail('cc93185e6902353cc0e912099790826089d3e3cba8e1e5aa3d5eba9d0c31d742');
 * console.log(`Pool TVL: $${poolData.tvl}`);
 * ```
 */
export class PoolDetailClient {
  private baseUrl: string;
  private cache: Map<string, PoolDetailCache> = new Map();
  private readonly CACHE_TTL = 30 * 1000; // 30 seconds cache
  private timeout: number;

  /**
   * Creates a new PoolDetailClient instance
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.timeout = getEndpointConfig(ENDPOINTS.POOL_DETAIL).timeout;
  }

  /**
   * Get detailed pool information by pool hash
   */
  async getPoolDetail(poolHash: string): Promise<PoolDetailResponse['data']> {
    // Validate pool hash format
    if (!poolHash || typeof poolHash !== 'string') {
      throw new PoolDetailError('Pool hash must be a non-empty string');
    }

    if (!/^[a-fA-F0-9]{64}$/.test(poolHash)) {
      throw new PoolDetailError('Invalid pool hash format: must be 64-character hex string');
    }

    // Check cache first
    const cached = this.cache.get(poolHash);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      logger.debug(`Using cached pool detail for ${poolHash.substring(0, 8)}...`);
      return cached.data;
    }

    try {
      const url = buildQueryUrl(ENDPOINTS.POOL_DETAIL, { poolHash }, this.baseUrl);

      logger.debug(`Fetching pool detail: ${poolHash.substring(0, 8)}...`);

      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new PoolDetailError(
          `Pool detail request failed: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const result = await response.json() as PoolDetailResponse;

      if (result.error || result.status !== 200) {
        throw new PoolDetailError(`Pool detail API error: ${result.message}`);
      }

      if (!result.data) {
        throw new PoolDetailError('Pool detail API returned no data');
      }

      // Cache the result
      this.cache.set(poolHash, {
        data: result.data,
        timestamp: Date.now()
      });

      // Clean up old cache entries (simple cleanup)
      this.cleanupCache();

      logger.debug(`Pool detail fetched: ${result.data.poolName} TVL=$${result.data.tvl.toLocaleString()}`);

      return result.data;

    } catch (error) {
      if (error instanceof PoolDetailError) {
        throw error;
      }

      // Network or other errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Pool detail fetch failed for ${poolHash.substring(0, 8)}: ${errorMessage}`);
      throw new PoolDetailError(`Network error: ${errorMessage}`);
    }
  }

  /**
   * Fetch multiple pool details in parallel
   */
  async getMultiplePoolDetails(poolHashes: string[]): Promise<Array<PoolDetailResponse['data'] | null>> {
    if (!Array.isArray(poolHashes) || poolHashes.length === 0) {
      return [];
    }

    logger.debug(`Fetching ${poolHashes.length} pool details in parallel`);

    const promises = poolHashes.map(async (poolHash) => {
      try {
        return await this.getPoolDetail(poolHash);
      } catch (error) {
        logger.warn(`Failed to fetch pool detail for ${poolHash.substring(0, 8)}: ${error}`);
        return null; // Return null for failed requests
      }
    });

    return Promise.all(promises);
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Pool detail cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxAge: number } {
    const now = Date.now();
    let maxAge = 0;

    for (const entry of this.cache.values()) {
      const age = now - entry.timestamp;
      if (age > maxAge) {
        maxAge = age;
      }
    }

    return {
      size: this.cache.size,
      maxAge
    };
  }

  /**
   * Set custom timeout for requests
   */
  setTimeout(timeoutMs: number): void {
    this.timeout = Math.max(1000, Math.min(30000, timeoutMs)); // 1-30 seconds
    logger.debug(`Pool detail client timeout set to ${this.timeout}ms`);
  }

  /**
   * Fetch with timeout and proper headers
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const signal = this.createTimeoutSignal(this.timeout);

    return fetch(url, {
      method: 'GET',
      signal,
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'priority': 'u=1, i',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'Referer': 'https://swap.gala.com/'
      }
    });
  }

  /**
   * Create timeout signal with fallback for browser compatibility
   */
  private createTimeoutSignal(timeoutMs: number): AbortSignal {
    // Try modern AbortSignal.timeout first
    if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
      try {
        return AbortSignal.timeout(timeoutMs);
      } catch (error) {
        logger.debug('AbortSignal.timeout failed, using fallback');
      }
    }

    // Fallback: create AbortController with setTimeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    // Clean up timeout when signal is used
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
    });

    return controller.signal;
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const maxCacheSize = 100; // Prevent unlimited cache growth

    // Remove expired entries
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL * 2) { // Remove entries older than 2x TTL
        this.cache.delete(key);
      }
    }

    // If still too large, remove oldest entries
    if (this.cache.size > maxCacheSize) {
      const entries = Array.from(this.cache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, this.cache.size - maxCacheSize);

      for (const [key] of entries) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Create a pool detail client with default configuration
 */
export function createPoolDetailClient(baseUrl?: string): PoolDetailClient {
  // Use environment variable or fallback if no baseUrl provided
  const apiBaseUrl = baseUrl || process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com';
  return new PoolDetailClient(apiBaseUrl);
}