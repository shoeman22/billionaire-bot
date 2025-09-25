/**
 * API Optimization Service
 *
 * Comprehensive system for optimizing API usage across the trading bot:
 * - Tracks API call patterns and performance
 * - Implements intelligent caching strategies
 * - Reduces redundant requests through data reuse
 * - Monitors rate limits and prevents throttling
 * - Provides performance analytics and recommendations
 */

import { logger } from '../utils/logger';
import { poolDiscovery } from '../services/pool-discovery';

export interface APICallMetrics {
  endpoint: string;
  method: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgResponseTime: number;
  lastCallTime: number;
  rateLimitHits: number;
  cacheHits: number;
  cacheMisses: number;
  bytesTransferred: number;
  errorTypes: Record<string, number>;
}

export interface APIOptimizationStats {
  totalAPICalls: number;
  totalCacheHits: number;
  totalCacheMisses: number;
  cacheHitRate: number;
  apiCallReduction: number;
  averageResponseTime: number;
  rateLimitUtilization: number;
  estimatedCostSavings: number;
  topEndpoints: APICallMetrics[];
  recommendations: string[];
}

export interface CacheStrategy {
  endpoint: string;
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum cache entries
  compressionEnabled: boolean;
  invalidationRules: string[];
}

export class APIOptimizationService {
  private metrics: Map<string, APICallMetrics> = new Map();
  private cacheStrategies: Map<string, CacheStrategy> = new Map();
  private startTime: number = Date.now();
  private lastReportTime: number = Date.now();

  constructor() {
    this.initializeDefaultStrategies();
    this.startPeriodicOptimization();

    logger.info('🚀 API Optimization Service initialized');
  }

  /**
   * Initialize default cache strategies for known endpoints
   */
  private initializeDefaultStrategies(): void {
    // Pool data caching
    this.cacheStrategies.set('/explore/pools', {
      endpoint: '/explore/pools',
      ttl: 5 * 60 * 1000, // 5 minutes
      maxSize: 100,
      compressionEnabled: true,
      invalidationRules: ['NEW_POOL_CREATED', 'PRICE_MAJOR_CHANGE']
    });

    // Pool detail caching (already implemented in PoolDetailClient)
    this.cacheStrategies.set('/explore/pool', {
      endpoint: '/explore/pool',
      ttl: 30 * 1000, // 30 seconds
      maxSize: 200,
      compressionEnabled: false,
      invalidationRules: ['POOL_STATE_CHANGE']
    });

    // Quote caching for stable pairs
    this.cacheStrategies.set('/v1/trade/quote', {
      endpoint: '/v1/trade/quote',
      ttl: 10 * 1000, // 10 seconds for quotes
      maxSize: 500,
      compressionEnabled: false,
      invalidationRules: ['PRICE_CHANGE_THRESHOLD']
    });

    // Price caching
    this.cacheStrategies.set('/v1/trade/price', {
      endpoint: '/v1/trade/price',
      ttl: 15 * 1000, // 15 seconds
      maxSize: 300,
      compressionEnabled: false,
      invalidationRules: ['MARKET_VOLATILITY']
    });

    logger.info(`📋 Initialized ${this.cacheStrategies.size} cache strategies`);
  }

