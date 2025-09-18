/**
 * Slippage Protection
 * Dynamic slippage calculation and protection mechanisms
 */

import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';

export interface SlippageAnalysis {
  currentPrice: number;
  expectedPrice: number;
  slippagePercent: number;
  isAcceptable: boolean;
  recommendedMaxSlippage: number;
  priceImpact: number;
  marketCondition: 'normal' | 'volatile' | 'illiquid';
}

export interface TradeParameters {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  poolLiquidity: string;
  volatility24h: number;
  volume24h: string;
}

export class SlippageProtection {
  private config: TradingConfig;
  private readonly MAX_SLIPPAGE = 0.05; // 5% absolute maximum
  private readonly HIGH_IMPACT_THRESHOLD = 0.02; // 2% price impact is high

  constructor(config: TradingConfig) {
    this.config = config;
    logger.info('Slippage Protection initialized with default tolerance:', config.defaultSlippageTolerance);
  }

  /**
   * Analyze slippage for a potential trade
   */
  analyzeSlippage(
    currentPrice: number,
    quotedPrice: number,
    tradeParams: TradeParameters
  ): SlippageAnalysis {
    // Calculate basic slippage
    const slippagePercent = Math.abs(quotedPrice - currentPrice) / currentPrice;

    // Calculate price impact
    const priceImpact = this.calculatePriceImpact(tradeParams);

    // Determine market condition
    const marketCondition = this.assessMarketCondition(tradeParams);

    // Calculate recommended max slippage based on conditions
    const recommendedMaxSlippage = this.calculateRecommendedSlippage(
      marketCondition,
      priceImpact,
      tradeParams
    );

    // Determine if slippage is acceptable
    const isAcceptable = slippagePercent <= recommendedMaxSlippage;

    const analysis: SlippageAnalysis = {
      currentPrice,
      expectedPrice: quotedPrice,
      slippagePercent,
      isAcceptable,
      recommendedMaxSlippage,
      priceImpact,
      marketCondition,
    };

    logger.debug('Slippage analysis:', analysis);

    return analysis;
  }

  /**
   * Calculate price impact based on trade size and liquidity
   */
  private calculatePriceImpact(tradeParams: TradeParameters): number {
    try {
      const amountIn = parseFloat(tradeParams.amountIn);
      const poolLiquidity = parseFloat(tradeParams.poolLiquidity);

      if (poolLiquidity === 0) {
        return 1; // 100% impact if no liquidity
      }

      // Simplified price impact calculation
      // Real implementation would use pool mathematics (x*y=k formula)
      const impactRatio = amountIn / poolLiquidity;

      // Apply curve based on AMM mathematics
      const priceImpact = impactRatio * (1 + impactRatio);

      return Math.min(priceImpact, 1); // Cap at 100%

    } catch (error) {
      logger.error('Error calculating price impact:', error);
      return 1; // Conservative default
    }
  }

  /**
   * Assess market condition based on volatility and volume
   */
  private assessMarketCondition(tradeParams: TradeParameters): 'normal' | 'volatile' | 'illiquid' {
    const volatility = tradeParams.volatility24h;
    const volume24h = parseFloat(tradeParams.volume24h);
    const poolLiquidity = parseFloat(tradeParams.poolLiquidity);

    // Check for illiquidity
    if (volume24h < poolLiquidity * 0.1) { // Less than 10% of liquidity traded in 24h
      return 'illiquid';
    }

    // Check for high volatility
    if (volatility > 0.1) { // More than 10% volatility
      return 'volatile';
    }

    return 'normal';
  }

  /**
   * Calculate recommended slippage tolerance based on conditions
   */
  private calculateRecommendedSlippage(
    marketCondition: 'normal' | 'volatile' | 'illiquid',
    priceImpact: number,
    tradeParams: TradeParameters
  ): number {
    let baseSlippage = this.config.defaultSlippageTolerance;

    // Adjust based on market condition
    switch (marketCondition) {
      case 'volatile':
        baseSlippage *= 2; // Double slippage tolerance for volatile markets
        break;
      case 'illiquid':
        baseSlippage *= 3; // Triple for illiquid markets
        break;
      case 'normal':
      default:
        // Keep base slippage
        break;
    }

    // Adjust based on price impact
    if (priceImpact > this.HIGH_IMPACT_THRESHOLD) {
      baseSlippage += priceImpact; // Add price impact to slippage tolerance
    }

    // Ensure we don't exceed absolute maximum
    return Math.min(baseSlippage, this.MAX_SLIPPAGE);
  }

