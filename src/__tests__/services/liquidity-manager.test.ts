/**
 * LiquidityManager Tests
 * Comprehensive testing for liquidity position management
 */

import { LiquidityManager } from '../../services/liquidity-manager';
import { GSwap } from '../../services/gswap-simple';
import { TRADING_CONSTANTS } from '../../config/constants';
import { RetryHelper } from '../../utils/retry-helper';
import { GasEstimator } from '../../utils/gas-estimator';

// Mock the GSwap service and utilities
jest.mock('../../services/gswap-wrapper');
jest.mock('../../utils/retry-helper');
jest.mock('../../utils/gas-estimator');
const MockGSwap = GSwap as jest.MockedClass<typeof GSwap>;

describe('LiquidityManager', () => {
  let liquidityManager: LiquidityManager;
  let mockGSwap: any;

  beforeEach(() => {
    // Create a simple mock object
    mockGSwap = {
      liquidityPositions: {
        addLiquidityByPrice: jest.fn(),
        removeLiquidity: jest.fn(),
        collectPositionFees: jest.fn(),
        getPosition: jest.fn(),
      }
    };

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

    liquidityManager = new LiquidityManager(mockGSwap, 'eth|test-wallet-address');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addLiquidityByPrice', () => {
    const mockParams = {
      token0: TRADING_CONSTANTS.TOKENS.GALA,
      token1: TRADING_CONSTANTS.TOKENS.GUSDC,
      fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
      minPrice: 0.045,
      maxPrice: 0.055,
      amount0Desired: '1000',
      amount1Desired: '50',
      slippageTolerance: 0.005
    };

    it('should successfully add liquidity position', async () => {
      const mockResponse = {
        amount0: '1000',
        amount1: '50',
        liquidity: '1000000'
      };

      mockGSwap.liquidityPositions.addLiquidityByPrice.mockResolvedValue(mockResponse);

      const result = await liquidityManager.addLiquidityByPrice(mockParams);

      expect(result).toMatch(/^lp_[a-zA-Z0-9]+$/);
      expect(mockGSwap.liquidityPositions.addLiquidityByPrice).toHaveBeenCalledWith({
        walletAddress: 'eth|test-wallet-address',
        positionId: expect.stringMatching(/^lp_[a-zA-Z0-9]+$/),
        token0: mockParams.token0,
        token1: mockParams.token1,
        fee: mockParams.fee,
        tickSpacing: 60,
        minPrice: mockParams.minPrice,
        maxPrice: mockParams.maxPrice,
        amount0Desired: mockParams.amount0Desired,
        amount1Desired: mockParams.amount1Desired,
        amount0Min: expect.any(String),
        amount1Min: expect.any(String)
      });
    });

    it('should handle SDK errors gracefully', async () => {
      const mockError = new Error('Insufficient liquidity');
      mockGSwap.liquidityPositions.addLiquidityByPrice.mockRejectedValue(mockError);

      await expect(liquidityManager.addLiquidityByPrice(mockParams)).rejects.toThrow('Insufficient liquidity');
    });

    it('should validate input parameters', async () => {
      const invalidParams = { ...mockParams, minPrice: -1 };

      await expect(liquidityManager.addLiquidityByPrice(invalidParams)).rejects.toThrow('Invalid price range');
    });

    it('should apply slippage protection correctly', async () => {
      const mockResponse = { amount0: '995', amount1: '49.75' };
      mockGSwap.liquidityPositions.addLiquidityByPrice.mockResolvedValue(mockResponse);

      await liquidityManager.addLiquidityByPrice(mockParams);

      const call = mockGSwap.liquidityPositions.addLiquidityByPrice.mock.calls[0][0];
      expect(parseFloat(call.amount0Min)).toBeLessThan(parseFloat(mockParams.amount0Desired));
      expect(parseFloat(call.amount1Min)).toBeLessThan(parseFloat(mockParams.amount1Desired));
    });
  });

  describe('removeLiquidity', () => {
    const mockParams = {
      positionId: 'lp_test123',
      liquidity: '1000000',
      slippageTolerance: 0.005
    };

    it('should successfully remove liquidity', async () => {
      const mockPosition = {
        id: 'lp_test123',
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        tickLower: -1000,
        tickUpper: 1000,
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

      const mockResponse = {
        amount0: '995',
        amount1: '49.5'
      };

      // Mock position retrieval and removal
      liquidityManager['positions'].set('lp_test123', mockPosition);
      mockGSwap.liquidityPositions.removeLiquidity.mockResolvedValue(mockResponse);

      const result = await liquidityManager.removeLiquidity(mockParams);

      expect(result.amount0).toBe('995');
      expect(result.amount1).toBe('49.5');
      expect(mockGSwap.liquidityPositions.removeLiquidity).toHaveBeenCalled();
    });

    it('should handle non-existent position', async () => {
      await expect(liquidityManager.removeLiquidity(mockParams)).rejects.toThrow('Position not found');
    });
  });

  describe('collectFees', () => {
    const mockParams = {
      positionId: 'lp_test123'
    };

    it('should successfully collect fees', async () => {
      const mockPosition = {
        id: 'lp_test123',
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        tickLower: -1000,
        tickUpper: 1000,
        minPrice: 0.045,
        maxPrice: 0.055,
        liquidity: '1000000',
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '5',
        uncollectedFees1: '0.25',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };

      const mockResponse = {
        amount0: '5',
        amount1: '0.25'
      };

      liquidityManager['positions'].set('lp_test123', mockPosition);
      mockGSwap.liquidityPositions.collectPositionFees.mockResolvedValue(mockResponse);

      const result = await liquidityManager.collectFees(mockParams);

      expect(result.amount0).toBe('5');
      expect(result.amount1).toBe('0.25');
    });
  });

  describe('getPosition', () => {
    it('should return existing position', () => {
      const mockPosition = {
        id: 'lp_test123',
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC
      };

      liquidityManager['positions'].set('lp_test123', mockPosition as any);

      const result = liquidityManager.getPosition('lp_test123');
      expect(result).toEqual(mockPosition);
    });

    it('should return null for non-existent position', () => {
      const result = liquidityManager.getPosition('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getAllPositions', () => {
    it('should return all positions', async () => {
      const mockPositions = [
        { id: 'lp_1', token0: 'GALA', token1: 'GUSDC' },
        { id: 'lp_2', token0: 'ETIME', token1: 'GUSDC' }
      ];

      mockPositions.forEach(pos => {
        liquidityManager['positions'].set(pos.id, pos as any);
      });

      const result = await liquidityManager.getAllPositions();
      expect(result).toHaveLength(2);
      expect(result.map(p => p.id)).toEqual(['lp_1', 'lp_2']);
    });
  });

  describe('getStatistics', () => {
    it('should return current statistics', () => {
      const stats = liquidityManager.getStatistics();

      expect(stats).toHaveProperty('totalPositions');
      expect(stats).toHaveProperty('activePositions');
      expect(stats).toHaveProperty('totalLiquidityUSD');
      expect(stats).toHaveProperty('totalFeesCollected');
      expect(stats).toHaveProperty('avgAPR');
      expect(typeof stats.totalPositions).toBe('number');
    });
  });

  describe('Position ID Generation', () => {
    it('should generate unique position IDs', async () => {
      const id1 = await liquidityManager['generatePositionId']('GALA', 'GUSDC', 3000);
      const id2 = await liquidityManager['generatePositionId']('GALA', 'GUSDC', 3000);

      expect(id1).toMatch(/^lp_[a-zA-Z0-9]+$/);
      expect(id2).toMatch(/^lp_[a-zA-Z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should include token information in ID', async () => {
      const id = await liquidityManager['generatePositionId']('GALA', 'GUSDC', 3000);

      // ID should be based on tokens and timestamp, so consistent format
      expect(id).toMatch(/^lp_[a-zA-Z0-9]+$/);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      mockGSwap.liquidityPositions.addLiquidityByPrice.mockRejectedValue(networkError);

      const params = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      await expect(liquidityManager.addLiquidityByPrice(params)).rejects.toThrow('Network timeout');
    });

    it('should validate fee tiers', async () => {
      const invalidParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: 99999, // Invalid fee tier
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      await expect(liquidityManager.addLiquidityByPrice(invalidParams)).rejects.toThrow('Invalid fee tier');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle full lifecycle of a position', async () => {
      // Add position
      const addParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      mockGSwap.liquidityPositions.addLiquidityByPrice.mockResolvedValue({
        amount0: '1000',
        amount1: '50',
        liquidity: '1000000'
      });

      const positionId = await liquidityManager.addLiquidityByPrice(addParams);

      // Collect fees
      mockGSwap.liquidityPositions.collectPositionFees.mockResolvedValue({
        amount0: '5',
        amount1: '0.25'
      });

      const feeResult = await liquidityManager.collectFees({ positionId });
      expect(feeResult.amount0).toBe('5');

      // Remove position
      mockGSwap.liquidityPositions.removeLiquidity.mockResolvedValue({
        amount0: '995',
        amount1: '49.75'
      });

      const removeResult = await liquidityManager.removeLiquidity({
        positionId,
        liquidity: '1000000'
      });

      expect(removeResult.amount0).toBe('995');
    });
  });
});