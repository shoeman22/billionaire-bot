/**
 * Transaction Analyzer Service
 *
 * Core analytics engine for processing historical trading data.
 * Analyzes patterns, detects whale movements, predicts volume trends,
 * and provides actionable insights for trading strategies.
 */

import { logger } from '../utils/logger';
import { createTransactionHistoryClient, TransactionHistoryClient } from '../api/transaction-history-client';
import {
  TransactionRecord,
  WhaleTrader,
  WhaleActivity,
  VolumeAnalysis,
  TradingPattern
} from '../api/types';

export interface AnalyzerConfig {
  whaleMinVolume: number;
  whaleMinTrades: number;
  botDetectionThreshold: number;
  volumeSpikeThreshold: number;
  analysisWindowHours: number;
}

export interface PoolInsights {
  poolHash: string;
  token0: string;
  token1: string;
  whales: WhaleActivity[];
  volumeAnalysis: VolumeAnalysis;
  tradingPatterns: TradingPattern[];
  riskFactors: {
    manipulation: number; // 0-1 scale
    liquidity: number; // 0-1 scale
    volatility: number; // 0-1 scale
  };
  recommendations: {
    shouldTrade: boolean;
    confidence: number;
    strategy: 'follow_whale' | 'counter_trend' | 'avoid' | 'arbitrage';
    reasoning: string[];
  };
}

/**
 * Transaction Analyzer Service
 *
 * Processes historical transaction data to extract trading insights.
 * Identifies whale traders, analyzes volume patterns, and provides
 * actionable recommendations for arbitrage strategies.
 *
 * @example
 * ```typescript
 * const analyzer = new TransactionAnalyzer();
 *
 * // Analyze a pool for insights
 * const insights = await analyzer.analyzePool('poolHash123');
 *
 * // Get whale traders
 * const whales = await analyzer.identifyWhales('poolHash123');
 *
 * // Predict volume trends
 * const volumePrediction = await analyzer.analyzeVolume('poolHash123');
 * ```
 */
export class TransactionAnalyzer {
  private historyClient: TransactionHistoryClient;
  private config: AnalyzerConfig;
  private insightsCache: Map<string, { insights: PoolInsights; timestamp: number }> = new Map();
  private readonly INSIGHTS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor(
    historyClient?: TransactionHistoryClient,
    config?: Partial<AnalyzerConfig>
  ) {
    this.historyClient = historyClient || createTransactionHistoryClient();
    this.config = {
      whaleMinVolume: 100, // Minimum volume to be considered a whale
      whaleMinTrades: 5,   // Minimum trades to be considered active
      botDetectionThreshold: 0.7, // Confidence threshold for bot detection
      volumeSpikeThreshold: 2.0,  // Volume must be 2x average to be a spike
      analysisWindowHours: 72,    // Analyze last 72 hours
      ...config
    };

    logger.info('🧠 Transaction Analyzer Service initialized', {
      whaleMinVolume: this.config.whaleMinVolume,
      analysisWindow: `${this.config.analysisWindowHours}h`
    });
  }

