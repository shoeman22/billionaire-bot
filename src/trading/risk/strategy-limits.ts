/**
 * Strategy Limits
 * Per-strategy risk limits and allocation rules for enhanced risk management
 *
 * PRODUCTION SYSTEM - PROTECTING REAL $541 USD (34,062 GALA)
 */

import { logger } from '../../utils/logger';
import { safeParseFloat } from '../../utils/safe-parse';

export interface StrategyRiskLimits {
  maxAllocation: number;      // Maximum % of portfolio (0.0-1.0)
  riskBudget: number;         // Risk budget % (0.0-1.0)
  maxDrawdown: number;        // Maximum drawdown % before pause
  cooldownPeriod: number;     // Minimum time between trades (ms)
  maxConcurrentTrades: number; // Maximum concurrent positions
  volatilityLimit: number;    // Pause if volatility exceeds this
  correlationLimit: number;   // Reduce allocation if correlation >this
  emergencyStop: number;      // Emergency stop loss %
  minProfitThreshold: number; // Minimum profit % to execute
  dynamicScaling: boolean;    // Enable performance-based scaling
  riskCategory: 'low' | 'medium' | 'high' | 'extreme';
}

export interface CorrelationMatrix {
  // Gaming token correlations during major events (higher risk)
  eventCorrelations: Record<string, number>;
  // Time-varying correlations (higher during market stress)
  stressCorrelations: Record<string, number>;
  // Strategy correlation (some strategies work better together)
  strategyCorrelations: Record<string, Record<string, number>>;
  // Base correlations under normal conditions
  baseCorrelations: Record<string, Record<string, number>>;
}

export interface VolatilityScaling {
  // Volatility thresholds for position scaling
  thresholds: {
    normal: number;      // 0-25% volatility
    elevated: number;    // 25-50% volatility
    high: number;        // 50-100% volatility
    extreme: number;     // 100-150% volatility
    crisis: number;      // >150% volatility
  };
  // Position size multipliers for each level
  scalingFactors: {
    normal: number;      // 100% position sizing
    elevated: number;    // 75% position sizing
    high: number;        // 50% position sizing
    extreme: number;     // 25% position sizing
    crisis: number;      // All strategies paused except arbitrage
  };
}

export interface DynamicLimitAdjustment {
  // Performance-based adjustments
  performanceMultiplier: number;  // Increase limits for profitable strategies
  drawdownPenalty: number;       // Reduce limits after drawdown
  winRateBonus: number;          // Bonus for high win rate
  recentPerformanceWeight: number; // Weight recent vs historical performance

  // Market condition adjustments
  volatilityAdjustment: number;  // Adjust based on market volatility
  liquidityAdjustment: number;   // Adjust based on liquidity conditions
  eventAdjustment: number;       // Temporary adjustments during gaming events

  // Correlation adjustments
  correlationPenalty: number;    // Reduce limits when strategies are correlated
  diversificationBonus: number;  // Bonus for uncorrelated strategies
}

export interface RiskBudgetDistribution {
  totalRiskBudget: number;       // Total portfolio risk budget (5% of capital)
  allocatedRiskBudget: number;   // Currently allocated risk
  remainingRiskBudget: number;   // Available risk budget
  strategyAllocations: Record<string, number>; // Risk allocated per strategy
  emergencyReserve: number;      // Reserved for emergency situations
}

export class StrategyLimits {
  private readonly PORTFOLIO_VALUE_USD = 541; // Current real portfolio value
  private readonly MAX_DAILY_LOSS_USD = 27.05; // 5% max daily loss
  private readonly MAX_DRAWDOWN_USD = 81.15;   // 15% max drawdown

