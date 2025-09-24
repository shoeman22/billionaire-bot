/**
 * Market Making Strategy
 * Concentrated liquidity market making with automated rebalancing
 * Provides liquidity around current price and adjusts positions as price moves
 */

import { LiquidityManager, AddLiquidityParams } from '../services/liquidity-manager';
import { Position } from '../entities/Position';
import { logger } from '../utils/logger';
import { QuoteResult } from '../utils/quote-api';
// Unused imports removed
// import { TRADING_CONSTANTS, STRATEGY_CONSTANTS } from '../config/constants';
import { safeParseFloat } from '../utils/safe-parse';
import { createQuoteWrapper } from '../utils/quote-api';
// import BigNumber from 'bignumber.js';

export interface MarketMakingConfig {
  token0: string;
  token1: string;
  fee: number;
  totalCapital: string; // Total capital to deploy
  rangeWidth: number; // Range width as percentage (e.g., 0.1 = 10%)
  spread: number; // Target spread percentage (e.g., 0.002 = 0.2%)
  rebalanceThreshold: number; // Price movement % that triggers rebalance
  autoRebalance: boolean;
  feeCollectionThreshold: number; // Fee % that triggers collection
  riskParameters: {
    maxPositionValue: number; // Max USD value per position
    maxDrawdown: number; // Max acceptable drawdown %
    utilizationTarget: number; // Target % of time in range
  };
  slippageTolerance?: number;
}

export interface MarketMakingPosition {
  id: string;
  type: 'main' | 'hedge' | 'range_extension';
  position: Position;
  createdPrice: number;
  targetRange: { min: number; max: number };
  isActive: boolean;
  performance: {
    feesEarned: number;
    impermanentLoss: number;
    apr: number;
    utilization: number;
  };
}

export interface MarketMakingMetrics {
  totalValue: number;
  totalFeesEarned: number;
  netProfit: number;
  apr: number;
  utilization: number;
  impermanentLoss: number;
  rebalanceCount: number;
  uptime: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface RebalanceAction {
  type: 'create' | 'close' | 'adjust';
  positionId?: string;
  newRange?: { min: number; max: number };
  reason: string;
  priority: 'low' | 'medium' | 'high';
  estimatedCost: number;
  expectedBenefit: number;
}

export class MarketMakingStrategy {
  private liquidityManager: LiquidityManager;
  private config: MarketMakingConfig;
  private positions: Map<string, MarketMakingPosition> = new Map();
  private isRunning: boolean = false;
  private startTime: number = 0;
  private lastRebalance: number = 0;
  private priceHistory: Array<{ price: number; timestamp: number }> = [];
  private performanceHistory: Array<{ timestamp: number; value: number; fees: number }> = [];
  private quoteWrapper: { quoteExactInput: (tokenIn: string, tokenOut: string, amountIn: number | string) => Promise<QuoteResult> }; // Working quote API wrapper

  private readonly maxPriceHistory = 1000;
  private readonly maxPerformanceHistory = 10000;
  private readonly rebalanceInterval = 30000; // 30 seconds minimum between rebalances

  constructor(liquidityManager: LiquidityManager, config: MarketMakingConfig) {
    this.liquidityManager = liquidityManager;
    this.config = config;

    // Initialize working quote wrapper
    this.quoteWrapper = createQuoteWrapper(process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com');

    logger.info('MarketMakingStrategy initialized', {
      tokenPair: `${config.token0}/${config.token1}`,
      rangeWidth: `${config.rangeWidth * 100}%`,
      totalCapital: config.totalCapital
    });
  }

  /**
   * Start market making strategy
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Market making strategy already running');
      return;
    }

    try {
      logger.info('Starting market making strategy...');

      // Validate configuration
      this.validateConfig();

      // Initialize positions
      await this.initializePositions();

      // Start monitoring
      this.startTime = Date.now();
      this.isRunning = true;

      logger.info('✅ Market making strategy started successfully');

    } catch (error) {
      logger.error('❌ Failed to start market making strategy:', error);
      throw error;
    }
  }

  /**
   * Stop market making strategy
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Market making strategy not running');
      return;
    }

    try {
      logger.info('Stopping market making strategy...');

      // Close all positions if requested
      // Note: In practice, you might want to keep positions open
      // await this.closeAllPositions();

      this.isRunning = false;
      logger.info('✅ Market making strategy stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping market making strategy:', error);
      throw error;
    }
  }

  /**
   * Update strategy (check for rebalancing opportunities)
   */
  async update(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get current price
      const currentPrice = await this.getCurrentPrice();
      if (!currentPrice) return;

      // Update price history
      this.updatePriceHistory(currentPrice);

      // Update position performance
      await this.updatePositionPerformance(currentPrice);

      // Check for rebalancing opportunities
      if (this.shouldCheckRebalance()) {
        const actions = await this.analyzeRebalanceActions(currentPrice);
        if (actions.length > 0) {
          await this.executeRebalanceActions(actions);
        }
      }

      // Collect fees if threshold is met
      await this.collectFeesIfNeeded();

      // Update performance metrics
      this.updatePerformanceHistory();

    } catch (error) {
      logger.error('Error updating market making strategy:', error);
    }
  }

