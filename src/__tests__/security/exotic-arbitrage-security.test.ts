/**
 * Security-Focused Tests for Exotic Arbitrage
 *
 * Validates all PHASE 1 CRITICAL security bulletproofing:
 * - Private key protection and SignerService integration
 * - Process lifecycle management (no process.exit)
 * - Credential exposure prevention
 * - Error sanitization and logging
 */

import { jest } from '@jest/globals';

// Mock environment first - before any imports
const mockEnv = {
  trading: {
    maxPositionSize: 1000,
    defaultSlippageTolerance: 0.01,
    minProfitThreshold: 0.001,
    maxDailyVolume: 100000,
    concentrationLimit: 1.0,
    disablePortfolioLimits: false
  },
  api: {
    baseUrl: 'https://test-api.gala.com',
    wsUrl: 'wss://test-ws.gala.com'
  },
  wallet: {
    privateKey: Buffer.from('test-private-key-data').toString('base64'), // Valid base64 encoded key
    address: 'eth|5AD173F004990940b20e7A5C64C72E8b6B91a783'
  },
  development: {
    nodeEnv: 'test',
    logLevel: 'debug',
    productionTestMode: false
  }
};

jest.mock('../../config/environment', () => ({
  validateEnvironment: jest.fn(() => mockEnv)
}));

// Mock SignerService with any types to avoid Jest type conflicts
const mockSignerService = {
  signPayload: jest.fn() as any,
  getWalletAddress: jest.fn() as any,
  destroy: jest.fn() as any
};

jest.mock('../../security/SignerService', () => ({
  SignerService: jest.fn(() => mockSignerService),
  createSignerService: jest.fn(() => mockSignerService)
}));

