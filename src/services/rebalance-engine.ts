/**
 * Rebalance Engine
 * Intelligent position management and automated rebalancing system
 * Optimizes liquidity positions based on market conditions and performance
 */

import { LiquidityManager } from './liquidity-manager';
import { Position } from '../entities/Position';
import { FeeCalculator, FeeOptimization } from './fee-calculator';
import { getPositionRepository } from '../config/database';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS, STRATEGY_CONSTANTS } from '../config/constants';
import { safeParseFloat } from '../utils/safe-parse';
import BigNumber from 'bignumber.js';
import { Repository } from 'typeorm';

export interface RebalanceSignal {
  positionId: string;
  signalType: 'price_deviation' | 'low_utilization' | 'high_fees' | 'volatility_change' | 'performance_decline';
  strength: number; // 0-1, where 1 is strongest signal
  confidence: number; // 0-1, confidence in the signal
  urgency: 'low' | 'medium' | 'high' | 'critical';
  trigger: {
    currentPrice: number;
    targetPrice?: number;
    thresholdBreached: number;
    timeOutOfRange?: number;
    utilizationRate?: number;
    performanceMetric?: string;
  };
  timestamp: number;
}

export interface RebalanceAction {
  id: string;
  positionId: string;
  actionType: 'adjust_range' | 'collect_fees' | 'close_position' | 'split_position' | 'merge_positions';
  priority: number; // 1-10, where 10 is highest priority
  estimatedCost: number;
  expectedBenefit: number;
  riskScore: number; // 0-1, where 1 is highest risk
  parameters: {
    newMinPrice?: number;
    newMaxPrice?: number;
    liquidityPercentage?: number;
    splitRanges?: Array<{ min: number; max: number; allocation: number }>;
    mergeWithPositions?: string[];
    closeReason?: string;
  };
  constraints: {
    maxGasCost: number;
    minBenefitRatio: number;
    maxSlippage: number;
    requiredConfirmation?: boolean;
  };
  createdAt: number;
  scheduledFor?: number;
  executedAt?: number;
  status: 'pending' | 'scheduled' | 'executing' | 'completed' | 'failed' | 'cancelled';
}

export interface RebalanceStrategy {
  name: string;
  description: string;
  enabled: boolean;
  parameters: {
    priceDeviationThreshold: number; // Percentage
    utilizationThreshold: number; // Percentage
    feeThreshold: number; // USD amount
    volatilityThreshold: number; // Percentage change
    rebalanceInterval: number; // Milliseconds
    maxPositionsPerStrategy: number;
    riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  };
  conditions: {
    minPositionAge: number; // Milliseconds
    minPositionValue: number; // USD
    maxRebalanceFrequency: number; // Per day
    marketConditions?: 'trending' | 'ranging' | 'volatile' | 'any';
  };
}

export interface RebalanceMetrics {
  totalRebalances: number;
  successfulRebalances: number;
  failedRebalances: number;
  totalCostUSD: number;
  totalBenefitUSD: number;
  avgBenefitCostRatio: number;
  avgExecutionTime: number; // Milliseconds
  performanceImprovement: number; // Percentage
  strategiesActive: number;
  positionsManaged: number;
  lastRebalanceTime: number;
  upcomingActions: number;
}

export interface MarketCondition {
  priceVolatility: number;
  trendDirection: 'up' | 'down' | 'sideways';
  volumeChange: number;
  liquidityChange: number;
  confidence: number;
  timestamp: number;
}

export class RebalanceEngine {
  private liquidityManager: LiquidityManager;
  private feeCalculator: FeeCalculator;
  private positionRepo: Repository<Position> | null = null;
  private isRunning: boolean = false;
  private strategies: Map<string, RebalanceStrategy> = new Map();
  private activeSignals: Map<string, RebalanceSignal[]> = new Map();
  private actionQueue: RebalanceAction[] = [];
  private executionHistory: RebalanceAction[] = [];
  private marketConditions: MarketCondition[] = [];

