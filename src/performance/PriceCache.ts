/**
 * Intelligent Price Cache
 * High-performance caching system with TTL, LRU eviction, and batch processing
 */

import { logger } from '../utils/logger';

export interface PriceCacheEntry {
  price: number;
  priceUsd: number;
  timestamp: number;
  volatility: number; // Used to determine TTL
  source: 'api' | 'websocket' | 'computed';
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
  avgRetrievalTime: number;
}

export interface CacheConfig {
  maxSize: number;
  defaultTtlMs: number;
  volatileTtlMs: number; // Shorter TTL for volatile tokens
  stableTtlMs: number; // Longer TTL for stable tokens
  batchSize: number;
  cleanupIntervalMs: number;
}

export class PriceCache {
  private cache: Map<string, PriceCacheEntry> = new Map();
  private accessOrder: string[] = []; // For LRU tracking
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    hitRate: 0,
    avgRetrievalTime: 0
  };

  private config: CacheConfig;
  private cleanupInterval?: NodeJS.Timeout;
  private retrievalTimes: number[] = [];

  // Stable tokens that can have longer cache TTL
  private readonly STABLE_TOKENS = new Set(['GUSDC', 'USDT', 'DAI']);
  
  // Volatile tokens that need frequent updates
  private readonly VOLATILE_TOKENS = new Set(['ETIME', 'SILK', 'GTON']);

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 1000,
      defaultTtlMs: 10000, // 10 seconds
      volatileTtlMs: 3000, // 3 seconds for volatile tokens
      stableTtlMs: 30000, // 30 seconds for stable tokens
      batchSize: 10,
      cleanupIntervalMs: 30000, // 30 seconds
      ...config
    };

    this.startCleanupInterval();
    logger.info('Price Cache initialized', this.config);
  }

  /**
   * Get price from cache with intelligent TTL checking
   */
  get(token: string): PriceCacheEntry | null {
    const startTime = Date.now();
    
    const entry = this.cache.get(token);
    
    if (!entry) {
      this.stats.misses++;
      this.updateStats(startTime);
      return null;
    }

    // Check if entry is still valid based on token-specific TTL
    const ttl = this.getTtlForToken(token, entry.volatility);
    const age = Date.now() - entry.timestamp;
    
    if (age > ttl) {
      // Entry expired
      this.cache.delete(token);
      this.removeFromAccessOrder(token);
      this.stats.misses++;
      this.updateStats(startTime);
      return null;
    }

    // Update access order for LRU
    this.updateAccessOrder(token);
    this.stats.hits++;
    this.updateStats(startTime);
    
    return entry;
  }

  /**
   * Set price in cache with intelligent volatility detection
   */
  set(token: string, price: number, priceUsd: number, source: 'api' | 'websocket' | 'computed' = 'api'): void {
    // Calculate volatility if we have previous data
    const existingEntry = this.cache.get(token);
    let volatility = 0.5; // Default medium volatility
    
    if (existingEntry) {
      const priceChange = Math.abs(price - existingEntry.price) / existingEntry.price;
      volatility = Math.min(priceChange * 10, 1); // Scale to 0-1
    }

    const entry: PriceCacheEntry = {
      price,
      priceUsd,
      timestamp: Date.now(),
      volatility,
      source
    };

    // Check if we need to evict entries
    if (this.cache.size >= this.config.maxSize && !this.cache.has(token)) {
      this.evictLru();
    }

    this.cache.set(token, entry);
    this.updateAccessOrder(token);
    this.stats.size = this.cache.size;
  }

  /**
   * Batch get multiple prices
   */
  getBatch(tokens: string[]): Map<string, PriceCacheEntry> {
    const result = new Map<string, PriceCacheEntry>();
    const startTime = Date.now();

    for (const token of tokens) {
      const entry = this.get(token);
      if (entry) {
        result.set(token, entry);
      }
    }

    // Log batch performance
    const duration = Date.now() - startTime;
    logger.debug(`Batch get ${tokens.length} tokens: ${result.size} hits, ${duration}ms`);

    return result;
  }

  /**
   * Batch set multiple prices
   */
  setBatch(prices: Map<string, { price: number; priceUsd: number; source?: 'api' | 'websocket' | 'computed' }>): void {
    const startTime = Date.now();

    for (const [token, data] of prices) {
      this.set(token, data.price, data.priceUsd, data.source);
    }

    const duration = Date.now() - startTime;
    logger.debug(`Batch set ${prices.size} prices in ${duration}ms`);
  }

  /**
   * Check if token has fresh data (not expired)
   */
  isFresh(token: string, maxAgeMs?: number): boolean {
    const entry = this.cache.get(token);
    if (!entry) return false;

    const age = Date.now() - entry.timestamp;
    const maxAge = maxAgeMs || this.getTtlForToken(token, entry.volatility);
    
    return age <= maxAge;
  }

  /**
   * Get tokens that need refresh based on TTL
   */
  getStaleTokens(): string[] {
    const staleTokens: string[] = [];
    const now = Date.now();

    for (const [token, entry] of this.cache) {
      const ttl = this.getTtlForToken(token, entry.volatility);
      const age = now - entry.timestamp;
      
      if (age > ttl) {
        staleTokens.push(token);
      }
    }

    return staleTokens;
  }

  /**
   * Intelligently refresh stale entries
   */
  getTokensForRefresh(prioritizeVolatile: boolean = true): string[] {
    const candidates: Array<{ token: string; priority: number }> = [];
    const now = Date.now();

    for (const [token, entry] of this.cache) {
      const ttl = this.getTtlForToken(token, entry.volatility);
      const age = now - entry.timestamp;
      const ageRatio = age / ttl;

      if (ageRatio > 0.7) { // Refresh when 70% of TTL elapsed
        let priority = ageRatio;
        
        // Boost priority for volatile tokens
        if (prioritizeVolatile && this.VOLATILE_TOKENS.has(token)) {
          priority *= 2;
        }
        
        candidates.push({ token, priority });
      }
    }

    // Sort by priority and return up to batch size
    return candidates
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.config.batchSize)
      .map(c => c.token);
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const startTime = Date.now();
    const now = Date.now();
    let cleanedCount = 0;

    for (const [token, entry] of this.cache) {
      const ttl = this.getTtlForToken(token, entry.volatility);
      const age = now - entry.timestamp;
      
      if (age > ttl) {
        this.cache.delete(token);
        this.removeFromAccessOrder(token);
        cleanedCount++;
      }
    }

    this.stats.size = this.cache.size;
    
    if (cleanedCount > 0) {
      const duration = Date.now() - startTime;
      logger.debug(`Cache cleanup: removed ${cleanedCount} expired entries in ${duration}ms`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0,
      avgRetrievalTime: this.retrievalTimes.length > 0 
        ? this.retrievalTimes.reduce((sum, time) => sum + time, 0) / this.retrievalTimes.length 
        : 0
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.stats.size = 0;
    logger.info('Price cache cleared');
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): number {
    // Rough estimate: each entry ~200 bytes
    return this.cache.size * 200;
  }

  /**
   * Destroy cache and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.clear();
    logger.info('Price cache destroyed');
  }

  // Private helper methods

  private getTtlForToken(token: string, volatility: number): number {
    // Use token-specific TTL based on stability
    if (this.STABLE_TOKENS.has(token)) {
      return this.config.stableTtlMs;
    }
    
    if (this.VOLATILE_TOKENS.has(token)) {
      return this.config.volatileTtlMs;
    }

    // Use volatility-based TTL for other tokens
    const baseTime = this.config.defaultTtlMs;
    const volatilityFactor = 1 - (volatility * 0.7); // More volatile = shorter TTL
    
    return Math.max(baseTime * volatilityFactor, this.config.volatileTtlMs);
  }

  private updateAccessOrder(token: string): void {
    // Remove from current position
    this.removeFromAccessOrder(token);
    
    // Add to end (most recently used)
    this.accessOrder.push(token);
  }

  private removeFromAccessOrder(token: string): void {
    const index = this.accessOrder.indexOf(token);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private evictLru(): void {
    if (this.accessOrder.length === 0) return;

    // Remove least recently used (first in array)
    const lruToken = this.accessOrder.shift()!;
    this.cache.delete(lruToken);
    this.stats.evictions++;
    
    logger.debug(`Evicted LRU token: ${lruToken}`);
  }

  private updateStats(startTime: number): void {
    const retrievalTime = Date.now() - startTime;
    this.retrievalTimes.push(retrievalTime);
    
    // Keep only last 1000 retrieval times for average calculation
    if (this.retrievalTimes.length > 1000) {
      this.retrievalTimes = this.retrievalTimes.slice(-1000);
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }
}
