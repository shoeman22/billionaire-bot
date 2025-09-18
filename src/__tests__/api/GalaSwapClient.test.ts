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
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    connected: true
  }))
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
      const mockResponse = testUtils.createMockQuoteResponse();
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getQuote({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000',
        fee: 3000
      });

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/quote'),
        timeout: undefined
      });
    });

    it('should handle API errors gracefully', async () => {
      const mockError = {
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { message: 'Invalid token pair' }
        },
        config: { url: '/quote', method: 'GET' }
      };

      mockAxiosInstance.request.mockRejectedValue(mockError);

      await expect(client.getQuote({
        tokenIn: 'INVALID',
        tokenOut: 'USDC',
        amountIn: '1000',
        fee: 3000
      })).rejects.toThrow('GalaSwap API Error: Invalid token pair');
    });

    it('should validate quote parameters', async () => {
      // Mock parameter validation to fail
      await expect(client.getQuote({
        tokenIn: '',
        tokenOut: 'USDC',
        amountIn: '1000',
        fee: 3000
      })).rejects.toThrow();
    });
  });

  describe('getPrice', () => {
    it('should return current price for token', async () => {
      const mockResponse = testUtils.createMockApiResponse({
        token: 'GALA',
        price: '1.0234',
        change24h: 0.025
      });

      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getPrice('GALA');

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/price'),
        timeout: undefined
      });
    });

    it('should handle price lookup errors', async () => {
      mockAxiosInstance.request.mockRejectedValue(new Error('Network error'));

      await expect(client.getPrice('UNKNOWN')).rejects.toThrow();
    });
  });

  describe('getPrices', () => {
    it('should return prices for multiple tokens', async () => {
      const mockResponse = testUtils.createMockApiResponse({
        prices: [
          { token: 'GALA', price: '1.0234' },
          { token: 'USDC', price: '1.0000' }
        ]
      });

      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getPrices(['GALA', 'USDC']);

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'POST',
        url: expect.stringContaining('/prices'),
        timeout: undefined,
        data: { tokens: ['GALA', 'USDC'] }
      });
    });
  });

  describe('getPool', () => {
    it('should return pool information', async () => {
      const mockResponse = testUtils.createMockPoolResponse();
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const result = await client.getPool('GALA', 'USDC', 3000);

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: expect.stringContaining('/pool'),
        timeout: undefined
      });
    });
  });

  describe('swap operations', () => {
    it('should execute complete swap workflow', async () => {
      // Mock quote response
      const mockQuoteResponse = testUtils.createMockQuoteResponse();

      // Mock payload generation
      const mockPayloadResponse = testUtils.createMockApiResponse({
        payload: 'mock-payload-data',
        signature: 'mock-signature'
      });

      // Mock bundle execution
      const mockBundleResponse = testUtils.createMockApiResponse('tx-123');

      mockAxiosInstance.request
        .mockResolvedValueOnce({ data: mockQuoteResponse }) // getQuote
        .mockResolvedValueOnce({ data: mockPayloadResponse }) // generateSwapPayload
        .mockResolvedValueOnce({ data: mockBundleResponse }); // executeBundle

      const result = await client.swap('GALA', 'USDC', '1000', 3000);

      expect(result.bundleResponse).toEqual(mockBundleResponse);
      expect(result.transactionId).toBeValidTransactionId();
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });

    it('should handle swap failures at quote stage', async () => {
      const mockError = testUtils.createMockErrorResponse('Insufficient liquidity');
      mockAxiosInstance.request.mockResolvedValue({ data: mockError });

      await expect(client.swap('GALA', 'USDC', '1000000000', 3000))
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
        timeout: undefined
      });
    });

    it('should add liquidity to pool', async () => {
      const mockEstimateResponse = testUtils.createMockApiResponse({
        amount0: '500',
        amount1: '500'
      });
      const mockPayloadResponse = testUtils.createMockApiResponse('mock-payload');
      const mockBundleResponse = testUtils.createMockApiResponse('tx-456');

      mockAxiosInstance.request
        .mockResolvedValueOnce({ data: mockPayloadResponse })
        .mockResolvedValueOnce({ data: mockBundleResponse });

      const result = await client.addLiquidity(
        'GALA', 'USDC', 3000, -276320, -276300, '500', '500'
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
        timeout: undefined
      });
    });

    it('should wait for transaction confirmation', async () => {
      const pendingResponse = TestHelpers.createMockTransactionStatus('PENDING');
      const confirmedResponse = TestHelpers.createMockTransactionStatus('CONFIRMED');

      mockAxiosInstance.request
        .mockResolvedValueOnce({ data: pendingResponse })
        .mockResolvedValueOnce({ data: confirmedResponse });

      const result = await client.waitForTransaction('tx-123', 5000, 100);

      expect(result).toEqual(confirmedResponse);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should timeout waiting for transaction', async () => {
      const pendingResponse = TestHelpers.createMockTransactionStatus('PENDING');
      mockAxiosInstance.request.mockResolvedValue({ data: pendingResponse });

      await expect(client.waitForTransaction('tx-123', 200, 100))
        .rejects.toThrow('Transaction timeout: tx-123');
    });
  });

  describe('WebSocket functionality', () => {
    it('should connect to WebSocket successfully', async () => {
      await client.connectWebSocket();
      expect(logger.info).toHaveBeenCalledWith('WebSocket connected to GalaSwap V3');
    });

    it('should disconnect WebSocket', async () => {
      await client.connectWebSocket();
      await client.disconnectWebSocket();
      expect(logger.info).toHaveBeenCalledWith('WebSocket disconnected');
    });

    it('should subscribe to price updates', async () => {
      await client.connectWebSocket();
      const callback = jest.fn();

      client.subscribeToTokenPrices(['GALA', 'USDC'], callback);

      expect(logger.info).toHaveBeenCalledWith(
        'Subscribed to price updates for 2 tokens'
      );
    });

    it('should handle WebSocket errors', async () => {
      const mockSocket = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('Connection failed'));
          }
        }),
        emit: jest.fn(),
        disconnect: jest.fn()
      };

      require('socket.io-client').io.mockReturnValue(mockSocket);

      await client.connectWebSocket();

      expect(logger.error).toHaveBeenCalledWith(
        'WebSocket error:',
        expect.any(Error)
      );
    });
  });

  describe('rate limiting', () => {
    it('should respect rate limits', async () => {
      // Mock multiple rapid requests
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(client.getPrice('GALA'));
      }

      // Some requests should be rate limited
      await expect(Promise.all(promises)).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('retry logic', () => {
    it('should retry failed requests', async () => {
      const networkError = { code: 'ECONNRESET' };
      const successResponse = { data: testUtils.createMockApiResponse({ price: '1.0' }) };

      mockAxiosInstance.request
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(successResponse);

      const result = await client.getPrice('GALA');

      expect(result).toEqual(successResponse.data);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should not retry client errors', async () => {
      const clientError = {
        response: { status: 400, data: { message: 'Bad request' } },
        config: { url: '/price' }
      };

      mockAxiosInstance.request.mockRejectedValue(clientError);

      await expect(client.getPrice('INVALID')).rejects.toThrow();
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('health check', () => {
    it('should return true when API is healthy', async () => {
      const mockResponse = testUtils.createMockApiResponse({ status: 'ok' });
      mockAxiosInstance.request.mockResolvedValue({ data: mockResponse });

      const isHealthy = await client.healthCheck();

      expect(isHealthy).toBe(true);
    });

    it('should return false when API is unhealthy', async () => {
      mockAxiosInstance.request.mockRejectedValue(new Error('API down'));

      const isHealthy = await client.healthCheck();

      expect(isHealthy).toBe(false);
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
      const mockError = {
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: { message: 'Database connection failed' }
        },
        config: { url: '/quote', method: 'GET' },
        message: 'Request failed with status code 500'
      };

      mockAxiosInstance.request.mockRejectedValue(mockError);

      try {
        await client.getQuote({
          tokenIn: 'GALA',
          tokenOut: 'USDC',
          amountIn: '1000',
          fee: 3000
        });
      } catch (error: any) {
        expect(error.message).toContain('GalaSwap API Error');
        expect(error.status).toBe(500);
        expect(error.endpoint).toBe('/quote');
        expect(error.method).toBe('GET');
      }
    });
  });
});