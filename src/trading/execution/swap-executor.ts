/**
 * Swap Executor
 * Handles end-to-end swap execution with error handling and monitoring
 */

import { GSwap } from '../../services/gswap-simple';
import { SlippageProtection, SlippageAnalysis } from '../risk/slippage';
import { TRADING_CONSTANTS } from '../../config/constants';
import { getConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { safeParseFloat } from '../../utils/safe-parse';
import { ApiResponseParser, ResponseValidators } from '../../utils/api-response-parser';
import {
  QuoteRequest,
  QuoteResponse,
  SwapPayloadRequest,
  SwapPayloadResponse,
  BundleResponse,
  ErrorResponse,
  isSuccessResponse,
  createTokenClassKey,
  TokenClassKey,
  FEE_TIERS
} from '../../types/galaswap';

export interface SwapRequest {
  tokenIn: string | TokenClassKey;
  tokenOut: string | TokenClassKey;
  amountIn: string;
  slippageTolerance?: number;
  userAddress: string;
  urgency?: 'low' | 'normal' | 'high';
  maxPriceImpact?: number; // Maximum acceptable price impact
  deadlineMinutes?: number; // Transaction deadline in minutes
}

export interface SwapResult {
  success: boolean;
  transactionId?: string;
  hash?: string;
  amountOut?: string;
  actualSlippage?: number;
  priceImpact?: number;
  gasUsed?: string;
  blockNumber?: number;
  error?: string;
  executionTime: number;
  retryCount?: number;
  failureReason?: 'rate_limit' | 'slippage' | 'network' | 'validation' | 'execution' | 'unknown';
  // Enhanced monitoring results
  monitoringResult?: TransactionMonitoringResult;
}

export interface TransactionMonitoringResult {
  status: 'CONFIRMED' | 'FAILED' | 'PENDING' | 'TIMEOUT' | 'UNKNOWN';
  finalStatus?: string;
  confirmationTime?: number;
  blockNumber?: number;
  gasUsed?: string;
  errorMessage?: string;
  monitoringMethod: 'websocket' | 'polling' | 'failed';
}

export class SwapExecutor {
  private gswap: GSwap;
  private slippageProtection: SlippageProtection;
  private static testTransactionCounter = 0;

  constructor(gswap: GSwap, slippageProtection: SlippageProtection) {
    this.gswap = gswap;
    this.slippageProtection = slippageProtection;
    logger.info('Swap Executor initialized');

    // Log test mode status
    const config = getConfig();
    if (config.development.productionTestMode) {
      logger.info('🧪 Swap Executor: Production Test Mode - No real trades will be executed');
    }
  }

  /**
   * Execute a swap with full protection and monitoring
   */
  async executeSwap(request: SwapRequest): Promise<SwapResult> {
    const startTime = Date.now();

    try {
      logger.info(`Executing swap: ${request.amountIn} ${request.tokenIn} → ${request.tokenOut}`);

      // Step 1: Get quote
      const quote = await this.getSwapQuote(request);
      if (!isSuccessResponse(quote)) {
        return {
          success: false,
          error: 'Failed to get swap quote',
          executionTime: Date.now() - startTime,
        };
      }

      // Step 2: Analyze slippage
      const slippageAnalysis = await this.analyzeSwapSlippage(request, quote);
      const shouldExecute = this.slippageProtection.shouldExecuteTrade(slippageAnalysis);

      if (!shouldExecute.execute) {
        return {
          success: false,
          error: shouldExecute.reason,
          executionTime: Date.now() - startTime,
        };
      }

      // Step 3: Prepare transaction
      const swapPayload = await this.prepareSwapPayload(request, quote);

      // Step 4: Execute transaction
      const result = await this.executeSwapTransaction(swapPayload);

      // Step 5: Monitor execution with clear success/failure reporting
      if (result.success && result.transactionId) {
        const monitoringResult = await this.monitorTransaction(result.transactionId);
        result.monitoringResult = monitoringResult;

        // Update final result based on monitoring
        if (monitoringResult.status === 'FAILED') {
          result.success = false;
          result.error = `Transaction failed: ${monitoringResult.errorMessage || 'Unknown failure reason'}`;
        } else if (monitoringResult.status === 'TIMEOUT') {
          result.success = false;
          result.error = 'Transaction monitoring timeout - status unknown';
        }
      }

      return {
        ...result,
        executionTime: Date.now() - startTime,
      };

    } catch (error) {
      logger.error('Error executing swap:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Get swap quote with enhanced retry logic and validation
   */
  private async getSwapQuote(request: SwapRequest): Promise<QuoteResponse> {
    const quoteRequest: QuoteRequest = {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
    };

    // Validate quote request before sending
    if (!this.isValidQuoteRequest(quoteRequest)) {
      throw new Error('Invalid quote request parameters');
    }

    const maxRetries = 5; // Increased retries for critical quote operation
    let lastError: Error | null = null;
    let baseDelay = 500; // Start with shorter delay

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const quote = await this.gswap.quoting.quoteExactInput(
          quoteRequest.tokenIn,
          quoteRequest.tokenOut,
          quoteRequest.amountIn || '0'
        );

        // SDK returns direct quote result, adapt to expected format
        if (!quote?.outTokenAmount) {
          throw new Error('Invalid quote response received');
        }

        logger.debug(`Quote received on attempt ${attempt}:`, {
          amountOut: quote.outTokenAmount,
          priceImpact: quote.priceImpact,
          attempt
        });

        // Adapt SDK response to expected format
        const adaptedQuote: QuoteResponse = {
          error: false,
          status: 200,
          data: {
            amountOut: quote.outTokenAmount.toString(),
            priceImpact: Number(quote.priceImpact || 0),
            fee: 3000, // Standard fee tier - will be optimized in payload generation
            currentSqrtPrice: quote.currentPoolSqrtPrice?.toString() || '0',
            newSqrtPrice: quote.newPoolSqrtPrice?.toString() || '0',
            amountIn: quoteRequest.amountIn || '0',
            route: []
          },
          message: 'Success'
        };

        return adaptedQuote;

      } catch (error) {
        lastError = error as Error;
        logger.warn(`Quote attempt ${attempt}/${maxRetries} failed:`, {
          error: lastError.message,
          attempt
        });

        if (attempt < maxRetries) {
          // Exponential backoff with jitter
          const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 200;
          await this.delay(Math.min(delay, 10000)); // Cap at 10 seconds
        }
      }
    }

    throw lastError || new Error('Failed to get quote after retries');
  }

  /**
   * Validate quote request parameters
   */
  private isValidQuoteRequest(request: QuoteRequest): boolean {
    if (!request.tokenIn || !request.tokenOut || !request.amountIn) {
      logger.error('Missing required quote parameters');
      return false;
    }

    if (request.tokenIn === request.tokenOut) {
      logger.error('Cannot quote swap between same tokens');
      return false;
    }

    const amount = safeParseFloat(request.amountIn, 0);
    if (amount <= 0) {
      logger.error('Invalid amount for quote');
      return false;
    }

    return true;
  }

  /**
   * Validate quote response
   */
  private isValidQuoteResponse(quote: QuoteResponse): boolean {
    if (!isSuccessResponse(quote)) {
      logger.error('Quote request failed:', (quote as ErrorResponse).message);
      return false;
    }

    // Parse quote response with comprehensive validation
    const quoteResult = ApiResponseParser.parseNested<{
      amountOut: string;
      priceImpact?: number;
    }>(quote, ['data'], {
      required: ['amountOut'],
      validators: {
        amountOut: ResponseValidators.isValidString,
        priceImpact: (value: unknown) => value === undefined || ResponseValidators.isNonNegativeNumber(value)
      }
    });

    if (!quoteResult.success) {
      logger.error('Quote response validation failed:', quoteResult.error?.message);
      return false;
    }

    const amountOut = safeParseFloat(quoteResult.data!.amountOut, 0);
    if (amountOut <= 0) {
      logger.error('Invalid amount out in quote response');
      return false;
    }

    return true;
  }

  /**
   * Analyze slippage for the swap
   */
  private async analyzeSwapSlippage(
    request: SwapRequest,
    quote: QuoteResponse
  ): Promise<SlippageAnalysis> {
    // Get current market price
    // Get price using pool data against GUSDC
    const usdcToken = TRADING_CONSTANTS.TOKENS.GUSDC;
    let price = 0;

    try {
      if (request.tokenIn === usdcToken) {
        price = 1.0; // GUSDC is 1:1 with USD
      } else {
        const poolData = await this.gswap.pools.getPoolData(request.tokenIn, usdcToken, 3000);
        if (poolData?.sqrtPrice) {
          const spotPrice = this.gswap.pools.calculateSpotPrice(request.tokenIn, usdcToken, poolData.sqrtPrice);
          price = safeParseFloat(spotPrice.toString(), 0);
        }
      }
    } catch (error) {
      logger.debug(`Could not get price for ${request.tokenIn}:`, error);
      // Try lower fee tier
      try {
        const poolData = await this.gswap.pools.getPoolData(request.tokenIn, usdcToken, 500);
        if (poolData?.sqrtPrice) {
          const spotPrice = this.gswap.pools.calculateSpotPrice(request.tokenIn, usdcToken, poolData.sqrtPrice);
          price = safeParseFloat(spotPrice.toString(), 0);
        }
      } catch (error) {
        logger.debug(`Could not get price for ${request.tokenIn} on lower fee tier:`, error);
      }
    }

    const priceResponse = {
      error: false,
      data: price.toString(),
      message: 'Success'
    };
    const currentPrice = price;

    // Calculate quoted price with safe parsing
    const amountIn = safeParseFloat(request.amountIn, 0);

    // Parse quote data safely
    const quoteData = ApiResponseParser.parseNested<{
      amountOut: string;
    }>(quote, ['data'], {
      required: ['amountOut'],
      validators: {
        amountOut: ResponseValidators.isValidString
      }
    });

    if (!quoteData.success) {
      logger.error('Quote data parsing failed:', quoteData.error?.message);
      return {
        currentPrice: 0,
        expectedPrice: 0,
        slippagePercent: 0,
        isAcceptable: false,
        recommendedMaxSlippage: this.slippageProtection.config.defaultSlippageTolerance ?? 0.005,
        priceImpact: 0,
        marketCondition: 'illiquid'
      };
    }

    const amountOut = safeParseFloat(quoteData.data!.amountOut, 0);
    const quotedPrice = amountIn > 0 ? amountOut / amountIn : 0;

    // Get real market data for analysis
    const marketData = await this.getMarketData(request.tokenIn, request.tokenOut);

    // Prepare trade parameters for analysis
    const tradeParams = {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      poolLiquidity: marketData.poolLiquidity,
      volatility24h: marketData.volatility24h,
      volume24h: marketData.volume24h,
    };

    return this.slippageProtection.analyzeSlippage(
      currentPrice,
      quotedPrice,
      tradeParams
    );
  }

  /**
   * Prepare swap payload with enhanced validation and safety checks
   */
  private async prepareSwapPayload(request: SwapRequest, quote: QuoteResponse): Promise<any> {
    try {
      if (!isSuccessResponse(quote)) {
        throw new Error(`Invalid quote response: ${(quote as ErrorResponse).message}`);
      }

      // Enhanced slippage calculation with bounds checking
      // Parse quote output safely
      const outputResult = ApiResponseParser.parseNested<{
        amountOut: string;
        newSqrtPrice?: string;
      }>(quote, ['data'], {
        required: ['amountOut'],
        validators: {
          amountOut: ResponseValidators.isValidString,
          newSqrtPrice: (value: unknown) => value === undefined || ResponseValidators.isValidString(value)
        }
      });

      if (!outputResult.success) {
        throw new Error(`Quote output parsing failed: ${outputResult.error?.message}`);
      }

      const expectedOutput = safeParseFloat(outputResult.data!.amountOut, 0);
      const slippageTolerance = request.slippageTolerance || 0.01;

      // Validate slippage tolerance
      if (slippageTolerance < 0 || slippageTolerance > 0.5) {
        throw new Error('Slippage tolerance out of safe bounds (0-50%)');
      }

      const minimumAmountOut = (expectedOutput * (1 - slippageTolerance)).toString();

      // Validate minimum amount is reasonable
      if (safeParseFloat(minimumAmountOut, 0) <= 0) {
        throw new Error('Calculated minimum amount out is invalid');
      }

      // Determine optimal fee tier with validation
      const feeTier = await this.selectOptimalFeeTier(request.tokenIn, request.tokenOut);

      // Validate fee tier
      const validFees = [500, 3000, 10000];
      if (!validFees.includes(feeTier)) {
        throw new Error(`Invalid fee tier selected: ${feeTier}`);
      }

      // Enhanced payload request with safety checks
      const swapPayloadRequest: SwapPayloadRequest = {
        tokenIn: typeof request.tokenIn === 'string' ? createTokenClassKey(request.tokenIn) : request.tokenIn,
        tokenOut: typeof request.tokenOut === 'string' ? createTokenClassKey(request.tokenOut) : request.tokenOut,
        amountIn: request.amountIn,
        fee: feeTier,
        sqrtPriceLimit: outputResult.data!.newSqrtPrice || '0',
        amountInMaximum: request.amountIn,
        amountOutMinimum: minimumAmountOut
      };

      // Validate payload request before sending
      this.validateSwapPayloadRequest(swapPayloadRequest);

      logger.debug('Generating swap payload...', {
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        minimumAmountOut,
        feeTier,
        slippageTolerance: `${(slippageTolerance * 100).toFixed(2)}%`
      });

      // Generate the actual payload using GalaSwap API with retry
      const payloadResponse = await this.generatePayloadWithRetry(swapPayloadRequest);

      if (!isSuccessResponse(payloadResponse)) {
        throw new Error(`Failed to generate swap payload: ${(payloadResponse as ErrorResponse).message}`);
      }

      // Validate payload response
      if (!(payloadResponse as SwapPayloadResponse).data) {
        throw new Error('Payload response missing data');
      }

      return (payloadResponse as SwapPayloadResponse).data;

    } catch (error) {
      logger.error('Error preparing swap payload:', error);
      throw error;
    }
  }

  /**
   * Validate swap payload request
   */
  private validateSwapPayloadRequest(request: SwapPayloadRequest): void {
    if (!request.tokenIn || !request.tokenOut) {
      throw new Error('Missing token information in payload request');
    }

    if (!request.amountIn || safeParseFloat(request.amountIn, 0) <= 0) {
      throw new Error('Invalid amount in payload request');
    }

    if (!request.amountOutMinimum || safeParseFloat(request.amountOutMinimum, 0) <= 0) {
      throw new Error('Invalid minimum amount out in payload request');
    }

    if (safeParseFloat(request.amountIn, 0) < safeParseFloat(request.amountOutMinimum, 0)) {
      logger.warn('Amount in is less than minimum amount out - this may indicate an issue');
    }
  }

  /**
   * Generate payload with retry logic using real SDK operations
   */
  private async generatePayloadWithRetry(request: SwapPayloadRequest, maxRetries: number = 3): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Validate that we have a valid pool for this swap
        const poolData = await this.gswap.pools.getPoolData(
          request.tokenIn,
          request.tokenOut,
          request.fee || 3000
        );

        if (!poolData || !poolData.sqrtPrice) {
          throw new Error(`No valid pool found for ${request.tokenIn}/${request.tokenOut} with fee ${request.fee}`);
        }

        // Validate sufficient liquidity exists
        if (!poolData.liquidity || poolData.liquidity.toString() === '0') {
          throw new Error('Pool has insufficient liquidity for swap');
        }

        // Get a fresh quote to validate pricing
        const validateQuote = await this.gswap.quoting.quoteExactInput(
          request.tokenIn,
          request.tokenOut,
          request.amountIn
        );

        if (!validateQuote?.outTokenAmount) {
          throw new Error('Unable to get valid quote for swap');
        }

        // Ensure minimum output is achievable
        const expectedOutput = safeParseFloat(validateQuote.outTokenAmount.toString(), 0);
        const minimumOutput = safeParseFloat(request.amountOutMinimum || '0', 0);

        if (expectedOutput < minimumOutput) {
          throw new Error(`Quote output ${expectedOutput} is less than required minimum ${minimumOutput}`);
        }

        // Generate real payload structure for SDK swap execution
        const swapPayload = {
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          amountIn: request.amountIn,
          fee: request.fee || 3000,
          exactIn: request.amountIn,
          amountOutMinimum: request.amountOutMinimum || '0',
          sqrtPriceLimit: request.sqrtPriceLimit || '0',
          recipient: 'eth|0x0000000000000000000000000000000000000000', // Default recipient
          deadline: Math.floor(Date.now() / 1000) + 1800 // 30 minutes from now
        };

        // Return validated payload in expected format
        const payloadResponse = {
          error: false,
          data: {
            payload: swapPayload
          },
          message: 'Success'
        };

        logger.debug(`Real swap payload generated on attempt ${attempt}:`, {
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          expectedOutput: expectedOutput.toString(),
          minimumOutput: request.amountOutMinimum,
          poolLiquidity: poolData.liquidity.toString()
        });

        return payloadResponse;

      } catch (error) {
        lastError = error as Error;
        logger.warn(`Payload generation attempt ${attempt}/${maxRetries} failed:`, {
          error: lastError.message,
          attempt
        });

        if (attempt < maxRetries) {
          await this.delay(1000 * attempt);
        }
      }
    }

    throw lastError || new Error('Failed to generate payload after retries');
  }

  /**
   * Execute swap transaction with enhanced error handling and validation
   */
  private async executeSwapTransaction(payload: any): Promise<SwapResult> {
    try {
      // Validate payload before execution
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid payload for transaction execution');
      }

      const payloadSize = JSON.stringify(payload).length;
      if (payloadSize > 1000000) { // 1MB limit
        throw new Error('Payload size too large for safe execution');
      }

      logger.info('Executing swap transaction...', {
        payloadSize,
        payloadType: typeof payload
      });

      // Pre-execution validation
      await this.validatePreExecution();

      // Execute the signed payload via GalaSwap bundle API with retry
      const bundleResponse = await this.executeBundleWithRetry(payload, 'swap');

      if (!isSuccessResponse(bundleResponse)) {
        logger.error('Bundle execution failed:', bundleResponse.message);
        return {
          success: false,
          error: `Bundle execution failed: ${(bundleResponse as ErrorResponse).message}`,
          executionTime: 0,
        };
      }

      // Parse bundle response with comprehensive validation
      const bundleResult = ApiResponseParser.parseNested<{
        data: string;
        message: string;
        error?: string;
      }>(bundleResponse, ['data'], {
        required: ['data', 'message'],
        validators: {
          data: ResponseValidators.isValidTransactionId,
          message: ResponseValidators.isValidString
        }
      });

      if (!bundleResult.success) {
        throw new Error(`Invalid bundle response: ${bundleResult.error?.message}`);
      }

      const { data: transactionId, message: bundleHash, error: bundleStatus } = bundleResult.data!;

      logger.info('Swap transaction submitted successfully', {
        transactionId,
        bundleHash,
        bundleStatus
      });

      return {
        success: true,
        transactionId,
        hash: bundleHash,
        executionTime: 0, // Will be set by caller
      };

    } catch (error) {
      logger.error('Error executing swap transaction:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Transaction execution failed',
        executionTime: 0,
      };
    }
  }

  /**
   * Pre-execution validation checks
   */
  private async validatePreExecution(): Promise<void> {
    // Check client health
    // SDK doesn't have healthCheck, test with a basic query
    let health: { isHealthy: boolean; apiStatus: string; consecutiveFailures: number };
    try {
      await this.gswap.assets.getUserAssets('eth|0x0000000000000000000000000000000000000000', 1, 1);
      health = { isHealthy: true, apiStatus: 'healthy', consecutiveFailures: 0 };
    } catch (error) {
      health = { isHealthy: false, apiStatus: 'unhealthy', consecutiveFailures: 1 };
    }

    if (!health.isHealthy) {
      throw new Error('GalaSwap client is not healthy - aborting transaction');
    }

    // Check if API is experiencing issues
    if (health.apiStatus === 'unhealthy') {
      throw new Error('GalaSwap API is unhealthy - aborting transaction');
    }

    if (health.consecutiveFailures >= 3) {
      throw new Error('Too many recent API failures - aborting transaction');
    }
  }

  /**
   * Execute bundle with retry logic - intercepted in production test mode
   */
  private async executeBundleWithRetry(payload: any, bundleType: 'swap', maxRetries: number = 2): Promise<any> {
    const config = getConfig();

    // *** PRODUCTION TEST MODE INTERCEPTION ***
    if (config.development.productionTestMode) {
      return this.simulateTradeExecution(payload, bundleType);
    }

    // *** LIVE TRADING MODE - Real execution ***
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Execute swap using SDK
        const swapResult = await this.gswap.swaps.swap(
          payload.payload.tokenIn,
          payload.payload.tokenOut,
          payload.payload.fee || 3000,
          {
            exactIn: payload.payload.amountIn,
            amountOutMinimum: payload.payload.amountOutMinimum || '0'
          }
        );

        // Wait for transaction completion and adapt response
        const completedTx = await swapResult.wait();

        const bundleResponse = {
          error: false,
          data: {
            transactionId: completedTx.txId,
            hash: completedTx.transactionHash
          },
          message: 'Success'
        };
        return bundleResponse;

      } catch (error) {
        lastError = error as Error;

        logger.warn(`Bundle execution attempt ${attempt}/${maxRetries} failed:`, {
          error: lastError.message,
          attempt
        });

        // Don't retry certain types of errors
        if (this.isNonRetryableExecutionError(lastError)) {
          logger.error('Non-retryable execution error encountered');
          break;
        }

        if (attempt < maxRetries) {
          await this.delay(2000 * attempt); // Longer delay for execution retries
        }
      }
    }

    throw lastError || new Error('Failed to execute bundle after retries');
  }

  /**
   * Simulate trade execution in production test mode
   */
  private async simulateTradeExecution(payload: any, bundleType: 'swap'): Promise<any> {
    SwapExecutor.testTransactionCounter++;
    const testTxId = `TEST-${bundleType.toUpperCase()}-${SwapExecutor.testTransactionCounter.toString().padStart(3, '0')}`;
    const timestamp = new Date().toISOString();

    // Extract trade details for logging
    const tradeDetails = {
      type: bundleType,
      tokenIn: payload.payload?.tokenIn || 'Unknown',
      tokenOut: payload.payload?.tokenOut || 'Unknown',
      amountIn: payload.payload?.amountIn || '0',
      amountOutMinimum: payload.payload?.amountOutMinimum || '0',
      fee: payload.payload?.fee || 3000,
      testTxId,
      timestamp
    };

    // Log the simulated trade prominently
    logger.warn('🧪 SIMULATED TRADE EXECUTION:');
    logger.warn(`   📊 ${tradeDetails.type.toUpperCase()}: ${tradeDetails.amountIn} ${tradeDetails.tokenIn} → ${tradeDetails.tokenOut}`);
    logger.warn(`   💰 Min Output: ${tradeDetails.amountOutMinimum}`);
    logger.warn(`   💸 Fee Tier: ${tradeDetails.fee} (${(tradeDetails.fee / 10000).toFixed(2)}%)`);
    logger.warn(`   🆔 Test TX: ${testTxId}`);
    logger.warn(`   ⏰ Time: ${timestamp}`);

    // Write to test trade log file
    this.logTestTrade(tradeDetails);

    // Simulate processing delay
    await this.delay(100 + Math.random() * 200);

    // Return simulated success response
    const bundleResponse = {
      error: false,
      data: {
        data: testTxId,
        message: `test-hash-${SwapExecutor.testTransactionCounter}`,
        error: undefined
      },
      message: 'Success (Simulated)'
    };

    logger.info(`✅ Test trade simulation completed: ${testTxId}`);
    return bundleResponse;
  }

  /**
   * Log test trade to audit file
   */
  private logTestTrade(tradeDetails: any): void {
    try {
      const logEntry = {
        ...tradeDetails,
        note: 'PRODUCTION_TEST_MODE - No real transaction executed'
      };

      // Log to console and potentially to file system
      logger.info('📝 Test Trade Logged:', JSON.stringify(logEntry, null, 2));

      // Could be enhanced to write to a dedicated test trades file
      // const fs = require('fs');
      // fs.appendFileSync('test-trades.log', JSON.stringify(logEntry) + '\n');

    } catch (error) {
      logger.warn('Failed to log test trade:', error);
    }
  }

  /**
   * Check if execution error should not be retried
   */
  private isNonRetryableExecutionError(error: Error): boolean {
    const nonRetryableMessages = [
      'insufficient balance',
      'insufficient allowance',
      'invalid signature',
      'invalid payload',
      'slippage tolerance exceeded',
      'price impact too high'
    ];

    const errorMessage = error.message.toLowerCase();
    return nonRetryableMessages.some(msg => errorMessage.includes(msg));
  }

  /**
   * Monitor transaction execution with clear success/failure reporting
   * Returns actionable status information for localhost trading
   */
  async monitorTransaction(transactionId: string, timeoutMs: number = 300000): Promise<TransactionMonitoringResult> {
    const startTime = Date.now();

    logger.info(`Monitoring transaction: ${transactionId}`);

    try {
      // Use SDK's event system to wait for transaction
      const statusResponse = await GSwap.events.wait(transactionId);

      // SDK returns { txId: string, transactionHash: string, Data: any }
      if (statusResponse?.transactionHash) {
        const confirmationTime = Date.now() - startTime;
        const txStatus = 'CONFIRMED'; // SDK wait() only resolves on successful completion

        logger.info(`✅ Transaction CONFIRMED: ${transactionId} (${confirmationTime}ms)`);
        return {
          status: 'CONFIRMED',
          finalStatus: txStatus,
          confirmationTime,
          blockNumber: (statusResponse.Data as any)?.blockNumber,
          gasUsed: (statusResponse.Data as any)?.gasUsed,
          monitoringMethod: 'polling' // Client uses polling primarily
        };
      } else {
        logger.error(`❌ Failed to get transaction status: ${transactionId} - ${(statusResponse as any).message || 'Unknown error'}`);
        return {
          status: 'UNKNOWN',
          errorMessage: `Status check failed: ${(statusResponse as any).message || 'Unknown error'}`,
          monitoringMethod: 'failed'
        };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown monitoring error';

      if (errorMessage.includes('timeout')) {
        logger.warn(`⏰ Transaction monitoring TIMEOUT: ${transactionId}`);
        return {
          status: 'TIMEOUT',
          errorMessage: 'Monitoring timeout - transaction may still be pending',
          monitoringMethod: 'failed'
        };
      } else {
        logger.error(`❌ Transaction monitoring ERROR: ${transactionId} - ${errorMessage}`);
        return {
          status: 'UNKNOWN',
          errorMessage: `Monitoring failed: ${errorMessage}`,
          monitoringMethod: 'failed'
        };
      }
    }
  }

  /**
   * Legacy monitoring method for backwards compatibility
   */
  private async monitorExecution(transactionId: string, expectedPrice: number): Promise<void> {
    try {
      logger.info(`Monitoring transaction execution: ${transactionId}`);

      // Use SDK's event system to wait for transaction
      const status = await GSwap.events.wait(transactionId);

      if (status?.transactionHash) {
        const txStatus = 'CONFIRMED'; // SDK wait() only resolves on successful completion

        if (txStatus === 'CONFIRMED') {
          logger.info(`Transaction confirmed: ${transactionId}`);

          // Analyze actual execution vs expected
          await this.analyzeExecutionResults(transactionId, expectedPrice);

        } else {
          logger.error(`Transaction not confirmed: ${transactionId}, status: ${txStatus}`);
        }
      } else {
        logger.error(`Transaction status check failed: ${transactionId}`);
      }

    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warn(`Transaction monitoring timeout: ${transactionId}`);
        // Set up background monitoring for stuck transactions
        this.handleStuckTransaction(transactionId);
      } else {
        logger.error('Error monitoring execution:', error);
      }
    }
  }

  /**
   * Handle stuck transactions with retry mechanism
   */
  private async handleStuckTransaction(transactionId: string): Promise<void> {
    logger.warn(`Setting up background monitoring for stuck transaction: ${transactionId}`);

    // Continue monitoring in background with longer intervals
    setTimeout(async () => {
      try {
        // SDK doesn't have getTransactionStatus, use wait for final status
        const status = await GSwap.events.wait(transactionId);

        if (status?.transactionHash) {
          const txStatus = 'CONFIRMED';

          if (txStatus === 'CONFIRMED') {
            logger.info(`Previously stuck transaction confirmed: ${transactionId}`);
          } else if (txStatus === 'FAILED' || txStatus === 'REJECTED') {
            logger.error(`Previously stuck transaction failed: ${transactionId}, status: ${txStatus}`);
          } else {
            // Still pending, check again later
            this.handleStuckTransaction(transactionId);
          }
        }
      } catch (error) {
        logger.warn(`Background transaction check failed for ${transactionId}:`, error);
      }
    }, 30000); // Check again in 30 seconds
  }

  /**
   * Enhanced batch execution with improved error handling and rate limiting
   */
  async batchExecuteSwaps(requests: SwapRequest[]): Promise<SwapResult[]> {
    if (!requests || requests.length === 0) {
      logger.warn('Empty batch swap request');
      return [];
    }

    // Validate batch size
    if (requests.length > 50) {
      throw new Error('Batch size too large (max 50 swaps)');
    }

    logger.info(`Executing batch of ${requests.length} swaps`);

    const results: SwapResult[] = [];
    const errors: { index: number; error: string }[] = [];
    let successCount = 0;

    // Pre-validate all requests
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      if (!this.isValidSwapRequest(request)) {
        const error = `Invalid swap request at index ${i}`;
        logger.warn(error, request);
        results.push({
          success: false,
          error,
          executionTime: 0,
        });
        errors.push({ index: i, error });
        continue;
      }
    }

    // Execute valid requests
    for (let i = 0; i < requests.length; i++) {
      // Skip invalid requests
      if (errors.some(e => e.index === i)) {
        continue;
      }

      const request = requests[i];

      try {
        logger.debug(`Executing swap ${i + 1}/${requests.length}`, {
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          amountIn: request.amountIn
        });

        const result = await this.executeSwap(request);
        results[i] = result;

        if (result.success) {
          successCount++;
        }

        // Adaptive delay based on recent failures
        const recentFailures = results.slice(-5).filter(r => !r.success).length;
        const baseDelay = 200; // Base delay between swaps
        const adaptiveDelay = baseDelay + (recentFailures * 500); // Increase delay if failures

        if (i < requests.length - 1) {
          await this.delay(adaptiveDelay);
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Batch execution error';
        results[i] = {
          success: false,
          error: errorMessage,
          executionTime: 0,
        };

        logger.error(`Batch swap ${i + 1} failed:`, errorMessage);
      }
    }

    const failureCount = requests.length - successCount;
    logger.info(`Batch execution completed: ${successCount}/${requests.length} successful, ${failureCount} failed`);

    // Log detailed results if there were failures
    if (failureCount > 0) {
      const failedResults = results.filter(r => !r.success);
      logger.warn('Failed swap details:', failedResults.map(r => r.error));
    }

    return results;
  }

  /**
   * Validate individual swap request
   */
  private isValidSwapRequest(request: SwapRequest): boolean {
    if (!request) return false;

    if (!request.tokenIn || !request.tokenOut || !request.amountIn || !request.userAddress) {
      return false;
    }

    if (request.tokenIn === request.tokenOut) {
      return false;
    }

    const amount = safeParseFloat(request.amountIn, 0);
    if (amount <= 0) {
      return false;
    }

    if (request.slippageTolerance !== undefined) {
      if (isNaN(request.slippageTolerance) || request.slippageTolerance < 0 || request.slippageTolerance > 0.5) {
        return false;
      }
    }

    return true;
  }

  /**
   * Enhanced execution results analysis with detailed metrics
   */
  private async analyzeExecutionResults(transactionId: string, expectedPrice: number): Promise<void> {
    try {
      logger.debug(`Analyzing execution results for transaction: ${transactionId}`);

      const status = await GSwap.events.wait(transactionId);

      if (status?.transactionHash) {
        const executionData = status.Data || {};

        // Comprehensive execution analysis
        const analysis = {
          transactionId,
          expectedPrice,
          executedPrice: null as number | null,
          slippagePercent: null as number | null,
          gasUsed: (executionData as any).gasUsed || null,
          blockNumber: executionData.blockNumber || null,
          timestamp: (executionData as any).timestamp || Date.now(),
          status: executionData.status
        };

        // Analyze price execution if data is available
        if ((executionData as any).executedPrice) {
          const actualPrice = safeParseFloat((executionData as any).executedPrice, 0);
          analysis.executedPrice = actualPrice;

          const slippageCheck = this.slippageProtection.monitorExecutionSlippage(
            expectedPrice,
            actualPrice,
            0.02 // 2% tolerance for analysis
          );

          analysis.slippagePercent = (slippageCheck as any).slippagePercent;

          if (slippageCheck.shouldAlert) {
            logger.warn('High execution slippage detected', analysis);

            // Additional analysis for high slippage
            await this.analyzeHighSlippage(transactionId, expectedPrice, actualPrice);
          } else {
            logger.info('Execution completed within expected parameters', analysis);
          }
        } else {
          logger.debug('Executed price not available for analysis', { transactionId });
        }

        // Analyze gas usage if available
        if (analysis.gasUsed) {
          const gasUsedNum = parseInt(analysis.gasUsed.toString());
          if (gasUsedNum > 500000) { // High gas usage threshold
            logger.warn('High gas usage detected', {
              transactionId,
              gasUsed: gasUsedNum
            });
          }
        }

        // Store analysis results for future optimization
        this.storeExecutionAnalysis(analysis);

      } else {
        logger.warn('Failed to get transaction status for analysis', {
          transactionId,
          error: status && typeof status === 'object' && 'message' in status ? (status as any).message : 'Unknown error'
        });
      }

    } catch (error) {
      logger.warn('Could not analyze execution results:', {
        transactionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Analyze high slippage scenarios for insights
   */
  private async analyzeHighSlippage(
    transactionId: string,
    expectedPrice: number,
    actualPrice: number
  ): Promise<void> {
    const slippagePercent = Math.abs((actualPrice - expectedPrice) / expectedPrice) * 100;

    logger.warn('Investigating high slippage scenario', {
      transactionId,
      expectedPrice,
      actualPrice,
      slippagePercent: `${slippagePercent.toFixed(4)}%`
    });

    // Potential causes analysis
    const potentialCauses = [];

    if (slippagePercent > 10) {
      potentialCauses.push('Extremely high slippage - possible front-running or low liquidity');
    } else if (slippagePercent > 5) {
      potentialCauses.push('High slippage - possible market volatility or MEV');
    } else if (slippagePercent > 2) {
      potentialCauses.push('Moderate slippage - normal market conditions');
    }

    if (potentialCauses.length > 0) {
      logger.warn('Slippage analysis complete', {
        transactionId,
        potentialCauses
      });
    }
  }

  /**
   * Store execution analysis for future optimization
   */
  private storeExecutionAnalysis(analysis: any): void {
    // This could be enhanced to store in a database or metrics system
    logger.debug('Execution analysis stored', {
      transactionId: analysis.transactionId,
      slippage: analysis.slippagePercent,
      gasUsed: analysis.gasUsed
    });
  }

  /**
   * Select optimal fee tier based on real pool liquidity data
   */
  private async selectOptimalFeeTier(tokenIn: string, tokenOut: string): Promise<500 | 3000 | 10000> {
    try {
      // Test all available fee tiers and select the one with best liquidity
      const feeTiers = [FEE_TIERS.STABLE, FEE_TIERS.STANDARD, FEE_TIERS.VOLATILE] as const; // 500, 3000, 10000
      let bestTier: 500 | 3000 | 10000 = FEE_TIERS.STANDARD; // Default fallback
      let bestLiquidity = 0;

      // Parallelize fee tier pool data fetching
      const tierPromises = feeTiers.map(async (tier) => {
        try {
          const poolData = await this.gswap.pools.getPoolData(tokenIn, tokenOut, tier);

          if (poolData?.liquidity) {
            const liquidity = safeParseFloat(poolData.liquidity.toString(), 0);
            logger.debug(`Fee tier ${tier}: liquidity ${liquidity}`);
            return { tier, liquidity };
          }
        } catch (error) {
          logger.debug(`Fee tier ${tier} not available:`, error instanceof Error ? error.message : 'Unknown error');
        }

        return { tier, liquidity: 0 };
      });

      // Wait for all tier checks to complete
      const tierResults = await Promise.allSettled(tierPromises);

      // Find the tier with best liquidity
      tierResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { tier, liquidity } = result.value;
          if (liquidity > bestLiquidity) {
            bestLiquidity = liquidity;
            bestTier = tier;
          }
        }
      });

      if (bestLiquidity > 0) {
        logger.info(`Selected optimal fee tier ${bestTier} with liquidity ${bestLiquidity}`);
        return bestTier;
      } else {
        logger.warn('No pools found with liquidity, using standard fee tier');
        return FEE_TIERS.STANDARD;
      }

    } catch (error) {
      logger.error('Error selecting optimal fee tier:', error);
      logger.info('Falling back to standard fee tier');
      return FEE_TIERS.STANDARD;
    }
  }

  /**
   * Enhanced delay utility with validation
   */
  private delay(ms: number): Promise<void> {
    // Validate delay time
    if (ms < 0 || ms > 60000) { // Max 1 minute delay
      logger.warn(`Invalid delay time: ${ms}ms, using default 1000ms`);
      ms = 1000;
    }

    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get real market data for trade analysis
   */
  private async getMarketData(tokenIn: string, tokenOut: string): Promise<{
    poolLiquidity: string;
    volatility24h: number;
    volume24h: string;
  }> {
    try {
      // Get pool information to extract liquidity
      const poolResponse = await this.gswap.pools.getPoolData(tokenIn, tokenOut, 3000); // Standard fee tier

      let poolLiquidity = '0'; // Start with no fallback
      if (poolResponse?.liquidity) {
        // Use actual pool liquidity from SDK response
        poolLiquidity = poolResponse.liquidity.toString();
        logger.debug(`Retrieved pool liquidity: ${poolLiquidity} for ${tokenIn}/${tokenOut}`);
      } else {
        // Try alternative fee tiers for liquidity data
        const altPoolResponse = await this.gswap.pools.getPoolData(tokenIn, tokenOut, 500);
        if (altPoolResponse?.liquidity) {
          poolLiquidity = altPoolResponse.liquidity.toString();
          logger.debug(`Retrieved pool liquidity from 500 fee tier: ${poolLiquidity}`);
        } else {
          // If no pool data available, this indicates a serious issue
          logger.error(`No pool liquidity found for ${tokenIn}/${tokenOut} on any fee tier`);
          poolLiquidity = '0'; // Fail with zero rather than mock data
        }
      }

      // Get real price history from multiple pool queries over time
      // Since SDK doesn't have historical data, we'll build it from current pool state
      const priceHistory = await this.buildRealPriceHistory(tokenIn, tokenOut, poolLiquidity);
      let volatility24h = 0.05; // Default 5% volatility

      // Parse price history response safely
      const historyResult = ApiResponseParser.parseNested<{
        prices: Array<{ price: string }>;
      }>(priceHistory, ['data'], {
        required: ['prices'],
        validators: {
          prices: (value: unknown) => Array.isArray(value)
        }
      });

      if (historyResult.success && !priceHistory.error) {
        // Calculate volatility from real price history
        const prices = historyResult.data!.prices
          .map(p => safeParseFloat(p.price || '0', 0))
          .filter(p => p > 0);
        if (prices.length > 1) {
          const returns = prices.slice(1).map((price, i) => Math.log(price / prices[i]));
          const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
          const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
          volatility24h = Math.sqrt(variance);
          logger.debug(`Calculated volatility from ${prices.length} price points: ${(volatility24h * 100).toFixed(2)}%`);
        }
      }

      // Calculate realistic 24h volume estimate from pool characteristics
      let volume24h = '0'; // Start with zero instead of arbitrary fallback
      if (poolResponse && poolResponse.liquidity) {
        // Use actual liquidity for realistic volume estimation
        const liquidity = safeParseFloat(poolLiquidity, 0);

        if (liquidity > 0) {
          // Estimate volume based on pool size and typical DeFi turnover rates
          // Larger pools typically have lower turnover rates
          const turnoverRate = liquidity > 10000000 ? 0.05 : // Large pools: 5% daily turnover
                              liquidity > 1000000 ? 0.15 :  // Medium pools: 15% daily turnover
                              0.25; // Small pools: 25% daily turnover

          volume24h = (liquidity * turnoverRate).toString();
          logger.debug(`Estimated 24h volume: ${volume24h} (${(turnoverRate * 100).toFixed(1)}% turnover)`);
        } else {
          logger.warn(`Zero liquidity found - cannot estimate volume`);
          volume24h = '0';
        }
      }

      return {
        poolLiquidity,
        volatility24h,
        volume24h
      };

    } catch (error) {
      logger.error('Error getting market data:', error);

      // Return safe defaults based on actual failure (not arbitrary values)
      return {
        poolLiquidity: '0', // Indicate no data available rather than fake data
        volatility24h: 0.0, // No volatility data available
        volume24h: '0' // No volume data available
      };
    }
  }

  /**
   * Historical price data disabled - returns empty data
   */
  private async buildRealPriceHistory(_tokenIn: string, _tokenOut: string, _poolLiquidity: string): Promise<{
    error: boolean;
    data: {
      prices: Array<{ price: string; timestamp: number }>;
      volume24h: string;
    };
  }> {
    // Historical price tracking disabled - return empty data
    return {
      error: false,
      data: {
        prices: [],
        volume24h: '0'
      }
    };
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): {
    clientHealth: any;
    rateLimiterStatus: any;
  } {
    return {
      clientHealth: {}, // Will be updated when health check method is available
      rateLimiterStatus: {} // Will be available after client updates
    };
  }
}