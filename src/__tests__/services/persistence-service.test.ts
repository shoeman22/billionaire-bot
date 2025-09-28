/**
 * PersistenceService Test Suite
 *
 * Tests the core database persistence service that handles all
 * analytics data storage, caching, and retrieval operations.
 */

import { DataSource } from 'typeorm';
import { PersistenceService } from '../../services/persistence-service';
import { getDataSource } from '../../config/database';
import { WhaleWatchlist } from '../../entities/analytics/WhaleWatchlist.entity';
import { WhaleAlert } from '../../entities/analytics/WhaleAlert.entity';
import { VolumeGraphData } from '../../entities/analytics/VolumeGraphData.entity';
import { VolumePattern } from '../../entities/analytics/VolumePattern.entity';
import { TransactionCache } from '../../entities/analytics/TransactionCache.entity';
import { AnalyticsSnapshot } from '../../entities/analytics/AnalyticsSnapshot.entity';

describe('PersistenceService', () => {
  let dataSource: DataSource;
  let persistenceService: PersistenceService;

  beforeAll(async () => {
    // Set test environment to ensure in-memory database
    process.env.NODE_ENV = 'test';

    // Use the same database configuration as the service
    dataSource = await getDataSource();
    persistenceService = new PersistenceService();
    await persistenceService.initialize();
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Get all table names and clear them in proper order
    const queryRunner = dataSource.createQueryRunner();
    try {
      // Disable foreign key checks temporarily
      await queryRunner.query('PRAGMA foreign_keys = OFF');

      // Clear all tables
      await queryRunner.query('DELETE FROM whale_alerts');
      await queryRunner.query('DELETE FROM volume_graph_data');
      await queryRunner.query('DELETE FROM volume_patterns');
      await queryRunner.query('DELETE FROM transaction_cache');
      await queryRunner.query('DELETE FROM analytics_snapshots');
      await queryRunner.query('DELETE FROM whale_watchlist');

      // Re-enable foreign key checks
      await queryRunner.query('PRAGMA foreign_keys = ON');
    } finally {
      await queryRunner.release();
    }

    // Reset operation counters for test isolation
    (persistenceService as any).operationCounts = {
      reads: 0,
      writes: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  });

  describe('Whale Watchlist Management', () => {
    it('should add whale to watchlist', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      await persistenceService.addWhaleToWatchlist(whaleAddress, 'high');

      const whales = await persistenceService.getWhales({ isActive: true });
      const whale = whales.find(w => w.whaleAddress === whaleAddress);
      expect(whale).toBeDefined();
      expect(whale!.whaleAddress).toBe(whaleAddress);
      expect(whale!.priority).toBe('high');
      expect(whale!.isActive).toBe(true);
    });

    it('should update whale priority', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      await persistenceService.addWhaleToWatchlist(whaleAddress, 'medium');
      await persistenceService.addWhaleToWatchlist(whaleAddress, 'critical');

      const whales = await persistenceService.getWhales({ isActive: true });
      const whale = whales.find(w => w.whaleAddress === whaleAddress);
      expect(whale!.priority).toBe('critical');
    });

    it('should remove whale from watchlist', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      await persistenceService.addWhaleToWatchlist(whaleAddress, 'high');
      await persistenceService.removeWhaleFromWatchlist(whaleAddress);

      const whales = await persistenceService.getWhales({ isActive: true });
      const whale = whales.find(w => w.whaleAddress === whaleAddress);
      expect(whale).toBeUndefined();
    });

    it('should get all active whales', async () => {
      await persistenceService.addWhaleToWatchlist('client|whale1', 'high', true); // copyTrading: true
      await persistenceService.addWhaleToWatchlist('client|whale2', 'medium', true); // copyTrading: true
      await persistenceService.addWhaleToWatchlist('client|whale3', 'low', true); // copyTrading: true

      // Note: We can't deactivate whales with current API, so we'll test with different approach

      const activeWhales = await persistenceService.getActiveWhales();
      expect(activeWhales).toHaveLength(3); // All whales should be active
    });
  });

  describe('Whale Alert Management', () => {
    it('should create whale alert', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';
      const poolHash = 'abc123';

      // Add whale to watchlist first (required for foreign key)
      await persistenceService.addWhaleToWatchlist(whaleAddress, 'high');

      await persistenceService.createWhaleAlert(
        whaleAddress,
        'large_trade',
        'warning',
        { amount: '1000', transaction_type: 'swap' },
        poolHash
      );

      const alerts = await persistenceService.getUnprocessedAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].alertType).toBe('large_trade');
      expect(alerts[0].severity).toBe('warning');
      expect(alerts[0].data).toEqual({ amount: '1000', transaction_type: 'swap' });
    });

    it('should get recent whale alerts', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      // Add whale to watchlist first (required for foreign key)
      await persistenceService.addWhaleToWatchlist(whaleAddress, 'high');

      // Create multiple alerts
      await persistenceService.createWhaleAlert(whaleAddress, 'large_trade', 'warning', {}, 'pool1');
      await persistenceService.createWhaleAlert(whaleAddress, 'volume_spike', 'info', {}, 'pool2');

      const recentAlerts = await persistenceService.getUnprocessedAlerts(10);
      expect(recentAlerts).toHaveLength(2); // 2 from this test
      expect(recentAlerts[0].createdAt.getTime()).toBeGreaterThanOrEqual(recentAlerts[1].createdAt.getTime());
    });
  });

  describe('Volume Graph Data Management', () => {
    it('should store volume data', async () => {
      const volumeData = [{
        poolHash: 'abc123',
        duration: '1h' as const,
        startTime: Math.floor(Date.now() / 1000),
        endTime: Math.floor(Date.now() / 1000) + 3600,
        midTime: Math.floor(Date.now() / 1000) + 1800,
        volume: 1000.50,
        isComplete: true
      }];

      await persistenceService.storeVolumeData(volumeData);

      const storedData = await persistenceService.getVolumeData({
        poolHash: 'abc123',
        duration: '1h',
        startTime: Math.floor(Date.now() / 1000) - 3600,
        endTime: Math.floor(Date.now() / 1000)
      });

      expect(storedData).toHaveLength(1);
      expect(storedData[0].volume).toBe(1000.50);
    });

    it('should handle duplicate volume data gracefully', async () => {
      const volumeData = {
        poolHash: 'abc123',
        duration: '1h' as const,
        startTime: 1640995200,
        endTime: 1640998800,
        midTime: 1640997000,
        volume: 1000.50,
        isComplete: true
      };

      // Store same data twice
      await persistenceService.storeVolumeData([volumeData]);
      await persistenceService.storeVolumeData([volumeData]);

      const storedData = await persistenceService.getVolumeData({
        poolHash: 'abc123',
        duration: '1h',
        startTime: 1640991600,
        endTime: 1640998800
      });

      // Should only have one record due to unique constraint
      expect(storedData).toHaveLength(1);
    });
  });

  describe('Volume Pattern Management', () => {
    it('should store volume pattern', async () => {
      const patternData = {
        type: 'accumulation',
        confidence: 0.85,
        duration: 1800, // 30 minutes
        volumeIncrease: 2.5,
        details: { trend: 'bullish' }
      };

      const pattern = await persistenceService.storeVolumePattern({
        poolHash: 'abc123',
        patternType: 'accumulation',
        confidence: 0.85,
        patternData: {
          startTime: Date.now(),
          endTime: Date.now() + 1800000,
          baselineVolume: 100,
          peakVolume: 285,
          volumeRatio: 2.85,
          duration: 1800,
          timeframe: '30m',
          supportingIndicators: ['volume_surge', 'price_support']
        },
        strength: 0.85,
        marketRegime: 'trending',
        detectedAtTimestamp: Date.now()
      });

      const patterns = await persistenceService.getActivePatterns('abc123');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].patternType).toBe('accumulation');
      expect(patterns[0].confidence).toBe(0.85);
    });

    it('should get recent patterns across all pools', async () => {
      await persistenceService.storeVolumePattern({
        poolHash: 'pool1',
        patternType: 'breakout',
        confidence: 0.9,
        patternData: {
          startTime: Date.now(),
          endTime: Date.now() + 3600000,
          baselineVolume: 200,
          peakVolume: 580,
          volumeRatio: 2.9,
          duration: 3600,
          timeframe: '1h',
          supportingIndicators: ['breakout_volume']
        },
        strength: 0.9,
        marketRegime: 'trending',
        detectedAtTimestamp: Date.now()
      });
      await persistenceService.storeVolumePattern({
        poolHash: 'pool2',
        patternType: 'consolidation',
        confidence: 0.7,
        patternData: {
          startTime: Date.now(),
          endTime: Date.now() + 7200000,
          baselineVolume: 150,
          peakVolume: 255,
          volumeRatio: 1.7,
          duration: 7200,
          timeframe: '2h',
          supportingIndicators: ['consolidation_pattern']
        },
        strength: 0.7,
        marketRegime: 'ranging',
        detectedAtTimestamp: Date.now()
      });

      const pool1Patterns = await persistenceService.getActivePatterns('pool1');
      const pool2Patterns = await persistenceService.getActivePatterns('pool2');
      const recentPatterns = [...pool1Patterns, ...pool2Patterns];
      expect(recentPatterns).toHaveLength(2);
    });
  });

  describe('Transaction Cache Management', () => {
    it('should store and retrieve cached transactions', async () => {
      const cacheKey = 'pool_transactions:abc123:page1';
      const transactionData = [
        { id: 'tx1', amount: '100', type: 'swap' },
        { id: 'tx2', amount: '200', type: 'add_liquidity' }
      ];

      await persistenceService.storeTransactionCache({
        cacheKey,
        poolHash: 'abc123',
        queryParams: { limit: 50, offset: 0 },
        transactionData: transactionData.map((tx, i) => ({
          id: i + 1,
          blockNumber: i + 1000,
          poolHash: 'abc123',
          userAddress: 'user1',
          transactionTime: '2023-01-01',
          token0: 'GALA',
          token1: 'USDC',
          amount0: 100,
          amount1: 100,
          volume: 100,
          type: tx.type
        })),
        totalCount: transactionData.length,
        returnedCount: transactionData.length,
        isComplete: true,
        apiResponseTime: 250,
        expiresAt: new Date(Date.now() + 300 * 1000),
        lastAccessedAt: new Date()
      });

      const cachedData = await persistenceService.getCachedTransactions(cacheKey);
      expect(cachedData).toBeDefined();
      expect(cachedData!.transactionData[0].id).toBe(1);
      expect(cachedData!.transactionData[0].type).toBe('swap');
    });

    it('should not return expired cache', async () => {
      const cacheKey = 'expired_test';
      const transactionData = [{ id: 'tx1', type: 'swap' }];

      await persistenceService.storeTransactionCache({
        cacheKey,
        poolHash: 'expired_test',
        queryParams: { limit: 10 },
        transactionData: transactionData.map((tx, i) => ({
          id: i + 1,
          blockNumber: i + 1000,
          poolHash: 'expired_test',
          userAddress: 'user1',
          transactionTime: '2023-01-01',
          token0: 'GALA',
          token1: 'USDC',
          amount0: 100,
          amount1: 100,
          volume: 100,
          type: tx.type
        })),
        totalCount: 1,
        returnedCount: 1,
        isComplete: true,
        apiResponseTime: 100,
        expiresAt: new Date(Date.now() - 1000), // Already expired
        lastAccessedAt: new Date()
      });

      const cachedData = await persistenceService.getCachedTransactions(cacheKey);
      expect(cachedData).toBeNull();
    });

    it('should cleanup expired cache entries', async () => {
      // Store expired and valid cache entries
      await persistenceService.storeTransactionCache({
        cacheKey: 'expired1',
        poolHash: 'expired1',
        queryParams: { limit: 10 },
        transactionData: [{
          id: 1, blockNumber: 1000, poolHash: 'expired1', userAddress: 'user1',
          transactionTime: '2023-01-01', token0: 'GALA', token1: 'USDC',
          amount0: 100, amount1: 100, volume: 100
        }],
        totalCount: 1, returnedCount: 1, isComplete: true, apiResponseTime: 100,
        expiresAt: new Date(Date.now() - 1000),
        lastAccessedAt: new Date()
      });
      await persistenceService.storeTransactionCache({
        cacheKey: 'expired2',
        poolHash: 'expired2',
        queryParams: { limit: 10 },
        transactionData: [{
          id: 2, blockNumber: 2000, poolHash: 'expired2', userAddress: 'user2',
          transactionTime: '2023-01-01', token0: 'GALA', token1: 'USDC',
          amount0: 200, amount1: 200, volume: 200
        }],
        totalCount: 1, returnedCount: 1, isComplete: true, apiResponseTime: 100,
        expiresAt: new Date(Date.now() - 1000),
        lastAccessedAt: new Date()
      });
      await persistenceService.storeTransactionCache({
        cacheKey: 'valid',
        poolHash: 'valid',
        queryParams: { limit: 10 },
        transactionData: [{
          id: 3, blockNumber: 3000, poolHash: 'valid', userAddress: 'user3',
          transactionTime: '2023-01-01', token0: 'GALA', token1: 'USDC',
          amount0: 300, amount1: 300, volume: 300
        }],
        totalCount: 1, returnedCount: 1, isComplete: true, apiResponseTime: 100,
        expiresAt: new Date(Date.now() + 300 * 1000),
        lastAccessedAt: new Date()
      });

      const cleanedCount = await persistenceService.cleanupExpiredCache();
      expect(cleanedCount).toBe(2);

      // Valid cache should still exist
      const validCache = await persistenceService.getCachedTransactions('valid');
      expect(validCache).toBeDefined();
    });
  });

  describe('Analytics Snapshot Management', () => {
    it('should create analytics snapshot', async () => {
      const snapshotData = {
        system_health: { memory_usage: 0.65, cpu_usage: 0.45 },
        trading_performance: { profit_loss: 150.50, win_rate: 0.75 },
        whale_tracking: { alert_counts: 5, success_rates: 0.80 }
      };

      await persistenceService.createAnalyticsSnapshot('hourly', {
        whaleTracking: {
          totalWhales: 10,
          activeWhales: 8,
          highPriorityWhales: 3,
          totalAlerts: 5,
          processedAlerts: 4,
          alertsByType: { large_trade: 3, volume_spike: 2 },
          averageSuccessRate: 0.80,
          topPerformingWhales: []
        },
        volumeAnalysis: {
          totalVolumeDataPoints: 1000,
          uniquePools: 5,
          averageDailyVolume: 50000,
          volumeGrowthRate: 0.15,
          patternsDetected: 12,
          patternsByType: { accumulation: 6, breakout: 6 },
          predictionAccuracy: { overall: 0.75, byTimeframe: {}, byPatternType: {} }
        },
        cachePerformance: {
          transactionCacheHits: 150,
          transactionCacheMisses: 50,
          volumeDataCacheHits: 100,
          volumeDataCacheMisses: 25,
          averageApiResponseTime: 200,
          cacheEfficiencyRatio: 0.75,
          totalCacheSize: 1024000,
          cacheCleanupEvents: 3
        },
        systemHealth: {
          uptime: 86400,
          memoryUsage: { heapUsed: 67108864, heapTotal: 134217728, external: 8388608, rss: 167772160 },
          apiCallCounts: { quote: 100, swap: 50 },
          errorCounts: { timeout: 2, invalid: 1 },
          processingLatencies: { average: 150 },
          databaseConnectionPool: { active: 5, idle: 10, total: 15 }
        },
        tradingPerformance: {
          totalOpportunities: 20,
          opportunitiesTaken: 15,
          successfulTrades: 12,
          totalProfit: 150.50,
          winRate: 0.75,
          averageProfit: 12.54,
          largestWin: 50.0,
          largestLoss: -10.0
        }
      });

      const snapshots = await persistenceService.getLatestSnapshots('hourly', 1);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].snapshotType).toBe('hourly');
      expect(snapshots[0].systemHealth.uptime).toBe(86400);
    });

    it('should get latest snapshots by type', async () => {
      // Create multiple snapshots
      await persistenceService.createAnalyticsSnapshot('hourly', {
        whaleTracking: {
          totalWhales: 1, activeWhales: 1, highPriorityWhales: 0, totalAlerts: 0,
          processedAlerts: 0, alertsByType: {}, averageSuccessRate: 0, topPerformingWhales: []
        },
        volumeAnalysis: {
          totalVolumeDataPoints: 0, uniquePools: 0, averageDailyVolume: 0, volumeGrowthRate: 0,
          patternsDetected: 0, patternsByType: {}, predictionAccuracy: { overall: 0, byTimeframe: {}, byPatternType: {} }
        },
        cachePerformance: {
          transactionCacheHits: 0, transactionCacheMisses: 0, volumeDataCacheHits: 0, volumeDataCacheMisses: 0,
          averageApiResponseTime: 0, cacheEfficiencyRatio: 0, totalCacheSize: 0, cacheCleanupEvents: 0
        },
        systemHealth: {
          uptime: 1, memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 },
          apiCallCounts: {}, errorCounts: {}, processingLatencies: {}, databaseConnectionPool: { active: 0, idle: 0, total: 0 }
        }
      });
      await persistenceService.createAnalyticsSnapshot('daily', {
        whaleTracking: {
          totalWhales: 2, activeWhales: 2, highPriorityWhales: 0, totalAlerts: 0,
          processedAlerts: 0, alertsByType: {}, averageSuccessRate: 0, topPerformingWhales: []
        },
        volumeAnalysis: {
          totalVolumeDataPoints: 0, uniquePools: 0, averageDailyVolume: 0, volumeGrowthRate: 0,
          patternsDetected: 0, patternsByType: {}, predictionAccuracy: { overall: 0, byTimeframe: {}, byPatternType: {} }
        },
        cachePerformance: {
          transactionCacheHits: 0, transactionCacheMisses: 0, volumeDataCacheHits: 0, volumeDataCacheMisses: 0,
          averageApiResponseTime: 0, cacheEfficiencyRatio: 0, totalCacheSize: 0, cacheCleanupEvents: 0
        },
        systemHealth: {
          uptime: 2, memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 },
          apiCallCounts: {}, errorCounts: {}, processingLatencies: {}, databaseConnectionPool: { active: 0, idle: 0, total: 0 }
        }
      });
      await persistenceService.createAnalyticsSnapshot('hourly', {
        whaleTracking: {
          totalWhales: 3, activeWhales: 3, highPriorityWhales: 0, totalAlerts: 0,
          processedAlerts: 0, alertsByType: {}, averageSuccessRate: 0, topPerformingWhales: []
        },
        volumeAnalysis: {
          totalVolumeDataPoints: 0, uniquePools: 0, averageDailyVolume: 0, volumeGrowthRate: 0,
          patternsDetected: 0, patternsByType: {}, predictionAccuracy: { overall: 0, byTimeframe: {}, byPatternType: {} }
        },
        cachePerformance: {
          transactionCacheHits: 0, transactionCacheMisses: 0, volumeDataCacheHits: 0, volumeDataCacheMisses: 0,
          averageApiResponseTime: 0, cacheEfficiencyRatio: 0, totalCacheSize: 0, cacheCleanupEvents: 0
        },
        systemHealth: {
          uptime: 3, memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 },
          apiCallCounts: {}, errorCounts: {}, processingLatencies: {}, databaseConnectionPool: { active: 0, idle: 0, total: 0 }
        }
      });

      const hourlySnapshots = await persistenceService.getLatestSnapshots('hourly', 10);
      expect(hourlySnapshots).toHaveLength(2);
      expect(hourlySnapshots[0].systemHealth.uptime).toBe(3); // Latest first
    });
  });

  describe('Health and Statistics', () => {
    it('should return database health status', async () => {
      const health = await persistenceService.getStats();

      expect(health.totalRecords).toBeGreaterThanOrEqual(0);
      expect(health.whales).toBeGreaterThanOrEqual(0);
      expect(health.cacheEfficiency).toBeGreaterThanOrEqual(0);
    });

    it('should return statistics', async () => {
      // Add some test data
      await persistenceService.addWhaleToWatchlist('client|whale1', 'high');
      await persistenceService.createWhaleAlert('client|whale1', 'large_trade', 'warning', {});
      await persistenceService.storeVolumeData([{
        poolHash: 'pool1',
        duration: '1h',
        startTime: Math.floor(Date.now() / 1000),
        endTime: Math.floor(Date.now() / 1000) + 3600,
        midTime: Math.floor(Date.now() / 1000) + 1800,
        volume: 1000,
        isComplete: true
      }]);

      const stats = await persistenceService.getStats();

      expect(stats.whales).toBe(1);
      expect(stats.alerts).toBe(1);
      expect(stats.volumeData).toBe(1);
      expect(stats.cacheEfficiency).toBe(0); // No cache operations yet
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid whale address gracefully', async () => {
      await expect(
        persistenceService.addWhaleToWatchlist('', 'high')
      ).rejects.toThrow();
    });

    it('should handle database errors gracefully', async () => {
      // Close the connection to simulate database error
      await dataSource.destroy();

      await expect(
        persistenceService.getWhales({ isActive: true })
      ).rejects.toThrow();

      // Reinitialize for cleanup
      await dataSource.initialize();
    });
  });
});