  /**
   * Get current strategy metrics
   */
  async getMetrics(): Promise<MarketMakingMetrics> {
    const positions = Array.from(this.positions.values());
    const activePositions = positions.filter(p => p.isActive);

    const totalValue = activePositions.reduce((sum, p) => sum + p.position.currentValueUSD, 0);
    const totalFeesEarned = activePositions.reduce((sum, p) =>
      sum + safeParseFloat(p.position.totalFeesCollected0, 0) + safeParseFloat(p.position.totalFeesCollected1, 0), 0);

    const avgUtilization = activePositions.length > 0
      ? activePositions.reduce((sum, p) => sum + p.performance.utilization, 0) / activePositions.length
      : 0;

    const totalIL = activePositions.reduce((sum, p) => sum + p.position.impermanentLoss, 0);
    const netProfit = totalFeesEarned + totalIL;

    const runTime = this.isRunning ? (Date.now() - this.startTime) / 1000 / 3600 : 0; // hours
    const apr = runTime > 0 && totalValue > 0 ? (netProfit / totalValue) * (365 * 24 / runTime) * 100 : 0;

    const uptime = this.isRunning ? (Date.now() - this.startTime) / 1000 : 0;
    const rebalanceCount = positions.reduce((sum, p) => sum + p.position.rebalanceCount, 0);

    return {
      totalValue,
      totalFeesEarned,
      netProfit,
      apr,
      utilization: avgUtilization,
      impermanentLoss: totalIL,
      rebalanceCount,
      uptime,
      sharpeRatio: this.calculateSharpeRatio(),
      maxDrawdown: this.calculateMaxDrawdown()
    };
  }

  /**
   * Get strategy positions
   */
  getPositions(): MarketMakingPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get active positions only
   */
  getActivePositions(): MarketMakingPosition[] {
    return Array.from(this.positions.values()).filter(p => p.isActive);
  }

  /**
   * Force rebalance
   */
  async forceRebalance(): Promise<RebalanceAction[]> {
    const currentPrice = await this.getCurrentPrice();
    if (!currentPrice) {
      throw new Error('Unable to get current price for rebalancing');
    }

    const actions = await this.analyzeRebalanceActions(currentPrice);
    if (actions.length > 0) {
      await this.executeRebalanceActions(actions);
    }

    return actions;
  }

  /**
   * Initialize market making positions
   */
  private async initializePositions(): Promise<void> {
    const currentPrice = await this.getCurrentPrice();
    if (!currentPrice) {
      throw new Error('Unable to get current price for initialization');
    }

    logger.info(`Initializing positions around price: ${currentPrice.toFixed(6)}`);

    // Create main concentrated liquidity position
    const mainRange = this.calculateOptimalRange(currentPrice, this.config.rangeWidth);
    const mainPositionId = await this.createPosition('main', mainRange, currentPrice);

    logger.info(`✅ Main position created: ${mainPositionId}`, {
      range: `${mainRange.min.toFixed(6)} - ${mainRange.max.toFixed(6)}`,
      currentPrice: currentPrice.toFixed(6)
    });
  }

