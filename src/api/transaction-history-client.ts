/**
 * Transaction History API Client
 *
 * Provides access to historical trading data from the GalaSwap explore API.
 * Enables analysis of whale movements, volume patterns, and trading behavior
 * for enhanced arbitrage strategies and smart money following.
 */

import { logger } from '../utils/logger';
import { ENDPOINTS, buildQueryUrl, getEndpointConfig } from './endpoints';
import { PersistenceService, createPersistenceService, PersistenceUtils } from '../services/persistence-service';
import { getCacheSettings } from '../config/configuration';
import {
  PoolTransactionsResponse,
  UserHistoryResponse,
  PoolAnalyticsResponse,
  TransactionRecord
} from './types';

export interface TransactionHistoryCache {
  data: TransactionRecord[];
  timestamp: number;
  poolHash: string;
}

export interface TransactionQueryOptions {
  limit?: number;
  offset?: number;
  fromTime?: string;
  toTime?: string;
  minVolume?: number;
  userAddresses?: string[];
}

/**
 * Error classes for transaction history API
 */
export class TransactionHistoryError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'TransactionHistoryError';
  }
}

/**
 * Transaction History API Client
 *
 * Fetches historical transaction data from GalaSwap explore endpoints
 * with intelligent caching, filtering, and batch processing capabilities.
 *
 * @example
 * ```typescript
 * const client = createTransactionHistoryClient();
 *
 * // Get all transactions for a pool
 * const transactions = await client.getPoolTransactions('poolHash123');
 *
 * // Get whale trader history
 * const whaleHistory = await client.getUserHistory('client|64f8caf887fd8551315d8509');
 *
 * // Get pool analytics
 * const analytics = await client.getPoolAnalytics('poolHash123');
 * ```
 */
export class TransactionHistoryClient {
  private baseUrl: string;
  private cache: Map<string, TransactionHistoryCache> = new Map();
  private persistence: PersistenceService | null = null;
  private cacheTTL: number = 5 * 60 * 1000; // Default 5 minutes cache for transaction data
  private timeout: number;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  constructor(baseUrl: string, persistenceService?: PersistenceService) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.timeout = getEndpointConfig(ENDPOINTS.POOL_TRANSACTIONS).timeout;
    this.persistence = persistenceService || null;

    // Initialize with configuration
    this.initializeAsync();

    // Start cache cleanup interval
    this.startCacheCleanup();

