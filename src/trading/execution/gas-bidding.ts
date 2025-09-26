/**
 * Gas Bidding System
 * Dynamic transaction priority fee adjustment based on opportunity size and competitive positioning
 * Designed for GalaChain native fee system (not EIP-1559)
 */

import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS, STRATEGY_CONSTANTS } from '../../config/constants';
import { safeParseFloat } from '../../utils/safe-parse';
import { PrecisionMath, FixedNumber } from '../../utils/precision-math';

export interface GasBiddingConfig {
  enabled: boolean;
  maxGasBudgetPercent: number; // Max % of profit to spend on gas
  baseGasPremium: number; // Base premium multiplier (1.0 = no premium)
  competitiveFactor: number; // Multiplier for competitive scenarios
  emergencyMultiplier: number; // Multiplier for high-value opportunities
  marketAnalysisEnabled: boolean; // Enable fee market analysis
  profitProtectionEnabled: boolean; // Prevent overpaying for gas
}

export interface OpportunityMetrics {
  profitAmountUSD: number;
  profitPercent: number;
  timeToExpiration: number; // milliseconds until opportunity expires
  competitiveRisk: 'low' | 'medium' | 'high'; // Risk of other bots competing
  marketVolatility: number; // Current market volatility (0-1)
  liquidityDepth: number; // Available liquidity for this trade
}

export interface GasBidCalculation {
  recommendedGasPrice: number; // In GALA
  maxGasPrice: number; // Maximum we're willing to pay
  priorityMultiplier: number; // Applied multiplier
  competitiveAdjustment: number; // Adjustment for competition
  profitProtection: {
    maxGasBudget: number; // Max gas spend for this opportunity
    remainingProfitAfterGas: number; // Profit left after gas costs
    isViable: boolean; // Whether trade is still profitable after gas
  };
  bidStrategy: 'conservative' | 'moderate' | 'aggressive' | 'emergency';
  reasoning: string; // Human-readable explanation of the bid
}

export interface FeeMarketData {
  averageGasPrice: number; // Current average gas price
  fastGasPrice: number; // Fast confirmation gas price
  safeLowGasPrice: number; // Safe low gas price
  networkCongestion: 'low' | 'medium' | 'high';
  recentTransactionCosts: number[]; // Recent gas costs for similar transactions
  estimatedConfirmationTime: number; // Expected confirmation time in seconds
}

export class GasBiddingEngine {
  private config: GasBiddingConfig;
  private feeMarketHistory: FeeMarketData[] = [];
  private recentBids: Array<{ timestamp: number; gasPrice: number; success: boolean; profitAmount: number }> = [];

  constructor(config?: Partial<GasBiddingConfig>) {
    this.config = {
      enabled: true,
      maxGasBudgetPercent: 0.15, // Never spend more than 15% of profit on gas
      baseGasPremium: 1.0, // Start with no premium
      competitiveFactor: 1.5, // 50% premium for competitive scenarios
      emergencyMultiplier: 3.0, // 3x premium for emergency/high-value opportunities
      marketAnalysisEnabled: true,
      profitProtectionEnabled: true,
      ...config
    };

    logger.info('Gas Bidding Engine initialized:', this.config);
  }