  /**
   * Create a new position
   */
  private async createPosition(
    type: 'main' | 'hedge' | 'range_extension',
    range: { min: number; max: number },
    currentPrice: number
  ): Promise<string> {
    const capitalAllocation = this.calculateCapitalAllocation(type);
    const amounts = this.calculateOptimalAmounts(capitalAllocation, currentPrice, range);

    const liquidityParams: AddLiquidityParams = {
      token0: this.config.token0,
      token1: this.config.token1,
      fee: this.config.fee,
      minPrice: range.min,
      maxPrice: range.max,
      amount0Desired: amounts.amount0,
      amount1Desired: amounts.amount1,
      slippageTolerance: this.config.slippageTolerance
    };

    const positionId = await this.liquidityManager.addLiquidityByPrice(liquidityParams);
    const position = await this.liquidityManager.getPosition(positionId);

    if (!position) {
      throw new Error('Failed to retrieve created position');
    }

    // Convert LiquidityPosition to Position for storage
    const convertedPosition = this.convertLiquidityPositionToPosition(position);

    // Store position with metadata
    const mmPosition: MarketMakingPosition = {
      id: positionId,
      type,
      position: convertedPosition,
      createdPrice: currentPrice,
      targetRange: range,
      isActive: true,
      performance: {
        feesEarned: 0,
        impermanentLoss: 0,
        apr: 0,
        utilization: 1 // Starts in range
      }
    };

    this.positions.set(positionId, mmPosition);
    return positionId;
  }

