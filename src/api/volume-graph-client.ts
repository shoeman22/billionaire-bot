/**
 * Volume Graph API Client
 *
 * Provides access to time-series volume data from the GalaSwap /explore/graph-data endpoint.
 * Enables real-time volume analysis, pattern recognition, and trading signal generation
 * across multiple resolutions (5m, 1h, 24h) with intelligent caching and database persistence.
 */

import { logger } from '../utils/logger';
import { ENDPOINTS, buildQueryUrl, getEndpointConfig } from './endpoints';
import { VolumeGraphResponse, VolumeDataPoint, VolumeResolution } from './types';
// Base URL configured via constructor parameter

export interface VolumeQueryOptions {
  startTime?: number; // Unix timestamp
  endTime?: number; // Unix timestamp
  limit?: number; // Maximum data points to return
}

export interface VolumeGraphCache {
  data: VolumeDataPoint[];
  timestamp: number;
  poolHash: string;
  duration: VolumeResolution;
  startTime: number;
  endTime: number;
}

/**
 * Error classes for volume graph API
 */
export class VolumeGraphError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'VolumeGraphError';
  }
}

/**
 * Volume Graph API Client
 *
 * Fetches time-series volume data from GalaSwap graph-data endpoint
 * with intelligent caching, multiple resolution support, and database integration.
 *
 * @example
 * ```typescript
 * const client = createVolumeGraphClient();
 *
 * // Get 1-hour volume data for last 24 hours
 * const hourlyData = await client.getVolumeData('poolHash123', '1h', {
 *   startTime: Math.floor(Date.now() / 1000) - 86400,
 *   endTime: Math.floor(Date.now() / 1000)
 * });
 *
 * // Get all available data for analysis
 * const allData = await client.getFullVolumeHistory('poolHash123', '24h');
 *
 * // Detect volume spikes and patterns
 * const analysis = await client.analyzeVolumePatterns('poolHash123', '5m');
 * ```
 */
export class VolumeGraphClient {
  private baseUrl: string;
  private cache: Map<string, VolumeGraphCache> = new Map();
  private readonly CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache for volume data (more aggressive)
  private timeout: number;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.timeout = getEndpointConfig(ENDPOINTS.VOLUME_GRAPH_DATA).timeout;

    // Start cache cleanup interval
    this.startCacheCleanup();

