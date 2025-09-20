/**
 * Performance Monitor
 * Real-time performance tracking and optimization for trading operations
 */

import { logger } from '../utils/logger';
import { performance, PerformanceObserver } from 'perf_hooks';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as v8 from 'v8';
 
import { PriceCache } from './PriceCache';

export interface PerformanceMetrics {
  // Trading performance
  tradeExecutionLatency: number; // ms from signal to execution
  riskValidationTime: number; // ms for risk calculations
  apiCallLatency: number; // ms for API requests
  priceUpdateLatency: number; // ms for price data updates
  
  // System performance
  memoryUsage: number; // MB
  cpuUsage: number; // percentage
  gcCollections: number; // garbage collection count
  eventLoopLag: number; // ms event loop delay
  
  // Trading metrics
  tradesPerMinute: number;
  apiCallsPerMinute: number;
  websocketLatency: number; // ms
  
  // Cache performance
  cacheHitRate: number; // percentage
  cacheSize: number; // MB
  cacheMisses: number;
  
  timestamp: number;
}

export interface PerformanceThresholds {
  maxTradeLatency: number; // 2000ms target
  maxRiskValidationTime: number; // 100ms target
  maxMemoryUsage: number; // 200MB target
  maxApiCallsPerMinute: number; // 50 target
  minCacheHitRate: number; // 80% target
}

interface OperationTiming {
  name: string;
  operationType: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private operationTimings: Map<string, OperationTiming> = new Map();
  private activeOperations: OperationTiming[] = [];
  private tradeLatencies: number[] = [];
  private apiLatencies: number[] = [];
  private tradeCount: number = 0;
  private apiCallCount: number = 0;
  private lastMetricsTime: number = Date.now();
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  // Performance monitoring data
  private gcStats: { count: number; totalDuration: number } = { count: 0, totalDuration: 0 };
  private eventLoopLags: number[] = [];
  private performanceObserver?: PerformanceObserver;
  private priceCache?: PriceCache;

  private readonly thresholds: PerformanceThresholds = {
    maxTradeLatency: 2000,
    maxRiskValidationTime: 100,
    maxMemoryUsage: 200,
    maxApiCallsPerMinute: 50,
    minCacheHitRate: 80
  };

  private readonly MAX_METRICS_HISTORY = 1000; // Keep last 1000 measurements

  constructor() {
    this.setupPerformanceMonitoring();
    logger.info('Performance Monitor initialized with GC and event loop monitoring');
  }