  /**
   * Get comprehensive insights for a pool
   */
  async analyzePool(poolHash: string): Promise<PoolInsights> {
    // Check cache first
    const cached = this.insightsCache.get(poolHash);
    if (cached && (Date.now() - cached.timestamp) < this.INSIGHTS_CACHE_TTL) {
      logger.debug(`Using cached insights for pool ${poolHash.substring(0, 8)}...`);
      return cached.insights;
    }

    logger.info(`🔍 Analyzing pool ${poolHash.substring(0, 8)}...`);

    try {
      // Get recent transactions
      const fromTime = new Date(Date.now() - (this.config.analysisWindowHours * 60 * 60 * 1000)).toISOString();
      const transactions = await this.historyClient.getPoolTransactions(poolHash, {
        limit: 2000,
        fromTime
      });

      if (transactions.length < 10) {
        logger.warn(`Insufficient transaction data for pool ${poolHash.substring(0, 8)}: ${transactions.length} transactions`);
        return this.createMinimalInsights(poolHash, transactions);
      }

      logger.debug(`Analyzing ${transactions.length} transactions for pool ${poolHash.substring(0, 8)}`);

      // Parallel analysis
      const [whales, volumeAnalysis, patterns] = await Promise.all([
        this.identifyWhales(poolHash, transactions),
        this.analyzeVolume(poolHash, transactions),
        this.identifyTradingPatterns(transactions)
      ]);

      // Calculate risk factors
      const riskFactors = this.calculateRiskFactors(transactions, whales, volumeAnalysis);

      // Generate recommendations
      const recommendations = this.generateRecommendations(whales, volumeAnalysis, patterns, riskFactors);

      const insights: PoolInsights = {
        poolHash,
        token0: transactions[0]?.token0 || 'UNKNOWN',
        token1: transactions[0]?.token1 || 'UNKNOWN',
        whales,
        volumeAnalysis,
        tradingPatterns: patterns,
        riskFactors,
        recommendations
      };

      // Cache the insights
      this.insightsCache.set(poolHash, {
        insights,
        timestamp: Date.now()
      });

      logger.info(`✅ Pool analysis complete for ${poolHash.substring(0, 8)}`, {
        whaleCount: whales.length,
        volumeSpike: volumeAnalysis.volumeSpike,
        shouldTrade: recommendations.shouldTrade,
        strategy: recommendations.strategy
      });

      return insights;

    } catch (error) {
      logger.error(`Failed to analyze pool ${poolHash.substring(0, 8)}:`, error);
      throw error;
    }
  }

  /**
   * Identify whale traders in a pool
   */
  async identifyWhales(
    poolHash: string,
    transactions?: TransactionRecord[]
  ): Promise<WhaleActivity[]> {
    if (!transactions) {
      const fromTime = new Date(Date.now() - (this.config.analysisWindowHours * 60 * 60 * 1000)).toISOString();
      transactions = await this.historyClient.getPoolTransactions(poolHash, {
        limit: 2000,
        fromTime
      });
    }

    logger.debug(`Identifying whales from ${transactions.length} transactions`);

    // Group transactions by user
    const userActivity = new Map<string, TransactionRecord[]>();
    for (const tx of transactions) {
      if (!userActivity.has(tx.userAddress)) {
        userActivity.set(tx.userAddress, []);
      }
      userActivity.get(tx.userAddress)!.push(tx);
    }

    const whaleActivities: WhaleActivity[] = [];

    for (const [userAddress, userTxs] of userActivity.entries()) {
      // Calculate user metrics
      const totalVolume = userTxs.reduce((sum, tx) => sum + tx.volume, 0);
      const tradeCount = userTxs.length;
      const _averageTradeSize = totalVolume / tradeCount;

      // Filter potential whales
      if (totalVolume >= this.config.whaleMinVolume && tradeCount >= this.config.whaleMinTrades) {
        const whaleTrader = await this.analyzeWhaleTrader(userAddress, userTxs);
        const whaleActivity = await this.analyzeWhaleActivity(whaleTrader, userTxs);

        if (whaleActivity.followWorthiness >= 5) { // Only return high-quality whales
          whaleActivities.push(whaleActivity);
        }
      }
    }

    // Sort by follow-worthiness
    whaleActivities.sort((a, b) => b.followWorthiness - a.followWorthiness);

    logger.debug(`Identified ${whaleActivities.length} whale traders`);

    return whaleActivities.slice(0, 10); // Return top 10 whales
  }

  /**
   * Analyze volume patterns and predict trends
   */
  async analyzeVolume(
    poolHash: string,
    transactions?: TransactionRecord[]
  ): Promise<VolumeAnalysis> {
    if (!transactions) {
      const fromTime = new Date(Date.now() - (this.config.analysisWindowHours * 60 * 60 * 1000)).toISOString();
      transactions = await this.historyClient.getPoolTransactions(poolHash, {
        limit: 2000,
        fromTime
      });
    }

    logger.debug(`Analyzing volume patterns from ${transactions.length} transactions`);

    const currentVolume = transactions.reduce((sum, tx) => sum + tx.volume, 0);

    // Calculate hourly volumes for trend analysis
    const hourlyVolumes = this.groupTransactionsByHour(transactions);
    const historicalAverage = hourlyVolumes.length > 0
      ? hourlyVolumes.reduce((sum, vol) => sum + vol, 0) / hourlyVolumes.length
      : 0;

    // Detect volume spike
    const recentHourVolume = hourlyVolumes[0] || 0;
    const volumeSpike = recentHourVolume > (historicalAverage * this.config.volumeSpikeThreshold);
    const spikePercentage = historicalAverage > 0
      ? ((recentHourVolume - historicalAverage) / historicalAverage) * 100
      : 0;

    // Predict next hour volume (simple linear trend)
    const prediction = this.predictNextHourVolume(hourlyVolumes);

    // Identify triggers for volume changes
    const triggers = this.identifyVolumeTriggers(transactions, volumeSpike);

    return {
      poolHash,
      currentVolume,
      historicalAverage,
      volumeSpike,
      spikePercentage,
      prediction,
      triggers
    };
  }

