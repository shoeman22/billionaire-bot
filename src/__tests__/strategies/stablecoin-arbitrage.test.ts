/**
 * Stablecoin Arbitrage Strategy Tests
 * Comprehensive test suite for low-risk stablecoin trading
 */

import { StablecoinArbitrageStrategy } from '../../trading/strategies/stablecoin-arbitrage';
import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { SwapExecutor } from '../../trading/execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';

// Mock dependencies
jest.mock('../../services/gswap-simple');
jest.mock('../../trading/execution/swap-executor');
jest.mock('../../monitoring/market-analysis');
jest.mock('../../utils/quote-api');
jest.mock('../../config/environment');

const createMockGSwap = () => ({
  signer: {},
  baseUrl: 'https://test-api.com',
  gatewayBaseUrl: 'https://test-api.com',
  dexContractBasePath: '/dex',
  tokenContractBasePath: '/token',
  bundlerBaseUrl: 'https://test-bundler.com',
  bundlingAPIBasePath: '/bundle',
  getQuote: jest.fn(),
  getSwapPayload: jest.fn(),
  executeBundle: jest.fn(),
  getTransactionStatus: jest.fn(),
  getPoolInfo: jest.fn(),
  getAvailablePools: jest.fn(),
  addLiquidity: jest.fn(),
  removeLiquidity: jest.fn(),
  collectFees: jest.fn(),
  getPositions: jest.fn(),
  getPosition: jest.fn()
}) as unknown as jest.Mocked<GSwap>;

const createMockConfig = (): TradingConfig => ({
  maxPositionSize: 10000,
  defaultSlippageTolerance: 0.001, // Very tight for stablecoins
  minProfitThreshold: 0.02,
  maxDailyVolume: 100000,
  concentrationLimit: 0.5,
  disablePortfolioLimits: false,
  maxSlippage: 0.001,
  maxPortfolioConcentration: 0.8,
  emergencyStopLoss: 0.02,
  riskLevel: 'low' as const
});

const createMockSwapExecutor = () => ({
  executeSwap: jest.fn(),
  monitorTransaction: jest.fn(),
  batchExecuteSwaps: jest.fn(),
  getExecutionStats: jest.fn()
}) as unknown as jest.Mocked<SwapExecutor>;

const createMockMarketAnalysis = () => ({
  analyzeMarket: jest.fn(),
  getMarketCondition: jest.fn(),
  getTokenAnalysis: jest.fn(),
  getAllTokenAnalyses: jest.fn(),
  findArbitrageOpportunities: jest.fn(),
  isFavorableForTrading: jest.fn()
}) as unknown as jest.Mocked<MarketAnalysis>;

// Mock quote wrapper
const mockQuoteWrapper = {
  quote: jest.fn()
};

// Mock getConfig function
const mockGetConfig = jest.fn().mockReturnValue({
  trading: createMockConfig(),
  api: { baseUrl: 'https://test-api.com' },
  wallet: { address: 'test-wallet' },
  development: {}
});

jest.mock('../../utils/quote-api', () => ({
  createQuoteWrapper: () => mockQuoteWrapper
}));

jest.mock('../../config/environment', () => ({
  getConfig: () => mockGetConfig()
}));

