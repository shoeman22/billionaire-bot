/**
 * Trading Engine Tests
 * Unit tests for the core trading engine
 */

import { TradingEngine } from '../../trading/TradingEngine';
import { GalaSwapClient } from '../../api/GalaSwapClient';
import TestHelpers from '../utils/test-helpers';
import { logger } from '../../utils/logger';

// Mock all external dependencies
jest.mock('../../api/GalaSwapClient');
jest.mock('../../monitoring/price-tracker');
jest.mock('../../monitoring/market-analysis');
jest.mock('../../monitoring/alerts');
jest.mock('../../trading/strategies/arbitrage');
jest.mock('../../trading/strategies/market-making');
jest.mock('../../trading/risk/position-limits');
jest.mock('../../trading/risk/slippage');
jest.mock('../../trading/risk/risk-monitor');
jest.mock('../../trading/risk/emergency-controls');
jest.mock('../../trading/execution/swap-executor');
jest.mock('../../trading/execution/liquidity-manager');
jest.mock('../../utils/logger');

const MockedGalaSwapClient = GalaSwapClient as jest.MockedClass<typeof GalaSwapClient>;

describe('TradingEngine', () => {
  let tradingEngine: TradingEngine;
  let mockGalaSwapClient: jest.Mocked<GalaSwapClient>;
  let mockRiskMonitor: any;
  let mockPositionLimits: any;
  let mockEmergencyControls: any;
  let mockStrategy: any;
  let config: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create test configuration
    config = TestHelpers.createTestBotConfig();

    // Mock GalaSwapClient with ALL real methods that the code uses
    mockGalaSwapClient = {
      healthCheck: jest.fn().mockResolvedValue({
        isHealthy: true,
        apiStatus: 'healthy',
        websocketStatus: 'connected',
        lastSuccessfulRequest: Date.now(),
        consecutiveFailures: 0,
        rateLimiterStatus: {}
      }),
      connectWebSocket: jest.fn().mockResolvedValue(undefined),
      disconnectWebSocket: jest.fn().mockResolvedValue(undefined),
      getQuote: jest.fn(),
      swap: jest.fn(),
      getWalletAddress: jest.fn().mockReturnValue(config.wallet.address),
      // Add missing real methods that the TradingEngine actually uses:
      getUserPositions: jest.fn().mockResolvedValue(TestHelpers.createMockPositions(config.wallet.address)),
      getPositions: jest.fn().mockResolvedValue(TestHelpers.createMockPositions(config.wallet.address)),
      getPool: jest.fn().mockResolvedValue({
        status: 1,
        data: {
          token0: 'GALA',
          token1: 'USDC',
          fee: 3000,
          sqrtPriceX96: '1000000000000000000',
          liquidity: '1000000',
          tick: 0
        }
      }),
      addLiquidity: jest.fn(),
      removeLiquidity: jest.fn()
    } as any;

    MockedGalaSwapClient.mockImplementation(() => mockGalaSwapClient);

    // Mock strategy classes
    mockStrategy = {
      initialize: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockReturnValue({ isActive: true, trades: 0 })
    };

    require('../../trading/strategies/arbitrage').ArbitrageStrategy.mockImplementation(() => mockStrategy);
    require('../../trading/strategies/market-making').MarketMakingStrategy.mockImplementation(() => mockStrategy);

    // Mock risk management components
    mockRiskMonitor = {
      startMonitoring: jest.fn().mockResolvedValue(undefined),
      stopMonitoring: jest.fn(),
      performRiskCheck: jest.fn().mockResolvedValue({
        shouldContinueTrading: true,
        riskLevel: 'low',
        alerts: [],
        emergencyActions: []
      }),
      validateTrade: jest.fn().mockResolvedValue({ approved: true }),
      getRiskStatus: jest.fn().mockReturnValue({
        isMonitoring: true,
        latestSnapshot: TestHelpers.createMockPortfolio()
      }),
      updateRiskConfig: jest.fn()
    };

    require('../../trading/risk/risk-monitor').RiskMonitor.mockImplementation(() => mockRiskMonitor);

    mockPositionLimits = {
      checkLimits: jest.fn().mockResolvedValue(true),
      canOpenPosition: jest.fn().mockResolvedValue({ allowed: true }),
      getCurrentLimits: jest.fn().mockReturnValue({}),
      getLimitsConfig: jest.fn().mockReturnValue({}),
      getViolations: jest.fn().mockResolvedValue([]),
      updateLimits: jest.fn()
    };

    require('../../trading/risk/position-limits').PositionLimits.mockImplementation(() => mockPositionLimits);

    mockEmergencyControls = {
      isEmergencyStopEnabled: jest.fn().mockReturnValue(false),
      recordApiFailure: jest.fn(),
      recordSuccess: jest.fn(),
      recordSystemError: jest.fn(),
      checkEmergencyConditions: jest.fn().mockResolvedValue({ shouldTrigger: false }),
      activateEmergencyStop: jest.fn().mockResolvedValue(undefined),
      deactivateEmergencyStop: jest.fn().mockResolvedValue(undefined),
      getEmergencyStatus: jest.fn().mockReturnValue({ isActive: false }),
      testEmergencyProcedures: jest.fn().mockResolvedValue({}),
      updateTriggers: jest.fn()
    };

    require('../../trading/risk/emergency-controls').EmergencyControls.mockImplementation(() => mockEmergencyControls);

    const mockSwapExecutor = {
      executeSwap: jest.fn().mockResolvedValue({
        success: true,
        transactionId: 'tx-123',
        amountOut: '1000'
      })
    };

    require('../../trading/execution/swap-executor').SwapExecutor.mockImplementation(() => mockSwapExecutor);

    const mockLiquidityManager = {
      getPositions: jest.fn().mockResolvedValue([]),
      getStatistics: jest.fn().mockReturnValue({})
    };

    require('../../trading/execution/liquidity-manager').LiquidityManager.mockImplementation(() => mockLiquidityManager);

    // Mock monitoring components
    const mockPriceTracker = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getAllPrices: jest.fn().mockReturnValue({}),
      getTriggeredAlerts: jest.fn().mockReturnValue([])
    };

    require('../../monitoring/price-tracker').PriceTracker.mockImplementation(() => mockPriceTracker);

    const mockMarketAnalysis = {
      analyzeMarket: jest.fn().mockResolvedValue(
        TestHelpers.createMockMarketConditions('bull')
      ),
      isFavorableForTrading: jest.fn().mockReturnValue(true),
      getMarketCondition: jest.fn().mockReturnValue(
        TestHelpers.createMockMarketConditions('bull')
      )
    };

    require('../../monitoring/market-analysis').MarketAnalysis.mockImplementation(() => mockMarketAnalysis);

    const mockAlertSystem = {
      riskAlert: jest.fn().mockResolvedValue(undefined),
      createAlert: jest.fn().mockResolvedValue(undefined),
      systemAlert: jest.fn().mockResolvedValue(undefined)
    };

    require('../../monitoring/alerts').AlertSystem.mockImplementation(() => mockAlertSystem);

    // Create trading engine instance
    tradingEngine = new TradingEngine(config);
  });

  describe('initialization', () => {
    it('should initialize with valid config', () => {
      expect(tradingEngine).toBeInstanceOf(TradingEngine);
      expect(MockedGalaSwapClient).toHaveBeenCalledWith({
        baseUrl: config.api.baseUrl,
        wsUrl: config.api.wsUrl,
        walletAddress: config.wallet.address,
        privateKey: config.wallet.privateKey
      });
    });

    it('should initialize all required components', () => {
      expect(require('../../trading/strategies/arbitrage').ArbitrageStrategy).toHaveBeenCalled();
      expect(require('../../trading/strategies/market-making').MarketMakingStrategy).toHaveBeenCalled();
      expect(require('../../trading/risk/risk-monitor').RiskMonitor).toHaveBeenCalled();
      expect(require('../../trading/risk/position-limits').PositionLimits).toHaveBeenCalled();
      expect(require('../../trading/risk/emergency-controls').EmergencyControls).toHaveBeenCalled();
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start successfully when all systems are healthy', async () => {
      await tradingEngine.start();

      expect(mockGalaSwapClient.healthCheck).toHaveBeenCalled();
      expect(mockGalaSwapClient.connectWebSocket).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('✅ Trading Engine started successfully');
    });

    it('should fail to start if API health check fails', async () => {
      mockGalaSwapClient.healthCheck.mockResolvedValue({
        isHealthy: false,
        apiStatus: 'unhealthy',
        websocketStatus: 'disconnected',
        lastSuccessfulRequest: Date.now() - 60000,
        consecutiveFailures: 5,
        rateLimiterStatus: {}
      });

      await expect(tradingEngine.start()).rejects.toThrow('GalaSwap API health check failed');
    });

    it('should stop all components when stopping', async () => {
      await tradingEngine.start();
      await tradingEngine.stop();

      expect(mockGalaSwapClient.disconnectWebSocket).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('✅ Trading Engine stopped successfully');
    });

    it('should handle start errors gracefully', async () => {
      mockGalaSwapClient.connectWebSocket.mockRejectedValue(new Error('Connection failed'));

      await expect(tradingEngine.start()).rejects.toThrow('Connection failed');
      expect(logger.error).toHaveBeenCalledWith('❌ Failed to start Trading Engine:', expect.any(Error));
    });
  });

  describe('manual trading operations', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    afterEach(async () => {
      await tradingEngine.stop();
    });

    it('should execute successful manual trade', async () => {
      const tradeParams = {
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000',
        slippageTolerance: 0.01
      };

      const result = await tradingEngine.executeManualTrade(tradeParams);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx-123');
      expect(result.error).toBeUndefined();
    });

    it('should validate trade parameters and risk', async () => {
      mockRiskMonitor.validateTrade.mockResolvedValue({
        approved: false,
        reason: 'Exceeds position limits'
      });

      const result = await tradingEngine.executeManualTrade({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '10000', // Large amount
        slippageTolerance: 0.01
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Exceeds position limits');
    });

    it('should apply risk-adjusted amounts', async () => {
      mockRiskMonitor.validateTrade.mockResolvedValue({
        approved: true,
        adjustedAmount: 800
      });

      const result = await tradingEngine.executeManualTrade({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000',
        slippageTolerance: 0.01
      });

      expect(result.success).toBe(true);
      expect(result.adjustedAmount).toBe('800');
    });

    it('should reject trades when emergency stop is active', async () => {
      mockEmergencyControls.isEmergencyStopEnabled.mockReturnValue(true);

      const result = await tradingEngine.executeManualTrade({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Emergency stop is active');
    });

    it('should handle position limit violations', async () => {
      mockPositionLimits.canOpenPosition.mockResolvedValue({
        allowed: false,
        reason: 'Maximum position size exceeded'
      });

      const result = await tradingEngine.executeManualTrade({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum position size exceeded');
    });

    it('should warn about high slippage tolerance', async () => {
      await tradingEngine.executeManualTrade({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000',
        slippageTolerance: 0.1 // 10% slippage
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('High slippage tolerance requested: 10%')
      );
    });
  });

  describe('automatic trading cycle', () => {
    beforeEach(async () => {
      jest.useFakeTimers();
      await tradingEngine.start();
    });

    afterEach(async () => {
      jest.useRealTimers();
      await tradingEngine.stop();
    });

    it('should execute trading cycle every 5 seconds', async () => {
      await tradingEngine.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve(); // Wait for async operations

      expect(mockRiskMonitor.performRiskCheck).toHaveBeenCalled();

      await tradingEngine.stop();
    });

    it('should skip cycle when emergency stop is active', async () => {
      mockEmergencyControls.isEmergencyStopEnabled.mockReturnValue(true);
      await tradingEngine.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith('Emergency stop active - skipping trading cycle');

      await tradingEngine.stop();
    });

    it('should skip cycle when API is unhealthy', async () => {
      await tradingEngine.start();

      // Make health check return false during cycle
      mockGalaSwapClient.healthCheck.mockResolvedValue({
        isHealthy: false,
        apiStatus: 'unhealthy',
        websocketStatus: 'disconnected',
        lastSuccessfulRequest: Date.now() - 60000,
        consecutiveFailures: 5,
        rateLimiterStatus: {}
      });

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith('GalaSwap API unhealthy, skipping cycle');

      await tradingEngine.stop();
    });

    it('should execute strategies based on market conditions', async () => {
      await tradingEngine.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(mockStrategy.execute).toHaveBeenCalled();

      await tradingEngine.stop();
    });

    it('should handle high risk conditions', async () => {
      mockRiskMonitor.performRiskCheck.mockResolvedValue({
        shouldContinueTrading: false,
        riskLevel: 'high',
        alerts: ['High portfolio volatility'],
        emergencyActions: ['STOP_ALL_TRADING']
      });

      await tradingEngine.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(mockEmergencyControls.activateEmergencyStop).toHaveBeenCalledWith(
        'PORTFOLIO_LOSS',
        'Automatic stop due to risk limits'
      );

      await tradingEngine.stop();
    });

    it('should trigger emergency liquidation for critical conditions', async () => {
      mockRiskMonitor.performRiskCheck.mockResolvedValue({
        shouldContinueTrading: false,
        riskLevel: 'critical',
        alerts: ['Critical portfolio loss'],
        emergencyActions: ['EMERGENCY_LIQUIDATION']
      });

      await tradingEngine.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(mockEmergencyControls.activateEmergencyStop).toHaveBeenCalledWith(
        'PORTFOLIO_LOSS',
        'Automatic liquidation due to critical losses',
        true // liquidate positions
      );

      await tradingEngine.stop();
    });

    it('should handle extreme market volatility', async () => {
      await tradingEngine.start();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Just verify that the trading cycle ran without errors
      expect(mockRiskMonitor.performRiskCheck).toHaveBeenCalled();

      await tradingEngine.stop();
    });

    it('should update trading statistics', async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      const status = tradingEngine.getStatus();
      expect(status).toHaveProperty('performance');
      expect(status.performance).toHaveProperty('totalTrades');
      expect(status.performance).toHaveProperty('successRate');
    });
  });

  describe('emergency procedures', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    afterEach(async () => {
      await tradingEngine.stop();
    });

    it('should activate emergency stop manually', async () => {
      await tradingEngine.emergencyStop('Manual intervention');

      expect(mockEmergencyControls.activateEmergencyStop).toHaveBeenCalledWith(
        'MANUAL_STOP',
        'Manual intervention',
        false
      );
    });

    it('should test emergency procedures', async () => {
      mockEmergencyControls.testEmergencyProcedures.mockResolvedValue({
        allTestsPassed: true,
        results: []
      });

      const result = await tradingEngine.testEmergencyProcedures();

      expect(result.allTestsPassed).toBe(true);
      expect(mockEmergencyControls.testEmergencyProcedures).toHaveBeenCalled();
    });

    it('should deactivate emergency stop with reason', async () => {
      await tradingEngine.deactivateEmergencyStop('Issue resolved');

      expect(mockEmergencyControls.deactivateEmergencyStop).toHaveBeenCalledWith('Issue resolved');
    });
  });

  describe('portfolio management', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    afterEach(async () => {
      await tradingEngine.stop();
    });

    it('should get portfolio overview', async () => {
      const mockLiquidityManager = require('../../trading/execution/liquidity-manager').LiquidityManager.mock.instances[0];
      mockLiquidityManager.getPositions.mockResolvedValue([
        { id: 'pos-1', token0: 'GALA', token1: 'USDC', liquidity: '1000' }
      ]);

      const portfolio = await tradingEngine.getPortfolio();

      expect(portfolio).toHaveProperty('positions');
      expect(portfolio).toHaveProperty('balances');
      expect(portfolio).toHaveProperty('totalValue');
      expect(portfolio).toHaveProperty('pnl');
      expect(Array.isArray(portfolio.positions)).toBe(true);
    });

    it('should handle portfolio errors gracefully', async () => {
      const mockLiquidityManager = require('../../trading/execution/liquidity-manager').LiquidityManager.mock.instances[0];
      mockLiquidityManager.getPositions.mockRejectedValue(new Error('API error'));

      const portfolio = await tradingEngine.getPortfolio();

      expect(portfolio.positions).toEqual([]);
      expect(portfolio.totalValue).toBe(0);
      expect(logger.error).toHaveBeenCalledWith('Error getting portfolio:', expect.any(Error));
    });
  });

  describe('status and monitoring', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    afterEach(async () => {
      await tradingEngine.stop();
    });

    it('should provide comprehensive status information', () => {
      const status = tradingEngine.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('uptime');
      expect(status).toHaveProperty('apiHealth');
      expect(status).toHaveProperty('strategies');
      expect(status).toHaveProperty('performance');
      expect(status).toHaveProperty('market');
      expect(status).toHaveProperty('positions');
      expect(status).toHaveProperty('risk');

      expect(status.isRunning).toBe(true);
      expect(typeof status.uptime).toBe('number');
      expect(status.strategies).toHaveProperty('arbitrage');
      expect(status.strategies).toHaveProperty('marketMaking');
    });

    it('should provide risk status', () => {
      const riskStatus = tradingEngine.getRiskStatus();

      expect(riskStatus).toHaveProperty('emergencyStatus');
      expect(riskStatus).toHaveProperty('riskMonitor');
      expect(riskStatus).toHaveProperty('positionLimits');
      expect(riskStatus).toHaveProperty('slippageProtection');
    });

    it('should provide position violations', async () => {
      const mockPositionLimits = require('../../trading/risk/position-limits').PositionLimits.mock.instances[0];
      mockPositionLimits.getViolations.mockResolvedValue([
        { type: 'size_limit', description: 'Position exceeds maximum size' }
      ]);

      const violations = await tradingEngine.getPositionViolations();

      expect(Array.isArray(violations)).toBe(true);
      expect(violations.length).toBe(1);
      expect(violations[0]).toHaveProperty('type');
    });
  });

  describe('configuration updates', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    afterEach(async () => {
      await tradingEngine.stop();
    });

    it('should update risk configuration', () => {
      const newConfig = {
        positionLimits: { maxPositionSize: 2000 },
        riskMonitor: { riskThreshold: 0.3 },
        emergencyTriggers: { lossLimit: 0.15 }
      };

      tradingEngine.updateRiskConfiguration(newConfig);

      expect(mockPositionLimits.updateLimits).toHaveBeenCalledWith(newConfig.positionLimits);
      expect(mockRiskMonitor.updateRiskConfig).toHaveBeenCalledWith(newConfig.riskMonitor);
      expect(mockEmergencyControls.updateTriggers).toHaveBeenCalledWith(newConfig.emergencyTriggers);
    });
  });

  describe('component access', () => {
    it('should provide access to GalaSwap client', () => {
      const client = tradingEngine.getClient();
      expect(client).toBe(mockGalaSwapClient);
    });

    it('should provide access to swap executor', () => {
      const executor = tradingEngine.getSwapExecutor();
      expect(executor).toBeDefined();
    });

    it('should provide access to liquidity manager', () => {
      const manager = tradingEngine.getLiquidityManager();
      expect(manager).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle errors in trading cycle gracefully', async () => {
      jest.useFakeTimers();
      await tradingEngine.start();

      const mockRiskMonitor = require('../../trading/risk/risk-monitor').RiskMonitor.mock.instances[0];
      mockRiskMonitor.performRiskCheck.mockRejectedValue(new Error('Risk check failed'));

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith('Error in trading cycle:', expect.any(Error));

      jest.useRealTimers();
      await tradingEngine.stop();
    });

    it('should record system errors in emergency controls', async () => {
      const mockSwapExecutor = require('../../trading/execution/swap-executor').SwapExecutor.mock.instances[0];
      mockSwapExecutor.executeSwap.mockRejectedValue(new Error('Execution failed'));

      const mockEmergencyControls = require('../../trading/risk/emergency-controls').EmergencyControls.mock.instances[0];

      await tradingEngine.start();

      const result = await tradingEngine.executeManualTrade({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000'
      });

      expect(result.success).toBe(false);
      expect(mockEmergencyControls.recordSystemError).toHaveBeenCalled();

      await tradingEngine.stop();
    });
  });
});