  /**
   * Calculate optimal gas bid for an arbitrage opportunity
   */
  async calculateGasBid(
    opportunityMetrics: OpportunityMetrics,
    currentMarketData?: FeeMarketData
  ): Promise<GasBidCalculation> {
    try {
      if (!this.config.enabled) {
        return this.getDefaultGasBid(opportunityMetrics);
      }

      // Get current fee market data
      const marketData = currentMarketData || await this.getFeeMarketData();

      // Calculate base gas price
      const baseGasPrice = this.calculateBaseGasPrice(marketData);

      // Apply opportunity-based multipliers
      const opportunityMultiplier = this.calculateOpportunityMultiplier(opportunityMetrics);

      // Apply competitive adjustments
      const competitiveAdjustment = this.calculateCompetitiveAdjustment(
        opportunityMetrics,
        marketData
      );

      // Calculate recommended gas price
      const recommendedGasPrice = baseGasPrice * opportunityMultiplier * competitiveAdjustment;

      // Apply profit protection
      const profitProtection = this.calculateProfitProtection(
        opportunityMetrics,
        recommendedGasPrice
      );

      // Determine bid strategy
      const bidStrategy = this.determineBidStrategy(
        opportunityMetrics,
        opportunityMultiplier,
        competitiveAdjustment
      );

      // Final gas price (capped by profit protection)
      const finalGasPrice = Math.min(recommendedGasPrice, profitProtection.maxGasBudget);

      // Generate reasoning
      const reasoning = this.generateBidReasoning(
        opportunityMetrics,
        opportunityMultiplier,
        competitiveAdjustment,
        bidStrategy,
        profitProtection
      );

      const calculation: GasBidCalculation = {
        recommendedGasPrice: finalGasPrice,
        maxGasPrice: profitProtection.maxGasBudget,
        priorityMultiplier: opportunityMultiplier,
        competitiveAdjustment,
        profitProtection,
        bidStrategy,
        reasoning
      };

      // Log the calculation
      logger.info('Gas bid calculated:', {
        profitUSD: opportunityMetrics.profitAmountUSD,
        recommendedGasPrice: finalGasPrice,
        strategy: bidStrategy,
        reasoning
      });

      // Store bid for analysis
      this.recordBid(calculation, opportunityMetrics);

      return calculation;

    } catch (error) {
      logger.error('Error calculating gas bid:', error);
      return this.getDefaultGasBid(opportunityMetrics);
    }
  }

  /**
   * Calculate base gas price from market data
   */
  private calculateBaseGasPrice(marketData: FeeMarketData): number {
    // For GalaChain, we start with the average network gas price
    let basePrice = marketData.averageGasPrice || TRADING_CONSTANTS.GAS_COSTS.BASE_GAS;

    // Adjust for network congestion
    switch (marketData.networkCongestion) {
      case 'high':
        basePrice *= 1.3; // 30% premium for high congestion
        break;
      case 'medium':
        basePrice *= 1.1; // 10% premium for medium congestion
        break;
      case 'low':
      default:
        // No adjustment for low congestion
        break;
    }

    return basePrice;
  }

  /**
   * Calculate opportunity-based multiplier
   */
  private calculateOpportunityMultiplier(opportunityMetrics: OpportunityMetrics): number {
    let multiplier = this.config.baseGasPremium;

    // Profit size multiplier: larger profits justify higher gas costs
    if (opportunityMetrics.profitAmountUSD >= 1000) {
      multiplier *= 2.5; // High-value opportunities (>$1000)
    } else if (opportunityMetrics.profitAmountUSD >= 100) {
      multiplier *= 2.0; // Medium-value opportunities ($100-$1000)
    } else if (opportunityMetrics.profitAmountUSD >= 10) {
      multiplier *= 1.5; // Small opportunities ($10-$100)
    } else {
      multiplier *= 1.1; // Micro opportunities (<$10)
    }

    // Time urgency multiplier: expiring opportunities need faster execution
    const timeUrgencyMinutes = opportunityMetrics.timeToExpiration / (1000 * 60);
    if (timeUrgencyMinutes < 1) {
      multiplier *= this.config.emergencyMultiplier; // Emergency: <1 minute
    } else if (timeUrgencyMinutes < 5) {
      multiplier *= 2.0; // Urgent: <5 minutes
    } else if (timeUrgencyMinutes < 15) {
      multiplier *= 1.5; // Moderate urgency: <15 minutes
    }

    // Profit percentage multiplier: higher profit margins allow higher gas costs
    if (opportunityMetrics.profitPercent >= 0.05) { // 5%+ profit
      multiplier *= 1.3;
    } else if (opportunityMetrics.profitPercent >= 0.02) { // 2-5% profit
      multiplier *= 1.2;
    } else if (opportunityMetrics.profitPercent >= 0.01) { // 1-2% profit
      multiplier *= 1.1;
    }

    return Math.min(multiplier, 5.0); // Cap at 5x to prevent extreme bidding
  }

