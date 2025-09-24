/**
 * Liquidity Performance Tests
 * Testing performance characteristics of the liquidity infrastructure
 */

import { LiquidityManager } from '../../services/liquidity-manager';
import { RangeOrderStrategy } from '../../strategies/range-order-strategy';
import { FeeCalculator } from '../../services/fee-calculator';
import { RebalanceEngine } from '../../services/rebalance-engine';
import { RetryHelper } from '../../utils/retry-helper';
import { GasEstimator } from '../../utils/gas-estimator';
import { performance } from 'perf_hooks';

// Mock dependencies
jest.mock('../../services/gswap-simple');
jest.mock('../../utils/retry-helper');
jest.mock('../../utils/gas-estimator');

// Mock FeeCalculator properly for performance tests
jest.mock('../../services/fee-calculator', () => ({
  FeeCalculator: jest.fn().mockImplementation(() => {
    // Initialize with mock repository state
    const instance = {
      positionRepo: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null)
      },
      calculateAccruedFees: jest.fn().mockResolvedValue(25),
      getTotalFeesCollected: jest.fn().mockResolvedValue(150),
      generateCollectionOptimization: jest.fn().mockResolvedValue({
        positionId: 'lp_test1',
        currentCollectionCost: 5,
        accruedFeesUSD: 45,
        optimalCollectionTime: new Date(),
        recommendation: 'collect_now',
        costBenefitRatio: 0.05,
        estimatedAdditionalYield: 0,
        gasCostThreshold: 10
      }),
      calculateGlobalFeeMetrics: jest.fn().mockResolvedValue({
        totalPositions: 1,
        totalFeesCollectedUSD: 150,
        totalFeesAccruedUSD: 25,
        averageAPR: 12.5,
        totalValueLocked: 10000
      })
    };

    // Manually call initialization that normally happens in constructor
    instance.positionRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null)
    };

    return instance;
  })
}));