  // Strategy risk limits configuration
  private readonly strategyLimits: Record<string, StrategyRiskLimits> = {
    // Core Enhancement Strategies (Priority Tier 1)
    'priority-gas-bidding': {
      maxAllocation: 0.02,          // 2% max allocation ($10.82)
      riskBudget: 0.05,             // 5% of risk budget
      maxDrawdown: 0.03,            // 3% max drawdown
      cooldownPeriod: 5000,         // 5 second cooldown
      maxConcurrentTrades: 2,       // 2 max positions
      volatilityLimit: 0.30,        // Pause if volatility >30%
      correlationLimit: 0.40,       // Reduce if correlation >40%
      emergencyStop: 0.10,          // 10% emergency stop
      minProfitThreshold: 0.008,    // 0.8% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'low'
    },

    'multi-path-arbitrage': {
      maxAllocation: 0.15,          // 15% max allocation ($81.15)
      riskBudget: 0.10,             // 10% of risk budget
      maxDrawdown: 0.08,            // 8% max drawdown
      cooldownPeriod: 45000,        // 45 second cooldown
      maxConcurrentTrades: 1,       // 1 max position (complex)
      volatilityLimit: 0.40,        // Pause if volatility >40%
      correlationLimit: 0.50,       // Reduce if correlation >50%
      emergencyStop: 0.15,          // 15% emergency stop
      minProfitThreshold: 0.015,    // 1.5% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'medium'
    },

    // Statistical Strategies (Priority Tier 2)
    'statistical-arbitrage': {
      maxAllocation: 0.20,          // 20% max allocation ($108.20)
      riskBudget: 0.12,             // 12% of risk budget
      maxDrawdown: 0.10,            // 10% max drawdown
      cooldownPeriod: 30000,        // 30 second cooldown
      maxConcurrentTrades: 5,       // 5 max positions (pairs)
      volatilityLimit: 0.50,        // Pause if volatility >50%
      correlationLimit: 0.60,       // Reduce if correlation >60%
      emergencyStop: 0.20,          // 20% emergency stop
      minProfitThreshold: 0.020,    // 2.0% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'medium'
    },

    'time-based-patterns': {
      maxAllocation: 0.15,          // 15% max allocation ($81.15)
      riskBudget: 0.08,             // 8% of risk budget
      maxDrawdown: 0.06,            // 6% max drawdown
      cooldownPeriod: 1800000,      // 30 minute cooldown
      maxConcurrentTrades: 3,       // 3 max positions
      volatilityLimit: 0.35,        // Pause if volatility >35%
      correlationLimit: 0.45,       // Reduce if correlation >45%
      emergencyStop: 0.12,          // 12% emergency stop
      minProfitThreshold: 0.015,    // 1.5% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'medium'
    },

    'volume-momentum': {
      maxAllocation: 0.12,          // 12% max allocation ($64.92)
      riskBudget: 0.10,             // 10% of risk budget
      maxDrawdown: 0.08,            // 8% max drawdown
      cooldownPeriod: 30000,        // 30 second cooldown
      maxConcurrentTrades: 2,       // 2 max positions
      volatilityLimit: 0.60,        // Works in high volatility
      correlationLimit: 0.55,       // Reduce if correlation >55%
      emergencyStop: 0.18,          // 18% emergency stop
      minProfitThreshold: 0.050,    // 5.0% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'medium'
    },

    // On-Chain Intelligence Strategies (Priority Tier 3) - PLACEHOLDER FOR FUTURE
    'whale-tracking': {
      maxAllocation: 0.10,          // 10% max allocation ($54.10)
      riskBudget: 0.08,             // 8% of risk budget
      maxDrawdown: 0.06,            // 6% max drawdown
      cooldownPeriod: 60000,        // 60 second cooldown
      maxConcurrentTrades: 3,       // 3 max positions
      volatilityLimit: 0.45,        // Pause if volatility >45%
      correlationLimit: 0.50,       // Reduce if correlation >50%
      emergencyStop: 0.15,          // 15% emergency stop
      minProfitThreshold: 0.025,    // 2.5% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'medium'
    },

    'liquidity-migration': {
      maxAllocation: 0.12,          // 12% max allocation ($64.92)
      riskBudget: 0.10,             // 10% of risk budget
      maxDrawdown: 0.08,            // 8% max drawdown
      cooldownPeriod: 120000,       // 2 minute cooldown
      maxConcurrentTrades: 2,       // 2 max positions
      volatilityLimit: 0.40,        // Pause if volatility >40%
      correlationLimit: 0.55,       // Reduce if correlation >55%
      emergencyStop: 0.16,          // 16% emergency stop
      minProfitThreshold: 0.030,    // 3.0% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'medium'
    },

    'smart-money-flow': {
      maxAllocation: 0.15,          // 15% max allocation ($81.15)
      riskBudget: 0.10,             // 10% of risk budget
      maxDrawdown: 0.08,            // 8% max drawdown
      cooldownPeriod: 45000,        // 45 second cooldown
      maxConcurrentTrades: 4,       // 4 max positions
      volatilityLimit: 0.50,        // Pause if volatility >50%
      correlationLimit: 0.60,       // Reduce if correlation >60%
      emergencyStop: 0.18,          // 18% emergency stop
      minProfitThreshold: 0.035,    // 3.5% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'medium'
    },

    // Gaming-Specific Strategies (Priority Tier 4)
    'event-arbitrage': {
      maxAllocation: 0.15,          // 15% max allocation ($81.15)
      riskBudget: 0.12,             // 12% of risk budget
      maxDrawdown: 0.10,            // 10% max drawdown
      cooldownPeriod: 14400000,     // 4 hour cooldown
      maxConcurrentTrades: 4,       // 4 max positions
      volatilityLimit: 0.70,        // Works in high volatility events
      correlationLimit: 0.65,       // Reduce if correlation >65%
      emergencyStop: 0.20,          // 20% emergency stop
      minProfitThreshold: 0.030,    // 3.0% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'high'
    },

    'nft-arbitrage': {
      maxAllocation: 0.10,          // 10% max allocation ($54.10)
      riskBudget: 0.15,             // 15% of risk budget (high risk)
      maxDrawdown: 0.12,            // 12% max drawdown
      cooldownPeriod: 300000,       // 5 minute cooldown
      maxConcurrentTrades: 3,       // 3 max positions
      volatilityLimit: 0.80,        // NFT markets are volatile
      correlationLimit: 0.70,       // Reduce if correlation >70%
      emergencyStop: 0.25,          // 25% emergency stop
      minProfitThreshold: 0.100,    // 10.0% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'extreme'
    },

    'cross-game-rotation': {
      maxAllocation: 0.25,          // 25% max allocation ($135.25) - largest
      riskBudget: 0.08,             // 8% of risk budget (diversified)
      maxDrawdown: 0.06,            // 6% max drawdown
      cooldownPeriod: 3600000,      // 60 minute cooldown
      maxConcurrentTrades: 6,       // 6 max positions (diversified)
      volatilityLimit: 0.40,        // Pause if volatility >40%
      correlationLimit: 0.35,       // Low correlation required
      emergencyStop: 0.12,          // 12% emergency stop
      minProfitThreshold: 0.020,    // 2.0% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'low'
    },

    // Existing Basic Strategies (Legacy Support) - ADJUSTED FOR REALISTIC PORTFOLIO
    'arbitrage': {
      maxAllocation: 0.08,          // 8% max allocation ($43.28) - REDUCED
      riskBudget: 0.05,             // 5% of risk budget (low risk)
      maxDrawdown: 0.04,            // 4% max drawdown
      cooldownPeriod: 30000,        // 30 second cooldown
      maxConcurrentTrades: 3,       // 3 max positions
      volatilityLimit: 0.999,       // Always active (safe)
      correlationLimit: 0.999,      // No correlation limits
      emergencyStop: 0.08,          // 8% emergency stop
      minProfitThreshold: 0.003,    // 0.3% minimum profit
      dynamicScaling: false,        // Fixed allocation
      riskCategory: 'low'
    },

    'smart-arbitrage': {
      maxAllocation: 0.12,          // 12% max allocation ($64.92) - REDUCED
      riskBudget: 0.08,             // 8% of risk budget
      maxDrawdown: 0.06,            // 6% max drawdown
      cooldownPeriod: 45000,        // 45 second cooldown
      maxConcurrentTrades: 2,       // 2 max positions
      volatilityLimit: 0.999,       // Always active
      correlationLimit: 0.999,      // No correlation limits
      emergencyStop: 0.10,          // 10% emergency stop
      minProfitThreshold: 0.004,    // 0.4% minimum profit
      dynamicScaling: true,         // Enable scaling
      riskCategory: 'low'
    },

    'stablecoin-arbitrage': {
      maxAllocation: 0.18,          // 18% max allocation ($97.38) - REDUCED
      riskBudget: 0.03,             // 3% of risk budget (very low risk)
      maxDrawdown: 0.02,            // 2% max drawdown
      cooldownPeriod: 10000,        // 10 second cooldown
      maxConcurrentTrades: 5,       // 5 max positions
      volatilityLimit: 0.999,       // Always active (stablecoin)
      correlationLimit: 0.999,      // No correlation limits
      emergencyStop: 0.05,          // 5% emergency stop
      minProfitThreshold: 0.0005,   // 0.05% minimum profit
      dynamicScaling: false,        // Fixed allocation (stable)
      riskCategory: 'low'
    }
  };

