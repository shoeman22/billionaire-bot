/**
 * WhaleTracker Tests
 *
 * Tests for the whale tracking and analysis service.
 */

import { WhaleTracker } from '../../analytics/whale-tracker';
import { jest } from '@jest/globals';

// Mock dependencies
const mockHistoryClient = {
  getRecentTransactions: jest.fn() as jest.MockedFunction<() => Promise<any[]>>,
  getUserHistory: jest.fn() as jest.MockedFunction<(user: string, options?: any) => Promise<any[]>>,
  clearCache: jest.fn() as jest.MockedFunction<() => void>
};

const mockPersistenceService = {
  addWhaleToWatchlist: jest.fn() as jest.MockedFunction<(addr: string, notes: string) => Promise<boolean>>,
  removeWhaleFromWatchlist: jest.fn() as jest.MockedFunction<(addr: string) => Promise<boolean>>,
  getActiveWhales: jest.fn() as jest.MockedFunction<() => Promise<any[]>>,
  createWhaleAlert: jest.fn() as jest.MockedFunction<(...args: any[]) => Promise<boolean>>,
  isHealthy: jest.fn() as jest.MockedFunction<() => Promise<boolean>>
};

describe('WhaleTracker', () => {
  let whaleTracker: WhaleTracker;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup basic mocks
    mockHistoryClient.getRecentTransactions.mockResolvedValue([]);
    mockHistoryClient.getUserHistory.mockResolvedValue([]);
    mockHistoryClient.clearCache.mockImplementation(() => {});
    mockPersistenceService.addWhaleToWatchlist.mockResolvedValue(true);
    mockPersistenceService.removeWhaleFromWatchlist.mockResolvedValue(true);
    mockPersistenceService.getActiveWhales.mockResolvedValue([]);
    mockPersistenceService.createWhaleAlert.mockResolvedValue(true);
    mockPersistenceService.isHealthy.mockResolvedValue(true);

    whaleTracker = new WhaleTracker(
      mockHistoryClient as any,
      mockPersistenceService as any
    );
  });

  describe('Initialization', () => {
    it('should initialize with persistence service', () => {
      expect(whaleTracker).toBeDefined();
    });

    it('should work without persistence service (fallback mode)', () => {
      const fallbackTracker = new WhaleTracker(mockHistoryClient as any);
      expect(fallbackTracker).toBeDefined();
    });
  });

  describe('Whale Watchlist Management', () => {
    it('should add whale to watchlist', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';
      const notes = 'High volume trader';

      await whaleTracker.addToWatchlist(whaleAddress, notes);

      expect(mockPersistenceService.addWhaleToWatchlist).toHaveBeenCalledWith(
        whaleAddress,
        notes
      );
    });

    it('should remove whale from watchlist', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      await whaleTracker.removeFromWatchlist(whaleAddress);

      expect(mockPersistenceService.removeWhaleFromWatchlist).toHaveBeenCalledWith(whaleAddress);
    });

    it('should get watchlist data', () => {
      const watchlist = whaleTracker.getWatchlist();

      expect(watchlist).toBeDefined();
      expect(Array.isArray(watchlist)).toBe(true);
    });

    it('should get recent alerts', () => {
      const recentAlerts = whaleTracker.getRecentAlerts(24);

      expect(Array.isArray(recentAlerts)).toBe(true);
    });
  });

  describe('Alert Management', () => {
    it('should check for new alerts', async () => {
      const alerts = await whaleTracker.checkForAlerts();

      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should get recent alerts with custom time period', () => {
      const alerts = whaleTracker.getRecentAlerts(6); // Last 6 hours

      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('Portfolio Analysis', () => {
    it('should get whale portfolio', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      // Mock transaction history for portfolio calculation
      mockHistoryClient.getRecentTransactions.mockResolvedValue([
        {
          user: whaleAddress,
          poolHash: 'pool123',
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          amountIn: '1000',
          amountOut: '950',
          timestamp: new Date()
        }
      ]);

      const portfolio = await whaleTracker.getWhalePortfolio(whaleAddress);

      expect(portfolio).toBeDefined();
      expect(portfolio.whaleAddress).toBe(whaleAddress);
      expect(Array.isArray(portfolio.positions)).toBe(true);
    });

    it('should get whale performance metrics', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      const performance = await whaleTracker.getWhalePerformance(whaleAddress);

      expect(performance).toBeDefined();
      expect(performance.totalVolume).toBeDefined();
      expect(performance.averageProfit).toBeDefined();
      expect(performance.winRate).toBeDefined();
    });
  });

  describe('Statistics', () => {
    it('should get basic statistics', () => {
      const stats = whaleTracker.getStats();

      expect(stats).toBeDefined();
      expect(stats.watchlistSize).toBeDefined();
      expect(stats.totalAlerts).toBeDefined();
      expect(stats.recentAlerts).toBeDefined();
    });

    it('should clear cache', () => {
      expect(() => whaleTracker.clearCache()).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing transaction data gracefully', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';

      mockHistoryClient.getRecentTransactions.mockResolvedValue([]);

      await expect(whaleTracker.getWhalePortfolio(whaleAddress))
        .resolves.toBeDefined();
    });

    it('should handle persistence service failures', async () => {
      mockPersistenceService.addWhaleToWatchlist.mockRejectedValue(new Error('DB error'));

      // Should not throw - should handle gracefully
      await expect(whaleTracker.addToWatchlist('client|test', 'test'))
        .resolves.not.toThrow();
    });

    it('should work without persistence service', async () => {
      const trackerWithoutPersistence = new WhaleTracker(mockHistoryClient as any);

      // Should still work with local state only
      await expect(trackerWithoutPersistence.addToWatchlist('client|test', 'test'))
        .resolves.not.toThrow();

      const watchlist = trackerWithoutPersistence.getWatchlist();
      expect(Array.isArray(watchlist)).toBe(true);
    });
  });
});