  /**
   * Check if a trade should be executed given slippage analysis
   */
  shouldExecuteTrade(analysis: SlippageAnalysis): {
    execute: boolean;
    reason?: string;
    suggestedAction?: string;
  } {
    if (!analysis.isAcceptable) {
      return {
        execute: false,
        reason: `Slippage too high: ${(analysis.slippagePercent * 100).toFixed(2)}% > ${(analysis.recommendedMaxSlippage * 100).toFixed(2)}%`,
        suggestedAction: 'Reduce trade size or wait for better market conditions',
      };
    }

    if (analysis.priceImpact > this.HIGH_IMPACT_THRESHOLD) {
      return {
        execute: false,
        reason: `Price impact too high: ${(analysis.priceImpact * 100).toFixed(2)}%`,
        suggestedAction: 'Consider splitting trade into smaller chunks',
      };
    }

    if (analysis.marketCondition === 'illiquid') {
      return {
        execute: false,
        reason: 'Market is illiquid - high risk of poor execution',
        suggestedAction: 'Wait for higher volume or use smaller trade size',
      };
    }

    return { execute: true };
  }

  /**
   * Calculate optimal trade size given slippage constraints
   */
  calculateOptimalTradeSize(
    maxSlippage: number,
    tradeParams: TradeParameters
  ): {
    optimalAmount: string;
    expectedSlippage: number;
    splits: number;
  } {
    const originalAmount = parseFloat(tradeParams.amountIn);
    const poolLiquidity = parseFloat(tradeParams.poolLiquidity);

    // Calculate amount that would result in target slippage
    const targetAmount = poolLiquidity * maxSlippage;

    if (originalAmount <= targetAmount) {
      return {
        optimalAmount: tradeParams.amountIn,
        expectedSlippage: this.calculatePriceImpact(tradeParams),
        splits: 1,
      };
    }

    // Calculate number of splits needed
    const splits = Math.ceil(originalAmount / targetAmount);
    const splitAmount = originalAmount / splits;

    return {
      optimalAmount: splitAmount.toString(),
      expectedSlippage: maxSlippage * 0.8, // Use 80% of max slippage
      splits,
    };
  }

  /**
   * Monitor slippage during trade execution
   */
  monitorExecutionSlippage(
    expectedPrice: number,
    executedPrice: number,
    tolerance: number
  ): {
    actualSlippage: number;
    withinTolerance: boolean;
    shouldAlert: boolean;
  } {
    const actualSlippage = Math.abs(executedPrice - expectedPrice) / expectedPrice;
    const withinTolerance = actualSlippage <= tolerance;
    const shouldAlert = actualSlippage > tolerance * 1.5; // Alert if 50% over tolerance

    if (shouldAlert) {
      logger.warn('High execution slippage detected:', {
        expected: expectedPrice,
        actual: executedPrice,
        slippage: `${(actualSlippage * 100).toFixed(2)}%`,
        tolerance: `${(tolerance * 100).toFixed(2)}%`,
      });
    }

    return {
      actualSlippage,
      withinTolerance,
      shouldAlert,
    };
  }

  /**
   * Get current protection settings
   */
  getProtectionSettings(): {
    defaultTolerance: number;
    maxSlippage: number;
    highImpactThreshold: number;
  } {
    return {
      defaultTolerance: this.config.defaultSlippageTolerance,
      maxSlippage: this.MAX_SLIPPAGE,
      highImpactThreshold: this.HIGH_IMPACT_THRESHOLD,
    };
  }