  // Correlation matrix for strategy interactions
  private readonly correlationMatrix: CorrelationMatrix = {
    // Gaming event correlations (higher during tournaments, patches)
    eventCorrelations: {
      'event-arbitrage_nft-arbitrage': 0.85,          // Both gaming-focused
      'event-arbitrage_cross-game-rotation': 0.70,    // Both game-dependent
      'volume-momentum_event-arbitrage': 0.60,        // Events drive volume
      'whale-tracking_smart-money-flow': 0.75,        // Similar data sources
      'liquidity-migration_smart-money-flow': 0.65,   // Both on-chain analysis
    },

    // Stress correlations (higher during market crashes)
    stressCorrelations: {
      'statistical-arbitrage_volume-momentum': 0.80,  // Both momentum-based
      'whale-tracking_volume-momentum': 0.70,         // Whales drive volume
      'multi-path-arbitrage_priority-gas-bidding': 0.60, // Both execution-focused
      'time-based-patterns_statistical-arbitrage': 0.65, // Both pattern-based
    },

    // Strategy correlations (inherent relationships)
    strategyCorrelations: {
      'arbitrage': {
        'smart-arbitrage': 0.90,        // Very similar strategies
        'multi-path-arbitrage': 0.75,   // Same core concept
        'stablecoin-arbitrage': 0.70,   // All arbitrage-based
        'statistical-arbitrage': 0.45,  // Different approach
      },
      'volume-momentum': {
        'event-arbitrage': 0.60,        // Events drive volume
        'whale-tracking': 0.70,         // Whales create momentum
        'smart-money-flow': 0.65,       // Money flow affects momentum
      },
      'nft-arbitrage': {
        'event-arbitrage': 0.80,        // Both gaming-focused
        'cross-game-rotation': 0.55,    // Different gaming approaches
      }
    },

    // Base correlations under normal conditions
    baseCorrelations: {
      'priority-gas-bidding': {
        'multi-path-arbitrage': 0.30,   // Both execution-focused
        'statistical-arbitrage': 0.15,  // Minimal correlation
      },
      'statistical-arbitrage': {
        'time-based-patterns': 0.40,    // Both pattern recognition
        'volume-momentum': 0.50,        // Statistical momentum overlap
      }
    }
  };

