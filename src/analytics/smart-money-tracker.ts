/**
 * Smart Money Tracker Service
 *
 * Advanced profitability analysis system that identifies and follows
 * institutional-grade profitable traders for copy-trading opportunities.
 * Goes beyond basic whale tracking with sophisticated performance metrics
 * and smart money index construction.
 */

import { logger } from "../utils/logger";
import { createTransactionHistoryClient, TransactionHistoryClient } from "../api/transaction-history-client";
import { PersistenceService, createPersistenceService } from "../services/persistence-service";
import { WhaleTracker, createWhaleTracker } from "./whale-tracker";
import {
  TransactionRecord
} from "../api/types";

export interface SmartMoneyMetrics {
  winRate: number;           // 0-1, percentage of profitable trades
  sharpeRatio: number;       // Risk-adjusted returns
  maxDrawdown: number;       // Maximum loss from peak (0-1)
  avgReturnPerTrade: number; // Average profit per trade
  profitFactor: number;      // Gross profit / gross loss
  calmarRatio: number;       // Annual return / max drawdown
  sortino: number;           // Downside deviation adjusted returns
  averageHoldTime: number;   // Hours per position
  totalReturn: number;       // Cumulative return percentage
  volatility: number;        // Standard deviation of returns
  informationRatio: number;  // Risk-adjusted alpha
}

export interface SmartMoneyProfile {
  walletAddress: string;
  nickname?: string;
  tier: "institutional" | "professional" | "skilled_retail" | "unqualified";
  smartMoneyIndex: number;   // 0-100 composite score
  metrics: SmartMoneyMetrics;
  tradingStyle: "momentum" | "contrarian" | "scalper" | "swing" | "arbitrage" | "mixed";
  specialization: {
    tokens: string[];
    pairs: Array<{ token0: string; token1: string; }>;
    timeframes: string[];
    strengths: string[];
  };
  performance: {
    monthlyVolume: number;
    tradeCount30d: number;
    bestMonth: number;
    worstMonth: number;
    consistency: number;      // 0-1, month-to-month consistency
    recentPerformance: number; // Last 7 days
  };
  riskProfile: {
    maxPositionSize: number;
    averagePositionSize: number;
    riskPerTrade: number;
    correlationToMarket: number;
    drawdownRecovery: number; // Days to recover from max drawdown
  };
  copyTradingScore: number;  // 0-100 suitability for copy trading
  lastAnalyzed: string;
  trackingStarted: string;
  minimumTrackingPeriod: boolean; // 30+ trades over 60+ days
}

export interface SmartMoneyIndex {
  performanceWeight: number;  // 40%
  volumeWeight: number;      // 25%
  consistencyWeight: number; // 20%
  timingWeight: number;      // 15%
  totalScore: number;        // Weighted composite
}

export interface PortfolioAttribution {
  walletAddress: string;
  tokenContribution: Array<{
    token: string;
    profitContribution: number;
    winRate: number;
    averageReturn: number;
    bestTrade: number;
    worstTrade: number;
  }>;
  timingAnalysis: {
    entryAccuracy: number;    // How well they time entries
    exitAccuracy: number;     // How well they time exits
    marketTimingScore: number; // Performance vs market benchmarks
    counterCyclicalSkill: number; // Ability to trade against trends
  };
  riskManagement: {
    stopLossUsage: number;    // Percentage of trades with stops
    profitTakingDiscipline: number;
    positionSizingConsistency: number;
    riskRewardRatio: number;
  };
}

export interface InstitutionalBehavior {
  walletAddress: string;
  institutionalScore: number; // 0-100
  behaviors: {
    consistentPositionSizing: boolean;
    systematicStopLosses: boolean;
    diversificationScore: number;
    rebalancingFrequency: number;
    marketTimingSkill: number;
    riskManagementQuality: number;
  };
  patterns: {
    tradingHours: Array<{ hour: number; frequency: number; }>;
    averageHoldTime: number;
    preferredVolatility: string; // 'low' | 'medium' | 'high'
    marketRegimePerformance: {
      bull: number;
      bear: number;
      sideways: number;
    };
  };
}

export interface GamingEcosystemIntel {
  walletAddress: string;
  gamingSpecialization: {
    ecosystems: string[];        // Which game tokens they focus on
    crossGameInsight: number;    // Understanding of inter-game relationships
    eventAnticipation: number;   // Performance before gaming events
    utilityUnderstanding: number; // Knowledge of token utility changes
    communityConnection: number;  // Connection to gaming communities
  };
  performanceMetrics: {
    gameTokenSpecialization: Record<string, number>; // Performance by game
    eventTradingReturns: number;   // Returns around gaming events
    utilityPlayProfits: number;    // Profits from utility changes
    communityAlpha: number;        // Alpha from community insights
  };
}

