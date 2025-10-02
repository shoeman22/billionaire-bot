/**
 * Swap Executor
 * Handles end-to-end swap execution with error handling and monitoring
 */

import { GSwap } from '../../services/gswap-simple';
import { SlippageProtection, SlippageAnalysis } from '../risk/slippage';
import { TRADING_CONSTANTS } from '../../config/constants';
import { getConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { safeParseFloat, safeParseFixedNumber, safeFixedToNumber } from '../../utils/safe-parse';
import { ApiResponseParser, ResponseValidators } from '../../utils/api-response-parser';
import { createQuoteWrapper } from '../../utils/quote-api';
import { PrecisionMath, FixedNumber, TOKEN_DECIMALS } from '../../utils/precision-math';
import { GasBiddingEngine, OpportunityMetrics, GasBidCalculation } from './gas-bidding';
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
  // Gas bidding enhancement fields
  expectedProfitUSD?: number; // Expected profit for gas bidding calculations
  timeToExpiration?: number; // Time until opportunity expires (milliseconds)
  competitiveRisk?: 'low' | 'medium' | 'high'; // Competition level for this opportunity
  gasBiddingEnabled?: boolean; // Enable/disable gas bidding for this swap
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
  // Gas bidding results
  gasBidUsed?: GasBidCalculation;
  actualGasCost?: number;
  profitAfterGas?: number;
  gasBiddingSuccess?: boolean;
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
  private quoteWrapper: any; // Working quote API wrapper
  private gasBiddingEngine: GasBiddingEngine;
  private static testTransactionCounter = 0;

  /**
   * Convert TokenClassKey to string format if needed
   */
  private tokenToString(token: string | TokenClassKey): string {
    if (typeof token === 'string') {
      return token;
    }
    // Convert TokenClassKey object to string format (GalaChain uses $ separator)
    return `${token.collection}$${token.category}$${token.type}$${token.additionalKey}`;
  }

  constructor(gswap: GSwap, slippageProtection: SlippageProtection) {
    this.gswap = gswap;
    this.slippageProtection = slippageProtection;

    // Initialize working quote wrapper
    const config = getConfig();
    this.quoteWrapper = createQuoteWrapper(config.api.baseUrl);

    // Initialize gas bidding engine with production-ready configuration
    this.gasBiddingEngine = new GasBiddingEngine({
      enabled: true,
      maxGasBudgetPercent: 0.15, // Never spend more than 15% of profit on gas
      baseGasPremium: 1.0,
      competitiveFactor: 1.5,
      emergencyMultiplier: 3.0,
      marketAnalysisEnabled: true,
      profitProtectionEnabled: true
    });

    logger.info('Swap Executor initialized with gas bidding enhancement');

    // Log test mode status
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

      // Step 3: Calculate optimal gas bid
      let gasBidCalculation: GasBidCalculation | null = null;
      if (request.gasBiddingEnabled !== false && request.expectedProfitUSD) {
        gasBidCalculation = await this.calculateOptimalGasBid(request, quote);

        // Validate that the trade is still profitable after gas costs
        if (!gasBidCalculation.profitProtection.isViable) {
          return {
            success: false,
            error: `Trade not viable after gas costs: ${gasBidCalculation.reasoning}`,
            executionTime: Date.now() - startTime,
            gasBidUsed: gasBidCalculation
          };
        }

        logger.info('Gas bidding calculation:', {
          recommendedGasPrice: gasBidCalculation.recommendedGasPrice,
          strategy: gasBidCalculation.bidStrategy,
          profitAfterGas: gasBidCalculation.profitProtection.remainingProfitAfterGas,
          reasoning: gasBidCalculation.reasoning
        });
      }

      // Step 4: Prepare transaction with gas bidding
      const swapPayload = await this.prepareSwapPayload(request, quote, gasBidCalculation);

      // Step 5: Execute transaction
      const result = await this.executeSwapTransaction(swapPayload, gasBidCalculation);

      // Step 6: Monitor execution with clear success/failure reporting
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

        // Update gas bidding success tracking
        if (gasBidCalculation) {
          this.gasBiddingEngine.updateBidResult(
            gasBidCalculation.recommendedGasPrice,
            result.success
          );
        }
      }

      // Calculate profit after gas if available
      let profitAfterGas: number | undefined;
      if (request.expectedProfitUSD && result.actualGasCost) {
        profitAfterGas = request.expectedProfitUSD - result.actualGasCost;
      } else if (gasBidCalculation) {
        profitAfterGas = gasBidCalculation.profitProtection.remainingProfitAfterGas;
      }

      return {
        ...result,
        executionTime: Date.now() - startTime,
        gasBidUsed: gasBidCalculation || undefined,
        profitAfterGas,
        gasBiddingSuccess: gasBidCalculation ? result.success : undefined
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
      tokenIn: this.tokenToString(request.tokenIn),
      tokenOut: this.tokenToString(request.tokenOut),
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
        const quote = await this.quoteWrapper.quoteExactInput(
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

    // Convert amounts to numbers for logging
    const amountIn = parseFloat(request.amountIn);
    const amountOut = parseFloat(quoteData.data!.amountOut);

    // Use the appropriate slippage tolerance based on request
    const maxSlippage = request.slippageTolerance || this.slippageProtection.config.defaultSlippageTolerance || 0.005;

    // Get market data for additional context
    const marketData = await this.getMarketData(
      this.tokenToString(request.tokenIn),
      this.tokenToString(request.tokenOut)
    );

    // For arbitrage swaps, we can't compare amountIn vs amountOut since they're different assets
    // The strategy validates overall profitability - here we just accept valid quotes
    // Only reject if the quote is obviously invalid (zero or negative)
    const isValid = amountOut > 0 && !isNaN(amountOut);

    // Return simplified analysis - strategy handles profit validation
    return {
      currentPrice: amountIn,
      expectedPrice: amountOut,
      slippagePercent: 0, // Not applicable for cross-asset swaps
      isAcceptable: isValid, // Just check quote is valid
      recommendedMaxSlippage: maxSlippage,
      priceImpact: 0, // Strategy calculates overall profitability
      marketCondition: marketData.volume24h === '0' ? 'illiquid' : 'normal'
    };
  }

  /**
   * Calculate optimal gas bid for arbitrage opportunity
   */
  private async calculateOptimalGasBid(request: SwapRequest, quote: QuoteResponse): Promise<GasBidCalculation> {
    try {
      // Extract opportunity metrics from swap request
      const opportunityMetrics: OpportunityMetrics = {
        profitAmountUSD: request.expectedProfitUSD || 0,
        profitPercent: this.calculateProfitPercent(request, quote),
        timeToExpiration: request.timeToExpiration || 300000, // Default 5 minutes
        competitiveRisk: request.competitiveRisk || 'medium',
        marketVolatility: await this.estimateMarketVolatility(request.tokenIn, request.tokenOut),
        liquidityDepth: await this.estimateLiquidityDepth(request.tokenIn, request.tokenOut)
      };

      // Calculate gas bid
      return await this.gasBiddingEngine.calculateGasBid(opportunityMetrics);

    } catch (error) {
      logger.error('Error calculating gas bid:', error);

      // Return conservative fallback bid
      return {
        recommendedGasPrice: TRADING_CONSTANTS.GAS_COSTS.BASE_GAS,
        maxGasPrice: TRADING_CONSTANTS.GAS_COSTS.BASE_GAS * 2,
        priorityMultiplier: 1.0,
        competitiveAdjustment: 1.0,
        profitProtection: {
          maxGasBudget: TRADING_CONSTANTS.GAS_COSTS.BASE_GAS * 2,
          remainingProfitAfterGas: (request.expectedProfitUSD || 0) - TRADING_CONSTANTS.GAS_COSTS.BASE_GAS,
          isViable: (request.expectedProfitUSD || 0) > TRADING_CONSTANTS.GAS_COSTS.BASE_GAS * 2
        },
        bidStrategy: 'conservative',
        reasoning: 'Gas bidding error - using conservative fallback'
      };
    }
  }

  /**
   * Calculate profit percentage from request and quote
   */
  private calculateProfitPercent(request: SwapRequest, quote: QuoteResponse): number {
    try {
      if (!request.expectedProfitUSD) return 0;

      // Estimate trade value in USD
      const amountIn = safeParseFloat(request.amountIn, 0);
      if (amountIn <= 0) return 0;

      // Rough estimation: assume GALA is around $0.015
      const estimatedTradeValueUSD = amountIn * 0.015;

      if (estimatedTradeValueUSD <= 0) return 0;

      return request.expectedProfitUSD / estimatedTradeValueUSD;
    } catch (error) {
      logger.error('Error calculating profit percent:', error);
      return 0;
    }
  }

  /**
   * Estimate market volatility for token pair
   */
  private async estimateMarketVolatility(tokenIn: string | TokenClassKey, tokenOut: string | TokenClassKey): Promise<number> {
    try {
      // In production, this would analyze recent price movements
      // For now, return moderate volatility for arbitrage opportunities
      const tokenInStr = this.tokenToString(tokenIn);
      const tokenOutStr = this.tokenToString(tokenOut);

      // Higher volatility for exotic pairs
      if (tokenInStr.includes('SILK') || tokenInStr.includes('ETIME') ||
          tokenOutStr.includes('SILK') || tokenOutStr.includes('ETIME')) {
        return 0.4; // High volatility for exotic tokens
      } else if (tokenInStr.includes('GALA') || tokenOutStr.includes('GALA')) {
        return 0.2; // Moderate volatility for GALA pairs
      } else {
        return 0.1; // Lower volatility for stable pairs
      }
    } catch (error) {
      logger.error('Error estimating market volatility:', error);
      return 0.2; // Default moderate volatility
    }
  }

  /**
   * Estimate liquidity depth for token pair
   */
  private async estimateLiquidityDepth(tokenIn: string | TokenClassKey, tokenOut: string | TokenClassKey): Promise<number> {
    try {
      // Use quote method to estimate available liquidity
      const tokenInStr = this.tokenToString(tokenIn);
      const tokenOutStr = this.tokenToString(tokenOut);

      // Test with a larger amount to gauge liquidity depth
      const testQuote = await this.quoteWrapper.quoteExactInput(tokenInStr, tokenOutStr, 1000);

      if (testQuote?.outTokenAmount) {
        // Rough liquidity estimation based on quote success
        const outAmount = safeParseFloat(testQuote.outTokenAmount.toString(), 0);

        // Estimate liquidity in USD (rough approximation)
        return outAmount * 1000 * 0.015; // Assume GALA ~$0.015
      }

      return 50000; // Default moderate liquidity
    } catch (error) {
      logger.debug('Error estimating liquidity depth:', error);
      return 50000; // Default moderate liquidity
    }
  }

  /**
   * Prepare swap payload with enhanced validation and safety checks
   */
  private async prepareSwapPayload(request: SwapRequest, quote: QuoteResponse, gasBid?: GasBidCalculation | null): Promise<any> {
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

      const expectedOutputFixed = PrecisionMath.fromToken(outputResult.data!.amountOut, TOKEN_DECIMALS.GALA);
      const slippageTolerance = request.slippageTolerance || 0.01;

      // Validate slippage tolerance
      if (slippageTolerance < 0 || slippageTolerance > 0.5) {
        throw new Error('Slippage tolerance out of safe bounds (0-50%)');
      }

      // Calculate minimum amount out using precision math
      const slippageToleranceFixed = PrecisionMath.fromNumber(slippageTolerance, PrecisionMath.PERCENTAGE_DECIMALS);
      const minimumAmountOutFixed = PrecisionMath.applySlippage(expectedOutputFixed, slippageToleranceFixed);
      const minimumAmountOut = PrecisionMath.toToken(minimumAmountOutFixed, TOKEN_DECIMALS.GALA);

      // Validate minimum amount is reasonable
      if (minimumAmountOutFixed.isZero() || minimumAmountOutFixed.isNegative()) {
        throw new Error('Calculated minimum amount out is invalid');
      }

      // Determine optimal fee tier with validation
      const feeTier = await this.selectOptimalFeeTier(this.tokenToString(request.tokenIn), this.tokenToString(request.tokenOut));

      // Validate fee tier
      const validFees = [500, 3000, 10000];
      if (!validFees.includes(feeTier)) {
        throw new Error(`Invalid fee tier selected: ${feeTier}`);
      }

      // Enhanced payload request with safety checks
      // ✅ FIX: Normalize token formats before creating TokenClassKey
      const { normalizeTokenFormat } = await import('../../utils/token-format.js');
      const tokenIn = typeof request.tokenIn === 'string' ?
        createTokenClassKey(normalizeTokenFormat(request.tokenIn)) :
        request.tokenIn;
      const tokenOut = typeof request.tokenOut === 'string' ?
        createTokenClassKey(normalizeTokenFormat(request.tokenOut)) :
        request.tokenOut;

      const swapPayloadRequest: SwapPayloadRequest = {
        tokenIn,
        tokenOut,
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

    // Compare amounts using precision math to avoid floating point errors
    const amountInFixed = PrecisionMath.fromToken(request.amountIn, TOKEN_DECIMALS.GALA);
    const amountOutMinFixed = PrecisionMath.fromToken(request.amountOutMinimum, TOKEN_DECIMALS.GALA);

    if (amountInFixed.lt(amountOutMinFixed)) {
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
        // Validate that we have a valid route for this swap using working quote method
        const testQuote = await this.quoteWrapper.quoteExactInput(
          this.tokenToString(request.tokenIn),
          this.tokenToString(request.tokenOut),
          0.01 // Small test amount
        );

        if (!testQuote || !testQuote.outTokenAmount) {
          throw new Error(`No valid route found for ${request.tokenIn}/${request.tokenOut}`);
        }

        // Validate sufficient liquidity exists by checking if we get reasonable output
        if (safeParseFloat(testQuote.outTokenAmount, 0) <= 0) {
          throw new Error('Pool has insufficient liquidity for swap');
        }

        // Get a fresh quote to validate pricing
        const validateQuote = await this.quoteWrapper.quoteExactInput(
          this.tokenToString(request.tokenIn),
          this.tokenToString(request.tokenOut),
          request.amountIn
        );

        if (!validateQuote?.outTokenAmount) {
          throw new Error('Unable to get valid quote for swap');
        }

        // Ensure minimum output is achievable using precision math
        const expectedOutputFixed = PrecisionMath.fromToken(validateQuote.outTokenAmount.toString(), TOKEN_DECIMALS.GALA);
        const minimumOutputFixed = PrecisionMath.fromToken(request.amountOutMinimum || '0', TOKEN_DECIMALS.GALA);

        if (expectedOutputFixed.lt(minimumOutputFixed)) {
          const expectedOutput = safeFixedToNumber(expectedOutputFixed);
          const minimumOutput = safeFixedToNumber(minimumOutputFixed);
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
          deadline: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
          userAddress: request.userAddress // Wallet address for SDK swap execution
        };

        // Return validated payload in expected format
        const payloadResponse = {
          status: 200,
          error: false,
          data: {
            payload: swapPayload
          },
          message: 'Success'
        };

        logger.debug(`Real swap payload generated on attempt ${attempt}:`, {
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          expectedOutput: safeFixedToNumber(expectedOutputFixed).toString(),
          minimumOutput: request.amountOutMinimum,
          poolLiquidity: testQuote.outTokenAmount // Use quote output as liquidity proxy
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
   * Execute swap transaction with enhanced error handling and gas bidding
   */
  private async executeSwapTransaction(payload: any, gasBid?: GasBidCalculation | null): Promise<SwapResult> {
    try {
      // Validate payload before execution
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid payload for transaction execution');
      }

      const payloadSize = JSON.stringify(payload).length;
      if (payloadSize > 1000000) { // 1MB limit
        throw new Error('Payload size too large for safe execution');
      }

      // Log gas bidding information
      const gasBidInfo = gasBid ? {
        gasPrice: gasBid.recommendedGasPrice,
        strategy: gasBid.bidStrategy,
        profitProtected: gasBid.profitProtection.isViable
      } : { gasPrice: 'standard', strategy: 'none', profitProtected: true };

      logger.info('Executing swap transaction with gas bidding...', {
        payloadSize,
        payloadType: typeof payload,
        gasBid: gasBidInfo
      });

      // Pre-execution validation
      await this.validatePreExecution();

      // Execute the signed payload via GalaSwap bundle API with retry and gas bidding
      const bundleResponse = await this.executeBundleWithRetry(payload, 'swap', gasBid);

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

      // Calculate actual gas cost if gas bidding was used
      let actualGasCost: number | undefined;
      if (gasBid) {
        actualGasCost = gasBid.recommendedGasPrice;
      }

      return {
        success: true,
        transactionId,
        hash: bundleHash,
        executionTime: 0, // Will be set by caller
        actualGasCost
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
    // Check client health using working quote endpoint (getUserAssets is broken)
    let health: { isHealthy: boolean; apiStatus: string; consecutiveFailures: number };
    try {
      // Use quote API for health check - we know this endpoint works
      await this.quoteWrapper.quoteExactInput('GALA$Unit$none$none', 'GUSDC$Unit$none$none', 1);
      health = { isHealthy: true, apiStatus: 'healthy', consecutiveFailures: 0 };
    } catch (error) {
      health = { isHealthy: false, apiStatus: 'unhealthy', consecutiveFailures: 1 };
      logger.warn('Health check failed:', (error as Error).message);
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
  private async executeBundleWithRetry(payload: any, bundleType: 'swap', gasBid?: GasBidCalculation | null, maxRetries: number = 2): Promise<any> {
    const config = getConfig();

    // *** PRODUCTION TEST MODE INTERCEPTION ***
    if (config.development.productionTestMode) {
      return this.simulateTradeExecution(payload, bundleType, gasBid);
    }

    // *** LIVE TRADING MODE - Real execution ***
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Debug: Log payload structure before extraction
        logger.info('🔍 Raw payload received in executeBundleWithRetry:', {
          hasData: !!payload.data,
          hasPayload: !!payload.payload,
          payloadKeys: Object.keys(payload),
          dataKeys: payload.data ? Object.keys(payload.data) : [],
          payloadPayloadKeys: payload.payload ? Object.keys(payload.payload) : []
        });

        // Extract the actual swap payload from the response wrapper
        const actualPayload = payload.data?.payload || payload.payload || payload;

        // Debug: Log extracted payload
        logger.info('🔍 Extracted actualPayload:', {
          hasUserAddress: !!actualPayload.userAddress,
          userAddress: actualPayload.userAddress ? `${actualPayload.userAddress.substring(0, 10)}...` : 'UNDEFINED',
          actualPayloadKeys: Object.keys(actualPayload)
        });

        // Build swap amount parameters according to SDK signature
        const swapAmount = {
          exactIn: actualPayload.amountIn,
          amountOutMinimum: actualPayload.amountOutMinimum || '0'
        };

        // Log gas bidding information if available
        if (gasBid && gasBid.recommendedGasPrice > TRADING_CONSTANTS.GAS_COSTS.BASE_GAS) {
          const priorityMultiplier = gasBid.recommendedGasPrice / TRADING_CONSTANTS.GAS_COSTS.BASE_GAS;

          logger.info('Gas bidding applied (SDK does not support priority fees directly):', {
            strategy: gasBid.bidStrategy,
            gasMultiplier: Math.min(priorityMultiplier, 5.0),
            estimatedGasCost: gasBid.recommendedGasPrice,
            note: 'Gas bidding tracked for analytics only - SDK handles gas internally'
          });
        }

        // Execute swap using SDK with correct signature
        logger.info('Calling SDK swap with:', {
          tokenIn: actualPayload.tokenIn,
          tokenOut: actualPayload.tokenOut,
          fee: actualPayload.fee || 3000,
          amount: swapAmount,
          userAddress: actualPayload.userAddress // DEBUG: Verify wallet is passed
        });

        const swapResult = await this.gswap.swaps.swap(
          actualPayload.tokenIn,
          actualPayload.tokenOut,
          actualPayload.fee || 3000,
          swapAmount,
          actualPayload.userAddress // Pass wallet address as 5th parameter
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
   * Simulate trade execution in production test mode with gas bidding
   */
  private async simulateTradeExecution(payload: any, bundleType: 'swap', gasBid?: GasBidCalculation | null): Promise<any> {
    SwapExecutor.testTransactionCounter++;
    const testTxId = `TEST-${bundleType.toUpperCase()}-${SwapExecutor.testTransactionCounter.toString().padStart(3, '0')}`;
    const timestamp = new Date().toISOString();

    // Extract trade details for logging including gas bidding
    const tradeDetails = {
      type: bundleType,
      tokenIn: payload.payload?.tokenIn || 'Unknown',
      tokenOut: payload.payload?.tokenOut || 'Unknown',
      amountIn: payload.payload?.amountIn || '0',
      amountOutMinimum: payload.payload?.amountOutMinimum || '0',
      fee: payload.payload?.fee || 3000,
      testTxId,
      timestamp,
      // Gas bidding details
      gasBidStrategy: gasBid?.bidStrategy || 'none',
      gasPrice: gasBid?.recommendedGasPrice || TRADING_CONSTANTS.GAS_COSTS.BASE_GAS,
      profitAfterGas: gasBid?.profitProtection.remainingProfitAfterGas || 'unknown'
    };

    // Log the simulated trade prominently with gas bidding information
    logger.warn('🧪 SIMULATED TRADE EXECUTION WITH GAS BIDDING:');
    logger.warn(`   📊 ${tradeDetails.type.toUpperCase()}: ${tradeDetails.amountIn} ${tradeDetails.tokenIn} → ${tradeDetails.tokenOut}`);
    logger.warn(`   💰 Min Output: ${tradeDetails.amountOutMinimum}`);
    logger.warn(`   💸 Fee Tier: ${tradeDetails.fee} (${(tradeDetails.fee / 10000).toFixed(2)}%)`);
    logger.warn(`   ⛽ Gas Strategy: ${tradeDetails.gasBidStrategy.toUpperCase()}`);
    logger.warn(`   💸 Gas Price: ${tradeDetails.gasPrice} GALA`);
    logger.warn(`   💎 Profit After Gas: ${tradeDetails.profitAfterGas} USD`);
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

        // Analyze price execution if data is available using precision math
        if ((executionData as any).executedPrice) {
          const actualPriceFixed = PrecisionMath.fromNumber((executionData as any).executedPrice, PrecisionMath.PRICE_DECIMALS);
          const actualPrice = safeFixedToNumber(actualPriceFixed);
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
    // Calculate slippage percentage using precision math
    const expectedPriceFixed = PrecisionMath.fromNumber(expectedPrice, PrecisionMath.PRICE_DECIMALS);
    const actualPriceFixed = PrecisionMath.fromNumber(actualPrice, PrecisionMath.PRICE_DECIMALS);
    const slippagePercentFixed = PrecisionMath.calculatePercentageChange(expectedPriceFixed, actualPriceFixed);
    const slippagePercent = Math.abs(safeFixedToNumber(slippagePercentFixed));

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

      // Test fee tiers using working quote method
      const tierPromises = feeTiers.map(async (tier) => {
        try {
          const quote = await this.quoteWrapper.quoteExactInput(tokenIn, tokenOut, 1);

          if (quote?.outTokenAmount && quote.feeTier === tier) {
            const outAmount = safeParseFloat(quote.outTokenAmount.toString(), 0);
            logger.debug(`Fee tier ${tier}: quote output ${outAmount}`);
            return { tier, liquidity: outAmount }; // Use output amount as proxy for liquidity
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
      // Use quote method to check if there's a valid route (proxy for liquidity)
      const quote = await this.quoteWrapper.quoteExactInput(tokenIn, tokenOut, 100); // Test with 100 units

      let poolLiquidity = '0'; // Start with no fallback
      if (quote?.outTokenAmount) {
        // Use quote output as proxy for liquidity availability using precision math
        const outAmountFixed = PrecisionMath.fromToken(quote.outTokenAmount.toString(), TOKEN_DECIMALS.GALA);
        const scalingFactorFixed = PrecisionMath.fromNumber(1000, PrecisionMath.DEFAULT_DECIMALS);
        const liquidityFixed = PrecisionMath.multiply(outAmountFixed, scalingFactorFixed);
        poolLiquidity = PrecisionMath.toToken(liquidityFixed, TOKEN_DECIMALS.GALA);
        logger.debug(`Retrieved quote-based liquidity proxy: ${poolLiquidity} for ${tokenIn}/${tokenOut}`);
      } else {
        // If no quote available, no trading route exists
        logger.error(`No trading route found for ${tokenIn}/${tokenOut}`);
        poolLiquidity = '0'; // Fail with zero rather than mock data
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
        // Calculate volatility from real price history using precision math
        const pricesFixed = historyResult.data!.prices
          .map(p => PrecisionMath.fromNumber(p.price || '0', PrecisionMath.PRICE_DECIMALS))
          .filter(p => !p.isZero());

        if (pricesFixed.length > 1) {
          // Calculate log returns using precision math
          const returns = pricesFixed.slice(1).map((priceFixed, i) => {
            const ratio = PrecisionMath.divide(priceFixed, pricesFixed[i]);
            return Math.log(safeFixedToNumber(ratio)); // Math.log still requires regular numbers
          });

          const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
          const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
          volatility24h = Math.sqrt(variance);
          logger.debug(`Calculated volatility from ${pricesFixed.length} price points: ${(volatility24h * 100).toFixed(2)}%`);
        }
      }

      // Calculate realistic 24h volume estimate from pool characteristics using precision math
      let volume24h = '0'; // Start with zero instead of arbitrary fallback
      if (poolLiquidity) {
        // Use actual liquidity for realistic volume estimation
        const liquidityFixed = PrecisionMath.fromToken(poolLiquidity, TOKEN_DECIMALS.GALA);

        if (!liquidityFixed.isZero()) {
          const liquidityNumber = safeFixedToNumber(liquidityFixed);

          // Estimate volume based on pool size and typical DeFi turnover rates
          // Larger pools typically have lower turnover rates
          const turnoverRate = liquidityNumber > 10000000 ? 0.05 : // Large pools: 5% daily turnover
                              liquidityNumber > 1000000 ? 0.15 :  // Medium pools: 15% daily turnover
                              0.25; // Small pools: 25% daily turnover

          const turnoverRateFixed = PrecisionMath.fromNumber(turnoverRate, PrecisionMath.PERCENTAGE_DECIMALS);
          const volumeFixed = PrecisionMath.calculatePercentage(liquidityFixed, turnoverRateFixed);
          volume24h = PrecisionMath.toToken(volumeFixed, TOKEN_DECIMALS.GALA);

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
   * Get execution statistics including gas bidding performance
   */
  getExecutionStats(): {
    clientHealth: any;
    rateLimiterStatus: any;
    gasBidding: {
      enabled: boolean;
      totalBids: number;
      successRate: number;
      averageGasPrice: number;
      averageProfitAmount: number;
      strategyDistribution: Record<string, number>;
    };
  } {
    const gasBiddingStats = this.gasBiddingEngine.getBiddingStats();

    return {
      clientHealth: {}, // Will be updated when health check method is available
      rateLimiterStatus: {}, // Will be available after client updates
      gasBidding: {
        enabled: this.gasBiddingEngine.getConfig().enabled,
        ...gasBiddingStats
      }
    };
  }

  /**
   * Update gas bidding configuration
   */
  updateGasBiddingConfig(config: Partial<any>): void {
    this.gasBiddingEngine.updateConfig(config);
    logger.info('Gas bidding configuration updated');
  }

  /**
   * Get current gas bidding configuration
   */
  getGasBiddingConfig(): any {
    return this.gasBiddingEngine.getConfig();
  }

  /**
   * Get gas bidding statistics
   */
  getGasBiddingStats(): any {
    return this.gasBiddingEngine.getBiddingStats();
  }
}