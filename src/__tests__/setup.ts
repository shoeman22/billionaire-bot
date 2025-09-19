/**
 * Jest Test Setup
 * Global test configuration and utilities
 */

import { logger } from '../utils/logger';

// Mock console for tests to reduce noise
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeAll(() => {
  // Set test environment
  process.env.NODE_ENV = 'test';

  // Setup test logger configuration (comment out logger.level as it may not exist)
  // logger.level = 'error'; // Only show errors in tests

  // Mock console methods if not in verbose mode (DISABLED FOR DEBUGGING)
  // if (!process.env.JEST_VERBOSE) {
  //   console.log = jest.fn();
  //   console.warn = jest.fn();
  //   console.error = jest.fn();
  // }
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// Global test utilities
global.testUtils = {
  createMockWallet: () => ({
    address: 'client|0x1234567890123456789012345678901234567890',
    privateKey: '0123456789012345678901234567890123456789012345678901234567890123'
  }),

  createMockApiResponse: <T>(data: T, success: boolean = true) => ({
    Status: success ? 1 : 0,
    Data: data,
    message: success ? 'Success' : 'Error',
    HttpStatus: success ? 200 : 400
  }),

  createMockQuoteResponse: () => ({
    Status: 1,
    Data: {
      amountOut: '1000',
      newSqrtPrice: '79228162514264337593543950336',
      priceImpact: 0.001
    },
    message: 'Success',
    HttpStatus: 200
  }),

  createMockPoolResponse: () => ({
    Status: 1,
    Data: {
      id: 'pool-1',
      token0: 'GALA',
      token1: 'USDC',
      fee: 3000,
      liquidity: '1000000',
      sqrtPrice: '79228162514264337593543950336'
    },
    message: 'Success',
    HttpStatus: 200
  }),

  createMockPortfolio: () => ({
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
  }),

  waitFor: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  expectValidTransactionId: (txId: string) => {
    expect(txId).toBeDefined();
    expect(typeof txId).toBe('string');
    expect(txId.length).toBeGreaterThan(0);
  },

  createMockErrorResponse: (message: string = 'Test error', status: number = 400) => ({
    Status: 0,
    Data: null,
    message,
    HttpStatus: status
  })
};

// Extend Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidWalletAddress(): R;
      toBeValidTokenAmount(): R;
      toBeValidTransactionId(): R;
    }
  }

  var testUtils: {
    createMockWallet: () => { address: string; privateKey: string };
    createMockApiResponse: <T>(data: T, success?: boolean) => any;
    createMockQuoteResponse: () => any;
    createMockPoolResponse: () => any;
    createMockPortfolio: () => any;
    waitFor: (ms: number) => Promise<void>;
    expectValidTransactionId: (txId: string) => void;
    createMockErrorResponse: (message: string, status?: number) => any;
  };
}

// Custom matchers
expect.extend({
  toBeValidWalletAddress(received: string) {
    const isValid = received &&
      typeof received === 'string' &&
      received.length > 20 &&
      (received.startsWith('client|') || received.startsWith('0x'));

    return {
      message: () => `Expected ${received} to be a valid wallet address`,
      pass: !!isValid
    };
  },

  toBeValidTokenAmount(received: string | number) {
    const amount = typeof received === 'string' ? parseFloat(received) : received;
    const isValid = !isNaN(amount) && amount > 0;

    return {
      message: () => `Expected ${received} to be a valid positive token amount`,
      pass: !!isValid
    };
  },

  toBeValidTransactionId(received: string) {
    const isValid = received &&
      typeof received === 'string' &&
      received.length > 10;

    return {
      message: () => `Expected ${received} to be a valid transaction ID`,
      pass: !!isValid
    };
  }
});

export {};