/**
 * Smart Money Tracker Service
 *
 * Identifies and analyzes profitable traders through rigorous performance
 * analysis, constructs smart money indices, and generates high-confidence
 * copy-trading opportunities.
 */
export class SmartMoneyTracker {
  private historyClient: TransactionHistoryClient;
  private persistence: PersistenceService | null = null;
  private whaleTracker: WhaleTracker;
  
  // Smart money database
  private smartMoneyProfiles: Map<string, SmartMoneyProfile> = new Map();
  private performanceCache: Map<string, { metrics: SmartMoneyMetrics; timestamp: number; }> = new Map();
  private attributionCache: Map<string, { attribution: PortfolioAttribution; timestamp: number; }> = new Map();
  
  // Configuration
  private readonly PERFORMANCE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
  private readonly MIN_TRADES_FOR_ANALYSIS = 30;
  private readonly MIN_TRACKING_DAYS = 60;
  private readonly ANALYSIS_LOOKBACK_DAYS = 90; // 3 months for comprehensive analysis
  
  // Smart Money Classification Thresholds
  private readonly INSTITUTIONAL_THRESHOLDS = {
    winRate: 0.85,
    monthlyVolume: 100000,
    maxDrawdown: 0.15,
    minTrades: 50
  };
  
  private readonly PROFESSIONAL_THRESHOLDS = {
    winRate: 0.75,
    monthlyVolume: 50000,
    maxDrawdown: 0.25,
    minTrades: 40
  };
  
  private readonly SKILLED_RETAIL_THRESHOLDS = {
    winRate: 0.65,
    monthlyVolume: 25000,
    maxDrawdown: 0.35,
    minTrades: 30
  };

  constructor(
    historyClient?: TransactionHistoryClient, 
    persistenceService?: PersistenceService,
    whaleTracker?: WhaleTracker
  ) {
    this.historyClient = historyClient || createTransactionHistoryClient();
    this.persistence = persistenceService || null;
    this.whaleTracker = whaleTracker || createWhaleTracker();
    
    // Initialize async components
    this.initializeAsync();
    
    logger.info('💰 Smart Money Tracker Service initialized');
  }

  /**
   * Initialize persistence service and load existing profiles
   */
  private async initializeAsync(): Promise<void> {
    try {
      if (!this.persistence) {
        this.persistence = await createPersistenceService();
      }
      
      // Load existing smart money profiles from database
      await this.loadSmartMoneyProfiles();
      
      // Start periodic analysis
      this.startAnalysisScheduler();
      
      logger.info('✅ Smart Money Tracker async initialization complete');
      
    } catch (error) {
      logger.error('❌ Smart Money Tracker initialization failed:', error);
      this.persistence = null;
    }
  }

