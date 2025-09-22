/**
 * Retry Helper Utility
 * Implements robust retry logic with exponential backoff for API calls
 */

import { logger } from './logger';

interface ErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
}

interface ErrorWithCode extends Error {
  code?: string;
}

type RetryableError = ErrorWithStatus & ErrorWithCode;

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryCondition?: (error: Error) => boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
}

export class RetryHelper {
  private static readonly DEFAULT_OPTIONS: RetryOptions = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryCondition: (error: Error) => RetryHelper.isRetryableError(error)
  };

  /**
   * Execute a function with retry logic and exponential backoff
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    operationName = 'operation'
  ): Promise<T> {
    const config = { ...RetryHelper.DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    let lastError: Error;
    let attempts = 0;

    logger.debug(`Starting retry operation: ${operationName}`, {
      maxRetries: config.maxRetries,
      baseDelay: config.baseDelay,
      backoffMultiplier: config.backoffMultiplier
    });

    for (attempts = 1; attempts <= config.maxRetries + 1; attempts++) {
      try {
        const result = await operation();
        const duration = Date.now() - startTime;

        if (attempts > 1) {
          logger.info(`✅ Retry operation succeeded: ${operationName}`, {
            attempts,
            duration,
            finalAttempt: attempts
          });
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        // Handle null/undefined errors gracefully
        if (!error) {
          throw error; // Preserve null/undefined errors as-is
        }

        const isLastAttempt = attempts === config.maxRetries + 1;
        const shouldRetry = config.retryCondition!(lastError);

        logger.warn(`❌ Retry operation failed: ${operationName}`, {
          attempt: attempts,
          maxRetries: config.maxRetries,
          error: lastError?.message || String(lastError),
          shouldRetry: shouldRetry && !isLastAttempt,
          isLastAttempt
        });

        // If this is the last attempt or error is not retryable, throw
        if (isLastAttempt || !shouldRetry) {
          const duration = Date.now() - startTime;
          logger.error(`🔥 Retry operation exhausted: ${operationName}`, {
            totalAttempts: attempts,
            totalDuration: duration,
            finalError: lastError?.message || String(lastError)
          });
          throw lastError;
        }

        // Calculate delay for next attempt
        const delay = RetryHelper.calculateDelay(attempts - 1, config);
        logger.debug(`⏳ Retrying ${operationName} in ${delay}ms (attempt ${attempts + 1}/${config.maxRetries + 1})`);

        await RetryHelper.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError!;
  }

  /**
   * Execute multiple operations with retry logic in parallel
   */
  static async withRetryParallel<T>(
    operations: Array<() => Promise<T>>,
    options: Partial<RetryOptions> = {},
    operationName = 'parallel operations'
  ): Promise<T[]> {
    logger.debug(`Starting parallel retry operations: ${operationName}`, {
      operationCount: operations.length,
      options
    });

    const promises = operations.map((operation, index) =>
      RetryHelper.withRetry(operation, options, `${operationName}[${index}]`)
    );

    return Promise.all(promises);
  }

  /**
   * Calculate delay with exponential backoff and optional jitter
   */
  private static calculateDelay(attemptNumber: number, options: RetryOptions): number {
    const exponentialDelay = options.baseDelay * Math.pow(options.backoffMultiplier, attemptNumber);
    let delay = Math.min(exponentialDelay, options.maxDelay);

    // Add jitter to prevent thundering herd
    if (options.jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      const jitter = (Math.random() - 0.5) * 2 * jitterAmount;
      delay = Math.max(0, delay + jitter);
    }

    return Math.round(delay);
  }

  /**
   * Sleep for specified duration
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determine if an error is retryable
   */
  static isRetryableError(error: Error): boolean {
    // Handle null/undefined or non-Error objects
    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorMessage = (error.message || '').toLowerCase();
    const errorName = (error.name || '').toLowerCase();

    // Network and temporary errors that should be retried
    const retryablePatterns = [
      'network',
      'timeout',
      'econnreset',
      'enotfound',
      'econnrefused',
      'etimedout',
      'socket hang up',
      'request timeout',
      'service unavailable',
      'internal server error',
      'bad gateway',
      'gateway timeout',
      'rate limit',
      'too many requests',
      'temporary',
      'temporarily unavailable',
      'service temporarily unavailable'
    ];

    // HTTP status codes that should be retried
    const retryableHttpCodes = [408, 429, 500, 502, 503, 504];

    // Check for retryable patterns in error message
    const hasRetryablePattern = retryablePatterns.some(pattern =>
      errorMessage.includes(pattern) || errorName.includes(pattern)
    );

    // Check for HTTP status codes (if error has status property)
    const httpError = error as RetryableError;
    const httpStatus = httpError.status || httpError.statusCode;
    const hasRetryableStatus = Boolean(httpStatus && retryableHttpCodes.includes(httpStatus));

    // Non-retryable errors (business logic, validation, authentication)
    const nonRetryablePatterns = [
      'invalid token',
      'unauthorized',
      'forbidden',
      'not found',
      'bad request',
      'invalid signature',
      'insufficient balance',
      'slippage tolerance exceeded',
      'position not found',
      'invalid fee tier',
      'token0 and token1 must be different',
      'invalid price range',
      'amount must be greater than zero'
    ];

    const hasNonRetryablePattern = nonRetryablePatterns.some(pattern =>
      errorMessage.includes(pattern)
    );

    // Don't retry if it's a non-retryable pattern
    if (hasNonRetryablePattern) {
      return false;
    }

    // Retry if it has retryable pattern or status
    return hasRetryablePattern || hasRetryableStatus;
  }

  /**
   * Create retry options for specific API types
   */
  static getApiRetryOptions(apiType: 'fast' | 'standard' | 'slow' | 'transaction'): RetryOptions {
    const baseOptions = RetryHelper.DEFAULT_OPTIONS;

    switch (apiType) {
      case 'fast':
        return {
          ...baseOptions,
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 5000
        };

      case 'standard':
        return {
          ...baseOptions,
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 10000
        };

      case 'slow':
        return {
          ...baseOptions,
          maxRetries: 4,
          baseDelay: 2000,
          maxDelay: 20000
        };

      case 'transaction':
        return {
          ...baseOptions,
          maxRetries: 5,
          baseDelay: 3000,
          maxDelay: 30000,
          retryCondition: (error: Error) => {
            // More conservative retry for transactions
            const errorMessage = error.message.toLowerCase();
            return errorMessage.includes('network') ||
                   errorMessage.includes('timeout') ||
                   errorMessage.includes('service unavailable');
          }
        };

      default:
        return baseOptions;
    }
  }

  /**
   * Circuit breaker pattern for critical operations
   */
  static createCircuitBreaker<T>(
    operation: () => Promise<T>,
    options: {
      failureThreshold: number;
      resetTimeout: number;
      monitorWindow: number;
    }
  ) {
    let failureCount = 0;
    let lastFailureTime = 0;
    let state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

    return async (): Promise<T> => {
      const now = Date.now();

      // Reset failure count if monitor window has passed
      if (now - lastFailureTime > options.monitorWindow) {
        failureCount = 0;
      }

      // If circuit is open, check if we should try again
      if (state === 'OPEN') {
        if (now - lastFailureTime < options.resetTimeout) {
          throw new Error('Circuit breaker is OPEN - operation blocked');
        }
        state = 'HALF_OPEN';
      }

      try {
        const result = await operation();

        // Success - reset circuit breaker
        if (state === 'HALF_OPEN') {
          state = 'CLOSED';
          failureCount = 0;
        }

        return result;
      } catch (error) {
        failureCount++;
        lastFailureTime = now;

        // Open circuit if failure threshold exceeded
        if (failureCount >= options.failureThreshold) {
          state = 'OPEN';
          logger.warn('Circuit breaker opened due to excessive failures', {
            failureCount,
            threshold: options.failureThreshold
          });
        }

        throw error;
      }
    };
  }
}