  private readonly maxSignalsPerPosition = 10;
  private readonly maxActionQueueSize = 100;
  private readonly maxExecutionHistory = 1000;
  private readonly marketDataWindow = 24 * 60 * 60 * 1000; // 24 hours
  private readonly defaultExecutionInterval = 30000; // 30 seconds

  constructor(liquidityManager: LiquidityManager, feeCalculator: FeeCalculator) {
    this.liquidityManager = liquidityManager;
    this.feeCalculator = feeCalculator;
    this.initializeDefaultStrategies();
    logger.info('RebalanceEngine initialized');
  }

  /**
   * Initialize rebalance engine
   */
  async initialize(): Promise<void> {
    try {
      this.positionRepo = await getPositionRepository();
      await this.feeCalculator.initialize();
      logger.info('✅ RebalanceEngine database connection established');
    } catch (error) {
      logger.error('❌ Failed to initialize RebalanceEngine:', error);
      throw error;
    }
  }

  /**
   * Start the rebalance engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('RebalanceEngine already running');
      return;
    }

    try {
      logger.info('Starting RebalanceEngine...');

      // Start monitoring and execution loops
      this.startMonitoring();
      this.startExecution();

      this.isRunning = true;
      logger.info('✅ RebalanceEngine started successfully');

    } catch (error) {
      logger.error('❌ Failed to start RebalanceEngine:', error);
      throw error;
    }
  }

  /**
   * Stop the rebalance engine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('RebalanceEngine not running');
      return;
    }

    try {
      logger.info('Stopping RebalanceEngine...');

      this.isRunning = false;
      logger.info('✅ RebalanceEngine stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping RebalanceEngine:', error);
      throw error;
    }
  }

  /**
   * Add a rebalance strategy
   */
  addStrategy(strategy: RebalanceStrategy): void {
    this.strategies.set(strategy.name, strategy);
    logger.info(`Strategy added: ${strategy.name}`, {
      enabled: strategy.enabled,
      riskTolerance: strategy.parameters.riskTolerance
    });
  }

  /**
   * Remove a rebalance strategy
   */
  removeStrategy(strategyName: string): boolean {
    const removed = this.strategies.delete(strategyName);
    if (removed) {
      logger.info(`Strategy removed: ${strategyName}`);
    }
    return removed;
  }

  /**
   * Get all active strategies
   */
  getStrategies(): RebalanceStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Force analysis of all positions
   */
  async analyzeAllPositions(): Promise<RebalanceSignal[]> {
    if (!this.positionRepo) {
      throw new Error('RebalanceEngine not initialized');
    }

    try {
      const positions = await this.positionRepo.find({ where: { isActive: true } });
      const allSignals: RebalanceSignal[] = [];

      for (const position of positions) {
        const signals = await this.analyzePosition(position);
        allSignals.push(...signals);
      }

      logger.info(`Analyzed ${positions.length} positions, found ${allSignals.length} signals`);
      return allSignals;

    } catch (error) {
      logger.error('Failed to analyze all positions:', error);
      return [];
    }
  }

  /**
   * Execute a specific rebalance action
   */
  async executeAction(actionId: string): Promise<boolean> {
    const action = this.actionQueue.find(a => a.id === actionId);
    if (!action) {
      logger.error(`Action not found: ${actionId}`);
      return false;
    }

    return await this.executeRebalanceAction(action);
  }

  /**
   * Get pending actions
   */
  getPendingActions(): RebalanceAction[] {
    return this.actionQueue.filter(a => a.status === 'pending');
  }

