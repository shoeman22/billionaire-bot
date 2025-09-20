/**
 * Rate Limiter Implementation
 * Provides intelligent rate limiting with burst protection and exponential backoff
 */

import { logger } from './logger';

export interface RateLimitConfig {
  requestsPerSecond: number;
  burstLimit: number;
  windowMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remainingRequests: number;
}

/**
 * Token bucket rate limiter with sliding window
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private readonly config: Required<RateLimitConfig>;
  private requestTimestamps: number[] = [];

  constructor(config: RateLimitConfig) {
    this.config = {
      windowMs: 1000, // 1 second default window
      ...config
    };

    this.tokens = this.config.burstLimit;
    this.lastRefillTime = Date.now();

    logger.debug('Rate limiter initialized', {
      requestsPerSecond: this.config.requestsPerSecond,
      burstLimit: this.config.burstLimit,
      windowMs: this.config.windowMs
    });
  }

  /**
   * Check if request is allowed under rate limits
   */
  checkLimit(): RateLimitResult {
    const now = Date.now();

    // Refill tokens based on time passed
    this.refillTokens(now);

    // Clean old request timestamps
    this.cleanOldRequests(now);

    // Check sliding window limit
    if (this.requestTimestamps.length >= this.config.requestsPerSecond) {
      const oldestRequest = this.requestTimestamps[0];
      const retryAfter = this.config.windowMs - (now - oldestRequest);

      if (retryAfter > 0) {
        logger.warn('Rate limit exceeded - sliding window', {
          requestsInWindow: this.requestTimestamps.length,
          limit: this.config.requestsPerSecond,
          retryAfter
        });

        return {
          allowed: false,
          retryAfter: Math.ceil(retryAfter),
          remainingRequests: 0
        };
      }
    }

    // Check burst limit (token bucket)
    if (this.tokens < 1) {
      const refillTime = (1 / this.config.requestsPerSecond) * 1000;

      logger.warn('Rate limit exceeded - burst limit', {
        tokensAvailable: this.tokens,
        burstLimit: this.config.burstLimit,
        retryAfter: refillTime
      });

      return {
        allowed: false,
        retryAfter: Math.ceil(refillTime),
        remainingRequests: 0
      };
    }

    // Consume token and record request
    this.tokens--;
    this.requestTimestamps.push(now);

    return {
      allowed: true,
      remainingRequests: Math.floor(this.tokens)
    };
  }

  /**
   * Wait for rate limit to allow request
   */
  async waitForLimit(): Promise<void> {
    const result = this.checkLimit();

    if (!result.allowed && result.retryAfter) {
      logger.debug(`Waiting ${result.retryAfter}ms for rate limit`);
      await new Promise(resolve => setTimeout(resolve, result.retryAfter));

      // Recursive call to check again after waiting
      return this.waitForLimit();
    }
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(now: number): void {
    const timeSinceLastRefill = now - this.lastRefillTime;
    const tokensToAdd = (timeSinceLastRefill / 1000) * this.config.requestsPerSecond;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.config.burstLimit, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /**
   * Remove old request timestamps outside the window
   */
  private cleanOldRequests(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter(timestamp => timestamp > cutoff);
  }

  /**
   * Get current status
   */
  getStatus(): {
    tokensAvailable: number;
    requestsInWindow: number;
    windowUtilization: number;
  } {
    const now = Date.now();
    this.refillTokens(now);
    this.cleanOldRequests(now);

    return {
      tokensAvailable: Math.floor(this.tokens),
      requestsInWindow: this.requestTimestamps.length,
      windowUtilization: this.requestTimestamps.length / this.config.requestsPerSecond
    };
  }

  /**
   * Reset rate limiter state
   */
  reset(): void {
    this.tokens = this.config.burstLimit;
    this.lastRefillTime = Date.now();
    this.requestTimestamps = [];

    logger.debug('Rate limiter reset');
  }
}

/**
 * Rate limiter manager for multiple endpoints
 */
export class RateLimiterManager {
  private limiters: Map<string, RateLimiter> = new Map();
  private defaultConfig: RateLimitConfig;

  constructor(defaultConfig: RateLimitConfig) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create rate limiter for endpoint
   */
  getLimiter(endpoint: string, config?: RateLimitConfig): RateLimiter {
    if (!this.limiters.has(endpoint)) {
      const limiterConfig = config || this.defaultConfig;
      this.limiters.set(endpoint, new RateLimiter(limiterConfig));

      logger.debug(`Created rate limiter for endpoint: ${endpoint}`, limiterConfig);
    }

    return this.limiters.get(endpoint)!;
  }

  /**
   * Check rate limit for specific endpoint
   */
  checkEndpointLimit(endpoint: string, config?: RateLimitConfig): RateLimitResult {
    const limiter = this.getLimiter(endpoint, config);
    return limiter.checkLimit();
  }

  /**
   * Wait for endpoint rate limit
   */
  async waitForEndpointLimit(endpoint: string, config?: RateLimitConfig): Promise<void> {
    const limiter = this.getLimiter(endpoint, config);
    return limiter.waitForLimit();
  }

  /**
   * Get status for all rate limiters
   */
  getAllStatus(): Record<string, ReturnType<RateLimiter['getStatus']>> {
    const status: Record<string, ReturnType<RateLimiter['getStatus']>> = {};

    for (const [endpoint, limiter] of this.limiters) {
      status[endpoint] = limiter.getStatus();
    }

    return status;
  }

  /**
   * Reset all rate limiters
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }

    logger.info('All rate limiters reset');
  }
}

/**
 * Exponential backoff calculator
 */
export class ExponentialBackoff {
  private attempt: number = 0;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly jitter: boolean;

  constructor(
    baseDelay: number = 1000,
    maxDelay: number = 30000,
    jitter: boolean = true
  ) {
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.jitter = jitter;
  }

  /**
   * Calculate next delay
   */
  getNextDelay(): number {
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.attempt),
      this.maxDelay
    );

    this.attempt++;

    // Add jitter to prevent thundering herd
    if (this.jitter) {
      return delay + Math.random() * delay * 0.1;
    }

    return delay;
  }

  /**
   * Reset backoff state
   */
  reset(): void {
    this.attempt = 0;
  }

  /**
   * Get current attempt number
   */
  getCurrentAttempt(): number {
    return this.attempt;
  }
}