  /**
   * Get current price for the token pair
   */
  private async getCurrentPrice(): Promise<number | null> {
    try {
      const quote = await this.quoteWrapper.quoteExactInput(
        this.config.token0,
        this.config.token1,
        1
      );

      if (!quote || !quote.currentPoolSqrtPrice) {
        logger.error('No quote or price data available');
        return null;
      }

      const price = this.liquidityManager.calculateSpotPrice(
        this.config.token0,
        this.config.token1,
        quote.currentPoolSqrtPrice
      );

      return price;

    } catch (error) {
      logger.error('Failed to get current price:', error);
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
   * Calculate capital allocation based on position type
   */
  private calculateCapitalAllocation(type: 'main' | 'hedge' | 'range_extension'): number {
    const totalCapital = safeParseFloat(this.config.totalCapital, 0);

    switch (type) {
      case 'main':
        return totalCapital * 0.8; // 80% for main position
      case 'hedge':
        return totalCapital * 0.15; // 15% for hedging
      case 'range_extension':
        return totalCapital * 0.05; // 5% for range extensions
      default:
        return totalCapital * 0.8;
    }
  }

  /**
   * Calculate optimal token amounts for position
   */
  private calculateOptimalAmounts(
    capital: number,
    currentPrice: number,
    range: { min: number; max: number }
  ): { amount0: string; amount1: string } {
    // For concentrated liquidity, we need to calculate the optimal ratio
    // This is a simplified calculation - in practice, you'd use the SDK's calculation

    const isCurrentInRange = currentPrice >= range.min && currentPrice <= range.max;

    if (!isCurrentInRange) {
      // If current price is outside range, provide 100% of one token
      if (currentPrice < range.min) {
        // Price below range, provide token0 only
        return { amount0: capital.toString(), amount1: '0' };
      } else {
        // Price above range, provide token1 only
        return { amount0: '0', amount1: capital.toString() };
      }
    }

    // If in range, provide balanced amounts (simplified)
    const halfCapital = capital / 2;
    return {
      amount0: halfCapital.toString(),
      amount1: halfCapital.toString()
    };
  }

  /**
   * Update price history
   */
  private updatePriceHistory(price: number): void {
    this.priceHistory.push({ price, timestamp: Date.now() });

    // Maintain history size
    if (this.priceHistory.length > this.maxPriceHistory) {
      this.priceHistory = this.priceHistory.slice(-this.maxPriceHistory);
    }
  }

  /**
   * Update position performance metrics
   */
  private async updatePositionPerformance(currentPrice: number): Promise<void> {
    for (const [positionId, mmPosition] of this.positions) {
      if (!mmPosition.isActive) continue;

      try {
        // Update position range status
        const inRange = currentPrice >= mmPosition.targetRange.min && currentPrice <= mmPosition.targetRange.max;
        mmPosition.position.inRange = inRange;

        // Calculate performance metrics
        const feesEarned = safeParseFloat(mmPosition.position.totalFeesCollected0, 0) + safeParseFloat(mmPosition.position.totalFeesCollected1, 0);
        mmPosition.performance.feesEarned = feesEarned;
        mmPosition.performance.impermanentLoss = mmPosition.position.impermanentLoss;
        mmPosition.performance.apr = mmPosition.position.calculateCurrentAPR();

        // Update utilization (simplified)
        mmPosition.performance.utilization = inRange ? 1 : 0;

      } catch (error) {
        logger.error(`Error updating performance for position ${positionId}:`, error);
      }
    }
  }

  /**
   * Check if we should analyze for rebalancing
   */
  private shouldCheckRebalance(): boolean {
    const now = Date.now();
    const timeSinceLastRebalance = now - this.lastRebalance;
    return timeSinceLastRebalance >= this.rebalanceInterval;
  }

  /**
   * Analyze potential rebalancing actions
   */
  private async analyzeRebalanceActions(currentPrice: number): Promise<RebalanceAction[]> {
    const actions: RebalanceAction[] = [];
    const activePositions = this.getActivePositions();

    for (const mmPosition of activePositions) {
      const priceChange = Math.abs(currentPrice - mmPosition.createdPrice) / mmPosition.createdPrice;

      // Check if rebalance is needed
      if (priceChange > this.config.rebalanceThreshold) {
        // Position is significantly out of range
        if (currentPrice < mmPosition.targetRange.min || currentPrice > mmPosition.targetRange.max) {
          const newRange = this.calculateOptimalRange(currentPrice, this.config.rangeWidth);

          actions.push({
            type: 'adjust',
            positionId: mmPosition.id,
            newRange,
            reason: `Price moved ${(priceChange * 100).toFixed(2)}% from creation price`,
            priority: priceChange > 0.2 ? 'high' : 'medium',
            estimatedCost: this.estimateRebalanceCost(mmPosition),
            expectedBenefit: this.estimateRebalanceBenefit(mmPosition, newRange, currentPrice)
          });
        }
      }

      // Check for range extension opportunities
      const rangeUtilization = this.calculateRangeUtilization(mmPosition, currentPrice);
      if (rangeUtilization < 0.3) { // Less than 30% utilization
        actions.push({
          type: 'create',
          reason: 'Low range utilization, extending range',
          priority: 'low',
          estimatedCost: safeParseFloat(this.config.totalCapital, 0) * 0.05,
          expectedBenefit: this.estimateExtensionBenefit(currentPrice)
        });
      }
    }

    return actions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Execute rebalancing actions
   */
  private async executeRebalanceActions(actions: RebalanceAction[]): Promise<void> {
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'adjust':
            if (action.positionId && action.newRange) {
              await this.rebalancePosition(action.positionId, action.newRange);
            }
            break;
          case 'create':
            if (action.newRange) {
              const currentPrice = await this.getCurrentPrice();
              if (currentPrice) {
                await this.createPosition('range_extension', action.newRange, currentPrice);
              }
            }
            break;
          case 'close':
            if (action.positionId) {
              await this.closePosition(action.positionId);
            }
            break;
        }

        logger.info(`Executed rebalance action: ${action.type}`, action);

      } catch (error) {
        logger.error(`Failed to execute rebalance action:`, error);
      }
    }

    this.lastRebalance = Date.now();
  }

