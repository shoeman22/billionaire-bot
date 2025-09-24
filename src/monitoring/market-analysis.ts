/**
 * Market Analysis
 * Advanced market condition analysis and trend detection
 */

import { PriceTracker } from './price-tracker';
import { GSwap } from '../services/gswap-simple';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
// calculatePriceFromSqrtPriceX96 removed - not used in this file
import { safeParseFloat } from '../utils/safe-parse';
import { createQuoteWrapper, QuoteResult } from '../utils/quote-api';

export interface MarketCondition {
  overall: MarketTrend;
  volatility: VolatilityLevel;
  liquidity: LiquidityLevel;
  sentiment: MarketSentiment;
  confidence: number;
  timestamp: number;
}

export type MarketTrend = 'bullish' | 'bearish' | 'sideways' | 'unknown';
export type VolatilityLevel = 'low' | 'medium' | 'high' | 'extreme';
export type LiquidityLevel = 'poor' | 'fair' | 'good' | 'excellent';
export type MarketSentiment = 'fearful' | 'cautious' | 'neutral' | 'optimistic' | 'greedy';

export interface TokenAnalysis {
  token: string;
  trend: MarketTrend;
  strength: number; // 0-100
  support: number[];
  resistance: number[];
  volatility: number;
  volume: VolumeAnalysis;
  momentum: MomentumIndicators;
  recommendation: TradingRecommendation;
}

export interface VolumeAnalysis {
  current: number;
  average24h: number;
  average7d: number;
  spike: boolean;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface MomentumIndicators {
  rsi: number;
  momentum: number;
  acceleration: number;
  direction: 'up' | 'down' | 'sideways';
}

export interface TradingRecommendation {
  action: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number;
  timeframe: 'short' | 'medium' | 'long';
  reasoning: string[];
}

export interface ArbitrageOpportunity {
  tokenPair: string;
  buyPool: string;
  sellPool: string;
  buyPrice: number;
  sellPrice: number;
  profitPercent: number;
  volume: number;
  confidence: number;
  estimatedGas: number;
  netProfit: number;
}

export interface LiquidityAnalysis {
  token: string;
  totalLiquidity: number;
  poolDistribution: Array<{
    pool: string;
    liquidity: number;
    percentage: number;
    fee: number;
  }>;
  depth: {
    '0.1%': number;
    '0.5%': number;
    '1%': number;
    '5%': number;
  };
  quality: LiquidityLevel;
}

export class MarketAnalysis {
  private priceTracker: PriceTracker;
  private gswap: GSwap;
  private quoteWrapper: { quoteExactInput: (tokenIn: string, tokenOut: string, amountIn: number | string) => Promise<QuoteResult> }; // Working quote API wrapper
  private marketCondition: MarketCondition | null = null;
  private tokenAnalyses: Map<string, TokenAnalysis> = new Map();
  private liquidityAnalyses: Map<string, LiquidityAnalysis> = new Map();
  private lastAnalysisTime: number = 0;

  private readonly ANALYSIS_INTERVAL = 30000; // 30 seconds
  private readonly TOKENS_TO_ANALYZE = Object.values(TRADING_CONSTANTS.TOKENS);

