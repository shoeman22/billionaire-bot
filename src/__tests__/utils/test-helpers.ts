/**
 * Test Helper Functions
 * Utilities for creating test data and scenarios
 */

import { GSwap } from '../../services/gswap-simple';
import { BotConfig } from '../../config/environment';
import { safeParseFloat } from '../../utils/safe-parse';

export class TestHelpers {
  /**
   * Create a test GalaSwap client configuration
   */
  static createTestSDKConfig() {
    return {
      gatewayBaseUrl: 'http://localhost:3001/mock',
      dexBackendBaseUrl: 'http://localhost:3001/mock',
      bundlerBaseUrl: 'http://localhost:3001/mock',
      walletAddress: 'client|0x1234567890123456789012345678901234567890'
    };
  }

  /**
   * Create a test bot configuration
   */
  static createTestBotConfig(): BotConfig {
    return {
      api: {
        baseUrl: 'http://localhost:3001/mock',
        wsUrl: 'http://localhost:3001/ws'
      },
      wallet: {
        address: 'client|0x1234567890123456789012345678901234567890'
        // Private key should come from environment variables, not config objects
      },
      trading: {
        maxPositionSize: 1000,
        defaultSlippageTolerance: 0.01,
        minProfitThreshold: 0.001,
        maxDailyVolume: 10000,
        maxSlippage: 0.05,
        maxPortfolioConcentration: 0.5,
        emergencyStopLoss: 0.1,
        riskThresholds: {
          dailyLoss: 0.05,
          totalLoss: 0.2,
          volatility: 0.3,
          concentration: 0.4
        },
        strategies: {
          arbitrage: {
            enabled: true,
            minProfitBps: 50,
            maxGasPrice: 100
          }
        }
      },
      development: {
        nodeEnv: 'test',
        logLevel: 'debug',
        productionTestMode: false
      }
    };
  }

  /**
   * Create mock historical price data
   */
  static createMockPriceHistory(token: string, days: number = 30): Array<{
    timestamp: number;
    price: number;
    volume: number;
  }> {
    const data = [];
    const basePrice = 1.0;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (let i = days; i >= 0; i--) {
      const volatility = 0.02 + Math.random() * 0.03; // 2-5% daily volatility
      const priceChange = (Math.random() - 0.5) * volatility;
      const price = basePrice * (1 + priceChange);

      data.push({
        timestamp: now - (i * dayMs),
        price: safeParseFloat(price.toFixed(6), 0),
        volume: 1000000 + Math.random() * 5000000
      });
    }

    return data;
  }

  /**
   * Create mock market conditions for testing strategies
   */
  static createMockMarketConditions(scenario: 'bull' | 'bear' | 'sideways' | 'volatile' | 'crash') {
    const baseConditions = {
      timestamp: Date.now(),
      confidence: 70,
      liquidity: 'good' as const,
      trend: 'neutral' as const,
      volatility: 'medium' as const,
      volume: 'normal' as const,
      overall: 'neutral' as const
    };

    switch (scenario) {
      case 'bull':
        return {
          ...baseConditions,
          trend: 'bullish' as const,
          overall: 'bullish' as const,
          confidence: 85,
          volatility: 'low' as const,
          volume: 'high' as const
        };

      case 'bear':
        return {
          ...baseConditions,
          trend: 'bearish' as const,
          overall: 'bearish' as const,
          confidence: 75,
          volatility: 'medium' as const,
          volume: 'high' as const
        };

      case 'volatile':
        return {
          ...baseConditions,
          volatility: 'extreme' as const,
          confidence: 40,
          volume: 'high' as const,
          overall: 'uncertain' as const
        };

      case 'crash':
        return {
          ...baseConditions,
          trend: 'bearish' as const,
          overall: 'bearish' as const,
          volatility: 'extreme' as const,
          confidence: 90,
          volume: 'extreme' as const,
          liquidity: 'poor' as const
        };

      default: // sideways
        return {
          ...baseConditions,
          volatility: 'low' as const,
          confidence: 60,
          volume: 'low' as const
        };
    }
  }

  /**
   * Create mock trading opportunities for testing
   */
  static createMockArbitrageOpportunity(profitable: boolean = true) {
    const basePrice = 1.0;
    const spread = profitable ? 0.025 : -0.01; // 2.5% profit or 1% loss

    return {
      tokenIn: 'GALA',
      tokenOut: 'USDC',
      amountIn: '1000',
      expectedOutput: (1000 * (basePrice + spread)).toString(),
      profit: profitable ? 25 : -10,
      profitBps: profitable ? 250 : -100,
      confidence: profitable ? 85 : 30,
      routes: [
        {
          pool: 'GALA-USDC-3000',
          price: basePrice + spread,
          liquidity: '1000000'
        }
      ]
    };
  }

  /**
   * Create mock portfolio data
   */
  static createMockPortfolio() {
    return {
      totalValue: 10000,
      dailyPnL: 100,
      totalPnL: 500,
      baselineValue: 9500,
      dailyStartValue: 9900,
      maxConcentration: 0.3,
      volatility: 0.1,
      riskMetrics: {
        riskScore: 0.2,
        concentrationRisk: 0.3,
        volatilityRisk: 0.1,
        liquidityRisk: 0.15
      }
    };
  }

