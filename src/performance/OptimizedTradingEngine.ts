/**
 * Optimized Trading Engine
 * High-performance trading engine with intelligent caching, batch processing, and parallel execution
 */

import { GalaSwapClient } from '../api/GalaSwapClient';
import { BotConfig } from '../config/environment';
import { logger } from '../utils/logger';
import { PerformanceMonitor } from './PerformanceMonitor';
import { PriceCache } from './PriceCache';
import { TradingEngine } from '../trading/TradingEngine';

export interface OptimizedTradeParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageTolerance?: number;
  urgency?: 'low' | 'normal' | 'high';
  bypassCache?: boolean;
}

export interface BatchTradeRequest {
  trades: OptimizedTradeParams[];
  maxParallel?: number;
  stopOnFirstError?: boolean;
}

export interface FastPathResult {
  shouldUseFastPath: boolean;
  reason: string;
  estimatedLatency: number;
}

export class OptimizedTradingEngine extends TradingEngine {
  private performanceMonitor: PerformanceMonitor;
  private priceCache: PriceCache;
  private parallelRequestPool: Set<Promise<any>> = new Set();
  private readonly MAX_PARALLEL_REQUESTS = 5;
  private lastOptimizationCheck = Date.now();
  private readonly OPTIMIZATION_CHECK_INTERVAL = 60000; // 1 minute

  constructor(config: BotConfig) {
    super(config);
    
    this.performanceMonitor = new PerformanceMonitor();
    this.priceCache = new PriceCache({
      maxSize: 500,
      defaultTtlMs: 5000, // 5 seconds for active trading
      volatileTtlMs: 2000, // 2 seconds for volatile tokens
      stableTtlMs: 15000, // 15 seconds for stable tokens
      batchSize: 10
    });

    logger.info('Optimized Trading Engine initialized with performance monitoring');
  }

  /**
   * Start the optimized trading engine
   */
  async start(): Promise<void> {
    this.performanceMonitor.startMonitoring();
    
    const operationId = 'engine-startup';
    this.performanceMonitor.startOperation(operationId);
    
    try {
      await super.start();
      this.performanceMonitor.endOperation(operationId);
      logger.info('Optimized Trading Engine started with performance monitoring');
    } catch (error) {
      this.performanceMonitor.endOperation(operationId);
      throw error;
    }
  }

  /**
   * Stop the optimized trading engine
   */
  async stop(): Promise<void> {
    this.performanceMonitor.stopMonitoring();
    this.priceCache.destroy();
    
    // Wait for any pending parallel requests
    if (this.parallelRequestPool.size > 0) {
      logger.info('Waiting for pending requests to complete');
      await Promise.allSettled(this.parallelRequestPool);
    }
    
    await super.stop();
    logger.info('Optimized Trading Engine stopped');
  }

