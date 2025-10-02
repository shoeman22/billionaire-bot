/**
 * Strategy Orchestrator
 *
 * Intelligent strategy selection and execution system:
 * - Dynamically selects optimal strategies based on market conditions
 * - Manages strategy priority and resource allocation
 * - Implements performance-based strategy weighting
 * - Provides unified interface for all trading strategies
 *
 * Key Features:
 * - Real-time strategy performance monitoring
 * - Adaptive capital allocation across strategies
 * - Risk-adjusted strategy selection
 * - Market condition-based strategy switching
 * - Comprehensive strategy analytics
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { VolumeAnalyzer } from '../../monitoring/volume-analyzer';
import { RiskMonitor } from '../risk/risk-monitor';
import { poolDiscovery } from '../../services/pool-discovery';

// Import all strategies
import { ArbitrageStrategy } from './arbitrage';
import { SmartArbitrageStrategy } from './smart-arbitrage';
import { TriangleArbitrageStrategy } from './triangle-arbitrage';
import { StablecoinArbitrageStrategy } from './stablecoin-arbitrage';
import { CrossAssetMomentumStrategy } from './cross-asset-momentum';
import { MultiPathArbitrageStrategy } from './multi-path-arbitrage';
import { StatisticalArbitrageStrategy } from './statistical-arbitrage';
import { TimeBasedPatternsStrategy } from './time-based-patterns';
import { VolumeMomentumStrategy } from './volume-momentum';
import { EventArbitrageStrategy } from './event-arbitrage';
import { NFTArbitrageStrategy } from './nft-arbitrage';

export interface StrategyConfig {
  name: string;
  enabled: boolean;
  priority: number; // 1-10, higher is better
  maxCapitalAllocation: number; // % of total capital
  riskTolerance: 'low' | 'medium' | 'high';
  marketConditions: ('bull' | 'bear' | 'sideways' | 'volatile' | 'stable')[];
  minProfitThreshold: number; // Minimum profit % to execute
  cooldownPeriod: number; // MS between executions
  maxConcurrentTrades: number;
}

export interface StrategyPerformance {
  name: string;
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  winRate: number;
  avgProfitPerTrade: number;
  avgExecutionTime: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  capitalAllocated: number;
  lastExecutionTime: number;
  activeTrades: number;
  riskScore: number; // 0-1
  performanceScore: number; // 0-100
}

export interface MarketCondition {
  trend: 'bull' | 'bear' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
  liquidity: 'low' | 'medium' | 'high';
  volume: 'low' | 'medium' | 'high';
  sentiment: 'bullish' | 'bearish' | 'neutral';
  riskLevel: 'low' | 'medium' | 'high';
}

export interface OrchestratorStats {
  totalCapital: number;
  allocatedCapital: number;
  availableCapital: number;
  totalProfit: number;
  dailyProfit: number;
  totalTrades: number;
  activeTrades: number;
  bestPerformingStrategy: string;
  worstPerformingStrategy: string;
  avgExecutionTime: number;
  overallWinRate: number;
  portfolioSharpe: number;
  riskAdjustedReturn: number;
}

export class StrategyOrchestrator {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private isActive: boolean = false;
  private volumeAnalyzer: VolumeAnalyzer;
  private riskMonitor: RiskMonitor;

  // Strategy instances
  private strategies: Map<string, any> = new Map();
  private strategyConfigs: Map<string, StrategyConfig> = new Map();
  private strategyPerformance: Map<string, StrategyPerformance> = new Map();

  // Market analysis
  private currentMarketCondition: MarketCondition = {
    trend: 'sideways',
    volatility: 'medium',
    liquidity: 'medium',
    volume: 'medium',
    sentiment: 'neutral',
    riskLevel: 'medium'
  };

  // Capital management
  private totalCapital: number = 50000; // $50k total capital
  private maxRiskPercentage: number = 5; // 5% max risk per strategy
  private rebalanceInterval: number = 300000; // 5 minutes

  // Execution control
  private orchestrationTimer: NodeJS.Timeout | null = null;
  private lastRebalanceTime: number = 0;
  private globalCooldown: number = 15000; // 15 second global cooldown
  private lastGlobalExecution: number = 0;

  // Performance tracking
  private stats: OrchestratorStats = {
    totalCapital: 50000,
    allocatedCapital: 0,
    availableCapital: 50000,
    totalProfit: 0,
    dailyProfit: 0,
    totalTrades: 0,
    activeTrades: 0,
    bestPerformingStrategy: '',
    worstPerformingStrategy: '',
    avgExecutionTime: 0,
    overallWinRate: 0,
    portfolioSharpe: 0,
    riskAdjustedReturn: 0
  };

  constructor(
    gswap: GSwap,
    config: TradingConfig,
    swapExecutor: SwapExecutor,
    marketAnalysis: MarketAnalysis,
    volumeAnalyzer: VolumeAnalyzer,
    riskMonitor: RiskMonitor
  ) {
    this.gswap = gswap;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.marketAnalysis = marketAnalysis;

    this.volumeAnalyzer = volumeAnalyzer;
    this.riskMonitor = riskMonitor;
    this.initializeStrategies();
    this.initializeStrategyConfigs();

    logger.info('Strategy Orchestrator initialized', {
      totalStrategies: this.strategies.size,
      totalCapital: this.totalCapital,
      rebalanceInterval: this.rebalanceInterval,
      globalCooldown: this.globalCooldown
    });
  }

  /**
   * Initialize all strategy instances
   */
  private initializeStrategies(): void {
    // Basic arbitrage
    this.strategies.set('arbitrage', new ArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Smart learning arbitrage
    this.strategies.set('smart-arbitrage', new SmartArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Triangle arbitrage
    this.strategies.set('triangle-arbitrage', new TriangleArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Stablecoin arbitrage
    this.strategies.set('stablecoin-arbitrage', new StablecoinArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Cross-asset momentum
    this.strategies.set('cross-asset-momentum', new CrossAssetMomentumStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Multi-path arbitrage (advanced)
    this.strategies.set('multi-path-arbitrage', new MultiPathArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Statistical arbitrage (pairs trading)
    this.strategies.set('statistical-arbitrage', new StatisticalArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Time-based patterns strategy
    this.strategies.set('time-based-patterns', new TimeBasedPatternsStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // Volume Momentum Strategy - Gaming token momentum trading
    this.strategies.set('volume-momentum', new VolumeMomentumStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis,
      this.volumeAnalyzer, this.riskMonitor
    ));

    // Event Arbitrage Strategy - Gaming event-driven trading
    this.strategies.set('event-arbitrage', new EventArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis
    ));

    // NFT Arbitrage Strategy - Gaming NFT floor price arbitrage
    this.strategies.set('nft-arbitrage', new NFTArbitrageStrategy(
      this.gswap, this.config, this.swapExecutor, this.marketAnalysis, this.riskMonitor
    ));

    logger.info(`Initialized ${this.strategies.size} trading strategies`);
  }

  /**
   * Initialize strategy configurations
   */
  private initializeStrategyConfigs(): void {
    // Basic Arbitrage - Reliable, medium profit
    this.strategyConfigs.set('arbitrage', {
      name: 'Basic Arbitrage',
      enabled: true,
      priority: 6,
      maxCapitalAllocation: 20, // 20% max
      riskTolerance: 'low',
      marketConditions: ['bull', 'bear', 'sideways'],
      minProfitThreshold: 0.3, // 0.3% minimum
      cooldownPeriod: 30000, // 30 seconds
      maxConcurrentTrades: 3
    });

    // Smart Arbitrage - Learning system, adaptive
    this.strategyConfigs.set('smart-arbitrage', {
      name: 'Smart Learning Arbitrage',
      enabled: true,
      priority: 8,
      maxCapitalAllocation: 30,
      riskTolerance: 'medium',
      marketConditions: ['bull', 'bear', 'sideways', 'volatile'],
      minProfitThreshold: 0.4,
      cooldownPeriod: 45000,
      maxConcurrentTrades: 2
    });

    // Triangle Arbitrage - High profit potential, higher complexity
    this.strategyConfigs.set('triangle-arbitrage', {
      name: 'Triangle Arbitrage',
      enabled: true,
      priority: 9, // Highest priority due to profit potential
      maxCapitalAllocation: 25,
      riskTolerance: 'medium',
      marketConditions: ['volatile', 'bull', 'bear'],
      minProfitThreshold: 0.5, // Higher threshold due to complexity
      cooldownPeriod: 60000,
      maxConcurrentTrades: 1
    });

    // Stablecoin Arbitrage - Low risk, consistent profits
    this.strategyConfigs.set('stablecoin-arbitrage', {
      name: 'Stablecoin Arbitrage',
      enabled: true,
      priority: 7,
      maxCapitalAllocation: 40, // Largest allocation due to low risk
      riskTolerance: 'low',
      marketConditions: ['stable', 'sideways', 'bear'],
      minProfitThreshold: 0.02, // Very low threshold
      cooldownPeriod: 10000, // Fast execution
      maxConcurrentTrades: 5
    });

    // Cross-Asset Momentum - Experimental, high risk/reward
    this.strategyConfigs.set('cross-asset-momentum', {
      name: 'Cross-Asset Momentum',
      enabled: false, // Disabled by default until proven
      priority: 5,
      maxCapitalAllocation: 15,
      riskTolerance: 'high',
      marketConditions: ['volatile', 'bull', 'bear'],
      minProfitThreshold: 1.0, // High threshold for experimental strategy
      cooldownPeriod: 120000, // 2 minute cooldown
      maxConcurrentTrades: 2
    });

    // Multi-Path Arbitrage - Advanced arbitrage with highest profit potential
    this.strategyConfigs.set('multi-path-arbitrage', {
      name: 'Multi-Path Arbitrage',
      enabled: true,
      priority: 10, // Highest priority due to advanced profit potential
      maxCapitalAllocation: 35, // Large allocation for high-value opportunities
      riskTolerance: 'medium',
      marketConditions: ['volatile', 'bull', 'bear', 'sideways'],
      minProfitThreshold: 2.0, // Higher threshold for multi-hop complexity
      cooldownPeriod: 90000, // 90 second cooldown for complex execution
      maxConcurrentTrades: 1 // Single execution due to complexity
});
    // Statistical Arbitrage - Pairs trading with mean reversion
    this.strategyConfigs.set('statistical-arbitrage', {
      name: 'Statistical Arbitrage',
      enabled: true,
      priority: 8, // High priority for proven statistical methods
      maxCapitalAllocation: 20, // Moderate allocation for pairs trading
      riskTolerance: 'medium',
      marketConditions: ['bull', 'bear', 'sideways', 'volatile'], // Works in all conditions
      minProfitThreshold: 2.0, // 2% minimum for statistical significance
      cooldownPeriod: 30000, // 30 second cooldown
      maxConcurrentTrades: 5 // Multiple pairs can trade simultaneously
    });

    // Time-Based Patterns - Gaming ecosystem pattern exploitation
    this.strategyConfigs.set('time-based-patterns', {
      name: 'Time-Based Patterns',
      enabled: true,
      priority: 7, // High priority for proven gaming patterns
      maxCapitalAllocation: 15, // Conservative allocation for time-based strategy
      riskTolerance: 'medium',
      marketConditions: ['bull', 'bear', 'sideways', 'volatile'], // Works in all conditions
      minProfitThreshold: 1.5, // 1.5% minimum for pattern-based trades
      cooldownPeriod: 1800000, // 30 minute cooldown (patterns need time to develop)
      maxConcurrentTrades: 3 // Multiple patterns can be active simultaneously
    });

    // Volume Momentum Strategy - Gaming token momentum trading
    this.strategyConfigs.set('volume-momentum', {
      name: 'Volume Momentum',
      enabled: true,
      priority: 8, // High priority for momentum trading
      maxCapitalAllocation: 12, // 12% max (matches strategy limit)
      riskTolerance: 'medium',
      marketConditions: ['bull', 'bear', 'volatile'], // Momentum works in trending/volatile markets
      minProfitThreshold: 5.0, // 5% minimum for momentum plays
      cooldownPeriod: 30000, // 30 second cooldown
      maxConcurrentTrades: 2 // Matches strategy MAX_CONCURRENT_POSITIONS
    });

    // Event Arbitrage Strategy - Gaming event-driven arbitrage trading
    this.strategyConfigs.set('event-arbitrage', {
      name: 'Event Arbitrage',
      enabled: true,
      priority: 9, // High priority for predictable event patterns
      maxCapitalAllocation: 15, // 15% max (matches strategy limit)
      riskTolerance: 'medium',
      marketConditions: ['bull', 'bear', 'sideways', 'volatile'], // Works in all conditions
      minProfitThreshold: 3.0, // 3% minimum for event-driven trades
      cooldownPeriod: 14400000, // 4 hour cooldown (events need time to develop)
      maxConcurrentTrades: 4 // Multiple event positions can be active
    });

    // NFT Arbitrage Strategy - Gaming NFT floor price arbitrage
    this.strategyConfigs.set('nft-arbitrage', {
      name: 'NFT Floor Price Arbitrage',
      enabled: true,
      priority: 8, // High priority for unique gaming NFT opportunities
      maxCapitalAllocation: 10, // 10% max (matches strategy MAX_TOTAL_NFT_EXPOSURE)
      riskTolerance: 'high', // NFT markets are inherently high risk
      marketConditions: ['bull', 'bear', 'sideways', 'volatile'], // Works in all conditions with different strategies
      minProfitThreshold: 10.0, // 10% minimum for NFT arbitrage (matches strategy MIN_PROFIT_THRESHOLD)
      cooldownPeriod: 300000, // 5 minute cooldown (matches strategy scanInterval)
      maxConcurrentTrades: 3 // Matches strategy MAX_CONCURRENT_POSITIONS
    });

    // Initialize performance tracking for each strategy
    for (const [name, config] of this.strategyConfigs.entries()) {
      this.strategyPerformance.set(name, {
        name: config.name,
        totalTrades: 0,
        successfulTrades: 0,
        totalProfit: 0,
        winRate: 0,
        avgProfitPerTrade: 0,
        avgExecutionTime: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        currentDrawdown: 0,
        capitalAllocated: 0,
        lastExecutionTime: 0,
        activeTrades: 0,
        riskScore: this.calculateBaseRiskScore(config),
        performanceScore: 50 // Start at neutral
      });
    }
  }

  /**
   * Initialize pool discovery for all strategies
   */
  private async initializePoolDiscovery(): Promise<void> {
    logger.info('🔍 Initializing pool discovery for all strategies...');

    try {
      // Pre-fetch pool data once for all strategies
      await poolDiscovery.fetchAllPools();
      const poolsCount = poolDiscovery.getCachedPools().length;
      const tokensCount = poolDiscovery.getAvailableTokens().length;
      const pairsCount = poolDiscovery.getTradingPairs().length;

      logger.info(`✅ Pool discovery initialized: ${poolsCount} pools, ${tokensCount} tokens, ${pairsCount} pairs`);

      // Initialize all strategy instances with pool data
      for (const [strategyName, strategy] of this.strategies) {
        try {
          if (strategy && typeof strategy.initialize === 'function') {
            logger.debug(`Initializing ${strategyName} strategy with pool data...`);
            await strategy.initialize();
          }
        } catch (error) {
          logger.warn(`⚠️  Failed to initialize ${strategyName} strategy:`, error);
          // Don't fail the entire orchestrator if one strategy fails
        }
      }

      logger.info('🎯 All strategies initialized with pool discovery data');

    } catch (error) {
      logger.error('❌ Failed to initialize pool discovery:', error);
      logger.warn('⚠️  Strategies will fallback to hardcoded tokens if needed');
    }
  }

  /**
   * Start the strategy orchestrator
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Strategy Orchestrator is already active');
      return;
    }

    this.isActive = true;
    logger.info('🎯 Starting Strategy Orchestrator');

    // Initialize pool discovery for all strategies
    await this.initializePoolDiscovery();

    // Start market condition monitoring
    this.startMarketAnalysis();

    // Start strategy orchestration
    this.startOrchestration();
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    this.isActive = false;

    if (this.orchestrationTimer) {
      clearTimeout(this.orchestrationTimer);
      this.orchestrationTimer = null;
    }

    // Stop all strategies
    for (const [name, strategy] of this.strategies.entries()) {
      try {
        if (strategy.stop && typeof strategy.stop === 'function') {
          await strategy.stop();
        }
      } catch (error) {
        logger.warn(`Error stopping strategy ${name}`, { error });
      }
    }

    logger.info('🛑 Strategy Orchestrator stopped', {
      stats: this.getStats(),
      finalCapital: this.stats.totalCapital + this.stats.totalProfit
    });
  }

  /**
   * Start market condition analysis
   */
  private startMarketAnalysis(): void {
    const analyzeMarket = async () => {
      if (!this.isActive) return;

      try {
        await this.updateMarketConditions();
      } catch (error) {
        logger.error('Error updating market conditions', { error });
      }

      if (this.isActive) {
        setTimeout(analyzeMarket, 60000); // Update every minute
      }
    };

    analyzeMarket();
  }

  /**
   * Start strategy orchestration loop
   */
  private startOrchestration(): void {
    const orchestrate = async () => {
      if (!this.isActive) return;

      try {
        // Update strategy performance
        await this.updateStrategyPerformance();

        // Rebalance capital allocation if needed
        if (Date.now() - this.lastRebalanceTime > this.rebalanceInterval) {
          await this.rebalanceCapitalAllocation();
          this.lastRebalanceTime = Date.now();
        }

        // Execute strategies based on priority and conditions
        await this.executeStrategies();

        // Update overall stats
        this.updateOverallStats();

      } catch (error) {
        logger.error('Error in strategy orchestration', { error });
      }

      if (this.isActive) {
        this.orchestrationTimer = setTimeout(orchestrate, 30000); // Run every 30 seconds
      }
    };

    orchestrate();
  }

  /**
   * Update market conditions
   */
  private async updateMarketConditions(): Promise<void> {
    try {
      // Use real market analysis instead of random conditions
      const marketCondition = await this.marketAnalysis.analyzeMarket();

      // Map MarketAnalysis format to our internal format
      this.currentMarketCondition = {
        trend: this.mapMarketTrend(marketCondition.overall),
        volatility: this.mapVolatilityLevel(marketCondition.volatility),
        liquidity: this.mapLiquidityLevel(marketCondition.liquidity),
        volume: 'medium', // Default - can be enhanced with volume analysis
        sentiment: this.mapSentimentLevel(marketCondition.sentiment),
        riskLevel: this.calculateRiskLevel(marketCondition)
      };

      logger.debug('Market conditions updated from real analysis', {
        ...this.currentMarketCondition,
        confidence: marketCondition.confidence
      });

    } catch (error) {
      logger.error('Failed to update market conditions', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      // Fallback to conservative defaults if market analysis fails
      this.currentMarketCondition = {
        trend: 'sideways',
        volatility: 'medium',
        liquidity: 'medium',
        volume: 'medium',
        sentiment: 'neutral',
        riskLevel: 'medium'
      };
    }
  }

  /**
   * Map MarketAnalysis trend format to our internal format
   */
  private mapMarketTrend(trend: 'bullish' | 'bearish' | 'sideways' | 'unknown'): 'bull' | 'bear' | 'sideways' {
    switch (trend) {
      case 'bullish': return 'bull';
      case 'bearish': return 'bear';
      case 'sideways': return 'sideways';
      case 'unknown':
      default: return 'sideways';
    }
  }

  /**
   * Map MarketAnalysis volatility format to our internal format
   */
  private mapVolatilityLevel(volatility: 'low' | 'medium' | 'high' | 'extreme'): 'low' | 'medium' | 'high' {
    switch (volatility) {
      case 'low': return 'low';
      case 'medium': return 'medium';
      case 'high':
      case 'extreme': return 'high';
      default: return 'medium';
    }
  }

  /**
   * Map MarketAnalysis liquidity format to our internal format
   */
  private mapLiquidityLevel(liquidity: 'poor' | 'fair' | 'good' | 'excellent'): 'low' | 'medium' | 'high' {
    switch (liquidity) {
      case 'poor': return 'low';
      case 'fair': return 'medium';
      case 'good':
      case 'excellent': return 'high';
      default: return 'medium';
    }
  }

  /**
   * Map MarketAnalysis sentiment format to our internal format
   */
  private mapSentimentLevel(sentiment: 'fearful' | 'cautious' | 'neutral' | 'optimistic' | 'greedy'): 'bullish' | 'bearish' | 'neutral' {
    switch (sentiment) {
      case 'fearful':
      case 'cautious': return 'bearish';
      case 'neutral': return 'neutral';
      case 'optimistic':
      case 'greedy': return 'bullish';
      default: return 'neutral';
    }
  }

  /**
   * Calculate overall risk level based on market conditions
   */
  private calculateRiskLevel(marketCondition: any): 'low' | 'medium' | 'high' {
    const volatilityRisk = marketCondition.volatility === 'extreme' ? 2 :
                          marketCondition.volatility === 'high' ? 1 : 0;
    const liquidityRisk = marketCondition.liquidity === 'poor' ? 2 :
                         marketCondition.liquidity === 'fair' ? 1 : 0;
    const confidenceRisk = marketCondition.confidence < 0.3 ? 2 :
                          marketCondition.confidence < 0.7 ? 1 : 0;

    const totalRisk = volatilityRisk + liquidityRisk + confidenceRisk;

    if (totalRisk >= 4) return 'high';
    if (totalRisk >= 2) return 'medium';
    return 'low';
  }

  /**
   * Update strategy performance metrics
   */
  private async updateStrategyPerformance(): Promise<void> {
    for (const [name, strategy] of this.strategies.entries()) {
      try {
        const performance = this.strategyPerformance.get(name);
        if (!performance) continue;

        // Get stats from strategy (try both getStats and getStatus methods)
        let stats: any = {};
        if (strategy.getStats && typeof strategy.getStats === 'function') {
          stats = strategy.getStats();
        } else if (strategy.getStatus && typeof strategy.getStatus === 'function') {
          const status = strategy.getStatus();
          // Map getStatus() format to expected stats format
          stats = {
            totalTrades: status.opportunities?.executed || 0,
            executedTrades: status.opportunities?.executed || 0,
            successfulTrades: status.opportunities?.successful || 0,
            totalProfit: parseFloat(status.performance?.totalProfit || '0'),
            avgProfitPerTrade: parseFloat(status.performance?.avgProfitPerTrade || '0')
          };
        }

        // Update performance metrics
        performance.totalTrades = stats.totalTrades || stats.executedTrades || performance.totalTrades;
        performance.successfulTrades = stats.successfulTrades || performance.successfulTrades;
        performance.totalProfit = stats.totalProfit || performance.totalProfit;

        if (performance.totalTrades > 0) {
          performance.winRate = (performance.successfulTrades / performance.totalTrades) * 100;
          performance.avgProfitPerTrade = performance.totalProfit / performance.totalTrades;
        }

        performance.avgExecutionTime = stats.avgExecutionTime || performance.avgExecutionTime;

        // Calculate performance score (0-100)
        performance.performanceScore = this.calculatePerformanceScore(performance);

        // Update risk score based on recent performance
        performance.riskScore = this.calculateDynamicRiskScore(performance);

      } catch (error) {
        logger.warn(`Failed to update performance for strategy ${name}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          name
        });
      }
    }
  }

  /**
   * Rebalance capital allocation across strategies
   */
  private async rebalanceCapitalAllocation(): Promise<void> {
    logger.info('🔄 Rebalancing capital allocation...');

    let totalAllocated = 0;

    // Sort strategies by performance score and priority
    const sortedStrategies = Array.from(this.strategyPerformance.entries())
      .sort((a, b) => {
        const configA = this.strategyConfigs.get(a[0]);
        const configB = this.strategyConfigs.get(b[0]);

        if (!configA || !configB) return 0;

        // Combine performance score and priority
        const scoreA = (a[1].performanceScore * 0.7) + (configA.priority * 10 * 0.3);
        const scoreB = (b[1].performanceScore * 0.7) + (configB.priority * 10 * 0.3);

        return scoreB - scoreA;
      });

    // Allocate capital based on performance and market conditions
    for (const [strategyName, performance] of sortedStrategies) {
      const config = this.strategyConfigs.get(strategyName);
      if (!config || !config.enabled) continue;

      // Check if strategy is suitable for current market conditions
      if (!this.isStrategyApplicable(strategyName, this.currentMarketCondition)) continue;

      // Calculate allocation based on performance and limits
      let allocation = this.calculateOptimalAllocation(strategyName, performance);

      // Apply maximum allocation limit
      const maxAllocation = (config.maxCapitalAllocation / 100) * this.totalCapital;
      allocation = Math.min(allocation, maxAllocation);

      // Ensure we don't over-allocate
      if (totalAllocated + allocation > this.totalCapital * 0.9) { // Max 90% allocation
        allocation = Math.max(0, (this.totalCapital * 0.9) - totalAllocated);
      }

      performance.capitalAllocated = allocation;
      totalAllocated += allocation;

      logger.debug(`Allocated $${allocation.toFixed(0)} to ${config.name}`, {
        performanceScore: performance.performanceScore.toFixed(1),
        priority: config.priority,
        winRate: performance.winRate.toFixed(1) + '%'
      });
    }

    this.stats.allocatedCapital = totalAllocated;
    this.stats.availableCapital = this.totalCapital - totalAllocated;

    logger.info('Capital rebalancing complete', {
      totalAllocated: totalAllocated.toFixed(0),
      availableCapital: this.stats.availableCapital.toFixed(0),
      allocationPercentage: ((totalAllocated / this.totalCapital) * 100).toFixed(1) + '%'
    });
  }

  /**
   * Execute strategies based on priority and conditions
   */
  private async executeStrategies(): Promise<void> {
    // Check global cooldown
    if (Date.now() - this.lastGlobalExecution < this.globalCooldown) {
      return;
    }

    // Get enabled strategies sorted by priority
    const enabledStrategies = Array.from(this.strategyConfigs.entries())
      .filter(([name, config]) => config.enabled)
      .sort((a, b) => b[1].priority - a[1].priority);

    for (const [strategyName, config] of enabledStrategies) {
      const performance = this.strategyPerformance.get(strategyName);
      if (!performance || performance.capitalAllocated === 0) continue;

      // Check strategy-specific cooldown
      if (Date.now() - performance.lastExecutionTime < config.cooldownPeriod) continue;

      // Check if strategy is applicable to current market
      if (!this.isStrategyApplicable(strategyName, this.currentMarketCondition)) continue;

      // Check concurrent trade limits
      if (performance.activeTrades >= config.maxConcurrentTrades) continue;

      try {
        // Execute strategy
        const executed = await this.executeStrategy(strategyName);

        if (executed) {
          performance.lastExecutionTime = Date.now();
          this.lastGlobalExecution = Date.now();

          // Only execute one strategy per cycle to avoid conflicts
          break;
        }

      } catch (error) {
        logger.error(`Error executing strategy ${strategyName}`, { error });
      }
    }
  }

  /**
   * Execute a specific strategy
   */
  private async executeStrategy(strategyName: string): Promise<boolean> {
    const strategy = this.strategies.get(strategyName);
    const config = this.strategyConfigs.get(strategyName);

    if (!strategy || !config) return false;

    logger.debug(`Executing strategy: ${config.name}`);

    try {
      // Different strategies have different execution methods
      let result: any = null;

      if (strategy.scanForOpportunities && typeof strategy.scanForOpportunities === 'function') {
        result = await strategy.scanForOpportunities();
      } else if (strategy.execute && typeof strategy.execute === 'function') {
        result = await strategy.execute();
      } else if (strategy.start && typeof strategy.start === 'function') {
        // For strategies that need to be started (like momentum and time-based patterns)
        if (!strategy.isActive && !strategy.getIsActive?.()) {
          await strategy.start();
          return true;
        }
      }

      // Check if execution was successful and profitable
      return result && (Array.isArray(result) ? result.length > 0 : true);

    } catch (error) {
      logger.error(`Strategy ${strategyName} execution failed`, { error });
      return false;
    }
  }

  /**
   * Check if strategy is applicable to current market conditions
   */
  private isStrategyApplicable(strategyName: string, market: MarketCondition): boolean {
    const config = this.strategyConfigs.get(strategyName);
    if (!config) return false;

    // Check if current market trend is in strategy's applicable conditions
    const trendApplicable = config.marketConditions.includes(market.trend);

    // For stable market condition, check if volatility is low
    const stabilityApplicable = config.marketConditions.includes('stable') ?
      market.volatility === 'low' : true;

    // For volatile condition, check if volatility is high
    const volatilityApplicable = config.marketConditions.includes('volatile') ?
      market.volatility === 'high' : true;

    return trendApplicable && stabilityApplicable && volatilityApplicable;
  }

  /**
   * Calculate optimal capital allocation for a strategy
   */
  private calculateOptimalAllocation(strategyName: string, performance: StrategyPerformance): number {
    const config = this.strategyConfigs.get(strategyName);
    if (!config) return 0;

    // Base allocation on performance score
    let baseAllocation = (performance.performanceScore / 100) * (this.totalCapital * 0.2); // Max 20% base

    // Adjust for win rate
    if (performance.winRate > 70) baseAllocation *= 1.3;
    else if (performance.winRate < 30) baseAllocation *= 0.7;

    // Adjust for risk
    const riskAdjustment = 1 - (performance.riskScore * 0.5); // Max 50% reduction for high risk
    baseAllocation *= riskAdjustment;

    // Minimum allocation for enabled strategies
    const minAllocation = this.totalCapital * 0.05; // 5% minimum

    return Math.max(minAllocation, baseAllocation);
  }

  /**
   * Calculate base risk score for a strategy
   */
  private calculateBaseRiskScore(config: StrategyConfig): number {
    let riskScore = 0.3; // Base risk

    // Risk tolerance adjustment
    if (config.riskTolerance === 'low') riskScore *= 0.7;
    else if (config.riskTolerance === 'high') riskScore *= 1.5;

    // Strategy-specific adjustments
    if (config.name.includes('Triangle')) riskScore *= 1.2; // Higher complexity
    if (config.name.includes('Stablecoin')) riskScore *= 0.8; // Lower risk
    if (config.name.includes('Momentum')) riskScore *= 1.4; // Experimental
    if (config.name.includes('NFT')) riskScore *= 1.6; // NFT markets are high risk

    return Math.min(1, riskScore);
  }

  /**
   * Calculate dynamic risk score based on performance
   */
  private calculateDynamicRiskScore(performance: StrategyPerformance): number {
    let riskScore = this.calculateBaseRiskScore(
      this.strategyConfigs.get(performance.name.toLowerCase().replace(/\s+/g, '-')) ||
      { riskTolerance: 'medium' } as StrategyConfig
    );

    // Adjust based on recent performance
    if (performance.winRate > 80) riskScore *= 0.9; // Lower risk for high win rate
    else if (performance.winRate < 40) riskScore *= 1.3; // Higher risk for low win rate

    // Adjust for drawdown
    if (performance.currentDrawdown > 10) riskScore *= 1.5;

    return Math.min(1, riskScore);
  }

  /**
   * Calculate performance score (0-100)
   */
  private calculatePerformanceScore(performance: StrategyPerformance): number {
    let score = 50; // Base score

    // Win rate component (30 points max)
    score += (performance.winRate / 100) * 30;

    // Profit component (25 points max)
    if (performance.avgProfitPerTrade > 0) {
      const profitScore = Math.min(25, performance.avgProfitPerTrade * 5);
      score += profitScore;
    } else {
      score -= 20; // Penalty for losses
    }

    // Trade volume component (15 points max)
    const tradeVolumeScore = Math.min(15, performance.totalTrades * 0.5);
    score += tradeVolumeScore;

    // Risk adjustment (subtract for high risk)
    score -= performance.riskScore * 20;

    // Drawdown penalty
    score -= performance.currentDrawdown * 2;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Update overall orchestrator statistics
   */
  private updateOverallStats(): void {
    let totalTrades = 0;
    let totalProfit = 0;
    let successfulTrades = 0;
    let avgExecutionTime = 0;
    let activeTrades = 0;

    let bestPerformance = 0;
    let worstPerformance = 100;
    let bestStrategy = '';
    let worstStrategy = '';

    for (const [name, performance] of this.strategyPerformance.entries()) {
      totalTrades += performance.totalTrades;
      totalProfit += performance.totalProfit;
      successfulTrades += performance.successfulTrades;
      avgExecutionTime += performance.avgExecutionTime;
      activeTrades += performance.activeTrades;

      if (performance.performanceScore > bestPerformance) {
        bestPerformance = performance.performanceScore;
        bestStrategy = name;
      }

      if (performance.performanceScore < worstPerformance) {
        worstPerformance = performance.performanceScore;
        worstStrategy = name;
      }
    }

    // Update stats
    this.stats.totalTrades = totalTrades;
    this.stats.totalProfit = totalProfit;
    this.stats.activeTrades = activeTrades;
    this.stats.bestPerformingStrategy = bestStrategy;
    this.stats.worstPerformingStrategy = worstStrategy;
    this.stats.overallWinRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
    this.stats.avgExecutionTime = this.strategyPerformance.size > 0 ?
      avgExecutionTime / this.strategyPerformance.size : 0;

    // Calculate risk-adjusted return (simplified Sharpe ratio)
    const avgReturn = totalProfit / this.totalCapital;
    this.stats.riskAdjustedReturn = avgReturn * 100; // Convert to percentage
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): OrchestratorStats {
    return { ...this.stats };
  }

  /**
   * Get strategy performance data
   */
  getStrategyPerformance(): Map<string, StrategyPerformance> {
    return new Map(this.strategyPerformance);
  }

  /**
   * Get current market conditions
   */
  getMarketConditions(): MarketCondition {
    return { ...this.currentMarketCondition };
  }

  /**
   * Enable/disable a strategy
   */
  setStrategyEnabled(strategyName: string, enabled: boolean): void {
    const config = this.strategyConfigs.get(strategyName);
    if (config) {
      config.enabled = enabled;
      logger.info(`Strategy ${strategyName} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Update strategy priority
   */
  setStrategyPriority(strategyName: string, priority: number): void {
    const config = this.strategyConfigs.get(strategyName);
    if (config) {
      config.priority = Math.max(1, Math.min(10, priority));
      logger.info(`Strategy ${strategyName} priority set to ${config.priority}`);
    }
  }

  /**
   * Get strategy configuration
   */
  getStrategyConfig(strategyName: string): StrategyConfig | undefined {
    return this.strategyConfigs.get(strategyName);
  }

  /**
   * Update total capital
   */
  setTotalCapital(capital: number): void {
    this.totalCapital = Math.max(1000, capital); // Minimum $1k
    this.stats.totalCapital = this.totalCapital;
    logger.info(`Total capital updated to $${this.totalCapital}`);
  }
}