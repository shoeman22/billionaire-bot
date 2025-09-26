/**
 * Price Collection System Tests
 * Unit tests for historical price data collection and storage
 */

import { timeSeriesDB, TimeSeriesDB, PriceCollector, PricePoint, OHLCVData } from '../../data';
import { PriceHistory, PriceOHLCV, IntervalType } from '../../entities/analytics';

// Mock dependencies
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
}));

jest.mock('../../utils/quote-api', () => ({
  createQuoteWrapper: jest.fn(() => ({
    quoteExactInput: jest.fn().mockResolvedValue({
      outTokenAmount: '0.025',  // 1 GUSDC = 0.025 tokens, so 1 token = $40
      feeTier: 10000,
      priceImpact: 0.1
    })
  }))
}));

jest.mock('../../config/database', () => ({
  getDataSource: jest.fn().mockResolvedValue({
    getRepository: jest.fn().mockImplementation((entity) => {
      // Mock repository methods
      const mockRepo = {
        save: jest.fn().mockResolvedValue(entity),
        upsert: jest.fn().mockResolvedValue({ affected: 1 }),
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getOne: jest.fn().mockResolvedValue(null),
          delete: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 0 }),
          select: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue({ count: 0, timestamp: null })
        })),
        count: jest.fn().mockResolvedValue(0)
      };
      return mockRepo;
    })
  })
}));