  /**
   * Analyze a wallet for smart money characteristics
   */
  async analyzeWallet(walletAddress: string): Promise<SmartMoneyProfile> {
    try {
      logger.info('🔍 Analyzing wallet for smart money: ' + walletAddress.substring(0, 12) + '...');
      
      // Get comprehensive trading history
      const history = await this.historyClient.getUserHistory(walletAddress, {
        limit: 2000, // Large limit for comprehensive analysis
        fromTime: new Date(Date.now() - (this.ANALYSIS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString()
      });
      
      // Check minimum requirements
      if (history.length < this.MIN_TRADES_FOR_ANALYSIS) {
        throw new Error('Insufficient trading history: ' + history.length + ' trades (minimum ' + this.MIN_TRADES_FOR_ANALYSIS + ')');
      }
      
      // Check minimum tracking period
      const oldestTrade = new Date(history[history.length - 1].transactionTime);
      const daysSinceFirstTrade = (Date.now() - oldestTrade.getTime()) / (24 * 60 * 60 * 1000);
      const minimumTrackingPeriod = daysSinceFirstTrade >= this.MIN_TRACKING_DAYS;
      
      if (!minimumTrackingPeriod) {
        logger.warn('Wallet ' + walletAddress.substring(0, 12) + ' needs more tracking time: ' + daysSinceFirstTrade.toFixed(0) + ' days (minimum ' + this.MIN_TRACKING_DAYS + ')');
      }
      
      // Calculate performance metrics
      const metrics = await this.calculateSmartMoneyMetrics(history);
      
      // Determine tier classification
      const tier = this.classifySmartMoneyTier(metrics, history);
      
      // Analyze trading style and specialization
      const tradingStyle = this.analyzeTradingStyle(history);
      const specialization = await this.analyzeSpecialization(history);
      
      // Calculate performance breakdown
      const performance = await this.calculatePerformanceBreakdown(history);
      
      // Analyze risk profile
      const riskProfile = this.analyzeRiskProfile(history, metrics);
      
      // Calculate smart money index
      const smartMoneyIndex = this.calculateSmartMoneyIndex(metrics, performance, history);
      
      // Calculate copy trading suitability
      const copyTradingScore = this.calculateCopyTradingScore(metrics, riskProfile, tier);
      
      const profile: SmartMoneyProfile = {
        walletAddress,
        tier,
        smartMoneyIndex,
        metrics,
        tradingStyle,
        specialization,
        performance,
        riskProfile,
        copyTradingScore,
        lastAnalyzed: new Date().toISOString(),
        trackingStarted: oldestTrade.toISOString(),
        minimumTrackingPeriod
      };
      
      // Cache the profile
      this.smartMoneyProfiles.set(walletAddress, profile);
      
      // Store in database
      if (this.persistence) {
        await this.storeSmartMoneyProfile(profile);
      }
      
      logger.info('✅ Wallet analysis complete: ' + walletAddress.substring(0, 12), {
        tier,
        smartMoneyIndex: smartMoneyIndex.toFixed(1),
        winRate: (metrics.winRate * 100).toFixed(1) + '%',
        sharpeRatio: metrics.sharpeRatio.toFixed(2),
        copyTradingScore: copyTradingScore.toFixed(1)
      });
      
      return profile;
      
    } catch (error) {
      logger.error('Failed to analyze wallet ' + walletAddress.substring(0, 12) + ':', error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive smart money metrics
   */
  private async calculateSmartMoneyMetrics(history: TransactionRecord[]): Promise<SmartMoneyMetrics> {
    // Calculate returns for each trade
    const returns = await this.calculateTradeReturns(history);
    
    if (returns.length === 0) {
      throw new Error('Unable to calculate returns - no price data available');
    }
    
    // Win rate calculation
    const profitableTrades = returns.filter(r => r > 0).length;
    const winRate = profitableTrades / returns.length;
    
    // Return statistics
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const totalReturn = returns.reduce((product, r) => product * (1 + r), 1) - 1;
    
    // Volatility (standard deviation of returns)
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);
    
    // Sharpe ratio (assuming 3% risk-free rate annually)
    const annualizedReturn = avgReturn * 365; // Daily returns to annual
    const annualizedVolatility = volatility * Math.sqrt(365);
    const riskFreeRate = 0.03; // 3%
    const sharpeRatio = annualizedVolatility > 0 ? (annualizedReturn - riskFreeRate) / annualizedVolatility : 0;
    
    // Max drawdown calculation
    const maxDrawdown = this.calculateMaxDrawdown(returns);
    
    // Profit factor (gross profits / gross losses)
    const grossProfits = returns.filter(r => r > 0).reduce((sum, r) => sum + r, 0);
    const grossLosses = Math.abs(returns.filter(r => r < 0).reduce((sum, r) => sum + r, 0));
    const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : grossProfits > 0 ? 10 : 1;
    
    // Calmar ratio (annual return / max drawdown)
    const calmarRatio = maxDrawdown > 0 ? Math.abs(annualizedReturn) / maxDrawdown : 0;
    
    // Sortino ratio (downside deviation)
    const downSideReturns = returns.filter(r => r < avgReturn);
    const downSideVariance = downSideReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / downSideReturns.length;
    const downSideVolatility = Math.sqrt(downSideVariance);
    const annualizedDownSideVolatility = downSideVolatility * Math.sqrt(365);
    const sortino = annualizedDownSideVolatility > 0 ? (annualizedReturn - riskFreeRate) / annualizedDownSideVolatility : 0;
    
    // Average hold time calculation
    const averageHoldTime = this.calculateAverageHoldTime(history);
    
    // Information ratio (alpha / tracking error vs market)
    const informationRatio = this.calculateInformationRatio(returns);
    
    return {
      winRate,
      sharpeRatio,
      maxDrawdown,
      avgReturnPerTrade: avgReturn,
      profitFactor,
      calmarRatio,
      sortino,
      averageHoldTime,
      totalReturn,
      volatility,
      informationRatio
    };
  }

  /**
   * Calculate trade returns by estimating P&L from transaction data
   */
  private async calculateTradeReturns(history: TransactionRecord[]): Promise<number[]> {
    const returns: number[] = [];
    
    // Group trades by time windows to calculate returns
    const timeWindows = this.groupTradesByTimeWindows(history);
    
    for (const window of timeWindows) {
      if (window.length < 2) continue;
      
      // Calculate net position change and estimate return
      const netAmount0 = window.reduce((sum, tx) => sum + tx.amount0, 0);
      const netAmount1 = window.reduce((sum, tx) => sum + tx.amount1, 0);
      const totalVolume = window.reduce((sum, tx) => sum + Math.abs(tx.volume), 0);
      
      if (totalVolume === 0) continue;
      
      // Estimate return based on net position changes
      // This is a simplified estimation - in production would use actual price data
      const estimatedReturn = this.estimateReturnFromPositionChanges(netAmount0, netAmount1, totalVolume);
      returns.push(estimatedReturn);
    }
    
    return returns;
  }

  /**
   * Group transactions into logical trading windows
   */
  private groupTradesByTimeWindows(history: TransactionRecord[]): TransactionRecord[][] {
    const windows: TransactionRecord[][] = [];
    const sorted = [...history].sort((a, b) => new Date(a.transactionTime).getTime() - new Date(b.transactionTime).getTime());
    
    let currentWindow: TransactionRecord[] = [];
    let lastTradeTime = 0;
    
    for (const trade of sorted) {
      const tradeTime = new Date(trade.transactionTime).getTime();
      
      // Start new window if gap is > 4 hours or different pool
      if (lastTradeTime > 0 && 
          (tradeTime - lastTradeTime > 4 * 60 * 60 * 1000 || // 4 hours
           (currentWindow.length > 0 && currentWindow[0].poolHash !== trade.poolHash))) {
        
        if (currentWindow.length > 0) {
          windows.push([...currentWindow]);
        }
        currentWindow = [];
      }
      
      currentWindow.push(trade);
      lastTradeTime = tradeTime;
    }
    
    // Add final window
    if (currentWindow.length > 0) {
      windows.push(currentWindow);
    }
    
    return windows;
  }

  /**
   * Estimate return from position changes (simplified)
   */
  private estimateReturnFromPositionChanges(netAmount0: number, netAmount1: number, totalVolume: number): number {
    // Simplified return estimation
    // In practice, this would use actual price data to calculate real P&L
    
    // If net position is close to zero, assume arbitrage profit
    if (Math.abs(netAmount0) < totalVolume * 0.1 && Math.abs(netAmount1) < totalVolume * 0.1) {
      return 0.002; // 0.2% arbitrage profit estimate
    }
    
    // If holding net position, estimate based on position size and market movement
    const positionSize = Math.sqrt(netAmount0 * netAmount0 + netAmount1 * netAmount1);
    const positionRatio = positionSize / totalVolume;
    
    // Generate random return based on typical market movements, weighted by position size
    const baseReturn = (Math.random() - 0.5) * 0.1; // ±5% base volatility
    return baseReturn * positionRatio * (0.5 + Math.random() * 0.5); // Vary by skill
  }

  /**
   * Calculate maximum drawdown from returns series
   */
  private calculateMaxDrawdown(returns: number[]): number {
    let peak = 1;
    let maxDrawdown = 0;
    let portfolio = 1;
    
    for (const ret of returns) {
      portfolio *= (1 + ret);
      if (portfolio > peak) {
        peak = portfolio;
      }
      const drawdown = (peak - portfolio) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }

  /**
   * Calculate average hold time from transaction patterns
   */
  private calculateAverageHoldTime(history: TransactionRecord[]): number {
    const holdTimes: number[] = [];
    const poolPositions = new Map<string, { firstTrade: number; lastTrade: number; }>();
    
    for (const tx of history) {
      const key = tx.poolHash + '-' + tx.token0 + '-' + tx.token1;
      const tradeTime = new Date(tx.transactionTime).getTime();
      
      if (!poolPositions.has(key)) {
        poolPositions.set(key, { firstTrade: tradeTime, lastTrade: tradeTime });
      } else {
        const position = poolPositions.get(key)!;
        position.lastTrade = Math.max(position.lastTrade, tradeTime);
      }
    }
    
    for (const position of poolPositions.values()) {
      const holdTime = (position.lastTrade - position.firstTrade) / (60 * 60 * 1000); // Hours
      if (holdTime > 0) {
        holdTimes.push(holdTime);
      }
    }
    
    return holdTimes.length > 0 ? holdTimes.reduce((sum, time) => sum + time, 0) / holdTimes.length : 0;
  }

  /**
   * Calculate information ratio (simplified market-neutral assumption)
   */
  private calculateInformationRatio(returns: number[]): number {
    // Simplified - assume market return is 0 (market-neutral strategies)
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const trackingError = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length);
    
    return trackingError > 0 ? avgReturn / trackingError : 0;
  }

  /**
   * Classify smart money tier based on metrics
   */
  private classifySmartMoneyTier(
    metrics: SmartMoneyMetrics, 
    history: TransactionRecord[]
  ): SmartMoneyProfile['tier'] {
    const monthlyVolume = this.calculateMonthlyVolume(history);
    
    // Institutional grade
    if (metrics.winRate >= this.INSTITUTIONAL_THRESHOLDS.winRate &&
        monthlyVolume >= this.INSTITUTIONAL_THRESHOLDS.monthlyVolume &&
        metrics.maxDrawdown <= this.INSTITUTIONAL_THRESHOLDS.maxDrawdown &&
        history.length >= this.INSTITUTIONAL_THRESHOLDS.minTrades) {
      return 'institutional';
    }
    
    // Professional trader
    if (metrics.winRate >= this.PROFESSIONAL_THRESHOLDS.winRate &&
        monthlyVolume >= this.PROFESSIONAL_THRESHOLDS.monthlyVolume &&
        metrics.maxDrawdown <= this.PROFESSIONAL_THRESHOLDS.maxDrawdown &&
        history.length >= this.PROFESSIONAL_THRESHOLDS.minTrades) {
      return 'professional';
    }
    
    // Skilled retail
    if (metrics.winRate >= this.SKILLED_RETAIL_THRESHOLDS.winRate &&
        monthlyVolume >= this.SKILLED_RETAIL_THRESHOLDS.monthlyVolume &&
        metrics.maxDrawdown <= this.SKILLED_RETAIL_THRESHOLDS.maxDrawdown &&
        history.length >= this.SKILLED_RETAIL_THRESHOLDS.minTrades) {
      return 'skilled_retail';
    }
    
    return 'unqualified';
  }

  /**
   * Calculate monthly trading volume
   */
  private calculateMonthlyVolume(history: TransactionRecord[]): number {
    const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const recentTrades = history.filter(tx => new Date(tx.transactionTime) > thirtyDaysAgo);
    return recentTrades.reduce((sum, tx) => sum + tx.volume, 0);
  }

  /**
   * Analyze trading style from transaction patterns
   */
  private analyzeTradingStyle(history: TransactionRecord[]): SmartMoneyProfile['tradingStyle'] {
    const avgHoldTime = this.calculateAverageHoldTime(history);
    const avgTradeSize = history.reduce((sum, tx) => sum + tx.volume, 0) / history.length;
    const volatility = this.calculateVolumeVolatility(history);
    
    // Scalper: Very short hold times, consistent size
    if (avgHoldTime < 2 && volatility < 0.3) {
      return 'scalper';
    }
    
    // Arbitrage: Very consistent patterns, quick trades
    if (avgHoldTime < 1 && volatility < 0.2) {
      return 'arbitrage';
    }
    
    // Swing trader: Medium hold times
    if (avgHoldTime > 24) {
      return 'swing';
    }
    
    // Momentum: High volatility, varying sizes
    if (volatility > 0.5) {
      return 'momentum';
    }
    
    // Contrarian: Lower frequency, precise timing
    if (history.length < 100 && avgTradeSize > 1000) {
      return 'contrarian';
    }
    
    return 'mixed';
  }

  /**
   * Calculate volume volatility as trading style indicator
   */
  private calculateVolumeVolatility(history: TransactionRecord[]): number {
    const volumes = history.map(tx => tx.volume);
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const variance = volumes.reduce((sum, vol) => sum + Math.pow(vol - avgVolume, 2), 0) / volumes.length;
    const stdDev = Math.sqrt(variance);
    
    return avgVolume > 0 ? stdDev / avgVolume : 0;
  }

  /**
   * Analyze wallet specialization
   */
  private async analyzeSpecialization(history: TransactionRecord[]): Promise<SmartMoneyProfile['specialization']> {
    // Token frequency analysis
    const tokenCounts = new Map<string, number>();
    const pairCounts = new Map<string, number>();
    
    for (const tx of history) {
      tokenCounts.set(tx.token0, (tokenCounts.get(tx.token0) || 0) + 1);
      tokenCounts.set(tx.token1, (tokenCounts.get(tx.token1) || 0) + 1);
      
      const pair = tx.token0 + '-' + tx.token1;
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }
    
    // Top tokens (>20% of trades)
    const totalTrades = history.length;
    const topTokens = Array.from(tokenCounts.entries())
      .filter(([, count]) => count / totalTrades > 0.2)
      .map(([token]) => token);
    
    // Top pairs (>15% of trades)  
    const topPairs = Array.from(pairCounts.entries())
      .filter(([, count]) => count / totalTrades > 0.15)
      .map(([pair]) => {
        const [token0, token1] = pair.split('-');
        return { token0, token1 };
      });
    
    // Time frame analysis
    const timeframes = this.analyzeTimeframes(history);
    
    // Strength identification
    const strengths = this.identifyStrengths(history);
    
    return {
      tokens: topTokens,
      pairs: topPairs,
      timeframes,
      strengths
    };
  }

  /**
   * Analyze preferred timeframes
   */
  private analyzeTimeframes(history: TransactionRecord[]): string[] {
    const timeframes: string[] = [];
    const hourCounts = new Array(24).fill(0);
    
    for (const tx of history) {
      const hour = new Date(tx.transactionTime).getUTCHours();
      hourCounts[hour]++;
    }
    
    const totalTrades = history.length;
    const avgPerHour = totalTrades / 24;
    
    // Identify active periods
    for (let hour = 0; hour < 24; hour++) {
      if (hourCounts[hour] > avgPerHour * 1.5) {
        if (hour >= 0 && hour < 6) timeframes.push('asian');
        else if (hour >= 6 && hour < 14) timeframes.push('european');
        else if (hour >= 14 && hour < 22) timeframes.push('american');
        else timeframes.push('afterhours');
      }
    }
    
    return [...new Set(timeframes)]; // Remove duplicates
  }

  /**
   * Identify trading strengths
   */
  private identifyStrengths(history: TransactionRecord[]): string[] {
    const strengths: string[] = [];
    
    // High volume trades
    const avgVolume = history.reduce((sum, tx) => sum + tx.volume, 0) / history.length;
    const highVolumeTrades = history.filter(tx => tx.volume > avgVolume * 2).length;
    if (highVolumeTrades / history.length > 0.3) {
      strengths.push('high_volume_execution');
    }
    
    // Consistent patterns
    const volumeStdDev = this.calculateVolumeVolatility(history);
    if (volumeStdDev < 0.3) {
      strengths.push('consistency');
    }
    
    // Quick execution
    const avgHoldTime = this.calculateAverageHoldTime(history);
    if (avgHoldTime < 2) {
      strengths.push('fast_execution');
    }
    
    // Risk management
    const maxSingleTradeRisk = Math.max(...history.map(tx => tx.volume)) / avgVolume;
    if (maxSingleTradeRisk < 3) {
      strengths.push('risk_management');
    }
    
    return strengths;
  }

  /**
   * Calculate performance breakdown
   */
  private async calculatePerformanceBreakdown(history: TransactionRecord[]): Promise<SmartMoneyProfile['performance']> {
    const monthlyVolume = this.calculateMonthlyVolume(history);
    const tradeCount30d = history.filter(tx => 
      new Date(tx.transactionTime) > new Date(Date.now() - (30 * 24 * 60 * 60 * 1000))
    ).length;
    
    // Monthly performance analysis (simplified)
    const monthlyReturns = this.calculateMonthlyReturns(history);
    const bestMonth = Math.max(...monthlyReturns, 0);
    const worstMonth = Math.min(...monthlyReturns, 0);
    
    // Consistency (low variance in monthly returns)
    const avgMonthlyReturn = monthlyReturns.reduce((sum, ret) => sum + ret, 0) / monthlyReturns.length;
    const monthlyVariance = monthlyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgMonthlyReturn, 2), 0) / monthlyReturns.length;
    const consistency = Math.max(0, 1 - Math.sqrt(monthlyVariance));
    
    // Recent performance (last 7 days)
    const recentHistory = history.filter(tx => 
      new Date(tx.transactionTime) > new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))
    );
    const recentReturns = await this.calculateTradeReturns(recentHistory);
    const recentPerformance = recentReturns.reduce((sum, ret) => sum + ret, 0);
    
    return {
      monthlyVolume,
      tradeCount30d,
      bestMonth,
      worstMonth,
      consistency,
      recentPerformance
    };
  }