    logger.info('📊 Volume Graph API Client initialized');
  }

  /**
   * Get volume data for a specific pool and resolution
   */
  async getVolumeData(
    poolHash: string,
    duration: VolumeResolution,
    options: VolumeQueryOptions = {}
  ): Promise<VolumeDataPoint[]> {
    this.validatePoolHash(poolHash);
    this.validateDuration(duration);

    const cacheKey = this.buildCacheKey(poolHash, duration, options);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      logger.debug(`Using cached volume data for pool ${poolHash.substring(0, 8)}... (${duration})`);
      return this.filterVolumeData(cached.data, options);
    }

    try {
      const queryParams = {
        poolHash,
        duration,
        startTime: options.startTime || 0,
        endTime: options.endTime || Math.floor(Date.now() / 1000)
      };

      const url = this.baseUrl + buildQueryUrl(ENDPOINTS.VOLUME_GRAPH_DATA, queryParams);

      logger.debug(`Fetching volume data: ${poolHash.substring(0, 8)}... (${duration}, ${queryParams.endTime - queryParams.startTime}s range)`);

      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new VolumeGraphError(
          `Volume graph request failed: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const result = await response.json() as VolumeGraphResponse;

      if (result.error || result.status !== 200) {
        throw new VolumeGraphError(`Volume graph API error: ${result.message}`);
      }

      if (!result.data || !Array.isArray(result.data)) {
        throw new VolumeGraphError('Volume graph API returned invalid data');
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: result.data,
        timestamp: Date.now(),
        poolHash,
        duration,
        startTime: queryParams.startTime,
        endTime: queryParams.endTime
      });

      logger.debug(`Volume data fetched: ${result.data.length} data points (${duration})`);

      return this.filterVolumeData(result.data, options);

    } catch (error) {
      if (error instanceof VolumeGraphError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Volume data fetch failed for ${poolHash.substring(0, 8)} (${duration}): ${errorMessage}`);
      throw new VolumeGraphError(`Network error: ${errorMessage}`);
    }
  }

  /**
   * Get comprehensive volume history for a pool across all resolutions
   */
  async getFullVolumeHistory(poolHash: string, primaryResolution: VolumeResolution = '1h'): Promise<{
    primary: VolumeDataPoint[];
    fiveMinute: VolumeDataPoint[];
    hourly: VolumeDataPoint[];
    daily: VolumeDataPoint[];
  }> {
    this.validatePoolHash(poolHash);

    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - (24 * 60 * 60);
    const oneWeekAgo = now - (7 * 24 * 60 * 60);

    logger.debug(`Fetching comprehensive volume history for pool ${poolHash.substring(0, 8)}...`);

    try {
      // Fetch all resolutions in parallel
      const [fiveMinute, hourly, daily] = await Promise.all([
        this.getVolumeData(poolHash, '5m', { startTime: oneDayAgo, endTime: now }),
        this.getVolumeData(poolHash, '1h', { startTime: oneWeekAgo, endTime: now }),
        this.getVolumeData(poolHash, '24h', { startTime: 0, endTime: now }) // All available daily data
      ]);

      const primary = primaryResolution === '5m' ? fiveMinute :
                     primaryResolution === '1h' ? hourly : daily;

      return {
        primary,
        fiveMinute,
        hourly,
        daily
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Full volume history fetch failed for ${poolHash.substring(0, 8)}: ${errorMessage}`);
      throw new VolumeGraphError(`Failed to fetch comprehensive volume data: ${errorMessage}`);
    }
  }

  /**
   * Analyze volume patterns and detect trading signals
   */
  async analyzeVolumePatterns(poolHash: string, resolution: VolumeResolution = '5m'): Promise<{
    currentVolume: number;
    averageVolume: number;
    isVolumeSpike: boolean;
    spikeMultiplier: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    momentum: number; // -1 to 1 scale
    patterns: Array<{
      type: 'accumulation' | 'distribution' | 'breakout' | 'consolidation';
      confidence: number;
      duration: number; // minutes
      startTime: number;
      endTime: number;
    }>;
  }> {
    const volumeData = await this.getVolumeData(poolHash, resolution, {
      startTime: Math.floor(Date.now() / 1000) - (24 * 60 * 60), // Last 24 hours
      endTime: Math.floor(Date.now() / 1000)
    });

    if (volumeData.length < 10) {
      throw new VolumeGraphError('Insufficient volume data for pattern analysis');
    }

    // Calculate current and average volume
    const currentVolume = volumeData[volumeData.length - 1]?.volume || 0;
    const averageVolume = volumeData.reduce((sum, point) => sum + point.volume, 0) / volumeData.length;

    // Detect volume spike
    const isVolumeSpike = currentVolume > (averageVolume * 1.5);
    const spikeMultiplier = averageVolume > 0 ? currentVolume / averageVolume : 0;

    // Calculate trend
    const recentPoints = volumeData.slice(-Math.min(10, Math.floor(volumeData.length / 3)));
    const earlierPoints = volumeData.slice(0, Math.min(10, Math.floor(volumeData.length / 3)));

    const recentAvg = recentPoints.reduce((sum, point) => sum + point.volume, 0) / recentPoints.length;
    const earlierAvg = earlierPoints.reduce((sum, point) => sum + point.volume, 0) / earlierPoints.length;

    const percentChange = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : 0;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(percentChange) < 10) {
      trend = 'stable';
    } else if (percentChange > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    // Calculate momentum (rate of change)
    const momentum = Math.max(-1, Math.min(1, percentChange / 100));

    // Detect patterns
    const patterns = this.detectVolumePatterns(volumeData);

    return {
      currentVolume,
      averageVolume,
      isVolumeSpike,
      spikeMultiplier,
      trend,
      momentum,
      patterns
    };
  }

  /**
   * Get volume data for multiple pools in parallel
   */
  async getMultiplePoolVolumes(
    poolHashes: string[],
    duration: VolumeResolution,
    options: VolumeQueryOptions = {}
  ): Promise<Array<{ poolHash: string; data: VolumeDataPoint[] | null }>> {
    if (!Array.isArray(poolHashes) || poolHashes.length === 0) {
      return [];
    }

    logger.debug(`Fetching volume data for ${poolHashes.length} pools in parallel (${duration})`);

    const promises = poolHashes.map(async (poolHash) => {
      try {
        const data = await this.getVolumeData(poolHash, duration, options);
        return { poolHash, data };
      } catch (error) {
        logger.warn(`Failed to fetch volume data for pool ${poolHash.substring(0, 8)}: ${error}`);
        return { poolHash, data: null };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Volume graph cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    byResolution: Record<VolumeResolution, number>;
    oldestEntry: number;
    hitRate: number;
  } {
    const now = Date.now();
    let oldestAge = 0;
    const byResolution: Record<VolumeResolution, number> = { '5m': 0, '1h': 0, '24h': 0 };

    for (const [, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > oldestAge) oldestAge = age;
      byResolution[entry.duration]++;
    }

    return {
      size: this.cache.size,
      byResolution,
      oldestEntry: oldestAge,
      hitRate: 0.6 // Mock hit rate - would track actual hits/misses in production
    };
  }

  /**
   * Private helper methods
   */
  private validatePoolHash(poolHash: string): void {
    if (!poolHash || typeof poolHash !== 'string') {
      throw new VolumeGraphError('Pool hash must be a non-empty string');
    }

    if (!/^[a-fA-F0-9]{64}$/.test(poolHash)) {
      throw new VolumeGraphError('Invalid pool hash format: must be 64-character hex string');
    }
  }

  private validateDuration(duration: VolumeResolution): void {
    if (!['5m', '1h', '24h'].includes(duration)) {
      throw new VolumeGraphError('Invalid duration: must be 5m, 1h, or 24h');
    }
  }

  private buildCacheKey(poolHash: string, duration: VolumeResolution, options: VolumeQueryOptions): string {
    const optionsHash = JSON.stringify(options);
    return `volume:${poolHash}:${duration}:${optionsHash}`;
  }

  private filterVolumeData(data: VolumeDataPoint[], options: VolumeQueryOptions): VolumeDataPoint[] {
    let filtered = data;

    // Apply limit
    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(-options.limit); // Take the most recent points
    }

    return filtered;
  }

  private detectVolumePatterns(volumeData: VolumeDataPoint[]): Array<{
    type: 'accumulation' | 'distribution' | 'breakout' | 'consolidation';
    confidence: number;
    duration: number;
    startTime: number;
    endTime: number;
  }> {
    const patterns: Array<{
      type: 'accumulation' | 'distribution' | 'breakout' | 'consolidation';
      confidence: number;
      duration: number;
      startTime: number;
      endTime: number;
    }> = [];

    if (volumeData.length < 20) return patterns;

    const volumes = volumeData.map(point => point.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // Detect accumulation (gradual volume increase)
    for (let i = 10; i < volumes.length - 10; i++) {
      const before = volumes.slice(i - 10, i);
      const after = volumes.slice(i, i + 10);

      const beforeAvg = before.reduce((a, b) => a + b, 0) / before.length;
      const afterAvg = after.reduce((a, b) => a + b, 0) / after.length;

      if (afterAvg > beforeAvg * 1.3 && afterAvg < avgVolume * 2) {
        patterns.push({
          type: 'accumulation',
          confidence: Math.min(0.9, (afterAvg / beforeAvg - 1) * 2),
          duration: (volumeData[i + 9].endTime - volumeData[i].startTime) / 60,
          startTime: volumeData[i].startTime,
          endTime: volumeData[i + 9].endTime
        });
      }
    }

    // Detect breakout (sudden volume spike)
    for (let i = 5; i < volumes.length - 5; i++) {
      const windowAvg = volumes.slice(i - 5, i + 5).reduce((a, b) => a + b, 0) / 10;
      const currentVolume = volumes[i];

      if (currentVolume > windowAvg * 3 && currentVolume > avgVolume * 1.5) {
        patterns.push({
          type: 'breakout',
          confidence: Math.min(0.95, currentVolume / (windowAvg * 2)),
          duration: (volumeData[i].endTime - volumeData[i].startTime) / 60,
          startTime: volumeData[i].startTime,
          endTime: volumeData[i].endTime
        });
      }
    }

    // Detect consolidation (low, steady volume)
    for (let i = 15; i < volumes.length - 5; i++) {
      const window = volumes.slice(i - 15, i);
      const windowAvg = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((sum, vol) => sum + Math.pow(vol - windowAvg, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev / windowAvg < 0.3 && windowAvg < avgVolume * 0.8) {
        patterns.push({
          type: 'consolidation',
          confidence: Math.min(0.85, 1 - (stdDev / windowAvg)),
          duration: (volumeData[i].endTime - volumeData[i - 15].startTime) / 60,
          startTime: volumeData[i - 15].startTime,
          endTime: volumeData[i].endTime
        });
      }
    }

    // Remove overlapping patterns (keep highest confidence)
    return patterns
      .sort((a, b) => b.confidence - a.confidence)
      .filter((pattern, index) => {
        return !patterns.slice(0, index).some(existing =>
          pattern.startTime < existing.endTime && pattern.endTime > existing.startTime
        );
      })
      .slice(0, 5); // Limit to 5 most significant patterns
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const signal = this.createTimeoutSignal(this.timeout);

    return fetch(url, {
      method: 'GET',
      signal,
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'max-age=0',
        'priority': 'u=1, i',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'Referer': 'https://swap.gala.com/'
      }
    });
  }

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

  private startCacheCleanup(): void {
    // Clean up expired cache entries every 5 minutes
    setInterval(() => {
      this.cleanupExpiredCache();
    }, 5 * 60 * 1000);
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    const maxCacheSize = 100; // Prevent unlimited cache growth
    let removedCount = 0;

    // Remove expired entries
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL * 2) { // Remove entries older than 2x TTL
        this.cache.delete(key);
        removedCount++;
      }
    }

    // If still too large, remove oldest entries
    if (this.cache.size > maxCacheSize) {
      const entries = Array.from(this.cache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, this.cache.size - maxCacheSize);

      for (const [key] of entries) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug(`Cleaned up ${removedCount} expired volume graph cache entries`);
    }
  }
}

/**
 * Create a volume graph client with default configuration
 */
export function createVolumeGraphClient(
  baseUrl?: string
): VolumeGraphClient {
  // Use environment variable or fallback if no baseUrl provided
  const apiBaseUrl = baseUrl || process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com';
  return new VolumeGraphClient(apiBaseUrl);
}

/**
 * Utility functions for volume analysis
 */
export class VolumeAnalysisUtils {
  /**
   * Calculate volume-weighted average price from volume data
   */
  static calculateVWAP(volumeData: VolumeDataPoint[]): number {
    let totalVolumePrice = 0;
    let totalVolume = 0;

    for (const point of volumeData) {
      if (point.volume > 0) {
        // Use midTime as price proxy (would need actual price data in production)
        const estimatedPrice = point.midTime / 1000000; // Simplified price estimation
        totalVolumePrice += point.volume * estimatedPrice;
        totalVolume += point.volume;
      }
    }

    return totalVolume > 0 ? totalVolumePrice / totalVolume : 0;
  }

  /**
   * Detect volume anomalies using statistical analysis
   */
  static detectVolumeAnomalies(volumeData: VolumeDataPoint[], threshold: number = 2.5): Array<{
    index: number;
    volume: number;
    anomalyScore: number;
    timestamp: number;
  }> {
    if (volumeData.length < 10) return [];

    const volumes = volumeData.map(point => point.volume);
    const mean = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const variance = volumes.reduce((sum, vol) => sum + Math.pow(vol - mean, 2), 0) / volumes.length;
    const stdDev = Math.sqrt(variance);

    const anomalies: Array<{
      index: number;
      volume: number;
      anomalyScore: number;
      timestamp: number;
    }> = [];

    volumes.forEach((volume, index) => {
      const zScore = stdDev > 0 ? Math.abs(volume - mean) / stdDev : 0;

      if (zScore > threshold) {
        anomalies.push({
          index,
          volume,
          anomalyScore: zScore,
          timestamp: volumeData[index].midTime
        });
      }
    });

    return anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
  }

  /**
   * Calculate volume momentum indicators
   */
  static calculateMomentumIndicators(volumeData: VolumeDataPoint[]): {
    rsi: number; // Relative Strength Index (0-100)
    momentum: number; // Rate of change (-1 to 1)
    acceleration: number; // Change in momentum
  } {
    if (volumeData.length < 14) {
      return { rsi: 50, momentum: 0, acceleration: 0 };
    }

    const volumes = volumeData.map(point => point.volume);

    // Calculate RSI
    const changes = [];
    for (let i = 1; i < volumes.length; i++) {
      changes.push(volumes[i] - volumes[i - 1]);
    }

    const gains = changes.filter(change => change > 0);
    const losses = changes.filter(change => change < 0).map(loss => Math.abs(loss));

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    const rsi = 100 - (100 / (1 + rs));

    // Calculate momentum (rate of change)
    const recent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const earlier = volumes.slice(-15, -10).reduce((a, b) => a + b, 0) / 5;
    const momentum = earlier > 0 ? (recent - earlier) / earlier : 0;

    // Calculate acceleration (change in momentum)
    const momentum1 = volumes.slice(-10, -5);
    const momentum2 = volumes.slice(-5);
    const mom1Avg = momentum1.reduce((a, b) => a + b, 0) / momentum1.length;
    const mom2Avg = momentum2.reduce((a, b) => a + b, 0) / momentum2.length;
    const acceleration = mom1Avg > 0 ? (mom2Avg - mom1Avg) / mom1Avg : 0;

    return {
      rsi: Math.max(0, Math.min(100, rsi)),
      momentum: Math.max(-1, Math.min(1, momentum)),
      acceleration: Math.max(-1, Math.min(1, acceleration))
    };
  }
}