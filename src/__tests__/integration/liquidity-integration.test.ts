/**
 * Liquidity Integration Tests
 * End-to-end testing of the complete liquidity infrastructure
 */

// ✅ FIX: Set environment variables BEFORE importing environment.ts
process.env.WALLET_PRIVATE_KEY = '0x' + '0'.repeat(64); // Valid 64-char hex private key
process.env.WALLET_ADDRESS = 'eth|test-wallet-address';
process.env.GALASWAP_API_URL = 'https://dex-backend-prod1.defi.gala.com';
process.env.GALASWAP_WS_URL = 'wss://bundle-backend-prod1.defi.gala.com';

import { TradingEngine } from '../../trading/TradingEngine';
import { BotConfig } from '../../config/environment';
import { TRADING_CONSTANTS } from '../../config/constants';
import { RetryHelper } from '../../utils/retry-helper';
import { GasEstimator } from '../../utils/gas-estimator';

// Mock the database initialization and repositories
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

// Mock utilities to prevent network calls and circuit breakers
jest.mock('../../utils/retry-helper');
jest.mock('../../utils/gas-estimator');

// Mock FeeCalculator to prevent initialization errors
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

// Mock additional services needed by TradingEngine
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

// Mock LiquidityManager with proper state tracking
const mockLiquidityState = {
  positions: new Map(),
  positionCounter: 0
};

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

// Mock MarketMakingStrategy to prevent initialization failures
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

// Mock RangeOrderStrategy methods with proper state tracking
const mockRangeOrderState = {
  orders: new Map(),
  orderCounter: 0
};

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

// Mock RebalanceEngine methods
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