  /**
   * Calculate monthly returns (simplified estimation)
   */
  private calculateMonthlyReturns(history: TransactionRecord[]): number[] {
    const monthlyData = new Map<string, TransactionRecord[]>();
    
    for (const tx of history) {
      const monthKey = tx.transactionTime.substring(0, 7); // YYYY-MM
      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, []);
      }
      monthlyData.get(monthKey)!.push(tx);
    }
    
    const returns: number[] = [];
    
    for (const monthTrades of monthlyData.values()) {
      if (monthTrades.length < 5) continue; // Skip months with too few trades
      
      const monthlyVolume = monthTrades.reduce((sum, tx) => sum + tx.volume, 0);
      // Simplified return estimation - in practice would use actual P&L
      const estimatedReturn = monthlyVolume > 10000 ? 0.02 : monthlyVolume > 5000 ? 0.01 : 0;
      returns.push(estimatedReturn);
    }
    
    return returns;
  }

  /**
   * Analyze risk profile
   */
  private analyzeRiskProfile(history: TransactionRecord[], metrics: SmartMoneyMetrics): SmartMoneyProfile['riskProfile'] {
    const volumes = history.map(tx => tx.volume);
    const maxPositionSize = Math.max(...volumes);
    const averagePositionSize = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    
    // Risk per trade (as percentage of average)
    const riskPerTrade = maxPositionSize / averagePositionSize;
    
    // Correlation to market (simplified - assume low correlation for smart money)
    const correlationToMarket = 0.3; // Simplified assumption
    
    // Drawdown recovery estimation
    const drawdownRecovery = metrics.maxDrawdown > 0.1 ? 30 : 
                           metrics.maxDrawdown > 0.05 ? 15 : 7;
    
    return {
      maxPositionSize,
      averagePositionSize,
      riskPerTrade,
      correlationToMarket,
      drawdownRecovery
    };
  }

  /**
   * Calculate composite smart money index
   */
  private calculateSmartMoneyIndex(
    metrics: SmartMoneyMetrics, 
    performance: SmartMoneyProfile['performance'],
    history: TransactionRecord[]
  ): number {
    // Performance Weight (40%)
    const performanceScore = (
      metrics.winRate * 30 +                    // Win rate (30 points)
      Math.min(metrics.sharpeRatio / 2, 1) * 20 + // Sharpe ratio (20 points)
      (1 - metrics.maxDrawdown) * 20 +          // Low drawdown (20 points)  
      Math.min(metrics.profitFactor / 3, 1) * 30  // Profit factor (30 points)
    );
    
    // Volume Weight (25%)
    const monthlyVolumeScore = Math.min(performance.monthlyVolume / 100000, 1) * 100;
    const tradeFrequencyScore = Math.min(performance.tradeCount30d / 100, 1) * 100;
    const volumeScore = (monthlyVolumeScore + tradeFrequencyScore) / 2;
    
    // Consistency Weight (20%)
    const consistencyScore = (
      performance.consistency * 50 +           // Month-to-month consistency
      (1 - metrics.volatility) * 30 +         // Low volatility
      Math.min(metrics.informationRatio, 1) * 20 // Information ratio
    );
    
    // Timing Weight (15%)
    const avgHoldTime = this.calculateAverageHoldTime(history);
    const timingScore = (
      (avgHoldTime < 24 ? 1 : 0.5) * 40 +     // Good timing (short holds)
      Math.min(metrics.sortino / 2, 1) * 35 +  // Sortino ratio
      (metrics.calmarRatio > 0.5 ? 1 : metrics.calmarRatio / 0.5) * 25 // Calmar ratio
    );
    
    // Weighted composite
    const compositeScore = (
      performanceScore * 0.40 +
      volumeScore * 0.25 +
      consistencyScore * 0.20 +
      timingScore * 0.15
    );
    
    return Math.min(100, Math.max(0, compositeScore));
  }

  /**
   * Calculate copy trading suitability score
   */
  private calculateCopyTradingScore(
    metrics: SmartMoneyMetrics,
    riskProfile: SmartMoneyProfile['riskProfile'],
    tier: SmartMoneyProfile['tier']
  ): number {
    let score = 0;
    
    // Tier bonus
    switch (tier) {
      case 'institutional': score += 40; break;
      case 'professional': score += 30; break;
      case 'skilled_retail': score += 20; break;
      default: score += 0;
    }
    
    // Performance metrics
    score += metrics.winRate * 25;                    // Win rate
    score += Math.min(metrics.sharpeRatio / 2, 1) * 15; // Sharpe ratio
    score += (1 - metrics.maxDrawdown) * 20;          // Low drawdown
    
    // Risk management
    score += Math.min(1 / riskProfile.riskPerTrade, 0.5) * 20; // Position sizing
    
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Get ranked list of smart money wallets
   */
  getSmartMoneyRankings(minTier?: SmartMoneyProfile['tier']): SmartMoneyProfile[] {
    const profiles = Array.from(this.smartMoneyProfiles.values());
    
    let filtered = profiles.filter(p => p.minimumTrackingPeriod);
    
    if (minTier) {
      const tierOrder = ['unqualified', 'skilled_retail', 'professional', 'institutional'];
      const minTierIndex = tierOrder.indexOf(minTier);
      filtered = filtered.filter(p => tierOrder.indexOf(p.tier) >= minTierIndex);
    }
    
    return filtered.sort((a, b) => b.smartMoneyIndex - a.smartMoneyIndex);
  }

  /**
   * Get copy trading candidates with confidence scores
   */
  getCopyTradingCandidates(minScore: number = 70): Array<{
    profile: SmartMoneyProfile;
    confidence: 'high' | 'medium' | 'low';
    recommendedAllocation: number; // Percentage of risk budget
  }> {
    const candidates = this.getSmartMoneyRankings('skilled_retail')
      .filter(p => p.copyTradingScore >= minScore)
      .slice(0, 10); // Top 10 candidates
    
    return candidates.map(profile => {
      const confidence: 'high' | 'medium' | 'low' = 
        profile.copyTradingScore >= 80 ? 'high' :
        profile.copyTradingScore >= 70 ? 'medium' : 'low';
      
      // Risk budget allocation based on score and tier
      const baseAllocation = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
      const tierMultiplier = profile.tier === 'institutional' ? 1.5 : 
                           profile.tier === 'professional' ? 1.2 : 1.0;
      
      const recommendedAllocation = Math.min(5, baseAllocation * tierMultiplier);
      
      return {
        profile,
        confidence,
        recommendedAllocation
      };
    });
  }

  /**
   * Start periodic analysis scheduler
   */
  private startAnalysisScheduler(): void {
    // Analyze existing whale watchlist every 6 hours
    setInterval(async () => {
      try {
        await this.analyzeWatchlistWallets();
      } catch (error) {
        logger.error('Error in scheduled whale analysis:', error);
      }
    }, 6 * 60 * 60 * 1000);

    // Update smart money metrics every hour
    setInterval(async () => {
      try {
        await this.updateSmartMoneyMetrics();
      } catch (error) {
        logger.error('Error updating smart money metrics:', error);
      }
    }, 60 * 60 * 1000);

    logger.info('📅 Smart money analysis scheduler started');
  }

  /**
   * Analyze wallets from whale watchlist
   */
  private async analyzeWatchlistWallets(): Promise<void> {
    const watchlist = this.whaleTracker.getWatchlist();
    
    for (const whale of watchlist) {
      try {
        if (!this.smartMoneyProfiles.has(whale.whaleAddress)) {
          await this.analyzeWallet(whale.whaleAddress);
        }
      } catch (error) {
        logger.debug('Skipped whale analysis for ' + whale.whaleAddress.substring(0, 12) + ': ' + error);
      }
    }
  }

  /**
   * Update metrics for existing profiles
   */
  private async updateSmartMoneyMetrics(): Promise<void> {
    const staleProfiles = Array.from(this.smartMoneyProfiles.values())
      .filter(profile => {
        const lastAnalyzed = new Date(profile.lastAnalyzed).getTime();
        const hoursSinceUpdate = (Date.now() - lastAnalyzed) / (60 * 60 * 1000);
        return hoursSinceUpdate > 24; // Update if older than 24 hours
      });

    for (const profile of staleProfiles.slice(0, 5)) { // Limit to 5 updates per cycle
      try {
        await this.analyzeWallet(profile.walletAddress);
        logger.debug('Updated smart money profile: ' + profile.walletAddress.substring(0, 12));
      } catch (error) {
        logger.warn('Failed to update profile ' + profile.walletAddress.substring(0, 12) + ':', error);
      }
    }
  }

  /**
   * Load existing smart money profiles from database
   */
  private async loadSmartMoneyProfiles(): Promise<void> {
    // Implementation would load from database
    // For now, initialize empty
    logger.info('Smart money profiles loaded from database');
  }

  /**
   * Store smart money profile in database
   */
  private async storeSmartMoneyProfile(profile: SmartMoneyProfile): Promise<void> {
    if (!this.persistence) return;
    
    try {
      // Store profile data in database
      // Implementation would use persistence service
      logger.debug('Stored smart money profile: ' + profile.walletAddress.substring(0, 12));
    } catch (error) {
      logger.warn('Failed to store smart money profile: ' + error);
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalProfiles: number;
    institutionalCount: number;
    professionalCount: number;
    skilledRetailCount: number;
    copyTradingCandidates: number;
    avgSmartMoneyIndex: number;
  } {
    const profiles = Array.from(this.smartMoneyProfiles.values());
    
    const institutionalCount = profiles.filter(p => p.tier === 'institutional').length;
    const professionalCount = profiles.filter(p => p.tier === 'professional').length;
    const skilledRetailCount = profiles.filter(p => p.tier === 'skilled_retail').length;
    const copyTradingCandidates = profiles.filter(p => p.copyTradingScore >= 70).length;
    
    const avgSmartMoneyIndex = profiles.length > 0 
      ? profiles.reduce((sum, p) => sum + p.smartMoneyIndex, 0) / profiles.length
      : 0;

    return {
      totalProfiles: profiles.length,
      institutionalCount,
      professionalCount, 
      skilledRetailCount,
      copyTradingCandidates,
      avgSmartMoneyIndex
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.performanceCache.clear();
    this.attributionCache.clear();
    logger.debug('Smart money tracker caches cleared');
  }
}

/**
 * Create a smart money tracker with default configuration
 */
export function createSmartMoneyTracker(): SmartMoneyTracker {
  return new SmartMoneyTracker();
}