    logger.info('🔍 Transaction History API Client initialized');
  }

  /**
   * Initialize persistence service and load configuration
   */
  private async initializeAsync(): Promise<void> {
    try {
      // Initialize persistence service if not provided
      if (!this.persistence) {
        this.persistence = await createPersistenceService();
      }

      // Load cache settings from configuration
      const cacheSettings = await getCacheSettings();
      this.cacheTTL = ((cacheSettings.transactionCacheTtlMinutes as number) || 5) * 60 * 1000;

      logger.info('✅ Transaction History Client persistence initialized', {
        cacheTtl: this.cacheTTL / 1000 / 60 + 'min'
      });

    } catch (error) {
      logger.error('❌ Transaction History Client persistence initialization failed:', error);
      this.persistence = null;
    }
  }

  /**
   * Get transaction history for a specific pool
   */
  async getPoolTransactions(
    poolHash: string,
    options: TransactionQueryOptions = {}
  ): Promise<TransactionRecord[]> {
    this.validatePoolHash(poolHash);

    const cacheKey = this.buildCacheKey('pool', poolHash, options);

    // Check database cache first
    if (this.persistence) {
      try {
        const dbCached = await this.persistence.getCachedTransactions(cacheKey);
        if (dbCached) {
          this.cacheHits++;
          logger.debug(`Using DB cached transactions for pool ${poolHash.substring(0, 8)}...`);
          return this.filterTransactions(dbCached.transactionData as TransactionRecord[], options);
        }
      } catch (error) {
        logger.warn(`Failed to get DB cache for pool ${poolHash.substring(0, 8)}: ${error}`);
      }
    }

    // Check memory cache as fallback
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      this.cacheHits++;
      logger.debug(`Using memory cached transactions for pool ${poolHash.substring(0, 8)}...`);
      return this.filterTransactions(cached.data, options);
    }

    this.cacheMisses++;

    try {
      const apiParams = {
        poolHash,
        limit: options.limit || 1000,
        offset: options.offset || 0,
        ...(options.fromTime && { fromTime: options.fromTime }),
        ...(options.toTime && { toTime: options.toTime }),
        ...(options.minVolume && { minVolume: options.minVolume.toString() })
      };

      const dbParams = {
        limit: options.limit || 1000,
        offset: options.offset || 0,
        ...(options.fromTime && { fromTime: options.fromTime }),
        ...(options.toTime && { toTime: options.toTime }),
        ...(options.minVolume && { minVolume: options.minVolume })
      };

      const url = this.baseUrl + buildQueryUrl(ENDPOINTS.POOL_TRANSACTIONS, apiParams);

      logger.debug(`Fetching pool transactions: ${poolHash.substring(0, 8)}...`);

      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new TransactionHistoryError(
          `Pool transactions request failed: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const result = await response.json() as PoolTransactionsResponse;

      if (!result.success) {
        throw new TransactionHistoryError(`Pool transactions API error: ${result.message}`);
      }

      if (!result.data?.transactions) {
        throw new TransactionHistoryError('Pool transactions API returned no data');
      }

      // Cache in memory first
      this.cache.set(cacheKey, {
        data: result.data.transactions,
        timestamp: Date.now(),
        poolHash
      });

      // Store in database cache
      if (this.persistence) {
        try {
          await this.persistence.storeTransactionCache({
            cacheKey,
            poolHash,
            userAddress: undefined,
            queryParams: dbParams,
            transactionData: result.data.transactions,
            expiresAt: new Date(Date.now() + this.cacheTTL),
            lastAccessedAt: new Date()
          });
        } catch (error) {
          logger.warn(`Failed to store DB cache for pool ${poolHash.substring(0, 8)}: ${error}`);
        }
      }

      logger.debug(`Pool transactions fetched: ${result.data.transactions.length} transactions`);

      return this.filterTransactions(result.data.transactions, options);

    } catch (error) {
      if (error instanceof TransactionHistoryError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Pool transactions fetch failed for ${poolHash.substring(0, 8)}: ${errorMessage}`);
      throw new TransactionHistoryError(`Network error: ${errorMessage}`);
    }
  }

  /**
   * Get trading history for a specific user
   */
  async getUserHistory(
    userAddress: string,
    options: TransactionQueryOptions = {}
  ): Promise<TransactionRecord[]> {
    this.validateUserAddress(userAddress);

    const cacheKey = this.buildCacheKey('user', userAddress, options);

    // Check database cache first
    if (this.persistence) {
      try {
        const dbCached = await this.persistence.getCachedTransactions(cacheKey);
        if (dbCached) {
          this.cacheHits++;
          logger.debug(`Using DB cached history for user ${userAddress.substring(0, 12)}...`);
          return dbCached.transactionData as TransactionRecord[];
        }
      } catch (error) {
        logger.warn(`Failed to get DB cache for user ${userAddress.substring(0, 12)}: ${error}`);
      }
    }

    // Check memory cache as fallback
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      this.cacheHits++;
      logger.debug(`Using memory cached history for user ${userAddress.substring(0, 12)}...`);
      return cached.data;
    }

    this.cacheMisses++;

    try {
      const queryParams = {
        userAddress,
        limit: options.limit || 500,
        offset: options.offset || 0,
        ...(options.fromTime && { fromTime: options.fromTime }),
        ...(options.toTime && { toTime: options.toTime })
      };

      const url = this.baseUrl + buildQueryUrl(ENDPOINTS.USER_HISTORY, queryParams);

      logger.debug(`Fetching user history: ${userAddress.substring(0, 12)}...`);

      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new TransactionHistoryError(
          `User history request failed: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const result = await response.json() as UserHistoryResponse;

      if (!result.success) {
        throw new TransactionHistoryError(`User history API error: ${result.message}`);
      }

      if (!result.data?.transactions) {
        throw new TransactionHistoryError('User history API returned no data');
      }

      // Cache in memory first
      this.cache.set(cacheKey, {
        data: result.data.transactions,
        timestamp: Date.now(),
        poolHash: 'user-history'
      });

      // Store in database cache
      if (this.persistence) {
        try {
          await this.persistence.storeTransactionCache({
            cacheKey,
            poolHash: undefined,
            userAddress,
            queryParams,
            transactionData: result.data.transactions,
            expiresAt: new Date(Date.now() + this.cacheTTL),
            lastAccessedAt: new Date()
          });
        } catch (error) {
          logger.warn(`Failed to store DB cache for user ${userAddress.substring(0, 12)}: ${error}`);
        }
      }

      logger.debug(`User history fetched: ${result.data.transactions.length} transactions`);

      return result.data.transactions;

    } catch (error) {
      if (error instanceof TransactionHistoryError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`User history fetch failed for ${userAddress.substring(0, 12)}: ${errorMessage}`);
      throw new TransactionHistoryError(`Network error: ${errorMessage}`);
    }
  }

  /**
   * Get comprehensive analytics for a pool
   */
  async getPoolAnalytics(poolHash: string): Promise<PoolAnalyticsResponse['data']> {
    this.validatePoolHash(poolHash);

    try {
      const url = this.baseUrl + buildQueryUrl(ENDPOINTS.POOL_ANALYTICS, { poolHash });

      logger.debug(`Fetching pool analytics: ${poolHash.substring(0, 8)}...`);

      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new TransactionHistoryError(
          `Pool analytics request failed: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const result = await response.json() as PoolAnalyticsResponse;

      if (!result.success) {
        throw new TransactionHistoryError(`Pool analytics API error: ${result.message}`);
      }

      if (!result.data) {
        throw new TransactionHistoryError('Pool analytics API returned no data');
      }

      logger.debug(`Pool analytics fetched: ${result.data.analytics.totalTrades} total trades`);

      return result.data;

    } catch (error) {
      if (error instanceof TransactionHistoryError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Pool analytics fetch failed for ${poolHash.substring(0, 8)}: ${errorMessage}`);
      throw new TransactionHistoryError(`Network error: ${errorMessage}`);
    }
  }

  /**
   * Get recent transactions for multiple pools (batch operation)
   */
  async getMultiplePoolTransactions(
    poolHashes: string[],
    options: TransactionQueryOptions = {}
  ): Promise<Array<{ poolHash: string; transactions: TransactionRecord[] | null }>> {
    if (!Array.isArray(poolHashes) || poolHashes.length === 0) {
      return [];
    }

    logger.debug(`Fetching transactions for ${poolHashes.length} pools in parallel`);

    const promises = poolHashes.map(async (poolHash) => {
      try {
        const transactions = await this.getPoolTransactions(poolHash, options);
        return { poolHash, transactions };
      } catch (error) {
        logger.warn(`Failed to fetch transactions for pool ${poolHash.substring(0, 8)}: ${error}`);
        return { poolHash, transactions: null };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Get whale traders from recent transactions
   */
  async getWhaleTraders(poolHash: string, minVolume: number = 100): Promise<string[]> {
    const transactions = await this.getPoolTransactions(poolHash, {
      limit: 1000,
      minVolume
    });

    // Group by user and calculate volume
    const userVolumes = new Map<string, number>();

    for (const tx of transactions) {
      const currentVolume = userVolumes.get(tx.userAddress) || 0;
      userVolumes.set(tx.userAddress, currentVolume + tx.volume);
    }

    // Sort by volume and return top traders
    return Array.from(userVolumes.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userAddress]) => userAddress);
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Transaction history cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    pools: number;
    users: number;
    oldestEntry: number;
    hitRate: number;
    dbCacheSize?: number;
  } {
    const now = Date.now();
    let poolCount = 0;
    let userCount = 0;
    let oldestAge = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > oldestAge) oldestAge = age;

      if (key.includes('pool:') || key.includes('tx_cache')) poolCount++;
      if (key.includes('user:')) userCount++;
    }

    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    return {
      size: this.cache.size,
      pools: poolCount,
      users: userCount,
      oldestEntry: oldestAge,
      hitRate,
      dbCacheSize: undefined // Would be populated by persistence stats
    };
  }

  /**
   * Private helper methods
   */
  private validatePoolHash(poolHash: string): void {
    if (!poolHash || typeof poolHash !== 'string') {
      throw new TransactionHistoryError('Pool hash must be a non-empty string');
    }

    if (!/^[a-fA-F0-9]{64}$/.test(poolHash)) {
      throw new TransactionHistoryError('Invalid pool hash format: must be 64-character hex string');
    }
  }

  private validateUserAddress(userAddress: string): void {
    if (!userAddress || typeof userAddress !== 'string') {
      throw new TransactionHistoryError('User address must be a non-empty string');
    }

    // Validate common address formats: client|xxx, eth|xxx
    if (!/^(client|eth)\|[a-fA-F0-9]+$/.test(userAddress)) {
      throw new TransactionHistoryError('Invalid user address format');
    }
  }

  private buildCacheKey(type: string, identifier: string, options: TransactionQueryOptions): string {
    // Use the PersistenceUtils method for consistent cache key generation
    return PersistenceUtils.generateTransactionCacheKey(
      identifier,
      type === 'user' ? identifier : undefined,
      options as Record<string, unknown>
    );
  }

  private filterTransactions(transactions: TransactionRecord[], options: TransactionQueryOptions): TransactionRecord[] {
    let filtered = transactions;

    // Filter by user addresses if specified
    if (options.userAddresses && options.userAddresses.length > 0) {
      filtered = filtered.filter(tx =>
        options.userAddresses!.includes(tx.userAddress)
      );
    }

    // Filter by minimum volume
    if (options.minVolume !== undefined) {
      filtered = filtered.filter(tx => tx.volume >= options.minVolume!);
    }

    // Apply limit and offset
    if (options.offset) {
      filtered = filtered.slice(options.offset);
    }

    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

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
    // Clean up expired cache entries every 10 minutes
    setInterval(() => {
      this.cleanupExpiredCache();
    }, 10 * 60 * 1000);
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    const maxCacheSize = 200; // Prevent unlimited cache growth
    let removedCount = 0;

    // Remove expired entries
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL * 2) { // Remove entries older than 2x TTL
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
      logger.debug(`Cleaned up ${removedCount} expired transaction cache entries`);
    }
  }
}

/**
 * Create a transaction history client with default configuration
 */
export function createTransactionHistoryClient(
  baseUrl?: string,
  persistenceService?: PersistenceService
): TransactionHistoryClient {
  // Use environment variable or fallback if no baseUrl provided
  const apiBaseUrl = baseUrl || process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com';
  return new TransactionHistoryClient(apiBaseUrl, persistenceService);
}

/**
 * Utility functions for transaction analysis
 */
export class TransactionUtils {
  /**
   * Identify potential bot trading patterns
   */
  static identifyBotPatterns(transactions: TransactionRecord[]): {
    isBot: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    // Check for consistent timing patterns
    if (transactions.length >= 10) {
      const intervals = [];
      for (let i = 1; i < transactions.length; i++) {
        const prevTime = new Date(transactions[i - 1].transactionTime).getTime();
        const currentTime = new Date(transactions[i].transactionTime).getTime();
        intervals.push(currentTime - prevTime);
      }

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);

      // Low variance in timing suggests bot
      if (stdDev / avgInterval < 0.3) {
        confidence += 0.4;
        reasons.push('Consistent timing pattern');
      }
    }

    // Check for round numbers in amounts
    const roundAmounts = transactions.filter(tx =>
      tx.amount0 === Math.round(tx.amount0 * 1000) / 1000 ||
      tx.amount1 === Math.round(tx.amount1 * 1000) / 1000
    );

    if (roundAmounts.length / transactions.length > 0.7) {
      confidence += 0.3;
      reasons.push('High frequency of round numbers');
    }

    // Check trading frequency
    const timespan = new Date(transactions[0].transactionTime).getTime() -
                    new Date(transactions[transactions.length - 1].transactionTime).getTime();
    const tradesPerHour = (transactions.length * 3600000) / timespan;

    if (tradesPerHour > 10) {
      confidence += 0.3;
      reasons.push('High trading frequency');
    }

    return {
      isBot: confidence > 0.5,
      confidence,
      reasons
    };
  }

  /**
   * Calculate trading volume trend
   */
  static calculateVolumeTrend(transactions: TransactionRecord[], windowHours: number = 24): {
    trend: 'increasing' | 'decreasing' | 'stable';
    changePercentage: number;
  } {
    const now = new Date().getTime();
    const windowMs = windowHours * 60 * 60 * 1000;

    const recentTxs = transactions.filter(tx =>
      now - new Date(tx.transactionTime).getTime() < windowMs
    );

    if (recentTxs.length < 4) {
      return { trend: 'stable', changePercentage: 0 };
    }

    const midpoint = Math.floor(recentTxs.length / 2);
    const firstHalf = recentTxs.slice(0, midpoint);
    const secondHalf = recentTxs.slice(midpoint);

    const firstHalfVolume = firstHalf.reduce((sum, tx) => sum + tx.volume, 0);
    const secondHalfVolume = secondHalf.reduce((sum, tx) => sum + tx.volume, 0);

    const changePercentage = ((secondHalfVolume - firstHalfVolume) / firstHalfVolume) * 100;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(changePercentage) < 10) {
      trend = 'stable';
    } else if (changePercentage > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    return { trend, changePercentage };
  }
}