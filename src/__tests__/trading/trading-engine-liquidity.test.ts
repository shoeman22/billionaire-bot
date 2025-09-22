/**
 * TradingEngine Liquidity Integration Tests
 * Testing the complete integration of liquidity infrastructure with the trading engine
 */

import { TradingEngine } from '../../trading/TradingEngine';
import { BotConfig } from '../../config/environment';
import { TRADING_CONSTANTS } from '../../config/constants';
import { RetryHelper } from '../../utils/retry-helper';
import { GasEstimator } from '../../utils/gas-estimator';

// Mock environment variables
process.env.WALLET_PRIVATE_KEY = 'test-private-key-base64';
process.env.WALLET_ADDRESS = 'eth|test-wallet-address';

// Mock external dependencies
jest.mock('../../config/database', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  getPositionRepository: jest.fn().mockReturnValue({
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockReturnValue({}),
    update: jest.fn().mockResolvedValue({})
  }),
  getTradeRepository: jest.fn().mockReturnValue({
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockReturnValue({}),
    update: jest.fn().mockResolvedValue({})
  })
}));

jest.mock('../../utils/retry-helper');
jest.mock('../../utils/gas-estimator');

// Mock state for tracking positions and orders
const mockLiquidityState = {
  positions: new Map(),
  positionCounter: 0
};

const mockRangeOrderState = {
  orders: new Map(),
  orderCounter: 0
};

// Mock LiquidityManager with proper state tracking
jest.mock('../../services/liquidity-manager', () => ({
  LiquidityManager: jest.fn().mockImplementation(() => ({
    addLiquidityByPrice: jest.fn().mockImplementation(async (params) => {
      const positionId = `lp_test${++mockLiquidityState.positionCounter}`;

      const position = {
        id: positionId,
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        liquidity: '1000000',
        amount0: params.amount0Desired,
        amount1: params.amount1Desired,
        inRange: true,
        valueUSD: 100,
        liquidityValue: 1000,
        createdAt: new Date(),
        lastUpdate: Date.now()
      };

      mockLiquidityState.positions.set(positionId, position);
      return positionId;
    }),
    getPosition: jest.fn().mockImplementation((id) => {
      return mockLiquidityState.positions.get(id) || null;
    }),
    removeLiquidity: jest.fn().mockResolvedValue({
      success: true,
      amount0: '995',
      amount1: '49.5'
    }),
    collectFees: jest.fn().mockResolvedValue({
      success: true,
      amount0: '5',
      amount1: '0.25'
    }),
    getAllPositions: jest.fn().mockImplementation(async () => {
      return Array.from(mockLiquidityState.positions.values());
    }),
    getStatus: jest.fn().mockImplementation(() => {
      const positions = Array.from(mockLiquidityState.positions.values());
      return {
        totalPositions: positions.length,
        activePositions: positions.filter(p => p.inRange).length
      };
    }),
    // Add the gswap property that RangeOrderStrategy needs
    gswap: {
      pools: {
        getPoolData: jest.fn().mockResolvedValue({
          sqrtPrice: '1000000000000000000',
          liquidity: '5000000',
          volume24h: '100000'
        }),
        calculateSpotPrice: jest.fn().mockReturnValue('0.05')
      }
    }
  }))
}));

// Mock RangeOrderStrategy with proper state tracking
jest.mock('../../strategies/range-order-strategy', () => ({
  RangeOrderStrategy: jest.fn().mockImplementation(() => ({
    placeRangeOrder: jest.fn().mockImplementation(async (config) => {
      const orderId = `ro_test${++mockRangeOrderState.orderCounter}`;
      const positionId = `lp_test${mockRangeOrderState.orderCounter}`;

      const order = {
        orderId,
        status: 'active',
        config,
        positionId,
        createdAt: Date.now()
      };

      mockRangeOrderState.orders.set(orderId, order);

      return {
        success: true,
        orderId,
        positionId
      };
    }),
    cancelRangeOrder: jest.fn().mockImplementation(async (orderId) => {
      const order = mockRangeOrderState.orders.get(orderId);
      if (order) {
        order.status = 'cancelled';
        mockRangeOrderState.orders.set(orderId, order);
      }
      return { success: true };
    }),
    getOrderStatus: jest.fn().mockImplementation((orderId) => {
      const order = mockRangeOrderState.orders.get(orderId);
      return order ? { status: order.status } : null;
    }),
    getAllOrders: jest.fn().mockImplementation(() => {
      return Array.from(mockRangeOrderState.orders.values());
    }),
    getStatistics: jest.fn().mockImplementation(() => {
      const orders = Array.from(mockRangeOrderState.orders.values());
      const activeOrders = orders.filter(o => o.status === 'active').length;
      return {
        totalOrders: orders.length,
        activeOrders,
        successRate: orders.length > 0 ? 0.95 : 0
      };
    }),
    updateOrderStatuses: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockReturnValue(undefined)
  }))
}));

