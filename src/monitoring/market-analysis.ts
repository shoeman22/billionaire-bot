/**
 * Market Analysis
 * Advanced market condition analysis and trend detection
 */

import { PriceTracker } from './price-tracker';
import { GalaSwapClient } from '../api/GalaSwapClient';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { isSuccessResponse } from '../types/galaswap';
import { getPriceFromPoolData } from '../utils/price-math';

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
  private galaSwapClient: GalaSwapClient;
  private marketCondition: MarketCondition | null = null;
  private tokenAnalyses: Map<string, TokenAnalysis> = new Map();
  private liquidityAnalyses: Map<string, LiquidityAnalysis> = new Map();
  private lastAnalysisTime: number = 0;

  private readonly ANALYSIS_INTERVAL = 30000; // 30 seconds
  private readonly TOKENS_TO_ANALYZE = Object.values(TRADING_CONSTANTS.TOKENS);

  constructor(priceTracker: PriceTracker, galaSwapClient: GalaSwapClient) {
    this.priceTracker = priceTracker;
    this.galaSwapClient = galaSwapClient;
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
    const analysisPromises = this.TOKENS_TO_ANALYZE.map(token =>
      this.analyzeToken(token).catch(error => {
        logger.warn(`Failed to analyze token ${token}:`, error);
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
    const priceData = this.priceTracker.getPrice(token);
    const priceHistory = this.priceTracker.getPriceHistory(token, 100);

    if (!priceData || priceHistory.length < 10) {
      throw new Error(`Insufficient data for token ${token}`);
    }

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

    // Generate recommendation
    const recommendation = this.generateRecommendation(trend, momentum, volatility, volume);

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
    if (priceHistory.length < 5) {
      return { direction: 'unknown', strength: 0 };
    }

    const prices = priceHistory.map(p => p.price);
    const recent = prices.slice(-10);
    const older = prices.slice(-20, -10);

    if (recent.length === 0 || older.length === 0) {
      return { direction: 'unknown', strength: 0 };
    }

    const recentAvg = recent.reduce((a, b) => a + b) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b) / older.length;

    const change = (recentAvg - olderAvg) / olderAvg;
    const strength = Math.min(Math.abs(change) * 1000, 100); // Scale to 0-100

    let direction: MarketTrend;
    if (change > 0.02) direction = 'bullish';
    else if (change < -0.02) direction = 'bearish';
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
    const returns = [];

    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const avgReturn = returns.reduce((a, b) => a + b) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;

    return Math.sqrt(variance) * Math.sqrt(365 * 24 * 60); // Annualized volatility
  }

  /**
   * Analyze volume patterns
   */
  private analyzeVolume(
    priceData: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    priceHistory: Array<{ price: number; timestamp: number }>
  ): VolumeAnalysis {
    const current = priceData.volume24h || 0;

    // Mock implementation - would need historical volume data
    const average24h = current * 0.8; // Placeholder
    const average7d = current * 0.9; // Placeholder

    const spike = current > average24h * 2;
    const trend = current > average24h ? 'increasing' : current < average24h * 0.8 ? 'decreasing' : 'stable';

    return {
      current,
      average24h,
      average7d,
      spike,
      trend,
    };
  }

  /**
   * Calculate momentum indicators
   */
  private calculateMomentumIndicators(priceHistory: Array<{ price: number; timestamp: number }>): MomentumIndicators {
    const prices = priceHistory.map(p => p.price);

    // Simple RSI calculation
    const rsi = this.calculateRSI(prices);

    // Momentum (rate of change)
    const momentum = prices.length >= 10 ?
      ((prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10]) * 100 : 0;

    // Acceleration (second derivative)
    const acceleration = prices.length >= 3 ?
      prices[prices.length - 1] - 2 * prices[prices.length - 2] + prices[prices.length - 3] : 0;

    const direction = momentum > 1 ? 'up' : momentum < -1 ? 'down' : 'sideways';

    return {
      rsi,
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
  private generateRecommendation(
    trend: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    momentum: MomentumIndicators,
    volatility: number,
    volume: VolumeAnalysis
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
    if (momentum.rsi > 70) {
      score -= 20;
      factors.push('Overbought conditions (RSI > 70)');
    } else if (momentum.rsi < 30) {
      score += 20;
      factors.push('Oversold conditions (RSI < 30)');
    }

    // Volume analysis
    if (volume.spike && volume.trend === 'increasing') {
      score += 15;
      factors.push('Volume spike with increasing trend');
    }

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
      // This is a simplified implementation
      // In reality, you'd need to get actual pool data and calculate precise arbitrage

      const pool1 = await this.galaSwapClient.getPool(token0, token1, fee1);
      const pool2 = await this.galaSwapClient.getPool(token0, token1, fee2);

      if (!isSuccessResponse(pool1) || !isSuccessResponse(pool2)) {
        return null;
      }

      // Calculate real prices from pool data
      const price1 = getPriceFromPoolData(pool1.data);
      const price2 = getPriceFromPoolData(pool2.data);

      const priceDiff = Math.abs(price1 - price2);
      const profitPercent = (priceDiff / Math.min(price1, price2)) * 100;

      if (profitPercent < 0.1) return null; // Not profitable enough

      return {
        tokenPair: `${token0}/${token1}`,
        buyPool: price1 < price2 ? `${token0}-${token1}-${fee1}` : `${token0}-${token1}-${fee2}`,
        sellPool: price1 < price2 ? `${token0}-${token1}-${fee2}` : `${token0}-${token1}-${fee1}`,
        buyPrice: Math.min(price1, price2),
        sellPrice: Math.max(price1, price2),
        profitPercent,
        volume: parseFloat(pool1.data.Data.volume24h || '0'),
        confidence: Math.min(profitPercent * 10, 100),
        estimatedGas: 200000, // Mock gas estimate
        netProfit: priceDiff * 100 - 50, // Mock calculation
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
      // TODO: Implement real liquidity aggregation across all pools containing this token
      // For now, use a reasonable estimate based on token type
      const defaultLiquidity = token.includes('GALA') ? 500000 : 100000;

      const analysis: LiquidityAnalysis = {
        token,
        totalLiquidity: defaultLiquidity,
        poolDistribution: [
          { pool: 'pool1', liquidity: defaultLiquidity * 0.6, percentage: 60, fee: 500 },
          { pool: 'pool2', liquidity: defaultLiquidity * 0.3, percentage: 30, fee: 3000 },
          { pool: 'pool3', liquidity: defaultLiquidity * 0.1, percentage: 10, fee: 10000 },
        ],
        depth: {
          '0.1%': defaultLiquidity * 0.1,
          '0.5%': defaultLiquidity * 0.3,
          '1%': defaultLiquidity * 0.5,
          '5%': defaultLiquidity * 0.8,
        },
        quality: defaultLiquidity > 500000 ? 'excellent' :
                defaultLiquidity > 100000 ? 'good' :
                defaultLiquidity > 50000 ? 'fair' : 'poor',
      };

      return analysis;

    } catch (_error) {
      logger.debug(`Error analyzing liquidity for ${token}:`, _error);
      return null;
    }
  }

}