  // Volatility scaling configuration
  private readonly volatilityScaling: VolatilityScaling = {
    thresholds: {
      normal: 0.25,      // 0-25% volatility
      elevated: 0.50,    // 25-50% volatility
      high: 1.00,        // 50-100% volatility
      extreme: 1.50,     // 100-150% volatility
      crisis: 999.0      // >150% volatility
    },
    scalingFactors: {
      normal: 1.00,      // 100% position sizing
      elevated: 0.75,    // 75% position sizing
      high: 0.50,        // 50% position sizing
      extreme: 0.25,     // 25% position sizing
      crisis: 0.05       // 5% position sizing (arbitrage only)
    }
  };

  // Dynamic adjustment parameters
  private readonly dynamicAdjustment: DynamicLimitAdjustment = {
    // Performance-based adjustments
    performanceMultiplier: 1.5,    // Up to 50% increase for profitable strategies
    drawdownPenalty: 0.5,          // 50% reduction after significant drawdown
    winRateBonus: 1.2,             // 20% bonus for >80% win rate
    recentPerformanceWeight: 0.7,   // 70% weight to recent vs historical

    // Market condition adjustments
    volatilityAdjustment: 0.8,     // Reduce during high volatility
    liquidityAdjustment: 0.9,      // Reduce during low liquidity
    eventAdjustment: 1.3,          // Increase during gaming events

    // Correlation adjustments
    correlationPenalty: 0.7,       // 30% reduction for high correlation
    diversificationBonus: 1.1      // 10% bonus for diversification
  };