  /**
   * Identify trading patterns in transaction data
   */
  private identifyTradingPatterns(transactions: TransactionRecord[]): TradingPattern[] {
    const patterns: TradingPattern[] = [];

    // Group transactions by time windows
    const timeWindows = this.groupTransactionsByTimeWindow(transactions, 30); // 30-minute windows

    for (const window of timeWindows) {
      if (window.length < 5) continue;

      // Analyze pattern type
      const pattern = this.classifyTradingPattern(window);
      if (pattern) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  /**
   * Analyze individual whale trader
   */
  private async analyzeWhaleTrader(
    userAddress: string,
    transactions: TransactionRecord[]
  ): Promise<WhaleTrader> {
    const totalVolume = transactions.reduce((sum, tx) => sum + tx.volume, 0);
    const tradeCount = transactions.length;
    const averageTradeSize = totalVolume / tradeCount;

    // Sort transactions by time
    const sortedTxs = transactions.sort((a, b) =>
      new Date(a.transactionTime).getTime() - new Date(b.transactionTime).getTime()
    );

    const firstTradeTime = sortedTxs[0].transactionTime;
    const lastTradeTime = sortedTxs[sortedTxs.length - 1].transactionTime;

    // Calculate trading frequency
    const timeSpan = new Date(lastTradeTime).getTime() - new Date(firstTradeTime).getTime();
    const tradingFrequency = timeSpan > 0 ? (tradeCount * 3600000) / timeSpan : 0;

    // Detect if it's a bot
    const botAnalysis = this.detectBotPattern(transactions);

    // Estimate profitability (simplified)
    const profitability = this.estimateProfitability(transactions);

    // Calculate risk score
    const riskScore = this.calculateTraderRiskScore(transactions, botAnalysis.isBot, tradingFrequency);

    return {
      userAddress,
      totalVolume,
      tradeCount,
      averageTradeSize,
      firstTradeTime,
      lastTradeTime,
      isBot: botAnalysis.isBot,
      tradingFrequency,
      profitability,
      riskScore
    };
  }

  /**
   * Analyze whale activity patterns
   */
  private async analyzeWhaleActivity(
    trader: WhaleTrader,
    transactions: TransactionRecord[]
  ): Promise<WhaleActivity> {
    // Get recent transactions (last 20)
    const recentTrades = transactions
      .sort((a, b) => new Date(b.transactionTime).getTime() - new Date(a.transactionTime).getTime())
      .slice(0, 20);

    // Analyze trading patterns
    const intervals = this.calculateTradingIntervals(transactions);
    const averageInterval = intervals.length > 0
      ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length / 1000
      : 0;

    // Identify preferred time ranges
    const preferredTimeRanges = this.identifyPreferredTradingHours(transactions);

    // Calculate volume trend
    const volumeTrend = this.calculateVolumeTrend(transactions);

    // Calculate follow-worthiness score
    const followWorthiness = this.calculateFollowWorthiness(trader, recentTrades);

    return {
      trader,
      recentTrades,
      tradingPattern: {
        averageInterval,
        preferredTimeRanges,
        volumeTrend
      },
      followWorthiness
    };
  }

  /**
   * Calculate risk factors for a pool
   */
  private calculateRiskFactors(
    transactions: TransactionRecord[],
    whales: WhaleActivity[],
    volumeAnalysis: VolumeAnalysis
  ): { manipulation: number; liquidity: number; volatility: number } {
    // Manipulation risk (based on whale concentration)
    const topWhaleVolume = whales.slice(0, 3).reduce((sum, whale) => sum + whale.trader.totalVolume, 0);
    const totalVolume = transactions.reduce((sum, tx) => sum + tx.volume, 0);
    const manipulation = Math.min(1, topWhaleVolume / totalVolume);

    // Liquidity risk (based on trade frequency and volume consistency)
    const tradeFrequency = transactions.length / this.config.analysisWindowHours;
    const liquidity = Math.max(0, 1 - (tradeFrequency / 10)); // Lower frequency = higher risk

    // Volatility risk (based on volume spikes and pattern changes)
    const volatility = volumeAnalysis.volumeSpike ?
      Math.min(1, Math.abs(volumeAnalysis.spikePercentage) / 100) : 0.3;

    return { manipulation, liquidity, volatility };
  }

  /**
   * Generate trading recommendations
   */
  private generateRecommendations(
    whales: WhaleActivity[],
    volumeAnalysis: VolumeAnalysis,
    patterns: TradingPattern[],
    riskFactors: { manipulation: number; liquidity: number; volatility: number }
  ): {
    shouldTrade: boolean;
    confidence: number;
    strategy: 'follow_whale' | 'counter_trend' | 'avoid' | 'arbitrage';
    reasoning: string[];
  } {
    const reasoning: string[] = [];
    let confidence = 0.5;
    let strategy: 'follow_whale' | 'counter_trend' | 'avoid' | 'arbitrage' = 'arbitrage';
    let shouldTrade = true;

    // High-risk conditions
    if (riskFactors.manipulation > 0.7) {
      reasoning.push('High manipulation risk - concentrated whale activity');
      confidence -= 0.3;
    }

    if (riskFactors.liquidity > 0.6) {
      reasoning.push('Low liquidity detected - higher slippage risk');
      confidence -= 0.2;
    }

    // Positive signals
    if (whales.length > 0 && whales[0].followWorthiness >= 8) {
      reasoning.push(`High-quality whale detected (${whales[0].followWorthiness}/10 follow score)`);
      confidence += 0.2;
      strategy = 'follow_whale';
    }

    if (volumeAnalysis.volumeSpike && volumeAnalysis.spikePercentage > 0) {
      reasoning.push(`Volume spike detected (+${volumeAnalysis.spikePercentage.toFixed(1)}%)`);
      confidence += 0.1;
    }

    // Strategy selection
    if (riskFactors.manipulation > 0.8 || riskFactors.volatility > 0.8) {
      strategy = 'avoid';
      shouldTrade = false;
      reasoning.push('Risk factors too high - avoiding this pool');
    } else if (volumeAnalysis.prediction.trend === 'bearish' && confidence > 0.6) {
      strategy = 'counter_trend';
      reasoning.push('Counter-trend opportunity identified');
    }

    // Final confidence adjustment
    confidence = Math.max(0.1, Math.min(0.9, confidence));

    return {
      shouldTrade: shouldTrade && confidence > 0.4,
      confidence,
      strategy,
      reasoning
    };
  }

  /**
   * Helper methods for analysis
   */
  private createMinimalInsights(poolHash: string, transactions: TransactionRecord[]): PoolInsights {
    return {
      poolHash,
      token0: transactions[0]?.token0 || 'UNKNOWN',
      token1: transactions[0]?.token1 || 'UNKNOWN',
      whales: [],
      volumeAnalysis: {
        poolHash,
        currentVolume: 0,
        historicalAverage: 0,
        volumeSpike: false,
        spikePercentage: 0,
        prediction: {
          nextHourVolume: 0,
          confidence: 0,
          trend: 'neutral'
        },
        triggers: {
          whaleActivity: false,
          priceMovement: false,
          timePattern: false
        }
      },
      tradingPatterns: [],
      riskFactors: { manipulation: 0.5, liquidity: 0.8, volatility: 0.5 },
      recommendations: {
        shouldTrade: false,
        confidence: 0.1,
        strategy: 'avoid',
        reasoning: ['Insufficient transaction data for analysis']
      }
    };
  }

  private groupTransactionsByHour(transactions: TransactionRecord[]): number[] {
    const _hourlyVolumes: number[] = [];
    const hourMap = new Map<string, number>();

    for (const tx of transactions) {
      const hour = new Date(tx.transactionTime).toISOString().substring(0, 13); // YYYY-MM-DDTHH
      hourMap.set(hour, (hourMap.get(hour) || 0) + tx.volume);
    }

    // Convert to array sorted by time (most recent first)
    return Array.from(hourMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, volume]) => volume);
  }

