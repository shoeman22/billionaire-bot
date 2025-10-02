/**
 * Tests for Phase 7: Advanced Arbitrage Enhancements
 */

import {
  identifyParallelRoutes,
  generateRouteSignature,
  calculateAdaptiveThreshold,
  prioritizeRoutes,
  getParallelExecutionStats
} from '../arbitrage-enhancements';
import { ExoticRoute } from '../../execution/exotic-arbitrage-executor';

describe('arbitrage-enhancements', () => {
  describe('identifyParallelRoutes', () => {
    it('should prevent parallel execution of routes sharing starting token', () => {
      // CRITICAL TEST: All arbitrage routes start with GALA and need wallet balance
      const routes: ExoticRoute[] = [
        {
          tokens: ['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'SILK|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'USDC', 'SILK', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1030,
          profitPercent: 3.0,
          profitAmount: 30,
          confidence: 'high' as const,
          estimatedGas: 5,
          netProfit: 25,
          feeTiers: [10000, 10000, 10000]
        },
        {
          tokens: ['GALA|Unit|none|none', 'ETIME|Unit|none|none', 'GUSDC|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'ETIME', 'USDC', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1025,
          profitPercent: 2.5,
          profitAmount: 25,
          confidence: 'high' as const,
          estimatedGas: 5,
          netProfit: 20,
          feeTiers: [10000, 10000, 10000]
        }
      ];

      const batches = identifyParallelRoutes(routes);

      // Both routes need GALA to start, so they MUST be in separate batches
      expect(batches.length).toBe(2);
      expect(batches[0].length).toBe(1);
      expect(batches[1].length).toBe(1);
    });

    it('should allow parallel execution of routes with different starting tokens and no shared intermediates', () => {
      const routes: ExoticRoute[] = [
        {
          tokens: ['GALA|Unit|none|none', 'SILK|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'SILK', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1020,
          profitPercent: 2.0,
          profitAmount: 20,
          confidence: 'high' as const,
          estimatedGas: 5,
          netProfit: 15,
          feeTiers: [10000, 10000]
        },
        {
          tokens: ['GUSDC|Unit|none|none', 'ETIME|Unit|none|none', 'GUSDC|Unit|none|none'],
          symbols: ['USDC', 'ETIME', 'USDC'],
          inputAmount: 1000,
          expectedOutput: 1015,
          profitPercent: 1.5,
          profitAmount: 15,
          confidence: 'medium' as const,
          estimatedGas: 5,
          netProfit: 10,
          feeTiers: [10000, 10000]
        }
      ];

      const batches = identifyParallelRoutes(routes);

      // Different starting tokens AND no shared intermediate tokens = can execute in parallel
      expect(batches.length).toBe(1);
      expect(batches[0].length).toBe(2);
    });

    it('should prevent parallel execution of routes sharing intermediate tokens', () => {
      const routes: ExoticRoute[] = [
        {
          tokens: ['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'SILK|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'USDC', 'SILK', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1030,
          profitPercent: 3.0,
          profitAmount: 30,
          confidence: 'high' as const,
          estimatedGas: 5,
          netProfit: 25,
          feeTiers: [10000, 10000, 10000]
        },
        {
          tokens: ['ETIME|Unit|none|none', 'GUSDC|Unit|none|none', 'GWETH|Unit|none|none', 'ETIME|Unit|none|none'],
          symbols: ['ETIME', 'USDC', 'WETH', 'ETIME'],
          inputAmount: 1000,
          expectedOutput: 1020,
          profitPercent: 2.0,
          profitAmount: 20,
          confidence: 'medium' as const,
          estimatedGas: 5,
          netProfit: 15,
          feeTiers: [10000, 10000, 10000]
        }
      ];

      const batches = identifyParallelRoutes(routes);

      // Both use USDC as intermediate token = separate batches
      expect(batches.length).toBe(2);
    });

    it('should handle empty routes array', () => {
      const batches = identifyParallelRoutes([]);
      expect(batches).toEqual([]);
    });

    it('should handle single route', () => {
      const routes: ExoticRoute[] = [
        {
          tokens: ['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'USDC', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1020,
          profitPercent: 2.0,
          profitAmount: 20,
          confidence: 'high' as const,
          estimatedGas: 5,
          netProfit: 15,
          feeTiers: [10000, 10000]
        }
      ];

      const batches = identifyParallelRoutes(routes);
      expect(batches.length).toBe(1);
      expect(batches[0].length).toBe(1);
    });
  });

  describe('generateRouteSignature', () => {
    it('should generate consistent route signature', () => {
      const symbols = ['GALA', 'USDC', 'SILK', 'GALA'];
      const signature = generateRouteSignature(symbols);
      expect(signature).toBe('GALA→USDC→SILK→GALA');
    });

    it('should generate different signatures for different routes', () => {
      const sig1 = generateRouteSignature(['GALA', 'USDC', 'GALA']);
      const sig2 = generateRouteSignature(['GALA', 'ETIME', 'GALA']);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('calculateAdaptiveThreshold', () => {
    it('should return base threshold with no adjustments in neutral market', () => {
      const baseThreshold = 2.0;
      const result = calculateAdaptiveThreshold(baseThreshold);

      expect(result.minProfitThreshold).toBe(baseThreshold);
      expect(result.finalThreshold).toBeGreaterThanOrEqual(0.1);
    });

    it('should never go below minimum threshold of 0.1%', () => {
      const baseThreshold = 0.05; // Very low base
      const result = calculateAdaptiveThreshold(baseThreshold);

      expect(result.finalThreshold).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('prioritizeRoutes', () => {
    it('should sort routes by profit percentage descending', () => {
      const routes: ExoticRoute[] = [
        {
          tokens: ['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'USDC', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1010,
          profitPercent: 1.0,
          profitAmount: 10,
          confidence: 'medium' as const,
          estimatedGas: 5,
          netProfit: 5,
          feeTiers: [10000, 10000]
        },
        {
          tokens: ['GALA|Unit|none|none', 'ETIME|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'ETIME', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1030,
          profitPercent: 3.0,
          profitAmount: 30,
          confidence: 'high' as const,
          estimatedGas: 5,
          netProfit: 25,
          feeTiers: [10000, 10000]
        },
        {
          tokens: ['GALA|Unit|none|none', 'SILK|Unit|none|none', 'GALA|Unit|none|none'],
          symbols: ['GALA', 'SILK', 'GALA'],
          inputAmount: 1000,
          expectedOutput: 1020,
          profitPercent: 2.0,
          profitAmount: 20,
          confidence: 'high' as const,
          estimatedGas: 5,
          netProfit: 15,
          feeTiers: [10000, 10000]
        }
      ];

      const sorted = prioritizeRoutes(routes);

      expect(sorted[0].profitPercent).toBe(3.0);
      expect(sorted[1].profitPercent).toBe(2.0);
      expect(sorted[2].profitPercent).toBe(1.0);
    });
  });

  describe('getParallelExecutionStats', () => {
    it('should calculate correct statistics for batches', () => {
      const batches: ExoticRoute[][] = [
        [
          {
            tokens: ['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'GALA|Unit|none|none'],
            symbols: ['GALA', 'USDC', 'GALA'],
            inputAmount: 1000,
            expectedOutput: 1020,
            profitPercent: 2.0,
            profitAmount: 20,
            confidence: 'high' as const,
            estimatedGas: 5,
            netProfit: 15,
            feeTiers: [10000, 10000]
          },
          {
            tokens: ['ETIME|Unit|none|none', 'SILK|Unit|none|none', 'ETIME|Unit|none|none'],
            symbols: ['ETIME', 'SILK', 'ETIME'],
            inputAmount: 1000,
            expectedOutput: 1015,
            profitPercent: 1.5,
            profitAmount: 15,
            confidence: 'medium' as const,
            estimatedGas: 5,
            netProfit: 10,
            feeTiers: [10000, 10000]
          }
        ],
        [
          {
            tokens: ['GUSDC|Unit|none|none', 'GWETH|Unit|none|none', 'GUSDC|Unit|none|none'],
            symbols: ['USDC', 'WETH', 'USDC'],
            inputAmount: 1000,
            expectedOutput: 1010,
            profitPercent: 1.0,
            profitAmount: 10,
            confidence: 'low' as const,
            estimatedGas: 5,
            netProfit: 5,
            feeTiers: [10000, 10000]
          }
        ]
      ];

      const stats = getParallelExecutionStats(batches);

      expect(stats.totalBatches).toBe(2);
      expect(stats.maxParallelism).toBe(2); // First batch has 2 routes
      expect(stats.parallelRoutes).toBe(3); // Total routes
    });

    it('should handle empty batches', () => {
      const stats = getParallelExecutionStats([]);

      expect(stats.totalBatches).toBe(0);
      expect(stats.maxParallelism).toBe(0);
      expect(stats.parallelRoutes).toBe(0);
    });
  });
});
