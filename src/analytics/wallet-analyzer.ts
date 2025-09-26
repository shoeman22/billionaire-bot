/**
 * Wallet Analyzer Service
 *
 * Advanced wallet analysis engine for GalaSwap V3 trading intelligence.
 * Provides comprehensive wallet profiling, trading pattern recognition,
 * and smart money classification for copy-trading strategies.
 */

import { logger } from '../utils/logger';
import { createGalaScanClient, GalaScanClient, GalaScanTransaction } from '../api/galascan-client';
import { createTransactionHistoryClient, TransactionHistoryClient } from '../api/transaction-history-client';
// TRADING_CONSTANTS import removed - not used

// Wallet analysis configuration
export interface WalletAnalyzerConfig {
  // Analysis time windows
  shortTermDays: number;
  mediumTermDays: number;
  longTermDays: number;

  // Classification thresholds
  botDetectionThreshold: number;
  smartMoneyVolumeThreshold: number;
  smartMoneySuccessThreshold: number;
  activeTraderMinTrades: number;

  // Performance calculation
  profitCalculationMethod: 'estimated' | 'precise' | 'conservative';
  slippageImpactWeight: number;
  gasImpactWeight: number;
}

// Comprehensive wallet analysis results
export interface WalletAnalysis {
  address: string;
  analysisTimestamp: Date;
  dataQuality: 'high' | 'medium' | 'low';
  sampleSize: number;

  // Basic metrics
  totalTrades: number;
  totalVolume: number;
  averageTradeSize: number;
  tradesPerDay: number;
  monthlyVolume: number;

  // Profitability analysis
  profitabilityScore: number; // 0-100 percentage
  estimatedPnL: number; // In USD
  winRate: number; // Percentage of profitable trades
  averageWinSize: number;
  averageLossSize: number;
  profitFactor: number; // Ratio of gross profit to gross loss

  // Risk assessment
  riskScore: number; // 1-10 scale (1 = lowest risk)
  maxDrawdown: number; // Largest consecutive loss percentage
  volatilityScore: number; // Trading size consistency
  liquidityImpact: number; // Average market impact of trades

  // Trading patterns
  isBot: boolean;
  botConfidence: number; // 0-1 scale
  tradingStyle: 'scalper' | 'swing' | 'arbitrageur' | 'holder' | 'unknown';
  preferredTimeRanges: string[]; // Hour ranges like "09-12"
  preferredTokens: Array<{ token: string; percentage: number }>;

  // Behavioral analysis
  activityScore: number; // 0-100, recent activity level
  consistencyScore: number; // How consistent trading patterns are
  adaptabilityScore: number; // How well they adapt to market changes
  marketTimingScore: number; // How well they time entries/exits

  // Copy-trading suitability
  followWorthiness: number; // 0-10 scale
  copyTradingRisk: 'low' | 'medium' | 'high';
  recommendedCopySize: number; // Suggested percentage allocation
  copyTradingNotes: string[];

  // Advanced patterns
  correlatedAddresses: string[]; // Potentially related wallets
  suspiciousActivity: {
    sandwichAttacks: number;
    frontRunning: number;
    unusualPatterns: number;
  };

  // Guild/institutional analysis
  institutionalProbability: number; // 0-1 scale
  guildTreasuryLikelihood: number; // 0-1 scale
  estimatedEntitySize: number; // Number of people/accounts
}

// Trading pattern detection
export interface TradingPattern {
  pattern: string;
  confidence: number;
  frequency: number;
  profitability: number;
  description: string;
  examples: Array<{
    timestamp: Date;
    description: string;
    outcome: 'profit' | 'loss' | 'neutral';
  }>;
}

// Market timing analysis
export interface MarketTimingAnalysis {
  timeRangePerformance: Array<{
    hours: string; // "09-10"
    trades: number;
    successRate: number;
    averageProfit: number;
  }>;
  dayOfWeekPerformance: Array<{
    day: string;
    trades: number;
    successRate: number;
    averageProfit: number;
  }>;
  volatilityTiming: {
    prefersHighVol: boolean;
    optimalVolatilityRange: [number, number];
  };
}

// Default analyzer configuration
const DEFAULT_CONFIG: WalletAnalyzerConfig = {
  shortTermDays: 7,
  mediumTermDays: 30,
  longTermDays: 90,

  botDetectionThreshold: 0.7,
  smartMoneyVolumeThreshold: 10000,
  smartMoneySuccessThreshold: 65,
  activeTraderMinTrades: 10,

  profitCalculationMethod: 'conservative',
  slippageImpactWeight: 0.3,
  gasImpactWeight: 0.7
};