  /**
   * Calculate competitive adjustment factor
   */
  private calculateCompetitiveAdjustment(
    opportunityMetrics: OpportunityMetrics,
    marketData: FeeMarketData
  ): number {
    let adjustment = 1.0;

    // Base competitive risk adjustment
    switch (opportunityMetrics.competitiveRisk) {
      case 'high':
        adjustment *= this.config.competitiveFactor * 1.2; // Extra premium for high competition
        break;
      case 'medium':
        adjustment *= this.config.competitiveFactor;
        break;
      case 'low':
        adjustment *= 1.0; // No competitive adjustment
        break;
    }

    // Market volatility adjustment: more volatile markets have more competition
    if (opportunityMetrics.marketVolatility > 0.3) {
      adjustment *= 1.3; // High volatility increases competition
    } else if (opportunityMetrics.marketVolatility > 0.1) {
      adjustment *= 1.1; // Medium volatility
    }

    // Liquidity depth adjustment: deeper liquidity attracts more competitors
    if (opportunityMetrics.liquidityDepth > 1000000) { // $1M+ liquidity
      adjustment *= 1.2;
    } else if (opportunityMetrics.liquidityDepth > 100000) { // $100K-$1M liquidity
      adjustment *= 1.1;
    }

    // Network congestion adjustment: busy networks require higher fees
    if (marketData.networkCongestion === 'high') {
      adjustment *= 1.4;
    } else if (marketData.networkCongestion === 'medium') {
      adjustment *= 1.2;
    }

    return Math.min(adjustment, 3.0); // Cap competitive adjustment
  }

  /**
   * Calculate profit protection limits
   */
  private calculateProfitProtection(
    opportunityMetrics: OpportunityMetrics,
    proposedGasPrice: number
  ): GasBidCalculation['profitProtection'] {
    if (!this.config.profitProtectionEnabled) {
      return {
        maxGasBudget: proposedGasPrice * 2, // 2x proposed as max
        remainingProfitAfterGas: opportunityMetrics.profitAmountUSD - proposedGasPrice,
        isViable: true
      };
    }

    // Maximum gas budget as percentage of expected profit
    const maxGasBudget = opportunityMetrics.profitAmountUSD * this.config.maxGasBudgetPercent;

    // Ensure minimum viable profit after gas costs
    const minProfitAfterGas = opportunityMetrics.profitAmountUSD * 0.1; // Keep at least 10% of profit
    const actualMaxGasBudget = Math.min(
      maxGasBudget,
      opportunityMetrics.profitAmountUSD - minProfitAfterGas
    );

    const remainingProfitAfterGas = opportunityMetrics.profitAmountUSD - Math.min(proposedGasPrice, actualMaxGasBudget);
    const isViable = remainingProfitAfterGas >= minProfitAfterGas && actualMaxGasBudget > 0;

    return {
      maxGasBudget: actualMaxGasBudget,
      remainingProfitAfterGas,
      isViable
    };
  }

  /**
   * Determine bid strategy based on opportunity characteristics
   */
  private determineBidStrategy(
    opportunityMetrics: OpportunityMetrics,
    opportunityMultiplier: number,
    competitiveAdjustment: number
  ): GasBidCalculation['bidStrategy'] {
    const totalMultiplier = opportunityMultiplier * competitiveAdjustment;

    if (totalMultiplier >= 4.0 || opportunityMetrics.timeToExpiration < 60000) { // <1 minute
      return 'emergency';
    } else if (totalMultiplier >= 2.5 || opportunityMetrics.competitiveRisk === 'high') {
      return 'aggressive';
    } else if (totalMultiplier >= 1.5) {
      return 'moderate';
    } else {
      return 'conservative';
    }
  }