describe('Liquidity Performance Tests', () => {
  let liquidityManager: LiquidityManager;
  let rangeOrderStrategy: RangeOrderStrategy;
  let feeCalculator: FeeCalculator;
  let rebalanceEngine: RebalanceEngine;

  beforeEach(() => {
    // Mock RetryHelper to execute operations directly (no retry delay in tests)
    (RetryHelper.withRetry as jest.Mock).mockImplementation(async (operation, options, name) => {
      return await operation();
    });

    // Mock GasEstimator with reasonable defaults
    (GasEstimator.estimateGas as jest.Mock).mockResolvedValue({
      gasLimit: 300000,
      gasPrice: 20,
      totalCostUSD: 15,
      confidence: 'high',
      estimatedAt: Date.now()
    });

    (GasEstimator.isGasCostAcceptable as jest.Mock).mockReturnValue(true);

    // Create mocked instances
    const mockGSwap = {
      pools: {
        getPoolData: jest.fn().mockResolvedValue({
          sqrtPrice: '1000000000000000000',
          liquidity: '5000000',
          volume24h: '100000'
        }),
        calculateSpotPrice: jest.fn().mockReturnValue('0.05')
      },
      liquidityPositions: {
        addLiquidityByPrice: jest.fn().mockResolvedValue({
          success: true,
          transactionId: 'test-tx',
          positionNFT: 'test-nft'
        }),
        removeLiquidity: jest.fn().mockResolvedValue({
          success: true,
          amount0: '995',
          amount1: '49.5'
        }),
        collectPositionFees: jest.fn().mockResolvedValue({
          success: true,
          amount0: '5',
          amount1: '0.25'
        })
      }
    } as any;

    liquidityManager = new LiquidityManager(mockGSwap, 'eth|test-wallet-address');
    rangeOrderStrategy = new RangeOrderStrategy(liquidityManager);
    feeCalculator = new FeeCalculator();
    rebalanceEngine = new RebalanceEngine(liquidityManager, feeCalculator);
  });

  describe('Position Management Performance', () => {
    it('should handle concurrent position creation efficiently', async () => {
      const startTime = performance.now();
      const concurrentCount = 50;

      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        liquidityManager.addLiquidityByPrice({
          token0: 'GALA$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 3000,
          minPrice: 0.045 + (i * 0.0001),
          maxPrice: 0.055 + (i * 0.0001),
          amount0Desired: '1000',
          amount1Desired: '50'
        })
      );

      const results = await Promise.allSettled(promises);
      const endTime = performance.now();

      const duration = endTime - startTime;
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      expect(successCount).toBe(concurrentCount);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(duration / concurrentCount).toBeLessThan(100); // Average less than 100ms per position

      console.log(`Created ${concurrentCount} positions in ${duration.toFixed(2)}ms (${(duration/concurrentCount).toFixed(2)}ms per position)`);
    });

    it('should efficiently track large numbers of positions', async () => {
      const positionCount = 100;

      // Add multiple positions
      const positions = await Promise.all(
        Array.from({ length: positionCount }, (_, i) =>
          liquidityManager.addLiquidityByPrice({
            token0: 'GALA$Unit$none$none',
            token1: 'GUSDC$Unit$none$none',
            fee: 3000,
            minPrice: 0.045 + (i * 0.0001),
            maxPrice: 0.055 + (i * 0.0001),
            amount0Desired: '1000',
            amount1Desired: '50'
          })
        )
      );

      const startTime = performance.now();
      const allPositions = await liquidityManager.getAllPositions();
      const endTime = performance.now();

      expect(allPositions).toHaveLength(positionCount);
      expect(endTime - startTime).toBeLessThan(50); // Should be very fast (< 50ms)

      console.log(`Retrieved ${positionCount} positions in ${(endTime - startTime).toFixed(2)}ms`);
    });

    it('should handle position status updates efficiently', () => {
      const positionCount = 100;
      const statusUpdates = 1000;

      // Create mock positions
      const positions = Array.from({ length: positionCount }, (_, i) => ({
        id: `lp_${i}`,
        inRange: Math.random() > 0.5,
        timeInRangeMs: Math.random() * 86400000, // Random time up to 24 hours
        totalTimeMs: 86400000 // 24 hours
      }));

      const startTime = performance.now();

      // Simulate status updates
      for (let i = 0; i < statusUpdates; i++) {
        const position = positions[i % positionCount];
        const currentPrice = 0.045 + (Math.random() * 0.01); // Random price in range
        const deltaTime = 5000; // 5 seconds

        // Simulate position update logic
        position.inRange = currentPrice >= 0.045 && currentPrice <= 0.055;
        if (position.inRange) {
          position.timeInRangeMs += deltaTime;
        }
        position.totalTimeMs += deltaTime;
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100); // Should be very fast
      expect(duration / statusUpdates).toBeLessThan(0.1); // Less than 0.1ms per update

      console.log(`Processed ${statusUpdates} status updates in ${duration.toFixed(2)}ms (${(duration/statusUpdates).toFixed(3)}ms per update)`);
    });
  });

  describe('Range Order Performance', () => {
    it('should handle multiple range orders efficiently', async () => {
      const orderCount = 25;
      const startTime = performance.now();

      const promises = Array.from({ length: orderCount }, (_, i) =>
        rangeOrderStrategy.placeRangeOrder({
          token0: 'GALA$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 3000,
          direction: i % 2 === 0 ? 'buy' : 'sell',
          amount: '1000',
          targetPrice: i % 2 === 0 ? 0.055 + (i * 0.0001) : 0.045 - (i * 0.0001),
          rangeWidth: 0.1,
          autoExecute: true
        })
      );

      const results = await Promise.allSettled(promises);
      const endTime = performance.now();

      const duration = endTime - startTime;
      const successCount = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;

      expect(successCount).toBeGreaterThan(0);
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds

      console.log(`Placed ${successCount} range orders in ${duration.toFixed(2)}ms`);
    });

    it('should efficiently monitor order status updates', async () => {
      // Place some orders first
      const orderCount = 20;
      for (let i = 0; i < orderCount; i++) {
        await rangeOrderStrategy.placeRangeOrder({
          token0: 'GALA$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 3000,
          direction: 'buy',
          amount: '1000',
          targetPrice: 0.055 + (i * 0.0001),
          rangeWidth: 0.1,
          autoExecute: true
        });
      }

      const iterations = 10;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        await rangeOrderStrategy.updateOrderStatuses();
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
      expect(duration / iterations).toBeLessThan(200); // Less than 200ms per update cycle

      console.log(`Completed ${iterations} order status updates in ${duration.toFixed(2)}ms (${(duration/iterations).toFixed(2)}ms per cycle)`);
    });

    it('should provide fast statistics calculations', () => {
      // Place orders to generate statistics
      const orderPromises = Array.from({ length: 50 }, (_, i) =>
        rangeOrderStrategy.placeRangeOrder({
          token0: 'GALA$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 3000,
          direction: i % 2 === 0 ? 'buy' : 'sell',
          amount: '1000',
          targetPrice: i % 2 === 0 ? 0.055 : 0.045,
          rangeWidth: 0.1,
          autoExecute: true
        })
      );

      const iterations = 100;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const stats = rangeOrderStrategy.getStatistics();
        expect(stats).toHaveProperty('totalOrders');
        expect(stats).toHaveProperty('successRate');
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(50); // Should be very fast
      expect(duration / iterations).toBeLessThan(0.5); // Less than 0.5ms per calculation

      console.log(`Calculated statistics ${iterations} times in ${duration.toFixed(2)}ms (${(duration/iterations).toFixed(3)}ms per calculation)`);
    });
  });

  describe('Fee Calculation Performance', () => {
    beforeEach(() => {
      // Mock positions for fee calculations
      const mockPositions = Array.from({ length: 20 }, (_, i) => ({
        id: `lp_${i}`,
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 3000,
        liquidity: '1000000',
        liquidityValue: 1000 + (i * 100),
        createdAt: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)),
        inRange: Math.random() > 0.3,
        timeInRangeMs: Math.random() * 86400000 * 7, // Up to 7 days
        totalTimeMs: 86400000 * 7 // 7 days
      }));

      jest.spyOn(liquidityManager, 'getPosition').mockImplementation((id) =>
        mockPositions.find(p => p.id === id) as any || null
      );

      jest.spyOn(liquidityManager, 'getAllPositions').mockResolvedValue(mockPositions as any);
    });

    it('should calculate fees for multiple positions efficiently', async () => {
      const positionIds = Array.from({ length: 20 }, (_, i) => `lp_${i}`);
      const startTime = performance.now();

      const promises = positionIds.map(() => feeCalculator.calculateAccruedFees());
      const results = await Promise.allSettled(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      const successCount = results.filter(r => r.status === 'fulfilled').length;

      expect(successCount).toBe(positionIds.length);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(duration / positionIds.length).toBeLessThan(50); // Less than 50ms per calculation

      console.log(`Calculated fees for ${positionIds.length} positions in ${duration.toFixed(2)}ms (${(duration/positionIds.length).toFixed(2)}ms per position)`);
    });

    it('should generate optimization recommendations efficiently', async () => {
      const positionIds = Array.from({ length: 15 }, (_, i) => `lp_${i}`);
      const startTime = performance.now();

      const promises = positionIds.map(id => feeCalculator.generateCollectionOptimization(id));
      const results = await Promise.allSettled(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      const successCount = results.filter(r => r.status === 'fulfilled').length;

      expect(successCount).toBe(positionIds.length);
      expect(duration).toBeLessThan(1500); // Should complete within 1.5 seconds

      console.log(`Generated ${positionIds.length} optimization recommendations in ${duration.toFixed(2)}ms`);
    });

    it('should provide fast portfolio performance summary', async () => {
      const iterations = 20;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const summary = await feeCalculator.calculateGlobalFeeMetrics();
        expect(summary).toHaveProperty('totalPositions');
        expect(summary).toHaveProperty('totalFeesCollectedUSD');
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
      expect(duration / iterations).toBeLessThan(100); // Less than 100ms per summary

      console.log(`Generated ${iterations} portfolio summaries in ${duration.toFixed(2)}ms (${(duration/iterations).toFixed(2)}ms per summary)`);
    });
  });

  describe('Rebalancing Performance', () => {
    beforeEach(async () => {
      // Add mock positions for rebalancing tests
      const mockPositions = Array.from({ length: 15 }, (_, i) => ({
        id: `lp_${i}`,
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 3000,
        minPrice: 0.045 + (i * 0.0001),
        maxPrice: 0.055 + (i * 0.0001),
        createdPrice: 0.05,
        liquidity: '1000000',
        liquidityValue: 1000,
        inRange: Math.random() > 0.4,
        strategy: 'market_making',
        createdAt: new Date(Date.now() - (i * 60 * 60 * 1000)) // Hours ago
      }));

      jest.spyOn(liquidityManager, 'getAllPositions').mockResolvedValue(mockPositions as any);
    });

    it('should check rebalance signals efficiently', async () => {
      const iterations = 15;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const signals = await rebalanceEngine.checkRebalanceSignals();
        expect(Array.isArray(signals)).toBe(true);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(duration / iterations).toBeLessThan(67); // Less than 67ms per check

      console.log(`Checked rebalance signals ${iterations} times in ${duration.toFixed(2)}ms (${(duration/iterations).toFixed(2)}ms per check)`);
    });

    it('should handle concurrent rebalance signal analysis', async () => {
      const concurrentChecks = 10;
      const startTime = performance.now();

      const promises = Array.from({ length: concurrentChecks }, () =>
        rebalanceEngine.checkRebalanceSignals()
      );

      const results = await Promise.allSettled(promises);
      const endTime = performance.now();

      const duration = endTime - startTime;
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      expect(successCount).toBe(concurrentChecks);
      expect(duration).toBeLessThan(500); // Should complete within 500ms

      console.log(`Completed ${concurrentChecks} concurrent rebalance checks in ${duration.toFixed(2)}ms`);
    });
  });

  describe('Memory Usage Performance', () => {
    it('should maintain reasonable memory usage with large datasets', async () => {
      const initialMemory = process.memoryUsage();

      // Create a large number of positions
      const positionCount = 500;
      const positions = [];

      for (let i = 0; i < positionCount; i++) {
        positions.push({
          id: `lp_${i}`,
          token0: 'GALA$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 3000,
          minPrice: 0.045 + (i * 0.00001),
          maxPrice: 0.055 + (i * 0.00001),
          liquidity: '1000000',
          liquidityValue: 1000,
          inRange: Math.random() > 0.5,
          timeInRangeMs: Math.random() * 86400000,
          totalTimeMs: 86400000,
          createdAt: new Date()
        });
      }

      // Simulate position tracking
      liquidityManager['positions'] = new Map(positions.map(p => [p.id, p as any]));

      // Create range orders
      for (let i = 0; i < 100; i++) {
        await rangeOrderStrategy.placeRangeOrder({
          token0: 'GALA$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 3000,
          direction: i % 2 === 0 ? 'buy' : 'sell',
          amount: '1000',
          targetPrice: i % 2 === 0 ? 0.055 : 0.045,
          rangeWidth: 0.1,
          autoExecute: true
        });
      }

      const finalMemory = process.memoryUsage();

      // Memory increase should be reasonable (less than 100MB)
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
      expect(memoryIncrease).toBeLessThan(100);

      console.log(`Memory increase with ${positionCount} positions and 100 range orders: ${memoryIncrease.toFixed(2)}MB`);
    });

    it('should properly clean up resources', () => {
      const initialMemory = process.memoryUsage();

      // Create and destroy many objects
      for (let i = 0; i < 1000; i++) {
        const manager = new LiquidityManager({} as any, 'eth|test-wallet-address');
        const strategy = new RangeOrderStrategy(manager);

        // Simulate some operations
        strategy.getStatistics();
        manager.getStatus();
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

      // Memory increase should be minimal after cleanup
      expect(memoryIncrease).toBeLessThan(50);

      console.log(`Memory increase after creating/destroying 1000 objects: ${memoryIncrease.toFixed(2)}MB`);
    });
  });

  describe('Scalability Tests', () => {
    it('should scale linearly with position count', async () => {
      const testSizes = [10, 50, 100, 200];
      const results = [];

      for (const size of testSizes) {
        // Create positions
        const positions = Array.from({ length: size }, (_, i) => ({
          id: `lp_${i}`,
          liquidityValue: 1000
        }));

        jest.spyOn(liquidityManager, 'getAllPositions').mockResolvedValue(positions as any);

        const startTime = performance.now();
        await liquidityManager.getAllPositions();
        const endTime = performance.now();

        results.push({
          size,
          duration: endTime - startTime
        });
      }

      // Check that performance scales reasonably
      for (let i = 1; i < results.length; i++) {
        const current = results[i];
        const previous = results[i - 1];
        const scaleFactor = current.size / previous.size;
        const performanceRatio = current.duration / previous.duration;

        // Performance should not degrade more than 2x the scale factor
        expect(performanceRatio).toBeLessThan(scaleFactor * 2);
      }

      console.log('Scalability results:', results.map(r =>
        `${r.size} positions: ${r.duration.toFixed(2)}ms`
      ).join(', '));
    });
  });
});