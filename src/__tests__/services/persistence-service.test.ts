/**
 * PersistenceService Test Suite
 *
 * Tests the core database persistence service that handles all
 * analytics data storage, caching, and retrieval operations.
 */

import { DataSource } from 'typeorm';
import { PersistenceService } from '../../services/persistence-service';
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
    // Create in-memory SQLite database for testing
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [
        WhaleWatchlist,
        WhaleAlert,
        VolumeGraphData,
        VolumePattern,
        TransactionCache,
        AnalyticsSnapshot
      ],
      synchronize: true,
      logging: false
    });

    await dataSource.initialize();
    persistenceService = new PersistenceService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // Clear all tables before each test
    await dataSource.query('DELETE FROM whale_watchlist');
    await dataSource.query('DELETE FROM whale_alerts');
    await dataSource.query('DELETE FROM volume_graph_data');
    await dataSource.query('DELETE FROM volume_patterns');
    await dataSource.query('DELETE FROM transaction_cache');
    await dataSource.query('DELETE FROM analytics_snapshots');
  });

  describe('Whale Watchlist Management', () => {
    it('should add whale to watchlist', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      await persistenceService.addWhaleToWatchlist(whaleAddress, 'high');

      const whale = await persistenceService.getWhaleFromWatchlist(whaleAddress);
      expect(whale).toBeDefined();
      expect(whale!.whaleAddress).toBe(whaleAddress);
      expect(whale!.priority).toBe('high');
      expect(whale!.isActive).toBe(true);
    });

    it('should update whale priority', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      await persistenceService.addWhaleToWatchlist(whaleAddress, 'medium');
      await persistenceService.updateWhaleWatchlist(whaleAddress, { priority: 'critical' });

      const whale = await persistenceService.getWhaleFromWatchlist(whaleAddress);
      expect(whale!.priority).toBe('critical');
    });

    it('should remove whale from watchlist', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      await persistenceService.addWhaleToWatchlist(whaleAddress, 'high');
      await persistenceService.removeWhaleFromWatchlist(whaleAddress);

      const whale = await persistenceService.getWhaleFromWatchlist(whaleAddress);
      expect(whale).toBeNull();
    });

    it('should get all active whales', async () => {
      await persistenceService.addWhaleToWatchlist('client|whale1', 'high');
      await persistenceService.addWhaleToWatchlist('client|whale2', 'medium');
      await persistenceService.addWhaleToWatchlist('client|whale3', 'low');

      // Deactivate one whale
      await persistenceService.updateWhaleWatchlist('client|whale2', { isActive: false });

      const activeWhales = await persistenceService.getActiveWhales();
      expect(activeWhales).toHaveLength(2);
      expect(activeWhales.find(w => w.whaleAddress === 'client|whale2')).toBeUndefined();
    });
  });

  describe('Whale Alert Management', () => {
    it('should create whale alert', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';
      const poolHash = 'abc123';

      await persistenceService.createWhaleAlert(
        whaleAddress,
        'large_transaction',
        'high',
        { amount: '1000', transaction_type: 'swap' },
        poolHash
      );

      const alerts = await persistenceService.getWhaleAlerts(whaleAddress);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].alertType).toBe('large_transaction');
      expect(alerts[0].severity).toBe('high');
      expect(alerts[0].alertData).toEqual({ amount: '1000', transaction_type: 'swap' });
    });

    it('should get recent whale alerts', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      // Create multiple alerts
      await persistenceService.createWhaleAlert(whaleAddress, 'large_transaction', 'high', {}, 'pool1');
      await persistenceService.createWhaleAlert(whaleAddress, 'pattern_change', 'medium', {}, 'pool2');

      const recentAlerts = await persistenceService.getRecentWhaleAlerts(24);
      expect(recentAlerts).toHaveLength(2);
      expect(recentAlerts[0].createdAt.getTime()).toBeGreaterThanOrEqual(recentAlerts[1].createdAt.getTime());
    });
  });

  describe('Volume Graph Data Management', () => {
    it('should store volume data', async () => {
      const volumeData = [{
        poolHash: 'abc123',
        resolution: '1h' as const,
        timestamp: Math.floor(Date.now() / 1000),
        volume: '1000.50',
        volumeUSD: '1000.50',
        txCount: 10,
        high: '1.10',
        low: '0.90',
        open: '1.00',
        close: '1.05'
      }];

      await persistenceService.storeVolumeData(volumeData);

      const storedData = await persistenceService.getVolumeData('abc123', '1h',
        Math.floor(Date.now() / 1000) - 3600, Math.floor(Date.now() / 1000));

      expect(storedData).toHaveLength(1);
      expect(storedData[0].volume).toBe('1000.50');
      expect(storedData[0].txCount).toBe(10);
    });

    it('should handle duplicate volume data gracefully', async () => {
      const volumeData = {
        poolHash: 'abc123',
        resolution: '1h' as const,
        timestamp: 1640995200, // Fixed timestamp
        volume: '1000.50',
        volumeUSD: '1000.50',
        txCount: 10,
        high: '1.10',
        low: '0.90',
        open: '1.00',
        close: '1.05'
      };

      // Store same data twice
      await persistenceService.storeVolumeData([volumeData]);
      await persistenceService.storeVolumeData([volumeData]);

      const storedData = await persistenceService.getVolumeData('abc123', '1h',
        1640991600, 1640998800);

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

      await persistenceService.storeVolumePattern('abc123', patternData as any, 'accumulation');

      const patterns = await persistenceService.getVolumePatterns('abc123', 24);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].patternType).toBe('accumulation');
      expect(patterns[0].confidence).toBe(0.85);
    });

    it('should get recent patterns across all pools', async () => {
      await persistenceService.storeVolumePattern('pool1', { type: 'breakout', confidence: 0.9 } as any, 'breakout');
      await persistenceService.storeVolumePattern('pool2', { type: 'consolidation', confidence: 0.7 } as any, 'consolidation');

      const recentPatterns = await persistenceService.getRecentVolumePatterns(24);
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

      await persistenceService.storeCachedTransactions(cacheKey, transactionData, 300); // 5 minutes TTL

      const cachedData = await persistenceService.getCachedTransactions(cacheKey);
      expect(cachedData).toBeDefined();
      expect(cachedData!.transactionData).toEqual(transactionData);
    });

    it('should not return expired cache', async () => {
      const cacheKey = 'expired_test';
      const transactionData = [{ id: 'tx1' }];

      await persistenceService.storeCachedTransactions(cacheKey, transactionData, -1); // Expired

      const cachedData = await persistenceService.getCachedTransactions(cacheKey);
      expect(cachedData).toBeNull();
    });

    it('should cleanup expired cache entries', async () => {
      // Store expired and valid cache entries
      await persistenceService.storeCachedTransactions('expired1', [{ id: 'tx1' }], -1);
      await persistenceService.storeCachedTransactions('expired2', [{ id: 'tx2' }], -1);
      await persistenceService.storeCachedTransactions('valid', [{ id: 'tx3' }], 300);

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

      await persistenceService.createAnalyticsSnapshot('hourly', snapshotData);

      const snapshots = await persistenceService.getAnalyticsSnapshots('hourly', 1);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].snapshotType).toBe('hourly');
      expect(snapshots[0].metricsData.system_health.memory_usage).toBe(0.65);
    });

    it('should get latest snapshots by type', async () => {
      // Create multiple snapshots
      await persistenceService.createAnalyticsSnapshot('hourly', { metric1: 1 });
      await persistenceService.createAnalyticsSnapshot('daily', { metric1: 2 });
      await persistenceService.createAnalyticsSnapshot('hourly', { metric1: 3 });

      const hourlySnapshots = await persistenceService.getAnalyticsSnapshots('hourly', 10);
      expect(hourlySnapshots).toHaveLength(2);
      expect(hourlySnapshots[0].metricsData.metric1).toBe(3); // Latest first
    });
  });

  describe('Health and Statistics', () => {
    it('should return database health status', async () => {
      const health = await persistenceService.getHealthStatus();

      expect(health.isConnected).toBe(true);
      expect(health.entityCounts).toBeDefined();
      expect(health.lastActivity).toBeInstanceOf(Date);
    });

    it('should return statistics', async () => {
      // Add some test data
      await persistenceService.addWhaleToWatchlist('client|whale1', 'high');
      await persistenceService.createWhaleAlert('client|whale1', 'large_transaction', 'high', {});
      await persistenceService.storeVolumeData([{
        poolHash: 'pool1',
        resolution: '1h',
        timestamp: Math.floor(Date.now() / 1000),
        volume: '1000',
        volumeUSD: '1000',
        txCount: 1,
        high: '1',
        low: '1',
        open: '1',
        close: '1'
      }]);

      const stats = await persistenceService.getStatistics();

      expect(stats.whaleWatchlistCount).toBe(1);
      expect(stats.alertCount).toBe(1);
      expect(stats.volumeDataPoints).toBe(1);
      expect(stats.cacheHitRate).toBe(0); // No cache operations yet
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
        persistenceService.getWhaleFromWatchlist('client|test')
      ).rejects.toThrow();

      // Reinitialize for cleanup
      await dataSource.initialize();
    });
  });
});