  /**
   * Generate human-readable reasoning for the bid
   */
  private generateBidReasoning(
    opportunityMetrics: OpportunityMetrics,
    opportunityMultiplier: number,
    competitiveAdjustment: number,
    strategy: string,
    profitProtection: GasBidCalculation['profitProtection']
  ): string {
    const reasons: string[] = [];

    // Opportunity size reasoning
    if (opportunityMetrics.profitAmountUSD >= 1000) {
      reasons.push(`High-value opportunity ($${opportunityMetrics.profitAmountUSD.toFixed(0)})`);
    } else if (opportunityMetrics.profitAmountUSD >= 100) {
      reasons.push(`Medium-value opportunity ($${opportunityMetrics.profitAmountUSD.toFixed(0)})`);
    } else {
      reasons.push(`Small opportunity ($${opportunityMetrics.profitAmountUSD.toFixed(2)})`);
    }

    // Time urgency reasoning
    const timeMinutes = opportunityMetrics.timeToExpiration / (1000 * 60);
    if (timeMinutes < 1) {
      reasons.push('Critical time pressure (<1 min)');
    } else if (timeMinutes < 5) {
      reasons.push('High time pressure (<5 min)');
    }

    // Competition reasoning
    if (opportunityMetrics.competitiveRisk === 'high') {
      reasons.push('High bot competition');
    } else if (opportunityMetrics.competitiveRisk === 'medium') {
      reasons.push('Moderate competition');
    }

    // Profit protection reasoning
    if (!profitProtection.isViable) {
      reasons.push('PROTECTED: Gas cost would eliminate profit');
    } else if (profitProtection.remainingProfitAfterGas < opportunityMetrics.profitAmountUSD * 0.5) {
      reasons.push('Gas cost capped to preserve 50%+ profit');
    }

    return `${strategy.toUpperCase()} strategy: ${reasons.join(', ')}`;
  }

  /**
   * Get current fee market data
   */
  private async getFeeMarketData(): Promise<FeeMarketData> {
    try {
      // In production, this would query the GalaChain network for current fee data
      // For now, use intelligent defaults based on trading constants

      const baseGas = TRADING_CONSTANTS.GAS_COSTS.BASE_GAS;
      const networkLoad = await this.estimateNetworkLoad();

      const marketData: FeeMarketData = {
        averageGasPrice: baseGas * (1 + networkLoad * 0.5),
        fastGasPrice: baseGas * (1.5 + networkLoad * 0.5),
        safeLowGasPrice: baseGas * (0.8 + networkLoad * 0.2),
        networkCongestion: networkLoad > 0.7 ? 'high' : networkLoad > 0.3 ? 'medium' : 'low',
        recentTransactionCosts: this.getRecentTransactionCosts(),
        estimatedConfirmationTime: this.estimateConfirmationTime(networkLoad)
      };

      // Store in history
      this.feeMarketHistory.push(marketData);
      if (this.feeMarketHistory.length > 100) {
        this.feeMarketHistory = this.feeMarketHistory.slice(-100);
      }

      return marketData;

    } catch (error) {
      logger.error('Error getting fee market data:', error);

      // Return safe defaults
      return {
        averageGasPrice: TRADING_CONSTANTS.GAS_COSTS.BASE_GAS,
        fastGasPrice: TRADING_CONSTANTS.GAS_COSTS.BASE_GAS * 1.5,
        safeLowGasPrice: TRADING_CONSTANTS.GAS_COSTS.BASE_GAS * 0.8,
        networkCongestion: 'medium',
        recentTransactionCosts: [TRADING_CONSTANTS.GAS_COSTS.BASE_GAS],
        estimatedConfirmationTime: 30 // 30 seconds default
      };
    }
  }

  /**
   * Estimate current network load (0-1)
   */
  private async estimateNetworkLoad(): Promise<number> {
    try {
      // Analyze recent bid success/failure patterns
      const recentBids = this.recentBids.slice(-20);
      if (recentBids.length < 5) {
        return 0.3; // Default to medium load
      }

      const successRate = recentBids.filter(bid => bid.success).length / recentBids.length;
      const avgGasPrice = recentBids.reduce((sum, bid) => sum + bid.gasPrice, 0) / recentBids.length;
      const baseGas = TRADING_CONSTANTS.GAS_COSTS.BASE_GAS;

      // Higher gas prices and lower success rates indicate higher network load
      const gasPriceIndicator = Math.min((avgGasPrice / baseGas - 1), 1); // Normalized to 0-1
      const successIndicator = 1 - successRate; // Lower success = higher load

      return Math.max(0, Math.min(1, (gasPriceIndicator + successIndicator) / 2));

    } catch (error) {
      logger.error('Error estimating network load:', error);
      return 0.5; // Default to medium load
    }
  }