  /**
   * Setup Node.js performance monitoring
   */
  private setupPerformanceMonitoring(): void {
    // Setup GC monitoring
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        if (entry.entryType === 'gc') {
          this.gcStats.count++;
          this.gcStats.totalDuration += entry.duration;
        }
      }
    });

    this.performanceObserver.observe({ entryTypes: ['gc'] });

    // Setup event loop lag monitoring
    this.startEventLoopLagMonitoring();
  }

  /**
   * Monitor event loop lag
   */
  private startEventLoopLagMonitoring(): void {
    const measureEventLoopLag = () => {
      const start = performance.now();
      setImmediate(() => {
        const lag = performance.now() - start;
        this.eventLoopLags.push(lag);

        // Keep only last 100 measurements for averaging
        if (this.eventLoopLags.length > 100) {
          this.eventLoopLags.shift();
        }

        // Schedule next measurement
        setTimeout(measureEventLoopLag, 1000); // Measure every second
      });
    };

    measureEventLoopLag();
  }

  /**
   * Set price cache for real cache metrics
   */
  setPriceCache(priceCache: PriceCache): void {
    this.priceCache = priceCache;
    logger.debug('Price cache connected to performance monitor');
  }

  /**
   * Start performance monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.captureMetrics();
    }, 5000); // Capture metrics every 5 seconds

    logger.info('Performance monitoring started');
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('Performance monitoring stopped');
  }

  /**
   * Start timing an operation
   */
  startOperation(operationId: string, operationType: string = 'unknown', metadata?: any): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.operationTimings.set(operationId, {
      name: operationId,
      operationType,
      startTime: Date.now(),
      metadata
    });
  }

  /**
   * End timing an operation and return duration
   */
  endOperation(operationId: string): number {
    const operation = this.operationTimings.get(operationId);
    if (!operation) {
      logger.warn(`Operation ${operationId} not found for timing`);
      return 0;
    }

    const endTime = Date.now();
    const duration = endTime - operation.startTime;

    operation.endTime = endTime;
    operation.duration = duration;

    // Log slow operations
    if (duration > 1000) {
      logger.warn(`Slow operation detected: ${operationId} took ${duration}ms`, operation.metadata);
    }

    // Clean up completed operation
    this.operationTimings.delete(operationId);

    return duration;
  }

  /**
   * Record trade execution
   */
  recordTradeExecution(latency: number): void {
    this.tradeCount++;
    this.tradeLatencies.push(latency);

    // Keep only last 1000 measurements
    if (this.tradeLatencies.length > 1000) {
      this.tradeLatencies.shift();
    }

    if (latency > this.thresholds.maxTradeLatency) {
      logger.warn(`Trade execution exceeded threshold: ${latency}ms > ${this.thresholds.maxTradeLatency}ms`);
    }
  }

  /**
   * Record API call
   */
  recordApiCall(latency: number, endpoint: string): void {
    this.apiCallCount++;
    this.apiLatencies.push(latency);

    // Keep only last 1000 measurements
    if (this.apiLatencies.length > 1000) {
      this.apiLatencies.shift();
    }

    // Track per-endpoint performance
    logger.debug(`API call to ${endpoint} took ${latency}ms`);
  }

  /**
   * Record risk validation time
   */
  recordRiskValidation(duration: number): void {
    if (duration > this.thresholds.maxRiskValidationTime) {
      logger.warn(`Risk validation exceeded threshold: ${duration}ms > ${this.thresholds.maxRiskValidationTime}ms`);
    }
  }

  /**
   * Capture system metrics
   */
  private captureMetrics(): void {
    const now = Date.now();
    const memUsage = process.memoryUsage();
    
    // Calculate rates
    const timeDelta = (now - this.lastMetricsTime) / 1000 / 60; // minutes
    const tradesPerMinute = this.tradeCount / timeDelta;
    const apiCallsPerMinute = this.apiCallCount / timeDelta;

    const metrics: PerformanceMetrics = {
      // Trading performance (will be updated by operations)
      tradeExecutionLatency: this.getAverageTradeLatency(),
      riskValidationTime: this.getAverageRiskValidationTime(),
      apiCallLatency: this.getAverageApiLatency(),
      priceUpdateLatency: 0, // Will be set by price tracker
      
      // System performance
      memoryUsage: memUsage.heapUsed / 1024 / 1024, // MB
      cpuUsage: this.getCpuUsage(),
      gcCollections: this.getGcCollections(),
      eventLoopLag: this.getEventLoopLag(),
      
      // Trading metrics
      tradesPerMinute,
      apiCallsPerMinute,
      websocketLatency: 0, // Will be set by websocket monitor
      
      // Cache performance (real metrics from PriceCache)
      cacheHitRate: this.priceCache ? this.priceCache.getStats().hitRate : 0,
      cacheSize: this.priceCache ? this.priceCache.getStats().size : 0,
      cacheMisses: this.priceCache ? this.priceCache.getStats().misses : 0,
      
      timestamp: now
    };

    this.metrics.push(metrics);

    // Limit metrics history
    if (this.metrics.length > this.MAX_METRICS_HISTORY) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS_HISTORY);
    }

    // Check thresholds
    this.checkThresholds(metrics);

    // Reset counters for next period
    this.tradeCount = 0;
    this.apiCallCount = 0;
    this.lastMetricsTime = now;
  }

  /**
   * Check performance thresholds and alert if exceeded
   */
  private checkThresholds(metrics: PerformanceMetrics): void {
    const violations: string[] = [];

    if (metrics.tradeExecutionLatency > this.thresholds.maxTradeLatency) {
      violations.push(`Trade latency: ${metrics.tradeExecutionLatency}ms > ${this.thresholds.maxTradeLatency}ms`);
    }

    if (metrics.riskValidationTime > this.thresholds.maxRiskValidationTime) {
      violations.push(`Risk validation: ${metrics.riskValidationTime}ms > ${this.thresholds.maxRiskValidationTime}ms`);
    }

    if (metrics.memoryUsage > this.thresholds.maxMemoryUsage) {
      violations.push(`Memory usage: ${metrics.memoryUsage}MB > ${this.thresholds.maxMemoryUsage}MB`);
    }

    if (metrics.apiCallsPerMinute > this.thresholds.maxApiCallsPerMinute) {
      violations.push(`API calls: ${metrics.apiCallsPerMinute}/min > ${this.thresholds.maxApiCallsPerMinute}/min`);
    }

    if (metrics.cacheHitRate < this.thresholds.minCacheHitRate) {
      violations.push(`Cache hit rate: ${metrics.cacheHitRate}% < ${this.thresholds.minCacheHitRate}%`);
    }

    if (violations.length > 0) {
      logger.warn('Performance thresholds exceeded:', violations);
    }
  }

  /**
   * Get current performance metrics
   */
  getCurrentMetrics(): PerformanceMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /**
   * Get performance history
   */
  getMetricsHistory(minutes: number = 60): PerformanceMetrics[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.metrics.filter(m => m.timestamp > cutoff);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    averageTradeLatency: number;
    averageMemoryUsage: number;
    averageApiLatency: number;
    totalTrades: number;
    totalApiCalls: number;
    uptime: number;
    thresholdViolations: number;
  } {
    const recentMetrics = this.getMetricsHistory(60);
    
    const avgTradeLatency = recentMetrics.reduce((sum, m) => sum + m.tradeExecutionLatency, 0) / recentMetrics.length || 0;
    const avgMemoryUsage = recentMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / recentMetrics.length || 0;
    const avgApiLatency = recentMetrics.reduce((sum, m) => sum + m.apiCallLatency, 0) / recentMetrics.length || 0;
    
    const totalTrades = recentMetrics.reduce((sum, m) => sum + m.tradesPerMinute, 0);
    const totalApiCalls = recentMetrics.reduce((sum, m) => sum + m.apiCallsPerMinute, 0);

    // Count threshold violations
    let violations = 0;
    recentMetrics.forEach(m => {
      if (m.tradeExecutionLatency > this.thresholds.maxTradeLatency) violations++;
      if (m.memoryUsage > this.thresholds.maxMemoryUsage) violations++;
      if (m.apiCallsPerMinute > this.thresholds.maxApiCallsPerMinute) violations++;
    });

    return {
      averageTradeLatency: avgTradeLatency,
      averageMemoryUsage: avgMemoryUsage,
      averageApiLatency: avgApiLatency,
      totalTrades,
      totalApiCalls,
      uptime: process.uptime(),
      thresholdViolations: violations
    };
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations(): string[] {
    const recommendations: string[] = [];
    const current = this.getCurrentMetrics();
    
    if (!current) return recommendations;

    if (current.tradeExecutionLatency > this.thresholds.maxTradeLatency) {
      recommendations.push('Consider optimizing trade execution pipeline - high latency detected');
    }

    if (current.memoryUsage > this.thresholds.maxMemoryUsage) {
      recommendations.push('Memory usage high - consider implementing memory cleanup or reducing cache size');
    }

    if (current.apiCallsPerMinute > this.thresholds.maxApiCallsPerMinute) {
      recommendations.push('High API call frequency - implement more aggressive caching or request batching');
    }

    if (current.cacheHitRate < this.thresholds.minCacheHitRate) {
      recommendations.push('Low cache hit rate - review caching strategy and cache key design');
    }

    if (current.eventLoopLag > 50) {
      recommendations.push('High event loop lag - consider moving CPU-intensive operations to worker threads');
    }

    return recommendations;
  }

  // Helper methods for metric calculations

  private getAverageTradeLatency(): number {
    if (this.tradeLatencies.length === 0) return 0;
    const sum = this.tradeLatencies.reduce((acc, latency) => acc + latency, 0);
    return sum / this.tradeLatencies.length;
  }

  private getAverageRiskValidationTime(): number {
    // Calculate average time for risk validation operations
    const riskOperations = this.activeOperations.filter(op =>
      op.operationType === 'risk_validation' && op.endTime
    );

    if (riskOperations.length === 0) return 0;

    const totalTime = riskOperations.reduce((sum, op) =>
      sum + (op.endTime! - op.startTime), 0
    );

    return totalTime / riskOperations.length;
  }

  private getAverageApiLatency(): number {
    if (this.apiLatencies.length === 0) return 0;
    const sum = this.apiLatencies.reduce((acc, latency) => acc + latency, 0);
    return sum / this.apiLatencies.length;
  }

  private getCpuUsage(): number {
    const cpuUsage = process.cpuUsage();
    return (cpuUsage.user + cpuUsage.system) / 1000 / 1000;
  }

  private getGcCollections(): number {
    return this.gcStats.count;
  }

  private getEventLoopLag(): number {
    if (this.eventLoopLags.length === 0) return 0;
    const sum = this.eventLoopLags.reduce((acc, lag) => acc + lag, 0);
    return sum / this.eventLoopLags.length;
  }

  /**
   * Update thresholds
   */
  updateThresholds(newThresholds: Partial<PerformanceThresholds>): void {
    Object.assign(this.thresholds, newThresholds);
    logger.info('Performance thresholds updated', this.thresholds);
  }

  /**
   * Force garbage collection and cleanup
   */
  forceCleanup(): void {
    const now = Date.now();
    for (const [id, operation] of this.operationTimings.entries()) {
      if (now - operation.startTime > 300000) {
        logger.warn(`Cleaning up stale operation: ${id}`);
        this.operationTimings.delete(id);
      }
    }

    if (global.gc) {
      global.gc();
      logger.debug('Forced garbage collection');
    }
  }
}
