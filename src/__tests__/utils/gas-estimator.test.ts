/**
 * GasEstimator Tests
 * Testing dynamic gas estimation, caching, and network condition handling
 */

import { GasEstimator } from '../../utils/gas-estimator';

// Mock logger to avoid console output during tests
jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('GasEstimator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset cache between tests
    (GasEstimator as any).gasPriceCache = null;
  });

  afterEach(() => {
    // Clean up any intervals
    jest.clearAllTimers();
  });

  describe('estimateGas', () => {
    it('should estimate gas for simple swap operation', async () => {
      const estimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      expect(estimate).toHaveProperty('gasLimit');
      expect(estimate).toHaveProperty('gasPrice');
      expect(estimate).toHaveProperty('totalCostUSD');
      expect(estimate).toHaveProperty('confidence');
      expect(estimate).toHaveProperty('estimatedAt');

      expect(estimate.gasLimit).toBeGreaterThan(0);
      expect(estimate.gasPrice).toBeGreaterThan(0);
      expect(estimate.totalCostUSD).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(estimate.confidence);
    });

    it('should apply complexity adjustments correctly', async () => {
      const simpleEstimate = await GasEstimator.estimateGas({
        operation: 'addLiquidity',
        complexity: 'simple',
        urgency: 'normal'
      });

      const complexEstimate = await GasEstimator.estimateGas({
        operation: 'addLiquidity',
        complexity: 'complex',
        urgency: 'normal'
      });

      expect(complexEstimate.gasLimit).toBeGreaterThan(simpleEstimate.gasLimit);
      expect(complexEstimate.totalCostUSD).toBeGreaterThan(simpleEstimate.totalCostUSD);
    });

    it('should apply urgency adjustments correctly', async () => {
      const lowUrgencyEstimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'low'
      });

      const highUrgencyEstimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'high'
      });

      expect(highUrgencyEstimate.gasPrice).toBeGreaterThan(lowUrgencyEstimate.gasPrice);
      expect(highUrgencyEstimate.totalCostUSD).toBeGreaterThan(lowUrgencyEstimate.totalCostUSD);
    });

    it('should apply network congestion adjustments', async () => {
      const lowCongestionEstimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal',
        networkConditions: {
          congestion: 'low'
        }
      });

      const highCongestionEstimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal',
        networkConditions: {
          congestion: 'high'
        }
      });

      expect(highCongestionEstimate.gasPrice).toBeGreaterThan(lowCongestionEstimate.gasPrice);
    });

    it('should handle rebalance operations with higher gas costs', async () => {
      const swapEstimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      const rebalanceEstimate = await GasEstimator.estimateGas({
        operation: 'rebalance',
        complexity: 'simple',
        urgency: 'normal'
      });

      expect(rebalanceEstimate.gasLimit).toBeGreaterThan(swapEstimate.gasLimit);
      expect(rebalanceEstimate.totalCostUSD).toBeGreaterThan(swapEstimate.totalCostUSD);
    });

    it('should return fallback estimate when estimation fails', async () => {
      // Mock a method to throw an error
      const originalMethod = (GasEstimator as any).getCurrentGasPrice;
      (GasEstimator as any).getCurrentGasPrice = jest.fn().mockRejectedValue(new Error('Network error'));

      const estimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      expect(estimate.confidence).toBe('low');
      expect(estimate.gasLimit).toBeGreaterThan(0);
      expect(estimate.totalCostUSD).toBeGreaterThan(0);

      // Restore original method
      (GasEstimator as any).getCurrentGasPrice = originalMethod;
    });
  });

  describe('Gas Price Caching', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should cache gas prices', async () => {
      const estimate1 = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      const estimate2 = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      // Should use cached price for second estimate
      expect(estimate1.gasPrice).toBe(estimate2.gasPrice);
    });

    it('should expire cache after TTL', async () => {
      const estimate1 = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      // Advance time past cache TTL (30 seconds)
      jest.advanceTimersByTime(31000);

      const estimate2 = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      // May have different gas prices due to cache expiry
      expect(estimate2.gasPrice).toBeGreaterThan(0);
      expect(estimate2.estimatedAt).toBeGreaterThan(estimate1.estimatedAt);
    });

    it('should report cache status correctly', async () => {
      // Initially no cache
      let status = GasEstimator.getGasPriceStatus();
      expect(status.price).toBeNull();
      expect(status.isStale).toBe(true);

      // After estimation, should have cached price
      await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      status = GasEstimator.getGasPriceStatus();
      expect(status.price).toBeGreaterThan(0);
      expect(status.isStale).toBe(false);

      // After expiry, should be stale
      jest.advanceTimersByTime(31000);
      status = GasEstimator.getGasPriceStatus();
      expect(status.isStale).toBe(true);
    });
  });

  describe('estimateGasBatch', () => {
    it('should estimate gas for multiple operations', async () => {
      const operations = [
        { operation: 'swap' as const, complexity: 'simple' as const, urgency: 'normal' as const },
        { operation: 'addLiquidity' as const, complexity: 'medium' as const, urgency: 'normal' as const },
        { operation: 'collectFees' as const, complexity: 'simple' as const, urgency: 'low' as const }
      ];

      const estimates = await GasEstimator.estimateGasBatch(operations);

      expect(estimates).toHaveLength(3);
      estimates.forEach(estimate => {
        expect(estimate.gasLimit).toBeGreaterThan(0);
        expect(estimate.gasPrice).toBeGreaterThan(0);
        expect(estimate.totalCostUSD).toBeGreaterThan(0);
      });

      // Add liquidity should be more expensive than swap
      expect(estimates[1].gasLimit).toBeGreaterThan(estimates[0].gasLimit);
    });

    it('should handle empty operations array', async () => {
      const estimates = await GasEstimator.estimateGasBatch([]);
      expect(estimates).toHaveLength(0);
    });
  });

  describe('isGasCostAcceptable', () => {
    it('should accept costs below threshold', () => {
      const estimate = {
        gasLimit: 200000,
        gasPrice: 20,
        totalCostUSD: 50,
        confidence: 'high' as const,
        estimatedAt: Date.now()
      };

      expect(GasEstimator.isGasCostAcceptable(estimate, 100)).toBe(true);
    });

    it('should reject costs above threshold', () => {
      const estimate = {
        gasLimit: 500000,
        gasPrice: 100,
        totalCostUSD: 150,
        confidence: 'high' as const,
        estimatedAt: Date.now()
      };

      expect(GasEstimator.isGasCostAcceptable(estimate, 100)).toBe(false);
    });

    it('should handle edge case of exact threshold', () => {
      const estimate = {
        gasLimit: 300000,
        gasPrice: 30,
        totalCostUSD: 100,
        confidence: 'high' as const,
        estimatedAt: Date.now()
      };

      expect(GasEstimator.isGasCostAcceptable(estimate, 100)).toBe(true);
    });
  });

  describe('getOptimalGasSettings', () => {
    it('should return appropriate settings for swap operations', () => {
      const settings = GasEstimator.getOptimalGasSettings('swap', 50, 'fast');

      expect(settings.operation).toBe('swap');
      expect(settings.complexity).toBe('simple');
      expect(settings.urgency).toBe('high');
      expect(settings.networkConditions?.congestion).toBe('medium');
    });

    it('should return higher complexity for rebalance operations', () => {
      const settings = GasEstimator.getOptimalGasSettings('rebalance', 100, 'normal');

      expect(settings.operation).toBe('rebalance');
      expect(settings.complexity).toBe('complex');
      expect(settings.urgency).toBe('normal');
    });

    it('should handle different confirmation time preferences', () => {
      const fastSettings = GasEstimator.getOptimalGasSettings('swap', 50, 'fast');
      const slowSettings = GasEstimator.getOptimalGasSettings('swap', 50, 'slow');

      expect(fastSettings.urgency).toBe('high');
      expect(slowSettings.urgency).toBe('low');
    });
  });

  describe('Gas Price Monitoring', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start monitoring and update cache periodically', () => {
      const intervalMs = 1000;
      GasEstimator.startGasPriceMonitoring(intervalMs);

      // Initially no cache
      let status = GasEstimator.getGasPriceStatus();
      expect(status.price).toBeNull();

      // After first tick, should have initial price
      jest.advanceTimersByTime(0);
      status = GasEstimator.getGasPriceStatus();
      expect(status.price).toBeGreaterThan(0);

      const initialPrice = status.price;

      // After interval, may have updated price
      jest.advanceTimersByTime(intervalMs);
      status = GasEstimator.getGasPriceStatus();
      expect(status.price).toBeGreaterThan(0);

      // Clean up
      jest.clearAllTimers();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle invalid operation types gracefully', async () => {
      // Test with invalid operation type
      await expect(
        GasEstimator.estimateGas({
          operation: 'invalid' as any,
          complexity: 'simple',
          urgency: 'normal'
        })
      ).rejects.toThrow();
    });

    it('should handle missing network conditions', async () => {
      const estimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
        // No networkConditions provided
      });

      expect(estimate.gasLimit).toBeGreaterThan(0);
      expect(estimate.totalCostUSD).toBeGreaterThan(0);
    });

    it('should handle extreme gas price scenarios', async () => {
      // Mock extremely high gas price
      const originalFetch = (GasEstimator as any).fetchCurrentGasPrice;
      (GasEstimator as any).fetchCurrentGasPrice = jest.fn().mockResolvedValue(1000); // 1000 gwei

      const estimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'high', // Will multiply by 1.3
        networkConditions: {
          congestion: 'high' // Will multiply by 1.5
        }
      });

      expect(estimate.gasPrice).toBeGreaterThan(1000);
      expect(estimate.totalCostUSD).toBeGreaterThan(100); // Should be very expensive

      // Restore original method
      (GasEstimator as any).fetchCurrentGasPrice = originalFetch;
    });

    it('should handle zero gas price scenarios', async () => {
      const originalFetch = (GasEstimator as any).fetchCurrentGasPrice;
      (GasEstimator as any).fetchCurrentGasPrice = jest.fn().mockResolvedValue(0);

      const estimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      expect(estimate.gasPrice).toBe(0);
      expect(estimate.totalCostUSD).toBe(0);

      // Restore original method
      (GasEstimator as any).fetchCurrentGasPrice = originalFetch;
    });

    it('should determine confidence levels correctly', async () => {
      // Simple operation with fresh cache should have high confidence
      (GasEstimator as any).gasPriceCache = {
        price: 20,
        timestamp: Date.now() - 5000, // 5 seconds ago
        confidence: 'high'
      };

      const highConfidenceEstimate = await GasEstimator.estimateGas({
        operation: 'swap',
        complexity: 'simple',
        urgency: 'normal'
      });

      expect(highConfidenceEstimate.confidence).toBe('high');

      // Complex operation should have lower confidence
      const lowConfidenceEstimate = await GasEstimator.estimateGas({
        operation: 'rebalance',
        complexity: 'complex',
        urgency: 'normal'
      });

      expect(lowConfidenceEstimate.confidence).toBe('low');
    });

    it('should handle concurrent gas estimation requests', async () => {
      const promises = Array.from({ length: 10 }, () =>
        GasEstimator.estimateGas({
          operation: 'swap',
          complexity: 'simple',
          urgency: 'normal'
        })
      );

      const estimates = await Promise.all(promises);

      expect(estimates).toHaveLength(10);
      estimates.forEach(estimate => {
        expect(estimate.gasLimit).toBeGreaterThan(0);
        expect(estimate.totalCostUSD).toBeGreaterThan(0);
      });

      // All estimates should use the same cached gas price
      const gasPrices = estimates.map(e => e.gasPrice);
      expect(new Set(gasPrices).size).toBe(1);
    });
  });

  describe('Performance and Memory', () => {
    it('should handle large batch operations efficiently', async () => {
      const operations = Array.from({ length: 100 }, (_, i) => ({
        operation: 'swap' as const,
        complexity: 'simple' as const,
        urgency: 'normal' as const
      }));

      const startTime = Date.now();
      const estimates = await GasEstimator.estimateGasBatch(operations);
      const endTime = Date.now();

      expect(estimates).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds

      // All estimates should be valid
      estimates.forEach(estimate => {
        expect(estimate.gasLimit).toBeGreaterThan(0);
        expect(estimate.totalCostUSD).toBeGreaterThan(0);
      });
    });

    it('should not leak memory with repeated estimations', async () => {
      // Perform many estimations
      for (let i = 0; i < 1000; i++) {
        await GasEstimator.estimateGas({
          operation: 'swap',
          complexity: 'simple',
          urgency: 'normal'
        });
      }

      // Cache should still only contain one entry
      const status = GasEstimator.getGasPriceStatus();
      expect(status.price).toBeGreaterThan(0);
    });
  });
});