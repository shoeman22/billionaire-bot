/**
 * RetryHelper Tests
 * Testing retry logic, backoff, and error handling
 */

import { RetryHelper } from '../../utils/retry-helper';

// Mock logger to avoid console output during tests
jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('RetryHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await RetryHelper.withRetry(mockOperation, {}, 'test-operation');

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValueOnce('success');

      const result = await RetryHelper.withRetry(
        mockOperation,
        { maxRetries: 3, baseDelay: 10 },
        'test-operation'
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should fail after exhausting all retries', async () => {
      const error = new Error('Persistent failure');
      const mockOperation = jest.fn().mockRejectedValue(error);

      await expect(
        RetryHelper.withRetry(
          mockOperation,
          { maxRetries: 2, baseDelay: 10 },
          'test-operation'
        )
      ).rejects.toThrow('Persistent failure');

      expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should respect custom retry condition', async () => {
      const retryableError = new Error('Network timeout');
      const nonRetryableError = new Error('Invalid signature');

      const mockOperation = jest.fn().mockRejectedValue(nonRetryableError);

      await expect(
        RetryHelper.withRetry(
          mockOperation,
          {
            maxRetries: 3,
            baseDelay: 10,
            retryCondition: (error) => error.message.includes('timeout')
          },
          'test-operation'
        )
      ).rejects.toThrow('Invalid signature');

      expect(mockOperation).toHaveBeenCalledTimes(1); // No retries for non-retryable error
    });

    it('should calculate exponential backoff correctly', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      // Mock setTimeout to capture delays
      global.setTimeout = jest.fn((callback, delay) => {
        delays.push(delay);
        return originalSetTimeout(callback, 0); // Execute immediately
      }) as any;

      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Retry 1'))
        .mockRejectedValueOnce(new Error('Retry 2'))
        .mockResolvedValueOnce('success');

      await RetryHelper.withRetry(
        mockOperation,
        {
          maxRetries: 3,
          baseDelay: 100,
          backoffMultiplier: 2,
          jitter: false
        },
        'test-operation'
      );

      // Should have exponential backoff: 100ms, 200ms
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);

      // Restore setTimeout
      global.setTimeout = originalSetTimeout;
    });

    it('should apply jitter to delays', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      const originalMathRandom = Math.random;

      // Mock Math.random to return predictable values
      Math.random = jest.fn()
        .mockReturnValueOnce(0.5)  // No jitter change
        .mockReturnValueOnce(0.8); // Positive jitter

      global.setTimeout = jest.fn((callback, delay) => {
        delays.push(delay);
        return originalSetTimeout(callback, 0);
      }) as any;

      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Retry 1'))
        .mockRejectedValueOnce(new Error('Retry 2'))
        .mockResolvedValueOnce('success');

      await RetryHelper.withRetry(
        mockOperation,
        {
          maxRetries: 3,
          baseDelay: 1000,
          backoffMultiplier: 2,
          jitter: true
        },
        'test-operation'
      );

      // Jitter should be applied (delays won't be exact multiples)
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBeGreaterThan(900);
      expect(delays[0]).toBeLessThan(1100);

      // Restore mocks
      global.setTimeout = originalSetTimeout;
      Math.random = originalMathRandom;
    });

    it('should respect maxDelay limit', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = jest.fn((callback, delay) => {
        delays.push(delay);
        return originalSetTimeout(callback, 0);
      }) as any;

      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Retry 1'))
        .mockRejectedValueOnce(new Error('Retry 2'))
        .mockRejectedValueOnce(new Error('Retry 3'))
        .mockResolvedValueOnce('success');

      await RetryHelper.withRetry(
        mockOperation,
        {
          maxRetries: 4,
          baseDelay: 1000,
          backoffMultiplier: 10, // Large multiplier
          maxDelay: 2000,        // But limited max delay
          jitter: false
        },
        'test-operation'
      );

      // All delays should respect maxDelay
      delays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(2000);
      });

      global.setTimeout = originalSetTimeout;
    });
  });

  describe('withRetryParallel', () => {
    it('should execute multiple operations in parallel', async () => {
      const operation1 = jest.fn().mockResolvedValue('result1');
      const operation2 = jest.fn().mockResolvedValue('result2');
      const operation3 = jest.fn().mockResolvedValue('result3');

      const startTime = Date.now();
      const results = await RetryHelper.withRetryParallel(
        [operation1, operation2, operation3],
        { maxRetries: 1, baseDelay: 100 },
        'parallel-test'
      );
      const endTime = Date.now();

      expect(results).toEqual(['result1', 'result2', 'result3']);
      expect(operation1).toHaveBeenCalledTimes(1);
      expect(operation2).toHaveBeenCalledTimes(1);
      expect(operation3).toHaveBeenCalledTimes(1);

      // Should complete relatively quickly (parallel execution)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle mixed success and failure in parallel operations', async () => {
      const operation1 = jest.fn().mockResolvedValue('success');
      const operation2 = jest.fn().mockRejectedValue(new Error('failure'));
      const operation3 = jest.fn().mockResolvedValue('success');

      await expect(
        RetryHelper.withRetryParallel(
          [operation1, operation2, operation3],
          { maxRetries: 1, baseDelay: 10 },
          'mixed-parallel-test'
        )
      ).rejects.toThrow('failure');

      // First and third operations should have been called
      expect(operation1).toHaveBeenCalledTimes(1);
      expect(operation3).toHaveBeenCalledTimes(1);
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable network errors', () => {
      const retryableErrors = [
        new Error('Network timeout'),
        new Error('ECONNRESET'),
        new Error('ENOTFOUND'),
        new Error('Request timeout'),
        new Error('Service unavailable'),
        new Error('Internal server error'),
        new Error('Bad gateway'),
        new Error('Gateway timeout'),
        new Error('Too many requests'),
        new Error('Rate limit exceeded')
      ];

      retryableErrors.forEach(error => {
        expect(RetryHelper.isRetryableError(error)).toBe(true);
      });
    });

    it('should identify non-retryable business logic errors', () => {
      const nonRetryableErrors = [
        new Error('Invalid token format'),
        new Error('Unauthorized access'),
        new Error('Forbidden operation'),
        new Error('Resource not found'),
        new Error('Bad request format'),
        new Error('Invalid signature'),
        new Error('Insufficient balance'),
        new Error('Slippage tolerance exceeded'),
        new Error('Position not found'),
        new Error('Invalid fee tier')
      ];

      nonRetryableErrors.forEach(error => {
        expect(RetryHelper.isRetryableError(error)).toBe(false);
      });
    });

    it('should identify retryable HTTP status codes', () => {
      const retryableStatuses = [408, 429, 500, 502, 503, 504];

      retryableStatuses.forEach(status => {
        const error = new Error('HTTP error') as any;
        error.status = status;
        expect(RetryHelper.isRetryableError(error)).toBe(true);
      });

      const nonRetryableStatuses = [400, 401, 403, 404, 422];

      nonRetryableStatuses.forEach(status => {
        const error = new Error('HTTP error') as any;
        error.status = status;
        expect(RetryHelper.isRetryableError(error)).toBe(false);
      });
    });

    it('should handle errors with statusCode property', () => {
      const error = new Error('HTTP error') as any;
      error.statusCode = 503;
      expect(RetryHelper.isRetryableError(error)).toBe(true);

      error.statusCode = 404;
      expect(RetryHelper.isRetryableError(error)).toBe(false);
    });
  });

  describe('getApiRetryOptions', () => {
    it('should return appropriate options for different API types', () => {
      const fastOptions = RetryHelper.getApiRetryOptions('fast');
      expect(fastOptions.maxRetries).toBe(2);
      expect(fastOptions.baseDelay).toBe(500);
      expect(fastOptions.maxDelay).toBe(5000);

      const standardOptions = RetryHelper.getApiRetryOptions('standard');
      expect(standardOptions.maxRetries).toBe(3);
      expect(standardOptions.baseDelay).toBe(1000);
      expect(standardOptions.maxDelay).toBe(10000);

      const slowOptions = RetryHelper.getApiRetryOptions('slow');
      expect(slowOptions.maxRetries).toBe(4);
      expect(slowOptions.baseDelay).toBe(2000);
      expect(slowOptions.maxDelay).toBe(20000);

      const transactionOptions = RetryHelper.getApiRetryOptions('transaction');
      expect(transactionOptions.maxRetries).toBe(5);
      expect(transactionOptions.baseDelay).toBe(3000);
      expect(transactionOptions.maxDelay).toBe(30000);
    });

    it('should have conservative retry condition for transactions', () => {
      const options = RetryHelper.getApiRetryOptions('transaction');

      // Should retry network errors
      expect(options.retryCondition!(new Error('Network timeout'))).toBe(true);
      expect(options.retryCondition!(new Error('Service unavailable'))).toBe(true);

      // Should not retry business logic errors (more conservative)
      expect(options.retryCondition!(new Error('Invalid signature'))).toBe(false);
      expect(options.retryCondition!(new Error('Insufficient balance'))).toBe(false);
    });
  });

  describe('createCircuitBreaker', () => {
    it('should allow operations when circuit is closed', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      const circuitBreaker = RetryHelper.createCircuitBreaker(mockOperation, {
        failureThreshold: 3,
        resetTimeout: 5000,
        monitorWindow: 10000
      });

      const result = await circuitBreaker();
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should open circuit after failure threshold', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'));
      const circuitBreaker = RetryHelper.createCircuitBreaker(mockOperation, {
        failureThreshold: 2,
        resetTimeout: 5000,
        monitorWindow: 10000
      });

      // First two failures should be allowed
      await expect(circuitBreaker()).rejects.toThrow('Failure');
      await expect(circuitBreaker()).rejects.toThrow('Failure');

      // Third attempt should be blocked by circuit breaker
      await expect(circuitBreaker()).rejects.toThrow('Circuit breaker is OPEN');

      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should transition to half-open after reset timeout', async () => {
      jest.useFakeTimers();

      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Failure 1'))
        .mockRejectedValueOnce(new Error('Failure 2'))
        .mockResolvedValueOnce('success');

      const circuitBreaker = RetryHelper.createCircuitBreaker(mockOperation, {
        failureThreshold: 2,
        resetTimeout: 1000,
        monitorWindow: 10000
      });

      // Trigger circuit breaker to open
      await expect(circuitBreaker()).rejects.toThrow('Failure 1');
      await expect(circuitBreaker()).rejects.toThrow('Failure 2');

      // Should be blocked
      await expect(circuitBreaker()).rejects.toThrow('Circuit breaker is OPEN');

      // Advance time past reset timeout
      jest.advanceTimersByTime(1001);

      // Should now allow operation and succeed
      const result = await circuitBreaker();
      expect(result).toBe('success');

      jest.useRealTimers();
    });

    it('should reset failure count after monitor window', async () => {
      jest.useFakeTimers();

      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Failure 1'))
        .mockResolvedValueOnce('success');

      const circuitBreaker = RetryHelper.createCircuitBreaker(mockOperation, {
        failureThreshold: 2,
        resetTimeout: 5000,
        monitorWindow: 1000
      });

      // First failure
      await expect(circuitBreaker()).rejects.toThrow('Failure 1');

      // Advance time past monitor window
      jest.advanceTimersByTime(1001);

      // Should reset failure count and allow operation
      const result = await circuitBreaker();
      expect(result).toBe('success');

      jest.useRealTimers();
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle null/undefined errors gracefully', async () => {
      const mockOperation = jest.fn().mockRejectedValue(null);

      await expect(
        RetryHelper.withRetry(mockOperation, { maxRetries: 1, baseDelay: 10 })
      ).rejects.toBeNull();
    });

    it('should handle non-Error objects thrown', async () => {
      const mockOperation = jest.fn().mockRejectedValue('String error');

      await expect(
        RetryHelper.withRetry(mockOperation, { maxRetries: 1, baseDelay: 10 })
      ).rejects.toBe('String error');
    });

    it('should handle extremely large retry counts', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      // Should handle large retry count without issues
      const result = await RetryHelper.withRetry(
        mockOperation,
        { maxRetries: 1000000, baseDelay: 1 }
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1); // Should succeed on first attempt
    });
  });
});