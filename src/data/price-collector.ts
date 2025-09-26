/**
 * Historical Price Data Collection System
 * Enhanced API polling with persistent storage for statistical analysis
 */

import { logger } from '../utils/logger';
import { createQuoteWrapper } from '../utils/quote-api';
import { RateLimiter } from '../utils/rate-limiter';
import { timeSeriesDB, PricePoint, OHLCVData } from './storage/timeseries-db';
import { IntervalType } from '../entities/analytics';

export interface CollectorConfig {
  collectionInterval: number; // Collection interval in milliseconds
  retentionDays: number; // How long to keep data
  enableOHLCVAggregation: boolean; // Whether to create OHLCV candles
  ohlcvIntervals: IntervalType[]; // OHLCV intervals to generate
  maxRetries: number; // Maximum retries per token
  rateLimitRequests: number; // Rate limit (requests per second)
}

export interface CollectionStats {
  totalCollected: number;
  successfulCollections: number;
  failedCollections: number;
  tokensTracked: number;
  lastCollectionTime: number;
  averageCollectionTime: number;
  collectionErrors: Array<{
    token: string;
    error: string;
    timestamp: number;
  }>;
}

export interface TokenPriceData {
  token: string;
  price: number;
  volume24h?: number;
  marketCap?: number;
  priceChange24h?: number;
  timestamp: number;
  source: string;
}

export class PriceCollector {
  private isRunning: boolean = false;
  private collectionInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private ohlcvAggregationInterval: NodeJS.Timeout | null = null;

  private config: CollectorConfig;
  private stats: CollectionStats;
  private quoteWrapper: ReturnType<typeof createQuoteWrapper>;
  private rateLimiter: RateLimiter;

  // Price tracking for OHLCV aggregation
  private priceBuffer: Map<string, Array<{ price: number; timestamp: number; volume?: number }>> = new Map();

  private readonly TOKENS_TO_TRACK = [
    'GALA',
    'GUSDC',
    'GUSDT',
    'ETIME',
    'SILK',
    'GTON',
    'GWETH',
    'GWBTC',
    'TOWN',
    'MATERIUM'
  ];

  constructor(config?: Partial<CollectorConfig>) {
    this.config = {
      collectionInterval: 30000, // 30 seconds
      retentionDays: 30, // 30 days retention
      enableOHLCVAggregation: true,
      ohlcvIntervals: ['1m', '5m', '15m', '1h', '1d'] as IntervalType[],
      maxRetries: 3,
      rateLimitRequests: 10, // 10 requests per second
      ...config
    };

    this.stats = {
      totalCollected: 0,
      successfulCollections: 0,
      failedCollections: 0,
      tokensTracked: this.TOKENS_TO_TRACK.length,
      lastCollectionTime: 0,
      averageCollectionTime: 0,
      collectionErrors: []
    };

    // Initialize rate limiter for respectful API usage
    this.rateLimiter = new RateLimiter({
      requestsPerSecond: this.config.rateLimitRequests,
      burstLimit: this.config.rateLimitRequests * 2
    });

    // Initialize quote wrapper
    this.quoteWrapper = createQuoteWrapper(
      process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com'
    );

    logger.info('✅ PriceCollector initialized', {
      collectionInterval: this.config.collectionInterval,
      retentionDays: this.config.retentionDays,
      tokensTracked: this.stats.tokensTracked,
      ohlcvEnabled: this.config.enableOHLCVAggregation
    });
  }

