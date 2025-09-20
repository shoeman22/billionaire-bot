/**
 * Rate Limiter Tests
 * Test suite for rate limiting functionality with burst protection
 */

import { RateLimiter, RateLimiterManager, ExponentialBackoff } from '../rate-limiter';

describe('Rate Limiter', () => {
  describe('Basic Rate Limiting', () => {
    test('should allow requests within rate limit', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 10,
        burstLimit: 20
      });

      // Should allow multiple requests within burst limit
      for (let i = 0; i < 10; i++) {
        const result = limiter.checkLimit();
        expect(result.allowed).toBe(true);
      }
    });

    test('should block requests exceeding burst limit', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 2,
        burstLimit: 5
      });

      // Use up burst limit - check how many are allowed
      const results = [];
      for (let i = 0; i < 5; i++) {
        const result = limiter.checkLimit();
        results.push(result);
      }

      // At least some should be allowed
      const allowedCount = results.filter(r => r.allowed).length;
      expect(allowedCount).toBeGreaterThan(0);

      // Should block additional requests
      const result = limiter.checkLimit();
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test('should refill tokens over time', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 10,
        burstLimit: 5
      });

      // Use up burst limit
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }

      // Should block
      expect(limiter.checkLimit().allowed).toBe(false);

      // Wait for refill
      await new Promise(resolve => setTimeout(resolve, 600)); // 0.6 seconds

      // Should allow again
      const result = limiter.checkLimit();
      expect(result.allowed).toBe(true);
    });

    test('should respect sliding window limit', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 2,
        burstLimit: 10,
        windowMs: 1000
      });

      // Make 2 requests
      expect(limiter.checkLimit().allowed).toBe(true);
      expect(limiter.checkLimit().allowed).toBe(true);

      // Should block 3rd request in same window
      const result = limiter.checkLimit();
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('Token Bucket Behavior', () => {
    test('should initialize with full bucket', () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 5,
        burstLimit: 10
      });

      const status = limiter.getStatus();
      expect(status.tokensAvailable).toBe(10);
    });

    test('should consume tokens on requests', () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 5,
        burstLimit: 10
      });

      limiter.checkLimit();
      const status = limiter.getStatus();
      expect(status.tokensAvailable).toBe(9);
    });

    test('should not exceed burst limit during refill', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 100, // High refill rate
        burstLimit: 5
      });

      // Use all tokens
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }

      // Wait for refill
      await new Promise(resolve => setTimeout(resolve, 200));

      const status = limiter.getStatus();
      expect(status.tokensAvailable).toBeLessThanOrEqual(5);
    });
  });

  describe('Status and Monitoring', () => {
    test('should provide accurate status information', () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 5,
        burstLimit: 10,
        windowMs: 1000
      });

      // Make some requests
      for (let i = 0; i < 3; i++) {
        limiter.checkLimit();
      }

      const status = limiter.getStatus();
      expect(status.tokensAvailable).toBe(7);
      expect(status.requestsInWindow).toBe(3);
      expect(status.windowUtilization).toBe(0.6);
    });

    test('should clean up old request timestamps', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 5,
        burstLimit: 10,
        windowMs: 100 // Short window for testing
      });

      // Make requests
      limiter.checkLimit();
      limiter.checkLimit();

      // Wait for window to pass
      await new Promise(resolve => setTimeout(resolve, 150));

      const status = limiter.getStatus();
      expect(status.requestsInWindow).toBe(0);
    });
  });

  describe('Reset Functionality', () => {
    test('should reset limiter state', () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 5,
        burstLimit: 10
      });

      // Use some tokens
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }

      limiter.reset();

      const status = limiter.getStatus();
      expect(status.tokensAvailable).toBe(10);
      expect(status.requestsInWindow).toBe(0);
    });
  });

  describe('Wait for Limit', () => {
    test('should wait when rate limited', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 10,
        burstLimit: 2
      });

      // Use up burst limit
      limiter.checkLimit();
      limiter.checkLimit();

      const start = Date.now();
      await limiter.waitForLimit();
      const elapsed = Date.now() - start;

      // Should have waited some amount of time
      expect(elapsed).toBeGreaterThan(50);
    });

    test('should not wait when limit available', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 10,
        burstLimit: 10
      });

      const start = Date.now();
      await limiter.waitForLimit();
      const elapsed = Date.now() - start;

      // Should return immediately
      expect(elapsed).toBeLessThan(50);
    });
  });
});

