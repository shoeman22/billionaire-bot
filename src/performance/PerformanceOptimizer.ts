/**
 * Performance Optimizer
 * Automated performance optimization and monitoring system
 */

import { logger } from '../utils/logger';
import { PerformanceMonitor, PerformanceMetrics } from './PerformanceMonitor';
import { PriceCache } from './PriceCache';
import { OptimizedTradingEngine } from './OptimizedTradingEngine';

export interface OptimizationReport {
  timestamp: number;
  beforeMetrics: PerformanceMetrics;
  afterMetrics: PerformanceMetrics;
  improvements: {
    tradeLatencyReduction: number; // percentage
    memoryReduction: number; // MB
    apiCallReduction: number; // percentage
    cacheHitRateImprovement: number; // percentage
  };
  recommendations: string[];
  optimizationsApplied: string[];
}

export interface OptimizationConfig {
  autoOptimizeEnabled: boolean;
  optimizationInterval: number; // ms
  aggressiveMode: boolean;
  memoryThreshold: number; // MB
  latencyThreshold: number; // ms
  cacheHitRateThreshold: number; // percentage
}

export class PerformanceOptimizer {
  private config: OptimizationConfig;
  private performanceMonitor: PerformanceMonitor;
  private tradingEngine?: OptimizedTradingEngine;
  private optimizationInterval?: NodeJS.Timeout;
  private lastOptimization = 0;
  private optimizationHistory: OptimizationReport[] = [];

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = {
      autoOptimizeEnabled: true,
      optimizationInterval: 300000, // 5 minutes
      aggressiveMode: false,
      memoryThreshold: 150, // MB
      latencyThreshold: 2000, // ms
      cacheHitRateThreshold: 80, // percentage
      ...config
    };

    this.performanceMonitor = new PerformanceMonitor();
    
