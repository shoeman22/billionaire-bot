/**
 * Comprehensive Tests for Circuit Breaker Pattern
 *
 * Tests the circuit breaker implementation for API failure protection
 * in production DeFi trading environments.
 */

import { jest } from '@jest/globals';
import {
  CircuitBreaker,
  CircuitBreakerFactory,
  CircuitBreakerManager,
  CircuitBreakerError,
  CircuitState
} from '../../utils/circuit-breaker';

describe('Circuit Breaker Pattern Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any existing circuit breakers
    CircuitBreakerManager.resetAll();
    // Clear the internal breaker map for test isolation
    (CircuitBreakerManager as any).breakers = new Map();
  });

  describe('Basic Circuit Breaker Functionality', () => {
    test('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      });

      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failureCount).toBe(0);
      expect(status.successCount).toBe(0);
    });

    test('should execute successful operations normally', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      });

      const mockOperation = testUtils.createAsyncMock('success');
      const result = await breaker.execute(mockOperation);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);
    });

    test('should transition to OPEN after failure threshold', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      });

      const mockOperation = testUtils.createAsyncErrorMock('API failure');

      // First failure
      await expect(breaker.execute(mockOperation)).rejects.toThrow('API failure');
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);

      // Second failure - should open circuit
      await expect(breaker.execute(mockOperation)).rejects.toThrow('API failure');
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);
    });

    test('should block requests when OPEN', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      });

      const mockOperation = testUtils.createAsyncErrorMock('API failure');

      // Trigger circuit to open
      await expect(breaker.execute(mockOperation)).rejects.toThrow('API failure');
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);

      // Next request should be blocked
      const mockBlockedOperation = testUtils.createAsyncMock('should not execute');
      await expect(breaker.execute(mockBlockedOperation)).rejects.toThrow(CircuitBreakerError);

      expect(mockBlockedOperation).not.toHaveBeenCalled();
    });

    test('should transition to HALF_OPEN after timeout', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 100, // 100ms timeout
        monitoringWindow: 10000
      });

      const mockOperation = testUtils.createAsyncErrorMock('API failure');

      // Open circuit
      await expect(breaker.execute(mockOperation)).rejects.toThrow('API failure');
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Next request should transition to HALF_OPEN
      const mockTestOperation = testUtils.createAsyncMock('test success');
      const result = await breaker.execute(mockTestOperation);

      expect(result).toBe('test success');
      expect(mockTestOperation).toHaveBeenCalled();
      expect(breaker.getStatus().state).toBe(CircuitState.HALF_OPEN);
    });

    test('should close circuit after successful recoveries in HALF_OPEN', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 100,
        monitoringWindow: 10000
      });

      // Open circuit
      const failOperation = testUtils.createAsyncErrorMock('failure');
      await expect(breaker.execute(failOperation)).rejects.toThrow();

      // Wait for timeout and transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 150));

      const successOperation = testUtils.createAsyncMock('success');

      // First success in HALF_OPEN
      await breaker.execute(successOperation);
      expect(breaker.getStatus().state).toBe(CircuitState.HALF_OPEN);

      // Second success should close circuit
      await breaker.execute(successOperation);
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);
    });

    test('should reopen circuit on failure during HALF_OPEN', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 100,
        monitoringWindow: 10000
      });

      // Open circuit
      const failOperation = testUtils.createAsyncErrorMock('failure');
      await expect(breaker.execute(failOperation)).rejects.toThrow();

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Fail during HALF_OPEN testing
      await expect(breaker.execute(failOperation)).rejects.toThrow('failure');
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);
    });
  });

  describe('Monitoring Window Behavior', () => {
    test('should only count failures within monitoring window', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 500 // 500ms window
      });

      const failOperation = testUtils.createAsyncErrorMock('failure');

      // First failure
      await expect(breaker.execute(failOperation)).rejects.toThrow();
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);

      // Wait for monitoring window to expire
      await new Promise(resolve => setTimeout(resolve, 600));

      // Second failure (first is now outside window)
      await expect(breaker.execute(failOperation)).rejects.toThrow();
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED); // Should still be closed

      // Third failure within window should open
      await expect(breaker.execute(failOperation)).rejects.toThrow();
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);
    });

    test('should provide accurate failures in window count', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 1000
      });

      const failOperation = testUtils.createAsyncErrorMock('failure');

      // Generate 3 failures
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failOperation)).rejects.toThrow();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const status = breaker.getStatus();
      expect(status.failuresInWindow).toBe(3);
      expect(status.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('Circuit Breaker Factory', () => {
    test('should create GalaSwap circuit breaker with correct config', () => {
      const breaker = CircuitBreakerFactory.createGalaSwapCircuitBreaker();
      const status = breaker.getStatus();

      expect(status.name).toBe('GalaSwap-API');
      expect(status.state).toBe(CircuitState.CLOSED);
    });

    test('should create Quote circuit breaker with more sensitive settings', () => {
      const breaker = CircuitBreakerFactory.createQuoteCircuitBreaker();
      const status = breaker.getStatus();

      expect(status.name).toBe('Quote-API');
      expect(status.state).toBe(CircuitState.CLOSED);
    });

    test('should create Swap circuit breaker with very sensitive settings', () => {
      const breaker = CircuitBreakerFactory.createSwapCircuitBreaker();
      const status = breaker.getStatus();

      expect(status.name).toBe('Swap-Execution');
      expect(status.state).toBe(CircuitState.CLOSED);
    });

    test('should create Transaction circuit breaker', () => {
      const breaker = CircuitBreakerFactory.createTransactionCircuitBreaker();
      const status = breaker.getStatus();

      expect(status.name).toBe('Transaction-Monitor');
      expect(status.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('Circuit Breaker Manager', () => {
    test('should register and retrieve circuit breakers', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      }, 'test-breaker');

      CircuitBreakerManager.register('test', breaker);

      const retrieved = CircuitBreakerManager.get('test');
      expect(retrieved).toBe(breaker);
    });

    test('should return undefined for unknown breakers', () => {
      const result = CircuitBreakerManager.get('nonexistent');
      expect(result).toBeUndefined();
    });

    test('should get all breaker statuses', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      }, 'breaker1');

      const breaker2 = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 3000,
        monitoringWindow: 8000
      }, 'breaker2');

      CircuitBreakerManager.register('test1', breaker1);
      CircuitBreakerManager.register('test2', breaker2);

      const allStatuses = CircuitBreakerManager.getAllStatus();

      expect(Object.keys(allStatuses)).toHaveLength(2);
      expect(allStatuses.test1.name).toBe('breaker1');
      expect(allStatuses.test2.name).toBe('breaker2');
    });

    test('should reset all circuit breakers', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      }, 'test-breaker');

      CircuitBreakerManager.register('test', breaker);

      // Open the circuit
      const failOperation = testUtils.createAsyncErrorMock('failure');
      await expect(breaker.execute(failOperation)).rejects.toThrow();
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);

      // Reset all
      CircuitBreakerManager.resetAll();
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);
    });

    test('should provide health summary', async () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      }, 'breaker1');

      const breaker2 = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      }, 'breaker2');

      CircuitBreakerManager.register('test1', breaker1);
      CircuitBreakerManager.register('test2', breaker2);

      // Open one circuit
      const failOperation = testUtils.createAsyncErrorMock('failure');
      await expect(breaker1.execute(failOperation)).rejects.toThrow();

      const health = CircuitBreakerManager.getHealthSummary();

      expect(health.total).toBe(2);
      expect(health.open).toBe(1);
      expect(health.closed).toBe(1);
      expect(health.halfOpen).toBe(0);
      expect(health.healthy).toBe(false);
      expect(health.degraded).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle operations that throw non-Error objects', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      });

      // Create a mock that directly rejects with a string (not wrapped in Error)
      const mockOperation = (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = jest.fn() as any;
        return fn.mockRejectedValue('string error');
      })();

      await expect(breaker.execute(mockOperation as any)).rejects.toBe('string error');
      expect(breaker.getStatus().failureCount).toBe(1);
    });

    test('should handle force state changes', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      });

      breaker.forceState(CircuitState.OPEN);
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);

      breaker.forceState(CircuitState.HALF_OPEN);
      expect(breaker.getStatus().state).toBe(CircuitState.HALF_OPEN);
    });

    test('should accurately report canExecute status', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 1000,
        monitoringWindow: 10000
      });

      // Initially should allow execution
      expect(breaker.canExecute()).toBe(true);

      // Force to OPEN state
      breaker.forceState(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);

      // Force to HALF_OPEN
      breaker.forceState(CircuitState.HALF_OPEN);
      expect(breaker.canExecute()).toBe(true);
    });

    test('should handle rapid successive failures correctly', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        monitoringWindow: 10000
      });

      const failOperation = testUtils.createAsyncErrorMock('rapid failure');

      // Execute failures rapidly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          breaker.execute(failOperation).catch(() => 'failed') // Catch to prevent unhandled rejections
        );
      }

      await Promise.all(promises);

      // Should be open after threshold exceeded
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);
      expect(breaker.getStatus().failureCount).toBeGreaterThanOrEqual(3);
    });

    test('should maintain accurate timing for next attempt', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 200, // 200ms timeout
        monitoringWindow: 10000
      });

      const failOperation = testUtils.createAsyncErrorMock('failure');

      // Open circuit
      await expect(breaker.execute(failOperation)).rejects.toThrow();

      const status = breaker.getStatus();
      expect(status.timeUntilNextAttempt).toBeGreaterThan(150); // Should be close to 200ms
      expect(status.timeUntilNextAttempt).toBeLessThanOrEqual(200);
    });
  });
});