// Mock the GSwap SDK
jest.mock('../../services/gswap-simple', () => ({
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


describe('Liquidity Integration Tests', () => {
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
        // ✅ SECURITY: Private key should come from environment variables
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
        logLevel: 'info',
        productionTestMode: false
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
      // Ignore stop errors in tests
    }
    jest.clearAllMocks();
  });

  describe('Engine Initialization', () => {
    it('should initialize trading engine with liquidity infrastructure', () => {
      expect(tradingEngine).toBeDefined();
      expect(tradingEngine['liquidityManager']).toBeDefined();
      expect(tradingEngine['positionTracker']).toBeDefined();
      expect(tradingEngine['feeCalculator']).toBeDefined();
      expect(tradingEngine['rebalanceEngine']).toBeDefined();
      expect(tradingEngine['rangeOrderStrategy']).toBeDefined();
      expect(tradingEngine['marketMakingStrategy']).toBeDefined();
    });

    it('should start engine with all liquidity components', async () => {
      await expect(tradingEngine.start()).resolves.toBeUndefined();
      expect(tradingEngine['isRunning']).toBe(true);
    });
  });

  describe('Range Order Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should place range order through trading engine', async () => {
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

      const result = await tradingEngine.placeRangeOrder(orderConfig);

      expect(result.success).toBe(true);
      expect(result.orderId).toMatch(/^ro_[a-zA-Z0-9_]+$/);
      expect(result.positionId).toBeDefined();
    });

    it('should cancel range order through trading engine', async () => {
      // First place an order
      const orderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy' as const,
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      };

      const placeResult = await tradingEngine.placeRangeOrder(orderConfig);
      expect(placeResult.success).toBe(true);

      // Then cancel it
      const cancelResult = await tradingEngine.cancelRangeOrder(placeResult.orderId!);
      expect(cancelResult.success).toBe(true);

      // Verify order status
      const orderStatus = tradingEngine.getRangeOrderStatus(placeResult.orderId!);
      expect(orderStatus?.status).toBe('cancelled');
    });

    it('should track range order statistics', async () => {
      // Place multiple orders
      const orderConfigs = [
        {
          token0: TRADING_CONSTANTS.TOKENS.GALA,
          token1: TRADING_CONSTANTS.TOKENS.GUSDC,
          fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
          direction: 'buy' as const,
          amount: '1000',
          targetPrice: 0.055,
          rangeWidth: 0.1,
          autoExecute: true
        },
        {
          token0: TRADING_CONSTANTS.TOKENS.GALA,
          token1: TRADING_CONSTANTS.TOKENS.GUSDC,
          fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
          direction: 'sell' as const,
          amount: '1000',
          targetPrice: 0.045,
          rangeWidth: 0.1,
          autoExecute: true
        }
      ];

      for (const config of orderConfigs) {
        await tradingEngine.placeRangeOrder(config);
      }

      const allOrders = tradingEngine.getAllRangeOrders();
      expect(allOrders).toHaveLength(2);

      const status = tradingEngine.getStatus();
      expect(status.strategies.rangeOrders.totalOrders).toBe(2);
      expect(status.strategies.rangeOrders.activeOrders).toBe(2);
    });
  });

  describe('Liquidity Position Management', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should add liquidity position through trading engine', async () => {
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

      const positionId = await tradingEngine.addLiquidityPosition(positionParams);

      expect(positionId).toMatch(/^lp_[a-zA-Z0-9]+$/);
    });

    it('should remove liquidity position through trading engine', async () => {
      // First add a position
      const positionParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      const positionId = await tradingEngine.addLiquidityPosition(positionParams);

      // Then remove it
      const removeResult = await tradingEngine.removeLiquidityPosition({
        positionId,
        liquidity: '1000000'
      });

      expect(removeResult.success).toBe(true);
      expect(removeResult.amount0).toBeDefined();
      expect(removeResult.amount1).toBeDefined();
    });

    it('should collect fees from position', async () => {
      // Add a position first
      const positionParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      const positionId = await tradingEngine.addLiquidityPosition(positionParams);

      // Collect fees
      const feeResult = await tradingEngine.collectPositionFees(positionId);

      expect(feeResult.success).toBe(true);
      expect(feeResult.amount0).toBe('5');
      expect(feeResult.amount1).toBe('0.25');
    });
  });

  describe('Portfolio Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should include liquidity positions in portfolio', async () => {
      // Add some positions
      const positionParams = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      };

      await tradingEngine.addLiquidityPosition(positionParams);

      // Place a range order
      const orderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy' as const,
        amount: '500',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      };

      await tradingEngine.placeRangeOrder(orderConfig);

      // Get portfolio
      const portfolio = await tradingEngine.getPortfolio();

      expect(portfolio.liquidityPositions).toHaveLength(1);
      expect(portfolio.rangeOrders).toHaveLength(1);
      expect(portfolio.marketMakingPositions).toBeDefined();
    });

    it('should provide comprehensive liquidity analytics', async () => {
      // Add multiple positions
      const positions = [
        {
          token0: TRADING_CONSTANTS.TOKENS.GALA,
          token1: TRADING_CONSTANTS.TOKENS.GUSDC,
          fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
          minPrice: 0.045,
          maxPrice: 0.055,
          amount0Desired: '1000',
          amount1Desired: '50'
        },
        {
          token0: TRADING_CONSTANTS.TOKENS.ETIME,
          token1: TRADING_CONSTANTS.TOKENS.GUSDC,
          fee: TRADING_CONSTANTS.FEE_TIERS.VOLATILE,
          minPrice: 0.9,
          maxPrice: 1.1,
          amount0Desired: '100',
          amount1Desired: '100'
        }
      ];

      for (const params of positions) {
        await tradingEngine.addLiquidityPosition(params);
      }

      const analytics = await tradingEngine.getLiquidityAnalytics();

      expect(analytics.totalPositions).toBe(2);
      expect(analytics.totalLiquidity).toBeGreaterThan(0);
      expect(analytics.positionPerformance).toHaveLength(2);
      expect(analytics.rangeOrderStats).toBeDefined();
      expect(analytics.marketMakingStats).toBeDefined();
    });
  });

  describe('Status Reporting Integration', () => {
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

    it('should track strategy performance metrics', async () => {
      // Add some activity
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
  });

  describe('Rebalancing Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should get rebalance recommendations', async () => {
      // Add a position that might need rebalancing
      await tradingEngine.addLiquidityPosition({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        minPrice: 0.045,
        maxPrice: 0.055,
        amount0Desired: '1000',
        amount1Desired: '50'
      });

      const recommendations = await tradingEngine.getRebalanceRecommendations();

      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('should execute manual rebalance', async () => {
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

      // Execute rebalance
      const rebalanceResult = await tradingEngine.executeManualRebalance(positionId, 'price_deviation');

      expect(rebalanceResult).toBeDefined();
    });
  });

  describe('Error Handling Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should handle liquidity manager errors gracefully', async () => {
      // Mock an error from the liquidity manager
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

    it('should handle range order errors gracefully', async () => {
      // Mock an error from the range order strategy
      jest.spyOn(tradingEngine['rangeOrderStrategy'], 'placeRangeOrder')
        .mockResolvedValue({
          success: false,
          error: 'Invalid price range'
        });

      const result = await tradingEngine.placeRangeOrder({
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid price range');
    });
  });

  describe('Trading Cycle Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    it('should execute liquidity management in trading cycle', async () => {
      // Add some positions
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

      // Get references to the mock functions from the created instances
      const rangeOrderStrategy = tradingEngine['rangeOrderStrategy'];
      const rebalanceEngine = tradingEngine['rebalanceEngine'];

      // Execute a trading cycle manually
      await tradingEngine['executeTradingCycle']();

      // Verify liquidity management was called on the mock instances
      expect(rangeOrderStrategy.updateOrderStatuses).toHaveBeenCalled();
      expect(rebalanceEngine.checkRebalanceSignals).toHaveBeenCalled();
    });
  });
});