// Mock MarketMakingStrategy
jest.mock('../../strategies/market-making-strategy', () => ({
  MarketMakingStrategy: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue({
      isActive: true,
      totalPositions: 0,
      activeOrders: 0
    }),
    getActivePositions: jest.fn().mockResolvedValue([])
  }))
}));

// Mock RebalanceEngine
jest.mock('../../services/rebalance-engine', () => ({
  RebalanceEngine: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    checkRebalanceSignals: jest.fn().mockResolvedValue([]),
    executeRebalance: jest.fn().mockResolvedValue({
      success: true,
      transactionId: 'rebalance_test123'
    }),
    getStatus: jest.fn().mockReturnValue({
      isActive: false
    })
  }))
}));

// Mock FeeCalculator with proper state
jest.mock('../../services/fee-calculator', () => ({
  FeeCalculator: jest.fn().mockImplementation(() => ({
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
  }))
}));

// Mock the additional services needed by trading cycle
jest.mock('../../monitoring/market-analysis', () => ({
  MarketAnalysis: jest.fn().mockImplementation(() => ({
    analyzeMarket: jest.fn().mockResolvedValue({
      overall: 'bullish',
      confidence: 75,
      volatility: 'medium',
      liquidity: 'good',
      sentiment: 'optimistic',
      timestamp: Date.now()
    }),
    isFavorableForTrading: jest.fn().mockReturnValue(true),
    getMarketCondition: jest.fn().mockReturnValue({
      overall: 'bullish',
      confidence: 75,
      volatility: 'medium',
      liquidity: 'good',
      sentiment: 'optimistic',
      timestamp: Date.now()
    })
  }))
}));

jest.mock('../../trading/risk/risk-monitor', () => ({
  RiskMonitor: jest.fn().mockImplementation(() => ({
    performRiskCheck: jest.fn().mockResolvedValue({
      shouldContinueTrading: true,
      riskLevel: 'low',
      alerts: [],
      emergencyActions: []
    }),
    startMonitoring: jest.fn().mockResolvedValue(undefined),
    stopMonitoring: jest.fn().mockResolvedValue(undefined),
    getRiskStatus: jest.fn().mockReturnValue({
      isMonitoring: true,
      latestSnapshot: {
        riskMetrics: {
          riskScore: 0.25
        }
      }
    })
  }))
}));

// Mock ArbitrageStrategy
jest.mock('../../trading/strategies/arbitrage', () => ({
  ArbitrageStrategy: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue({
      isActive: true,
      totalTrades: 0,
      successfulTrades: 0,
      totalVolume: 0,
      averageSpread: 0
    })
  }))
}));