  /**
   * Get rebalance metrics
   */
  getMetrics(): RebalanceMetrics {
    const completed = this.executionHistory.filter(a => a.status === 'completed');
    const failed = this.executionHistory.filter(a => a.status === 'failed');

    const totalCost = completed.reduce((sum, a) => sum + a.estimatedCost, 0);
    const totalBenefit = completed.reduce((sum, a) => sum + a.expectedBenefit, 0);
    const avgBenefitCostRatio = totalCost > 0 ? totalBenefit / totalCost : 0;

    const executionTimes = completed
      .filter(a => a.executedAt && a.createdAt)
      .map(a => a.executedAt! - a.createdAt);
    const avgExecutionTime = executionTimes.length > 0
      ? executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length
      : 0;

    const lastRebalanceTime = completed.length > 0
      ? Math.max(...completed.map(a => a.executedAt || 0))
      : 0;

    return {
      totalRebalances: this.executionHistory.length,
      successfulRebalances: completed.length,
      failedRebalances: failed.length,
      totalCostUSD: totalCost,
      totalBenefitUSD: totalBenefit,
      avgBenefitCostRatio,
      avgExecutionTime,
      performanceImprovement: this.calculatePerformanceImprovement(),
      strategiesActive: Array.from(this.strategies.values()).filter(s => s.enabled).length,
      positionsManaged: this.activeSignals.size,
      lastRebalanceTime,
      upcomingActions: this.actionQueue.filter(a => a.status === 'pending').length
    };
  }

  /**
   * Update market conditions
   */
  updateMarketConditions(condition: MarketCondition): void {
    this.marketConditions.push(condition);

    // Maintain window size
    const cutoffTime = Date.now() - this.marketDataWindow;
    this.marketConditions = this.marketConditions.filter(c => c.timestamp >= cutoffTime);

    logger.debug('Market conditions updated', {
      volatility: condition.priceVolatility,
      trend: condition.trendDirection,
      confidence: condition.confidence
    });
  }

  /**
   * Initialize default rebalancing strategies
   */
  private initializeDefaultStrategies(): void {
    // Conservative strategy
    this.strategies.set('conservative', {
      name: 'conservative',
      description: 'Low-risk rebalancing focused on fee collection and minimal IL',
      enabled: true,
      parameters: {
        priceDeviationThreshold: 10, // 10% price movement
        utilizationThreshold: 30, // 30% utilization minimum
        feeThreshold: 20, // $20 fee threshold
        volatilityThreshold: 5, // 5% volatility change
        rebalanceInterval: 60 * 60 * 1000, // 1 hour
        maxPositionsPerStrategy: 10,
        riskTolerance: 'conservative'
      },
      conditions: {
        minPositionAge: 24 * 60 * 60 * 1000, // 24 hours
        minPositionValue: 100, // $100
        maxRebalanceFrequency: 2, // 2 per day
        marketConditions: 'any'
      }
    });

    // Moderate strategy
    this.strategies.set('moderate', {
      name: 'moderate',
      description: 'Balanced approach optimizing for yield and capital efficiency',
      enabled: true,
      parameters: {
        priceDeviationThreshold: 7, // 7% price movement
        utilizationThreshold: 50, // 50% utilization minimum
        feeThreshold: 10, // $10 fee threshold
        volatilityThreshold: 3, // 3% volatility change
        rebalanceInterval: 30 * 60 * 1000, // 30 minutes
        maxPositionsPerStrategy: 20,
        riskTolerance: 'moderate'
      },
      conditions: {
        minPositionAge: 12 * 60 * 60 * 1000, // 12 hours
        minPositionValue: 50, // $50
        maxRebalanceFrequency: 4, // 4 per day
        marketConditions: 'any'
      }
    });

    // Aggressive strategy
    this.strategies.set('aggressive', {
      name: 'aggressive',
      description: 'High-frequency optimization for maximum yield',
      enabled: false, // Disabled by default
      parameters: {
        priceDeviationThreshold: 5, // 5% price movement
        utilizationThreshold: 70, // 70% utilization minimum
        feeThreshold: 5, // $5 fee threshold
        volatilityThreshold: 2, // 2% volatility change
        rebalanceInterval: 15 * 60 * 1000, // 15 minutes
        maxPositionsPerStrategy: 50,
        riskTolerance: 'aggressive'
      },
      conditions: {
        minPositionAge: 6 * 60 * 60 * 1000, // 6 hours
        minPositionValue: 25, // $25
        maxRebalanceFrequency: 8, // 8 per day
        marketConditions: 'volatile'
      }
    });
  }