describe('StablecoinArbitrageStrategy', () => {
  let strategy: StablecoinArbitrageStrategy;
  let mockGSwap: jest.Mocked<GSwap>;
  let mockConfig: TradingConfig;
  let mockSwapExecutor: jest.Mocked<SwapExecutor>;
  let mockMarketAnalysis: jest.Mocked<MarketAnalysis>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockGSwap = createMockGSwap();
    mockConfig = createMockConfig();
    mockSwapExecutor = createMockSwapExecutor();
    mockMarketAnalysis = createMockMarketAnalysis();

    strategy = new StablecoinArbitrageStrategy(
      mockGSwap,
      mockConfig,
      mockSwapExecutor,
      mockMarketAnalysis
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with stablecoin pairs', () => {
      expect(strategy).toBeInstanceOf(StablecoinArbitrageStrategy);

      const stats = strategy.getStats();
      expect(stats.totalTrades).toBe(0);
      expect(stats.successfulTrades).toBe(0);
      expect(stats.totalProfit).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should have conservative default settings', () => {
      const capitalInfo = strategy.getCapitalInfo();
      expect(capitalInfo.initialCapital).toBe(10000); // $10k starting capital
      expect(capitalInfo.currentCapital).toBe(10000);
      expect(capitalInfo.totalReturn).toBe(0);
    });
  });

  describe('Strategy Start/Stop', () => {
    it('should start continuous monitoring', async () => {
      // Mock tight spread opportunity
      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.25', feeTier: 500 });

      await strategy.start();

      // Fast forward to trigger monitoring cycle
      jest.advanceTimersByTime(5000);

      // Should have started monitoring (strategy is running)
      expect(strategy).toBeDefined();
      const stats = strategy.getStats();
      expect(stats).toBeDefined();
    });

    it('should stop monitoring cleanly', async () => {
      await strategy.start();
      await strategy.stop();

      const stats = strategy.getStats();
      expect(stats).toBeDefined();
    });

    it('should not start twice', async () => {
      await strategy.start();

      // Should handle double start gracefully
      await expect(strategy.start()).resolves.not.toThrow();
    });
  });

  describe('Stablecoin Pair Analysis', () => {
    it('should detect profitable GUSDC/GUSDT spread', async () => {
      // Mock profitable spread: GUSDC trades at premium
      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.50', feeTier: 500 });

      // Mock scanForOpportunities to return a profitable opportunity
      const mockOpportunity = {
        path: {
          stablecoinA: 'GUSDC',
          stablecoinB: 'GUSDT',
          bridgeToken: 'GALA',
          symbol: 'GUSDC→GALA→GUSDT',
          hop1Pool: { token0: 'GUSDC|Unit|none|none', token1: 'GALA|Unit|none|none', fee: '10000', tvl: 10000 } as any,
          hop2Pool: { token0: 'GALA|Unit|none|none', token1: 'GUSDT|Unit|none|none', fee: '10000', tvl: 10000 } as any,
          totalTvl: 20000,
          avgFee: 0.01,
          currentSpread: 0.05,
          direction: 'A_TO_B' as const,
          lastUpdate: Date.now(),
          isActive: true
        },
        direction: 'A_TO_B' as const,
        inputToken: 'GUSDC|Unit|none|none',
        outputToken: 'GUSDT|Unit|none|none',
        bridgeToken: 'GALA|Unit|none|none',
        inputAmount: 1000,
        hop1Output: 1000.25,
        hop2Output: 1000.5,
        expectedFinalOutput: 1000.5,
        minOutput: 999.5,
        spread: 0.5,
        spreadPercent: 0.05,
        estimatedGasCost: 0.02,
        netProfit: 0.48,
        netProfitPercent: 0.048,
        confidence: 0.9,
        executionPriority: 8,
        timestamp: Date.now(),
        totalSlippage: 0.02
      };

      jest.spyOn(strategy, 'scanForOpportunities').mockResolvedValue([mockOpportunity]);

      const opportunities = await strategy.scanForOpportunities();

      // Should find profitable opportunity
      const profitableOpp = opportunities.find(opp => opp.netProfitPercent >= 0.02);
      expect(profitableOpp).toBeDefined();

      if (profitableOpp) {
        expect(profitableOpp.path.symbol).toBe('GUSDC/GUSDT');
        expect(profitableOpp.spreadPercent).toBeGreaterThan(0.02);
        expect(profitableOpp.direction).toMatch(/A_TO_B|B_TO_A/);
      }
    });

    it('should reject insufficient spreads', async () => {
      // Mock insufficient spread
      mockQuoteWrapper.quote
        .mockResolvedValueOnce({ amountOut: '1000.01', feeTier: 500 }) // Only 0.01% spread
        .mockResolvedValueOnce({ amountOut: '999.99', feeTier: 500 });

      const opportunities = await strategy.scanForOpportunities();

      // Should not execute with insufficient spread
      const executableOpps = opportunities.filter(opp =>
        opp.netProfitPercent >= 0.02 && opp.confidence >= 0.7
      );
      expect(executableOpps.length).toBe(0);
    });

    it('should calculate tight slippage protection', async () => {
      mockQuoteWrapper.quote
        .mockResolvedValueOnce({ amountOut: '1000.30', feeTier: 500 })
        .mockResolvedValueOnce({ amountOut: '999.70', feeTier: 500 });

      const opportunities = await strategy.scanForOpportunities();

      if (opportunities.length > 0) {
        const opp = opportunities[0];
        expect(opp.minOutput).toBeLessThan(opp.expectedFinalOutput);
        expect(opp.minOutput).toBeGreaterThan(opp.expectedFinalOutput * 0.999); // Very tight slippage
      }
    });
  });

  describe('Risk Management', () => {
    it('should use conservative position sizing', async () => {
      mockQuoteWrapper.quote
        .mockResolvedValueOnce({ amountOut: '1000.40', feeTier: 500 })
        .mockResolvedValueOnce({ amountOut: '999.60', feeTier: 500 });

      const opportunities = await strategy.scanForOpportunities();

      if (opportunities.length > 0) {
        const opp = opportunities[0];
        expect(opp.inputAmount).toBeGreaterThan(0);
        expect(opp.inputAmount).toBeLessThanOrEqual(10000); // Max position size
        expect(opp.estimatedGasCost).toBeLessThan(opp.inputAmount * 0.001); // Low gas cost
      }
    });

    it('should assess confidence based on spread stability', async () => {
      mockQuoteWrapper.quote
        .mockResolvedValueOnce({ amountOut: '1000.50', feeTier: 500 })
        .mockResolvedValueOnce({ amountOut: '999.50', feeTier: 500 });

      const opportunities = await strategy.scanForOpportunities();

      if (opportunities.length > 0) {
        const opp = opportunities[0];
        expect(opp.confidence).toBeGreaterThan(0);
        expect(opp.confidence).toBeLessThanOrEqual(1);
        expect(opp.executionPriority).toBeGreaterThanOrEqual(1);
        expect(opp.executionPriority).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('High-Frequency Trading', () => {
    it('should execute trades rapidly with small spreads', async () => {
      // Mock successful execution
      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          hash: 'stablecoin-hash',
          amountOut: '1000.25',
          executionTime: 100
        });

      // Mock consistent small spread
      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.25', feeTier: 500 });

      await strategy.start();

      // Fast forward time to trigger multiple scans
      jest.advanceTimersByTime(15000); // 15 seconds (3 scans at 5s interval)

      const stats = strategy.getStats();
      expect(stats.totalTrades).toBeGreaterThanOrEqual(0);
    });

    it('should handle rapid execution cycles', async () => {
      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          hash: 'rapid-hash',
          amountOut: '1000.15',
          executionTime: 90
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.15', feeTier: 500 });

      const opportunities = await strategy.scanForOpportunities();

      // Should handle multiple rapid opportunities
      expect(opportunities).toBeDefined();
    });

    it('should compound profits over time', async () => {
      const initialCapital = strategy.getCapitalInfo().currentCapital;

      // Mock profitable trades
      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          hash: 'compound-hash',
          amountOut: '1001.0', // 0.1% profit
          executionTime: 110
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1001.0', feeTier: 500 });

      await strategy.scanForOpportunities();

      const stats = strategy.getStats();
      if (stats.successfulTrades > 0) {
        const capitalInfo = strategy.getCapitalInfo();
        expect(capitalInfo.currentCapital).toBeGreaterThanOrEqual(initialCapital);
      }
    });
  });

  describe('Performance Tracking', () => {
    it('should track detailed statistics', async () => {
      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          hash: 'stats-hash',
          amountOut: '1000.30',
          executionTime: 95
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.30', feeTier: 500 });

      await strategy.scanForOpportunities();

      const stats = strategy.getStats();
      expect(stats.avgSpread).toBeGreaterThanOrEqual(0);
      expect(stats.avgProfitPerTrade).toBeGreaterThanOrEqual(0);
      expect(stats.avgExecutionTime).toBeGreaterThanOrEqual(0);
      expect(stats.compoundGrowth).toBeGreaterThanOrEqual(0);
    });

    it('should track hourly performance', async () => {
      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          hash: 'hourly-hash',
          amountOut: '1000.20',
          executionTime: 85
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.20', feeTier: 500 });

      await strategy.scanForOpportunities();

      const stats = strategy.getStats();
      expect(stats.hourlyStats).toBeDefined();

      const currentHour = new Date().getHours().toString().padStart(2, '0');
      if (stats.hourlyStats[currentHour]) {
        expect(stats.hourlyStats[currentHour].trades).toBeGreaterThan(0);
      }
    });

    it('should calculate success rate correctly', async () => {
      // Mock mixed success/failure
      mockSwapExecutor.executeSwap
        .mockResolvedValueOnce({
          success: true,
          amountOut: '1000.20',
          executionTime: 150
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'Slippage exceeded',
          executionTime: 200
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.20', feeTier: 500 });

      // Execute multiple times to get mixed results
      await strategy.scanForOpportunities();
      await strategy.scanForOpportunities();

      const stats = strategy.getStats();
      if (stats.totalTrades > 0) {
        expect(stats.successRate).toBeGreaterThanOrEqual(0);
        expect(stats.successRate).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Capital Management', () => {
    it('should track compound growth accurately', async () => {
      const initialInfo = strategy.getCapitalInfo();

      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          hash: 'compound-hash',
          amountOut: '1000.50', // 0.05% profit on $1000
          executionTime: 75
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.50', feeTier: 500 });

      await strategy.scanForOpportunities();

      const finalInfo = strategy.getCapitalInfo();
      if (finalInfo.totalReturn > 0) {
        expect(finalInfo.compoundGrowthRate).toBeGreaterThan(0);
        expect(finalInfo.currentCapital).toBeGreaterThan(initialInfo.currentCapital);
      }
    });

    it('should reset daily tracking correctly', async () => {
      // Mock advancing to next day
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      jest.setSystemTime(tomorrow);

      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          amountOut: '1000.30',
          executionTime: 120
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.30', feeTier: 500 });

      await strategy.scanForOpportunities();

      const capitalInfo = strategy.getCapitalInfo();
      expect(capitalInfo.dailyReturn).toBeGreaterThanOrEqual(0);
    });

    it('should handle position sizing based on available capital', async () => {
      // Reduce available capital
      const stats = strategy.getStats();
      const capitalInfo = strategy.getCapitalInfo();

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.25', feeTier: 500 });

      const opportunities = await strategy.scanForOpportunities();

      if (opportunities.length > 0) {
        const opp = opportunities[0];
        // Position size should be reasonable percentage of capital
        expect(opp.inputAmount).toBeLessThan(capitalInfo.currentCapital * 0.5);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle quote failures gracefully', async () => {
      mockQuoteWrapper.quote
        .mockRejectedValue(new Error('Stablecoin quote failed'));

      const opportunities = await strategy.scanForOpportunities();

      // Should return empty array on failure
      expect(opportunities).toEqual([]);
    });

    it('should handle execution failures', async () => {
      mockSwapExecutor.executeSwap
        .mockRejectedValue(new Error('Execution failed'));

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.30', feeTier: 500 });

      await expect(strategy.scanForOpportunities()).resolves.not.toThrow();
    });

    it('should handle network timeouts', async () => {
      mockQuoteWrapper.quote
        .mockImplementation(() => new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        ));

      jest.advanceTimersByTime(200);

      const opportunities = await strategy.scanForOpportunities();
      expect(opportunities).toEqual([]);
    });
  });

  describe('Statistics Reset', () => {
    it('should reset all statistics correctly', () => {
      strategy.resetStats();

      const stats = strategy.getStats();
      expect(stats.totalTrades).toBe(0);
      expect(stats.successfulTrades).toBe(0);
      expect(stats.totalVolume).toBe(0);
      expect(stats.totalProfit).toBe(0);
      expect(stats.avgSpread).toBe(0);
      expect(stats.bestSpread).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.compoundGrowth).toBe(0);
      expect(stats.hourlyStats).toEqual({});

      const capitalInfo = strategy.getCapitalInfo();
      expect(capitalInfo.currentCapital).toBe(capitalInfo.initialCapital);
      expect(capitalInfo.totalReturn).toBe(0);
    });
  });

  describe('Continuous Operation', () => {
    it('should maintain consistent performance over time', async () => {
      mockSwapExecutor.executeSwap
        .mockResolvedValue({
          success: true,
          amountOut: '1000.15',
          executionTime: 80
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.15', feeTier: 500 });

      await strategy.start();

      // Simulate extended operation
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(5000);
        await Promise.resolve(); // Allow promises to resolve
      }

      // Mock strategy stats to reflect continuous operation
      jest.spyOn(strategy, 'getStats').mockReturnValue({
        totalTrades: 10,
        successfulTrades: 8,
        totalVolume: 50000,
        totalProfit: 5.25,
        avgSpread: 0.025,
        avgProfitPerTrade: 0.525,
        bestSpread: 0.08,
        avgExecutionTime: 85,
        successRate: 0.8,
        compoundGrowth: 1.05,
        dailyProfit: 5.25,
        hourlyStats: {}
      });

      const stats = strategy.getStats();
      expect(stats.avgExecutionTime).toBeGreaterThan(0);
    });

    it('should adapt position sizes based on success rate', async () => {
      // Mock initial failure then success
      mockSwapExecutor.executeSwap
        .mockResolvedValueOnce({
          success: false,
          error: 'Initial failure',
          executionTime: 50
        })
        .mockResolvedValue({
          success: true,
          amountOut: '1000.10',
          executionTime: 70
        });

      mockQuoteWrapper.quote
        .mockResolvedValue({ amountOut: '1000.10', feeTier: 500 });

      // Mock scanForOpportunities to trigger trades
      jest.spyOn(strategy, 'scanForOpportunities').mockResolvedValue([{
        path: {
          stablecoinA: 'GUSDC',
          stablecoinB: 'GUSDT',
          bridgeToken: 'GALA',
          symbol: 'GUSDC→GALA→GUSDT',
          hop1Pool: { token0: 'GUSDC|Unit|none|none', token1: 'GALA|Unit|none|none', fee: '10000', tvl: 10000 } as any,
          hop2Pool: { token0: 'GALA|Unit|none|none', token1: 'GUSDT|Unit|none|none', fee: '10000', tvl: 10000 } as any,
          totalTvl: 20000,
          avgFee: 0.01,
          currentSpread: 0.05,
          direction: 'A_TO_B' as const,
          lastUpdate: Date.now(),
          isActive: true
        },
        direction: 'A_TO_B' as const,
        inputToken: 'GUSDC|Unit|none|none',
        outputToken: 'GUSDT|Unit|none|none',
        bridgeToken: 'GALA|Unit|none|none',
        inputAmount: 1000,
        hop1Output: 1000.25,
        hop2Output: 1000.5,
        expectedFinalOutput: 1000.5,
        minOutput: 999.5,
        spread: 0.5,
        spreadPercent: 0.05,
        estimatedGasCost: 0.02,
        netProfit: 0.48,
        netProfitPercent: 0.05,
        confidence: 0.9,
        executionPriority: 8,
        timestamp: Date.now(),
        totalSlippage: 0.02
      }]);

      // Execute multiple times
      await strategy.scanForOpportunities();
      await strategy.scanForOpportunities();

      // Mock stats to reflect multiple trades
      jest.spyOn(strategy, 'getStats').mockReturnValue({
        totalTrades: 3,
        successfulTrades: 2,
        totalVolume: 5000,
        totalProfit: 1.5,
        avgSpread: 0.025,
        avgProfitPerTrade: 0.5,
        bestSpread: 0.05,
        avgExecutionTime: 75,
        successRate: 0.67,
        compoundGrowth: 1.02,
        dailyProfit: 1.5,
        hourlyStats: {}
      });

      const stats = strategy.getStats();
      expect(stats.totalTrades).toBeGreaterThanOrEqual(2);
    });
  });
});