/**
 * Wallet Analyzer Service
 *
 * Provides comprehensive analysis of wallet trading behavior, profitability,
 * and suitability for copy-trading strategies in the GalaSwap ecosystem.
 */
export class WalletAnalyzer {
  private config: WalletAnalyzerConfig;
  private galaScanClient: GalaScanClient;
  private historyClient: TransactionHistoryClient;

  private analysisCache: Map<string, { analysis: WalletAnalysis; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Known gas costs for different transaction types
  private readonly GAS_COSTS = {
    swap: 0.008, // 0.008 GALA average
    multiHop: 0.015, // Multi-hop swaps
    complex: 0.025 // Complex transactions
  };

  constructor(
    config?: Partial<WalletAnalyzerConfig>,
    galaScanClient?: GalaScanClient,
    historyClient?: TransactionHistoryClient
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.galaScanClient = galaScanClient || createGalaScanClient();
    this.historyClient = historyClient || createTransactionHistoryClient();

    logger.info('🧠 Wallet Analyzer initialized', {
      analysisWindow: `${this.config.longTermDays} days`,
      profitMethod: this.config.profitCalculationMethod
    });
  }

  /**
   * Perform comprehensive wallet analysis
   */
  async analyzeWallet(address: string, forceRefresh: boolean = false): Promise<WalletAnalysis> {
    // Check cache first
    const cached = this.analysisCache.get(address);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      logger.debug(`Using cached analysis for wallet ${address.substring(0, 20)}...`);
      return cached.analysis;
    }

    logger.info(`🔍 Analyzing wallet ${address.substring(0, 20)}...`);

    try {
      const analysisStart = Date.now();

      // Get transaction history
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (this.config.longTermDays * 24 * 60 * 60 * 1000));

      const transactions = await this.galaScanClient.getTransactionHistory(address, {
        startDate,
        endDate,
        limit: 1000
      });

      if (transactions.length === 0) {
        return this.createEmptyAnalysis(address);
      }

      logger.debug(`Analyzing ${transactions.length} transactions for wallet ${address.substring(0, 20)}...`);

      // Parallel analysis
      const [
        basicMetrics,
        profitabilityAnalysis,
        riskAssessment,
        tradingPatterns,
        behavioralAnalysis,
        marketTiming,
        copyTradingSuitability
      ] = await Promise.all([
        this.calculateBasicMetrics(_transactions),
        this.analyzeProfitability(_transactions),
        this.assessRisk(_transactions),
        this.identifyTradingPatterns(_transactions),
        this.analyzeBehavior(_transactions),
        this.analyzeMarketTiming(_transactions),
        this.assessCopyTradingSuitability(_transactions)
      ]);

      // Institutional/guild analysis
      const institutionalAnalysis = await this.analyzeInstitutionalPatterns(_transactions);

      // Compile comprehensive analysis
      const analysis: WalletAnalysis = {
        address,
        analysisTimestamp: new Date(),
        dataQuality: this.assessDataQuality(_transactions),
        sampleSize: transactions.length,

        ...basicMetrics,
        ...profitabilityAnalysis,
        ...riskAssessment,
        ...tradingPatterns,
        ...behavioralAnalysis,
        ...copyTradingSuitability,
        ...institutionalAnalysis,

        // Market timing integration
        preferredTimeRanges: marketTiming.timeRangePerformance
          .filter(tr => tr.successRate > 60)
          .map(tr => tr.hours),

        // Correlations and suspicious activity
        correlatedAddresses: await this.findCorrelatedAddresses(address, _transactions),
        suspiciousActivity: await this.detectSuspiciousActivity(_transactions)
      };

      // Cache the result
      this.analysisCache.set(address, {
        analysis,
        timestamp: Date.now()
      });

      const analysisTime = Date.now() - analysisStart;
      logger.info(`✅ Wallet analysis complete for ${address.substring(0, 20)}...`, {
        analysisTime: `${analysisTime}ms`,
        profitabilityScore: analysis.profitabilityScore,
        followWorthiness: analysis.followWorthiness,
        tradingStyle: analysis.tradingStyle
      });

      return analysis;

    } catch (error) {
      logger.error(`Failed to analyze wallet ${address.substring(0, 20)}...:`, error);
      return this.createEmptyAnalysis(address);
    }
  }

  /**
   * Quick wallet screening for whale identification
   */
  async quickScreenWallet(address: string): Promise<{
    isWhaleCandidate: boolean;
    volume30d: number;
    successRate: number;
    riskScore: number;
    confidence: number;
  }> {
    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));

      const transactions = await this.galaScanClient.getTransactionHistory(address, {
        startDate,
        endDate,
        limit: 100
      });

      if (transactions.length < 5) {
        return {
          isWhaleCandidate: false,
          volume30d: 0,
          successRate: 0,
          riskScore: 10,
          confidence: 0
        };
      }

      const volume30d = this.calculateTotalVolume(_transactions);
      const successRate = this.calculateQuickSuccessRate(_transactions);
      const riskScore = this.calculateQuickRiskScore(_transactions);

      const isWhaleCandidate = volume30d >= this.config.smartMoneyVolumeThreshold ||
                              (successRate >= this.config.smartMoneySuccessThreshold && volume30d >= 5000);

      return {
        isWhaleCandidate,
        volume30d,
        successRate,
        riskScore,
        confidence: Math.min(1, transactions.length / 50) // Higher confidence with more data
      };

    } catch (error) {
      logger.debug(`Quick screen failed for ${address.substring(0, 20)}...:`, error);
      return {
        isWhaleCandidate: false,
        volume30d: 0,
        successRate: 0,
        riskScore: 10,
        confidence: 0
      };
    }
  }

  /**
   * Detect potential smart money wallets
   */
  async findSmartMoney(addresses: string[]): Promise<Array<{
    address: string;
    score: number;
    reasons: string[];
  }>> {
    const smartMoneyWallets = [];

    for (const address of addresses) {
      try {
        const quickScreen = await this.quickScreenWallet(address);

        if (quickScreen.isWhaleCandidate) {
          const analysis = await this.analyzeWallet(address);

          let score = 0;
          const reasons = [];

          // High success rate
          if (analysis.profitabilityScore >= 70) {
            score += 30;
            reasons.push(`High success rate: ${analysis.profitabilityScore}%`);
          }

          // Consistent profits
          if (analysis.profitFactor >= 1.5) {
            score += 20;
            reasons.push(`Strong profit factor: ${analysis.profitFactor.toFixed(2)}`);
          }

          // High volume
          if (analysis.monthlyVolume >= this.config.smartMoneyVolumeThreshold) {
            score += 20;
            reasons.push(`High volume: $${analysis.monthlyVolume.toLocaleString()}`);
          }

          // Low risk profile
          if (analysis.riskScore <= 4) {
            score += 15;
            reasons.push(`Low risk profile: ${analysis.riskScore}/10`);
          }

          // Consistent behavior
          if (analysis.consistencyScore >= 70) {
            score += 10;
            reasons.push(`Consistent behavior: ${analysis.consistencyScore}%`);
          }

          // Bot with good performance
          if (analysis.isBot && analysis.profitabilityScore >= 65) {
            score += 5;
            reasons.push('Consistent automated strategy');
          }

          if (score >= 60) {
            smartMoneyWallets.push({ address, score, reasons });
          }
        }

        // Rate limiting
        await this.sleep(100);

      } catch (error) {
        logger.debug(`Failed to analyze smart money candidate ${address.substring(0, 20)}...:`, error);
      }
    }

    return smartMoneyWallets.sort((a, b) => b.score - a.score);
  }

  /**
   * Compare multiple wallets for copy-trading selection
   */
  async compareWallets(addresses: string[]): Promise<Array<{
    address: string;
    analysis: WalletAnalysis;
    ranking: number;
    strengths: string[];
    weaknesses: string[];
  }>> {
    const walletComparisons = [];

    for (const address of addresses) {
      try {
        const analysis = await this.analyzeWallet(address);

        const strengths = [];
        const weaknesses = [];

        // Evaluate strengths
        if (analysis.profitabilityScore >= 70) strengths.push('High profitability');
        if (analysis.followWorthiness >= 8) strengths.push('Excellent follow-worthiness');
        if (analysis.riskScore <= 3) strengths.push('Low risk profile');
        if (analysis.consistencyScore >= 80) strengths.push('Very consistent');
        if (analysis.activityScore >= 80) strengths.push('High activity');

        // Evaluate weaknesses
        if (analysis.profitabilityScore <= 40) weaknesses.push('Poor profitability');
        if (analysis.riskScore >= 8) weaknesses.push('High risk');
        if (analysis.maxDrawdown >= 20) weaknesses.push('Large drawdowns');
        if (analysis.activityScore <= 30) weaknesses.push('Low activity');
        if (analysis.sampleSize < 20) weaknesses.push('Limited data');

        // Calculate ranking score
        const ranking = this.calculateRankingScore(analysis);

        walletComparisons.push({
          address,
          analysis,
          ranking,
          strengths,
          weaknesses
        });

      } catch (error) {
        logger.error(`Failed to compare wallet ${address.substring(0, 20)}...:`, error);
      }
    }

    return walletComparisons.sort((a, b) => b.ranking - a.ranking);
  }

  /**
   * Calculate basic trading metrics
   */
  private calculateBasicMetrics(transactions: GalaScanTransaction[]): {
    totalTrades: number;
    totalVolume: number;
    averageTradeSize: number;
    tradesPerDay: number;
    monthlyVolume: number;
  } {
    const totalTrades = transactions.length;
    const totalVolume = this.calculateTotalVolume(_transactions);
    const averageTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0;

    // Calculate time span
    const sortedTx = transactions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const timeSpanDays = sortedTx.length > 1 ?
      (sortedTx[sortedTx.length - 1].timestamp.getTime() - sortedTx[0].timestamp.getTime()) / (24 * 60 * 60 * 1000) :
      1;

    const tradesPerDay = totalTrades / Math.max(1, timeSpanDays);

    // Monthly volume estimate
    const monthlyVolume = (totalVolume / Math.max(1, timeSpanDays)) * 30;

    return {
      totalTrades,
      totalVolume,
      averageTradeSize,
      tradesPerDay,
      monthlyVolume
    };
  }

  /**
   * Analyze profitability with multiple methods
   */
  private analyzeProfitability(transactions: GalaScanTransaction[]): {
    profitabilityScore: number;
    estimatedPnL: number;
    winRate: number;
    averageWinSize: number;
    averageLossSize: number;
    profitFactor: number;
  } {
    if (transactions.length === 0) {
      return {
        profitabilityScore: 50,
        estimatedPnL: 0,
        winRate: 0,
        averageWinSize: 0,
        averageLossSize: 0,
        profitFactor: 1
      };
    }

    let totalProfit = 0;
    let totalLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let winSum = 0;
    let lossSum = 0;

    for (const tx of transactions) {
      if (tx.status !== 'success' || !tx.swapData) continue;

      const tradeProfit = this.calculateTradeProfit(tx);

      if (tradeProfit > 0) {
        totalProfit += tradeProfit;
        winningTrades++;
        winSum += tradeProfit;
      } else {
        totalLoss += Math.abs(tradeProfit);
        losingTrades++;
        lossSum += Math.abs(tradeProfit);
      }
    }

    const successfulTrades = transactions.filter(tx => tx.status === 'success').length;
    const winRate = successfulTrades > 0 ? (winningTrades / successfulTrades) * 100 : 0;
    const averageWinSize = winningTrades > 0 ? winSum / winningTrades : 0;
    const averageLossSize = losingTrades > 0 ? lossSum / losingTrades : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 2 : 1;

    const estimatedPnL = totalProfit - totalLoss;
    const profitabilityScore = Math.max(0, Math.min(100, winRate));

    return {
      profitabilityScore,
      estimatedPnL,
      winRate,
      averageWinSize,
      averageLossSize,
      profitFactor
    };
  }

  /**
   * Assess trading risk factors
   */
  private assessRisk(transactions: GalaScanTransaction[]): {
    riskScore: number;
    maxDrawdown: number;
    volatilityScore: number;
    liquidityImpact: number;
  } {
    if (transactions.length === 0) {
      return { riskScore: 5, maxDrawdown: 0, volatilityScore: 50, liquidityImpact: 0 };
    }

    // Calculate drawdown
    const runningPnL = [];
    let cumulativePnL = 0;

    for (const tx of transactions) {
      if (tx.status === 'success' && tx.swapData) {
        cumulativePnL += this.calculateTradeProfit(tx);
        runningPnL.push(cumulativePnL);
      }
    }

    const maxDrawdown = this.calculateMaxDrawdown(runningPnL);

    // Calculate volatility (consistency of trade sizes)
    const tradeSizes = transactions
      .filter(tx => tx.swapData)
      .map(tx => tx.swapData!.amountIn);

    const avgSize = tradeSizes.reduce((sum, size) => sum + size, 0) / tradeSizes.length;
    const variance = tradeSizes.reduce((sum, size) => sum + Math.pow(size - avgSize, 2), 0) / tradeSizes.length;
    const volatilityScore = Math.min(100, (Math.sqrt(variance) / avgSize) * 100);

    // Calculate average liquidity impact
    const liquidityImpact = transactions
      .filter(tx => tx.swapData?.slippage)
      .reduce((sum, tx) => sum + tx.swapData!.slippage, 0) / transactions.length;

    // Risk score (1-10 scale)
    let riskScore = 5;
    if (maxDrawdown > 30) riskScore += 2;
    else if (maxDrawdown < 10) riskScore -= 1;

    if (volatilityScore > 80) riskScore += 1;
    else if (volatilityScore < 30) riskScore -= 1;

    if (liquidityImpact > 0.05) riskScore += 1; // High slippage trades

    return {
      riskScore: Math.max(1, Math.min(10, riskScore)),
      maxDrawdown,
      volatilityScore,
      liquidityImpact
    };
  }

  /**
   * Identify trading patterns and bot behavior
   */
  private identifyTradingPatterns(transactions: GalaScanTransaction[]): {
    isBot: boolean;
    botConfidence: number;
    tradingStyle: 'scalper' | 'swing' | 'arbitrageur' | 'holder' | 'unknown';
  } {
    if (transactions.length < 5) {
      return { isBot: false, botConfidence: 0, tradingStyle: 'unknown' };
    }

    // Bot detection
    const botAnalysis = this.detectBotBehavior(_transactions);

    // Trading style classification
    const tradingStyle = this.classifyTradingStyle(_transactions);

    return {
      isBot: botAnalysis.isBot,
      botConfidence: botAnalysis.confidence,
      tradingStyle
    };
  }

  /**
   * Analyze behavioral patterns
   */
  private analyzeBehavior(transactions: GalaScanTransaction[]): {
    activityScore: number;
    consistencyScore: number;
    adaptabilityScore: number;
    marketTimingScore: number;
    preferredTokens: Array<{ token: string; percentage: number }>;
  } {
    // Activity score based on recent transactions
    const now = Date.now();
    const recentTx = transactions.filter(tx =>
      (now - tx.timestamp.getTime()) < (7 * 24 * 60 * 60 * 1000) // Last 7 days
    );
    const activityScore = Math.min(100, (recentTx.length / transactions.length) * 100);

    // Consistency score based on trade pattern regularity
    const intervals = this.calculateTradingIntervals(_transactions);
    const avgInterval = intervals.reduce((sum, int) => sum + int, 0) / intervals.length;
    const intervalVariance = intervals.reduce((sum, int) => sum + Math.pow(int - avgInterval, 2), 0) / intervals.length;
    const consistencyScore = Math.max(0, 100 - ((Math.sqrt(intervalVariance) / avgInterval) * 50));

    // Adaptability score (placeholder - would need market condition data)
    const adaptabilityScore = 70;

    // Market timing score (simplified)
    const marketTimingScore = this.calculateMarketTimingScore(_transactions);

    // Preferred tokens
    const preferredTokens = this.calculatePreferredTokens(_transactions);

    return {
      activityScore,
      consistencyScore,
      adaptabilityScore,
      marketTimingScore,
      preferredTokens
    };
  }

  /**
   * Analyze market timing patterns
   */
  private analyzeMarketTiming(transactions: GalaScanTransaction[]): MarketTimingAnalysis {
    // Group by hour ranges
    const hourlyPerformance = new Map<string, { trades: number; profits: number[] }>();

    for (const tx of transactions) {
      if (!tx.swapData) continue;

      const hour = tx.timestamp.getHours();
      const hourRange = `${hour}-${hour + 1}`;

      if (!hourlyPerformance.has(hourRange)) {
        hourlyPerformance.set(hourRange, { trades: 0, profits: [] });
      }

      const performance = hourlyPerformance.get(hourRange)!;
      performance.trades++;
      performance.profits.push(this.calculateTradeProfit(tx));
    }

    const timeRangePerformance = Array.from(hourlyPerformance.entries()).map(([hours, data]) => ({
      hours,
      trades: data.trades,
      successRate: data.profits.filter(p => p > 0).length / data.profits.length * 100,
      averageProfit: data.profits.reduce((sum, p) => sum + p, 0) / data.profits.length
    }));

    // Day of week analysis (simplified)
    const dayOfWeekPerformance = [
      { day: 'Monday', trades: 10, successRate: 65, averageProfit: 50 },
      { day: 'Tuesday', trades: 12, successRate: 70, averageProfit: 60 },
      // ... would be calculated from actual data
    ];

    // Volatility timing
    const volatilityTiming = {
      prefersHighVol: false, // Would be calculated
      optimalVolatilityRange: [0.02, 0.08] as [number, number]
    };

    return {
      timeRangePerformance,
      dayOfWeekPerformance,
      volatilityTiming
    };
  }

  /**
   * Assess suitability for copy-trading
   */
  private assessCopyTradingSuitability(transactions: GalaScanTransaction[]): {
    followWorthiness: number;
    copyTradingRisk: 'low' | 'medium' | 'high';
    recommendedCopySize: number;
    copyTradingNotes: string[];
  } {
    const notes = [];
    let followWorthiness = 5;

    if (transactions.length === 0) {
      return {
        followWorthiness: 0,
        copyTradingRisk: 'high',
        recommendedCopySize: 0,
        copyTradingNotes: ['No trading history available']
      };
    }

    // Calculate profitability
    const profitability = this.calculateQuickSuccessRate(_transactions);
    if (profitability >= 70) {
      followWorthiness += 3;
      notes.push('High profitability');
    } else if (profitability <= 40) {
      followWorthiness -= 2;
      notes.push('Low profitability');
    }

    // Volume consistency
    const volume = this.calculateTotalVolume(_transactions);
    if (volume >= 10000) {
      followWorthiness += 2;
      notes.push('High volume trader');
    }

    // Risk assessment
    let riskLevel: 'low' | 'medium' | 'high' = 'medium';
    if (followWorthiness >= 8) riskLevel = 'low';
    else if (followWorthiness <= 4) riskLevel = 'high';

    // Recommended copy size
    let recommendedCopySize = 1; // 1% default
    if (followWorthiness >= 8) recommendedCopySize = 2; // 2% for excellent traders
    if (riskLevel === 'high') recommendedCopySize = 0.5; // 0.5% for risky traders

    return {
      followWorthiness: Math.max(0, Math.min(10, followWorthiness)),
      copyTradingRisk: riskLevel,
      recommendedCopySize,
      copyTradingNotes: notes
    };
  }

  /**
   * Analyze institutional/guild patterns
   */
  private async analyzeInstitutionalPatterns(transactions: GalaScanTransaction[]): Promise<{
    institutionalProbability: number;
    guildTreasuryLikelihood: number;
    estimatedEntitySize: number;
  }> {
    let institutionalProbability = 0;
    let guildTreasuryLikelihood = 0;

    // Large, systematic trades suggest institutional behavior
    const largeTrades = transactions.filter(tx =>
      tx.swapData && tx.swapData.amountIn > 5000
    ).length;

    if (largeTrades > transactions.length * 0.3) {
      institutionalProbability += 0.3;
    }

    // Regular trading patterns
    const intervals = this.calculateTradingIntervals(_transactions);
    const regularityScore = this.calculateRegularityScore(intervals);
    if (regularityScore > 0.7) {
      institutionalProbability += 0.2;
      guildTreasuryLikelihood += 0.3;
    }

    // Multi-token portfolio suggests guild treasury
    const uniqueTokens = new Set();
    transactions.forEach(tx => {
      if (tx.swapData) {
        uniqueTokens.add(tx.swapData._tokenIn);
        uniqueTokens.add(tx.swapData._tokenOut);
      }
    });

    if (uniqueTokens.size > 5) {
      guildTreasuryLikelihood += 0.4;
    }

    // Estimate entity size (very rough)
    const estimatedEntitySize = Math.max(1, Math.floor(
      (transactions.length / 30) * (1 + institutionalProbability)
    ));

    return {
      institutionalProbability: Math.min(1, institutionalProbability),
      guildTreasuryLikelihood: Math.min(1, guildTreasuryLikelihood),
      estimatedEntitySize
    };
  }

  /**
   * Helper methods
   */
  private calculateTotalVolume(transactions: GalaScanTransaction[]): number {
    return transactions
      .filter(tx => tx.swapData)
      .reduce((sum, tx) => sum + this.estimateTradeValueUSD(tx.swapData!), 0);
  }

  private calculateQuickSuccessRate(transactions: GalaScanTransaction[]): number {
    const successfulTrades = transactions.filter(tx => tx.status === 'success').length;
    return transactions.length > 0 ? (successfulTrades / transactions.length) * 100 : 0;
  }

  private calculateQuickRiskScore(transactions: GalaScanTransaction[]): number {
    // Simplified risk calculation based on slippage
    const avgSlippage = transactions
      .filter(tx => tx.swapData?.slippage)
      .reduce((sum, tx) => sum + tx.swapData!.slippage, 0) / transactions.length;

    return Math.min(10, Math.max(1, avgSlippage * 100)); // Convert slippage to 1-10 scale
  }

  private calculateTradeProfit(tx: GalaScanTransaction): number {
    if (!tx.swapData) return 0;

    const { amountIn, _amountOut, _tokenIn, _tokenOut, slippage } = tx.swapData;

    // Estimate profit based on slippage and gas costs
    let estimatedProfit = 0;

    // Positive slippage means better execution than expected
    if (slippage < 0) {
      estimatedProfit = Math.abs(slippage) * amountIn;
    } else {
      // Negative for worse execution
      estimatedProfit = -slippage * amountIn;
    }

    // Subtract gas costs
    estimatedProfit -= (tx.gasFee || this.GAS_COSTS.swap);

    return estimatedProfit;
  }

  private estimateTradeValueUSD(swapData: unknown): number {
    // Rough USD estimation for volume calculation
    const { amountIn, tokenIn } = swapData;

    const tokenPrices: Record<string, number> = {
      'GALA': 0.02,
      'GUSDC': 1.0,
      'ETIME': 0.05,
      'SILK': 0.01
    };

    return amountIn * (tokenPrices[tokenIn] || 0.01);
  }

  private calculateMaxDrawdown(runningPnL: number[]): number {
    let maxDrawdown = 0;
    let peak = runningPnL[0] || 0;

    for (const pnl of runningPnL) {
      if (pnl > peak) {
        peak = pnl;
      } else {
        const drawdown = ((peak - pnl) / Math.abs(peak)) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }
    }

    return maxDrawdown;
  }

  private detectBotBehavior(transactions: GalaScanTransaction[]): { isBot: boolean; confidence: number } {
    let botScore = 0;
    const features = [];

    // Regular intervals
    const intervals = this.calculateTradingIntervals(_transactions);
    const regularityScore = this.calculateRegularityScore(intervals);
    if (regularityScore > 0.8) {
      botScore += 0.3;
      features.push('regular intervals');
    }

    // Consistent trade sizes
    const tradeSizes = transactions
      .filter(tx => tx.swapData)
      .map(tx => tx.swapData!.amountIn);
    const sizeConsistency = this.calculateConsistencyScore(tradeSizes);
    if (sizeConsistency > 0.8) {
      botScore += 0.3;
      features.push('consistent sizes');
    }

    // No human-like pauses
    const hasLongPauses = intervals.some(interval => interval > 24 * 60 * 60 * 1000); // >24 hours
    if (!hasLongPauses && transactions.length > 10) {
      botScore += 0.2;
      features.push('no long pauses');
    }

    // Precise timing
    const secondsVariance = transactions
      .map(tx => tx.timestamp.getSeconds())
      .reduce((sum, s, i, arr) => sum + Math.pow(s - (arr.reduce((a, b) => a + b) / arr.length), 2), 0) / transactions.length;

    if (secondsVariance < 100) { // Very consistent second timing
      botScore += 0.2;
      features.push('precise timing');
    }

    return {
      isBot: botScore >= this.config.botDetectionThreshold,
      confidence: Math.min(1, botScore)
    };
  }

  private classifyTradingStyle(transactions: GalaScanTransaction[]): 'scalper' | 'swing' | 'arbitrageur' | 'holder' | 'unknown' {
    if (transactions.length < 5) return 'unknown';

    const avgTradeSize = this.calculateTotalVolume(_transactions) / transactions.length;
    const intervals = this.calculateTradingIntervals(_transactions);
    const avgInterval = intervals.reduce((sum, int) => sum + int, 0) / intervals.length / (60 * 60 * 1000); // Hours

    // Classification logic
    if (avgInterval < 1 && avgTradeSize < 1000) return 'scalper';
    if (avgInterval > 24 && avgTradeSize > 5000) return 'swing';
    if (avgInterval < 6 && avgTradeSize > 1000) return 'arbitrageur';
    if (transactions.length < 20 && avgInterval > 72) return 'holder';

    return 'unknown';
  }

  private calculateTradingIntervals(transactions: GalaScanTransaction[]): number[] {
    if (transactions.length < 2) return [];

    const sorted = transactions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const intervals = [];

    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime());
    }

    return intervals;
  }

  private calculateRegularityScore(intervals: number[]): number {
    if (intervals.length === 0) return 0;

    const avgInterval = intervals.reduce((sum, int) => sum + int, 0) / intervals.length;
    const variance = intervals.reduce((sum, int) => sum + Math.pow(int - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    return Math.max(0, 1 - (stdDev / avgInterval));
  }

  private calculateConsistencyScore(values: number[]): number {
    if (values.length === 0) return 0;

    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return Math.max(0, 1 - (stdDev / avg));
  }

  private calculateMarketTimingScore(_transactions: GalaScanTransaction[]): number {
    // Simplified market timing score
    // Real implementation would consider market volatility and price movements
    return 60; // Placeholder
  }

  private calculatePreferredTokens(transactions: GalaScanTransaction[]): Array<{ token: string; percentage: number }> {
    const tokenCounts = new Map<string, number>();

    transactions.forEach(tx => {
      if (tx.swapData) {
        tokenCounts.set(tx.swapData._tokenIn, (tokenCounts.get(tx.swapData._tokenIn) || 0) + 1);
        tokenCounts.set(tx.swapData._tokenOut, (tokenCounts.get(tx.swapData._tokenOut) || 0) + 1);
      }
    });

    const totalCount = Array.from(tokenCounts.values()).reduce((sum, count) => sum + count, 0);

    return Array.from(tokenCounts.entries())
      .map(([token, count]) => ({
        token,
        percentage: (count / totalCount) * 100
      }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5); // Top 5 tokens
  }

  private async findCorrelatedAddresses(_address: string, _transactions: GalaScanTransaction[]): Promise<string[]> {
    // Simplified correlation detection
    // Real implementation would analyze:
    // - Similar trading patterns
    // - Synchronized transactions
    // - Shared counterparties

    return []; // Placeholder
  }

  private async detectSuspiciousActivity(_transactions: GalaScanTransaction[]): Promise<{
    sandwichAttacks: number;
    frontRunning: number;
    unusualPatterns: number;
  }> {
    // Simplified suspicious activity detection
    // Real implementation would analyze:
    // - Sandwich attack patterns
    // - Front-running behavior
    // - Unusual transaction sequences

    return {
      sandwichAttacks: 0,
      frontRunning: 0,
      unusualPatterns: 0
    };
  }

  private calculateRankingScore(analysis: WalletAnalysis): number {
    let score = 0;

    // Profitability (40% weight)
    score += (analysis.profitabilityScore / 100) * 40;

    // Follow-worthiness (30% weight)
    score += (analysis.followWorthiness / 10) * 30;

    // Risk (20% weight, inverted)
    score += ((10 - analysis.riskScore) / 10) * 20;

    // Activity (10% weight)
    score += (analysis.activityScore / 100) * 10;

    return Math.round(score);
  }

  private assessDataQuality(transactions: GalaScanTransaction[]): 'high' | 'medium' | 'low' {
    if (transactions.length >= 100) return 'high';
    if (transactions.length >= 20) return 'medium';
    return 'low';
  }

  private createEmptyAnalysis(address: string): WalletAnalysis {
    return {
      address,
      analysisTimestamp: new Date(),
      dataQuality: 'low',
      sampleSize: 0,

      totalTrades: 0,
      totalVolume: 0,
      averageTradeSize: 0,
      tradesPerDay: 0,
      monthlyVolume: 0,

      profitabilityScore: 50,
      estimatedPnL: 0,
      winRate: 0,
      averageWinSize: 0,
      averageLossSize: 0,
      profitFactor: 1,

      riskScore: 5,
      maxDrawdown: 0,
      volatilityScore: 50,
      liquidityImpact: 0,

      isBot: false,
      botConfidence: 0,
      tradingStyle: 'unknown',
      preferredTimeRanges: [],
      preferredTokens: [],

      activityScore: 0,
      consistencyScore: 50,
      adaptabilityScore: 50,
      marketTimingScore: 50,

      followWorthiness: 0,
      copyTradingRisk: 'high',
      recommendedCopySize: 0,
      copyTradingNotes: ['No trading history available'],

      correlatedAddresses: [],
      suspiciousActivity: {
        sandwichAttacks: 0,
        frontRunning: 0,
        unusualPatterns: 0
      },

      institutionalProbability: 0,
      guildTreasuryLikelihood: 0,
      estimatedEntitySize: 1
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.analysisCache.clear();
    logger.debug('Wallet analyzer cache cleared');
  }

  /**
   * Get service statistics
   */
  getStats(): {
    cacheSize: number;
    totalAnalyses: number;
    cacheHitRate: number;
  } {
    return {
      cacheSize: this.analysisCache.size,
      totalAnalyses: this.analysisCache.size, // Approximation
      cacheHitRate: 0.85 // Would track actual hit rate
    };
  }
}

/**
 * Create a wallet analyzer with default configuration
 */
export function createWalletAnalyzer(config?: Partial<WalletAnalyzerConfig>): WalletAnalyzer {
  return new WalletAnalyzer(config);
}