  private predictNextHourVolume(hourlyVolumes: number[]): {
    nextHourVolume: number;
    confidence: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  } {
    if (hourlyVolumes.length < 3) {
      return { nextHourVolume: 0, confidence: 0, trend: 'neutral' };
    }

    // Simple linear trend prediction
    const recent = hourlyVolumes.slice(0, 3);
    const trend = recent[0] - recent[2];
    const nextHourVolume = Math.max(0, recent[0] + trend * 0.5);

    const trendDirection = Math.abs(trend) > (recent[0] * 0.1) ?
      (trend > 0 ? 'bullish' : 'bearish') : 'neutral';

    const confidence = Math.min(0.8, hourlyVolumes.length / 24); // More data = higher confidence

    return { nextHourVolume, confidence, trend: trendDirection };
  }

  private identifyVolumeTriggers(
    transactions: TransactionRecord[],
    _volumeSpike: boolean
  ): { whaleActivity: boolean; priceMovement: boolean; timePattern: boolean } {
    // Simplified trigger detection
    const whaleActivity = transactions.some(tx => tx.volume > 50); // Large single trade
    const priceMovement = Math.random() > 0.5; // Placeholder - would calculate actual price movement
    const timePattern = this.isTypicalTradingHour(new Date());

    return { whaleActivity, priceMovement, timePattern };
  }