  /**
   * Get recent transaction costs
   */
  private getRecentTransactionCosts(): number[] {
    const recentCosts = this.recentBids
      .slice(-10)
      .map(bid => bid.gasPrice)
      .filter(cost => cost > 0);

    if (recentCosts.length === 0) {
      return [TRADING_CONSTANTS.GAS_COSTS.BASE_GAS];
    }

    return recentCosts;
  }

  /**
   * Estimate confirmation time based on network load
   */
  private estimateConfirmationTime(networkLoad: number): number {
    // Base confirmation time of 15 seconds, increasing with network load
    const baseTime = 15;
    const maxTime = 120; // Max 2 minutes

    return Math.min(baseTime + (networkLoad * (maxTime - baseTime)), maxTime);
  }

  /**
   * Get default gas bid when bidding is disabled
   */
  private getDefaultGasBid(opportunityMetrics: OpportunityMetrics): GasBidCalculation {
    const baseGas = TRADING_CONSTANTS.GAS_COSTS.BASE_GAS;

    return {
      recommendedGasPrice: baseGas,
      maxGasPrice: baseGas * 2,
      priorityMultiplier: 1.0,
      competitiveAdjustment: 1.0,
      profitProtection: {
        maxGasBudget: baseGas * 2,
        remainingProfitAfterGas: opportunityMetrics.profitAmountUSD - baseGas,
        isViable: opportunityMetrics.profitAmountUSD > baseGas * 2
      },
      bidStrategy: 'conservative',
      reasoning: 'Gas bidding disabled - using base gas price'
    };
  }

  /**
   * Record bid for analysis and learning
   */
  private recordBid(calculation: GasBidCalculation, opportunityMetrics: OpportunityMetrics): void {
    this.recentBids.push({
      timestamp: Date.now(),
      gasPrice: calculation.recommendedGasPrice,
      success: true, // Will be updated when execution completes
      profitAmount: opportunityMetrics.profitAmountUSD
    });

    // Keep only recent bids
    if (this.recentBids.length > 100) {
      this.recentBids = this.recentBids.slice(-100);
    }
  }

  /**
   * Update bid success status after execution
   */
  updateBidResult(gasPrice: number, success: boolean): void {
    const recentBid = this.recentBids
      .slice()
      .reverse()
      .find(bid => Math.abs(bid.gasPrice - gasPrice) < 0.001);

    if (recentBid) {
      recentBid.success = success;
      logger.debug('Updated bid result:', { gasPrice, success });
    }
  }

  /**
   * Get bidding statistics for monitoring
   */
  getBiddingStats(): {
    totalBids: number;
    successRate: number;
    averageGasPrice: number;
    averageProfitAmount: number;
    strategyDistribution: Record<string, number>;
    recentPerformance: { timestamp: number; success: boolean; gasPrice: number }[];
  } {
    const recentBids = this.recentBids.slice(-50);

    const successRate = recentBids.length > 0 ?
      recentBids.filter(bid => bid.success).length / recentBids.length : 0;

    const averageGasPrice = recentBids.length > 0 ?
      recentBids.reduce((sum, bid) => sum + bid.gasPrice, 0) / recentBids.length : 0;

    const averageProfitAmount = recentBids.length > 0 ?
      recentBids.reduce((sum, bid) => sum + bid.profitAmount, 0) / recentBids.length : 0;

    return {
      totalBids: this.recentBids.length,
      successRate,
      averageGasPrice,
      averageProfitAmount,
      strategyDistribution: {}, // Would be populated from historical data
      recentPerformance: recentBids.map(bid => ({
        timestamp: bid.timestamp,
        success: bid.success,
        gasPrice: bid.gasPrice
      }))
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<GasBiddingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Gas bidding configuration updated:', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): GasBiddingConfig {
    return { ...this.config };
  }
}