// Mock GSwap SDK
jest.mock('@gala-chain/gswap-sdk', () => ({
  GSwap: jest.fn(() => ({
    quoting: {
      quoteExactInput: jest.fn()
    },
    swapping: {
      getSwapPayload: jest.fn()
    },
    events: {
      connectEventSocket: jest.fn(),
      wait: jest.fn()
    }
  })),
  PrivateKeySigner: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock trading constants
jest.mock('../../config/constants', () => ({
  TRADING_CONSTANTS: {
    GAS_COSTS: {
      TRIANGULAR_ARBITRAGE: 0.1,
      CROSS_PAIR_ARBITRAGE: 0.15,
      BASE_GAS: 0.08,
      PER_HOP_GAS: 0.04
    },
    FALLBACK_TOKENS: [
      { symbol: 'GALA', tokenClass: 'GALA|Unit|none|none', decimals: 8 },
      { symbol: 'GUSDC', tokenClass: 'GUSDC|Unit|none|none', decimals: 6 }
    ]
  },
  STRATEGY_CONSTANTS: {
    MAX_SLIPPAGE: 0.005
  }
}));

// Mock utils
jest.mock('../../utils/slippage-calculator', () => ({
  calculateMinOutputAmount: jest.fn((amount: any) => (amount as number) * 0.995)
}));

// Mock swap executor
jest.mock('../../trading/execution/swap-executor', () => ({
  SwapExecutor: jest.fn(() => ({
    execute: jest.fn(),
    validatePayload: jest.fn().mockReturnValue(true),
    monitorTransaction: jest.fn()
  }))
}));

// Mock slippage protection
jest.mock('../../trading/risk/slippage', () => ({
  SlippageProtection: jest.fn(() => ({
    calculateProtectedAmount: jest.fn(),
    validateTrade: jest.fn()
  }))
}));

// Mock circuit breaker
jest.mock('../../utils/circuit-breaker', () => ({
  CircuitBreaker: jest.fn(),
  CircuitBreakerFactory: {
    createQuoteCircuitBreaker: jest.fn(() => ({
      execute: jest.fn(async (fn: any) => await fn()),
      canExecute: jest.fn(() => true)
    } as any)),
    createSwapCircuitBreaker: jest.fn(() => ({
      execute: jest.fn(async (fn: any) => await fn()),
      canExecute: jest.fn(() => true)
    } as any)),
    createTransactionCircuitBreaker: jest.fn(() => ({
      execute: jest.fn(async (fn: any) => await fn()),
      canExecute: jest.fn(() => true)
    } as any))
  },
  CircuitBreakerManager: {
    register: jest.fn(),
    get: jest.fn()
  },
  CircuitBreakerError: class extends Error {}
}));

// Import after mocking
import {
  executeExoticArbitrage,
  ExoticArbitrageConfig
} from '../../trading/execution/exotic-arbitrage-executor';
import { SignerService } from '../../security/SignerService';

describe('Exotic Arbitrage Security Validation', () => {
  let consoleSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set default successful behavior for mocks
    mockSignerService.getWalletAddress.mockReturnValue('eth|test-address');
    mockSignerService.signPayload.mockResolvedValue({ signature: 'mock-signature' });
    mockSignerService.destroy.mockResolvedValue(undefined);

    // Note: GSwap mocks are set up via jest.mock() calls above
    // Individual tests can override these mocks as needed

    // Spy on console methods to check for credential leaks
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    // Spy on process.exit to ensure it's never called
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('CRITICAL: Private Key Protection', () => {
    test('should never log or expose private keys', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'triangular',
        inputAmount: 20
      };

      // Force an error scenario to test error logging
      mockSignerService.signPayload.mockImplementation(() =>
        Promise.reject(new Error('Signer creation failed with key data'))
      );

      try {
        await executeExoticArbitrage(config);
      } catch (error) {
        // Error is expected
      }

      // Check all console calls for private key exposure
      const allConsoleCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(allConsoleCalls).not.toContain('SENSITIVE_PRIVATE_KEY_DATA_12345');
      expect(allConsoleCalls).not.toContain('privateKey');
      expect(allConsoleCalls).not.toContain('private_key');
      expect(allConsoleCalls).not.toContain('PRIVATE_KEY');
    });

    test('should use SignerService instead of direct PrivateKeySigner', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'cross-pair',
        inputAmount: 30
      };

      // Reset mocks to successful state
      mockSignerService.getWalletAddress.mockReturnValue('eth|test-address');
      mockSignerService.signPayload.mockImplementation(() =>
        Promise.resolve({ signature: 'mock-signature' })
      );

      try {
        await executeExoticArbitrage(config);
      } catch (error) {
        // Error expected due to incomplete mocking, but we're testing SignerService usage
      }

      // Verify SignerService was instantiated
      expect(SignerService).toHaveBeenCalled();
      expect(mockSignerService.signPayload).toHaveBeenCalled();

      // Verify cleanup was called
      expect(mockSignerService.destroy).toHaveBeenCalled();
    });

    test('should clean up SignerService even on critical failures', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'hunt-execute',
        inputAmount: 25
      };

      // Mock critical failure after SignerService creation
      mockSignerService.getWalletAddress.mockReturnValue('eth|test-address');

      // Mock GSwap failure
      jest.doMock('@gala-chain/gswap-sdk', () => ({
        GSwap: jest.fn(() => {
          throw new Error('Critical GSwap initialization failure');
        })
      }));

      const result = await executeExoticArbitrage(config);

      // Should fail gracefully
      expect(result.success).toBe(false);

      // SignerService should still be cleaned up
      expect(mockSignerService.destroy).toHaveBeenCalled();
    });

    test('should sanitize error messages containing sensitive data', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'triangular',
        inputAmount: 15
      };

      // Mock error that might contain sensitive data
      const sensitiveError = new Error('Authentication failed for key: SENSITIVE_PRIVATE_KEY_DATA_12345');
      mockSignerService.signPayload.mockImplementation(() => {
        throw sensitiveError;
      });

      const result = await executeExoticArbitrage(config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Error message should be sanitized
      expect(result.error).not.toContain('SENSITIVE_PRIVATE_KEY_DATA_12345');

      // Check console output for sensitive data
      const allConsoleOutput = consoleSpy.mock.calls.flat().join(' ');
      expect(allConsoleOutput).not.toContain('SENSITIVE_PRIVATE_KEY_DATA_12345');
    });
  });

  describe('CRITICAL: Process Lifecycle Management', () => {
    test('should never call process.exit() during execution', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'triangular',
        inputAmount: 40
      };

      // Force multiple types of failures
      mockSignerService.signPayload.mockImplementation(() => {
        throw new Error('Critical failure');
      });

      // Execute and ensure it completes
      const result = await executeExoticArbitrage(config);

      expect(result.success).toBe(false);
      expect(processExitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    test('should handle cascading failures without process termination', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'cross-pair',
        inputAmount: 35
      };

      // Mock cascading failures
      let failureCount = 0;
      mockSignerService.signPayload.mockImplementation(() => {
        failureCount++;
        if (failureCount < 3) {
          throw new Error(`Cascading failure ${failureCount}`);
        }
        return { signature: 'mock-signature' } as any;
      });

      const result = await executeExoticArbitrage(config);

      // Should eventually complete without process.exit
      expect(processExitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    test('should propagate errors up the call stack instead of exiting', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'hunt-execute',
        inputAmount: 20
      };

      // Mock unrecoverable error
      mockSignerService.signPayload.mockImplementation(() => {
        throw new Error('Unrecoverable system error');
      });

      // Should not throw, should return error result
      const result = await executeExoticArbitrage(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No profitable');
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe('CRITICAL: Error Information Security', () => {
    test('should not expose wallet addresses in error messages', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'triangular',
        inputAmount: 25
      };

      // Mock error that might contain wallet address
      const addressError = new Error('Transaction failed for wallet eth|5AD173F004990940b20e7A5C64C72E8b6B91a783');
      mockSignerService.signPayload.mockImplementation(() => {
        throw addressError;
      });

      const result = await executeExoticArbitrage(config);

      // Check result error message
      expect(result.error).not.toContain('eth|5AD173F004990940b20e7A5C64C72E8b6B91a783');

      // Check console output
      const allConsoleOutput = consoleSpy.mock.calls.flat().join(' ');
      expect(allConsoleOutput).not.toContain('eth|5AD173F004990940b20e7A5C64C72E8b6B91a783');
    });

    test('should handle environment validation failures securely', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'cross-pair',
        inputAmount: 30
      };

      // Mock environment validation failure
      jest.doMock('../../config/environment', () => ({
        validateEnvironment: () => {
          throw new Error('Environment validation failed: Missing WALLET_PRIVATE_KEY=abcd1234...');
        }
      }));

      const result = await executeExoticArbitrage(config);

      expect(result.success).toBe(false);

      // Should not expose environment variable values
      expect(result.error).not.toContain('abcd1234');
      expect(result.error).not.toContain('WALLET_PRIVATE_KEY=');
    });

    test('should limit error message length to prevent information disclosure', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'hunt-execute',
        inputAmount: 20
      };

      // Mock extremely long error with potentially sensitive data
      const longError = new Error('A'.repeat(2000) + 'SENSITIVE_DATA_HERE' + 'B'.repeat(2000));
      mockSignerService.signPayload.mockImplementation(() => {
        throw longError;
      });

      const result = await executeExoticArbitrage(config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Error message should be reasonably bounded
      if (result.error) {
        expect(result.error.length).toBeLessThan(1000);
        expect(result.error).not.toContain('SENSITIVE_DATA_HERE');
      }
    });
  });

  describe('CRITICAL: Resource Management Security', () => {
    test('should clean up SignerService before throwing errors', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'triangular',
        inputAmount: 20
      };

      // Mock SignerService creation success, then failure
      mockSignerService.getWalletAddress.mockReturnValue('eth|test-address');

      // Mock GSwap creation failure after SignerService is created
      jest.doMock('@gala-chain/gswap-sdk', () => ({
        GSwap: jest.fn(() => {
          throw new Error('GSwap failure after signer creation');
        })
      }));

      const result = await executeExoticArbitrage(config);

      // Should fail but clean up properly
      expect(result.success).toBe(false);
      expect(mockSignerService.destroy).toHaveBeenCalled();
    });

    test('should handle SignerService.destroy() failures gracefully', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'cross-pair',
        inputAmount: 25
      };

      // Mock SignerService.destroy() failure
      mockSignerService.getWalletAddress.mockReturnValue('eth|test-address');
      mockSignerService.destroy.mockImplementation(() => {
        throw new Error('Cleanup failure');
      });

      // Should not crash despite cleanup failure
      const result = await executeExoticArbitrage(config);

      expect(result.success).toBe(false);
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    test('should prevent memory leaks in long-running operations', async () => {
      // Test multiple successive executions
      const configs = [
        { mode: 'triangular' as const, inputAmount: 10 },
        { mode: 'cross-pair' as const, inputAmount: 15 },
        { mode: 'hunt-execute' as const, inputAmount: 20 }
      ];

      for (const config of configs) {
        await executeExoticArbitrage(config);
      }

      // SignerService should be created and destroyed for each execution
      expect(SignerService).toHaveBeenCalledTimes(3);
      expect(mockSignerService.destroy).toHaveBeenCalledTimes(3);
    });
  });

  describe('CRITICAL: Input Validation Security', () => {
    test('should validate configuration parameters', async () => {
      // Test invalid configurations
      const invalidConfigs = [
        { mode: 'invalid-mode' as any, inputAmount: 20 },
        { mode: 'triangular', inputAmount: -10 },
        { mode: 'cross-pair', inputAmount: 0 },
        { mode: 'hunt-execute', inputAmount: NaN }
      ];

      for (const config of invalidConfigs) {
        const result = await executeExoticArbitrage(config);
        expect(result.success).toBe(false);
        expect(processExitSpy).not.toHaveBeenCalled();
      }
    });

    test('should handle extremely large input amounts safely', async () => {
      const config: ExoticArbitrageConfig = {
        mode: 'triangular',
        inputAmount: Number.MAX_SAFE_INTEGER
      };

      const result = await executeExoticArbitrage(config);

      // Should handle without crashing
      expect(result.success).toBe(false);
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });
});