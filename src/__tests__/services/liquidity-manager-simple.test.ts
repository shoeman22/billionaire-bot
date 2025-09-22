/**
 * Simplified LiquidityManager Tests
 * Testing core functionality with proper mocking
 */

import { LiquidityManager } from '../../services/liquidity-manager';
import { GSwapWrapper } from '../../services/gswap-wrapper';
import { TRADING_CONSTANTS } from '../../config/constants';
import { RetryHelper } from '../../utils/retry-helper';
import { GasEstimator } from '../../utils/gas-estimator';

// Mock retry helper and gas estimator
jest.mock('../../utils/retry-helper');
jest.mock('../../utils/gas-estimator');

// Create a proper mock for GSwapWrapper
const createMockGSwap = () => ({
  liquidityPositions: {
    addLiquidityByPrice: jest.fn(),
    removeLiquidity: jest.fn(),
    collectPositionFees: jest.fn(),
  },
  pools: {
    getPoolData: jest.fn(),
    calculateSpotPrice: jest.fn()
  }
});

describe('LiquidityManager (Simplified)', () => {
  let liquidityManager: LiquidityManager;
  let mockGSwap: ReturnType<typeof createMockGSwap>;

  beforeEach(() => {
    mockGSwap = createMockGSwap();

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

    liquidityManager = new LiquidityManager(mockGSwap as any, 'eth|test-wallet-address');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should be properly initialized', () => {
      expect(liquidityManager).toBeDefined();
      expect(liquidityManager['walletAddress']).toBe('eth|test-wallet-address');
      expect(liquidityManager['positions']).toBeDefined();
    });

    it('should generate unique position IDs', async () => {
      const id1 = await liquidityManager['generatePositionId']('GALA', 'GUSDC', 3000);
      const id2 = await liquidityManager['generatePositionId']('GALA', 'GUSDC', 3000);

      expect(id1).toMatch(/^lp_[a-zA-Z0-9]+$/);
      expect(id2).toMatch(/^lp_[a-zA-Z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should validate parameters', async () => {
      const invalidParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: -1, // Invalid negative price
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      await expect(liquidityManager.addLiquidityByPrice(invalidParams))
        .rejects.toThrow('Invalid price range');
    });

    it('should handle successful position creation', async () => {
      const params = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      // Mock successful SDK response
      mockGSwap.liquidityPositions.addLiquidityByPrice.mockResolvedValue({
        amount0: '995',
        amount1: '49.5'
      });

      const positionId = await liquidityManager.addLiquidityByPrice(params);

      expect(positionId).toMatch(/^lp_[a-zA-Z0-9]+$/);
      expect(mockGSwap.liquidityPositions.addLiquidityByPrice).toHaveBeenCalled();
    });

    it('should store position data locally', async () => {
      const params = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      mockGSwap.liquidityPositions.addLiquidityByPrice.mockResolvedValue({
        amount0: '995',
        amount1: '49.5'
      });

      const positionId = await liquidityManager.addLiquidityByPrice(params);
      const position = liquidityManager.getPosition(positionId);

      expect(position).toBeDefined();
      expect(position?.id).toBe(positionId);
      expect(position?.token0).toBe(params.token0);
      expect(position?.token1).toBe(params.token1);
    });

    it('should handle position retrieval', () => {
      // Test non-existent position
      const nonExistentPosition = liquidityManager.getPosition('nonexistent');
      expect(nonExistentPosition).toBeNull();

      // Test after adding a position (simulate)
      const mockPosition = {
        id: 'lp_test123',
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: 3000,
        tickLower: -887220,
        tickUpper: 887220,
        minPrice: 0.045,
        maxPrice: 0.055,
        liquidity: '1000000',
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };

      liquidityManager['positions'].set('lp_test123', mockPosition);

      const retrievedPosition = liquidityManager.getPosition('lp_test123');
      expect(retrievedPosition).toEqual(mockPosition);
    });

    it('should validate fee tiers', async () => {
      const invalidFeeParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: 99999, // Invalid fee tier
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      await expect(liquidityManager.addLiquidityByPrice(invalidFeeParams))
        .rejects.toThrow('Invalid fee tier');
    });

    it('should handle position removal', async () => {
      // First add a position
      const mockPosition = {
        id: 'lp_test123',
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: 3000,
        liquidity: '1000000'
      };

      liquidityManager['positions'].set('lp_test123', mockPosition as any);

      // Mock SDK response
      mockGSwap.liquidityPositions.removeLiquidity.mockResolvedValue({
        amount0: '995',
        amount1: '49.5'
      });

      const result = await liquidityManager.removeLiquidity({
        positionId: 'lp_test123',
        liquidity: '1000000'
      });

      expect(result.amount0).toBe('995');
      expect(result.amount1).toBe('49.5');
      expect(mockGSwap.liquidityPositions.removeLiquidity).toHaveBeenCalled();
    });

    it('should handle fee collection', async () => {
      // Add a mock position
      const mockPosition = {
        id: 'lp_test123',
        uncollectedFees0: '5',
        uncollectedFees1: '0.25'
      };

      liquidityManager['positions'].set('lp_test123', mockPosition as any);

      // Mock SDK response
      mockGSwap.liquidityPositions.collectPositionFees.mockResolvedValue({
        amount0: '5',
        amount1: '0.25'
      });

      const result = await liquidityManager.collectFees({
        positionId: 'lp_test123'
      });

      expect(result.amount0).toBe('5');
      expect(result.amount1).toBe('0.25');
      expect(mockGSwap.liquidityPositions.collectPositionFees).toHaveBeenCalled();
    });

    it('should get all positions', async () => {
      // Add some mock positions
      const mockPositions = [
        { id: 'lp_1', token0: 'GALA', token1: 'GUSDC' },
        { id: 'lp_2', token0: 'ETIME', token1: 'GUSDC' }
      ];

      mockPositions.forEach(pos => {
        liquidityManager['positions'].set(pos.id, pos as any);
      });

      const allPositions = await liquidityManager.getAllPositions();

      expect(allPositions).toHaveLength(2);
      expect(allPositions.map(p => p.id)).toEqual(['lp_1', 'lp_2']);
    });
  });

  describe('Error Handling', () => {
    it('should handle SDK errors gracefully', async () => {
      const params = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      mockGSwap.liquidityPositions.addLiquidityByPrice.mockRejectedValue(
        new Error('Insufficient balance')
      );

      await expect(liquidityManager.addLiquidityByPrice(params))
        .rejects.toThrow('Insufficient balance');
    });

    it('should handle non-existent position removal', async () => {
      await expect(liquidityManager.removeLiquidity({
        positionId: 'nonexistent',
        liquidity: '1000000'
      })).rejects.toThrow('Position not found');
    });

    it('should handle non-existent position fee collection', async () => {
      await expect(liquidityManager.collectFees({
        positionId: 'nonexistent'
      })).rejects.toThrow('Position not found');
    });
  });

  describe('Parameter Validation', () => {
    it('should validate same token error', async () => {
      const sameTokenParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GALA, // Same as token0
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      await expect(liquidityManager.addLiquidityByPrice(sameTokenParams))
        .rejects.toThrow('Token0 and token1 must be different');
    });

    it('should validate price range order', async () => {
      const invalidRangeParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.055, // Higher than maxPrice
        maxPrice: 0.045,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      await expect(liquidityManager.addLiquidityByPrice(invalidRangeParams))
        .rejects.toThrow('Invalid price range');
    });

    it('should validate amounts', async () => {
      const zeroAmountParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '0', // Zero amount
        amount1Desired: '0'
      };

      await expect(liquidityManager.addLiquidityByPrice(zeroAmountParams))
        .rejects.toThrow('Amount must be greater than zero');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete position lifecycle', async () => {
      const params = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      // Mock SDK responses
      mockGSwap.liquidityPositions.addLiquidityByPrice.mockResolvedValue({
        amount0: '995',
        amount1: '49.5'
      });

      mockGSwap.liquidityPositions.collectPositionFees.mockResolvedValue({
        amount0: '5',
        amount1: '0.25'
      });

      mockGSwap.liquidityPositions.removeLiquidity.mockResolvedValue({
        amount0: '1000',
        amount1: '50'
      });

      // 1. Add position
      const positionId = await liquidityManager.addLiquidityByPrice(params);
      expect(positionId).toBeDefined();

      // 2. Verify position exists
      const position = liquidityManager.getPosition(positionId);
      expect(position).toBeDefined();

      // 3. Collect fees
      const feeResult = await liquidityManager.collectFees({ positionId });
      expect(feeResult.amount0).toBe('5');

      // 4. Remove position
      const removeResult = await liquidityManager.removeLiquidity({
        positionId,
        liquidity: position!.liquidity
      });
      expect(removeResult.amount0).toBe('1000');
    });
  });
});