  private riskBudgetDistribution: RiskBudgetDistribution = {
    totalRiskBudget: this.PORTFOLIO_VALUE_USD * 0.05, // 5% of $541 = $27.05
    allocatedRiskBudget: 0,
    remainingRiskBudget: 0,
    strategyAllocations: {},
    emergencyReserve: this.PORTFOLIO_VALUE_USD * 0.01  // 1% emergency reserve = $5.41
  };

  constructor() {
    this.calculateRiskBudgetDistribution();
    logger.info('Strategy Limits initialized for production portfolio', {
      portfolioValue: this.PORTFOLIO_VALUE_USD,
      totalRiskBudget: this.riskBudgetDistribution.totalRiskBudget,
      emergencyReserve: this.riskBudgetDistribution.emergencyReserve,
      strategiesConfigured: Object.keys(this.strategyLimits).length
    });
  }

  /**
   * Get risk limits for a specific strategy
   */
  getStrategyLimits(strategyName: string): StrategyRiskLimits | null {
    return this.strategyLimits[strategyName] || null;
  }

  /**
   * Calculate maximum position size for a strategy
   */
  calculateMaxPositionSize(
    strategyName: string,
    currentVolatility: number,
    marketConditions: {
      liquidity: 'low' | 'medium' | 'high';
      stress: boolean;
      gameEvent: boolean;
    }
  ): number {
    const limits = this.strategyLimits[strategyName];
    if (!limits) return 0;

    // Base allocation in USD
    let maxAllocationUSD = this.PORTFOLIO_VALUE_USD * limits.maxAllocation;

    // Apply volatility scaling
    const volatilityFactor = this.getVolatilityScalingFactor(currentVolatility);
    maxAllocationUSD *= volatilityFactor;

    // Apply dynamic adjustments
    const dynamicFactor = this.calculateDynamicAdjustment(
      strategyName,
      marketConditions,
      currentVolatility
    );
    maxAllocationUSD *= dynamicFactor;

    // Apply correlation adjustments
    const correlationFactor = this.calculateCorrelationAdjustment(
      strategyName,
      marketConditions.stress
    );
    maxAllocationUSD *= correlationFactor;

    logger.debug(`Calculated max position size for ${strategyName}`, {
      baseAllocation: this.PORTFOLIO_VALUE_USD * limits.maxAllocation,
      volatilityFactor,
      dynamicFactor,
      correlationFactor,
      finalAllocation: maxAllocationUSD
    });

    return Math.max(0, maxAllocationUSD);
  }

  /**
   * Get volatility scaling factor
   */
  private getVolatilityScalingFactor(currentVolatility: number): number {
    const thresholds = this.volatilityScaling.thresholds;
    const factors = this.volatilityScaling.scalingFactors;

    if (currentVolatility >= thresholds.crisis) return factors.crisis;
    if (currentVolatility >= thresholds.extreme) return factors.extreme;
    if (currentVolatility >= thresholds.high) return factors.high;
    if (currentVolatility >= thresholds.elevated) return factors.elevated;
    return factors.normal;
  }

  /**
   * Calculate dynamic adjustment factor based on performance and conditions
   */
  private calculateDynamicAdjustment(
    strategyName: string,
    marketConditions: {
      liquidity: 'low' | 'medium' | 'high';
      stress: boolean;
      gameEvent: boolean;
    },
    currentVolatility: number
  ): number {
    const limits = this.strategyLimits[strategyName];
    if (!limits.dynamicScaling) return 1.0;

    let adjustmentFactor = 1.0;

    // Market condition adjustments
    if (currentVolatility > 0.5) {
      adjustmentFactor *= this.dynamicAdjustment.volatilityAdjustment;
    }

    if (marketConditions.liquidity === 'low') {
      adjustmentFactor *= this.dynamicAdjustment.liquidityAdjustment;
    }

    if (marketConditions.gameEvent) {
      adjustmentFactor *= this.dynamicAdjustment.eventAdjustment;
    }

    return Math.max(0.1, Math.min(2.0, adjustmentFactor)); // Cap between 10% and 200%
  }