  /**
   * Rebalance a position to a new range
   */
  private async rebalancePosition(positionId: string, newRange: { min: number; max: number }): Promise<void> {
    const mmPosition = this.positions.get(positionId);
    if (!mmPosition) return;

    logger.info(`Rebalancing position ${positionId}`, {
      oldRange: `${mmPosition.targetRange.min.toFixed(6)} - ${mmPosition.targetRange.max.toFixed(6)}`,
      newRange: `${newRange.min.toFixed(6)} - ${newRange.max.toFixed(6)}`
    });

    // Use the LiquidityManager's rebalance method
    const newPositionId = await this.liquidityManager.rebalancePosition({
      positionId,
      newMinPrice: newRange.min,
      newMaxPrice: newRange.max,
      slippageTolerance: this.config.slippageTolerance
    });

    // Update tracking
    mmPosition.isActive = false;
    const newPosition = await this.liquidityManager.getPosition(newPositionId);

    if (newPosition) {
      const currentPrice = await this.getCurrentPrice();
      const convertedNewPosition = this.convertLiquidityPositionToPosition(newPosition);

      const newMmPosition: MarketMakingPosition = {
        ...mmPosition,
        id: newPositionId,
        position: convertedNewPosition,
        createdPrice: currentPrice || mmPosition.createdPrice,
        targetRange: newRange,
        isActive: true
      };

      this.positions.set(newPositionId, newMmPosition);
      // Remove incrementRebalance call as it doesn't exist on LiquidityPosition
    }
  }

  /**
   * Close a position
   */
  private async closePosition(positionId: string): Promise<void> {
    const mmPosition = this.positions.get(positionId);
    if (!mmPosition) return;

    await this.liquidityManager.removeLiquidity({
      positionId,
      liquidity: mmPosition.position.liquidity,
      slippageTolerance: this.config.slippageTolerance
    });

    mmPosition.isActive = false;
    logger.info(`Position closed: ${positionId}`);
  }

  /**
   * Collect fees if threshold is met
   */
  private async collectFeesIfNeeded(): Promise<void> {
    const activePositions = this.getActivePositions();

    for (const mmPosition of activePositions) {
      const totalFees = safeParseFloat(mmPosition.position.uncollectedFees0, 0) + safeParseFloat(mmPosition.position.uncollectedFees1, 0);
      const positionValue = mmPosition.position.currentValueUSD;

      if (positionValue > 0 && (totalFees / positionValue) > this.config.feeCollectionThreshold) {
        try {
          await this.liquidityManager.collectFees({
            positionId: mmPosition.position.id
          });

          logger.info(`Fees collected for position ${mmPosition.id}: ${totalFees.toFixed(6)}`);

        } catch (error) {
          logger.error(`Failed to collect fees for position ${mmPosition.id}:`, error);
        }
      }
    }
  }