  /**
   * Advanced market impact calculation using AMM mathematics
   */
  calculateAdvancedPriceImpact(tradeParams: TradeParameters): {
    priceImpact: number;
    slippageEstimate: number;
    liquidityRisk: 'low' | 'medium' | 'high';
    recommendation: string;
  } {
    try {
      const amountIn = parseFloat(tradeParams.amountIn);
      const poolLiquidity = parseFloat(tradeParams.poolLiquidity);
      const volume24h = parseFloat(tradeParams.volume24h);

      // More sophisticated price impact calculation
      const liquidityRatio = amountIn / poolLiquidity;

      // Apply x*y=k AMM formula impact
      // Price impact ≈ Δx / (x + Δx) for constant product AMM
      const priceImpact = liquidityRatio / (1 + liquidityRatio);

      // Calculate slippage estimate including fees and spread
      const baseFee = 0.003; // 0.3% base fee
      const spreadEstimate = Math.min(liquidityRatio * 2, 0.01); // Max 1% spread
      const slippageEstimate = priceImpact + baseFee + spreadEstimate;

      // Assess liquidity risk
      let liquidityRisk: 'low' | 'medium' | 'high';
      let recommendation: string;

      if (liquidityRatio < 0.01) { // Less than 1% of pool
        liquidityRisk = 'low';
        recommendation = 'Safe to proceed with standard slippage tolerance';
      } else if (liquidityRatio < 0.05) { // 1-5% of pool
        liquidityRisk = 'medium';
        recommendation = 'Consider increasing slippage tolerance or splitting trade';
      } else { // More than 5% of pool
        liquidityRisk = 'high';
        recommendation = 'High impact trade - recommend splitting into smaller chunks';
      }

      // Check volume-to-liquidity ratio for additional risk assessment
      const volumeRatio = volume24h / poolLiquidity;
      if (volumeRatio < 0.1) { // Low volume relative to liquidity
        liquidityRisk = liquidityRisk === 'low' ? 'medium' : 'high';
        recommendation += '. Low trading volume detected - proceed with caution';
      }

      return {
        priceImpact,
        slippageEstimate,
        liquidityRisk,
        recommendation
      };

    } catch (error) {
      logger.error('Error calculating advanced price impact:', error);
      return {
        priceImpact: 1, // Conservative default
        slippageEstimate: 1,
        liquidityRisk: 'high',
        recommendation: 'Error in impact calculation - proceed with extreme caution'
      };
    }
  }

  /**
   * Dynamic slippage adjustment based on real-time conditions
   */
  calculateDynamicSlippage(
    baseSlippage: number,
    marketConditions: {
      volatility: number;
      liquidity: number;
      volume: number;
      spread: number;
      gasPrice?: number;
    }
  ): {
    adjustedSlippage: number;
    adjustmentFactor: number;
    reasons: string[];
  } {
    let adjustmentFactor = 1;
    const reasons: string[] = [];

    // Volatility adjustment
    if (marketConditions.volatility > 0.1) { // High volatility
      const volatilityMultiplier = 1 + (marketConditions.volatility - 0.1) * 2;
      adjustmentFactor *= volatilityMultiplier;
      reasons.push(`Volatility adjustment: ${((volatilityMultiplier - 1) * 100).toFixed(1)}%`);
    }

    // Liquidity adjustment
    if (marketConditions.liquidity < 10000) { // Low liquidity threshold
      const liquidityMultiplier = 1.5;
      adjustmentFactor *= liquidityMultiplier;
      reasons.push('Low liquidity adjustment: +50%');
    }

    // Volume adjustment
    if (marketConditions.volume < 1000) { // Low volume threshold
      const volumeMultiplier = 1.3;
      adjustmentFactor *= volumeMultiplier;
      reasons.push('Low volume adjustment: +30%');
    }

    // Spread adjustment
    if (marketConditions.spread > 0.01) { // Wide spread
      const spreadMultiplier = 1 + marketConditions.spread;
      adjustmentFactor *= spreadMultiplier;
      reasons.push(`Wide spread adjustment: +${(marketConditions.spread * 100).toFixed(2)}%`);
    }

    // Gas price adjustment (for high gas environments)
    if (marketConditions.gasPrice && marketConditions.gasPrice > 100) { // High gas
      const gasMultiplier = 1.2;
      adjustmentFactor *= gasMultiplier;
      reasons.push('High gas price adjustment: +20%');
    }

    const adjustedSlippage = Math.min(baseSlippage * adjustmentFactor, this.MAX_SLIPPAGE);

    return {
      adjustedSlippage,
      adjustmentFactor,
      reasons
    };
  }

  /**
   * Front-running protection assessment
   */
  assessFrontRunningRisk(tradeParams: TradeParameters): {
    riskLevel: 'low' | 'medium' | 'high';
    protectionRecommendations: string[];
    delayRecommendation?: number; // milliseconds
  } {
    const amountIn = parseFloat(tradeParams.amountIn);
    const poolLiquidity = parseFloat(tradeParams.poolLiquidity);
    const impactRatio = amountIn / poolLiquidity;

    let riskLevel: 'low' | 'medium' | 'high';
    const protectionRecommendations: string[] = [];
    let delayRecommendation: number | undefined;

    if (impactRatio < 0.01) { // Small trade
      riskLevel = 'low';
      protectionRecommendations.push('Standard transaction settings recommended');
    } else if (impactRatio < 0.05) { // Medium trade
      riskLevel = 'medium';
      protectionRecommendations.push('Consider using private mempool or MEV protection');
      protectionRecommendations.push('Use tighter slippage tolerance to reduce MEV opportunity');
      delayRecommendation = Math.random() * 3000 + 1000; // 1-4 second random delay
    } else { // Large trade
      riskLevel = 'high';
      protectionRecommendations.push('STRONGLY recommend splitting trade to reduce MEV risk');
      protectionRecommendations.push('Use private mempool and MEV protection services');
      protectionRecommendations.push('Consider time-weighted execution');
      delayRecommendation = Math.random() * 5000 + 2000; // 2-7 second random delay
    }

    return {
      riskLevel,
      protectionRecommendations,
      delayRecommendation
    };
  }