  /**
   * Calculate correlation adjustment factor
   */
  private calculateCorrelationAdjustment(
    strategyName: string,
    isStressCondition: boolean
  ): number {
    const limits = this.strategyLimits[strategyName];
    let maxCorrelation = 0;

    // Find maximum correlation with other active strategies
    const correlationSource = isStressCondition ?
      this.correlationMatrix.stressCorrelations :
      this.correlationMatrix.baseCorrelations;

    // Check correlations from all sources
    Object.entries(correlationSource).forEach(([pair, correlation]) => {
      if (pair.includes(strategyName)) {
        maxCorrelation = Math.max(maxCorrelation, correlation);
      }
    });

    // Check strategy-specific correlations
    const strategyCorrelations = this.correlationMatrix.strategyCorrelations[strategyName];
    if (strategyCorrelations) {
      Object.values(strategyCorrelations).forEach(correlation => {
        maxCorrelation = Math.max(maxCorrelation, correlation);
      });
    }

    // Apply correlation penalty if above threshold
    if (maxCorrelation > limits.correlationLimit) {
      return this.dynamicAdjustment.correlationPenalty;
    }

    // Apply diversification bonus for low correlation
    if (maxCorrelation < 0.3) {
      return this.dynamicAdjustment.diversificationBonus;
    }

    return 1.0;
  }

  /**
   * Check if strategy should be paused due to risk conditions
   */
  shouldPauseStrategy(
    strategyName: string,
    currentConditions: {
      volatility: number;
      drawdown: number;
      recentLosses: number;
      correlation: number;
    }
  ): { shouldPause: boolean; reason?: string } {
    const limits = this.strategyLimits[strategyName];
    if (!limits) {
      return { shouldPause: true, reason: 'Strategy not configured' };
    }

    // Check volatility limit
    if (currentConditions.volatility > limits.volatilityLimit) {
      return {
        shouldPause: true,
        reason: `Volatility ${(currentConditions.volatility * 100).toFixed(1)}% exceeds limit ${(limits.volatilityLimit * 100).toFixed(1)}%`
      };
    }

    // Check drawdown limit
    if (currentConditions.drawdown > limits.maxDrawdown) {
      return {
        shouldPause: true,
        reason: `Drawdown ${(currentConditions.drawdown * 100).toFixed(1)}% exceeds limit ${(limits.maxDrawdown * 100).toFixed(1)}%`
      };
    }

    // Check emergency stop
    if (currentConditions.recentLosses > limits.emergencyStop) {
      return {
        shouldPause: true,
        reason: `Recent losses ${(currentConditions.recentLosses * 100).toFixed(1)}% triggered emergency stop at ${(limits.emergencyStop * 100).toFixed(1)}%`
      };
    }

    // Check correlation limit
    if (currentConditions.correlation > limits.correlationLimit) {
      return {
        shouldPause: true,
        reason: `Correlation ${(currentConditions.correlation * 100).toFixed(1)}% exceeds limit ${(limits.correlationLimit * 100).toFixed(1)}%`
      };
    }

    return { shouldPause: false };
  }

  /**
   * Get all strategy risk categories
   */
  getStrategyRiskCategories(): Record<string, 'low' | 'medium' | 'high' | 'extreme'> {
    const categories: Record<string, 'low' | 'medium' | 'high' | 'extreme'> = {};

    Object.entries(this.strategyLimits).forEach(([name, limits]) => {
      categories[name] = limits.riskCategory;
    });

    return categories;
  }