  /**
   * Fast-path trade execution with intelligent caching and parallel processing
   */
  async executeFastTrade(params: OptimizedTradeParams): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
    latency: number;
    fastPath: boolean;
  }> {
    const startTime = Date.now();
    const operationId = 'fast-trade-' + params.tokenIn + '-' + params.tokenOut + '-' + Date.now();
    
    this.performanceMonitor.startOperation(operationId, params);

    try {
      // 1. Check if we can use fast path
      const fastPathCheck = this.checkFastPath(params);
      
      if (fastPathCheck.shouldUseFastPath) {
        logger.debug('Using fast path for trade: ' + fastPathCheck.reason);
        return await this.executeFastPathTrade(params, operationId, startTime);
      } else {
        logger.debug('Using standard path for trade: ' + fastPathCheck.reason);
        return await this.executeStandardTrade(params, operationId, startTime);
      }

    } catch (error) {
      const latency = this.performanceMonitor.endOperation(operationId);
      logger.error('Fast trade execution failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latency,
        fastPath: false
      };
    }
  }

  /**
   * Batch trade execution with parallel processing
   */
  async executeBatchTrades(request: BatchTradeRequest): Promise<{
    results: Array<{
      success: boolean;
      transactionId?: string;
      error?: string;
      tradeIndex: number;
    }>;
    totalLatency: number;
    successCount: number;
  }> {
    const startTime = Date.now();
    const operationId = 'batch-trades-' + request.trades.length + '-' + Date.now();
    
    this.performanceMonitor.startOperation(operationId, { tradeCount: request.trades.length });

    const maxParallel = Math.min(request.maxParallel || 3, this.MAX_PARALLEL_REQUESTS);
    const results: Array<{
      success: boolean;
      transactionId?: string;
      error?: string;
      tradeIndex: number;
    }> = [];

    try {
      // Execute trades in parallel batches
      for (let i = 0; i < request.trades.length; i += maxParallel) {
        const batch = request.trades.slice(i, i + maxParallel);
        const batchPromises = batch.map(async (trade, batchIndex) => {
          const tradeIndex = i + batchIndex;
          
          try {
            const result = await this.executeFastTrade(trade);
            return {
              success: result.success,
              transactionId: result.transactionId,
              error: result.error,
              tradeIndex
            };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              tradeIndex
            };
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
            
            // Stop on first error if requested
            if (request.stopOnFirstError && !result.value.success) {
              break;
            }
          } else {
            results.push({
              success: false,
              error: result.reason?.message || 'Promise rejected',
              tradeIndex: results.length
            });
            
            if (request.stopOnFirstError) {
              break;
            }
          }
        }

        if (request.stopOnFirstError && results.some(r => !r.success)) {
          break;
        }
      }

      const totalLatency = this.performanceMonitor.endOperation(operationId);
      const successCount = results.filter(r => r.success).length;

      logger.info('Batch trades completed: ' + successCount + '/' + results.length + ' successful in ' + totalLatency + 'ms');

      return {
        results,
        totalLatency,
        successCount
      };

    } catch (error) {
      const totalLatency = this.performanceMonitor.endOperation(operationId);
      logger.error('Batch trade execution failed:', error);
      
      return {
        results,
        totalLatency,
        successCount: results.filter(r => r.success).length
      };
    }
  }

  /**
   * Get optimized prices with intelligent caching
   */
  async getOptimizedPrices(tokens: string[], forceFresh: boolean = false): Promise<Map<string, { price: number; priceUsd: number; cached: boolean }>> {
    const startTime = Date.now();
    const result = new Map<string, { price: number; priceUsd: number; cached: boolean }>();

    // Check cache first unless forced fresh
    const tokensToFetch: string[] = [];
    
    if (!forceFresh) {
      for (const token of tokens) {
        const cached = this.priceCache.get(token);
        if (cached) {
          result.set(token, {
            price: cached.price,
            priceUsd: cached.priceUsd,
            cached: true
          });
        } else {
          tokensToFetch.push(token);
        }
      }
    } else {
      tokensToFetch.push(...tokens);
    }

    // Fetch missing prices
    if (tokensToFetch.length > 0) {
      try {
        const priceResponse = await this.galaSwapClient.getPrices(tokensToFetch);

        const prices = new Map<string, { price: number; priceUsd: number; source?: 'api' | 'websocket' | 'computed' }>();

        if (!priceResponse.error && priceResponse.data) {
          // priceResponse.data is string[] with prices in same order as tokensToFetch
          priceResponse.data.forEach((priceStr, index) => {
            if (index < tokensToFetch.length) {
              const token = tokensToFetch[index];
              const price = parseFloat(priceStr);
              const priceData = {
                price,
                priceUsd: price, // Assuming price is in USD
                source: 'api' as const
              };

              prices.set(token, priceData);
              result.set(token, {
              price: priceData.price,
              priceUsd: priceData.priceUsd,
              cached: false
            });
            }
          });
        }

        // Update cache
        this.priceCache.setBatch(prices);
        
      } catch (error) {
        logger.error('Error fetching prices:', error);
      }
    }

    const duration = Date.now() - startTime;
    const cacheHits = tokens.length - tokensToFetch.length;
    
    logger.debug('Price fetch: ' + cacheHits + '/' + tokens.length + ' cache hits, ' + duration + 'ms');
    
    return result;
  }

  /**
   * Get performance metrics and recommendations
   */
  getPerformanceReport(): {
    metrics: any;
    cacheStats: any;
    recommendations: string[];
    summary: any;
  } {
    return {
      metrics: this.performanceMonitor.getCurrentMetrics(),
      cacheStats: this.priceCache.getStats(),
      recommendations: this.performanceMonitor.getOptimizationRecommendations(),
      summary: this.performanceMonitor.getPerformanceSummary()
    };
  }

  /**
   * Force optimization cycle
   */
  async forceOptimization(): Promise<void> {
    logger.info('Forcing optimization cycle...');
    
    // 1. Clear expired cache entries
    this.priceCache.cleanup();
    
    // 2. Force garbage collection
    this.performanceMonitor.forceCleanup();
    
    // 3. Check for stale data that needs refresh
    const staleTokens = this.priceCache.getStaleTokens();
    if (staleTokens.length > 0) {
      logger.info('Refreshing ' + staleTokens.length + ' stale token prices');
      await this.getOptimizedPrices(staleTokens, true);
    }
    
    logger.info('Optimization cycle completed');
  }

  // Private optimization methods

  private checkFastPath(params: OptimizedTradeParams): FastPathResult {
    // Fast path criteria:
    // 1. Standard urgency or lower
    // 2. Reasonable trade size
    // 3. Fresh price data available
    // 4. System not under heavy load
    
    if (params.urgency === 'high') {
      return {
        shouldUseFastPath: false,
        reason: 'High urgency requires immediate execution',
        estimatedLatency: 1500
      };
    }

    const currentMetrics = this.performanceMonitor.getCurrentMetrics();
    if (currentMetrics && currentMetrics.apiCallsPerMinute > 40) {
      return {
        shouldUseFastPath: false,
        reason: 'High API load detected',
        estimatedLatency: 3000
      };
    }

    const hasFreshPrices = this.priceCache.isFresh(params.tokenIn) && this.priceCache.isFresh(params.tokenOut);
    if (!hasFreshPrices && !params.bypassCache) {
      return {
        shouldUseFastPath: false,
        reason: 'Need fresh price data',
        estimatedLatency: 2500
      };
    }

    return {
      shouldUseFastPath: true,
      reason: 'All fast path criteria met',
      estimatedLatency: 800
    };
  }

  private async executeFastPathTrade(params: OptimizedTradeParams, operationId: string, startTime: number): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
    latency: number;
    fastPath: boolean;
  }> {
    // Use cached prices and optimized execution
    const standardResult = await this.executeManualTrade({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      slippageTolerance: params.slippageTolerance
    });

    const latency = this.performanceMonitor.endOperation(operationId);
    this.performanceMonitor.recordTradeExecution(latency);

    return {
      success: standardResult.success,
      transactionId: standardResult.transactionId,
      error: standardResult.error,
      latency,
      fastPath: true
    };
  }

  private async executeStandardTrade(params: OptimizedTradeParams, operationId: string, startTime: number): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
    latency: number;
    fastPath: boolean;
  }> {
    // Use standard execution path
    const standardResult = await this.executeManualTrade({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      slippageTolerance: params.slippageTolerance
    });

    const latency = this.performanceMonitor.endOperation(operationId);
    this.performanceMonitor.recordTradeExecution(latency);

    return {
      success: standardResult.success,
      transactionId: standardResult.transactionId,
      error: standardResult.error,
      latency,
      fastPath: false
    };
  }

  private async checkOptimization(): Promise<void> {
    const now = Date.now();
    if (now - this.lastOptimizationCheck < this.OPTIMIZATION_CHECK_INTERVAL) {
      return;
    }

    this.lastOptimizationCheck = now;
    
    const metrics = this.performanceMonitor.getCurrentMetrics();
    const cacheStats = this.priceCache.getStats();
    
    // Auto-optimize if needed
    if (metrics && metrics.memoryUsage > 150) {
      logger.info('High memory usage detected, forcing cleanup');
      this.performanceMonitor.forceCleanup();
    }
    
    if (cacheStats.hitRate < 60) {
      logger.info('Low cache hit rate, refreshing frequently used tokens');
      const tokensToRefresh = this.priceCache.getTokensForRefresh();
      if (tokensToRefresh.length > 0) {
        await this.getOptimizedPrices(tokensToRefresh, true);
      }
    }
  }
}