  /**
   * Trade splitting recommendation for large orders
   */
  recommendTradeSplitting(
    totalAmount: number,
    tradeParams: TradeParameters,
    maxAcceptableImpact: number = 0.02
  ): {
    shouldSplit: boolean;
    recommendedChunks: number;
    chunkSize: number;
    estimatedTotalImpact: number;
    timeEstimate: number; // minutes
  } {
    const poolLiquidity = parseFloat(tradeParams.poolLiquidity);

    // Calculate optimal chunk size to stay under impact threshold
    const maxChunkSize = poolLiquidity * maxAcceptableImpact;

    if (totalAmount <= maxChunkSize) {
      return {
        shouldSplit: false,
        recommendedChunks: 1,
        chunkSize: totalAmount,
        estimatedTotalImpact: this.calculatePriceImpact({ ...tradeParams, amountIn: totalAmount.toString() }),
        timeEstimate: 0.1 // ~6 seconds for single trade
      };
    }

    // Calculate number of chunks needed
    const recommendedChunks = Math.ceil(totalAmount / maxChunkSize);
    const chunkSize = totalAmount / recommendedChunks;

    // Estimate total impact with chunking (slightly higher due to multiple trades)
    const singleChunkImpact = this.calculatePriceImpact({ ...tradeParams, amountIn: chunkSize.toString() });
    const estimatedTotalImpact = singleChunkImpact * recommendedChunks * 1.1; // 10% overhead

    // Estimate time (assume 30 seconds between chunks for safety)
    const timeEstimate = recommendedChunks * 0.5; // minutes

    return {
      shouldSplit: true,
      recommendedChunks,
      chunkSize,
      estimatedTotalImpact,
      timeEstimate
    };
  }

  /**
   * Comprehensive pre-trade slippage validation
   */
  validateTradeSlippage(
    currentPrice: number,
    quotedPrice: number,
    tradeParams: TradeParameters,
    marketConditions: any
  ): {
    approved: boolean;
    finalSlippageTolerance: number;
    warnings: string[];
    requirements: string[];
    frontRunningRisk: any;
    splittingRecommendation: any;
  } {
    const warnings: string[] = [];
    const requirements: string[] = [];

    // Basic slippage analysis
    const slippageAnalysis = this.analyzeSlippage(currentPrice, quotedPrice, tradeParams);

    // Advanced price impact
    const advancedImpact = this.calculateAdvancedPriceImpact(tradeParams);

    // Dynamic slippage adjustment
    const dynamicSlippage = this.calculateDynamicSlippage(
      this.config.defaultSlippageTolerance,
      marketConditions
    );

    // Front-running assessment
    const frontRunningRisk = this.assessFrontRunningRisk(tradeParams);

    // Trade splitting recommendation
    const splittingRecommendation = this.recommendTradeSplitting(
      parseFloat(tradeParams.amountIn),
      tradeParams
    );

    // Collect warnings
    if (advancedImpact.liquidityRisk === 'high') {
      warnings.push('High liquidity risk detected');
    }
    if (frontRunningRisk.riskLevel === 'high') {
      warnings.push('High MEV/front-running risk');
    }
    if (splittingRecommendation.shouldSplit) {
      warnings.push(`Large trade detected - recommend splitting into ${splittingRecommendation.recommendedChunks} chunks`);
    }

    // Collect requirements
    if (dynamicSlippage.adjustedSlippage > this.config.defaultSlippageTolerance * 2) {
      requirements.push('Increased slippage tolerance required due to market conditions');
    }
    frontRunningRisk.protectionRecommendations.forEach(rec => requirements.push(rec));

    // Final approval decision
    const finalSlippageTolerance = Math.max(
      slippageAnalysis.recommendedMaxSlippage,
      dynamicSlippage.adjustedSlippage
    );

    const approved =
      finalSlippageTolerance <= this.MAX_SLIPPAGE &&
      advancedImpact.liquidityRisk !== 'high' &&
      slippageAnalysis.isAcceptable;

    return {
      approved,
      finalSlippageTolerance,
      warnings,
      requirements,
      frontRunningRisk,
      splittingRecommendation
    };
  }
}