describe('Rate Limiter Manager', () => {
  test('should create limiters for different endpoints', () => {
    const manager = new RateLimiterManager({
      requestsPerSecond: 10,
      burstLimit: 20
    });

    const limiter1 = manager.getLimiter('endpoint1');
    const limiter2 = manager.getLimiter('endpoint2');

    expect(limiter1).not.toBe(limiter2);
  });

  test('should reuse existing limiters', () => {
    const manager = new RateLimiterManager({
      requestsPerSecond: 10,
      burstLimit: 20
    });

    const limiter1 = manager.getLimiter('endpoint1');
    const limiter2 = manager.getLimiter('endpoint1');

    expect(limiter1).toBe(limiter2);
  });

  test('should use custom config for specific endpoints', () => {
    const manager = new RateLimiterManager({
      requestsPerSecond: 10,
      burstLimit: 20
    });

    const customConfig = {
      requestsPerSecond: 5,
      burstLimit: 10
    };

    manager.getLimiter('special-endpoint', customConfig);

    // Verify the endpoint uses custom limits
    for (let i = 0; i < 5; i++) {
      const result = manager.checkEndpointLimit('special-endpoint', customConfig);
      expect(result.allowed).toBe(true);
    }

    // Should be limited after burst
    const result = manager.checkEndpointLimit('special-endpoint', customConfig);
    expect(result.allowed).toBe(false);
  });

  test('should provide status for all limiters', () => {
    const manager = new RateLimiterManager({
      requestsPerSecond: 10,
      burstLimit: 20
    });

    manager.checkEndpointLimit('endpoint1');
    manager.checkEndpointLimit('endpoint2');

    const allStatus = manager.getAllStatus();
    expect(allStatus).toHaveProperty('endpoint1');
    expect(allStatus).toHaveProperty('endpoint2');
  });

  test('should reset all limiters', () => {
    const manager = new RateLimiterManager({
      requestsPerSecond: 10,
      burstLimit: 20
    });

    // Use some limits
    for (let i = 0; i < 5; i++) {
      manager.checkEndpointLimit('endpoint1');
    }

    manager.resetAll();

    const status = manager.getAllStatus();
    Object.values(status).forEach(limiterStatus => {
      expect(limiterStatus.tokensAvailable).toBe(20);
    });
  });

  test('should wait for endpoint limits', async () => {
    const manager = new RateLimiterManager({
      requestsPerSecond: 10,
      burstLimit: 2
    });

    // Use up limit
    manager.checkEndpointLimit('endpoint1');
    manager.checkEndpointLimit('endpoint1');

    const start = Date.now();
    await manager.waitForEndpointLimit('endpoint1');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThan(50);
  });
});

describe('Exponential Backoff', () => {
  test('should calculate exponential delays', () => {
    const backoff = new ExponentialBackoff(100, 10000, false);

    const delays = [];
    for (let i = 0; i < 5; i++) {
      delays.push(backoff.getNextDelay());
    }

    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(200);
    expect(delays[2]).toBe(400);
    expect(delays[3]).toBe(800);
    expect(delays[4]).toBe(1600);
  });

  test('should respect maximum delay', () => {
    const backoff = new ExponentialBackoff(1000, 2000, false);

    backoff.getNextDelay(); // 1000
    backoff.getNextDelay(); // 2000
    const delay = backoff.getNextDelay(); // Should be capped at 2000

    expect(delay).toBe(2000);
  });

  test('should add jitter when enabled', () => {
    const backoff = new ExponentialBackoff(1000, 10000, true);

    const delay1 = backoff.getNextDelay();
    backoff.reset();
    const delay2 = backoff.getNextDelay();

    // With jitter, delays should be different
    expect(delay1).not.toBe(delay2);

    // But both should be around the base delay
    expect(delay1).toBeGreaterThanOrEqual(1000);
    expect(delay1).toBeLessThanOrEqual(1100);
    expect(delay2).toBeGreaterThanOrEqual(1000);
    expect(delay2).toBeLessThanOrEqual(1100);
  });

  test('should reset attempt counter', () => {
    const backoff = new ExponentialBackoff(100, 10000, false);

    backoff.getNextDelay(); // attempt 1
    backoff.getNextDelay(); // attempt 2

    backoff.reset();

    const delay = backoff.getNextDelay();
    expect(delay).toBe(100); // Should be back to base delay
  });

  test('should track attempt number', () => {
    const backoff = new ExponentialBackoff(100, 10000, false);

    expect(backoff.getCurrentAttempt()).toBe(0);

    backoff.getNextDelay();
    expect(backoff.getCurrentAttempt()).toBe(1);

    backoff.getNextDelay();
    expect(backoff.getCurrentAttempt()).toBe(2);
  });
});

describe('Edge Cases and Error Handling', () => {
  test('should handle zero requests per second', () => {
    expect(() => {
      new RateLimiter({
        requestsPerSecond: 0,
        burstLimit: 10
      });
    }).not.toThrow();
  });

  test('should handle very high request rates', () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 1000000,
      burstLimit: 1000000
    });

    // Should handle high rates without issues
    for (let i = 0; i < 100; i++) {
      const result = limiter.checkLimit();
      expect(result.allowed).toBe(true);
    }
  });

  test('should handle burst limit smaller than requests per second', () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 10,
      burstLimit: 5
    });

    // Should still work correctly
    for (let i = 0; i < 5; i++) {
      expect(limiter.checkLimit().allowed).toBe(true);
    }

    expect(limiter.checkLimit().allowed).toBe(false);
  });

  test('should handle very small window sizes', () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 10,
      burstLimit: 20,
      windowMs: 1 // Very small window
    });

    const result = limiter.checkLimit();
    expect(result.allowed).toBe(true);
  });
});