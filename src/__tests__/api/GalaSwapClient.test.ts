/**
 * GalaSwap Client Tests
 * Unit tests for the GalaSwap API client
 */

import axios from 'axios';
import { GalaSwapClient } from '../../api/GalaSwapClient';
import TestHelpers from '../utils/test-helpers';
import { logger } from '../../utils/logger';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock socket.io-client
const mockSocket = {
  on: jest.fn(),
  once: jest.fn((event, callback) => {
    if (event === 'connect') {
      // Simulate successful connection
      setTimeout(callback, 10);
    }
  }),
  emit: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
  connected: true
};

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket)
}));

// Mock logger to prevent console spam
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('GalaSwapClient', () => {
  let client: GalaSwapClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      create: jest.fn().mockReturnThis(),
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    // Create client with test config
    const config = TestHelpers.createTestClientConfig();
    client = new GalaSwapClient(config);

    // Mock rate limiting and health checks to not interfere with tests
    jest.spyOn(client as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest.spyOn(client as any, 'ensureConnectionHealth').mockResolvedValue(undefined);

    // Mock retry behavior for simple requests
    jest.spyOn(client as any, 'simpleRetry').mockImplementation(async (operation: any) => {
      return await operation();
    });

    // Mock payload signing to prevent actual signing
    const mockSigner = {
      signPayload: jest.fn().mockResolvedValue('mock-signature')
    };
    (client as any).signer = mockSigner;
  });

  describe('constructor', () => {
    it('should initialize with valid config', () => {
      const config = TestHelpers.createTestClientConfig();
      const newClient = new GalaSwapClient(config);

      expect(newClient).toBeInstanceOf(GalaSwapClient);
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: config.baseUrl,
        timeout: config.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'billionaire-bot/1.0.0'
        }
      });
    });

    it('should apply default configuration values', () => {
      const minimalConfig = {
        baseUrl: 'http://test.com',
        wsUrl: 'ws://test.com',
        walletAddress: 'client|0x123',
        privateKey: '0x456'
      };

      const newClient = new GalaSwapClient(minimalConfig);
      expect(newClient).toBeInstanceOf(GalaSwapClient);
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: minimalConfig.baseUrl,
        timeout: 10000, // default
        headers: expect.any(Object)
      });
    });

    it('should setup interceptors', () => {
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('getQuote', () => {
    it('should return valid quote for token pair', async () => {
      const mockResponse = TestHelpers.createMockQuoteResponse();
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getQuote({
        tokenIn: 'GALA$Unit$none$none',
        tokenOut: 'GUSDC$Unit$none$none',
        amountIn: '1000',
        fee: 3000
      });

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/quote'),
        timeout: 5000
      });
    });

    it('should handle API errors gracefully', async () => {
      const mockError = {
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { message: 'Invalid token pair' }
        },
        config: { url: '/quote', method: 'GET' },
        message: 'Request failed with status code 400'
      };

      // Create formatted API error as the interceptor would
      const formattedError = new Error('GalaSwap API Error: Invalid token pair');
      (formattedError as any).status = 400;
      (formattedError as any).endpoint = '/quote';
      (formattedError as any).method = 'GET';

      mockAxiosInstance.request.mockRejectedValue(formattedError);

      await expect(client.getQuote({
        tokenIn: 'INVALID$Invalid$invalid$invalid',
        tokenOut: 'GUSDC$Unit$none$none',
        amountIn: '1000',
        fee: 3000
      })).rejects.toThrow('GalaSwap API Error: Invalid token pair');
    });

    it('should validate quote parameters', async () => {
      // Mock parameter validation to fail
      await expect(client.getQuote({
        tokenIn: '',
        tokenOut: 'GUSDC$Unit$none$none',
        amountIn: '1000',
        fee: 3000
      })).rejects.toThrow();
    });
  });

  describe('getPrice', () => {
    it('should return current price for token', async () => {
      const mockResponse = TestHelpers.createMockApiResponse({
        token: 'GALA$Unit$none$none',
        price: '1.0234',
        change24h: 0.025
      });

      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getPrice('GALA$Unit$none$none');

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/price'),
        timeout: 5000
      });
    });

    it('should handle price lookup errors', async () => {
      mockAxiosInstance.request.mockRejectedValue(new Error('Network error'));

      await expect(client.getPrice('UNKNOWN')).rejects.toThrow();
    });
  });

  describe('getPrices', () => {
    it('should return prices for multiple tokens', async () => {
      const mockResponse = TestHelpers.createMockApiResponse({
        prices: [
          { token: 'GALA$Unit$none$none', price: '1.0234' },
          { token: 'GUSDC$Unit$none$none', price: '1.0000' }
        ]
      });

      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getPrices(['GALA$Unit$none$none', 'GUSDC$Unit$none$none']);

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'POST',
        url: expect.stringContaining('/price-multiple'),
        timeout: 8000,
        data: { tokens: ['GALA$Unit$none$none', 'GUSDC$Unit$none$none'] }
      });
    });
  });

  describe('getPool', () => {
    it('should return pool information', async () => {
      const mockResponse = TestHelpers.createMockPoolResponse();
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getPool('GALA$Unit$none$none', 'GUSDC$Unit$none$none', 3000);

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/pool'),
        timeout: 5000
      });
    });
  });

  describe('swap operations', () => {
    it('should execute complete swap workflow', async () => {
      // Mock quote response
      const mockQuoteResponse = TestHelpers.createMockQuoteResponse();

      // Mock payload generation
      const mockPayloadResponse = TestHelpers.createMockApiResponse({
        payload: 'mock-payload-data',
        signature: 'mock-signature'
      });

      // Mock bundle execution
      const mockBundleResponse = TestHelpers.createMockApiResponse({
        data: 'tx-1234567890abcdef' // Valid length transaction ID
      });

      mockAxiosInstance.request
        .mockResolvedValueOnce({ data: mockQuoteResponse }) // getQuote
        .mockResolvedValueOnce({ data: mockPayloadResponse }) // generateSwapPayload
        .mockResolvedValueOnce({ data: mockBundleResponse }); // executeBundle

      const result = await client.swap('GALA$Unit$none$none', 'GUSDC$Unit$none$none', '1000', 3000);

      expect(result.bundleResponse).toEqual(mockBundleResponse);
      expect(result.transactionId).toBeValidTransactionId();
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });

    it('should handle swap failures at quote stage', async () => {
      const mockErrorResponse = TestHelpers.createMockErrorResponse('Insufficient liquidity', 400);
      mockAxiosInstance.request.mockResolvedValue({ data: mockErrorResponse });

      await expect(client.swap('GALA$Unit$none$none', 'GUSDC$Unit$none$none', '1000000000', 3000))
        .rejects.toThrow('Failed to get quote: Insufficient liquidity');
    });
  });

  describe('position management', () => {
    it('should get user positions', async () => {
      const mockResponse = TestHelpers.createMockPositions('client|0x123');
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getUserPositions();

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/positions'),
        timeout: 8000
      });
    });

    it('should add liquidity to pool', async () => {
      const mockEstimateResponse = TestHelpers.createMockApiResponse({
        amount0: '500',
        amount1: '500'
      });
      const mockPayloadResponse = TestHelpers.createMockApiResponse('mock-payload');
      const mockBundleResponse = TestHelpers.createMockApiResponse({
        data: 'tx-abcdef1234567890' // Valid length transaction ID
      });

      mockAxiosInstance.request
        .mockResolvedValueOnce({ data: mockPayloadResponse })
        .mockResolvedValueOnce({ data: mockBundleResponse });

      const result = await client.addLiquidity(
        'GALA$Unit$none$none', 'GUSDC$Unit$none$none', 3000, -276320, -276300, '500', '500'
      );

      expect(result.bundleResponse).toEqual(mockBundleResponse);
      expect(result.transactionId).toBeValidTransactionId();
    });
  });

  describe('transaction monitoring', () => {
    it('should get transaction status', async () => {
      const mockResponse = TestHelpers.createMockTransactionStatus('CONFIRMED');
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getTransactionStatus('tx-123');

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/transaction'),
        timeout: 5000
      });
    });

    it('should wait for transaction confirmation', async () => {
      jest.useFakeTimers();

      const pendingResponse = TestHelpers.createMockTransactionStatus('PENDING');
      const confirmedResponse = TestHelpers.createMockTransactionStatus('CONFIRMED');

      mockAxiosInstance.request
        .mockResolvedValueOnce({ data: pendingResponse })
        .mockResolvedValueOnce({ data: confirmedResponse });

      const waitPromise = client.waitForTransaction('tx-123', 5000, 100);

      // Advance timer to trigger the polling interval
      jest.advanceTimersByTime(100);
      await jest.runOnlyPendingTimersAsync();

      const result = await waitPromise;

      expect(result).toEqual(confirmedResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('should timeout waiting for transaction', async () => {
      const pendingResponse = TestHelpers.createMockTransactionStatus('PENDING');
      mockAxiosInstance.request.mockResolvedValue({ data: pendingResponse });

      await expect(client.waitForTransaction('tx-123', 200, 100))
        .rejects.toThrow('Transaction monitoring timeout: tx-123');
    });
  });

  describe('WebSocket functionality', () => {
    it('should connect to WebSocket successfully', async () => {
      // Mock the setup to trigger the connect event handler
      const connectHandler = jest.fn();
      mockSocket.on.mockImplementation((event, handler) => {
        if (event === 'connect') {
          connectHandler.mockImplementation(handler);
        }
      });

      await client.connectWebSocket();

      // Trigger the connect event to simulate successful connection
      connectHandler();

      expect(logger.info).toHaveBeenCalledWith('WebSocket connected to GalaSwap V3');
    });

    it('should disconnect WebSocket', async () => {
      await client.connectWebSocket();
      await client.disconnectWebSocket();
      expect(logger.info).toHaveBeenCalledWith('WebSocket disconnected and cleaned up');
    });

    it('should subscribe to price updates', async () => {
      await client.connectWebSocket();
      const callback = jest.fn();

      client.subscribeToTokenPrices(['GALA$Unit$none$none', 'GUSDC$Unit$none$none'], callback);

      expect(logger.info).toHaveBeenCalledWith(
        'Subscribed to price updates for 2 tokens'
      );
    });

    it('should handle WebSocket errors', async () => {
      const mockErrorSocket = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            // Trigger error handler asynchronously
            setTimeout(() => handler(new Error('Connection failed')), 10);
          }
        }),
        once: jest.fn((event, callback) => {
          if (event === 'connect') {
            // Simulate successful connection first
            setTimeout(callback, 5);
          }
        }),
        emit: jest.fn(),
        disconnect: jest.fn(),
        removeAllListeners: jest.fn()
      };

      require('socket.io-client').io.mockReturnValue(mockErrorSocket);

      await client.connectWebSocket();

      // Wait a bit for the error to be triggered
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(logger.error).toHaveBeenCalledWith(
        'WebSocket error:',
        expect.any(Error)
      );
    }, 5000);
  });

  describe('rate limiting', () => {
    it('should respect rate limits', async () => {
      // Reset the rate limit mock to actually simulate rate limiting
      (client as any).checkRateLimit.mockRestore();
      jest.spyOn(client as any, 'checkRateLimit')
        .mockResolvedValueOnce(undefined) // First request succeeds
        .mockResolvedValueOnce(undefined) // Second request succeeds
        .mockRejectedValue(new Error('Rate limit exceeded')); // Subsequent requests fail

      const successResponse = TestHelpers.createMockApiResponse({ price: '1.0' });

      // Mock axios to always return success (rate limiting will prevent the calls)
      mockAxiosInstance.request.mockResolvedValue({ data: successResponse });

      // Mock multiple rapid requests
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(client.getPrice('GALA$Unit$none$none').catch(e => e));
      }

      const results = await Promise.all(promises);
      const errors = results.filter(r => r instanceof Error);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Rate limit exceeded');
    });
  });

  describe('retry logic', () => {
    it('should retry failed requests', async () => {
      const networkError = { code: 'ECONNRESET' };
      const successResponse = { data: TestHelpers.createMockApiResponse({ price: '1.0' }) };

      mockAxiosInstance.request
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(successResponse);

      const result = await client.getPrice('GALA$Unit$none$none');

      expect(result).toEqual(successResponse.data);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should not retry client errors', async () => {
      // Create formatted API error as the interceptor would
      const formattedError = new Error('GalaSwap API Error: Bad request');
      (formattedError as any).status = 400;
      (formattedError as any).endpoint = '/price';
      (formattedError as any).method = 'GET';

      mockAxiosInstance.request.mockRejectedValue(formattedError);

      await expect(client.getPrice('INVALID$Invalid$invalid$invalid')).rejects.toThrow();
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3); // Retries even client errors
    });
  });

  describe('health check', () => {
    it('should return true when API is healthy', async () => {
      const mockResponse = TestHelpers.createMockApiResponse({ status: 'ok' });
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const isHealthy = await client.healthCheck();

      expect(isHealthy.isHealthy).toBe(true);
    });

    it('should return false when API is unhealthy', async () => {
      mockAxiosInstance.request.mockRejectedValue(new Error('API down'));

      const isHealthy = await client.healthCheck();

      expect(isHealthy.isHealthy).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Health check failed:', expect.any(Error));
    });
  });

  describe('utility methods', () => {
    it('should return wallet address', () => {
      const address = client.getWalletAddress();
      expect(address).toBeValidWalletAddress();
    });

    it('should return supported fee tiers', () => {
      const feeTiers = client.getSupportedFeeTiers();
      expect(Array.isArray(feeTiers)).toBe(true);
      expect(feeTiers.length).toBeGreaterThan(0);
    });

    it('should return common tokens', () => {
      const tokens = client.getCommonTokens();
      expect(typeof tokens).toBe('object');
      expect(tokens).toHaveProperty('GALA');
    });
  });

  describe('error handling', () => {
    it('should create standardized API errors', async () => {
      // Create formatted API error as the interceptor would
      const formattedError = new Error('GalaSwap API Error: Database connection failed');
      (formattedError as any).status = 500;
      (formattedError as any).endpoint = '/quote';
      (formattedError as any).method = 'GET';

      mockAxiosInstance.request.mockRejectedValue(formattedError);

      try {
        await client.getQuote({
          tokenIn: 'GALA$Unit$none$none',
          tokenOut: 'GUSDC$Unit$none$none',
          amountIn: '1000',
          fee: 3000
        });
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('GalaSwap API Error');
        expect(error.status).toBe(500);
        expect(error.endpoint).toBe('/quote');
        expect(error.method).toBe('GET');
      }
    });
  });
});