jest.mock('../../services/gswap-wrapper', () => ({
  GSwap: Object.assign(
    jest.fn().mockImplementation(() => ({
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
    {
      // Static properties/methods
      events: {
        connectEventSocket: jest.fn().mockResolvedValue(undefined),
        disconnectEventSocket: jest.fn().mockResolvedValue(undefined)
      }
    }
  ),
  PrivateKeySigner: jest.fn()
}));

describe('TradingEngine Liquidity Integration', () => {
  let tradingEngine: TradingEngine;
  let mockConfig: BotConfig;

  beforeEach(() => {
    // Reset mock state between tests
    mockLiquidityState.positions.clear();
    mockLiquidityState.positionCounter = 0;
    mockRangeOrderState.orders.clear();
    mockRangeOrderState.orderCounter = 0;

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

    mockConfig = {
      wallet: {
        address: 'eth|test-wallet-address',
        maxPositionSize: 10000
      },
      api: {
        baseUrl: 'https://test-api.example.com',
        wsUrl: 'wss://test-ws.example.com',
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
      },
      development: {
        nodeEnv: 'test',
        logLevel: 'error'
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
      // Get references to the mock instances
      const rangeOrderStrategy = tradingEngine['rangeOrderStrategy'];
      const rebalanceEngine = tradingEngine['rebalanceEngine'];

      // Execute trading cycle
      await tradingEngine['executeTradingCycle']();

      expect(rangeOrderStrategy.updateOrderStatuses).toHaveBeenCalled();
      expect(rebalanceEngine.checkRebalanceSignals).toHaveBeenCalled();
      expect(rangeOrderStrategy.cleanup).toHaveBeenCalled();
    });

    it('should handle rebalancing signals in trading cycle', async () => {
      const mockSignals = [
        {
          positionId: 'lp_test123',
          signalType: 'price_deviation' as const,
          strength: 0.8,
          confidence: 0.9,
          urgency: 'high' as const,
          trigger: {
            currentPrice: 0.048,
            targetPrice: 0.05,
            thresholdBreached: 0.02
          },
          timestamp: Date.now()
        },
        {
          positionId: 'lp_test456',
          signalType: 'low_utilization' as const,
          strength: 0.6,
          confidence: 0.7,
          urgency: 'medium' as const,
          trigger: {
            currentPrice: 0.045,
            thresholdBreached: 0.01,
            utilizationRate: 0.3
          },
          timestamp: Date.now()
        }
      ];

      const rebalanceEngine = tradingEngine['rebalanceEngine'];

      // Mock the responses for this test
      (rebalanceEngine.checkRebalanceSignals as jest.Mock).mockResolvedValueOnce(mockSignals);
      (rebalanceEngine.executeRebalance as jest.Mock).mockResolvedValueOnce(undefined);

      await tradingEngine['executeTradingCycle']();

      expect(rebalanceEngine.executeRebalance).toHaveBeenCalled();
      // Medium urgency signal should only execute in low risk conditions (not validated in this simplified test)
    });

    it('should collect optimal fees during trading cycle', async () => {
      // Add some positions
      const mockPositions = [
        { id: 'lp_1', liquidityValue: 1000 },
        { id: 'lp_2', liquidityValue: 2000 }
      ];

      const liquidityManager = tradingEngine['liquidityManager'];
      const feeCalculator = tradingEngine['feeCalculator'];
      const marketAnalysis = tradingEngine['marketAnalysis'];
      const riskMonitor = tradingEngine['riskMonitor'];

      // Clear any previous calls
      jest.clearAllMocks();

      // Mock the positions for this test
      (liquidityManager.getAllPositions as jest.Mock).mockResolvedValue(mockPositions as any);

      // Mock fee optimizations
      (feeCalculator.generateCollectionOptimization as jest.Mock)
        .mockResolvedValueOnce({
          positionId: 'lp_1',
          currentCollectionCost: 5,
          accruedFeesUSD: 45,
          optimalCollectionTime: new Date(),
          recommendation: 'collect_now',
          costBenefitRatio: 0.05,
          estimatedAdditionalYield: 0,
          gasCostThreshold: 10
        })
        .mockResolvedValueOnce({
          positionId: 'lp_2',
          currentCollectionCost: 15,
          accruedFeesUSD: 12,
          optimalCollectionTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
          recommendation: 'wait',
          costBenefitRatio: 0.8,
          estimatedAdditionalYield: 8,
          gasCostThreshold: 10
        });

      // Mock favorable conditions for fee collection
      (marketAnalysis.analyzeMarket as jest.Mock).mockResolvedValue({
        overall: 'bullish',
        confidence: 75,
        volatility: 'medium', // Not 'extreme' so fee collection proceeds
        liquidity: 'good',
        sentiment: 'optimistic',
        timestamp: Date.now()
      });

      (riskMonitor.performRiskCheck as jest.Mock).mockResolvedValue({
        shouldContinueTrading: true,
        riskLevel: 'low', // Not 'high' so fee collection proceeds
        alerts: [],
        emergencyActions: []
      });

      (liquidityManager.collectFees as jest.Mock).mockResolvedValue({
        success: true,
        amount0: '5',
        amount1: '0.25'
      });

      await tradingEngine['executeTradingCycle']();

      expect(liquidityManager.collectFees).toHaveBeenCalledWith({ positionId: 'lp_1' });
      expect(liquidityManager.collectFees).not.toHaveBeenCalledWith({ positionId: 'lp_2' });
    });

    it('should handle market making strategy execution', async () => {
      const marketMakingStrategy = tradingEngine['marketMakingStrategy'];
      const marketAnalysis = tradingEngine['marketAnalysis'];
      const riskMonitor = tradingEngine['riskMonitor'];

      // Mock favorable market conditions
      (marketAnalysis.analyzeMarket as jest.Mock).mockResolvedValueOnce({
        overall: 'bullish',
        confidence: 80,
        volatility: 'low',
        liquidity: 'good',
        sentiment: 'optimistic',
        timestamp: Date.now()
      });

      // Mock low risk conditions
      (riskMonitor.performRiskCheck as jest.Mock).mockResolvedValueOnce({
        shouldContinueTrading: true,
        riskLevel: 'low',
        alerts: [],
        emergencyActions: []
      });

      await tradingEngine['executeTradingCycle']();

      expect(marketMakingStrategy.execute).toHaveBeenCalled();
    });
  });

  describe('Market Condition Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should adapt liquidity strategies to market conditions', async () => {
      const marketMakingStrategy = tradingEngine['marketMakingStrategy'];
      const arbitrageStrategy = tradingEngine['arbitrageStrategy'];
      const marketAnalysis = tradingEngine['marketAnalysis'];
      const riskMonitor = tradingEngine['riskMonitor'];

      // Test low volatility conditions
      (marketAnalysis.analyzeMarket as jest.Mock).mockResolvedValueOnce({
        overall: 'sideways',
        confidence: 60,
        volatility: 'low',
        liquidity: 'good',
        sentiment: 'neutral',
        timestamp: Date.now()
      });

      (riskMonitor.performRiskCheck as jest.Mock).mockResolvedValueOnce({
        shouldContinueTrading: true,
        riskLevel: 'low',
        alerts: [],
        emergencyActions: []
      });

      await tradingEngine['executeTradingCycle']();

      expect(marketMakingStrategy.execute).toHaveBeenCalled();
      expect(arbitrageStrategy.execute).toHaveBeenCalled();
    });

    it('should reduce liquidity activity in extreme volatility', async () => {
      const marketMakingExecuteSpy = jest.spyOn(tradingEngine['marketMakingStrategy'], 'execute');
      const collectFeesSpy = jest.spyOn(tradingEngine['liquidityManager'], 'collectFees');

      // Mock extreme volatility
      jest.spyOn(tradingEngine['marketAnalysis'], 'analyzeMarket').mockResolvedValue({
        overall: 'bearish',
        confidence: 90,
        volatility: 'extreme',
        liquidity: 'poor',
        sentiment: 'fearful',
        timestamp: Date.now()
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
      const rebalanceEngine = tradingEngine['rebalanceEngine'];
      const riskMonitor = tradingEngine['riskMonitor'];

      // Mock high urgency rebalance signal
      const mockSignal = [
        {
          positionId: 'lp_test',
          signalType: 'price_deviation',
          strength: 0.9,
          confidence: 0.95,
          urgency: 'high',
          trigger: {
            currentPrice: 0.042,
            targetPrice: 0.05,
            thresholdBreached: 0.03
          },
          timestamp: Date.now()
        }
      ];

      // Test different risk levels
      const riskLevels = ['low', 'medium', 'high'] as const;

      for (const riskLevel of riskLevels) {
        (rebalanceEngine.checkRebalanceSignals as jest.Mock).mockResolvedValueOnce(mockSignal);
        (rebalanceEngine.executeRebalance as jest.Mock).mockResolvedValueOnce(undefined);

        (riskMonitor.performRiskCheck as jest.Mock).mockResolvedValueOnce({
          shouldContinueTrading: true,
          riskLevel,
          alerts: [],
          emergencyActions: []
        });

        await tradingEngine['executeTradingCycle']();

        if (riskLevel === 'low' || riskLevel === 'medium') {
          expect(rebalanceEngine.executeRebalance).toHaveBeenCalled();
        } else {
          expect(rebalanceEngine.executeRebalance).not.toHaveBeenCalled();
        }

        (rebalanceEngine.executeRebalance as jest.Mock).mockClear();
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
      expect(status.positions.liquidity.totalPositions).toBeGreaterThanOrEqual(1);
    });

    it('should include liquidity positions in portfolio reporting', async () => {
      // Add 2 liquidity positions to test proper portfolio reporting
      await tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      });

      await tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.050,
        maxPrice: 0.060,
        amount0Desired: '2000',
        amount1Desired: '100'
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

      expect(portfolio.liquidityPositions).toHaveLength(2); // Two positions added in this test
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
        .mockResolvedValueOnce(25);

      const analytics = await tradingEngine.getLiquidityAnalytics();

      // Should still provide analytics despite partial failures
      expect(analytics).toBeDefined();
      expect(analytics.totalPositions).toBeGreaterThanOrEqual(0);
    });
  });
});