  private groupTransactionsByTimeWindow(transactions: TransactionRecord[], windowMinutes: number): TransactionRecord[][] {
    const windows: TransactionRecord[][] = [];
    const windowMs = windowMinutes * 60 * 1000;

    // Sort by time
    const sorted = transactions.sort((a, b) =>
      new Date(a.transactionTime).getTime() - new Date(b.transactionTime).getTime()
    );

    let currentWindow: TransactionRecord[] = [];
    let windowStart = 0;

    for (const tx of sorted) {
      const txTime = new Date(tx.transactionTime).getTime();

      if (windowStart === 0) {
        windowStart = txTime;
      }

      if (txTime - windowStart <= windowMs) {
        currentWindow.push(tx);
      } else {
        if (currentWindow.length > 0) {
          windows.push(currentWindow);
        }
        currentWindow = [tx];
        windowStart = txTime;
      }
    }

    if (currentWindow.length > 0) {
      windows.push(currentWindow);
    }

    return windows;
  }

  private classifyTradingPattern(transactions: TransactionRecord[]): TradingPattern | null {
    if (transactions.length < 5) return null;

    const totalVolume = transactions.reduce((sum, tx) => sum + tx.volume, 0);
    const averageVolume = totalVolume / transactions.length;

    // Simple pattern classification
    const highVolumeCount = transactions.filter(tx => tx.volume > averageVolume * 1.5).length;
    const volumeProfile = transactions.map(tx => tx.volume);

    let patternType: 'accumulation' | 'distribution' | 'scalping' | 'arbitrage' = 'scalping';

    if (highVolumeCount > transactions.length * 0.7) {
      patternType = 'accumulation';
    } else if (averageVolume < 10) {
      patternType = 'scalping';
    } else {
      patternType = 'arbitrage';
    }

    return {
      patternType,
      confidence: 0.6,
      duration: this.calculatePatternDuration(transactions),
      volumeProfile,
      priceImpact: 0.01, // Placeholder
      participants: [...new Set(transactions.map(tx => tx.userAddress))]
    };
  }

  private calculatePatternDuration(transactions: TransactionRecord[]): number {
    if (transactions.length < 2) return 0;

    const start = new Date(transactions[0].transactionTime).getTime();
    const end = new Date(transactions[transactions.length - 1].transactionTime).getTime();

    return (end - start) / (60 * 1000); // Duration in minutes
  }

  private detectBotPattern(transactions: TransactionRecord[]): { isBot: boolean; confidence: number } {
    // Use the utility function from TransactionHistoryClient
    const { TransactionUtils } = require('../api/transaction-history-client');
    return TransactionUtils.identifyBotPatterns(transactions);
  }

  private estimateProfitability(transactions: TransactionRecord[]): number {
    // Simplified profitability estimation
    // In reality, would need price data to calculate actual P&L
    const volumeConsistency = this.calculateVolumeConsistency(transactions);
    return volumeConsistency > 0.8 ? 15 : 5; // Return percentage
  }

