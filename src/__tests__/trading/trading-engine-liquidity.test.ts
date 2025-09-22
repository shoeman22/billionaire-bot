/**
 * TradingEngine Liquidity Integration Tests
 * Testing the complete integration of liquidity infrastructure with the trading engine
 */

import { TradingEngine } from '../../trading/TradingEngine';
import { BotConfig } from '../../config/environment';
import { TRADING_CONSTANTS } from '../../config/constants';

// Mock environment variables
process.env.WALLET_PRIVATE_KEY = 'test-private-key-base64';
process.env.WALLET_ADDRESS = 'eth|test-wallet-address';

// Mock external dependencies
jest.mock('../../config/database', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../services/gswap-wrapper', () => {
  const mockGSwap = {
    events: {
      connectEventSocket: jest.fn().mockResolvedValue(undefined),
      disconnectEventSocket: jest.fn().mockResolvedValue(undefined)
    }
  };

  return {
    GSwap: jest.fn().mockImplementation(() => ({
      assets: {
        getUserAssets: jest.fn().mockResolvedValue({ assets: [] })
      },
      pools: {
        getPoolData: jest.fn().mockResolvedValue({
          sqrtPrice: '1000000000000000000',
          liquidity: '5000000',
          volume24h: '100000'
        }),
        calculateSpotPrice: jest.fn().mockReturnValue('0.05')
      },
      positions: {
        getUserPositions: jest.fn().mockResolvedValue({ positions: [] })
      },
      liquidityPositions: {
        addLiquidityByPrice: jest.fn().mockResolvedValue({
          success: true,
          transactionId: 'test-tx-123',
          positionNFT: 'test-nft-456'
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
        }),
        getPosition: jest.fn().mockReturnValue({
          id: 'test-position',
          minPrice: 0.045,
          maxPrice: 0.055,
          liquidity: '1000000'
        })
      }
    })),
    PrivateKeySigner: jest.fn(),
    ...mockGSwap
  };
});

