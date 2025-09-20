/**
 * GalaSwap V3 API Client
 * Complete API wrapper for GalaSwap V3 trading operations
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { io, Socket } from 'socket.io-client';
// import { ApiConfig } from '../config/environment'; // Unused - commenting out to fix linting
import { logger } from '../utils/logger';
import { PayloadSigner } from '../utils/signing';
import { RateLimiterManager, ExponentialBackoff, RateLimitConfig } from '../utils/rate-limiter';
import { ENDPOINTS, buildQueryUrl, validateEndpointParams, getEndpointConfig } from './endpoints';
import { API_CONSTANTS } from '../config/constants';
import {
  // Base types
  BaseResponse,
  ErrorResponse,
  TokenClassKey,

  // Quote & Pricing types
  QuoteRequest,
  QuoteResponse,
  // PriceRequest, // Unused - commenting out to fix linting
  PriceResponse,
  // PricesRequest, // Unused - commenting out to fix linting
  PricesResponse,

  // Pool & Liquidity types
  // PoolRequest, // Unused - commenting out to fix linting
  PoolResponse,
  AddLiquidityEstimateRequest,
  AddLiquidityEstimateResponse,
  RemoveLiquidityEstimateRequest,
  RemoveLiquidityEstimateResponse,

  // Position types
  PositionRequest,
  PositionResponse,
  PositionsRequest,
  PositionsResponse,

  // Trading operation types
  SwapPayloadRequest,
  SwapPayloadResponse,
  // SwapPayload, // Unused - commenting out to fix linting
  AddLiquidityPayloadRequest,
  RemoveLiquidityPayloadRequest,
  CollectFeesPayloadRequest,
  CreatePoolPayloadRequest,
  LiquidityPayloadResponse,

  // Bundle & Execution types
  BundleRequest,
  BundleResponse,
  BundleType,
  // TransactionStatusRequest, // Unused - commenting out to fix linting
  TransactionStatusResponse,
  // TransactionStatus, // Unused - commenting out to fix linting

  // Price Oracle types
  // PriceOracleSubscribeRequest, // Unused - commenting out to fix linting
  PriceOracleFetchRequest,
  PriceOracleResponse,

  // WebSocket types
  // WebSocketEvent, // Unused - commenting out to fix linting
  PriceUpdateEvent,
  TransactionUpdateEvent,
  PositionUpdateEvent,

  // Bridge types (for completeness)
  // BridgeConfigurationsResponse, // Unused - commenting out to fix linting
  // BridgeRequest, // Unused - commenting out to fix linting
  // BridgeRequestResponse, // Unused - commenting out to fix linting
  // BridgeStatusRequest, // Unused - commenting out to fix linting
  // BridgeStatusResponse, // Unused - commenting out to fix linting

  // Utility types and functions
  parseTokenKey,
  createTokenKey,
  createTokenClassKey,
  isSuccessResponse,
  isErrorResponse,
  COMMON_TOKENS,
  FEE_TIERS
} from '../types/galaswap';

export interface GalaSwapClientConfig {
  baseUrl: string;
  wsUrl: string;
  walletAddress: string;
  privateKey: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class GalaSwapClient {
  private httpClient: AxiosInstance;
  private wsClient: Socket | null = null;
  private config: GalaSwapClientConfig;
  private signer: PayloadSigner;
  private rateLimiterManager: RateLimiterManager;
  private connectionHealth: {
    isHealthy: boolean;
    lastCheck: number;
    consecutiveFailures: number;
    lastSuccessfulRequest: number;
  };
  private wsReconnectionAttempts: number = 0;
  private maxWsReconnectionAttempts: number = 10;

  constructor(config: GalaSwapClientConfig) {
    this.config = {
      timeout: 10000,
      retryAttempts: 3, // Simple 3-retry approach
      retryDelay: 1000, // Simple 1-second delay
      ...config
    };

    // Initialize HTTP client
    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'billionaire-bot/1.0.0',
      },
    });

    // Initialize payload signer
    this.signer = new PayloadSigner({
      privateKey: this.config.privateKey,
      userAddress: this.config.walletAddress
    });

    // Initialize rate limiter manager
    this.rateLimiterManager = new RateLimiterManager({
      requestsPerSecond: API_CONSTANTS.RATE_LIMITS.MEDIUM_FREQUENCY.REQUESTS_PER_SECOND,
      burstLimit: API_CONSTANTS.RATE_LIMITS.MEDIUM_FREQUENCY.BURST_LIMIT
    });

    // Initialize connection health tracking
    this.connectionHealth = {
      isHealthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
      lastSuccessfulRequest: Date.now()
    };

    // Setup HTTP interceptors
    this.setupInterceptors();

    logger.info('GalaSwap V3 Client initialized', {
      baseUrl: this.config.baseUrl,
      walletAddress: this.config.walletAddress.substring(0, 10) + '...'
    });
  }

  /**
   * Setup HTTP interceptors for logging, retry logic, and error handling
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.httpClient.interceptors.request.use(
      (config) => {
        logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`, {
          params: config.params,
          dataSize: config.data ? JSON.stringify(config.data).length : 0
        });
        return config;
      },
      (error) => {
        logger.error('API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor with retry logic
    this.httpClient.interceptors.response.use(
      (response: AxiosResponse) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`, {
          status: response.status,
          dataSize: response.data ? JSON.stringify(response.data).length : 0
        });
        return response;
      },
      async (error: AxiosError) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config = error.config as any;

        // Initialize retry count
        if (!config.__retryCount) {
          config.__retryCount = 0;
        }

        // Check if we should retry
        const shouldRetry = this.shouldRetry(error) && config.__retryCount < (this.config.retryAttempts || 3);

        if (shouldRetry) {
          config.__retryCount++;

          logger.warn(`Retrying request (attempt ${config.__retryCount}/${this.config.retryAttempts})`, {
            url: config.url,
            error: error.message
          });

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));

          return this.httpClient(config);
        }

        logger.error('API Response Error:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: config?.url,
          method: config?.method
        });

        return Promise.reject(this.createApiError(error));
      }
    );
  }

  /**
   * Determine if request should be retried (enhanced)
   */
  private shouldRetry(error: AxiosError): boolean {
    return this.isRetryableError(error);
  }

  /**
   * Create standardized API error
   */
  private createApiError(error: AxiosError): Error {
    const errorData = error.response?.data as ErrorResponse | undefined;
    const message = errorData?.message || error.message;
    const apiError = new Error(`GalaSwap API Error: ${message}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiError as any).status = error.response?.status;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiError as any).endpoint = error.config?.url;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiError as any).method = error.config?.method;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiError as any).originalError = error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiError as any).errorCode = errorData?.errorCode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiError as any).errorKey = errorData?.errorKey;

    return apiError;
  }

  /**
   * Check and wait for rate limits
   */
  private async checkRateLimit(endpoint: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const endpointConfig = getEndpointConfig(endpoint as any);

    if (!endpointConfig.rateLimit) {
      // Use default rate limiting
      await this.rateLimiterManager.waitForEndpointLimit(endpoint);
      return;
    }

    // Use endpoint-specific rate limiting
    const rateLimitConfig: RateLimitConfig = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requestsPerSecond: (endpointConfig.rateLimit as any).requestsPerSecond,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      burstLimit: (endpointConfig.rateLimit as any).burstLimit || (endpointConfig.rateLimit as any).requestsPerSecond * 2,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      windowMs: (endpointConfig.rateLimit as any).windowMs || 1000
    };

    await this.rateLimiterManager.waitForEndpointLimit(endpoint, rateLimitConfig);
  }

  /**
   * Make HTTP request with enhanced validation, rate limiting and error recovery
   */
  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: Record<string, any>
  ): Promise<T> {
    // Check connection health
    await this.ensureConnectionHealth();

    // Apply rate limiting
    await this.checkRateLimit(endpoint);

    // Validate parameters
    if (params) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const validation = validateEndpointParams(endpoint as any, params);
      if (!validation.isValid) {
        throw new Error(`Invalid parameters: ${validation.errors.join(', ')}`);
      }
    }

    return this.executeWithRetry(async () => {
      // Build request
      const config = getEndpointConfig(endpoint as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const url = method === 'GET' && params ? buildQueryUrl(endpoint, params) : endpoint;

      const requestConfig = {
        method,
        url,
        timeout: config.timeout || this.config.timeout,
        ...(method !== 'GET' && data && { data }),
        ...(method === 'GET' && !params && { params })
      };

      const response = await this.httpClient.request<T>(requestConfig);

      // Update connection health on success
      this.updateConnectionHealth(true);

      return response.data;
    });
  }

  /**
   * Simple retry method for localhost trading (3 retries, 1-second delay)
   * Keeps it simple and reliable for basic network hiccups
   */
  private async simpleRetry<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await operation();

        if (attempt > 0) {
          logger.info(`✅ Operation succeeded after ${attempt} retries`);
        }

        return result;

      } catch (error) {
        lastError = error as Error;

        logger.warn(`❌ Attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`);

        // Don't retry on final attempt
        if (attempt === maxRetries - 1) {
          break;
        }

        // Simple 1-second delay between retries (no exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw lastError || new Error('Operation failed after simple retries');
  }

  /**
   * Execute operation with smart retry logic and exponential backoff (legacy)
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    const backoff = new ExponentialBackoff(this.config.retryDelay, 30000);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= (this.config.retryAttempts || 3); attempt++) {
      try {
        const result = await operation();

        // Reset backoff on success
        if (attempt > 0) {
          logger.info(`Operation succeeded after ${attempt} retries`);
        }

        return result;

      } catch (error) {
        lastError = error as Error;

        // Update connection health on failure
        this.updateConnectionHealth(false);

        // Don't retry on final attempt
        if (attempt === (this.config.retryAttempts || 3)) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error as AxiosError)) {
          logger.warn('Non-retryable error encountered', { error: lastError.message });
          break;
        }

        // Calculate delay with exponential backoff
        const delay = backoff.getNextDelay();

        logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${this.config.retryAttempts})`, {
          error: lastError.message,
          attempt: attempt + 1
        });

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: AxiosError): boolean {
    // Network errors (no response)
    if (!error.response) {
      return true;
    }

    const status = error.response.status;

    // Server errors and rate limits are retryable
    if (status >= 500 || status === 429) {
      return true;
    }

    // Timeout errors
    if (error.code === 'ECONNABORTED') {
      return true;
    }

    // Connection errors
    if (['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code || '')) {
      return true;
    }

    // Client errors (4xx) are generally not retryable except rate limiting
    return false;
  }

  /**
   * Ensure connection health before making requests
   */
  private async ensureConnectionHealth(): Promise<void> {
    const now = Date.now();

    // Check if we need to verify health
    if (this.connectionHealth.consecutiveFailures >= 3 ||
        (now - this.connectionHealth.lastCheck) > 30000) {

      try {
        // Try a simple health check
        await this.httpClient.get('/health', { timeout: 5000 });

        this.connectionHealth.isHealthy = true;
        this.connectionHealth.consecutiveFailures = 0;
        this.connectionHealth.lastCheck = now;

        logger.debug('Connection health check passed');

      } catch (error) {
        this.connectionHealth.isHealthy = false;
        this.connectionHealth.consecutiveFailures++;
        this.connectionHealth.lastCheck = now;

        logger.warn('Connection health check failed', {
          consecutiveFailures: this.connectionHealth.consecutiveFailures,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // If too many failures, throw error
        if (this.connectionHealth.consecutiveFailures >= 5) {
          throw new Error('API connection unhealthy - too many consecutive failures');
        }
      }
    }
  }

  /**
   * Update connection health metrics
   */
  private updateConnectionHealth(success: boolean): void {
    const now = Date.now();

    if (success) {
      this.connectionHealth.isHealthy = true;
      this.connectionHealth.consecutiveFailures = 0;
      this.connectionHealth.lastSuccessfulRequest = now;
    } else {
      this.connectionHealth.consecutiveFailures++;
      if (this.connectionHealth.consecutiveFailures >= 3) {
        this.connectionHealth.isHealthy = false;
      }
    }

    this.connectionHealth.lastCheck = now;
  }

  // ===========================================
  // QUOTE & PRICING API METHODS
  // ===========================================

  /**
   * Get swap quote for token pair (with simple retry for reliability)
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    return this.simpleRetry(() =>
      this.makeRequest<QuoteResponse>(
        ENDPOINTS.QUOTE,
        'GET',
        request
      )
    );
  }

  /**
   * Get price for a single token
   */
  async getPrice(token: string): Promise<PriceResponse> {
    return this.makeRequest<PriceResponse>(
      ENDPOINTS.PRICE,
      'GET',
      { token }
    );
  }

  /**
   * Get prices for multiple tokens
   */
  async getPrices(tokens: string[]): Promise<PricesResponse> {
    return this.makeRequest<PricesResponse>(
      ENDPOINTS.PRICE_MULTIPLE,
      'POST',
      undefined,
      { tokens }
    );
  }

  // ===========================================
  // POOL & LIQUIDITY API METHODS
  // ===========================================

  /**
   * Get pool information
   */
  async getPool(token0: string, token1: string, fee: number): Promise<PoolResponse> {
    return this.makeRequest<PoolResponse>(
      ENDPOINTS.POOL,
      'GET',
      { token0, token1, fee }
    );
  }

  /**
   * Estimate amounts for adding liquidity
   */
  async getAddLiquidityEstimate(request: AddLiquidityEstimateRequest): Promise<AddLiquidityEstimateResponse> {
    return this.makeRequest<AddLiquidityEstimateResponse>(
      ENDPOINTS.ADD_LIQUIDITY_ESTIMATE,
      'GET',
      request
    );
  }

  /**
   * Estimate amounts for removing liquidity
   */
  async getRemoveLiquidityEstimate(request: RemoveLiquidityEstimateRequest): Promise<RemoveLiquidityEstimateResponse> {
    return this.makeRequest<RemoveLiquidityEstimateResponse>(
      ENDPOINTS.REMOVE_LIQUIDITY_ESTIMATE,
      'GET',
      request
    );
  }

  // ===========================================
  // POSITION MANAGEMENT API METHODS
  // ===========================================

  /**
   * Get specific position details
   */
  async getPosition(request: PositionRequest): Promise<PositionResponse> {
    return this.makeRequest<PositionResponse>(
      ENDPOINTS.POSITION,
      'GET',
      request
    );
  }

  /**
   * Get all positions for a user
   */
  async getPositions(request: PositionsRequest): Promise<PositionsResponse> {
    return this.makeRequest<PositionsResponse>(
      ENDPOINTS.POSITIONS,
      'GET',
      request
    );
  }

  /**
   * Get user positions (convenience method)
   */
  async getUserPositions(userAddress?: string, limit: number = 50): Promise<PositionsResponse> {
    const user = userAddress || this.config.walletAddress;
    return this.getPositions({ user, limit });
  }

  // ===========================================
  // TRADING OPERATIONS API METHODS
  // ===========================================

  /**
   * Generate swap payload (for signing)
   */
  async generateSwapPayload(request: SwapPayloadRequest): Promise<SwapPayloadResponse> {
    return this.makeRequest<SwapPayloadResponse>(
      ENDPOINTS.SWAP_PAYLOAD,
      'POST',
      undefined,
      request
    );
  }

  /**
   * Generate add liquidity payload (for signing)
   */
  async generateAddLiquidityPayload(request: AddLiquidityPayloadRequest): Promise<LiquidityPayloadResponse> {
    return this.makeRequest<LiquidityPayloadResponse>(
      ENDPOINTS.LIQUIDITY_PAYLOAD,
      'POST',
      undefined,
      request
    );
  }

  /**
   * Generate remove liquidity payload (for signing)
   */
  async generateRemoveLiquidityPayload(request: RemoveLiquidityPayloadRequest): Promise<LiquidityPayloadResponse> {
    return this.makeRequest<LiquidityPayloadResponse>(
      ENDPOINTS.LIQUIDITY_PAYLOAD,
      'DELETE',
      undefined,
      request
    );
  }

  /**
   * Generate collect fees payload (for signing)
   */
  async generateCollectFeesPayload(request: CollectFeesPayloadRequest): Promise<LiquidityPayloadResponse> {
    return this.makeRequest<LiquidityPayloadResponse>(
      ENDPOINTS.COLLECT_PAYLOAD,
      'POST',
      undefined,
      request
    );
  }

  /**
   * Generate create pool payload (for signing)
   */
  async generateCreatePoolPayload(request: CreatePoolPayloadRequest): Promise<LiquidityPayloadResponse> {
    return this.makeRequest<LiquidityPayloadResponse>(
      ENDPOINTS.CREATE_POOL_PAYLOAD,
      'POST',
      undefined,
      request
    );
  }

  // ===========================================
  // BUNDLE & EXECUTION API METHODS
  // ===========================================

  /**
   * Execute signed payload via bundle (with simple retry for transaction reliability)
   */
  async executeBundle(payload: any, type: BundleType, signature?: string): Promise<BundleResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const bundleSignature = signature || await this.signer.signPayload(payload);

    const bundleRequest: BundleRequest = {
      payload,
      type,
      signature: bundleSignature,
      user: this.config.walletAddress
    };

    return this.simpleRetry(() =>
      this.makeRequest<BundleResponse>(
        ENDPOINTS.BUNDLE,
        'POST',
        undefined,
        bundleRequest
      )
    );
  }

  /**
   * Get transaction status (with simple retry for monitoring reliability)
   */
  async getTransactionStatus(transactionId: string): Promise<TransactionStatusResponse> {
    return this.simpleRetry(() =>
      this.makeRequest<TransactionStatusResponse>(
        ENDPOINTS.TRANSACTION_STATUS,
        'GET',
        { id: transactionId }
      )
    );
  }

  // ===========================================
  // HIGH-LEVEL TRADING METHODS
  // ===========================================

  /**
   * Complete swap operation (generate payload, sign, and execute)
   */
  async swap(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    fee: number,
    slippageTolerance: number = 0.01
  ): Promise<{ bundleResponse: BundleResponse; transactionId: string }> {
    try {
      logger.info(`Starting swap: ${amountIn} ${tokenIn} -> ${tokenOut}`, {
        fee,
        slippageTolerance
      });

      // 1. Get quote to calculate expected output and price impact
      const quote = await this.getQuote({
        tokenIn,
        tokenOut,
        amountIn,
        fee
      });

      if (!isSuccessResponse(quote)) {
        const errorMsg = isErrorResponse(quote) ? (quote as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to get quote: ${errorMsg}`);
      }

      // 2. Calculate slippage protection
      const expectedOutput = parseFloat(quote.data.amountOut);
      const minimumOutput = expectedOutput * (1 - slippageTolerance);

      // 3. Generate swap payload
      const swapPayload = await this.generateSwapPayload({
        tokenIn: createTokenClassKey(tokenIn),
        tokenOut: createTokenClassKey(tokenOut),
        amountIn,
        fee,
        sqrtPriceLimit: quote.data.newSqrtPrice,
        amountInMaximum: amountIn,
        amountOutMinimum: minimumOutput.toString()
      });

      if (!isSuccessResponse(swapPayload)) {
        const errorMsg = isErrorResponse(swapPayload) ? (swapPayload as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to generate swap payload: ${errorMsg}`);
      }

      // 4. Sign and execute bundle
      const bundleResponse = await this.executeBundle(
        swapPayload.data,
        'swap'
      );

      if (!isSuccessResponse(bundleResponse)) {
        const errorMsg = isErrorResponse(bundleResponse) ? (bundleResponse as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to execute swap bundle: ${errorMsg}`);
      }

      logger.info('Swap executed successfully', {
        transactionId: bundleResponse.data.data,
        expectedOutput,
        minimumOutput
      });

      return {
        bundleResponse,
        transactionId: bundleResponse.data.data
      };

    } catch (error) {
      logger.error('Swap failed:', error);
      throw error;
    }
  }

  /**
   * Add liquidity to a pool
   */
  async addLiquidity(
    token0: string,
    token1: string,
    fee: number,
    tickLower: number,
    tickUpper: number,
    amount0: string,
    amount1: string,
    slippageTolerance: number = 0.01
  ): Promise<{ bundleResponse: BundleResponse; transactionId: string }> {
    try {
      logger.info(`Adding liquidity to ${token0}/${token1} pool`, {
        fee,
        tickLower,
        tickUpper,
        amount0,
        amount1
      });

      // Calculate minimum amounts with slippage protection
      const amount0Min = (parseFloat(amount0) * (1 - slippageTolerance)).toString();
      const amount1Min = (parseFloat(amount1) * (1 - slippageTolerance)).toString();

      // Generate add liquidity payload
      const liquidityPayload = await this.generateAddLiquidityPayload({
        token0: createTokenClassKey(token0),
        token1: createTokenClassKey(token1),
        fee,
        tickLower,
        tickUpper,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min,
        amount1Min
      });

      if (!isSuccessResponse(liquidityPayload)) {
        const errorMsg = isErrorResponse(liquidityPayload) ? (liquidityPayload as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to generate liquidity payload: ${errorMsg}`);
      }

      // Execute bundle
      const bundleResponse = await this.executeBundle(
        liquidityPayload.data,
        'addLiquidity'
      );

      if (!isSuccessResponse(bundleResponse)) {
        const errorMsg = isErrorResponse(bundleResponse) ? (bundleResponse as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to execute add liquidity bundle: ${errorMsg}`);
      }

      logger.info('Liquidity added successfully', {
        transactionId: bundleResponse.data.data
      });

      return {
        bundleResponse,
        transactionId: bundleResponse.data.data
      };

    } catch (error) {
      logger.error('Add liquidity failed:', error);
      throw error;
    }
  }

  /**
   * Remove liquidity from a position
   */
  async removeLiquidity(
    token0: string,
    token1: string,
    fee: number,
    tickLower: number,
    tickUpper: number,
    liquidityAmount: string,
    slippageTolerance: number = 0.01
  ): Promise<{ bundleResponse: BundleResponse; transactionId: string }> {
    try {
      logger.info(`Removing liquidity from ${token0}/${token1} position`, {
        fee,
        tickLower,
        tickUpper,
        liquidityAmount
      });

      // Get estimate for removal
      const estimate = await this.getRemoveLiquidityEstimate({
        token0,
        token1,
        owner: this.config.walletAddress,
        tickUpper,
        tickLower,
        fee,
        amount: parseFloat(liquidityAmount)
      });

      if (!isSuccessResponse(estimate)) {
        const errorMsg = isErrorResponse(estimate) ? (estimate as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to get removal estimate: ${errorMsg}`);
      }

      // Calculate minimum amounts with slippage protection
      const amount0Min = (parseFloat(estimate.data.Data.amount0) * (1 - slippageTolerance)).toString();
      const amount1Min = (parseFloat(estimate.data.Data.amount1) * (1 - slippageTolerance)).toString();

      // Generate remove liquidity payload
      const liquidityPayload = await this.generateRemoveLiquidityPayload({
        token0: createTokenClassKey(token0),
        token1: createTokenClassKey(token1),
        fee,
        tickLower,
        tickUpper,
        amount: liquidityAmount,
        amount0Min,
        amount1Min
      });

      if (!isSuccessResponse(liquidityPayload)) {
        const errorMsg = isErrorResponse(liquidityPayload) ? (liquidityPayload as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to generate removal payload: ${errorMsg}`);
      }

      // Execute bundle
      const bundleResponse = await this.executeBundle(
        liquidityPayload.data,
        'removeLiquidity'
      );

      if (!isSuccessResponse(bundleResponse)) {
        const errorMsg = isErrorResponse(bundleResponse) ? (bundleResponse as ErrorResponse).message : 'Unknown error';
        throw new Error(`Failed to execute remove liquidity bundle: ${errorMsg}`);
      }

      logger.info('Liquidity removed successfully', {
        transactionId: bundleResponse.data.data
      });

      return {
        bundleResponse,
        transactionId: bundleResponse.data.data
      };

    } catch (error) {
      logger.error('Remove liquidity failed:', error);
      throw error;
    }
  }

  // ===========================================
  // PRICE ORACLE API METHODS
  // ===========================================

  /**
   * Subscribe to token price updates
   */
  async subscribeToPriceUpdates(token: TokenClassKey): Promise<BaseResponse> {
    return this.makeRequest<BaseResponse>(
      ENDPOINTS.PRICE_ORACLE_SUBSCRIBE,
      'POST',
      undefined,
      { subscribe: true, token }
    );
  }

  /**
   * Fetch historical price data
   */
  async fetchPriceHistory(request: PriceOracleFetchRequest): Promise<PriceOracleResponse> {
    const method = request.from || request.to ? 'POST' : 'GET';

    return this.makeRequest<PriceOracleResponse>(
      ENDPOINTS.PRICE_ORACLE_FETCH,
      method,
      method === 'GET' ? request : undefined,
      method === 'POST' ? request : undefined
    );
  }

  // ===========================================
  // WEBSOCKET METHODS
  // ===========================================

  /**
   * Connect to WebSocket with enhanced reconnection logic
   */
  async connectWebSocket(): Promise<void> {
    if (this.wsClient && this.wsClient.connected) {
      logger.warn('WebSocket already connected');
      return;
    }

    // Disconnect existing client if any
    if (this.wsClient) {
      this.wsClient.disconnect();
    }

    this.wsClient = io(this.config.wsUrl, {
      timeout: 30000,
      reconnection: true,
      reconnectionAttempts: this.maxWsReconnectionAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5
    });

    this.setupWebSocketEventHandlers();

    // Return promise that resolves when connected
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 30000);

      this.wsClient!.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.wsClient!.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Setup WebSocket event handlers with enhanced error handling
   */
  private setupWebSocketEventHandlers(): void {
    if (!this.wsClient) return;

    this.wsClient.on('connect', () => {
      logger.info('WebSocket connected to GalaSwap V3');
      this.wsReconnectionAttempts = 0;
    });

    this.wsClient.on('disconnect', (reason) => {
      logger.warn(`WebSocket disconnected: ${reason}`);

      // Simple reconnection for localhost trading
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, try simple reconnection once
        logger.info('Server disconnected, attempting simple reconnection...');
        setTimeout(() => this.simpleWebSocketReconnect(), 1000);
      }
    });

    this.wsClient.on('connect_error', (error) => {
      logger.error('WebSocket connection error:', error);
      this.wsReconnectionAttempts++;

      if (this.wsReconnectionAttempts >= this.maxWsReconnectionAttempts) {
        logger.error('Max WebSocket reconnection attempts reached');
      }
    });

    this.wsClient.on('reconnect', (attemptNumber) => {
      logger.info(`WebSocket reconnected after ${attemptNumber} attempts`);
      this.wsReconnectionAttempts = 0;
    });

    this.wsClient.on('reconnect_error', (error) => {
      logger.error('WebSocket reconnection error:', error);
    });

    this.wsClient.on('reconnect_failed', () => {
      logger.error('WebSocket reconnection failed completely');
    });

    // Handle general errors
    this.wsClient.on('error', (error: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      logger.error('WebSocket error:', error);
    });
  }

  /**
   * Simple WebSocket reconnection for localhost trading
   * Try once, if it fails log error and continue without WebSocket
   */
  private async simpleWebSocketReconnect(): Promise<void> {
    try {
      logger.info('🔄 Attempting simple WebSocket reconnection...');
      await this.connectWebSocket();
      logger.info('✅ WebSocket reconnected successfully');
    } catch (error) {
      logger.warn('❌ WebSocket reconnection failed - continuing without WebSocket:', error);
      // Don't throw - just continue without WebSocket for localhost trading
    }
  }

  /**
   * Manual WebSocket reconnection with exponential backoff (legacy)
   */
  private async reconnectWebSocket(): Promise<void> {
    if (this.wsReconnectionAttempts >= this.maxWsReconnectionAttempts) {
      logger.error('Cannot reconnect: max attempts reached');
      return;
    }

    this.wsReconnectionAttempts++;

    // Exponential backoff
    const delay = Math.min(1000 * Math.pow(2, this.wsReconnectionAttempts - 1), 30000);

    logger.info(`Attempting WebSocket reconnection ${this.wsReconnectionAttempts}/${this.maxWsReconnectionAttempts} in ${delay}ms`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connectWebSocket();
    } catch (error) {
      logger.error('Manual WebSocket reconnection failed:', error);

      if (this.wsReconnectionAttempts < this.maxWsReconnectionAttempts) {
        // Try again
        this.reconnectWebSocket();
      }
    }
  }

  /**
   * Disconnect WebSocket cleanly
   */
  async disconnectWebSocket(): Promise<void> {
    if (this.wsClient) {
      // Remove all listeners to prevent memory leaks
      this.wsClient.removeAllListeners();

      // Disconnect and cleanup
      this.wsClient.disconnect();
      this.wsClient = null;

      // Reset reconnection attempts
      this.wsReconnectionAttempts = 0;

      logger.info('WebSocket disconnected and cleaned up');
    }
  }

  /**
   * Subscribe to price updates via WebSocket
   */
  subscribeToTokenPrices(tokens: string[], callback: (event: PriceUpdateEvent) => void): void {
    if (!this.wsClient) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.');
    }

    this.wsClient.emit('subscribe_prices', { tokens });
    this.wsClient.on('price_update', callback);

    logger.info(`Subscribed to price updates for ${tokens.length} tokens`);
  }

  /**
   * Subscribe to transaction updates via WebSocket
   */
  subscribeToTransactionUpdates(callback: (event: TransactionUpdateEvent) => void): void {
    if (!this.wsClient) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.');
    }

    this.wsClient.on('transaction_update', callback);
    logger.info('Subscribed to transaction updates');
  }

  /**
   * Subscribe to position updates via WebSocket
   */
  subscribeToPositionUpdates(userAddress: string, callback: (event: PositionUpdateEvent) => void): void {
    if (!this.wsClient) {
      throw new Error('WebSocket not connected. Call connectWebSocket() first.');
    }

    this.wsClient.emit('subscribe_positions', { user: userAddress });
    this.wsClient.on('position_update', callback);

    logger.info(`Subscribed to position updates for ${userAddress}`);
  }

  // ===========================================
  // UTILITY METHODS
  // ===========================================

  /**
   * Enhanced health check with detailed status
   */
  async healthCheck(): Promise<{
    isHealthy: boolean;
    apiStatus: 'healthy' | 'degraded' | 'unhealthy';
    websocketStatus: 'connected' | 'disconnected' | 'error';
    lastSuccessfulRequest: number;
    consecutiveFailures: number;
    rateLimiterStatus: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }> {
    let apiStatus: 'healthy' | 'degraded' | 'unhealthy' = 'unhealthy';

    try {
      const start = Date.now();
      await this.makeRequest<BaseResponse>(ENDPOINTS.HEALTH, 'GET');
      const responseTime = Date.now() - start;

      if (responseTime < 1000) {
        apiStatus = 'healthy';
      } else if (responseTime < 5000) {
        apiStatus = 'degraded';
      }

    } catch (error) {
      logger.error('Health check failed:', error);
      apiStatus = 'unhealthy';
    }

    // Check WebSocket status
    let websocketStatus: 'connected' | 'disconnected' | 'error' = 'disconnected';
    if (this.wsClient) {
      if (this.wsClient.connected) {
        websocketStatus = 'connected';
      } else {
        websocketStatus = 'error';
      }
    }

    const isHealthy = apiStatus === 'healthy' && this.connectionHealth.consecutiveFailures < 3;

    return {
      isHealthy,
      apiStatus,
      websocketStatus,
      lastSuccessfulRequest: this.connectionHealth.lastSuccessfulRequest,
      consecutiveFailures: this.connectionHealth.consecutiveFailures,
      rateLimiterStatus: this.rateLimiterManager.getAllStatus()
    };
  }

  /**
   * Get connection health metrics
   */
  getConnectionHealth(): typeof this.connectionHealth {
    return { ...this.connectionHealth };
  }

  /**
   * Reset rate limiters
   */
  resetRateLimiters(): void {
    this.rateLimiterManager.resetAll();
    logger.info('All rate limiters reset');
  }

  /**
   * Enhanced transaction monitoring with WebSocket fallback
   */
  async monitorTransaction(
    transactionId: string,
    timeoutMs: number = 300000, // 5 minutes
    pollIntervalMs: number = 3000 // 3 seconds
  ): Promise<TransactionStatusResponse> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const startTime = Date.now();
    let useWebSocket = this.wsClient?.connected || false;

    logger.info(`Monitoring transaction: ${transactionId}`, {
      timeout: timeoutMs,
      pollInterval: pollIntervalMs,
      useWebSocket
    });

    // Try WebSocket monitoring first if available
    if (useWebSocket) {
      try {
        return await this.monitorTransactionViaWebSocket(transactionId, timeoutMs);
      } catch (error) {
        logger.warn('WebSocket monitoring failed, falling back to polling', { error });
        useWebSocket = false;
      }
    }

    // Fallback to polling with exponential backoff
    return this.monitorTransactionViaPolling(transactionId, timeoutMs, pollIntervalMs);
  }

  /**
   * Monitor transaction via WebSocket
   */
  private async monitorTransactionViaWebSocket(
    transactionId: string,
    timeoutMs: number
  ): Promise<TransactionStatusResponse> {
    return new Promise((resolve, reject) => {
      if (!this.wsClient?.connected) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        this.wsClient?.off('transaction_update', handler);
        reject(new Error(`Transaction timeout: ${transactionId}`));
      }, timeoutMs);

      const handler = (event: TransactionUpdateEvent) => {
        if (event.data.transactionId === transactionId) {
          clearTimeout(timeout);
          this.wsClient?.off('transaction_update', handler);

          if (event.data.status === 'CONFIRMED') {
            logger.info(`Transaction confirmed via WebSocket: ${transactionId}`);
            resolve({
              error: false,
              status: 200,
              message: 'Transaction confirmed',
              data: {
                id: transactionId,
                method: 'transaction_status',
                status: event.data.status,
                blockNumber: event.data.blockNumber,
                transactionHash: event.data.hash
              }
            } as TransactionStatusResponse);
          } else if (event.data.status === 'FAILED' || event.data.status === 'REJECTED') {
            reject(new Error(`Transaction failed: ${transactionId}, status: ${event.data.status}`));
          }
        }
      };

      this.wsClient.on('transaction_update', handler);

      // Subscribe to transaction updates
      this.wsClient.emit('subscribe_transaction', { transactionId });
    });
  }

  /**
   * Monitor transaction via polling with exponential backoff
   */
  private async monitorTransactionViaPolling(
    transactionId: string,
    timeoutMs: number,
    initialPollIntervalMs: number
  ): Promise<TransactionStatusResponse> {
    const startTime = Date.now();
    let pollInterval = initialPollIntervalMs;
    let consecutiveErrors = 0;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.getTransactionStatus(transactionId);

        if (isSuccessResponse(status)) {
          const txStatus = status.data.status;

          if (txStatus === 'CONFIRMED') {
            logger.info(`Transaction confirmed via polling: ${transactionId}`);
            return status;
          } else if (txStatus === 'FAILED' || txStatus === 'REJECTED') {
            throw new Error(`Transaction failed: ${transactionId}, status: ${txStatus}`);
          }

          // Reset error count and poll interval on success
          consecutiveErrors = 0;
          pollInterval = initialPollIntervalMs;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        consecutiveErrors++;

        logger.warn(`Error checking transaction status (attempt ${consecutiveErrors}): ${error}`);

        // Exponential backoff on errors, but cap at 30 seconds
        pollInterval = Math.min(initialPollIntervalMs * Math.pow(2, consecutiveErrors - 1), 30000);

        // If too many consecutive errors, throw
        if (consecutiveErrors >= 10) {
          throw new Error(`Too many consecutive errors monitoring transaction: ${transactionId}`);
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`Transaction monitoring timeout: ${transactionId}`);
  }

  /**
   * Legacy method for backwards compatibility
   */
  async waitForTransaction(
    transactionId: string,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<TransactionStatusResponse> {
    return this.monitorTransaction(transactionId, timeoutMs, pollIntervalMs);
  }

  /**
   * Get wallet configuration
   */
  getWalletAddress(): string {
    return this.config.walletAddress;
  }

  /**
   * Get supported fee tiers
   */
  getSupportedFeeTiers(): number[] {
    return [FEE_TIERS.STABLE, FEE_TIERS.STANDARD, FEE_TIERS.VOLATILE];
  }

  /**
   * Get common tokens
   */
  getCommonTokens(): typeof COMMON_TOKENS {
    return COMMON_TOKENS;
  }

  /**
   * Parse token composite key
   */
  parseToken(compositeKey: string) {
    return parseTokenKey(compositeKey);
  }

  /**
   * Create token composite key
   */
  createTokenKey(token: TokenClassKey): string {
    return createTokenKey(token);
  }
}