  /**
   * Start price collection system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Price collector already running');
      return;
    }

    try {
      logger.info('🚀 Starting Price Collection System...');

      // Initialize database
      await timeSeriesDB.initialize();

      // Start collection cycle
      this.startCollection();

      // Start cleanup cycle (daily)
      this.startCleanup();

      // Start OHLCV aggregation if enabled
      if (this.config.enableOHLCVAggregation) {
        this.startOHLCVAggregation();
      }

      // Initial collection
      await this.collectAllPrices();

      this.isRunning = true;
      logger.info('✅ Price Collection System started successfully');

    } catch (error) {
      logger.error('❌ Failed to start Price Collection System:', error);
      throw error;
    }
  }

  /**
   * Stop price collection system
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Price collector not running');
      return;
    }

    try {
      logger.info('🛑 Stopping Price Collection System...');

      // Clear intervals
      if (this.collectionInterval) {
        clearInterval(this.collectionInterval);
        this.collectionInterval = null;
      }

      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      if (this.ohlcvAggregationInterval) {
        clearInterval(this.ohlcvAggregationInterval);
        this.ohlcvAggregationInterval = null;
      }

      // Final collection and OHLCV aggregation
      if (this.config.enableOHLCVAggregation) {
        await this.processOHLCVBuffer();
      }

      this.isRunning = false;
      logger.info('✅ Price Collection System stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping Price Collection System:', error);
      throw error;
    }
  }

  /**
   * Start collection cycle
   */
  private startCollection(): void {
    this.collectionInterval = setInterval(async () => {
      try {
        await this.collectAllPrices();
      } catch (error) {
        logger.error('Error in collection cycle:', error);
      }
    }, this.config.collectionInterval);

    logger.info(`📊 Price collection started (interval: ${this.config.collectionInterval}ms)`);
  }