  /**
   * Update strategy limits based on performance
   */
  updateStrategyLimits(
    strategyName: string,
    performanceMetrics: {
      winRate: number;
      avgProfit: number;
      maxDrawdown: number;
      sharpeRatio: number;
      recentPerformance: number;
    }
  ): void {
    const limits = this.strategyLimits[strategyName];
    if (!limits || !limits.dynamicScaling) return;

    const originalLimits = { ...limits };

    // Performance-based adjustments
    if (performanceMetrics.winRate > 0.80) {
      limits.maxAllocation *= this.dynamicAdjustment.winRateBonus;
    }

    if (performanceMetrics.maxDrawdown > limits.maxDrawdown) {
      limits.maxAllocation *= this.dynamicAdjustment.drawdownPenalty;
    }

    // Profitable strategies get allocation boost
    if (performanceMetrics.avgProfit > 0 && performanceMetrics.sharpeRatio > 1.0) {
      limits.maxAllocation *= this.dynamicAdjustment.performanceMultiplier;
    }

    // Cap adjustments to reasonable bounds
    limits.maxAllocation = Math.max(
      originalLimits.maxAllocation * 0.5, // Minimum 50% of original
      Math.min(
        originalLimits.maxAllocation * 2.0, // Maximum 200% of original
        limits.maxAllocation
      )
    );

    logger.info(`Updated limits for ${strategyName}`, {
      originalAllocation: originalLimits.maxAllocation,
      newAllocation: limits.maxAllocation,
      adjustmentFactor: limits.maxAllocation / originalLimits.maxAllocation,
      winRate: performanceMetrics.winRate,
      avgProfit: performanceMetrics.avgProfit
    });
  }

  /**
   * Calculate current risk budget utilization
   */
  private calculateRiskBudgetDistribution(): void {
    let totalAllocated = 0;
    const allocations: Record<string, number> = {};

    Object.entries(this.strategyLimits).forEach(([name, limits]) => {
      const riskAllocation = this.PORTFOLIO_VALUE_USD * limits.maxAllocation * limits.riskBudget;
      allocations[name] = riskAllocation;
      totalAllocated += riskAllocation;
    });

    this.riskBudgetDistribution.allocatedRiskBudget = totalAllocated;
    this.riskBudgetDistribution.remainingRiskBudget =
      this.riskBudgetDistribution.totalRiskBudget - totalAllocated - this.riskBudgetDistribution.emergencyReserve;
    this.riskBudgetDistribution.strategyAllocations = allocations;
  }

  /**
   * Get current risk budget status
   */
  getRiskBudgetStatus(): RiskBudgetDistribution {
    this.calculateRiskBudgetDistribution();
    return { ...this.riskBudgetDistribution };
  }

  /**
   * Get correlation matrix for analysis
   */
  getCorrelationMatrix(): CorrelationMatrix {
    return { ...this.correlationMatrix };
  }

  /**
   * Get volatility scaling configuration
   */
  getVolatilityScaling(): VolatilityScaling {
    return { ...this.volatilityScaling };
  }

  /**
   * Validate total allocation doesn't exceed 100%
   */
  validateTotalAllocation(): { valid: boolean; totalAllocation: number; violations: string[] } {
    let totalAllocation = 0;
    const violations: string[] = [];

    Object.entries(this.strategyLimits).forEach(([name, limits]) => {
      totalAllocation += limits.maxAllocation;
    });

    if (totalAllocation > 1.0) {
      violations.push(`Total allocation ${(totalAllocation * 100).toFixed(1)}% exceeds 100%`);
    }

    if (this.riskBudgetDistribution.allocatedRiskBudget > this.riskBudgetDistribution.totalRiskBudget) {
      violations.push(`Risk budget allocation exceeds total risk budget`);
    }

    return {
      valid: violations.length === 0,
      totalAllocation,
      violations
    };
  }

  /**
   * Get strategy limits summary for dashboard
   */
  getStrategyLimitsSummary(): Array<{
    strategy: string;
    maxAllocationUSD: number;
    riskBudgetUSD: number;
    riskCategory: string;
    correlationLimit: number;
    volatilityLimit: number;
    emergencyStop: number;
  }> {
    return Object.entries(this.strategyLimits).map(([name, limits]) => ({
      strategy: name,
      maxAllocationUSD: this.PORTFOLIO_VALUE_USD * limits.maxAllocation,
      riskBudgetUSD: this.riskBudgetDistribution.strategyAllocations[name] || 0,
      riskCategory: limits.riskCategory,
      correlationLimit: limits.correlationLimit,
      volatilityLimit: limits.volatilityLimit,
      emergencyStop: limits.emergencyStop
    }));
  }
}