  /**
   * Start monitoring positions for rebalance signals
   */
  private startMonitoring(): void {
    const monitoringInterval = Math.min(
      ...Array.from(this.strategies.values())
        .filter(s => s.enabled)
        .map(s => s.parameters.rebalanceInterval)
    );

    setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.analyzeAllPositions();
        } catch (error) {
          logger.error('Error in monitoring loop:', error);
        }
      }
    }, monitoringInterval);

    logger.info(`Started monitoring with interval: ${monitoringInterval}ms`);
  }

  /**
   * Start action execution loop
   */
  private startExecution(): void {
    setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.processActionQueue();
        } catch (error) {
          logger.error('Error in execution loop:', error);
        }
      }
    }, this.defaultExecutionInterval);

    logger.info(`Started execution loop with interval: ${this.defaultExecutionInterval}ms`);
  }

  /**
   * Analyze a single position for rebalance signals
   */
  private async analyzePosition(position: Position): Promise<RebalanceSignal[]> {
    const signals: RebalanceSignal[] = [];
    const now = Date.now();

    try {
      // Get current market price
      const currentPrice = await this.getCurrentPrice(position.token0, position.token1, position.fee);
      if (!currentPrice) return signals;

      // Apply each enabled strategy
      for (const strategy of this.strategies.values()) {
        if (!strategy.enabled) continue;

        // Check strategy conditions
        const positionAge = now - position.createdAt.getTime();
        if (positionAge < strategy.conditions.minPositionAge) continue;
        if (position.currentValueUSD < strategy.conditions.minPositionValue) continue;

        // Check rebalance frequency limit
        const recentRebalances = this.getRecentRebalances(position.id, 24 * 60 * 60 * 1000);
        if (recentRebalances >= strategy.conditions.maxRebalanceFrequency) continue;

        // Analyze price deviation
        const priceDeviation = this.calculatePriceDeviation(position, currentPrice);
        if (priceDeviation >= strategy.parameters.priceDeviationThreshold) {
          signals.push({
            positionId: position.id,
            signalType: 'price_deviation',
            strength: Math.min(1, priceDeviation / strategy.parameters.priceDeviationThreshold),
            confidence: 0.8,
            urgency: priceDeviation > strategy.parameters.priceDeviationThreshold * 1.5 ? 'high' : 'medium',
            trigger: {
              currentPrice,
              targetPrice: (position.minPrice + position.maxPrice) / 2,
              thresholdBreached: priceDeviation
            },
            timestamp: now
          });
        }

        // Analyze utilization
        const utilization = this.calculateUtilization(position, currentPrice);
        if (utilization < strategy.parameters.utilizationThreshold) {
          signals.push({
            positionId: position.id,
            signalType: 'low_utilization',
            strength: 1 - (utilization / strategy.parameters.utilizationThreshold),
            confidence: 0.7,
            urgency: utilization < strategy.parameters.utilizationThreshold * 0.5 ? 'high' : 'medium',
            trigger: {
              currentPrice,
              utilizationRate: utilization,
              thresholdBreached: strategy.parameters.utilizationThreshold - utilization
            },
            timestamp: now
          });
        }

        // Analyze uncollected fees
        const uncollectedFeesUSD = parseFloat(position.uncollectedFees0) + parseFloat(position.uncollectedFees1);
        if (uncollectedFeesUSD >= strategy.parameters.feeThreshold) {
          signals.push({
            positionId: position.id,
            signalType: 'high_fees',
            strength: Math.min(1, uncollectedFeesUSD / (strategy.parameters.feeThreshold * 2)),
            confidence: 0.9,
            urgency: uncollectedFeesUSD > strategy.parameters.feeThreshold * 3 ? 'high' : 'low',
            trigger: {
              currentPrice,
              thresholdBreached: uncollectedFeesUSD
            },
            timestamp: now
          });
        }
      }

      // Store signals for the position
      if (signals.length > 0) {
        this.storeSignals(position.id, signals);
        await this.generateActions(position, signals);
      }

    } catch (error) {
      logger.error(`Error analyzing position ${position.id}:`, error);
    }

    return signals;
  }

  /**
   * Get current price for token pair
   */
  private async getCurrentPrice(token0: string, token1: string, fee: number): Promise<number | null> {
    try {
      const poolData = await this.liquidityManager['gswap'].pools.getPoolData(token0, token1, fee);
      if (!poolData) return null;

      const price = this.liquidityManager['gswap'].pools.calculateSpotPrice(token0, token1, poolData.sqrtPrice);
      return safeParseFloat(price.toString(), 0);

    } catch (error) {
      logger.error('Failed to get current price:', error);
      return null;
    }
  }

  /**
   * Calculate price deviation percentage
   */
  private calculatePriceDeviation(position: Position, currentPrice: number): number {
    const centerPrice = (position.minPrice + position.maxPrice) / 2;
    return Math.abs(currentPrice - centerPrice) / centerPrice * 100;
  }

  /**
   * Calculate position utilization
   */
  private calculateUtilization(position: Position, currentPrice: number): number {
    const inRange = currentPrice >= position.minPrice && currentPrice <= position.maxPrice;
    return inRange ? 100 : 0; // Simplified - in practice, would track over time
  }

  /**
   * Get recent rebalance count for a position
   */
  private getRecentRebalances(positionId: string, timeWindow: number): number {
    const cutoffTime = Date.now() - timeWindow;
    return this.executionHistory.filter(action =>
      action.positionId === positionId &&
      action.status === 'completed' &&
      (action.executedAt || 0) >= cutoffTime
    ).length;
  }

  /**
   * Store signals for a position
   */
  private storeSignals(positionId: string, newSignals: RebalanceSignal[]): void {
    const existingSignals = this.activeSignals.get(positionId) || [];
    const allSignals = [...existingSignals, ...newSignals];

    // Keep only recent signals
    const cutoffTime = Date.now() - (60 * 60 * 1000); // 1 hour
    const recentSignals = allSignals
      .filter(signal => signal.timestamp >= cutoffTime)
      .slice(-this.maxSignalsPerPosition);

    this.activeSignals.set(positionId, recentSignals);
  }

  /**
   * Generate rebalance actions from signals
   */
  private async generateActions(position: Position, signals: RebalanceSignal[]): Promise<void> {
    for (const signal of signals) {
      const action = await this.createActionFromSignal(position, signal);
      if (action) {
        this.addActionToQueue(action);
      }
    }
  }

  /**
   * Create a rebalance action from a signal
   */
  private async createActionFromSignal(position: Position, signal: RebalanceSignal): Promise<RebalanceAction | null> {
    try {
      const actionId = this.generateActionId();
      const now = Date.now();

      switch (signal.signalType) {
        case 'price_deviation':
        case 'low_utilization':
          // Adjust range action
          const currentPrice = signal.trigger.currentPrice;
          const rangeWidth = (position.maxPrice - position.minPrice) / currentPrice;
          const newRange = this.calculateOptimalRange(currentPrice, rangeWidth);

          return {
            id: actionId,
            positionId: position.id,
            actionType: 'adjust_range',
            priority: this.calculatePriority(signal),
            estimatedCost: await this.estimateRebalanceCost(position),
            expectedBenefit: await this.estimateRebalanceBenefit(position, newRange),
            riskScore: this.calculateRiskScore(signal),
            parameters: {
              newMinPrice: newRange.min,
              newMaxPrice: newRange.max,
              liquidityPercentage: 100
            },
            constraints: {
              maxGasCost: 50, // $50 max gas
              minBenefitRatio: 1.2, // 20% minimum benefit over cost
              maxSlippage: 0.01 // 1% max slippage
            },
            createdAt: now,
            status: 'pending'
          };

        case 'high_fees':
          // Fee collection action
          return {
            id: actionId,
            positionId: position.id,
            actionType: 'collect_fees',
            priority: this.calculatePriority(signal),
            estimatedCost: 10, // $10 gas cost
            expectedBenefit: signal.trigger.thresholdBreached,
            riskScore: 0.1, // Low risk
            parameters: {},
            constraints: {
              maxGasCost: 20,
              minBenefitRatio: 2, // 100% minimum benefit over cost
              maxSlippage: 0.005
            },
            createdAt: now,
            status: 'pending'
          };

        default:
          return null;
      }

    } catch (error) {
      logger.error('Failed to create action from signal:', error);
      return null;
    }
  }

  /**
   * Calculate optimal range around current price
   */
  private calculateOptimalRange(currentPrice: number, rangeWidth: number): { min: number; max: number } {
    const halfRange = currentPrice * rangeWidth / 2;
    return {
      min: currentPrice - halfRange,
      max: currentPrice + halfRange
    };
  }

  /**
   * Calculate action priority
   */
  private calculatePriority(signal: RebalanceSignal): number {
    let priority = signal.strength * 5; // Base priority from signal strength

    // Adjust for urgency
    switch (signal.urgency) {
      case 'critical': priority += 4; break;
      case 'high': priority += 2; break;
      case 'medium': priority += 1; break;
      case 'low': priority += 0; break;
    }

    // Adjust for confidence
    priority *= signal.confidence;

    return Math.min(10, Math.max(1, Math.round(priority)));
  }

  /**
   * Calculate risk score
   */
  private calculateRiskScore(signal: RebalanceSignal): number {
    let risk = 0.3; // Base risk

    // Higher risk for larger deviations
    if (signal.signalType === 'price_deviation') {
      risk += Math.min(0.4, signal.strength * 0.4);
    }

    // Lower risk for fee collection
    if (signal.signalType === 'high_fees') {
      risk = 0.1;
    }

    return Math.min(1, risk);
  }

  /**
   * Estimate rebalance cost
   */
  private async estimateRebalanceCost(position: Position): Promise<number> {
    // Simplified cost estimation - gas + slippage
    const baseCost = 30; // Base gas cost
    const slippageCost = position.currentValueUSD * 0.005; // 0.5% slippage
    return baseCost + slippageCost;
  }

  /**
   * Estimate rebalance benefit
   */
  private async estimateRebalanceBenefit(position: Position, newRange: { min: number; max: number }): Promise<number> {
    // Simplified benefit estimation based on improved utilization
    const currentUtilization = position.timeInRangePercent;
    const expectedUtilization = 80; // Assume 80% with new range
    const utilizationImprovement = (expectedUtilization - currentUtilization) / 100;

    // Estimate additional fees from improved utilization
    const dailyVolume = position.currentValueUSD * 0.1; // Assume 10% daily volume
    const feeRate = position.fee / 1000000; // Fee tier in decimal
    const additionalFees = dailyVolume * feeRate * utilizationImprovement * 365; // Annualized

    return Math.max(0, additionalFees);
  }

  /**
   * Add action to execution queue
   */
  private addActionToQueue(action: RebalanceAction): void {
    this.actionQueue.push(action);

    // Sort by priority (highest first)
    this.actionQueue.sort((a, b) => b.priority - a.priority);

    // Maintain queue size
    if (this.actionQueue.length > this.maxActionQueueSize) {
      const removed = this.actionQueue.splice(this.maxActionQueueSize);
      logger.warn(`Action queue overflow, removed ${removed.length} actions`);
    }

    logger.info(`Action added to queue: ${action.actionType} for position ${action.positionId}`, {
      priority: action.priority,
      estimatedBenefit: action.expectedBenefit.toFixed(2),
      queueSize: this.actionQueue.length
    });
  }

  /**
   * Process action queue
   */
  private async processActionQueue(): Promise<void> {
    const pendingActions = this.actionQueue.filter(a => a.status === 'pending');
    if (pendingActions.length === 0) return;

    // Execute highest priority action
    const action = pendingActions[0];
    await this.executeRebalanceAction(action);
  }

  /**
   * Execute a rebalance action
   */
  private async executeRebalanceAction(action: RebalanceAction): Promise<boolean> {
    try {
      logger.info(`Executing rebalance action: ${action.actionType} for position ${action.positionId}`);

      action.status = 'executing';
      const startTime = Date.now();

      let success = false;

      switch (action.actionType) {
        case 'adjust_range':
          success = await this.executeRangeAdjustment(action);
          break;
        case 'collect_fees':
          success = await this.executeFeeCollection(action);
          break;
        case 'close_position':
          success = await this.executePositionClose(action);
          break;
        default:
          logger.error(`Unknown action type: ${action.actionType}`);
          success = false;
      }

      // Update action status
      action.status = success ? 'completed' : 'failed';
      action.executedAt = Date.now();

      // Move to history
      this.moveActionToHistory(action);

      logger.info(`Action ${action.id} ${success ? 'completed' : 'failed'} in ${Date.now() - startTime}ms`);

      return success;

    } catch (error) {
      logger.error(`Failed to execute action ${action.id}:`, error);
      action.status = 'failed';
      action.executedAt = Date.now();
      this.moveActionToHistory(action);
      return false;
    }
  }

  /**
   * Execute range adjustment
   */
  private async executeRangeAdjustment(action: RebalanceAction): Promise<boolean> {
    if (!action.parameters.newMinPrice || !action.parameters.newMaxPrice) {
      return false;
    }

    try {
      await this.liquidityManager.rebalancePosition({
        positionId: action.positionId,
        newMinPrice: action.parameters.newMinPrice,
        newMaxPrice: action.parameters.newMaxPrice,
        slippageTolerance: action.constraints.maxSlippage
      });

      return true;

    } catch (error) {
      logger.error(`Failed to execute range adjustment:`, error);
      return false;
    }
  }

  /**
   * Execute fee collection
   */
  private async executeFeeCollection(action: RebalanceAction): Promise<boolean> {
    try {
      await this.liquidityManager.collectFees({
        positionId: action.positionId
      });

      return true;

    } catch (error) {
      logger.error(`Failed to execute fee collection:`, error);
      return false;
    }
  }

  /**
   * Execute position close
   */
  private async executePositionClose(action: RebalanceAction): Promise<boolean> {
    try {
      const position = await this.liquidityManager.getPosition(action.positionId);
      if (!position) return false;

      await this.liquidityManager.removeLiquidity({
        positionId: action.positionId,
        liquidity: position.liquidity,
        slippageTolerance: action.constraints.maxSlippage
      });

      return true;

    } catch (error) {
      logger.error(`Failed to execute position close:`, error);
      return false;
    }
  }

  /**
   * Move action to history
   */
  private moveActionToHistory(action: RebalanceAction): void {
    // Remove from queue
    const queueIndex = this.actionQueue.findIndex(a => a.id === action.id);
    if (queueIndex >= 0) {
      this.actionQueue.splice(queueIndex, 1);
    }

    // Add to history
    this.executionHistory.push(action);

    // Maintain history size
    if (this.executionHistory.length > this.maxExecutionHistory) {
      this.executionHistory = this.executionHistory.slice(-this.maxExecutionHistory);
    }
  }

  /**
   * Calculate performance improvement
   */
  private calculatePerformanceImprovement(): number {
    // Simplified calculation based on successful vs failed actions
    const completed = this.executionHistory.filter(a => a.status === 'completed');
    const failed = this.executionHistory.filter(a => a.status === 'failed');

    if (completed.length + failed.length === 0) return 0;

    const successRate = completed.length / (completed.length + failed.length);
    return successRate * 100;
  }

  /**
   * Generate unique action ID
   */
  private generateActionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `rb_${timestamp}_${random}`;
  }
}