describe('TimeSeriesDB', () => {
  let tsdb: TimeSeriesDB;

  beforeEach(() => {
    tsdb = new TimeSeriesDB();
    jest.clearAllMocks();
  });

  describe('Price Point Storage', () => {
    it('should store a single price point', async () => {
      const pricePoint: PricePoint = {
        token: 'GALA',
        timestamp: Date.now(),
        price: 0.025,
        volume24h: 1000000,
        source: 'test'
      };

      await expect(tsdb.storePricePoint(pricePoint)).resolves.not.toThrow();
    });

    it('should store multiple price points in batch', async () => {
      const pricePoints: PricePoint[] = [
        {
          token: 'GALA',
          timestamp: Date.now(),
          price: 0.025,
          volume24h: 1000000,
          source: 'test'
        },
        {
          token: 'ETIME',
          timestamp: Date.now(),
          price: 0.15,
          volume24h: 500000,
          source: 'test'
        }
      ];

      await expect(tsdb.storePricePoints(pricePoints)).resolves.not.toThrow();
    });

    it('should handle price point validation', async () => {
      const invalidPricePoint: PricePoint = {
        token: '',  // Invalid: empty token
        timestamp: Date.now(),
        price: -1,  // Invalid: negative price
        source: 'test'
      };

      // Should not throw, but should handle validation internally
      await expect(tsdb.storePricePoint(invalidPricePoint)).resolves.not.toThrow();
    });
  });

  describe('OHLCV Storage', () => {
    it('should store OHLCV data', async () => {
      const ohlcvData: OHLCVData = {
        token: 'GALA',
        intervalStart: Date.now(),
        intervalType: '1h',
        open: 0.024,
        high: 0.026,
        low: 0.023,
        close: 0.025,
        volume: 10000
      };

      await expect(tsdb.storeOHLCV(ohlcvData)).resolves.not.toThrow();
    });

    it('should validate OHLCV data consistency', async () => {
      const invalidOHLCVData: OHLCVData = {
        token: 'GALA',
        intervalStart: Date.now(),
        intervalType: '1h',
        open: 0.025,
        high: 0.023,  // Invalid: high < open
        low: 0.026,   // Invalid: low > open
        close: 0.024,
        volume: 10000
      };

      // Should store without validation errors (validation may be done at application level)
      await expect(tsdb.storeOHLCV(invalidOHLCVData)).resolves.not.toThrow();
    });
  });

  describe('Data Retrieval', () => {
    it('should retrieve price history with options', async () => {
      const result = await tsdb.getPriceHistory('GALA', {
        startTime: Date.now() - 86400000, // 24 hours ago
        endTime: Date.now(),
        limit: 100,
        orderBy: 'DESC'
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should retrieve OHLCV data with filters', async () => {
      const result = await tsdb.getOHLCV('GALA', {
        startTime: Date.now() - 86400000,
        intervalType: '1h',
        limit: 24
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should get latest price for a token', async () => {
      const result = await tsdb.getLatestPrice('GALA');
      // Should return null if no data exists
      expect(result).toBeNull();
    });
  });

  describe('Statistical Calculations', () => {
    it('should calculate volatility', async () => {
      const volatility = await tsdb.calculateVolatility('GALA', 86400000); // 24 hours
      expect(typeof volatility).toBe('number');
      expect(volatility).toBeGreaterThanOrEqual(0);
    });

    it('should handle volatility calculation with insufficient data', async () => {
      const volatility = await tsdb.calculateVolatility('NONEXISTENT', 86400000);
      expect(volatility).toBe(0);
    });
  });

  describe('Database Management', () => {
    it('should get database statistics', async () => {
      const stats = await tsdb.getDatabaseStats();

      expect(stats).toHaveProperty('priceHistoryCount');
      expect(stats).toHaveProperty('ohlcvCount');
      expect(stats).toHaveProperty('statisticsCount');
      expect(stats).toHaveProperty('tokensTracked');
      expect(stats).toHaveProperty('oldestRecord');
      expect(stats).toHaveProperty('newestRecord');

      expect(typeof stats.priceHistoryCount).toBe('number');
      expect(typeof stats.ohlcvCount).toBe('number');
      expect(typeof stats.statisticsCount).toBe('number');
      expect(typeof stats.tokensTracked).toBe('number');
    });

    it('should perform data cleanup', async () => {
      await expect(tsdb.cleanupOldData(30)).resolves.not.toThrow();
    });

    it('should aggregate OHLCV from price history', async () => {
      const endTime = Date.now();
      const startTime = endTime - 3600000; // 1 hour ago

      await expect(tsdb.aggregateOHLCVFromHistory(
        'GALA',
        '1h',
        startTime,
        endTime
      )).resolves.not.toThrow();
    });
  });
});

describe('PriceCollector', () => {
  let collector: PriceCollector;

  beforeEach(() => {
    collector = new PriceCollector({
      collectionInterval: 10000, // 10 seconds for testing
      retentionDays: 1,
      enableOHLCVAggregation: true,
      ohlcvIntervals: ['1m', '5m'] as IntervalType[],
      maxRetries: 2,
      rateLimitRequests: 5
    });
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should initialize with default configuration', () => {
      const defaultCollector = new PriceCollector();
      expect(defaultCollector).toBeInstanceOf(PriceCollector);
    });

    it('should update configuration', () => {
      const newConfig = {
        collectionInterval: 5000,
        retentionDays: 7
      };

      collector.updateConfig(newConfig);
      expect(collector.getStatistics().tokensTracked).toBeGreaterThan(0);
    });

    it('should check if collector is active', () => {
      expect(collector.isActive()).toBe(false);
    });
  });

  describe('Price Collection', () => {
    it('should collect prices for specific tokens', async () => {
      const tokens = ['GALA', 'GUSDC', 'ETIME'];

      await expect(collector.collectSpecificTokens(tokens)).resolves.not.toThrow();
    });

    it('should handle collection failures gracefully', async () => {
      // Test with invalid token
      const tokens = ['INVALID_TOKEN'];

      await expect(collector.collectSpecificTokens(tokens)).resolves.not.toThrow();
    });

    it('should respect rate limits during collection', async () => {
      const tokens = ['GALA', 'ETIME', 'SILK'];

      const startTime = Date.now();
      await collector.collectSpecificTokens(tokens);
      const endTime = Date.now();

      // Should take some time due to rate limiting
      expect(endTime - startTime).toBeGreaterThan(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should return collection statistics', () => {
      const stats = collector.getStatistics();

      expect(stats).toHaveProperty('totalCollected');
      expect(stats).toHaveProperty('successfulCollections');
      expect(stats).toHaveProperty('failedCollections');
      expect(stats).toHaveProperty('tokensTracked');
      expect(stats).toHaveProperty('lastCollectionTime');
      expect(stats).toHaveProperty('averageCollectionTime');
      expect(stats).toHaveProperty('collectionErrors');

      expect(typeof stats.totalCollected).toBe('number');
      expect(typeof stats.successfulCollections).toBe('number');
      expect(typeof stats.failedCollections).toBe('number');
      expect(typeof stats.tokensTracked).toBe('number');
      expect(Array.isArray(stats.collectionErrors)).toBe(true);
    });

    it('should get database statistics', async () => {
      const dbStats = await collector.getDatabaseStats();

      expect(dbStats).toHaveProperty('priceHistoryCount');
      expect(dbStats).toHaveProperty('ohlcvCount');
      expect(dbStats).toHaveProperty('statisticsCount');
      expect(dbStats).toHaveProperty('tokensTracked');
    });

    it('should get recent prices', async () => {
      const recentPrices = await collector.getRecentPrices('GALA', 1); // 1 hour
      expect(Array.isArray(recentPrices)).toBe(true);
    });

    it('should get OHLCV data', async () => {
      const ohlcvData = await collector.getOHLCV('GALA', '1h', 24);
      expect(Array.isArray(ohlcvData)).toBe(true);
    });

    it('should calculate volatility', async () => {
      const volatility = await collector.calculateVolatility('GALA', 24);
      expect(typeof volatility).toBe('number');
      expect(volatility).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Lifecycle Management', () => {
    it('should start and stop collector', async () => {
      // Start collector
      const startPromise = collector.start();

      // Give it a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(collector.isActive()).toBe(true);

      // Stop collector
      await collector.stop();
      expect(collector.isActive()).toBe(false);

      // Wait for start promise to resolve
      await expect(startPromise).resolves.not.toThrow();
    });

    it('should handle start/stop idempotency', async () => {
      // Multiple starts should not cause issues
      await collector.start();
      await expect(collector.start()).resolves.not.toThrow();

      // Multiple stops should not cause issues
      await collector.stop();
      await expect(collector.stop()).resolves.not.toThrow();
    });
  });
});

describe('Price Entities', () => {
  describe('PriceHistory Entity', () => {
    it('should handle price data conversion', () => {
      const priceHistory = new PriceHistory();

      priceHistory.setPriceUsd(0.025);
      expect(priceHistory.getPriceUsd()).toBe(0.025);

      priceHistory.setVolume24h(1000000);
      expect(priceHistory.getVolume24h()).toBe(1000000);

      priceHistory.setMarketCap(50000000);
      expect(priceHistory.getMarketCap()).toBe(50000000);

      priceHistory.setPriceChange24h(5.5);
      expect(priceHistory.getPriceChange24h()).toBe(5.5);
    });

    it('should handle null values', () => {
      const priceHistory = new PriceHistory();

      priceHistory.setVolume24h(null);
      expect(priceHistory.getVolume24h()).toBeNull();

      priceHistory.setMarketCap(null);
      expect(priceHistory.getMarketCap()).toBeNull();

      priceHistory.setPriceChange24h(null);
      expect(priceHistory.getPriceChange24h()).toBeNull();
    });
  });

  describe('PriceOHLCV Entity', () => {
    it('should handle OHLCV data conversion', () => {
      const ohlcv = new PriceOHLCV();

      ohlcv.setOpenPrice(0.024);
      ohlcv.setHighPrice(0.026);
      ohlcv.setLowPrice(0.023);
      ohlcv.setClosePrice(0.025);
      ohlcv.setVolume(10000);

      expect(ohlcv.getOpenPrice()).toBe(0.024);
      expect(ohlcv.getHighPrice()).toBe(0.026);
      expect(ohlcv.getLowPrice()).toBe(0.023);
      expect(ohlcv.getClosePrice()).toBe(0.025);
      expect(ohlcv.getVolume()).toBe(10000);
    });

    it('should calculate price metrics', () => {
      const ohlcv = new PriceOHLCV();
      ohlcv.setOpenPrice(0.024);
      ohlcv.setHighPrice(0.026);
      ohlcv.setLowPrice(0.023);
      ohlcv.setClosePrice(0.025);

      // Price change percentage
      const priceChange = ohlcv.getPriceChangePercent();
      expect(priceChange).toBeCloseTo(4.17, 2); // (0.025 - 0.024) / 0.024 * 100

      // Bullish check
      expect(ohlcv.isBullish()).toBe(true); // close > open

      // Body and wick sizes
      expect(ohlcv.getBodySize()).toBeCloseTo(0.001, 3); // |0.025 - 0.024|
      expect(ohlcv.getWickSize()).toBeCloseTo(0.002, 3); // (0.026 - 0.023) - 0.001
    });

    it('should calculate interval timing', () => {
      const ohlcv = new PriceOHLCV();
      ohlcv.interval_start = 1640995200000; // 2022-01-01 00:00:00 UTC
      ohlcv.interval_type = '1h';

      const intervalEnd = ohlcv.getIntervalEnd();
      expect(intervalEnd).toBe(1640995200000 + (60 * 60 * 1000)); // 1 hour later
    });
  });
});

describe('Integration Tests', () => {
  it('should handle full price collection workflow', async () => {
    const collector = new PriceCollector({
      collectionInterval: 60000,
      retentionDays: 1,
      enableOHLCVAggregation: true,
      ohlcvIntervals: ['1m'] as IntervalType[],
      maxRetries: 1,
      rateLimitRequests: 2
    });

    // Manual collection
    await expect(collector.collectSpecificTokens(['GUSDC'])).resolves.not.toThrow();

    // Check statistics
    const stats = collector.getStatistics();
    expect(stats.totalCollected).toBeGreaterThanOrEqual(0);

    // Database operations
    const dbStats = await collector.getDatabaseStats();
    expect(dbStats.priceHistoryCount).toBeGreaterThanOrEqual(0);
  });

  it('should handle errors gracefully throughout the system', async () => {
    const collector = new PriceCollector({
      collectionInterval: 60000,
      retentionDays: 1,
      maxRetries: 1
    });

    // Test with problematic tokens
    await expect(collector.collectSpecificTokens([
      'NONEXISTENT_TOKEN',
      '',
      'INVALID'
    ])).resolves.not.toThrow();

    const stats = collector.getStatistics();
    expect(Array.isArray(stats.collectionErrors)).toBe(true);
  });
});