  /**
   * Start cleanup cycle (daily)
   */
  private startCleanup(): void {
    const cleanupIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupOldData();
      } catch (error) {
        logger.error('Error in cleanup cycle:', error);
      }
    }, cleanupIntervalMs);

    logger.info('🧹 Data cleanup cycle started (daily)');
  }

  /**
   * Start OHLCV aggregation cycle (every 5 minutes)
   */
  private startOHLCVAggregation(): void {
    const aggregationIntervalMs = 5 * 60 * 1000; // 5 minutes

    this.ohlcvAggregationInterval = setInterval(async () => {
      try {
        await this.processOHLCVBuffer();
      } catch (error) {
        logger.error('Error in OHLCV aggregation cycle:', error);
      }
    }, aggregationIntervalMs);

    logger.info('📈 OHLCV aggregation started (5-minute interval)');
  }

  /**
   * Collect prices for all tracked tokens
   */
  async collectAllPrices(): Promise<void> {
    const startTime = Date.now();
    const collectionTimestamp = Date.now();

    logger.info('💱 Starting price collection cycle...');

    const pricePoints: PricePoint[] = [];
    const errors: Array<{ token: string; error: string; timestamp: number }> = [];

    // Collect prices for all tokens
    for (const token of this.TOKENS_TO_TRACK) {
      try {
        // Wait for rate limit
        await this.rateLimiter.waitForLimit();

        const priceData = await this.collectTokenPrice(token, collectionTimestamp);
        if (priceData) {
          pricePoints.push({
            token: priceData.token,
            timestamp: priceData.timestamp,
            price: priceData.price,
            volume24h: priceData.volume24h,
            marketCap: priceData.marketCap,
            priceChange24h: priceData.priceChange24h,
            source: priceData.source
          });

          // Add to OHLCV buffer if enabled
          if (this.config.enableOHLCVAggregation) {
            this.addToPriceBuffer(token, priceData.price, priceData.timestamp, priceData.volume24h);
          }

          this.stats.successfulCollections++;
        } else {
          this.stats.failedCollections++;
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to collect price for ${token}: ${errorMessage}`);

        errors.push({
          token,
          error: errorMessage,
          timestamp: collectionTimestamp
        });

        this.stats.failedCollections++;
      }
    }

    // Store all collected prices in batch
    if (pricePoints.length > 0) {
      try {
        await timeSeriesDB.storePricePoints(pricePoints);
        logger.info(`✅ Stored ${pricePoints.length} price points`);
      } catch (error) {
        logger.error('❌ Failed to store price points:', error);
      }
    }

    // Update statistics
    const collectionTime = Date.now() - startTime;
    this.stats.totalCollected += pricePoints.length;
    this.stats.lastCollectionTime = collectionTimestamp;
    this.stats.averageCollectionTime = (this.stats.averageCollectionTime + collectionTime) / 2;

    // Keep only recent errors (last 100)
    this.stats.collectionErrors = [...errors, ...this.stats.collectionErrors].slice(0, 100);

    logger.info(`📊 Collection cycle completed: ${pricePoints.length}/${this.TOKENS_TO_TRACK.length} successful in ${collectionTime}ms`);
  }

  /**
   * Collect price for a single token
   */
  private async collectTokenPrice(token: string, timestamp: number): Promise<TokenPriceData | null> {
    try {
      const tokenKey = this.getTokenKey(token);

      // Special handling for GUSDC (stable at $1.00)
      if (token === 'GUSDC') {
        return {
          token,
          price: 1.0,
          timestamp,
          source: 'hardcoded_stable',
          priceChange24h: 0
        };
      }

      // Get quote via working API
      const quote = await this.quoteWrapper.quoteExactInput(
        'GUSDC|Unit|none|none', // From GUSDC
        tokenKey,               // To target token
        1                      // 1 GUSDC worth
      );

      if (quote?.outTokenAmount) {
        // Price = 1 GUSDC / amount of tokens received for 1 GUSDC
        const calculatedPrice = 1 / safeParseFloat(quote.outTokenAmount.toString(), 0);

        if (calculatedPrice > 0 && isFinite(calculatedPrice)) {
          return {
            token,
            price: calculatedPrice,
            timestamp,
            source: 'galaswap_api',
            volume24h: undefined, // Volume not available from quote endpoint
            marketCap: undefined, // Market cap not available
            priceChange24h: undefined // Would need historical data
          };
        }
      }

      return null;

    } catch (error) {
      // Expected errors for tokens without active pools
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('No route found') || errorMsg.includes('404')) {
        logger.debug(`ℹ️ No route/quote available for ${token} (expected for some tokens)`);
      } else {
        logger.debug(`Price collection failed for ${token}: ${errorMsg}`);
      }
      return null;
    }
  }

  /**
   * Get token key in SDK format
   */
  private getTokenKey(token: string): string {
    // Convert token symbol to SDK format
    const tokenMap: Record<string, string> = {
      'GALA': 'GALA|Unit|none|none',
      'GUSDC': 'GUSDC|Unit|none|none',
      'GUSDT': 'GUSDT|Unit|none|none',
      'ETIME': 'ETIME|Unit|none|none',
      'SILK': 'SILK|Unit|none|none',
      'GTON': 'GTON|Unit|none|none',
      'GWETH': 'GWETH|Unit|none|none',
      'GWBTC': 'GWBTC|Unit|none|none',
      'TOWN': 'TOWN|Unit|none|none',
      'MATERIUM': 'MATERIUM|Unit|none|none'
    };

    return tokenMap[token] || `${token}|Unit|none|none`;
  }

  /**
   * Add price to buffer for OHLCV aggregation
   */
  private addToPriceBuffer(token: string, price: number, timestamp: number, volume?: number): void {
    if (!this.priceBuffer.has(token)) {
      this.priceBuffer.set(token, []);
    }

    const buffer = this.priceBuffer.get(token)!;
    buffer.push({ price, timestamp, volume });

    // Keep buffer size reasonable (last 1000 points per token)
    if (buffer.length > 1000) {
      this.priceBuffer.set(token, buffer.slice(-1000));
    }
  }

  /**
   * Process OHLCV buffer and create candle data
   */
  private async processOHLCVBuffer(): Promise<void> {
    if (!this.config.enableOHLCVAggregation) return;

    try {
      logger.info('📈 Processing OHLCV buffer...');

      for (const [token, priceData] of this.priceBuffer) {
        if (priceData.length === 0) continue;

        // Process each interval type
        for (const intervalType of this.config.ohlcvIntervals) {
          await this.createOHLCVCandles(token, priceData, intervalType);
        }

        // Clear processed data (keep last 10 points for overlap)
        this.priceBuffer.set(token, priceData.slice(-10));
      }

      logger.info('✅ OHLCV processing completed');

    } catch (error) {
      logger.error('❌ Failed to process OHLCV buffer:', error);
    }
  }

  /**
   * Create OHLCV candles for a specific interval
   */
  private async createOHLCVCandles(
    token: string,
    priceData: Array<{ price: number; timestamp: number; volume?: number }>,
    intervalType: IntervalType
  ): Promise<void> {
    try {
      const intervalMs = this.getIntervalMs(intervalType);
      const intervals = new Map<number, Array<{ price: number; timestamp: number; volume?: number }>>();

      // Group price data by intervals
      for (const point of priceData) {
        const intervalStart = Math.floor(point.timestamp / intervalMs) * intervalMs;
        if (!intervals.has(intervalStart)) {
          intervals.set(intervalStart, []);
        }
        intervals.get(intervalStart)!.push(point);
      }

      // Create OHLCV records for each interval with sufficient data
      for (const [intervalStart, points] of intervals) {
        if (points.length < 2) continue; // Need at least 2 points for meaningful candle

        const sortedPoints = points.sort((a, b) => a.timestamp - b.timestamp);
        const open = sortedPoints[0].price;
        const close = sortedPoints[sortedPoints.length - 1].price;
        const high = Math.max(...sortedPoints.map(p => p.price));
        const low = Math.min(...sortedPoints.map(p => p.price));
        const volume = sortedPoints.reduce((sum, p) => sum + (p.volume || 0), 0);

        const ohlcvData: OHLCVData = {
          token,
          intervalStart,
          intervalType,
          open,
          high,
          low,
          close,
          volume,
          tradeCount: sortedPoints.length
        };

        await timeSeriesDB.storeOHLCV(ohlcvData);
      }

    } catch (error) {
      logger.error(`❌ Failed to create OHLCV candles for ${token} (${intervalType}):`, error);
    }
  }

  /**
   * Get interval duration in milliseconds
   */
  private getIntervalMs(intervalType: IntervalType): number {
    switch (intervalType) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '30m': return 30 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case '1d': return 24 * 60 * 60 * 1000;
      case '1w': return 7 * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }

  /**
   * Clean up old data
   */
  private async cleanupOldData(): Promise<void> {
    try {
      logger.info('🧹 Starting data cleanup...');

      await timeSeriesDB.cleanupOldData(this.config.retentionDays);

      logger.info('✅ Data cleanup completed');

    } catch (error) {
      logger.error('❌ Data cleanup failed:', error);
    }
  }

  /**
   * Force collection for specific tokens
   */
  async collectSpecificTokens(tokens: string[]): Promise<void> {
    logger.info(`🎯 Collecting prices for specific tokens: ${tokens.join(', ')}`);

    const timestamp = Date.now();
    const pricePoints: PricePoint[] = [];

    for (const token of tokens) {
      try {
        await this.rateLimiter.waitForLimit();

        const priceData = await this.collectTokenPrice(token, timestamp);
        if (priceData) {
          pricePoints.push({
            token: priceData.token,
            timestamp: priceData.timestamp,
            price: priceData.price,
            volume24h: priceData.volume24h,
            marketCap: priceData.marketCap,
            priceChange24h: priceData.priceChange24h,
            source: priceData.source
          });
        }

      } catch (error) {
        logger.warn(`Failed to collect ${token}:`, error);
      }
    }

    if (pricePoints.length > 0) {
      await timeSeriesDB.storePricePoints(pricePoints);
      logger.info(`✅ Collected ${pricePoints.length} prices`);
    }
  }

  /**
   * Get collection statistics
   */
  getStatistics(): CollectionStats {
    return { ...this.stats };
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    return await timeSeriesDB.getDatabaseStats();
  }

  /**
   * Get recent price history for a token
   */
  async getRecentPrices(token: string, hours: number = 24) {
    const endTime = Date.now();
    const startTime = endTime - (hours * 60 * 60 * 1000);

    return await timeSeriesDB.getPriceHistory(token, {
      startTime,
      endTime,
      orderBy: 'ASC'
    });
  }

  /**
   * Get OHLCV data for a token
   */
  async getOHLCV(token: string, intervalType: IntervalType, hours: number = 24) {
    const endTime = Date.now();
    const startTime = endTime - (hours * 60 * 60 * 1000);

    return await timeSeriesDB.getOHLCV(token, {
      startTime,
      endTime,
      intervalType,
      orderBy: 'ASC'
    });
  }

  /**
   * Calculate volatility for a token
   */
  async calculateVolatility(token: string, hours: number = 24): Promise<number> {
    const periodMs = hours * 60 * 60 * 1000;
    return await timeSeriesDB.calculateVolatility(token, periodMs);
  }

  /**
   * Check if collector is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<CollectorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('📝 Price collector configuration updated', newConfig);
  }
}

// Export singleton instance for easy use
export const priceCollector = new PriceCollector();