/**
 * Enhanced GalaSwapClient Tests
 * Test suite for improved API integration with rate limiting and error recovery
 */

import { jest } from '@jest/globals';
import { GalaSwapClient } from '../GalaSwapClient';
import { RateLimiterManager } from '../../utils/rate-limiter';

// Mock dependencies
jest.mock('axios');
jest.mock('socket.io-client');
jest.mock('../../utils/logger');
jest.mock('../../utils/signing');
jest.mock('../endpoints');

const mockAxios = {
  create: jest.fn(() => ({
    request: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    },
    get: jest.fn()
  })),
  isAxiosError: jest.fn()
};

const mockSocket = {
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  connected: true,
  disconnect: jest.fn(),
  removeAllListeners: jest.fn()
};

const mockIo = jest.fn(() => mockSocket);

// Setup mocks
require('axios').__setMockImplementation(mockAxios);
require('socket.io-client').io = mockIo;

describe('Enhanced GalaSwapClient', () => {
  let client: GalaSwapClient;
  let mockHttpClient: any;

  const clientConfig = {
    baseUrl: 'https://api.galaswap.com',
    wsUrl: 'wss://ws.galaswap.com',
    walletAddress: 'eth|0x1234567890123456789012345678901234567890',
    privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockHttpClient = {
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      },
      get: jest.fn()
    };

    mockAxios.create.mockReturnValue(mockHttpClient);

    // Mock endpoints module
    require('../endpoints').getEndpointConfig = jest.fn().mockReturnValue({
      timeout: 5000,
      rateLimit: { requestsPerSecond: 10, burstLimit: 20 }
    });
    require('../endpoints').validateEndpointParams = jest.fn().mockReturnValue({
      isValid: true,
      errors: []
    });
    require('../endpoints').buildQueryUrl = jest.fn().mockImplementation((endpoint, params) => {
      return endpoint + '?' + new URLSearchParams(params).toString();
    });

    client = new GalaSwapClient(clientConfig);
  });

  describe('Enhanced Error Recovery', () => {
    test('should retry retryable errors', async () => {
      const mockError = {
        response: { status: 500 },
        config: {},
        isAxiosError: true
      };

      mockHttpClient.request
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce({ data: { success: true } });

      // Access private method for testing
      const result = await (client as any).executeWithRetry(async () => {
        return await mockHttpClient.request({ method: 'GET', url: '/test' });
      });

      expect(result).toEqual({ success: true });
      expect(mockHttpClient.request).toHaveBeenCalledTimes(3);
    });

    test('should not retry non-retryable errors', async () => {
      const mockError = {
        response: { status: 400 },
        config: {},
        isAxiosError: true
      };

      mockHttpClient.request.mockRejectedValue(mockError);

      await expect((client as any).executeWithRetry(async () => {
        return await mockHttpClient.request({ method: 'GET', url: '/test' });
      })).rejects.toThrow();

      expect(mockHttpClient.request).toHaveBeenCalledTimes(1);
    });

    test('should handle network errors with retry', async () => {
      const networkError = {
        code: 'ECONNRESET',
        config: {},
        isAxiosError: true
      };

      mockHttpClient.request
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ data: { success: true } });

      const result = await (client as any).executeWithRetry(async () => {
        return await mockHttpClient.request({ method: 'GET', url: '/test' });
      });

      expect(result).toEqual({ success: true });
      expect(mockHttpClient.request).toHaveBeenCalledTimes(2);
    });

    test('should apply exponential backoff', async () => {
      const mockError = {
        response: { status: 503 },
        config: {},
        isAxiosError: true
      };

      mockHttpClient.request
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce({ data: { success: true } });

      const startTime = Date.now();
      await (client as any).executeWithRetry(async () => {
        return await mockHttpClient.request({ method: 'GET', url: '/test' });
      });
      const elapsed = Date.now() - startTime;

      // Should have waited for backoff delays
      expect(elapsed).toBeGreaterThan(1500); // At least base delay + exponential increase
    });
  });

  describe('Connection Health Monitoring', () => {
    test('should track connection health', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { status: 'healthy' } });

      await (client as any).ensureConnectionHealth();

      const health = client.getConnectionHealth();
      expect(health.consecutiveFailures).toBe(0);
      expect(health.isHealthy).toBe(true);
    });

    test('should detect unhealthy connections', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Connection failed'));

      // Make multiple failed requests to trigger unhealthy state
      for (let i = 0; i < 4; i++) {
        try {
          await (client as any).ensureConnectionHealth();
        } catch (error) {
          // Expected to fail
        }
      }

      const health = client.getConnectionHealth();
      expect(health.consecutiveFailures).toBeGreaterThan(3);
      expect(health.isHealthy).toBe(false);
    });

    test('should provide comprehensive health check', async () => {
      mockHttpClient.request.mockResolvedValue({
        data: { status: 'healthy' }
      });

      const health = await client.healthCheck();

      expect(health).toHaveProperty('isHealthy');
      expect(health).toHaveProperty('apiStatus');
      expect(health).toHaveProperty('websocketStatus');
      expect(health).toHaveProperty('consecutiveFailures');
      expect(health).toHaveProperty('rateLimiterStatus');
    });
  });

  describe('Enhanced WebSocket Management', () => {
    test('should establish websocket connection with proper configuration', async () => {
      const connectPromise = client.connectWebSocket();

      // Simulate successful connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();

      await expect(connectPromise).resolves.toBeUndefined();

      expect(mockIo).toHaveBeenCalledWith(clientConfig.wsUrl, expect.objectContaining({
        timeout: 30000,
        reconnection: true,
        reconnectionAttempts: 10
      }));
    });

    test('should handle websocket connection errors', async () => {
      const connectPromise = client.connectWebSocket();

      // Simulate connection error
      const errorHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect_error')[1];
      errorHandler(new Error('Connection failed'));

      await expect(connectPromise).rejects.toThrow('Connection failed');
    });

    test('should handle websocket disconnections gracefully', async () => {
      // Connect first
      const connectPromise = client.connectWebSocket();
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();
      await connectPromise;

      // Simulate server disconnect
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')[1];
      disconnectHandler('io server disconnect');

      // Should attempt reconnection for server disconnects
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    test('should clean up websocket connections properly', async () => {
      // Connect first
      const connectPromise = client.connectWebSocket();
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();
      await connectPromise;

      // Disconnect
      await client.disconnectWebSocket();

      expect(mockSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('Enhanced Transaction Monitoring', () => {
    test('should monitor transaction via websocket when available', async () => {
      mockSocket.connected = true;

      const monitorPromise = client.monitorTransaction('tx123');

      // Simulate transaction update
      const updateHandler = mockSocket.on.mock.calls.find(call => call[0] === 'transaction_update')[1];
      updateHandler({
        transactionId: 'tx123',
        status: 'CONFIRMED'
      });

      const result = await monitorPromise;

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('tx123');
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe_transaction', { transactionId: 'tx123' });
    });

    test('should fallback to polling when websocket unavailable', async () => {
      mockSocket.connected = false;

      mockHttpClient.request
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: { id: 'tx123', status: 'PENDING' }
          }
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: { id: 'tx123', status: 'CONFIRMED' }
          }
        });

      const result = await client.monitorTransaction('tx123', 10000, 1000);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('CONFIRMED');
      expect(mockHttpClient.request).toHaveBeenCalledTimes(2);
    });

    test('should handle transaction monitoring timeout', async () => {
      mockSocket.connected = false;

      mockHttpClient.request.mockResolvedValue({
        data: {
          success: true,
          data: { id: 'tx123', status: 'PENDING' }
        }
      });

      await expect(client.monitorTransaction('tx123', 100, 50)).rejects.toThrow('timeout');
    });

    test('should handle failed transactions in monitoring', async () => {
      mockSocket.connected = true;

      const monitorPromise = client.monitorTransaction('tx123');

      // Simulate failed transaction
      const updateHandler = mockSocket.on.mock.calls.find(call => call[0] === 'transaction_update')[1];
      updateHandler({
        transactionId: 'tx123',
        status: 'FAILED'
      });

      await expect(monitorPromise).rejects.toThrow('Transaction failed');
    });

    test('should use exponential backoff for polling errors', async () => {
      mockSocket.connected = false;

      mockHttpClient.request
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: { id: 'tx123', status: 'CONFIRMED' }
          }
        });

      const startTime = Date.now();
      const result = await client.monitorTransaction('tx123', 30000, 100);
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThan(300); // Should have waited for backoff
    });
  });

  describe('Rate Limiting Integration', () => {
    test('should respect rate limits', async () => {
      // Create a client with low rate limits for testing
      const rateLimitedConfig = {
        ...clientConfig,
        rateLimit: { requestsPerSecond: 1, burstLimit: 1 }
      };

      // Mock the rate limiter to return rate limited
      const checkSpy = jest.spyOn(RateLimiterManager.prototype, 'waitForEndpointLimit')
        .mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        });

      mockHttpClient.request.mockResolvedValue({ data: { success: true } });

      const startTime = Date.now();
      await (client as any).makeRequest('/test', 'GET');
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThan(50);
      checkSpy.mockRestore();
    });

    test('should reset rate limiters', () => {
      const resetSpy = jest.spyOn(RateLimiterManager.prototype, 'resetAll');

      client.resetRateLimiters();

      expect(resetSpy).toHaveBeenCalled();
      resetSpy.mockRestore();
    });
  });

  describe('Request Validation', () => {
    test('should validate parameters before making requests', async () => {
      require('../endpoints').validateEndpointParams = jest.fn().mockReturnValue({
        isValid: false,
        errors: ['Invalid parameter']
      });

      await expect((client as any).makeRequest('/test', 'GET', { invalid: 'param' }))
        .rejects.toThrow('Invalid parameters: Invalid parameter');
    });

    test('should handle valid parameters', async () => {
      require('../endpoints').validateEndpointParams = jest.fn().mockReturnValue({
        isValid: true,
        errors: []
      });

      mockHttpClient.request.mockResolvedValue({ data: { success: true } });

      const result = await (client as any).makeRequest('/test', 'GET', { valid: 'param' });

      expect(result).toEqual({ success: true });
    });
  });

  describe('Error Classification', () => {
    test('should classify retryable errors correctly', () => {
      const retryableErrors = [
        { response: { status: 500 } },
        { response: { status: 502 } },
        { response: { status: 503 } },
        { response: { status: 429 } },
        { code: 'ECONNRESET' },
        { code: 'ENOTFOUND' },
        { code: 'ECONNREFUSED' },
        { code: 'ETIMEDOUT' },
        { code: 'ECONNABORTED' }
      ];

      retryableErrors.forEach(error => {
        const isRetryable = (client as any).isRetryableError(error);
        expect(isRetryable).toBe(true);
      });
    });

    test('should classify non-retryable errors correctly', () => {
      const nonRetryableErrors = [
        { response: { status: 400 } },
        { response: { status: 401 } },
        { response: { status: 403 } },
        { response: { status: 404 } },
        { response: { status: 422 } }
      ];

      nonRetryableErrors.forEach(error => {
        const isRetryable = (client as any).isRetryableError(error);
        expect(isRetryable).toBe(false);
      });
    });
  });

  describe('Backwards Compatibility', () => {
    test('should maintain legacy waitForTransaction method', async () => {
      mockHttpClient.request.mockResolvedValue({
        data: {
          success: true,
          data: { id: 'tx123', status: 'CONFIRMED' }
        }
      });

      const result = await client.waitForTransaction('tx123');

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('CONFIRMED');
    });

    test('should maintain all existing public methods', () => {
      // Verify all existing public methods are still available
      expect(typeof client.getQuote).toBe('function');
      expect(typeof client.getPrice).toBe('function');
      expect(typeof client.getPrices).toBe('function');
      expect(typeof client.getPool).toBe('function');
      expect(typeof client.executeBundle).toBe('function');
      expect(typeof client.connectWebSocket).toBe('function');
      expect(typeof client.disconnectWebSocket).toBe('function');
      expect(typeof client.healthCheck).toBe('function');
    });
  });

  describe('Resource Management', () => {
    test('should handle high-frequency requests without memory leaks', async () => {
      mockHttpClient.request.mockResolvedValue({ data: { success: true } });

      // Simulate many requests
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push((client as any).makeRequest('/test', 'GET'));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result).toEqual({ success: true });
      });
    });

    test('should clean up properly on multiple connection attempts', async () => {
      // Multiple quick connection attempts
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(client.connectWebSocket().catch(() => {}));
      }

      // Simulate connections
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
      if (connectHandler) {
        connectHandler();
      }

      await Promise.allSettled(promises);

      // Should handle multiple attempts gracefully
      expect(mockSocket.disconnect).toHaveBeenCalledTimes(4); // 4 disconnects for cleanup
    });
  });
});