  private calculateVolumeConsistency(transactions: TransactionRecord[]): number {
    if (transactions.length < 3) return 0;

    const volumes = transactions.map(tx => tx.volume);
    const average = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const variance = volumes.reduce((sum, vol) => sum + Math.pow(vol - average, 2), 0) / volumes.length;
    const stdDev = Math.sqrt(variance);

    return Math.max(0, 1 - (stdDev / average));
  }

  private calculateTraderRiskScore(
    transactions: TransactionRecord[],
    isBot: boolean,
    tradingFrequency: number
  ): number {
    let risk = 5; // Base risk score

    // Reduce risk for consistent behavior
    if (isBot && tradingFrequency > 5) {
      risk -= 2;
    }

    // Increase risk for erratic patterns
    const volumeConsistency = this.calculateVolumeConsistency(transactions);
    if (volumeConsistency < 0.5) {
      risk += 2;
    }

    return Math.max(1, Math.min(10, risk));
  }

  private calculateTradingIntervals(transactions: TransactionRecord[]): number[] {
    if (transactions.length < 2) return [];

    const sorted = transactions.sort((a, b) =>
      new Date(a.transactionTime).getTime() - new Date(b.transactionTime).getTime()
    );

    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const prevTime = new Date(sorted[i - 1].transactionTime).getTime();
      const currentTime = new Date(sorted[i].transactionTime).getTime();
      intervals.push(currentTime - prevTime);
    }

    return intervals;
  }

  private identifyPreferredTradingHours(transactions: TransactionRecord[]): string[] {
    const hourCounts = new Map<number, number>();

    for (const tx of transactions) {
      const hour = new Date(tx.transactionTime).getUTCHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    // Find hours with above-average activity
    const totalTrades = transactions.length;
    const averageTradesPerHour = totalTrades / 24;

    const preferredHours = Array.from(hourCounts.entries())
      .filter(([, count]) => count > averageTradesPerHour * 1.5)
      .map(([hour]) => hour)
      .sort((a, b) => a - b);

    // Group consecutive hours into ranges
    const ranges: string[] = [];
    let rangeStart = preferredHours[0];
    let rangeEnd = preferredHours[0];

    for (let i = 1; i < preferredHours.length; i++) {
      if (preferredHours[i] === rangeEnd + 1) {
        rangeEnd = preferredHours[i];
      } else {
        ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
        rangeStart = rangeEnd = preferredHours[i];
      }
    }

    if (preferredHours.length > 0) {
      ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
    }

    return ranges;
  }

  private calculateVolumeTrend(transactions: TransactionRecord[]): 'increasing' | 'decreasing' | 'stable' {
    const { TransactionUtils } = require('../api/transaction-history-client');
    return TransactionUtils.calculateVolumeTrend(transactions, 24).trend;
  }

  private calculateFollowWorthiness(trader: WhaleTrader, recentTrades: TransactionRecord[]): number {
    let score = 5; // Base score

    // Positive factors
    if (trader.totalVolume > 500) score += 2;
    if (trader.profitability > 10) score += 1;
    if (trader.isBot && trader.riskScore < 5) score += 1;
    if (recentTrades.length > 10) score += 1;

    // Negative factors
    if (trader.riskScore > 7) score -= 2;
    if (trader.tradingFrequency < 1) score -= 1;

    return Math.max(1, Math.min(10, score));
  }

  private isTypicalTradingHour(date: Date): boolean {
    const hour = date.getUTCHours();
    // Typical trading hours: 9 AM - 5 PM UTC
    return hour >= 9 && hour <= 17;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.insightsCache.clear();
    this.historyClient.clearCache();
    logger.debug('Transaction analyzer caches cleared');
  }

  /**
   * Get service statistics
   */
  getStats(): {
    cacheSize: number;
    analysisCount: number;
    historyStats: Record<string, unknown>;
  } {
    return {
      cacheSize: this.insightsCache.size,
      analysisCount: this.insightsCache.size, // Approximate
      historyStats: this.historyClient.getCacheStats()
    };
  }
}

/**
 * Create a transaction analyzer with default configuration
 */
export function createTransactionAnalyzer(config?: Partial<AnalyzerConfig>): TransactionAnalyzer {
  return new TransactionAnalyzer(undefined, config);
}