  /**
   * Update performance history
   */
  private updatePerformanceHistory(): void {
    const totalValue = this.getActivePositions().reduce((sum, p) => sum + p.position.currentValueUSD, 0);
    const totalFees = this.getActivePositions().reduce((sum, p) =>
      sum + safeParseFloat(p.position.totalFeesCollected0, 0) + safeParseFloat(p.position.totalFeesCollected1, 0), 0);

    this.performanceHistory.push({
      timestamp: Date.now(),
      value: totalValue,
      fees: totalFees
    });

    // Maintain history size
    if (this.performanceHistory.length > this.maxPerformanceHistory) {
      this.performanceHistory = this.performanceHistory.slice(-this.maxPerformanceHistory);
    }
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(): number {
    if (this.performanceHistory.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < this.performanceHistory.length; i++) {
      const prev = this.performanceHistory[i - 1];
      const curr = this.performanceHistory[i];

      if (prev.value > 0) {
        const returnRate = (curr.value - prev.value) / prev.value;
        returns.push(returnRate);
      }
    }

    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    return volatility > 0 ? avgReturn / volatility : 0;
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(): number {
    if (this.performanceHistory.length < 2) return 0;

    let maxDrawdown = 0;
    let peak = this.performanceHistory[0].value;

    for (const point of this.performanceHistory) {
      if (point.value > peak) {
        peak = point.value;
      }

      const drawdown = peak > 0 ? (peak - point.value) / peak : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown * 100; // Return as percentage
  }

  /**
   * Estimate rebalance cost
   */
  private estimateRebalanceCost(position: MarketMakingPosition): number {
    // Simplified cost estimation - gas + slippage
    const baseCost = 50; // Base gas cost in USD
    const slippageCost = position.position.currentValueUSD * (this.config.slippageTolerance || 0.01);
    return baseCost + slippageCost;
  }

  /**
   * Estimate rebalance benefit
   */
  private estimateRebalanceBenefit(position: MarketMakingPosition, newRange: { min: number; max: number }, currentPrice: number): number {
    // Simplified benefit estimation based on expected fee generation
    const _rangeWidth = (newRange.max - newRange.min) / currentPrice;
    const expectedVolume = position.position.currentValueUSD * 0.1; // Assume 10% daily volume
    const expectedFees = expectedVolume * (this.config.fee / 1000000); // Fee tier in basis points
    return expectedFees * 365; // Annualized
  }

  /**
   * Calculate range utilization
   */
  private calculateRangeUtilization(position: MarketMakingPosition, currentPrice: number): number {
    const inRange = currentPrice >= position.targetRange.min && currentPrice <= position.targetRange.max;
    return inRange ? 1 : 0; // Simplified - in practice, you'd track over time
  }

  /**
   * Estimate extension benefit
   */
  private estimateExtensionBenefit(currentPrice: number): number {
    // Simplified benefit estimation for range extensions
    return currentPrice * 0.001; // 0.1% of current price as potential benefit
  }

  /**
   * Validate strategy configuration
   */
  private validateConfig(): void {
    if (!this.config.token0 || !this.config.token1) {
      throw new Error('Token0 and token1 are required');
    }

    if (this.config.rangeWidth <= 0 || this.config.rangeWidth > 1) {
      throw new Error('Range width must be between 0 and 100%');
    }

    if (safeParseFloat(this.config.totalCapital, 0) <= 0) {
      throw new Error('Total capital must be positive');
    }

    if (this.config.rebalanceThreshold <= 0) {
      throw new Error('Rebalance threshold must be positive');
    }
  }

  /**
   * Initialize strategy - required for TradingEngine compatibility
   */
  async initialize(): Promise<void> {
    await this.start();
  }

  /**
   * Execute strategy - required for TradingEngine compatibility
   */
  async execute(): Promise<void> {
    await this.update();
  }

  /**
   * Convert LiquidityPosition to Position for compatibility
   */
  private convertLiquidityPositionToPosition(liquidityPosition: any): Position { // eslint-disable-line @typescript-eslint/no-explicit-any
    const position = new Position();
    position.id = liquidityPosition.id;
    position.walletAddress = 'market-making'; // Default wallet address
    position.token0 = liquidityPosition.token0;
    position.token1 = liquidityPosition.token1;
    position.token0Symbol = liquidityPosition.token0?.split('$')[0] || 'UNK';
    position.token1Symbol = liquidityPosition.token1?.split('$')[0] || 'UNK';
    position.fee = liquidityPosition.fee;
    position.tickLower = liquidityPosition.tickLower;
    position.tickUpper = liquidityPosition.tickUpper;
    position.minPrice = liquidityPosition.minPrice;
    position.maxPrice = liquidityPosition.maxPrice;
    position.liquidity = liquidityPosition.liquidity;
    position.amount0 = liquidityPosition.amount0;
    position.amount1 = liquidityPosition.amount1;
    position.uncollectedFees0 = liquidityPosition.uncollectedFees0;
    position.uncollectedFees1 = liquidityPosition.uncollectedFees1;
    position.inRange = liquidityPosition.inRange;
    position.isActive = true;
    position.strategy = 'market_making';
    position.rebalanceCount = 0;
    position.totalFeesCollected0 = '0';
    position.totalFeesCollected1 = '0';
    position.initialValueUSD = 0;
    position.currentValueUSD = 0;
    position.impermanentLoss = 0;
    position.totalAPR = 0;
    position.feeAPR = 0;
    position.timeInRangeMs = 0;
    position.timeOutOfRangeMs = 0;
    position.metadata = { notes: 'Market making position' };
    return position;
  }

  /**
   * Get strategy status - required for TradingEngine compatibility
   */
  getStatus(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      isRunning: this.isRunning,
      positionCount: this.positions.size,
      activePositions: Array.from(this.positions.values()).filter(p => p.isActive).length,
      startTime: this.startTime,
      lastRebalance: this.lastRebalance,
      uptime: this.isRunning ? Date.now() - this.startTime : 0
    };
  }
}