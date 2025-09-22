/**
 * FeeCalculator Tests
 * Testing fee tracking and optimization logic
 */

import { FeeCalculator } from '../../services/fee-calculator';
import { LiquidityManager } from '../../services/liquidity-manager';
import { Position } from '../../entities/Position';

// Mock the LiquidityManager
jest.mock('../../services/liquidity-manager');
const MockLiquidityManager = LiquidityManager as jest.MockedClass<typeof LiquidityManager>;

describe('FeeCalculator', () => {
  let feeCalculator: FeeCalculator;
  let mockLiquidityManager: jest.Mocked<LiquidityManager>;

  beforeEach(() => {
    mockLiquidityManager = new MockLiquidityManager({} as any) as jest.Mocked<LiquidityManager>;

    // Mock the gswap service
    (mockLiquidityManager as any).gswap = {
      pools: {
        getPoolData: jest.fn(),
        calculateSpotPrice: jest.fn()
      }
    };

    mockLiquidityManager.getPosition = jest.fn();
    mockLiquidityManager.getAllPositions = jest.fn();

    feeCalculator = new FeeCalculator(mockLiquidityManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateAccruedFees', () => {
    const mockPosition: Partial<Position> = {
      id: 'lp_test123',
      token0: 'GALA$Unit$none$none',
      token1: 'GUSDC$Unit$none$none',
      fee: 3000,
      liquidity: '1000000',
      minPrice: 0.045,
      maxPrice: 0.055,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      liquidityValue: 1000,
      inRange: true,
      timeInRangeMs: 5 * 24 * 60 * 60 * 1000, // 5 days
      totalTimeMs: 7 * 24 * 60 * 60 * 1000 // 7 days total
    };

    beforeEach(() => {
      mockLiquidityManager.getPosition.mockReturnValue(mockPosition as Position);

      // Mock pool data for price calculation
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000',
        liquidity: '5000000',
        volume24h: '100000'
      });

      (mockLiquidityManager as any).gswap.pools.calculateSpotPrice.mockReturnValue('0.05');
    });

    it('should calculate fees for in-range position', async () => {
      const result = await feeCalculator.calculateAccruedFees('lp_test123');

      expect(result.success).toBe(true);
      expect(result.positionId).toBe('lp_test123');
      expect(result.totalFeesUSD).toBeGreaterThan(0);
      expect(result.estimatedAPR).toBeGreaterThan(0);
      expect(result.timeInRangePercentage).toBeCloseTo(71.43, 1); // 5/7 days
      expect(result.feeBreakdown).toHaveProperty('amount0');
      expect(result.feeBreakdown).toHaveProperty('amount1');
    });

    it('should handle out-of-range position', async () => {
      const outOfRangePosition = {
        ...mockPosition,
        inRange: false,
        timeInRangeMs: 0
      };

      mockLiquidityManager.getPosition.mockReturnValue(outOfRangePosition as Position);

      const result = await feeCalculator.calculateAccruedFees('lp_test123');

      expect(result.success).toBe(true);
      expect(result.totalFeesUSD).toBe(0);
      expect(result.estimatedAPR).toBe(0);
      expect(result.timeInRangePercentage).toBe(0);
    });

    it('should handle non-existent position', async () => {
      mockLiquidityManager.getPosition.mockReturnValue(null);

      const result = await feeCalculator.calculateAccruedFees('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Position not found');
    });

    it('should handle pool data errors', async () => {
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockRejectedValue(new Error('Pool not found'));

      const result = await feeCalculator.calculateAccruedFees('lp_test123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pool not found');
    });

    it('should calculate APR correctly', async () => {
      // Mock high volume pool for better APR calculation
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000',
        liquidity: '1000000', // Lower total liquidity = higher share
        volume24h: '1000000' // High volume
      });

      const result = await feeCalculator.calculateAccruedFees('lp_test123');

      expect(result.success).toBe(true);
      expect(result.estimatedAPR).toBeGreaterThan(10); // Should be significant APR
    });
  });

  describe('generateCollectionOptimization', () => {
    beforeEach(() => {
      const mockPosition: Partial<Position> = {
        id: 'lp_test123',
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 3000,
        liquidity: '1000000',
        liquidityValue: 1000,
        inRange: true
      };

      mockLiquidityManager.getPosition.mockReturnValue(mockPosition as Position);

      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000',
        liquidity: '5000000',
        volume24h: '100000'
      });

      (mockLiquidityManager as any).gswap.pools.calculateSpotPrice.mockReturnValue('0.05');
    });

    it('should recommend collecting when profitable', async () => {
      // Mock high accrued fees
      jest.spyOn(feeCalculator, 'calculateAccruedFees').mockResolvedValue({
        success: true,
        positionId: 'lp_test123',
        totalFeesUSD: 50, // High fees
        estimatedAPR: 25,
        timeInRangePercentage: 80,
        feeBreakdown: { amount0: '25', amount1: '1.25' }
      });

      const result = await feeCalculator.generateCollectionOptimization('lp_test123');

      expect(result.recommendation).toBe('collect_now');
      expect(result.costBenefitRatio).toBeLessThan(0.1);
      expect(result.projectedSavings).toBeGreaterThan(0);
    });

    it('should recommend waiting when fees are low', async () => {
      // Mock low accrued fees
      jest.spyOn(feeCalculator, 'calculateAccruedFees').mockResolvedValue({
        success: true,
        positionId: 'lp_test123',
        totalFeesUSD: 2, // Low fees
        estimatedAPR: 5,
        timeInRangePercentage: 50,
        feeBreakdown: { amount0: '1', amount1: '0.05' }
      });

      const result = await feeCalculator.generateCollectionOptimization('lp_test123');

      expect(result.recommendation).toBe('wait');
      expect(result.costBenefitRatio).toBeGreaterThan(0.5);
      expect(result.daysUntilOptimal).toBeGreaterThan(0);
    });

    it('should handle calculation errors gracefully', async () => {
      jest.spyOn(feeCalculator, 'calculateAccruedFees').mockResolvedValue({
        success: false,
        positionId: 'lp_test123',
        error: 'Position error'
      });

      const result = await feeCalculator.generateCollectionOptimization('lp_test123');

      expect(result.recommendation).toBe('wait');
      expect(result.error).toContain('Position error');
    });
  });

  describe('getTotalFeesCollected', () => {
    it('should calculate total fees across all positions', async () => {
      const mockPositions = [
        { id: 'lp_1', liquidityValue: 1000 },
        { id: 'lp_2', liquidityValue: 2000 },
        { id: 'lp_3', liquidityValue: 1500 }
      ];

      mockLiquidityManager.getAllPositions.mockResolvedValue(mockPositions as Position[]);

      // Mock fee calculations for each position
      jest.spyOn(feeCalculator, 'calculateAccruedFees')
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_1',
          totalFeesUSD: 25,
          estimatedAPR: 20,
          timeInRangePercentage: 80,
          feeBreakdown: { amount0: '12.5', amount1: '0.625' }
        })
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_2',
          totalFeesUSD: 50,
          estimatedAPR: 15,
          timeInRangePercentage: 90,
          feeBreakdown: { amount0: '25', amount1: '1.25' }
        })
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_3',
          totalFeesUSD: 30,
          estimatedAPR: 18,
          timeInRangePercentage: 75,
          feeBreakdown: { amount0: '15', amount1: '0.75' }
        });

      const total = await feeCalculator.getTotalFeesCollected();

      expect(total).toBe(105); // 25 + 50 + 30
    });

    it('should handle positions with failed calculations', async () => {
      const mockPositions = [
        { id: 'lp_1', liquidityValue: 1000 },
        { id: 'lp_2', liquidityValue: 2000 }
      ];

      mockLiquidityManager.getAllPositions.mockResolvedValue(mockPositions as Position[]);

      jest.spyOn(feeCalculator, 'calculateAccruedFees')
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_1',
          totalFeesUSD: 25,
          estimatedAPR: 20,
          timeInRangePercentage: 80,
          feeBreakdown: { amount0: '12.5', amount1: '0.625' }
        })
        .mockResolvedValueOnce({
          success: false,
          positionId: 'lp_2',
          error: 'Failed to calculate'
        });

      const total = await feeCalculator.getTotalFeesCollected();

      expect(total).toBe(25); // Only successful calculation
    });
  });

  describe('Fee Estimation Formulas', () => {
    it('should estimate fees based on volume and liquidity share', () => {
      const poolVolume24h = 1000000; // $1M daily volume
      const totalLiquidity = 10000000; // $10M total liquidity
      const positionLiquidity = 100000; // $100K position
      const feeTier = 3000; // 0.3%
      const timeInRangeDays = 5;

      const estimatedFees = feeCalculator['estimateDailyFees'](
        poolVolume24h,
        totalLiquidity,
        positionLiquidity,
        feeTier,
        timeInRangeDays
      );

      // Expected: (1M * 0.003 * (100K/10M)) * 5 days = $150
      expect(estimatedFees).toBeCloseTo(150, 0);
    });

    it('should handle zero liquidity gracefully', () => {
      const estimatedFees = feeCalculator['estimateDailyFees'](
        1000000, 0, 100000, 3000, 5
      );

      expect(estimatedFees).toBe(0);
    });

    it('should calculate APR correctly', () => {
      const totalFeesUSD = 100;
      const positionValueUSD = 10000;
      const daysActive = 30;

      const apr = feeCalculator['calculateAPR'](totalFeesUSD, positionValueUSD, daysActive);

      // Expected: (100 / 10000) * (365 / 30) * 100 = 12.17%
      expect(apr).toBeCloseTo(12.17, 1);
    });
  });

  describe('Performance Analytics', () => {
    beforeEach(() => {
      const mockPositions = [
        {
          id: 'lp_1',
          token0: 'GALA$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 3000,
          liquidityValue: 1000,
          timeInRangeMs: 4 * 24 * 60 * 60 * 1000, // 4 days
          totalTimeMs: 5 * 24 * 60 * 60 * 1000 // 5 days total
        },
        {
          id: 'lp_2',
          token0: 'ETIME$Unit$none$none',
          token1: 'GUSDC$Unit$none$none',
          fee: 500,
          liquidityValue: 2000,
          timeInRangeMs: 6 * 24 * 60 * 60 * 1000, // 6 days
          totalTimeMs: 7 * 24 * 60 * 60 * 1000 // 7 days total
        }
      ];

      mockLiquidityManager.getAllPositions.mockResolvedValue(mockPositions as Position[]);
    });

    it('should provide portfolio performance summary', async () => {
      // Mock fee calculations
      jest.spyOn(feeCalculator, 'calculateAccruedFees')
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_1',
          totalFeesUSD: 25,
          estimatedAPR: 20,
          timeInRangePercentage: 80,
          feeBreakdown: { amount0: '12.5', amount1: '0.625' }
        })
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_2',
          totalFeesUSD: 50,
          estimatedAPR: 15,
          timeInRangePercentage: 85.7,
          feeBreakdown: { amount0: '25', amount1: '1.25' }
        });

      const summary = await feeCalculator.getPortfolioPerformanceSummary();

      expect(summary.totalPositions).toBe(2);
      expect(summary.totalLiquidityUSD).toBe(3000);
      expect(summary.totalFeesEarnedUSD).toBe(75);
      expect(summary.averageAPR).toBeCloseTo(17.5, 1);
      expect(summary.averageTimeInRange).toBeCloseTo(82.85, 1);
      expect(summary.positionBreakdown).toHaveLength(2);
    });

    it('should handle mixed success/failure in position analysis', async () => {
      jest.spyOn(feeCalculator, 'calculateAccruedFees')
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_1',
          totalFeesUSD: 25,
          estimatedAPR: 20,
          timeInRangePercentage: 80,
          feeBreakdown: { amount0: '12.5', amount1: '0.625' }
        })
        .mockResolvedValueOnce({
          success: false,
          positionId: 'lp_2',
          error: 'Pool data unavailable'
        });

      const summary = await feeCalculator.getPortfolioPerformanceSummary();

      expect(summary.totalPositions).toBe(2);
      expect(summary.totalFeesEarnedUSD).toBe(25); // Only successful calculation
      expect(summary.positionBreakdown).toHaveLength(1); // Only successful positions
    });
  });

  describe('Gas Cost Estimation', () => {
    it('should estimate gas costs for fee collection', () => {
      const gasPrice = 50; // gwei
      const ethPrice = 3000; // USD

      const gasCost = feeCalculator['estimateCollectionGasCost'](gasPrice, ethPrice);

      // Typical fee collection uses ~150k gas
      // 150000 * 50 gwei * 3000 USD = $22.5
      expect(gasCost).toBeCloseTo(22.5, 1);
    });

    it('should handle zero gas price', () => {
      const gasCost = feeCalculator['estimateCollectionGasCost'](0, 3000);
      expect(gasCost).toBe(0);
    });
  });
});