  /**
   * Record an API call for metrics tracking
   */
  recordAPICall(
    endpoint: string,
    method: string,
    responseTime: number,
    success: boolean,
    error?: string,
    bytesTransferred: number = 0
  ): void {
    const key = `${method}:${endpoint}`;

    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        endpoint,
        method,
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        avgResponseTime: 0,
        lastCallTime: 0,
        rateLimitHits: 0,
        cacheHits: 0,
        cacheMisses: 0,
        bytesTransferred: 0,
        errorTypes: {}
      });
    }

    const metric = this.metrics.get(key)!;

    metric.totalCalls++;
    metric.lastCallTime = Date.now();
    metric.bytesTransferred += bytesTransferred;

    if (success) {
      metric.successfulCalls++;
      // Update average response time
      metric.avgResponseTime = (metric.avgResponseTime + responseTime) / 2;
    } else {
      metric.failedCalls++;

      if (error) {
        metric.errorTypes[error] = (metric.errorTypes[error] || 0) + 1;

        // Track rate limit hits
        if (error.includes('429') || error.toLowerCase().includes('rate limit')) {
          metric.rateLimitHits++;
        }
      }
    }
  }

  /**
   * Record cache hit/miss for metrics
   */
  recordCacheActivity(endpoint: string, method: string, hit: boolean): void {
    const key = `${method}:${endpoint}`;

    if (!this.metrics.has(key)) {
      // Initialize if doesn't exist
      this.recordAPICall(endpoint, method, 0, true);
    }

    const metric = this.metrics.get(key)!;

    if (hit) {
      metric.cacheHits++;
    } else {
      metric.cacheMisses++;
    }
  }

  /**
   * Get comprehensive API optimization statistics
   */
  getOptimizationStats(): APIOptimizationStats {
    const allMetrics = Array.from(this.metrics.values());

    const totalAPICalls = allMetrics.reduce((sum, m) => sum + m.totalCalls, 0);
    const totalCacheHits = allMetrics.reduce((sum, m) => sum + m.cacheHits, 0);
    const totalCacheMisses = allMetrics.reduce((sum, m) => sum + m.cacheMisses, 0);
    const totalResponseTime = allMetrics.reduce((sum, m) => sum + (m.avgResponseTime * m.totalCalls), 0);

    const cacheHitRate = totalCacheHits + totalCacheMisses > 0
      ? (totalCacheHits / (totalCacheHits + totalCacheMisses)) * 100
      : 0;

    const apiCallReduction = totalCacheHits; // Each cache hit = 1 API call avoided
    const averageResponseTime = totalAPICalls > 0 ? totalResponseTime / totalAPICalls : 0;

    // Calculate estimated cost savings (assuming $0.001 per API call)
    const estimatedCostSavings = apiCallReduction * 0.001;

    // Get top 5 most used endpoints
    const topEndpoints = allMetrics
      .sort((a, b) => b.totalCalls - a.totalCalls)
      .slice(0, 5);

    const recommendations = this.generateOptimizationRecommendations(allMetrics);

    return {
      totalAPICalls,
      totalCacheHits,
      totalCacheMisses,
      cacheHitRate,
      apiCallReduction,
      averageResponseTime,
      rateLimitUtilization: this.calculateRateLimitUtilization(),
      estimatedCostSavings,
      topEndpoints,
      recommendations
    };
  }

  /**
   * Generate optimization recommendations based on metrics
   */
  private generateOptimizationRecommendations(metrics: APICallMetrics[]): string[] {
    const recommendations: string[] = [];

    // Check for high-frequency endpoints without caching
    const highFrequencyEndpoints = metrics.filter(m => m.totalCalls > 100 && m.cacheHits === 0);
    if (highFrequencyEndpoints.length > 0) {
      recommendations.push(
        `Consider implementing caching for high-frequency endpoints: ${highFrequencyEndpoints.map(m => m.endpoint).join(', ')}`
      );
    }

    // Check for endpoints with high failure rates
    const highFailureEndpoints = metrics.filter(m => m.totalCalls > 10 && (m.failedCalls / m.totalCalls) > 0.1);
    if (highFailureEndpoints.length > 0) {
      recommendations.push(
        `Review error handling for endpoints with high failure rates: ${highFailureEndpoints.map(m => `${m.endpoint} (${((m.failedCalls / m.totalCalls) * 100).toFixed(1)}%)`).join(', ')}`
      );
    }

    // Check for rate limit issues
    const rateLimitEndpoints = metrics.filter(m => m.rateLimitHits > 0);
    if (rateLimitEndpoints.length > 0) {
      recommendations.push(
        `Implement rate limiting protection for: ${rateLimitEndpoints.map(m => m.endpoint).join(', ')}`
      );
    }

    // Check for slow endpoints
    const slowEndpoints = metrics.filter(m => m.avgResponseTime > 2000); // > 2 seconds
    if (slowEndpoints.length > 0) {
      recommendations.push(
        `Optimize or implement timeouts for slow endpoints: ${slowEndpoints.map(m => `${m.endpoint} (${m.avgResponseTime.toFixed(0)}ms avg)`).join(', ')}`
      );
    }

    // Check for low cache hit rates
    const lowCacheRateEndpoints = metrics.filter(m => {
      const totalCacheAttempts = m.cacheHits + m.cacheMisses;
      return totalCacheAttempts > 10 && (m.cacheHits / totalCacheAttempts) < 0.5;
    });
    if (lowCacheRateEndpoints.length > 0) {
      recommendations.push(
        `Review cache TTL settings for low hit rate endpoints: ${lowCacheRateEndpoints.map(m => m.endpoint).join(', ')}`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('API usage is well optimized! Continue monitoring for improvements.');
    }

    return recommendations;
  }

  /**
   * Calculate current rate limit utilization
   */
  private calculateRateLimitUtilization(): number {
    // This is a simplified calculation - in practice, you'd track against actual rate limits
    const recentCalls = Array.from(this.metrics.values())
      .filter(m => Date.now() - m.lastCallTime < 60000) // Last minute
      .reduce((sum, m) => sum + m.totalCalls, 0);

    // Assuming a rate limit of 100 calls per minute (adjust based on actual limits)
    return Math.min(100, (recentCalls / 100) * 100);
  }

  /**
   * Start periodic optimization monitoring
   */
  private startPeriodicOptimization(): void {
    setInterval(() => {
      this.analyzeAndOptimize();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Analyze current performance and apply optimizations
   */
  private analyzeAndOptimize(): void {
    const stats = this.getOptimizationStats();
    const timeSinceLastReport = Date.now() - this.lastReportTime;

    // Only report every 30 minutes to avoid log spam
    if (timeSinceLastReport > 30 * 60 * 1000) {
      logger.info('📊 API Optimization Report', {
        totalAPICalls: stats.totalAPICalls,
        cacheHitRate: `${stats.cacheHitRate.toFixed(1)}%`,
        apiCallReduction: stats.apiCallReduction,
        estimatedSavings: `$${stats.estimatedCostSavings.toFixed(4)}`,
        avgResponseTime: `${stats.averageResponseTime.toFixed(0)}ms`,
        rateLimitUtilization: `${stats.rateLimitUtilization.toFixed(1)}%`,
        topEndpoint: stats.topEndpoints[0]?.endpoint || 'none'
      });

      // Log recommendations if any
      if (stats.recommendations.length > 0) {
        logger.info('💡 Optimization Recommendations:', {
          recommendations: stats.recommendations
        });
      }

      this.lastReportTime = Date.now();
    }

    // Auto-optimize cache strategies based on performance
    this.autoOptimizeCacheStrategies(stats);
  }

  /**
   * Automatically optimize cache strategies based on performance data
   */
  private autoOptimizeCacheStrategies(stats: APIOptimizationStats): void {
    for (const metric of stats.topEndpoints) {
      const strategy = this.cacheStrategies.get(metric.endpoint);
      if (strategy) {
        let modified = false;

        // Increase TTL for endpoints with high hit rates and low error rates
        const cacheAttempts = metric.cacheHits + metric.cacheMisses;
        const hitRate = cacheAttempts > 0 ? (metric.cacheHits / cacheAttempts) : 0;
        const errorRate = metric.totalCalls > 0 ? (metric.failedCalls / metric.totalCalls) : 0;

        if (hitRate > 0.8 && errorRate < 0.05 && strategy.ttl < 300000) { // < 5 minutes
          strategy.ttl = Math.min(strategy.ttl * 1.2, 300000); // Increase by 20%, max 5 minutes
          modified = true;
        }

        // Decrease TTL for endpoints with high error rates
        if (errorRate > 0.1 && strategy.ttl > 5000) { // > 5 seconds
          strategy.ttl = Math.max(strategy.ttl * 0.8, 5000); // Decrease by 20%, min 5 seconds
          modified = true;
        }

        if (modified) {
          logger.debug(`🔧 Auto-optimized cache strategy for ${metric.endpoint}: TTL=${strategy.ttl}ms`);
        }
      }
    }
  }

  /**
   * Get performance report for a specific time period
   */
  getPerformanceReport(periodMinutes: number = 60): {
    period: string;
    metrics: APIOptimizationStats;
    poolDiscoveryStats: Record<string, unknown>;
    recommendations: string[];
  } {
    const stats = this.getOptimizationStats();
    const poolStats = poolDiscovery.getCacheStats();

    return {
      period: `Last ${periodMinutes} minutes`,
      metrics: stats,
      poolDiscoveryStats: poolStats,
      recommendations: [
        ...stats.recommendations,
        `Pool Discovery Cache: ${poolStats.poolCount} pools, ${poolStats.detailCacheStats.size} details cached`,
        poolStats.isStale ? 'Pool data is stale - consider refreshing' : 'Pool data is fresh'
      ]
    };
  }

  /**
   * Reset all metrics (useful for testing or periodic resets)
   */
  resetMetrics(): void {
    this.metrics.clear();
    this.startTime = Date.now();
    this.lastReportTime = Date.now();

    logger.info('📊 API optimization metrics reset');
  }

  /**
   * Export detailed metrics for analysis
   */
  exportMetrics(): {
    timestamp: number;
    uptime: number;
    metrics: APICallMetrics[];
    strategies: CacheStrategy[];
    stats: APIOptimizationStats;
  } {
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      metrics: Array.from(this.metrics.values()),
      strategies: Array.from(this.cacheStrategies.values()),
      stats: this.getOptimizationStats()
    };
  }
}

// Export singleton instance
export const apiOptimization = new APIOptimizationService();