  /**
   * Wait helper function
   */
  static async waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create mock portfolio positions
   */
  static createMockPositions(userAddress: string) {
    return {
      status: 1,
      data: {
        positions: [
          {
            id: 'pos-1',
            token0: 'GALA',
            token1: 'USDC',
            fee: 3000,
            tickLower: -276320,
            tickUpper: -276300,
            liquidity: '1000000',
            amount0: '500',
            amount1: '500',
            fees0: '2.5',
            fees1: '2.5'
          }
        ],
        total: 1
      },
      message: 'Success',
      HttpStatus: 200
    };
  }

  /**
   * Create mock transaction status responses
   */
  static createMockTransactionStatus(status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REJECTED') {
    return {
      Status: 1,
      Data: {
        id: 'tx-123',
        status,
        blockNumber: status === 'CONFIRMED' ? 12345 : null,
        gasUsed: status === 'CONFIRMED' ? '21000' : null,
        timestamp: Date.now()
      },
      message: 'Success',
      HttpStatus: 200
    };
  }

  /**
   * Create mock WebSocket events
   */
  static createMockWebSocketEvents() {
    return {
      priceUpdate: {
        type: 'price_update',
        data: {
          token: 'GALA',
          price: '1.0234',
          change24h: 0.025,
          volume24h: '1000000',
          timestamp: Date.now()
        }
      },
      transactionUpdate: {
        type: 'transaction_update',
        data: {
          transactionId: 'tx-123',
          status: 'CONFIRMED',
          blockNumber: 12345,
          timestamp: Date.now()
        }
      },
      positionUpdate: {
        type: 'position_update',
        data: {
          user: 'client|0x1234567890123456789012345678901234567890',
          positionId: 'pos-1',
          liquidity: '1000000',
          fees0: '2.5',
          fees1: '2.5',
          timestamp: Date.now()
        }
      }
    };
  }

  /**
   * Create mock risk scenarios for testing emergency procedures
   */
  static createRiskScenarios() {
    return {
      normalRisk: {
        totalValue: 10000,
        dailyPnL: 100,
        totalPnL: 500,
        baselineValue: 9500,
        dailyStartValue: 9900,
        maxConcentration: 0.3,
        volatility: 0.1
      },
      highRisk: {
        totalValue: 9000,
        dailyPnL: -400,
        totalPnL: -500,
        baselineValue: 10000,
        dailyStartValue: 9400,
        maxConcentration: 0.6,
        volatility: 0.4
      },
      criticalRisk: {
        totalValue: 8000,
        dailyPnL: -800,
        totalPnL: -2000,
        baselineValue: 10000,
        dailyStartValue: 8800,
        maxConcentration: 0.8,
        volatility: 0.7
      }
    };
  }

  /**
   * Create mock error responses for testing error handling
   */
  static createMockErrorResponse(message: string = 'Test error', status: number = 400) {
    return {
      error: true,
      status,
      message,
      data: null,
      timestamp: Date.now()
    };
  }

  /**
   * Mock network delays for testing timeout scenarios
   */
  static async mockNetworkDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate test assertions for trading operations
   */
  static validateTradeResult(result: any, shouldSucceed: boolean = true) {
    if (shouldSucceed) {
      expect(result.success).toBe(true);
      expect(result.transactionId).toBeValidTransactionId();
      expect(result.error).toBeUndefined();
    } else {
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  }

  /**
   * Validate risk assessment results
   */
  static validateRiskAssessment(assessment: any) {
    expect(assessment).toHaveProperty('shouldContinueTrading');
    expect(assessment).toHaveProperty('riskLevel');
    expect(assessment).toHaveProperty('alerts');
    expect(assessment).toHaveProperty('emergencyActions');
    expect(typeof assessment.shouldContinueTrading).toBe('boolean');
    expect(['low', 'medium', 'high', 'critical']).toContain(assessment.riskLevel);
    expect(Array.isArray(assessment.alerts)).toBe(true);
    expect(Array.isArray(assessment.emergencyActions)).toBe(true);
  }

  /**
   * Validate emergency stop functionality
   */
  static validateEmergencyStop(status: any) {
    expect(status).toHaveProperty('isActive');
    expect(status).toHaveProperty('type');
    expect(status).toHaveProperty('reason');
    expect(status).toHaveProperty('activatedAt');
    expect(typeof status.isActive).toBe('boolean');
  }

  /**
   * Create a mock API response with success data
   */
  static createMockApiResponse(data: any) {
    return {
      error: false,
      status: 200,
      data,
      timestamp: Date.now()
    };
  }

  /**
   * Create a mock quote response
   */
  static createMockQuoteResponse() {
    return {
      error: false,
      status: 200,
      data: {
        amountOut: '95.5',
        amountOutMinimum: '94.5',
        priceImpact: 0.02,
        route: ['GALA$Unit$none$none', 'GUSDC$Unit$none$none'],
        fee: 3000,
        gasEstimate: 250000
      },
      timestamp: Date.now()
    };
  }

  /**
   * Create a mock pool response
   */
  static createMockPoolResponse() {
    return {
      error: false,
      status: 200,
      data: {
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 3000,
        liquidity: '1000000',
        tick: 100,
        sqrtPriceX96: '79228162514264337593543950336',
        pool: '0x1234567890123456789012345678901234567890'
      },
      timestamp: Date.now()
    };
  }
}

export default TestHelpers;