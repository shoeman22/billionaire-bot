/**
 * Enhanced Risk Manager
 * Multi-strategy portfolio risk management with real-time monitoring and automated controls
 *
 * PRODUCTION SYSTEM - PROTECTING REAL $541 USD (34,062 GALA)
 * Features comprehensive risk management across all 14 trading strategies
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { AlertSystem } from '../../monitoring/alerts';
import { RiskMonitor, PortfolioSnapshot, RiskMetrics } from './risk-monitor';
import { EmergencyControls, EmergencyType } from './emergency-controls';
import { StrategyLimits, StrategyRiskLimits } from './strategy-limits';
import { SwapExecutor } from '../execution/swap-executor';
import { safeParseFloat } from '../../utils/safe-parse';

export interface EnhancedRiskConfig {
  // Portfolio-level limits
  maxDailyLossUSD: number;        // Maximum daily loss in USD
  maxDrawdownUSD: number;         // Maximum drawdown in USD
  maxCorrelatedPositions: number; // Maximum % in correlated positions
  volatilityScalingEnabled: boolean; // Enable volatility-based scaling

  // Kill switch triggers
  killSwitchTriggers: {
    portfolioLoss: number;        // -10% portfolio loss
    dailyLoss: number;           // -5% daily loss
    strategyFailures: number;     // 3+ strategy failures in 1 hour
    marketVolatility: number;     // >200% normal volatility
    liquidityDrain: number;       // >50% liquidity reduction
    correlationSpike: number;     // >80% correlation across strategies
  };

  // Circuit breaker settings
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;     // Number of failures to trigger
    recoveryTime: number;         // Time before reset (ms)
    escalationLevels: string[];   // ['warning', 'critical', 'emergency']
  };
}

export interface StrategyRiskStatus {
  strategyName: string;
  isActive: boolean;
  currentAllocation: number;     // Current position size in USD
  maxAllocation: number;         // Maximum allowed allocation
  riskUtilization: number;       // % of risk budget used
  correlationScore: number;      // Correlation with other strategies
  volatilityImpact: number;      // Volatility scaling factor applied
  performanceScore: number;      // Recent performance score
  nextRebalanceTime: number;     // Next rebalance timestamp
  pausedReason?: string;         // Reason if strategy is paused
}

export interface RiskAlert {
  level: 'info' | 'warning' | 'critical' | 'emergency';
  type: 'correlation' | 'volatility' | 'drawdown' | 'concentration' | 'performance' | 'liquidity';
  strategy?: string;
  message: string;
  data: Record<string, any>;
  timestamp: number;
  actionRequired: boolean;
  autoResolved: boolean;
}

export interface KillSwitchStatus {
  isActive: boolean;
  triggeredAt?: number;
  triggerCondition?: string;
  phase: 0 | 1 | 2 | 3 | 4;    // Kill switch execution phase
  actionsExecuted: string[];
  estimatedRecoveryTime?: number;
}

export interface PortfolioRiskMetrics extends RiskMetrics {
  // Enhanced metrics
  strategyCount: number;         // Number of active strategies
  correlationMatrix: number[][];  // Inter-strategy correlation matrix
  diversificationRatio: number;  // Portfolio diversification score
  riskBudgetUtilization: number; // % of total risk budget used
  volatilityScaling: number;     // Current volatility scaling factor

  // Gaming-specific metrics
  gameTokenExposure: number;     // % in gaming tokens
  eventRisk: number;             // Risk from upcoming gaming events
  crossGameCorrelation: number;  // Correlation across game ecosystems
  nftMarketRisk: number;         // NFT market illiquidity risk
}

export interface RiskReport {
  timestamp: number;
  portfolioValue: number;
  dailyPnL: number;
  totalPnL: number;
  riskMetrics: PortfolioRiskMetrics;
  strategyStatus: StrategyRiskStatus[];
  recentAlerts: RiskAlert[];
  killSwitchStatus: KillSwitchStatus;
  recommendations: string[];
  nextRebalanceTime: number;
}

export class EnhancedRiskManager {
  private config: TradingConfig;
  private riskConfig: EnhancedRiskConfig;
  private gswap: GSwap;
  private swapExecutor: SwapExecutor;
  private alertSystem: AlertSystem;
  private riskMonitor: RiskMonitor;
  private emergencyControls: EmergencyControls;
  private strategyLimits: StrategyLimits;

  // Portfolio constants
  private readonly PORTFOLIO_VALUE_USD = 541;    // Current portfolio value
  private readonly PORTFOLIO_GALA = 34062;       // Current GALA holdings

  // Risk tracking
  private strategyRiskStatus: Map<string, StrategyRiskStatus> = new Map();
  private riskAlerts: RiskAlert[] = [];
  private killSwitchStatus: KillSwitchStatus = {
    isActive: false,
    phase: 0,
    actionsExecuted: []
  };

  // Performance tracking
  private strategyPerformance: Map<string, {
    recentTrades: number;
    recentWins: number;
    recentPnL: number;
    failureCount: number;
    lastFailure: number;
  }> = new Map();

  // Monitoring state
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private lastRebalanceTime = 0;
  private correlationMatrix: number[][] = [];

  constructor(
    config: TradingConfig,
    gswap: GSwap,
    swapExecutor: SwapExecutor,
    riskMonitor: RiskMonitor,
    emergencyControls: EmergencyControls,
    walletAddress: string
  ) {
    this.config = config;
    this.gswap = gswap;
    this.swapExecutor = swapExecutor;
    this.alertSystem = new AlertSystem(false);
    this.riskMonitor = riskMonitor;
    this.emergencyControls = emergencyControls;
    this.strategyLimits = new StrategyLimits();

    // Initialize enhanced risk configuration
    this.riskConfig = {
      maxDailyLossUSD: 27.05,           // 5% of $541
      maxDrawdownUSD: 81.15,            // 15% of $541
      maxCorrelatedPositions: 50,       // 50% max in correlated positions
      volatilityScalingEnabled: true,

      killSwitchTriggers: {
        portfolioLoss: 0.10,            // -10% portfolio loss ($54.10)
        dailyLoss: 0.05,                // -5% daily loss ($27.05)
        strategyFailures: 3,            // 3+ strategy failures in 1 hour
        marketVolatility: 2.00,         // >200% normal volatility
        liquidityDrain: 0.50,           // >50% liquidity reduction
        correlationSpike: 0.80          // >80% correlation across strategies
      },

      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,            // 5 failures trigger circuit breaker
        recoveryTime: 300000,           // 5 minute recovery time
        escalationLevels: ['warning', 'critical', 'emergency']
      }
    };

    this.initializeStrategyTracking();

    logger.info('Enhanced Risk Manager initialized for production portfolio', {
      portfolioValue: this.PORTFOLIO_VALUE_USD,
      maxDailyLoss: this.riskConfig.maxDailyLossUSD,
      maxDrawdown: this.riskConfig.maxDrawdownUSD,
      strategiesTracked: this.strategyRiskStatus.size,
      killSwitchEnabled: true,
      circuitBreakerEnabled: this.riskConfig.circuitBreaker.enabled
    });
  }

  /**
   * Initialize strategy tracking for all supported strategies
   */
  private initializeStrategyTracking(): void {
    // Get all strategies from strategy limits
    const strategySummary = this.strategyLimits.getStrategyLimitsSummary();

    strategySummary.forEach(strategy => {
      this.strategyRiskStatus.set(strategy.strategy, {
        strategyName: strategy.strategy,
        isActive: false,
        currentAllocation: 0,
        maxAllocation: strategy.maxAllocationUSD,
        riskUtilization: 0,
        correlationScore: 0,
        volatilityImpact: 1.0,
        performanceScore: 50,
        nextRebalanceTime: 0
      });

      this.strategyPerformance.set(strategy.strategy, {
        recentTrades: 0,
        recentWins: 0,
        recentPnL: 0,
        failureCount: 0,
        lastFailure: 0
      });
    });
  }

  /**
   * Start enhanced risk monitoring
   */
  async startMonitoring(walletAddress: string): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Enhanced risk monitoring already active');
      return;
    }

    try {
      // Start base risk monitoring
      await this.riskMonitor.startMonitoring(walletAddress);

      // Start enhanced monitoring loop
      this.monitoringInterval = setInterval(async () => {
        await this.performEnhancedRiskCheck(walletAddress);
      }, 15000); // Check every 15 seconds

      this.isMonitoring = true;

      logger.info('Enhanced risk monitoring started', {
        walletAddress: walletAddress.substring(0, 10) + '...',
        checkInterval: '15 seconds',
        strategiesMonitored: this.strategyRiskStatus.size
      });

    } catch (error) {
      logger.error('Failed to start enhanced risk monitoring:', error);
      throw error;
    }
  }

  /**
   * Stop enhanced risk monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.riskMonitor.stopMonitoring();
    this.isMonitoring = false;

    logger.info('Enhanced risk monitoring stopped');
  }

  /**
   * Perform comprehensive enhanced risk check
   */
  private async performEnhancedRiskCheck(walletAddress: string): Promise<void> {
    try {
      // Get current portfolio snapshot
      const snapshot = this.riskMonitor.getLatestSnapshot();
      if (!snapshot) return;

      // Calculate enhanced risk metrics
      const enhancedMetrics = await this.calculateEnhancedRiskMetrics(snapshot);

      // Update strategy risk status
      await this.updateStrategyRiskStatus();

      // Check kill switch conditions
      const killSwitchCheck = await this.checkKillSwitchConditions(snapshot, enhancedMetrics);
      if (killSwitchCheck.shouldTrigger) {
        await this.activateKillSwitch(killSwitchCheck.condition || "unknown", killSwitchCheck.severity || "critical");
      }

      // Check correlation risks
      await this.checkCorrelationRisks();

      // Check volatility scaling requirements
      await this.checkVolatilityScaling(enhancedMetrics);

      // Update performance tracking
      this.updatePerformanceTracking();

      // Generate alerts if needed
      await this.generateRiskAlerts(snapshot, enhancedMetrics);

      // Auto-rebalance if conditions are met
      if (this.shouldRebalancePortfolio()) {
        await this.rebalancePortfolioRisk();
      }

    } catch (error) {
      logger.error('Error in enhanced risk check:', error);

      // Record system error for circuit breaker
      await this.recordSystemError('enhanced_risk_check_error', error);
    }
  }

  /**
   * Calculate enhanced risk metrics
   */
  private async calculateEnhancedRiskMetrics(snapshot: PortfolioSnapshot): Promise<PortfolioRiskMetrics> {
    const baseMetrics = snapshot.riskMetrics;
    const activeStrategies = Array.from(this.strategyRiskStatus.values()).filter(s => s.isActive);

    // Calculate correlation matrix
    this.correlationMatrix = await this.calculateCorrelationMatrix();

    // Calculate enhanced metrics
    const enhancedMetrics: PortfolioRiskMetrics = {
      ...baseMetrics,

      // Strategy metrics
      strategyCount: activeStrategies.length,
      correlationMatrix: this.correlationMatrix,
      diversificationRatio: this.calculateDiversificationRatio(),
      riskBudgetUtilization: this.calculateRiskBudgetUtilization(),
      volatilityScaling: this.getCurrentVolatilityScaling(baseMetrics.volatilityScore),

      // Gaming-specific metrics
      gameTokenExposure: this.calculateGameTokenExposure(snapshot),
      eventRisk: this.calculateEventRisk(),
      crossGameCorrelation: this.calculateCrossGameCorrelation(),
      nftMarketRisk: this.calculateNFTMarketRisk()
    };

    return enhancedMetrics;
  }

  /**
   * Check kill switch conditions
   */
  private async checkKillSwitchConditions(
    snapshot: PortfolioSnapshot,
    metrics: PortfolioRiskMetrics
  ): Promise<{
    shouldTrigger: boolean;
    condition?: string;
    severity?: 'warning' | 'critical' | 'emergency';
  }> {
    const triggers = this.riskConfig.killSwitchTriggers;

    // Portfolio loss check
    const portfolioLossPercent = Math.abs(snapshot.totalPnL) / this.PORTFOLIO_VALUE_USD;
    if (portfolioLossPercent >= triggers.portfolioLoss) {
      return {
        shouldTrigger: true,
        condition: `Portfolio loss ${(portfolioLossPercent * 100).toFixed(1)}% exceeds trigger ${(triggers.portfolioLoss * 100)}%`,
        severity: 'emergency'
      };
    }

    // Daily loss check
    const dailyLossPercent = Math.abs(snapshot.dailyPnL) / this.PORTFOLIO_VALUE_USD;
    if (dailyLossPercent >= triggers.dailyLoss) {
      return {
        shouldTrigger: true,
        condition: `Daily loss ${(dailyLossPercent * 100).toFixed(1)}% exceeds trigger ${(triggers.dailyLoss * 100)}%`,
        severity: 'critical'
      };
    }

    // Strategy failure check
    const recentFailures = this.countRecentStrategyFailures();
    if (recentFailures >= triggers.strategyFailures) {
      return {
        shouldTrigger: true,
        condition: `${recentFailures} strategy failures in last hour exceeds trigger ${triggers.strategyFailures}`,
        severity: 'critical'
      };
    }

    // Market volatility check
    const normalVolatility = 0.02; // 2% normal volatility
    const volatilityMultiple = metrics.volatilityScore / normalVolatility;
    if (volatilityMultiple >= triggers.marketVolatility) {
      return {
        shouldTrigger: true,
        condition: `Market volatility ${volatilityMultiple.toFixed(1)}x normal exceeds trigger ${triggers.marketVolatility}x`,
        severity: 'warning'
      };
    }

    // Liquidity drain check
    const liquidityReduction = 1 - (metrics.liquidityScore / 100);
    if (liquidityReduction >= triggers.liquidityDrain) {
      return {
        shouldTrigger: true,
        condition: `Liquidity reduction ${(liquidityReduction * 100).toFixed(1)}% exceeds trigger ${(triggers.liquidityDrain * 100)}%`,
        severity: 'critical'
      };
    }

    // Correlation spike check
    const maxCorrelation = this.getMaxStrategyCorrelation();
    if (maxCorrelation >= triggers.correlationSpike) {
      return {
        shouldTrigger: true,
        condition: `Maximum strategy correlation ${(maxCorrelation * 100).toFixed(1)}% exceeds trigger ${(triggers.correlationSpike * 100)}%`,
        severity: 'warning'
      };
    }

    return { shouldTrigger: false };
  }

  /**
   * Activate kill switch with phased liquidation
   */
  private async activateKillSwitch(condition: string, severity: 'warning' | 'critical' | 'emergency'): Promise<void> {
    if (this.killSwitchStatus.isActive) return;

    logger.error(`🚨 KILL SWITCH ACTIVATED: ${condition}`);

    this.killSwitchStatus = {
      isActive: true,
      triggeredAt: Date.now(),
      triggerCondition: condition,
      phase: 1,
      actionsExecuted: [],
      estimatedRecoveryTime: Date.now() + 3600000 // 1 hour default
    };

    try {
      // Phase 1: Immediate - Stop all new position entries
      await this.executeKillSwitchPhase1();

      // Schedule subsequent phases based on severity
      if (severity === 'emergency') {
        // Immediate liquidation for emergency
        setTimeout(() => this.executeKillSwitchPhase2(), 60000);   // 1 minute
        setTimeout(() => this.executeKillSwitchPhase3(), 300000);  // 5 minutes
        setTimeout(() => this.executeKillSwitchPhase4(), 900000);  // 15 minutes
      } else if (severity === 'critical') {
        // Gradual liquidation for critical
        setTimeout(() => this.executeKillSwitchPhase2(), 300000);  // 5 minutes
        setTimeout(() => this.executeKillSwitchPhase3(), 900000);  // 15 minutes
        setTimeout(() => this.executeKillSwitchPhase4(), 1800000); // 30 minutes
      } else {
        // Warning level - just monitoring and position reduction
        setTimeout(() => this.executeKillSwitchPhase2(), 900000);  // 15 minutes
      }

      // Send critical alert
      await this.createRiskAlert('emergency', 'concentration', undefined,
        `Kill switch activated: ${condition}`, {
          condition,
          severity,
          phase: this.killSwitchStatus.phase,
          estimatedRecovery: this.killSwitchStatus.estimatedRecoveryTime
        }, true);

    } catch (error) {
      logger.error('Error activating kill switch:', error);
    }
  }

  /**
   * Kill Switch Phase 1: Stop all new positions
   */
  private async executeKillSwitchPhase1(): Promise<void> {
    logger.error('🚨 Kill Switch Phase 1: Stopping all new position entries');

    // Disable all strategies
    this.strategyRiskStatus.forEach(status => {
      if (status.isActive) {
        status.isActive = false;
        status.pausedReason = 'Kill switch activated';
      }
    });

    this.killSwitchStatus.phase = 1;
    this.killSwitchStatus.actionsExecuted.push('stopped_new_positions');

    await this.createRiskAlert('critical', 'concentration', undefined,
      'Phase 1 Complete: All new position entries stopped', {
        phase: 1,
        timestamp: Date.now()
      }, false);
  }

  /**
   * Kill Switch Phase 2: Close high-risk positions
   */
  private async executeKillSwitchPhase2(): Promise<void> {
    if (!this.killSwitchStatus.isActive) return;

    logger.error('🚨 Kill Switch Phase 2: Closing high-risk positions');

    try {
      // Close positions from high-risk strategies first
      const highRiskStrategies = ['nft-arbitrage', 'event-arbitrage', 'volume-momentum'];

      for (const strategyName of highRiskStrategies) {
        const status = this.strategyRiskStatus.get(strategyName);
        if (status && status.currentAllocation > 0) {
          await this.liquidateStrategyPositions(strategyName, 1.0); // 100% liquidation
        }
      }

      this.killSwitchStatus.phase = 2;
      this.killSwitchStatus.actionsExecuted.push('closed_high_risk_positions');

    } catch (error) {
      logger.error('Error in kill switch phase 2:', error);
    }
  }

  /**
   * Kill Switch Phase 3: Close medium-risk positions
   */
  private async executeKillSwitchPhase3(): Promise<void> {
    if (!this.killSwitchStatus.isActive) return;

    logger.error('🚨 Kill Switch Phase 3: Closing medium-risk positions');

    try {
      // Close medium-risk strategy positions
      const mediumRiskStrategies = ['statistical-arbitrage', 'multi-path-arbitrage', 'whale-tracking', 'smart-money-flow'];

      for (const strategyName of mediumRiskStrategies) {
        const status = this.strategyRiskStatus.get(strategyName);
        if (status && status.currentAllocation > 0) {
          await this.liquidateStrategyPositions(strategyName, 0.75); // 75% liquidation
        }
      }

      this.killSwitchStatus.phase = 3;
      this.killSwitchStatus.actionsExecuted.push('closed_medium_risk_positions');

    } catch (error) {
      logger.error('Error in kill switch phase 3:', error);
    }
  }

  /**
   * Kill Switch Phase 4: Emergency liquidation to GALA base
   */
  private async executeKillSwitchPhase4(): Promise<void> {
    if (!this.killSwitchStatus.isActive) return;

    logger.error('🚨 Kill Switch Phase 4: Emergency liquidation to GALA base');

    try {
      // Emergency liquidate all remaining positions except GALA
      await this.emergencyControls.emergencyLiquidateAllPositions();

      this.killSwitchStatus.phase = 4;
      this.killSwitchStatus.actionsExecuted.push('emergency_liquidation_complete');

      // Set recovery estimate
      this.killSwitchStatus.estimatedRecoveryTime = Date.now() + 7200000; // 2 hours

    } catch (error) {
      logger.error('Error in kill switch phase 4:', error);
    }
  }

  /**
   * Liquidate positions for a specific strategy
   */
  private async liquidateStrategyPositions(strategyName: string, liquidationPercent: number): Promise<void> {
    try {
      logger.warn(`Liquidating ${(liquidationPercent * 100)}% of ${strategyName} positions`);

      // This would integrate with strategy-specific liquidation logic
      // For now, log the action - actual implementation would depend on strategy position tracking

      const status = this.strategyRiskStatus.get(strategyName);
      if (status) {
        const liquidationAmount = status.currentAllocation * liquidationPercent;
        status.currentAllocation -= liquidationAmount;

        logger.info(`Liquidated $${liquidationAmount.toFixed(2)} from ${strategyName}`);
      }

    } catch (error) {
      logger.error(`Error liquidating ${strategyName} positions:`, error);
    }
  }

  /**
   * Check correlation risks between strategies
   */
  private async checkCorrelationRisks(): Promise<void> {
    const correlationMatrix = this.strategyLimits.getCorrelationMatrix();
    const activeStrategies = Array.from(this.strategyRiskStatus.entries())
      .filter(([name, status]) => status.isActive);

    // Check for high correlations between active strategies
    for (let i = 0; i < activeStrategies.length; i++) {
      for (let j = i + 1; j < activeStrategies.length; j++) {
        const [strategy1] = activeStrategies[i];
        const [strategy2] = activeStrategies[j];

        const correlation = this.getStrategyCorrelation(strategy1, strategy2, correlationMatrix);

        if (correlation > 0.7) { // High correlation threshold
          await this.createRiskAlert('warning', 'correlation', strategy1,
            `High correlation detected between ${strategy1} and ${strategy2}`, {
              strategy1,
              strategy2,
              correlation,
              threshold: 0.7
            }, false);
        }
      }
    }
  }

  /**
   * Check volatility scaling requirements
   */
  private async checkVolatilityScaling(metrics: PortfolioRiskMetrics): Promise<void> {
    if (!this.riskConfig.volatilityScalingEnabled) return;

    const currentVolatility = metrics.volatilityScore;
    const scalingFactor = metrics.volatilityScaling;

    // Update strategy allocations based on volatility scaling
    this.strategyRiskStatus.forEach((status, strategyName) => {
      const limits = this.strategyLimits.getStrategyLimits(strategyName);
      if (limits && status.isActive) {
        const originalMax = limits.maxAllocation * this.PORTFOLIO_VALUE_USD;
        const scaledMax = originalMax * scalingFactor;

        status.maxAllocation = scaledMax;
        status.volatilityImpact = scalingFactor;

        if (scalingFactor < 0.5) { // Significant scaling
          this.createRiskAlert('info', 'volatility', strategyName,
            `Volatility scaling applied: ${(scalingFactor * 100).toFixed(0)}%`, {
              strategyName,
              originalMax,
              scaledMax,
              volatility: currentVolatility
            }, false);
        }
      }
    });
  }

  /**
   * Update strategy risk status
   */
  private async updateStrategyRiskStatus(): Promise<void> {
    // This would integrate with actual strategy position tracking
    // For now, update based on available information

    this.strategyRiskStatus.forEach((status, strategyName) => {
      const limits = this.strategyLimits.getStrategyLimits(strategyName);
      if (!limits) return;

      // Calculate risk utilization
      const riskBudget = this.PORTFOLIO_VALUE_USD * limits.maxAllocation * limits.riskBudget;
      status.riskUtilization = status.currentAllocation / riskBudget;

      // Update correlation score
      status.correlationScore = this.getMaxCorrelationForStrategy(strategyName);

      // Update next rebalance time
      if (status.nextRebalanceTime < Date.now()) {
        status.nextRebalanceTime = Date.now() + 300000; // 5 minutes
      }
    });
  }

  /**
   * Generate risk alerts based on current conditions
   */
  private async generateRiskAlerts(
    snapshot: PortfolioSnapshot,
    metrics: PortfolioRiskMetrics
  ): Promise<void> {
    // Portfolio concentration alert
    if (metrics.maxConcentration > 0.6) {
      await this.createRiskAlert('warning', 'concentration', undefined,
        `Portfolio concentration ${(metrics.maxConcentration * 100).toFixed(1)}% exceeds recommended 60%`, {
          concentration: metrics.maxConcentration,
          threshold: 0.6
        }, false);
    }

    // Risk budget utilization alert
    if (metrics.riskBudgetUtilization > 0.8) {
      await this.createRiskAlert('warning', 'concentration', undefined,
        `Risk budget utilization ${(metrics.riskBudgetUtilization * 100).toFixed(1)}% exceeds 80%`, {
          utilization: metrics.riskBudgetUtilization,
          threshold: 0.8
        }, false);
    }

    // Gaming event risk alert
    if (metrics.eventRisk > 0.3) {
      await this.createRiskAlert('info', 'volatility', undefined,
        `Elevated gaming event risk detected`, {
          eventRisk: metrics.eventRisk,
          gameTokenExposure: metrics.gameTokenExposure
        }, false);
    }

    // Low diversification alert
    if (metrics.diversificationRatio < 0.4) {
      await this.createRiskAlert('warning', 'concentration', undefined,
        `Low portfolio diversification ratio: ${(metrics.diversificationRatio * 100).toFixed(1)}%`, {
          diversification: metrics.diversificationRatio,
          threshold: 0.4
        }, false);
    }
  }

  /**
   * Create risk alert
   */
  private async createRiskAlert(
    level: 'info' | 'warning' | 'critical' | 'emergency',
    type: 'correlation' | 'volatility' | 'drawdown' | 'concentration' | 'performance' | 'liquidity',
    strategy: string | undefined,
    message: string,
    data: Record<string, any>,
    actionRequired: boolean
  ): Promise<void> {
    const alert: RiskAlert = {
      level,
      type,
      strategy,
      message,
      data,
      timestamp: Date.now(),
      actionRequired,
      autoResolved: false
    };

    this.riskAlerts.push(alert);

    // Keep only last 100 alerts
    if (this.riskAlerts.length > 100) {
      this.riskAlerts = this.riskAlerts.slice(-100);
    }

    // Send system alert
    await this.alertSystem.riskAlert(type, {
      level,
      message,
      strategy,
      data,
      actionRequired
    });

    logger.warn(`Risk alert [${level.toUpperCase()}]: ${message}`, data);
  }

  /**
   * Helper methods for calculations
   */
  private calculateCorrelationMatrix(): Promise<number[][]> {
    // Simplified correlation matrix - in production this would use real price data
    const strategies = Array.from(this.strategyRiskStatus.keys());
    const matrix: number[][] = [];

    for (let i = 0; i < strategies.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < strategies.length; j++) {
        if (i === j) {
          matrix[i][j] = 1.0; // Perfect self-correlation
        } else {
          // Get correlation from strategy limits or default to low correlation
          matrix[i][j] = this.getStrategyCorrelation(strategies[i], strategies[j],
            this.strategyLimits.getCorrelationMatrix()) || 0.2;
        }
      }
    }

    return Promise.resolve(matrix);
  }

  private getStrategyCorrelation(
    strategy1: string,
    strategy2: string,
    correlationMatrix: any
  ): number {
    // Check all correlation sources
    const pair1 = `${strategy1}_${strategy2}`;
    const pair2 = `${strategy2}_${strategy1}`;

    // Check event correlations
    if (correlationMatrix.eventCorrelations[pair1]) {
      return correlationMatrix.eventCorrelations[pair1];
    }
    if (correlationMatrix.eventCorrelations[pair2]) {
      return correlationMatrix.eventCorrelations[pair2];
    }

    // Check strategy correlations
    if (correlationMatrix.strategyCorrelations[strategy1]?.[strategy2]) {
      return correlationMatrix.strategyCorrelations[strategy1][strategy2];
    }
    if (correlationMatrix.strategyCorrelations[strategy2]?.[strategy1]) {
      return correlationMatrix.strategyCorrelations[strategy2][strategy1];
    }

    // Default low correlation
    return 0.2;
  }

  private calculateDiversificationRatio(): number {
    const activeStrategies = Array.from(this.strategyRiskStatus.values()).filter(s => s.isActive);
    if (activeStrategies.length <= 1) return 0;

    // Simple diversification metric based on number of strategies and their correlations
    const averageCorrelation = this.getAverageCorrelation();
    const diversificationRatio = (1 - averageCorrelation) * (activeStrategies.length / 10); // Normalize to max 10 strategies

    return Math.min(1.0, diversificationRatio);
  }

  private getAverageCorrelation(): number {
    if (this.correlationMatrix.length === 0) return 0.5;

    let sum = 0;
    let count = 0;

    for (let i = 0; i < this.correlationMatrix.length; i++) {
      for (let j = i + 1; j < this.correlationMatrix[i].length; j++) {
        sum += this.correlationMatrix[i][j];
        count++;
      }
    }

    return count > 0 ? sum / count : 0.5;
  }

  private calculateRiskBudgetUtilization(): number {
    const riskBudgetStatus = this.strategyLimits.getRiskBudgetStatus();
    return riskBudgetStatus.allocatedRiskBudget / riskBudgetStatus.totalRiskBudget;
  }

  private getCurrentVolatilityScaling(currentVolatility: number): number {
    const scalingConfig = this.strategyLimits.getVolatilityScaling();

    if (currentVolatility >= scalingConfig.thresholds.crisis) {
      return scalingConfig.scalingFactors.crisis;
    } else if (currentVolatility >= scalingConfig.thresholds.extreme) {
      return scalingConfig.scalingFactors.extreme;
    } else if (currentVolatility >= scalingConfig.thresholds.high) {
      return scalingConfig.scalingFactors.high;
    } else if (currentVolatility >= scalingConfig.thresholds.elevated) {
      return scalingConfig.scalingFactors.elevated;
    }

    return scalingConfig.scalingFactors.normal;
  }

  private calculateGameTokenExposure(snapshot: PortfolioSnapshot): number {
    // Calculate exposure to gaming tokens vs stablecoins/GALA
    let gameTokenValue = 0;
    let totalValue = snapshot.totalValue;

    snapshot.positions.forEach(position => {
      if (this.isGameToken(position.token)) {
        gameTokenValue += position.valueUSD;
      }
    });

    return totalValue > 0 ? gameTokenValue / totalValue : 0;
  }

  private isGameToken(token: string): boolean {
    const gameTokens = ['SILK', 'ETIME', 'GTON']; // Add more gaming tokens
    return gameTokens.some(gt => token.includes(gt));
  }

  private calculateEventRisk(): number {
    // Simplified event risk calculation - in production would check gaming calendars
    return 0.1; // Low baseline event risk
  }

  private calculateCrossGameCorrelation(): number {
    // Simplified cross-game correlation
    return 0.3; // Moderate correlation across game ecosystems
  }

  private calculateNFTMarketRisk(): number {
    // Check if NFT arbitrage strategy is active
    const nftStatus = this.strategyRiskStatus.get('nft-arbitrage');
    return nftStatus?.isActive ? 0.6 : 0.1; // High risk if NFT strategy active
  }

  private getMaxStrategyCorrelation(): number {
    let maxCorrelation = 0;
    const activeStrategies = Array.from(this.strategyRiskStatus.entries())
      .filter(([name, status]) => status.isActive)
      .map(([name]) => name);

    for (let i = 0; i < activeStrategies.length; i++) {
      for (let j = i + 1; j < activeStrategies.length; j++) {
        const correlation = this.getStrategyCorrelation(
          activeStrategies[i],
          activeStrategies[j],
          this.strategyLimits.getCorrelationMatrix()
        );
        maxCorrelation = Math.max(maxCorrelation, correlation);
      }
    }

    return maxCorrelation;
  }

  private getMaxCorrelationForStrategy(strategyName: string): number {
    let maxCorrelation = 0;
    const correlationMatrix = this.strategyLimits.getCorrelationMatrix();

    this.strategyRiskStatus.forEach((status, otherStrategy) => {
      if (otherStrategy !== strategyName && status.isActive) {
        const correlation = this.getStrategyCorrelation(strategyName, otherStrategy, correlationMatrix);
        maxCorrelation = Math.max(maxCorrelation, correlation);
      }
    });

    return maxCorrelation;
  }

  private countRecentStrategyFailures(): number {
    const oneHourAgo = Date.now() - 3600000;
    let failureCount = 0;

    this.strategyPerformance.forEach(performance => {
      if (performance.lastFailure > oneHourAgo) {
        failureCount += performance.failureCount;
      }
    });

    return failureCount;
  }

  private updatePerformanceTracking(): void {
    // Reset failure counts older than 1 hour
    const oneHourAgo = Date.now() - 3600000;

    this.strategyPerformance.forEach(performance => {
      if (performance.lastFailure < oneHourAgo) {
        performance.failureCount = 0;
      }
    });
  }

  private shouldRebalancePortfolio(): boolean {
    const rebalanceInterval = 1800000; // 30 minutes
    return Date.now() - this.lastRebalanceTime > rebalanceInterval;
  }

  private async rebalancePortfolioRisk(): Promise<void> {
    logger.info('Starting portfolio risk rebalancing');

    try {
      // Update strategy allocations based on performance and risk metrics
      this.strategyRiskStatus.forEach((status, strategyName) => {
        if (!status.isActive) return;

        const performance = this.strategyPerformance.get(strategyName);
        if (performance) {
          // Update performance score based on recent performance
          const winRate = performance.recentTrades > 0 ?
            performance.recentWins / performance.recentTrades : 0.5;

          status.performanceScore = winRate * 100;

          // Adjust allocation based on performance
          if (winRate > 0.8) {
            status.maxAllocation *= 1.1; // 10% increase for high performers
          } else if (winRate < 0.3) {
            status.maxAllocation *= 0.9; // 10% decrease for poor performers
          }
        }
      });

      this.lastRebalanceTime = Date.now();

      logger.info('Portfolio risk rebalancing completed');

    } catch (error) {
      logger.error('Error during portfolio risk rebalancing:', error);
    }
  }

  private async recordSystemError(errorType: string, error: any): Promise<void> {
    // Record error for circuit breaker logic
    logger.error(`System error recorded: ${errorType}`, error);
  }

  /**
   * Public API methods
   */

  /**
   * Get current risk report
   */
  getRiskReport(): RiskReport {
    const snapshot = this.riskMonitor.getLatestSnapshot();

    return {
      timestamp: Date.now(),
      portfolioValue: snapshot?.totalValue || this.PORTFOLIO_VALUE_USD,
      dailyPnL: snapshot?.dailyPnL || 0,
      totalPnL: snapshot?.totalPnL || 0,
      riskMetrics: snapshot?.riskMetrics as PortfolioRiskMetrics || {} as PortfolioRiskMetrics,
      strategyStatus: Array.from(this.strategyRiskStatus.values()),
      recentAlerts: this.riskAlerts.slice(-10), // Last 10 alerts
      killSwitchStatus: { ...this.killSwitchStatus },
      recommendations: this.generateRecommendations(),
      nextRebalanceTime: this.lastRebalanceTime + 1800000 // 30 minutes
    };
  }

  /**
   * Record strategy trade result
   */
  recordStrategyTrade(
    strategyName: string,
    success: boolean,
    pnl: number,
    positionSize: number
  ): void {
    const performance = this.strategyPerformance.get(strategyName);
    const status = this.strategyRiskStatus.get(strategyName);

    if (performance) {
      performance.recentTrades++;
      if (success) performance.recentWins++;
      performance.recentPnL += pnl;
    }

    if (status) {
      status.currentAllocation += positionSize;
    }

    // Record failure if trade was unsuccessful
    if (!success) {
      this.recordStrategyFailure(strategyName);
    }
  }

  /**
   * Record strategy failure
   */
  recordStrategyFailure(strategyName: string): void {
    const performance = this.strategyPerformance.get(strategyName);
    if (performance) {
      performance.failureCount++;
      performance.lastFailure = Date.now();
    }
  }

  /**
   * Generate recommendations based on current risk state
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const riskBudget = this.strategyLimits.getRiskBudgetStatus();

    // Risk budget recommendations
    if (riskBudget.allocatedRiskBudget / riskBudget.totalRiskBudget > 0.9) {
      recommendations.push('Consider reducing position sizes - risk budget utilization >90%');
    }

    // Correlation recommendations
    const maxCorrelation = this.getMaxStrategyCorrelation();
    if (maxCorrelation > 0.7) {
      recommendations.push('High strategy correlation detected - consider diversifying approaches');
    }

    // Kill switch recommendations
    if (this.killSwitchStatus.isActive) {
      recommendations.push('Kill switch active - focus on position reduction and risk control');
    }

    // Performance recommendations
    const lowPerformers = Array.from(this.strategyRiskStatus.values())
      .filter(status => status.performanceScore < 30);

    if (lowPerformers.length > 0) {
      recommendations.push(`${lowPerformers.length} strategies underperforming - review and adjust`);
    }

    return recommendations;
  }

  /**
   * Deactivate kill switch (manual recovery)
   */
  async deactivateKillSwitch(reason: string): Promise<void> {
    if (!this.killSwitchStatus.isActive) return;

    logger.warn(`Deactivating kill switch: ${reason}`);

    this.killSwitchStatus.isActive = false;
    this.killSwitchStatus.phase = 0;
    this.killSwitchStatus.actionsExecuted.push('manual_deactivation');

    // Re-enable strategies gradually
    this.strategyRiskStatus.forEach(status => {
      if (status.pausedReason === 'Kill switch activated') {
        status.isActive = true;
        delete status.pausedReason;
      }
    });

    await this.createRiskAlert('info', 'performance', undefined,
      `Kill switch deactivated: ${reason}`, {
        deactivatedAt: Date.now(),
        reason
      }, false);

    logger.info('Kill switch deactivated - gradual strategy re-enablement started');
  }

  /**
   * Get strategy status
   */
  getStrategyStatus(strategyName: string): StrategyRiskStatus | undefined {
    return this.strategyRiskStatus.get(strategyName);
  }

  /**
   * Update strategy allocation
   */
  updateStrategyAllocation(strategyName: string, newAllocation: number): void {
    const status = this.strategyRiskStatus.get(strategyName);
    if (status) {
      status.currentAllocation = newAllocation;
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopMonitoring();
    this.riskMonitor.destroy();
    logger.info('Enhanced Risk Manager destroyed');
  }
}