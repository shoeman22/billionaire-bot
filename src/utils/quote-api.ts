/**
 * Working Quote API
 * Drop-in replacement for broken SDK quoteExactInput method
 * Uses the working /v1/trade/quote endpoint instead of broken SDK endpoints
 */

import { logger } from './logger';
import { safeParseFloat } from './safe-parse';
import { liquidityFilter } from './liquidity-filter';

export interface QuoteResult {
  outTokenAmount: string;
  priceImpact?: number;
  feeTier?: number;
  currentPoolSqrtPrice?: string;
  newPoolSqrtPrice?: string;
  fee?: number;
}

export interface QuoteApiResponse {
  status: number;
  message: string;
  error: boolean;
  data?: {
    currentSqrtPrice: string;
    newSqrtPrice: string;
    fee: number;
    amountIn: string;
    amountOut: string;
  };
}

/**
 * Error classes for differentiated error handling
 */
export class RetryableError extends Error {
  constructor(message: string, public errorType: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class NonRetryableError extends Error {
  constructor(message: string, public errorType: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * QuoteApi - Drop-in replacement for broken GalaSwap SDK quoting methods
 *
 * Provides reliable access to GalaSwap V3 quote functionality using the working
 * `/v1/trade/quote` API endpoint with intelligent retry logic and error handling.
 *
 * @example
 * ```typescript
 * const quoteApi = new QuoteApi('https://dex-backend-prod1.defi.gala.com');
 * const result = await quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 1);
 * console.log(`1 GALA = ${result.outTokenAmount} GUSDC`);
 * ```
 */
export class QuoteApi {
  private baseUrl: string;
  private timeout: number = 5000;
  private maxRetries: number = 3;
  private baseDelay: number = 1000; // 1 second base delay

  /**
   * Creates a new QuoteApi instance
   *
   * @param baseUrl - Base URL for the GalaSwap API (e.g., 'https://dex-backend-prod1.defi.gala.com')
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Execute operation with intelligent retry logic
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on final attempt
        if (attempt === this.maxRetries) {
          break;
        }

        // Don't retry non-retryable errors
        if (error instanceof NonRetryableError) {
          logger.warn(`Non-retryable error (${error.errorType}): ${error.message}`);
          throw error;
        }

        // Only retry retryable errors
        if (error instanceof RetryableError) {
          const delay = this.calculateRetryDelay(attempt, error.errorType);
          logger.warn(`Retryable error (${error.errorType}), attempt ${attempt + 1}/${this.maxRetries + 1}, waiting ${delay}ms: ${error.message}`);
          await this.sleep(delay);
          continue;
        }

        // Treat unknown errors as non-retryable for safety
        logger.warn(`Unknown error type, not retrying: ${error}`);
        throw error;
      }
    }

    // All retries exhausted
    throw lastError!;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number, errorType: string): number {
    let baseDelay = this.baseDelay;

    // Different strategies for different error types
    switch (errorType) {
      case 'RATE_LIMIT':
        // Longer delays for rate limits
        baseDelay = 2000;
        break;
      case 'SERVER_ERROR':
        // Standard exponential backoff
        baseDelay = this.baseDelay;
        break;
      default:
        baseDelay = this.baseDelay;
    }

    // Exponential backoff: baseDelay * 2^attempt with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.2 * exponentialDelay; // ±20% jitter
    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create timeout signal with fallback for browser compatibility
   */
  private createTimeoutSignal(timeoutMs: number): AbortSignal {
    // Try modern AbortSignal.timeout first
    if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
      try {
        return AbortSignal.timeout(timeoutMs);
      } catch (error) {
        // Fallback if timeout method fails
        logger.debug('AbortSignal.timeout failed, using fallback');
      }
    }

    // Fallback: create AbortController with setTimeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    // Clean up timeout when signal is used
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
    });

    return controller.signal;
  }

  /**
   * Get a quote for swapping an exact input amount of one token for another
   *
   * Drop-in replacement for the broken `gswap.quoting.quoteExactInput()` method.
   * Automatically converts token formats, handles retries, and calculates price impact.
   *
   * @param tokenIn - Input token in SDK format (e.g., 'GALA|Unit|none|none')
   * @param tokenOut - Output token in SDK format (e.g., 'GUSDC|Unit|none|none')
   * @param amountIn - Amount of input token to quote (as number or string)
   * @returns Promise resolving to quote result with output amount, price impact, and fees
   *
   * @throws {NonRetryableError} For invalid token formats or client errors
   * @throws {RetryableError} For rate limits or server errors (automatically retried)
   *
   * @example
   * ```typescript
   * // Get quote for swapping 100 GALA to GUSDC
   * const quote = await quoteApi.quoteExactInput(
   *   'GALA|Unit|none|none',
   *   'GUSDC|Unit|none|none',
   *   100
   * );
   * console.log(`100 GALA = ${quote.outTokenAmount} GUSDC`);
   * console.log(`Price impact: ${quote.priceImpact}%`);
   * ```
   */
  async quoteExactInput(
    tokenIn: string,
    tokenOut: string,
    amountIn: number | string
  ): Promise<QuoteResult> {
    return this.executeWithRetry(async () => {
      // Validate inputs before processing
      if (!amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0) {
        throw new NonRetryableError(`Invalid amount: ${amountIn} - must be a positive number`, 'VALIDATION_ERROR');
      }

      // Convert SDK token format (GALA|Unit|none|none) to API format (GALA$Unit$none$none)
      const apiTokenIn = this.convertTokenFormat(tokenIn);
      const apiTokenOut = this.convertTokenFormat(tokenOut);

      // Check for identical tokens (would cause API error)
      if (apiTokenIn === apiTokenOut) {
        throw new NonRetryableError(`Invalid token pair: cannot swap identical tokens (${apiTokenIn})`, 'VALIDATION_ERROR');
      }

      // Check liquidity filter to avoid known illiquid pairs
      if (liquidityFilter.shouldFilterPair(tokenIn, tokenOut)) {
        throw new NonRetryableError(`Filtered illiquid pair: ${apiTokenIn} → ${apiTokenOut} - known to lack sufficient liquidity`, 'LIQUIDITY_FILTERED');
      }

      logger.debug(`🔄 Quote request: ${amountIn} ${apiTokenIn} → ${apiTokenOut}`);

      // Use working /v1/trade/quote endpoint
      const url = `${this.baseUrl}/v1/trade/quote?tokenIn=${encodeURIComponent(apiTokenIn)}&tokenOut=${encodeURIComponent(apiTokenOut)}&amountIn=${amountIn}`;

      let response: Response;
      try {
        // Create timeout signal with fallback for browser compatibility
        const signal = this.createTimeoutSignal(this.timeout);

        response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal
        });
      } catch (error) {
        // Handle timeout and network errors
        if (error instanceof Error) {
          if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
            throw new RetryableError(`Request timeout after ${this.timeout}ms`, 'TIMEOUT');
          } else if (error.message.includes('network') || error.message.includes('fetch')) {
            throw new RetryableError(`Network error: ${error.message}`, 'NETWORK_ERROR');
          }
        }
        // Unknown error, don't retry
        throw new NonRetryableError(`Fetch error: ${error}`, 'FETCH_ERROR');
      }

      if (!response.ok) {
        // Try to get error details from response body for better debugging
        let errorDetails = '';
        try {
          const errorBody = await response.text();
          errorDetails = errorBody ? ` - ${errorBody}` : '';
        } catch {
          // Ignore errors when reading response body
        }

        // Classify the error for retry logic
        if (response.status === 429) {
          throw new RetryableError(`Rate limit exceeded: ${response.status}${errorDetails}`, 'RATE_LIMIT');
        } else if (response.status >= 500) {
          throw new RetryableError(`Server error: ${response.status}${errorDetails}`, 'SERVER_ERROR');
        } else if (response.status === 404) {
          throw new NonRetryableError(`Endpoint not found: ${response.status}${errorDetails}`, 'NOT_FOUND');
        } else if (response.status === 400) {
          // Enhanced 400 error with request details for debugging
          throw new NonRetryableError(
            `Bad request (400): Invalid parameters${errorDetails}. Request: ${apiTokenIn} → ${apiTokenOut}, amount: ${amountIn}`,
            'BAD_REQUEST'
          );
        } else {
          throw new NonRetryableError(`Client error: ${response.status}${errorDetails}`, 'CLIENT_ERROR');
        }
      }

      const data = await response.json() as QuoteApiResponse;

      if (data.error || !data.data) {
        // Check if this is a liquidity error and update blacklist
        if (data.message && data.message.includes('No pools found with sufficient liquidity')) {
          liquidityFilter.addToBlacklist(tokenIn, tokenOut, 'api_insufficient_liquidity');
        }

        // API returned error - likely non-retryable (bad token pair, insufficient liquidity)
        throw new NonRetryableError(`Quote API error: ${data.message}`, 'API_ERROR');
      }

      // Calculate price impact from sqrt prices
      const priceImpact = this.calculatePriceImpact(
        data.data.currentSqrtPrice,
        data.data.newSqrtPrice
      );

      // Convert API response back to SDK-expected format
      const result: QuoteResult = {
        outTokenAmount: data.data.amountOut,
        priceImpact: priceImpact,
        feeTier: data.data.fee,
        currentPoolSqrtPrice: data.data.currentSqrtPrice,
        newPoolSqrtPrice: data.data.newSqrtPrice,
        fee: data.data.fee
      };

      logger.debug(`✅ Quote result: ${result.outTokenAmount} ${apiTokenOut} (fee: ${result.fee})`);
      return result;

    });
  }

  /**
   * Convert SDK token format to API format with validation
   * SDK: GALA|Unit|none|none
   * API: GALA$Unit$none$none
   */
  private convertTokenFormat(token: string): string {
    // Validate token format - should have exactly 4 parts separated by pipes
    if (!token || typeof token !== 'string') {
      throw new NonRetryableError(`Invalid token format: token must be a non-empty string, got: ${typeof token}`, 'VALIDATION_ERROR');
    }

    const parts = token.split('|');
    if (parts.length !== 4) {
      throw new NonRetryableError(
        `Invalid token format: expected 4 parts (Collection|Category|Type|AdditionalKey), got ${parts.length} parts in "${token}"`, 'VALIDATION_ERROR'
      );
    }

    // Check that no part is completely empty (though 'none' is valid)
    if (parts.some(part => part === '')) {
      throw new NonRetryableError(`Invalid token format: empty parts not allowed in "${token}"`, 'VALIDATION_ERROR');
    }

    return token.replace(/\|/g, '$');
  }

  /**
   * Calculate price impact from sqrt prices
   * Price impact = ((newPrice - currentPrice) / currentPrice) * 100
   * For Uniswap V3: price = (sqrtPriceX96 / 2^96)^2
   */
  private calculatePriceImpact(currentSqrtPrice: string, newSqrtPrice: string): number {
    try {
      if (!currentSqrtPrice || !newSqrtPrice) {
        return 0; // No price data available
      }

      const current = safeParseFloat(currentSqrtPrice, 0);
      const new_ = safeParseFloat(newSqrtPrice, 0);

      if (current === 0 || isNaN(current) || isNaN(new_)) {
        return 0; // Invalid price data
      }

      // Convert from sqrt price to actual price ratio
      // Since both are sqrt prices, we can compare them directly for impact
      const priceRatio = new_ / current;
      const priceImpact = (priceRatio - 1) * 100;

      // Return absolute value as price impact is typically expressed as magnitude
      return Math.abs(priceImpact);

    } catch (error) {
      logger.warn('Failed to calculate price impact:', error);
      return 0; // Fallback to 0 if calculation fails
    }
  }

  /**
   * Set timeout for quote requests
   *
   * @param timeoutMs - Timeout in milliseconds (default: 5000ms)
   *
   * @example
   * ```typescript
   * quoteApi.setTimeout(10000); // 10 second timeout
   * ```
   */
  setTimeout(timeoutMs: number): void {
    this.timeout = timeoutMs;
  }
}

/**
 * Create a quote wrapper that can be used as drop-in replacement for gswap.quoting
 *
 * Factory function that creates a QuoteApi instance and exposes it with the same
 * interface as the broken SDK method, making migration seamless.
 *
 * @param baseUrl - Base URL for the GalaSwap API
 * @returns Object with quoteExactInput method compatible with SDK interface
 *
 * @example
 * ```typescript
 * // Replace broken SDK usage:
 * // const quote = await this.gswap.quoting.quoteExactInput(tokenIn, tokenOut, amount);
 *
 * // With working wrapper:
 * const quoteWrapper = createQuoteWrapper('https://dex-backend-prod1.defi.gala.com');
 * const quote = await quoteWrapper.quoteExactInput(tokenIn, tokenOut, amount);
 * ```
 */
export function createQuoteWrapper(baseUrl: string) {
  const quoteApi = new QuoteApi(baseUrl);

  return {
    quoteExactInput: (tokenIn: string, tokenOut: string, amountIn: number | string) =>
      quoteApi.quoteExactInput(tokenIn, tokenOut, amountIn)
  };
}