describe('TradingEngine Liquidity Integration', () => {
  let tradingEngine: TradingEngine;
  let mockConfig: BotConfig;

  beforeEach(() => {
    mockConfig = {
      wallet: {
        address: 'eth|test-wallet-address',
        maxPositionSize: 10000
      },
      api: {
        baseUrl: 'https://test-api.example.com',
        maxRetries: 3,
        timeout: 30000
      },
      trading: {
        maxSlippage: 0.005,
        maxPositionSize: 5000,
        riskLevel: 'medium' as const,
        strategies: {
          arbitrage: { enabled: true, maxSpread: 0.02 },
          marketMaking: { enabled: true, rangeWidth: 0.05 }
        }
      }
    };

    tradingEngine = new TradingEngine(mockConfig);
  });

  afterEach(async () => {
    try {
      if (tradingEngine['isRunning']) {
        await tradingEngine.stop();
      }
    } catch (error) {
      // Ignore cleanup errors in tests
    }
    jest.clearAllMocks();
  });

  describe('Liquidity Strategy Initialization', () => {
    it('should initialize all liquidity components', () => {
      expect(tradingEngine['liquidityManager']).toBeDefined();
      expect(tradingEngine['positionTracker']).toBeDefined();
      expect(tradingEngine['feeCalculator']).toBeDefined();
      expect(tradingEngine['rebalanceEngine']).toBeDefined();
      expect(tradingEngine['rangeOrderStrategy']).toBeDefined();
      expect(tradingEngine['marketMakingStrategy']).toBeDefined();
    });

    it('should start liquidity infrastructure with engine', async () => {
      const positionTrackerStartSpy = jest.spyOn(tradingEngine['positionTracker'], 'start');
      const marketMakingInitSpy = jest.spyOn(tradingEngine['marketMakingStrategy'], 'initialize');
      const rebalanceInitSpy = jest.spyOn(tradingEngine['rebalanceEngine'], 'initialize');

      await tradingEngine.start();

      expect(positionTrackerStartSpy).toHaveBeenCalled();
      expect(marketMakingInitSpy).toHaveBeenCalled();
      expect(rebalanceInitSpy).toHaveBeenCalled();
    });

    it('should stop liquidity infrastructure with engine', async () => {
      await tradingEngine.start();

      const positionTrackerStopSpy = jest.spyOn(tradingEngine['positionTracker'], 'stop');
      const marketMakingStopSpy = jest.spyOn(tradingEngine['marketMakingStrategy'], 'stop');
      const rebalanceStopSpy = jest.spyOn(tradingEngine['rebalanceEngine'], 'stop');

      await tradingEngine.stop();

      expect(positionTrackerStopSpy).toHaveBeenCalled();
      expect(marketMakingStopSpy).toHaveBeenCalled();
      expect(rebalanceStopSpy).toHaveBeenCalled();
    });
  });

  describe('Trading Cycle Liquidity Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should execute liquidity management in trading cycle', async () => {
      // Spy on liquidity management methods
      const updateOrdersSpy = jest.spyOn(tradingEngine['rangeOrderStrategy'], 'updateOrderStatuses');
      const checkRebalanceSpy = jest.spyOn(tradingEngine['rebalanceEngine'], 'checkRebalanceSignals');
      const cleanupSpy = jest.spyOn(tradingEngine['rangeOrderStrategy'], 'cleanup');

      // Mock rebalance signals response
      checkRebalanceSpy.mockResolvedValue([]);

      // Execute trading cycle
      await tradingEngine['executeTradingCycle']();

      expect(updateOrdersSpy).toHaveBeenCalled();
      expect(checkRebalanceSpy).toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('should handle rebalancing signals in trading cycle', async () => {
      const mockSignals = [
        {
          positionId: 'lp_test123',
          signalType: 'price_deviation',
          strength: 0.8,
          urgency: 'high' as const,
          strategy: 'price_deviation'
        },
        {
          positionId: 'lp_test456',
          signalType: 'time_decay',
          strength: 0.6,
          urgency: 'medium' as const,
          strategy: 'time_based'
        }
      ];

      const checkRebalanceSpy = jest.spyOn(tradingEngine['rebalanceEngine'], 'checkRebalanceSignals');
      const executeRebalanceSpy = jest.spyOn(tradingEngine['rebalanceEngine'], 'executeRebalance');

      checkRebalanceSpy.mockResolvedValue(mockSignals);
      executeRebalanceSpy.mockResolvedValue({
        success: true,
        oldPositionId: 'lp_test123',
        newPositionId: 'lp_new123'
      });

      await tradingEngine['executeTradingCycle']();

      expect(executeRebalanceSpy).toHaveBeenCalledWith('lp_test123', 'price_deviation');
      // Medium urgency signal should only execute in low risk conditions
      expect(executeRebalanceSpy).not.toHaveBeenCalledWith('lp_test456', 'time_based');
    });

    it('should collect optimal fees during trading cycle', async () => {
      // Add some positions
      const mockPositions = [
        { id: 'lp_1', liquidityValue: 1000 },
        { id: 'lp_2', liquidityValue: 2000 }
      ];

      jest.spyOn(tradingEngine['liquidityManager'], 'getAllPositions').mockResolvedValue(mockPositions as any);

      // Mock fee optimizations
      const feeOptSpy = jest.spyOn(tradingEngine['feeCalculator'], 'generateCollectionOptimization');
      const collectFeesSpy = jest.spyOn(tradingEngine['liquidityManager'], 'collectFees');

      feeOptSpy
        .mockResolvedValueOnce({
          recommendation: 'collect_now',
          costBenefitRatio: 0.05,
          projectedSavings: 45
        })
        .mockResolvedValueOnce({
          recommendation: 'wait',
          costBenefitRatio: 0.8,
          daysUntilOptimal: 3
        });

      collectFeesSpy.mockResolvedValue({
        success: true,
        amount0: '5',
        amount1: '0.25'
      });

      await tradingEngine['executeTradingCycle']();

      expect(collectFeesSpy).toHaveBeenCalledWith({ positionId: 'lp_1' });
      expect(collectFeesSpy).not.toHaveBeenCalledWith({ positionId: 'lp_2' });
    });

    it('should handle market making strategy execution', async () => {
      const marketMakingExecuteSpy = jest.spyOn(tradingEngine['marketMakingStrategy'], 'execute');
      marketMakingExecuteSpy.mockResolvedValue({
        success: true,
        positionsCreated: 2,
        totalLiquidity: 5000
      });

      // Mock favorable market conditions
      jest.spyOn(tradingEngine['marketAnalysis'], 'analyzeMarket').mockResolvedValue({
        overall: 'bullish',
        confidence: 80,
        volatility: 'low',
        liquidity: 'good'
      });

      // Mock low risk conditions
      jest.spyOn(tradingEngine['riskMonitor'], 'performRiskCheck').mockResolvedValue({
        shouldContinueTrading: true,
        riskLevel: 'low',
        alerts: [],
        emergencyActions: []
      });

      await tradingEngine['executeTradingCycle']();

      expect(marketMakingExecuteSpy).toHaveBeenCalled();
    });
  });

  describe('Market Condition Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should adapt liquidity strategies to market conditions', async () => {
      const marketMakingExecuteSpy = jest.spyOn(tradingEngine['marketMakingStrategy'], 'execute');
      const arbitrageExecuteSpy = jest.spyOn(tradingEngine['arbitrageStrategy'], 'execute');

      // Test low volatility conditions
      jest.spyOn(tradingEngine['marketAnalysis'], 'analyzeMarket').mockResolvedValue({
        overall: 'neutral',
        confidence: 60,
        volatility: 'low',
        liquidity: 'good'
      });

      jest.spyOn(tradingEngine['riskMonitor'], 'performRiskCheck').mockResolvedValue({
        shouldContinueTrading: true,
        riskLevel: 'low',
        alerts: [],
        emergencyActions: []
      });

      await tradingEngine['executeTradingCycle']();

      expect(marketMakingExecuteSpy).toHaveBeenCalled();
      expect(arbitrageExecuteSpy).toHaveBeenCalled();
    });

    it('should reduce liquidity activity in extreme volatility', async () => {
      const marketMakingExecuteSpy = jest.spyOn(tradingEngine['marketMakingStrategy'], 'execute');
      const collectFeesSpy = jest.spyOn(tradingEngine['liquidityManager'], 'collectFees');

      // Mock extreme volatility
      jest.spyOn(tradingEngine['marketAnalysis'], 'analyzeMarket').mockResolvedValue({
        overall: 'bearish',
        confidence: 90,
        volatility: 'extreme',
        liquidity: 'poor'
      });

      jest.spyOn(tradingEngine['riskMonitor'], 'performRiskCheck').mockResolvedValue({
        shouldContinueTrading: true,
        riskLevel: 'medium',
        alerts: [],
        emergencyActions: []
      });

      await tradingEngine['executeTradingCycle']();

      expect(marketMakingExecuteSpy).not.toHaveBeenCalled();
      expect(collectFeesSpy).not.toHaveBeenCalled();
    });

    it('should execute strategies based on risk levels', async () => {
      const checkRebalanceSpy = jest.spyOn(tradingEngine['rebalanceEngine'], 'checkRebalanceSignals');
      const executeRebalanceSpy = jest.spyOn(tradingEngine['rebalanceEngine'], 'executeRebalance');

      // Mock high urgency rebalance signal
      checkRebalanceSpy.mockResolvedValue([
        {
          positionId: 'lp_test',
          signalType: 'price_deviation',
          strength: 0.9,
          urgency: 'high',
          strategy: 'emergency_exit'
        }
      ]);

      executeRebalanceSpy.mockResolvedValue({
        success: true,
        oldPositionId: 'lp_test',
        newPositionId: 'lp_new'
      });

      // Test different risk levels
      const riskLevels = ['low', 'medium', 'high'] as const;

      for (const riskLevel of riskLevels) {
        jest.spyOn(tradingEngine['riskMonitor'], 'performRiskCheck').mockResolvedValue({
          shouldContinueTrading: true,
          riskLevel,
          alerts: [],
          emergencyActions: []
        });

        await tradingEngine['executeTradingCycle']();

        if (riskLevel === 'low' || riskLevel === 'medium') {
          expect(executeRebalanceSpy).toHaveBeenCalledWith('lp_test', 'emergency_exit');
        } else {
          expect(executeRebalanceSpy).not.toHaveBeenCalled();
        }

        executeRebalanceSpy.mockClear();
      }
    });
  });

  describe('API Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should integrate range orders with trading engine API', async () => {
      const orderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy' as const,
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true,
        slippageTolerance: 0.005
      };

      // Test placing order
      const placeResult = await tradingEngine.placeRangeOrder(orderConfig);
      expect(placeResult.success).toBe(true);
      expect(placeResult.orderId).toBeDefined();

      // Test getting order status
      const orderStatus = tradingEngine.getRangeOrderStatus(placeResult.orderId!);
      expect(orderStatus).toBeDefined();
      expect(orderStatus?.status).toBe('active');

      // Test getting all orders
      const allOrders = tradingEngine.getAllRangeOrders();
      expect(allOrders).toHaveLength(1);

      // Test canceling order
      const cancelResult = await tradingEngine.cancelRangeOrder(placeResult.orderId!);
      expect(cancelResult.success).toBe(true);
    });

    it('should integrate liquidity positions with trading engine API', async () => {
      const positionParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50',
        slippageTolerance: 0.005
      };

      // Test adding position
      const positionId = await tradingEngine.addLiquidityPosition(positionParams);
      expect(positionId).toMatch(/^lp_[a-zA-Z0-9]+$/);

      // Test fee analysis
      const feeAnalysis = await tradingEngine.getPositionFeeAnalysis(positionId);
      expect(feeAnalysis).toBeDefined();

      // Test collecting fees
      const collectResult = await tradingEngine.collectPositionFees(positionId);
      expect(collectResult.success).toBe(true);

      // Test removing position
      const removeResult = await tradingEngine.removeLiquidityPosition({
        positionId,
        liquidity: '1000000'
      });
      expect(removeResult.success).toBe(true);
    });

    it('should provide comprehensive analytics API', async () => {
      // Add some positions and orders
      await tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      });

      await tradingEngine.placeRangeOrder({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '500',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      });

      // Test analytics
      const analytics = await tradingEngine.getLiquidityAnalytics();

      expect(analytics.totalPositions).toBeGreaterThan(0);
      expect(analytics.totalLiquidity).toBeGreaterThan(0);
      expect(analytics.positionPerformance).toBeDefined();
      expect(analytics.rangeOrderStats).toBeDefined();
      expect(analytics.marketMakingStats).toBeDefined();
    });

    it('should integrate rebalancing with trading engine API', async () => {
      // Add a position
      const positionId = await tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      });

      // Test rebalance recommendations
      const recommendations = await tradingEngine.getRebalanceRecommendations();
      expect(Array.isArray(recommendations)).toBe(true);

      // Test manual rebalance
      const rebalanceResult = await tradingEngine.executeManualRebalance(positionId, 'price_deviation');
      expect(rebalanceResult).toBeDefined();
    });
  });

  describe('Status and Monitoring Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should include liquidity metrics in engine status', () => {
      const status = tradingEngine.getStatus();

      expect(status.strategies).toHaveProperty('marketMaking');
      expect(status.strategies).toHaveProperty('rangeOrders');
      expect(status.positions).toHaveProperty('liquidity');
      expect(status.positions).toHaveProperty('tracker');
      expect(status.positions).toHaveProperty('rebalancing');
    });

    it('should track liquidity performance metrics', async () => {
      // Add activity to track
      await tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      });

      await tradingEngine.placeRangeOrder({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '500',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      });

      const status = tradingEngine.getStatus();

      expect(status.strategies.rangeOrders.totalOrders).toBe(1);
      expect(status.strategies.rangeOrders.activeOrders).toBe(1);
      expect(status.positions.liquidity.totalPositions).toBe(1);
    });

    it('should include liquidity positions in portfolio reporting', async () => {
      // Add positions
      await tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      });

      await tradingEngine.placeRangeOrder({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'sell',
        amount: '500',
        targetPrice: 0.045,
        rangeWidth: 0.1,
        autoExecute: true
      });

      const portfolio = await tradingEngine.getPortfolio();

      expect(portfolio.liquidityPositions).toHaveLength(1);
      expect(portfolio.rangeOrders).toHaveLength(1);
      expect(portfolio.marketMakingPositions).toBeDefined();
      expect(portfolio.totalValue).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling and Resilience', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should handle liquidity management errors gracefully in trading cycle', async () => {
      // Mock errors in liquidity components
      jest.spyOn(tradingEngine['rangeOrderStrategy'], 'updateOrderStatuses')
        .mockRejectedValue(new Error('Range order update failed'));

      jest.spyOn(tradingEngine['rebalanceEngine'], 'checkRebalanceSignals')
        .mockRejectedValue(new Error('Rebalance check failed'));

      // Trading cycle should continue despite errors
      await expect(tradingEngine['executeTradingCycle']()).resolves.toBeUndefined();
    });

    it('should handle API errors in liquidity operations', async () => {
      // Mock SDK errors
      jest.spyOn(tradingEngine['liquidityManager'], 'addLiquidityByPrice')
        .mockRejectedValue(new Error('Insufficient balance'));

      await expect(tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      })).rejects.toThrow('Insufficient balance');
    });

    it('should maintain system stability during partial failures', async () => {
      // Mock partial failures
      jest.spyOn(tradingEngine['feeCalculator'], 'calculateAccruedFees')
        .mockRejectedValueOnce(new Error('Fee calculation failed'))
        .mockResolvedValueOnce({
          success: true,
          positionId: 'lp_test',
          totalFeesUSD: 25,
          estimatedAPR: 15,
          timeInRangePercentage: 80,
          feeBreakdown: { amount0: '12.5', amount1: '0.625' }
        });

      const analytics = await tradingEngine.getLiquidityAnalytics();

      // Should still provide analytics despite partial failures
      expect(analytics).toBeDefined();
      expect(analytics.totalPositions).toBeGreaterThanOrEqual(0);
    });
  });
});