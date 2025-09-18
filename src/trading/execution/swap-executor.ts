/**
 * Swap Executor
 * Handles end-to-end swap execution with error handling and monitoring
 */

import { GalaSwapClient } from '../../api/GalaSwapClient';
import { SlippageProtection, SlippageAnalysis } from '../risk/slippage';
import { logger } from '../../utils/logger';
import {
  QuoteRequest,
  QuoteResponse,
  SwapPayloadRequest,
  SwapPayloadResponse,
  BundleResponse,
  ErrorResponse,
  isSuccessResponse,
  createTokenClassKey,
  FEE_TIERS
} from '../../types/galaswap';

export interface SwapRequest {
  tokenIn: string;
  tokenOut: string;
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
  private galaSwapClient: GalaSwapClient;
  private slippageProtection: SlippageProtection;

  constructor(galaSwapClient: GalaSwapClient, slippageProtection: SlippageProtection) {
    this.galaSwapClient = galaSwapClient;
    this.slippageProtection = slippageProtection;
    logger.info('Swap Executor initialized');
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
        const quote = await this.galaSwapClient.getQuote(quoteRequest);

        // Validate quote response
        if (!this.isValidQuoteResponse(quote)) {
          throw new Error('Invalid quote response received');
        }

        logger.debug(`Quote received on attempt ${attempt}:`, {
          amountOut: quote.data.amountOut,
          priceImpact: quote.data.priceImpact,
          attempt
        });

        return quote;

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

    const amount = parseFloat(request.amountIn);
    if (isNaN(amount) || amount <= 0) {
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

    if (!quote.data || !quote.data.amountOut) {
      logger.error('Quote response missing required data');
      return false;
    }

    const amountOut = parseFloat(quote.data.amountOut);
    if (isNaN(amountOut) || amountOut <= 0) {
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
    const priceResponse = await this.galaSwapClient.getPrice(request.tokenIn);
    const currentPrice = parseFloat(priceResponse.data.price);

    // Calculate quoted price
    const amountIn = parseFloat(request.amountIn);
    const amountOut = parseFloat(quote.data.amountOut);
    const quotedPrice = amountOut / amountIn;

    // Prepare trade parameters for analysis
    const tradeParams = {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      poolLiquidity: '1000000', // TODO: Get actual pool liquidity
      volatility24h: 0.05, // TODO: Get actual volatility
      volume24h: '100000', // TODO: Get actual volume
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
      const expectedOutput = parseFloat(quote.data.amountOut);
      const slippageTolerance = request.slippageTolerance || 0.01;

      // Validate slippage tolerance
      if (slippageTolerance < 0 || slippageTolerance > 0.5) {
        throw new Error('Slippage tolerance out of safe bounds (0-50%)');
      }

      const minimumAmountOut = (expectedOutput * (1 - slippageTolerance)).toString();

      // Validate minimum amount is reasonable
      if (parseFloat(minimumAmountOut) <= 0) {
        throw new Error('Calculated minimum amount out is invalid');
      }

      // Determine optimal fee tier with validation
      const feeTier = this.selectOptimalFeeTier(request.tokenIn, request.tokenOut);

      // Validate fee tier
      const validFees = [500, 3000, 10000];
      if (!validFees.includes(feeTier)) {
        throw new Error(`Invalid fee tier selected: ${feeTier}`);
      }

      // Enhanced payload request with safety checks
      const swapPayloadRequest: SwapPayloadRequest = {
        tokenIn: createTokenClassKey(request.tokenIn),
        tokenOut: createTokenClassKey(request.tokenOut),
        amountIn: request.amountIn,
        fee: feeTier,
        sqrtPriceLimit: quote.data.newSqrtPrice || '0',
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

    if (!request.amountIn || parseFloat(request.amountIn) <= 0) {
      throw new Error('Invalid amount in payload request');
    }

    if (!request.amountOutMinimum || parseFloat(request.amountOutMinimum) <= 0) {
      throw new Error('Invalid minimum amount out in payload request');
    }

    if (parseFloat(request.amountIn) < parseFloat(request.amountOutMinimum)) {
      logger.warn('Amount in is less than minimum amount out - this may indicate an issue');
    }
  }

  /**
   * Generate payload with retry logic
   */
  private async generatePayloadWithRetry(request: SwapPayloadRequest, maxRetries: number = 3): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const payloadResponse = await this.galaSwapClient.generateSwapPayload(request);
        return payloadResponse;

      } catch (error) {
        lastError = error as Error;
        logger.warn(`Payload generation attempt ${attempt}/${maxRetries} failed:`, {
          error: lastError.message
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

      const transactionId = (bundleResponse as BundleResponse).data.data;

      // Validate transaction ID
      if (!transactionId || typeof transactionId !== 'string') {
        throw new Error('Invalid transaction ID received from bundle execution');
      }

      logger.info('Swap transaction submitted successfully', {
        transactionId,
        bundleHash: (bundleResponse as BundleResponse).data.message,
        bundleStatus: (bundleResponse as BundleResponse).data.error
      });

      return {
        success: true,
        transactionId,
        hash: (bundleResponse as BundleResponse).data.message,
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
    const health = await this.galaSwapClient.healthCheck();
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
   * Execute bundle with retry logic
   */
  private async executeBundleWithRetry(payload: any, bundleType: 'swap', maxRetries: number = 2): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const bundleResponse = await this.galaSwapClient.executeBundle(payload, bundleType);
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
      // Use the client's enhanced monitoring
      const statusResponse = await this.galaSwapClient.monitorTransaction(
        transactionId,
        timeoutMs,
        3000 // 3 second poll interval
      );

      if (isSuccessResponse(statusResponse)) {
        const txStatus = statusResponse.data.status;
        const confirmationTime = Date.now() - startTime;

        switch (txStatus) {
          case 'CONFIRMED':
            logger.info(`✅ Transaction CONFIRMED: ${transactionId} (${confirmationTime}ms)`);
            return {
              status: 'CONFIRMED',
              finalStatus: txStatus,
              confirmationTime,
              blockNumber: statusResponse.data.blockNumber,
              gasUsed: (statusResponse.data as any).gasUsed,
              monitoringMethod: 'polling' // Client uses polling primarily
            };

          case 'FAILED':
          case 'REJECTED':
            const errorMsg = (statusResponse.data as any).error || (statusResponse.data as any).errorMessage || `Transaction ${txStatus.toLowerCase()}`;
            logger.error(`❌ Transaction FAILED: ${transactionId} - ${errorMsg}`);
            return {
              status: 'FAILED',
              finalStatus: txStatus,
              confirmationTime,
              errorMessage: errorMsg,
              monitoringMethod: 'polling'
            };

          default:
            logger.warn(`⚠️ Transaction status unknown: ${transactionId} - ${txStatus}`);
            return {
              status: 'UNKNOWN',
              finalStatus: txStatus,
              confirmationTime,
              errorMessage: `Unexpected status: ${txStatus}`,
              monitoringMethod: 'polling'
            };
        }
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

      // Use the enhanced monitoring with WebSocket support
      const status = await this.galaSwapClient.monitorTransaction(
        transactionId,
        300000, // 5 minutes timeout
        3000    // 3 second poll interval
      );

      if (isSuccessResponse(status)) {
        const txStatus = status.data.status;

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
        const status = await this.galaSwapClient.getTransactionStatus(transactionId);

        if (isSuccessResponse(status)) {
          const txStatus = status.data.status;

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

    const amount = parseFloat(request.amountIn);
    if (isNaN(amount) || amount <= 0) {
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

      const status = await this.galaSwapClient.getTransactionStatus(transactionId);

      if (isSuccessResponse(status)) {
        const executionData = status.data;

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
          const actualPrice = parseFloat((executionData as any).executedPrice);
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
          error: (status as ErrorResponse).message
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
   * Select optimal fee tier with enhanced logic
   */
  private selectOptimalFeeTier(tokenIn: string, tokenOut: string): number {
    // Enhanced fee tier selection logic
    const stableTokens = ['GUSDC', 'USDT', 'DAI', 'USDC'];
    const majorTokens = ['GALA', 'ETH', 'BTC', 'WETH'];

    const tokenInUpper = tokenIn.toUpperCase();
    const tokenOutUpper = tokenOut.toUpperCase();

    // Check if both tokens are stablecoins
    const bothStable = stableTokens.some(stable => tokenInUpper.includes(stable)) &&
                      stableTokens.some(stable => tokenOutUpper.includes(stable));

    if (bothStable) {
      logger.debug('Using stable fee tier for stablecoin pair');
      return FEE_TIERS.STABLE; // 0.05%
    }

    // Check if at least one token is major
    const hasMajorToken = majorTokens.some(major => tokenInUpper.includes(major)) ||
                         majorTokens.some(major => tokenOutUpper.includes(major));

    if (hasMajorToken) {
      logger.debug('Using standard fee tier for major token pair');
      return FEE_TIERS.STANDARD; // 0.30%
    }

    // For exotic pairs, use higher fee tier
    logger.debug('Using volatile fee tier for exotic token pair');
    return FEE_TIERS.VOLATILE; // 1.00%
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
   * Get execution statistics
   */
  getExecutionStats(): {
    clientHealth: any;
    rateLimiterStatus: any;
  } {
    return {
      clientHealth: this.galaSwapClient.getConnectionHealth(),
      rateLimiterStatus: this.galaSwapClient.resetRateLimiters // This will be available after client updates
    };
  }
}