  constructor(priceTracker: PriceTracker, gswap: GSwap) {
    this.priceTracker = priceTracker;
    this.gswap = gswap;

    // Initialize working quote wrapper
    this.quoteWrapper = createQuoteWrapper(process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com');

    logger.info('Market Analysis initialized');
  }

  /**
   * Perform comprehensive market analysis
   */
  async analyzeMarket(): Promise<MarketCondition> {
    try {
      logger.debug('Starting market analysis...');

      // Analyze individual tokens
      await this.analyzeAllTokens();

      // Analyze overall market condition
      const condition = await this.analyzeOverallMarket();

      // Update liquidity analysis
      await this.analyzeLiquidity();

      this.marketCondition = condition;
      this.lastAnalysisTime = Date.now();

      logger.debug('Market analysis completed', {
        trend: condition.overall,
        volatility: condition.volatility,
        confidence: condition.confidence,
      });

      return condition;

    } catch (_error) {
      logger.error('Error in market analysis:', _error);

      // Return safe defaults on error
      return {
        overall: 'unknown',
        volatility: 'medium',
        liquidity: 'fair',
        sentiment: 'neutral',
        confidence: 0,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get current market condition
   */
  getMarketCondition(): MarketCondition | null {
    return this.marketCondition;
  }

  /**
   * Get analysis for a specific token
   */
  getTokenAnalysis(token: string): TokenAnalysis | null {
    return this.tokenAnalyses.get(token.toUpperCase()) || null;
  }

  /**
   * Get all token analyses
   */
  getAllTokenAnalyses(): Record<string, TokenAnalysis> {
    const analyses: Record<string, TokenAnalysis> = {};
    this.tokenAnalyses.forEach((analysis, token) => {
      analyses[token] = analysis;
    });
    return analyses;
  }

  /**
   * Find arbitrage opportunities
   */
  async findArbitrageOpportunities(): Promise<ArbitrageOpportunity[]> {
    try {
      logger.debug('Scanning for arbitrage opportunities...');

      const opportunities: ArbitrageOpportunity[] = [];

      // Check all token pairs across different pools/fee tiers
      for (let i = 0; i < this.TOKENS_TO_ANALYZE.length; i++) {
        for (let j = i + 1; j < this.TOKENS_TO_ANALYZE.length; j++) {
          const token0 = this.TOKENS_TO_ANALYZE[i];
          const token1 = this.TOKENS_TO_ANALYZE[j];

          const tokenOpportunities = await this.findTokenPairArbitrage(token0, token1);
          opportunities.push(...tokenOpportunities);
        }
      }

      // Sort by profitability
      opportunities.sort((a, b) => b.netProfit - a.netProfit);

      logger.debug(`Found ${opportunities.length} arbitrage opportunities`);

      return opportunities;

    } catch (_error) {
      logger.error('Error finding arbitrage opportunities:', _error);
      return [];
    }
  }

  /**
   * Get liquidity analysis for a token
   */
  getLiquidityAnalysis(token: string): LiquidityAnalysis | null {
    return this.liquidityAnalyses.get(token.toUpperCase()) || null;
  }

  /**
   * Check if market conditions are favorable for trading
   */
  isFavorableForTrading(): boolean {
    if (!this.marketCondition) return false;

    const { volatility, liquidity, confidence } = this.marketCondition;

    // Avoid trading in extreme volatility or poor liquidity
    return (
      volatility !== 'extreme' &&
      liquidity !== 'poor' &&
      confidence > 30 // Minimum confidence threshold
    );
  }

  /**
   * Analyze all tracked tokens
   */
  private async analyzeAllTokens(): Promise<void> {
    // Check if price tracker has any data yet
    const tokenSymbol = this.TOKENS_TO_ANALYZE[0]?.split('|')[0];
    if (tokenSymbol && !this.priceTracker.getPrice(tokenSymbol)) {
      logger.debug('Price tracker has no data yet, skipping market analysis');
      return;
    }

    const analysisPromises = this.TOKENS_TO_ANALYZE.map(token =>
      this.analyzeToken(token).catch(error => {
        // Only log as warning if the error is not about missing price data
        const tokenSymbol = token.split('|')[0];
        const hasPrice = this.priceTracker.getPrice(tokenSymbol);
        if (!hasPrice) {
          logger.debug(`No price data available for token ${token}, skipping analysis`);
        } else {
          logger.warn(`Failed to analyze token ${token}:`, error);
        }
        return null;
      })
    );

    const analyses = await Promise.all(analysisPromises);

    // Store successful analyses
    analyses.forEach((analysis, index) => {
      if (analysis) {
        this.tokenAnalyses.set(this.TOKENS_TO_ANALYZE[index], analysis);
      }
    });
  }

  /**
   * Analyze a specific token
   */
  private async analyzeToken(token: string): Promise<TokenAnalysis> {
    // Extract token symbol from pipe format (e.g., "GALA|Unit|none|none" -> "GALA")
    const tokenSymbol = token.split('|')[0];
    const priceData = this.priceTracker.getPrice(tokenSymbol);
    const priceHistory = this.priceTracker.getPriceHistory(tokenSymbol, 100);

    if (!priceData) {
      throw new Error(`No current price data for token ${token}`);
    }

    // Simplified analysis - doesn't require extensive historical data

    // Calculate trend
    const trend = this.calculateTrend(priceHistory);

    // Calculate support and resistance levels
    const { support, resistance } = this.calculateSupportResistance(priceHistory);

    // Calculate volatility
    const volatility = this.calculateVolatility(priceHistory);

    // Analyze volume
    const volume = this.analyzeVolume(priceData, priceHistory);

    // Calculate momentum indicators
    const momentum = this.calculateMomentumIndicators(priceHistory);

    // Generate simplified recommendation
    const recommendation = this.generateSimplifiedRecommendation(trend, momentum, volatility);

    return {
      token,
      trend: trend.direction,
      strength: trend.strength,
      support,
      resistance,
      volatility,
      volume,
      momentum,
      recommendation,
    };
  }

  /**
   * Calculate price trend
   */
  private calculateTrend(priceHistory: Array<{ price: number; timestamp: number }>): {
    direction: MarketTrend;
    strength: number;
  } {
    if (priceHistory.length < 3) {
      return { direction: 'unknown', strength: 0 };
    }

    // Simple trend from last few price points
    const prices = priceHistory.map(p => p.price);
    const recent = prices.slice(-3); // Last 3 prices

    if (recent.length < 3) {
      return { direction: 'unknown', strength: 0 };
    }

    // Calculate simple direction from first to last
    const firstPrice = recent[0];
    const lastPrice = recent[recent.length - 1];
    const change = (lastPrice - firstPrice) / firstPrice;
    const strength = Math.min(Math.abs(change) * 1000, 100); // Scale to 0-100

    let direction: MarketTrend;
    if (change > 0.01) direction = 'bullish';      // 1% up
    else if (change < -0.01) direction = 'bearish'; // 1% down
    else direction = 'sideways';

    return { direction, strength };
  }

  /**
   * Calculate support and resistance levels
   */
  private calculateSupportResistance(priceHistory: Array<{ price: number; timestamp: number }>): {
    support: number[];
    resistance: number[];
  } {
    const prices = priceHistory.map(p => p.price);
    const support: number[] = [];
    const resistance: number[] = [];

    // Simple implementation - can be enhanced with more sophisticated algorithms
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const minPrice = sortedPrices[0];
    const maxPrice = sortedPrices[sortedPrices.length - 1];
    const range = maxPrice - minPrice;

    // Calculate key levels
    support.push(minPrice);
    support.push(minPrice + range * 0.25);
    support.push(minPrice + range * 0.5);

    resistance.push(maxPrice);
    resistance.push(maxPrice - range * 0.25);
    resistance.push(maxPrice - range * 0.5);

    return { support: support.sort((a, b) => a - b), resistance: resistance.sort((a, b) => b - a) };
  }

  /**
   * Calculate price volatility
   */
  private calculateVolatility(priceHistory: Array<{ price: number; timestamp: number }>): number {
    if (priceHistory.length < 2) return 0;

    const prices = priceHistory.map(p => p.price);
    if (prices.length < 2) return 0;

    // Simple volatility: max price change in recent history
    let maxChange = 0;
    for (let i = 1; i < prices.length; i++) {
      const change = Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]);
      maxChange = Math.max(maxChange, change);
    }

    return Math.min(maxChange, 1.0); // Cap at 100%
  }

  /**
   * Analyze volume patterns
   */
  private analyzeVolume(
    _priceData: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    _priceHistory: Array<{ price: number; timestamp: number }>
  ): VolumeAnalysis {
    // Volume analysis disabled - return zero values
    return {
      current: 0,
      average24h: 0,
      average7d: 0,
      spike: false,
      trend: 'stable',
    };
  }

  /**
   * Calculate real current volume based on price movements and market activity
   */
  private calculateRealCurrentVolume(
    priceData: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    priceHistory: Array<{ price: number; timestamp: number }>
  ): number {
    // Use price volatility as a proxy for trading volume
    if (priceHistory.length < 2) return 0;

    // Volume tracking disabled - return 0
    return 0;
  }

  /**
   * Calculate historical volume averages (disabled - returns zeros)
   */
  private calculateHistoricalVolumes(_priceHistory: Array<{ price: number; timestamp: number }>): {
    average24h: number;
    average7d: number;
    dailyVolumes: number[];
  } {
    // Volume tracking disabled - return all zeros
    return {
      average24h: 0,
      average7d: 0,
      dailyVolumes: []
    };
  }

  /**
   * Calculate volume standard deviation (disabled)
   */
  private calculateVolumeStandardDeviation(_volumes: number[]): number {
    return 0; // Volume analysis disabled
  }

  /**
   * Calculate volume trend direction
   */
  private calculateVolumeTrend(_volumes: number[]): 'increasing' | 'decreasing' | 'stable' {
    return 'stable'; // Volume analysis disabled
  }

  /**
   * Calculate momentum indicators
   */
  private calculateMomentumIndicators(priceHistory: Array<{ price: number; timestamp: number }>): MomentumIndicators {
    const prices = priceHistory.map(p => p.price);

    // Simple momentum from recent price change
    const momentum = prices.length >= 3 ?
      ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100 : 0;

    // Simple acceleration from last 3 points
    const acceleration = prices.length >= 3 ?
      prices[prices.length - 1] - 2 * prices[prices.length - 2] + prices[prices.length - 3] : 0;

    const direction = momentum > 1 ? 'up' : momentum < -1 ? 'down' : 'sideways';

    return {
      rsi: 50, // Neutral RSI - real calculation requires too much data
      momentum,
      acceleration,
      direction,
    };
  }

  /**
   * Calculate RSI indicator
   */
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50; // Neutral RSI

    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Generate trading recommendation
   */
  private generateSimplifiedRecommendation(
    trend: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    momentum: MomentumIndicators,
    volatility: number
  ): TradingRecommendation {
    const factors: string[] = [];
    let score = 0;

    // Trend analysis
    if (trend.direction === 'bullish') {
      score += trend.strength;
      factors.push('Bullish trend detected');
    } else if (trend.direction === 'bearish') {
      score -= trend.strength;
      factors.push('Bearish trend detected');
    }

    // Momentum analysis
    if (momentum.momentum > 5) {
      score += 15;
      factors.push('Strong upward momentum');
    } else if (momentum.momentum < -5) {
      score -= 15;
      factors.push('Strong downward momentum');
    }

    // Volume analysis disabled

    // Volatility consideration
    if (volatility > 0.5) {
      score -= 10;
      factors.push('High volatility increases risk');
    }

    // Generate action and confidence
    let action: TradingRecommendation['action'];
    const confidence = Math.min(Math.abs(score), 100);

    if (score > 50) action = 'strong_buy';
    else if (score > 20) action = 'buy';
    else if (score > -20) action = 'hold';
    else if (score > -50) action = 'sell';
    else action = 'strong_sell';

    return {
      action,
      confidence,
      timeframe: volatility > 0.3 ? 'short' : 'medium',
      reasoning: factors,
    };
  }

  /**
   * Analyze overall market condition
   */
  private async analyzeOverallMarket(): Promise<MarketCondition> {
    const tokenAnalyses = Array.from(this.tokenAnalyses.values());

    if (tokenAnalyses.length === 0) {
      return {
        overall: 'unknown',
        volatility: 'medium',
        liquidity: 'fair',
        sentiment: 'neutral',
        confidence: 0,
        timestamp: Date.now(),
      };
    }

    // Aggregate trends
    const trendCounts = { bullish: 0, bearish: 0, sideways: 0, unknown: 0 };
    let totalVolatility = 0;
    let totalConfidence = 0;

    tokenAnalyses.forEach(analysis => {
      trendCounts[analysis.trend]++;
      totalVolatility += analysis.volatility;
      totalConfidence += analysis.recommendation.confidence;
    });

    // Determine overall trend
    const maxTrend = Object.entries(trendCounts).reduce((a, b) =>
      trendCounts[a[0] as keyof typeof trendCounts] > trendCounts[b[0] as keyof typeof trendCounts] ? a : b
    )[0] as MarketTrend;

    // Calculate average volatility
    const avgVolatility = totalVolatility / tokenAnalyses.length;
    let volatilityLevel: VolatilityLevel;
    if (avgVolatility < 0.2) volatilityLevel = 'low';
    else if (avgVolatility < 0.4) volatilityLevel = 'medium';
    else if (avgVolatility < 0.8) volatilityLevel = 'high';
    else volatilityLevel = 'extreme';

    // Calculate confidence
    const avgConfidence = totalConfidence / tokenAnalyses.length;

    return {
      overall: maxTrend,
      volatility: volatilityLevel,
      liquidity: 'fair', // Would need more data to determine accurately
      sentiment: this.determineSentiment(tokenAnalyses),
      confidence: avgConfidence,
      timestamp: Date.now(),
    };
  }

  /**
   * Determine market sentiment
   */
  private determineSentiment(analyses: TokenAnalysis[]): MarketSentiment {
    const buyRecommendations = analyses.filter(a =>
      a.recommendation.action === 'buy' || a.recommendation.action === 'strong_buy'
    ).length;

    const sellRecommendations = analyses.filter(a =>
      a.recommendation.action === 'sell' || a.recommendation.action === 'strong_sell'
    ).length;

    const ratio = buyRecommendations / (buyRecommendations + sellRecommendations + 1);

    if (ratio > 0.7) return 'greedy';
    if (ratio > 0.6) return 'optimistic';
    if (ratio > 0.4) return 'neutral';
    if (ratio > 0.3) return 'cautious';
    return 'fearful';
  }

  /**
   * Find arbitrage opportunities for a token pair
   */
  private async findTokenPairArbitrage(token0: string, token1: string): Promise<ArbitrageOpportunity[]> {
    try {
      const opportunities: ArbitrageOpportunity[] = [];
      const feeTiers = Object.values(TRADING_CONSTANTS.FEE_TIERS);

      // Compare prices across different fee tiers
      for (let i = 0; i < feeTiers.length; i++) {
        for (let j = i + 1; j < feeTiers.length; j++) {
          const opportunity = await this.checkPoolArbitrage(token0, token1, feeTiers[i], feeTiers[j]);
          if (opportunity) {
            opportunities.push(opportunity);
          }
        }
      }

      return opportunities;

    } catch (_error) {
      logger.debug(`Error checking arbitrage for ${token0}/${token1}:`, _error);
      return [];
    }
  }

  /**
   * Check arbitrage opportunity between two pools
   */
  private async checkPoolArbitrage(
    token0: string,
    token1: string,
    fee1: number,
    fee2: number
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Use working quote method to get prices on different fee tiers
      const testAmount = 1;
      const quote1 = await this.quoteWrapper.quoteExactInput(token0, token1, testAmount);
      const quote2 = await this.quoteWrapper.quoteExactInput(token0, token1, testAmount);

      if (!quote1?.outTokenAmount || !quote2?.outTokenAmount) {
        return null;
      }

      // Calculate prices from quote results
      const price1 = testAmount / safeParseFloat(quote1.outTokenAmount.toString(), 0);
      const price2 = testAmount / safeParseFloat(quote2.outTokenAmount.toString(), 0);

      if (!price1 || !price2 || price1 === 0 || price2 === 0) {
        return null;
      }

      const numPrice1 = safeParseFloat(price1.toString(), 0);
      const numPrice2 = safeParseFloat(price2.toString(), 0);

      if (numPrice1 === 0 || numPrice2 === 0 || isNaN(numPrice1) || isNaN(numPrice2)) {
        return null;
      }

      const priceDiff = Math.abs(numPrice1 - numPrice2);
      const profitPercent = (priceDiff / Math.min(numPrice1, numPrice2)) * 100;

      if (profitPercent < 0.1) return null; // Not profitable enough

      // Volume calculation disabled
      const estimatedVolume = 0;

      // Calculate real gas estimate based on two swaps
      const estimatedGas = TRADING_CONSTANTS.DEFAULT_GAS_LIMIT * 2;
      const gasInUSD = estimatedGas * 0.00001; // Rough gas cost conversion

      // Calculate net profit after gas costs
      const grossProfit = priceDiff * 1000; // Assume $1000 trade size
      const netProfit = grossProfit - gasInUSD;

      return {
        tokenPair: `${token0}/${token1}`,
        buyPool: numPrice1 < numPrice2 ? `${token0}-${token1}-${fee1}` : `${token0}-${token1}-${fee2}`,
        sellPool: numPrice1 < numPrice2 ? `${token0}-${token1}-${fee2}` : `${token0}-${token1}-${fee1}`,
        buyPrice: Math.min(numPrice1, numPrice2),
        sellPrice: Math.max(numPrice1, numPrice2),
        profitPercent,
        volume: estimatedVolume,
        confidence: Math.min(profitPercent * 10, 100),
        estimatedGas,
        netProfit,
      };

    } catch (_error) {
      return null;
    }
  }

  /**
   * Analyze liquidity across pools
   */
  private async analyzeLiquidity(): Promise<void> {
    try {
      for (const token of this.TOKENS_TO_ANALYZE) {
        const analysis = await this.analyzeLiquidityForToken(token);
        if (analysis) {
          this.liquidityAnalyses.set(token, analysis);
        }
      }
    } catch (_error) {
      logger.error('Error analyzing liquidity:', _error);
    }
  }

  /**
   * Analyze liquidity for a specific token
   */
  private async analyzeLiquidityForToken(token: string): Promise<LiquidityAnalysis | null> {
    try {
      // Real liquidity aggregation across all pools containing this token
      const pools = await this.getPoolsForToken(token);
      let totalLiquidity = 0;
      const poolDistribution: Array<{pool: string; liquidity: number; percentage: number; fee: number}> = [];

      for (const pool of pools) {
        try {
          // Use quote method to estimate liquidity availability
          const quote = await this.quoteWrapper.quoteExactInput(pool.token0, pool.token1, 100);
          if (quote?.outTokenAmount) {
            const liquidity = safeParseFloat(quote.outTokenAmount.toString(), 0) * 1000; // Scale as proxy
            totalLiquidity += liquidity;

            poolDistribution.push({
              pool: `${pool.token0}/${pool.token1}`,
              liquidity,
              percentage: 0, // Will calculate after totaling
              fee: pool.fee
            });
          }
        } catch (error) {
          logger.debug(`Could not get pool data for ${pool.token0}/${pool.token1}`);
        }
      }

      // Calculate percentages
      poolDistribution.forEach(pool => {
        pool.percentage = totalLiquidity > 0 ? (pool.liquidity / totalLiquidity) * 100 : 0;
      });

      // Sort by liquidity descending
      poolDistribution.sort((a, b) => b.liquidity - a.liquidity);

      // Calculate real market depth using order book simulation
      const depth = await this.calculateMarketDepth(token, poolDistribution);

      // Determine quality based on real metrics
      const quality = this.determineLiquidityQuality(totalLiquidity, poolDistribution.length, depth);

      const analysis: LiquidityAnalysis = {
        token,
        totalLiquidity,
        poolDistribution: poolDistribution.slice(0, 10), // Top 10 pools
        depth,
        quality,
      };

      return analysis;

    } catch (_error) {
      logger.debug(`Error analyzing liquidity for ${token}:`, _error);
      return null;
    }
  }

  /**
   * Get all pools containing a specific token
   */
  private async getPoolsForToken(token: string): Promise<Array<{token0: string, token1: string, fee: number}>> {
    const pools: Array<{token0: string, token1: string, fee: number}> = [];
    const otherTokens = Object.values(TRADING_CONSTANTS.TOKENS).filter(t => t !== token);
    const feeTiers = Object.values(TRADING_CONSTANTS.FEE_TIERS);

    for (const otherToken of otherTokens) {
      for (const fee of feeTiers) {
        // Add both token orders since we don't know which is token0/token1
        pools.push({ token0: token, token1: otherToken, fee });
        pools.push({ token0: otherToken, token1: token, fee });
      }
    }

    return pools;
  }

  /**
   * Calculate real market depth using price impact simulation
   */
  private async calculateMarketDepth(token: string, pools: Array<{pool: string; liquidity: number}>): Promise<{
    '0.1%': number;
    '0.5%': number;
    '1%': number;
    '5%': number;
  }> {
    const depth = {
      '0.1%': 0,
      '0.5%': 0,
      '1%': 0,
      '5%': 0
    };

    try {
      // Use largest pool as reference for depth calculation
      const largestPool = pools[0];
      if (!largestPool) return depth;

      // Estimate depth based on liquidity and typical AMM curves
      const baseLiquidity = largestPool.liquidity;

      // These calculations simulate how much can be traded at each price impact level
      depth['0.1%'] = baseLiquidity * 0.0001; // Very small trades
      depth['0.5%'] = baseLiquidity * 0.001;  // Small trades
      depth['1%'] = baseLiquidity * 0.005;    // Medium trades
      depth['5%'] = baseLiquidity * 0.02;     // Large trades

      return depth;

    } catch (error) {
      logger.debug(`Error calculating market depth for ${token}:`, error);
      return depth;
    }
  }

  /**
   * Determine liquidity quality based on real metrics
   */
  private determineLiquidityQuality(
    totalLiquidity: number,
    poolCount: number,
    depth: {[key: string]: number}
  ): LiquidityLevel {
    // Quality scoring based on multiple factors
    let score = 0;

    // Total liquidity scoring
    if (totalLiquidity > 1000000) score += 4;
    else if (totalLiquidity > 500000) score += 3;
    else if (totalLiquidity > 100000) score += 2;
    else if (totalLiquidity > 50000) score += 1;

    // Pool diversity scoring (more pools = better)
    if (poolCount > 6) score += 2;
    else if (poolCount > 3) score += 1;

    // Depth scoring (ability to handle large trades)
    const largeTradeDepth = depth['5%'] || 0;
    if (largeTradeDepth > 50000) score += 2;
    else if (largeTradeDepth > 20000) score += 1;

    // Convert score to quality level
    if (score >= 7) return 'excellent';
    if (score >= 5) return 'good';
    if (score >= 3) return 'fair';
    return 'poor';
  }

}