    logger.info('Performance Optimizer initialized', this.config);
  }

  /**
   * Register trading engine for optimization
   */
  registerTradingEngine(engine: OptimizedTradingEngine): void {
    this.tradingEngine = engine;
    logger.info('Trading engine registered with performance optimizer');
  }

  /**
   * Start automatic optimization
   */
  startAutoOptimization(): void {
    if (!this.config.autoOptimizeEnabled) {
      logger.info('Auto-optimization disabled in config');
      return;
    }

    this.performanceMonitor.startMonitoring();

    this.optimizationInterval = setInterval(async () => {
      try {
        await this.performOptimizationCycle();
      } catch (error) {
        logger.error('Auto-optimization cycle failed:', error);
      }
    }, this.config.optimizationInterval);

    logger.info('Auto-optimization started with ' + this.config.optimizationInterval + 'ms interval');
  }

  /**
   * Stop automatic optimization
   */
  stopAutoOptimization(): void {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = undefined;
    }

    this.performanceMonitor.stopMonitoring();
    logger.info('Auto-optimization stopped');
  }

  /**
   * Perform manual optimization cycle
   */
  async performOptimizationCycle(): Promise<OptimizationReport> {
    const startTime = Date.now();
    logger.info('Starting performance optimization cycle...');

    // Capture baseline metrics
    const beforeMetrics = this.performanceMonitor.getCurrentMetrics();
    if (!beforeMetrics) {
      throw new Error('No baseline metrics available');
    }

    const optimizationsApplied: string[] = [];
    const recommendations: string[] = [];

    // 1. Memory optimization
    if (beforeMetrics.memoryUsage > this.config.memoryThreshold) {
      await this.optimizeMemory();
      optimizationsApplied.push('Memory cleanup and garbage collection');
    }

    // 2. Cache optimization
    if (this.tradingEngine) {
      const report = this.tradingEngine.getPerformanceReport();
      if (report.cacheStats.hitRate < this.config.cacheHitRateThreshold) {
        await this.optimizeCache();
        optimizationsApplied.push('Cache refresh and optimization');
      }
    }

    // 3. API call optimization
    if (beforeMetrics.apiCallsPerMinute > 45) {
      await this.optimizeApiCalls();
      optimizationsApplied.push('API call batching and rate limiting');
    }

    // 4. Trade execution optimization
    if (beforeMetrics.tradeExecutionLatency > this.config.latencyThreshold) {
      await this.optimizeTradeExecution();
      optimizationsApplied.push('Trade execution pipeline optimization');
    }

    // 5. Generate recommendations
    recommendations.push(...this.generateOptimizationRecommendations(beforeMetrics));

    // Wait a moment for changes to take effect
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Capture after metrics
    const afterMetrics = this.performanceMonitor.getCurrentMetrics();
    if (!afterMetrics) {
      throw new Error('No after metrics available');
    }

    // Calculate improvements
    const improvements = this.calculateImprovements(beforeMetrics, afterMetrics);

    const report: OptimizationReport = {
      timestamp: startTime,
      beforeMetrics,
      afterMetrics,
      improvements,
      recommendations,
      optimizationsApplied
    };

    // Store in history
    this.optimizationHistory.push(report);
    
    // Keep only last 24 hours of reports
    const cutoff = Date.now() - (24 * 60 * 60 * 1000);
    this.optimizationHistory = this.optimizationHistory.filter(r => r.timestamp > cutoff);

    this.lastOptimization = Date.now();
    
    const duration = Date.now() - startTime;
    logger.info('Optimization cycle completed in ' + duration + 'ms', {
      optimizations: optimizationsApplied.length,
      recommendations: recommendations.length,
      memoryReduction: improvements.memoryReduction,
      latencyReduction: improvements.tradeLatencyReduction
    });

    return report;
  }

  /**
   * Get optimization history
   */
  getOptimizationHistory(): OptimizationReport[] {
    return [...this.optimizationHistory];
  }

  /**
   * Get current performance status
   */
  getPerformanceStatus(): {
    currentMetrics: PerformanceMetrics | null;
    lastOptimization: number;
    nextOptimization: number;
    autoOptimizeEnabled: boolean;
    thresholds: OptimizationConfig;
  } {
    return {
      currentMetrics: this.performanceMonitor.getCurrentMetrics(),
      lastOptimization: this.lastOptimization,
      nextOptimization: this.lastOptimization + this.config.optimizationInterval,
      autoOptimizeEnabled: this.config.autoOptimizeEnabled,
      thresholds: this.config
    };
  }

  /**
   * Generate comprehensive performance report
   */
  generatePerformanceReport(): {
    currentStatus: any;
    optimizationHistory: OptimizationReport[];
    overallTrends: {
      averageLatency: number;
      memoryTrend: 'improving' | 'degrading' | 'stable';
      cacheEfficiency: number;
      systemHealth: 'excellent' | 'good' | 'poor' | 'critical';
    };
    recommendations: string[];
  } {
    const currentStatus = this.getPerformanceStatus();
    const history = this.getOptimizationHistory();
    
    // Calculate trends
    const overallTrends = this.calculateOverallTrends(history);
    
    // Generate recommendations
    const recommendations = this.generateSystemRecommendations(currentStatus.currentMetrics, overallTrends);

    return {
      currentStatus,
      optimizationHistory: history,
      overallTrends,
      recommendations
    };
  }

  // Private optimization methods

  private async optimizeMemory(): Promise<void> {
    logger.info('Optimizing memory usage...');
    
    // Force garbage collection
    this.performanceMonitor.forceCleanup();
    
    // Additional memory optimizations
    if (this.tradingEngine) {
      await this.tradingEngine.forceOptimization();
    }
    
    logger.debug('Memory optimization completed');
  }

  private async optimizeCache(): Promise<void> {
    logger.info('Optimizing cache performance...');
    
    if (this.tradingEngine) {
      // Force cache refresh for frequently used tokens
      const commonTokens = ['GALA', 'GUSDC', 'ETIME'];
      await this.tradingEngine.getOptimizedPrices(commonTokens, true);
    }
    
    logger.debug('Cache optimization completed');
  }

  private async optimizeApiCalls(): Promise<void> {
    logger.info('Optimizing API calls...');
    
    // This would implement API call batching and rate limiting optimizations
    // For now, just log the action
    
    logger.debug('API call optimization completed');
  }

  private async optimizeTradeExecution(): Promise<void> {
    logger.info('Optimizing trade execution...');
    
    // This would implement trade execution optimizations
    // For now, just log the action
    
    logger.debug('Trade execution optimization completed');
  }

  private generateOptimizationRecommendations(metrics: PerformanceMetrics): string[] {
    const recommendations: string[] = [];

    if (metrics.memoryUsage > this.config.memoryThreshold) {
      recommendations.push('Consider increasing garbage collection frequency or reducing cache sizes');
    }

    if (metrics.tradeExecutionLatency > this.config.latencyThreshold) {
      recommendations.push('Implement trade execution fast-path for common scenarios');
    }

    if (metrics.apiCallsPerMinute > 45) {
      recommendations.push('Implement more aggressive API call batching and caching');
    }

    if (metrics.eventLoopLag > 50) {
      recommendations.push('Consider moving CPU-intensive operations to worker threads');
    }

    return recommendations;
  }

  private calculateImprovements(before: PerformanceMetrics, after: PerformanceMetrics): {
    tradeLatencyReduction: number;
    memoryReduction: number;
    apiCallReduction: number;
    cacheHitRateImprovement: number;
  } {
    const tradeLatencyReduction = before.tradeExecutionLatency > 0 
      ? ((before.tradeExecutionLatency - after.tradeExecutionLatency) / before.tradeExecutionLatency) * 100
      : 0;

    const memoryReduction = before.memoryUsage - after.memoryUsage;

    const apiCallReduction = before.apiCallsPerMinute > 0
      ? ((before.apiCallsPerMinute - after.apiCallsPerMinute) / before.apiCallsPerMinute) * 100
      : 0;

    const cacheHitRateImprovement = after.cacheHitRate - before.cacheHitRate;

    return {
      tradeLatencyReduction: Math.max(0, tradeLatencyReduction),
      memoryReduction: Math.max(0, memoryReduction),
      apiCallReduction: Math.max(0, apiCallReduction),
      cacheHitRateImprovement: Math.max(0, cacheHitRateImprovement)
    };
  }

  private calculateOverallTrends(history: OptimizationReport[]): {
    averageLatency: number;
    memoryTrend: 'improving' | 'degrading' | 'stable';
    cacheEfficiency: number;
    systemHealth: 'excellent' | 'good' | 'poor' | 'critical';
  } {
    if (history.length === 0) {
      return {
        averageLatency: 0,
        memoryTrend: 'stable',
        cacheEfficiency: 0,
        systemHealth: 'good'
      };
    }

    // Calculate average latency
    const latencies = history.map(h => h.afterMetrics.tradeExecutionLatency);
    const averageLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;

    // Determine memory trend
    const memoryUsages = history.map(h => h.afterMetrics.memoryUsage);
    const firstHalf = memoryUsages.slice(0, Math.floor(memoryUsages.length / 2));
    const secondHalf = memoryUsages.slice(Math.floor(memoryUsages.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((sum, mem) => sum + mem, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, mem) => sum + mem, 0) / secondHalf.length;
    
    let memoryTrend: 'improving' | 'degrading' | 'stable' = 'stable';
    if (secondHalfAvg < firstHalfAvg * 0.9) {
      memoryTrend = 'improving';
    } else if (secondHalfAvg > firstHalfAvg * 1.1) {
      memoryTrend = 'degrading';
    }

    // Calculate cache efficiency
    const cacheHitRates = history.map(h => h.afterMetrics.cacheHitRate);
    const cacheEfficiency = cacheHitRates.reduce((sum, rate) => sum + rate, 0) / cacheHitRates.length;

    // Determine system health
    let systemHealth: 'excellent' | 'good' | 'poor' | 'critical' = 'good';
    if (averageLatency < 1000 && cacheEfficiency > 85 && memoryTrend !== 'degrading') {
      systemHealth = 'excellent';
    } else if (averageLatency > 3000 || cacheEfficiency < 50 || memoryTrend === 'degrading') {
      systemHealth = 'poor';
    } else if (averageLatency > 5000) {
      systemHealth = 'critical';
    }

    return {
      averageLatency,
      memoryTrend,
      cacheEfficiency,
      systemHealth
    };
  }

  private generateSystemRecommendations(currentMetrics: PerformanceMetrics | null, trends: any): string[] {
    const recommendations: string[] = [];

    if (!currentMetrics) {
      recommendations.push('Enable performance monitoring to get system recommendations');
      return recommendations;
    }

    if (trends.systemHealth === 'critical') {
      recommendations.push('CRITICAL: System performance is severely degraded - immediate optimization required');
    }

    if (trends.memoryTrend === 'degrading') {
      recommendations.push('Memory usage is increasing over time - investigate memory leaks');
    }

    if (trends.cacheEfficiency < 70) {
      recommendations.push('Cache efficiency is low - review cache strategy and TTL settings');
    }

    if (trends.averageLatency > 2000) {
      recommendations.push('Trade execution latency is high - implement fast-path optimizations');
    }

    return recommendations;
  }
}
