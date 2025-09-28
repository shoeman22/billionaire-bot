/**
 * Whale Copy Trading Strategy
 *
 * Integrates whale tracking with the existing arbitrage trading engine
 * to execute profitable copy trades based on whale movements and signals.
 */

import { logger } from '../utils/logger';
import { WhaleTracker, CopyTradingSignal, LargeTransaction, WhaleProfile } from '../monitoring/whale-tracker';
import { TradingEngine } from '../trading/TradingEngine';
import { SwapExecutor } from "../trading/execution/swap-executor";
import { GSwap } from "../services/gswap-simple";
import { SlippageProtection } from "../trading/risk/slippage";
import { RiskMonitor } from '../trading/risk/risk-monitor';
import { PriceTracker } from '../monitoring/price-tracker';
import { TRADING_CONSTANTS as _TRADING_CONSTANTS, STRATEGY_CONSTANTS } from '../config/constants';
import { EventEmitter } from 'events';
import { getConfig } from "../config/environment";

// Copy trading position tracking
interface CopyTradePosition {
  id: string;
  signalId: string;
  whale: WhaleProfile;
  originalTx: LargeTransaction;

  // Trade execution details
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut?: number;
  executionPrice?: number;
  slippage?: number;
  gasUsed?: number;

  // Timing and status
  signalCreatedAt: Date;
  entryTime?: Date;
  exitTime?: Date;
  status: 'pending' | 'entered' | 'exited' | 'expired' | 'failed';

  // Performance tracking
  pnl?: number;
  pnlPercentage?: number;
  exitReason?: 'whale_exit' | 'take_profit' | 'stop_loss' | 'time_limit' | 'manual';
}

// Copy trading configuration
interface CopyTradingConfig {
  // Risk management
  maxPositionSize: number; // USD
  maxConcurrentPositions: number;
  totalExposureLimit: number; // Percentage of portfolio

  // Entry/exit settings
  defaultEntryDelay: number; // Minutes after whale trade
  maxEntryWindow: number; // Minutes
  defaultHoldTime: number; // Hours

  // Performance thresholds
  takeProfitPercentage: number;
  stopLossPercentage: number;
  minConfidenceThreshold: number;

  // Whale filtering
  minWhaleVolume: number;
  preferredWhaleTiers: string[];
  maxWhaleRiskScore: number;
}

const DEFAULT_CONFIG: CopyTradingConfig = {
  maxPositionSize: STRATEGY_CONSTANTS.ARBITRAGE.MAX_TRADE_SIZE_USD * 0.2, // 20% of max arbitrage size
  maxConcurrentPositions: 3,
  totalExposureLimit: 5, // 5% of portfolio

  defaultEntryDelay: 2,
  maxEntryWindow: 10,
  defaultHoldTime: 6,

  takeProfitPercentage: 2,
  stopLossPercentage: 3,
  minConfidenceThreshold: 0.7,

  minWhaleVolume: 5000,
  preferredWhaleTiers: ['SMART_MONEY', 'TIER1'],
  maxWhaleRiskScore: 6
};

/**
 * Whale Copy Trading Strategy
 *
 * Implements automated copy trading based on whale movements with
 * intelligent risk management and performance tracking.
 */
export class WhaleCopyTradingStrategy extends EventEmitter {
  private config: CopyTradingConfig;
  private whaleTracker: WhaleTracker;
  private tradingEngine: TradingEngine;
  private riskMonitor: RiskMonitor;
  private priceTracker: PriceTracker;
  private swapExecutor!: SwapExecutor;
  private userAddress: string;

  private isActive: boolean = false;
  private activeCopyPositions: Map<string, CopyTradePosition> = new Map();
  private pendingSignals: Map<string, CopyTradingSignal> = new Map();

  // Performance tracking
  private stats = {
    totalSignals: 0,
    executedTrades: 0,
    successfulTrades: 0,
    totalPnL: 0,
    winRate: 0,
    averageHoldTime: 0,
    bestTrade: 0,
    worstTrade: 0,
    averageWhaleFollowDelay: 0,
    lastUpdated: new Date()
  };

  constructor(
    whaleTracker: WhaleTracker,
    tradingEngine: TradingEngine,
    riskMonitor: RiskMonitor,
    priceTracker: PriceTracker,
    gswap: GSwap,
    slippageProtection: SlippageProtection,
    config?: Partial<CopyTradingConfig>
  ) {
    super();

    this.whaleTracker = whaleTracker;
    this.tradingEngine = tradingEngine;
    this.riskMonitor = riskMonitor;
    this.priceTracker = priceTracker;
    this.config = { ...DEFAULT_CONFIG, ...config };
    const botConfig = getConfig();
    this.userAddress = botConfig.wallet.address;

    this.setupEventHandlers();

    logger.info('🐋 Whale Copy Trading Strategy initialized', {
      maxPositionSize: this.config.maxPositionSize,
      maxConcurrentPositions: this.config.maxConcurrentPositions,
      totalExposureLimit: this.config.totalExposureLimit + '%'
    });
  }

  /**
   * Start the copy trading strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Whale copy trading strategy already active');
      return;
    }

    try {
      logger.info('🚀 Starting whale copy trading strategy...');

      // Ensure whale tracker is running
      if (!this.whaleTracker.getStats().totalWhalesTracked) {
        logger.info('🐋 Starting whale tracker for copy trading...');
        await this.whaleTracker.start();
      }

      this.isActive = true;

      // Start monitoring for exit conditions
      this.startPositionMonitoring();

      logger.info('✅ Whale copy trading strategy started successfully', {
        trackedWhales: this.whaleTracker.getStats().totalWhalesTracked,
        activeSignals: this.whaleTracker.getStats().activeSignals
      });

      this.emit('strategyStarted');

    } catch (error) {
      logger.error('❌ Failed to start whale copy trading strategy:', error);
      throw error;
    }
  }

  /**
   * Stop the copy trading strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      logger.warn('Whale copy trading strategy not active');
      return;
    }

    logger.info('🛑 Stopping whale copy trading strategy...');

    this.isActive = false;

    // Exit all active positions
    for (const [positionId, position] of this.activeCopyPositions) {
      if (position.status === 'entered') {
        await this.exitCopyPosition(positionId, 'manual');
      }
    }

    // Clear pending signals
    this.pendingSignals.clear();

    logger.info('✅ Whale copy trading strategy stopped', {
      finalPositions: this.activeCopyPositions.size,
      totalPnL: `$${this.stats.totalPnL.toFixed(2)}`,
      winRate: `${this.stats.winRate.toFixed(1)}%`
    });

    this.emit('strategyStopped');
  }

  /**
   * Get copy trading performance statistics
   */
  getStats() {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get active copy trading positions
   */
  getActivePositions(): CopyTradePosition[] {
    return Array.from(this.activeCopyPositions.values())
      .filter(position => position.status === 'entered' || position.status === 'pending');
  }

  /**
   * Manually exit a copy position
   */
  async manualExit(positionId: string): Promise<boolean> {
    const position = this.activeCopyPositions.get(positionId);

    if (!position || position.status !== 'entered') {
      logger.warn(`Cannot manually exit position ${positionId}: not found or not entered`);
      return false;
    }

    return await this.exitCopyPosition(positionId, 'manual');
  }

  /**
   * Update copy trading configuration
   */
  updateConfig(newConfig: Partial<CopyTradingConfig>): void {
    this.config = { ...this.config, ...newConfig };

    logger.info('⚙️ Copy trading configuration updated', {
      maxPositionSize: this.config.maxPositionSize,
      maxConcurrentPositions: this.config.maxConcurrentPositions,
      minConfidenceThreshold: this.config.minConfidenceThreshold
    });

    this.emit('configUpdated', this.config);
  }

  /**
   * Setup event handlers for whale tracking signals
   */
  private setupEventHandlers(): void {
    // Handle new copy trading signals from whale tracker
    this.whaleTracker.on('copySignalCreated', async (signal: CopyTradingSignal) => {
      if (!this.isActive) return;

      try {
        await this.processCopyTradingSignal(signal);
      } catch (error) {
        logger.error('Error processing copy trading signal:', error);
      }
    });

    // Handle whale transaction exits for position mirroring
    this.whaleTracker.on('largeTransaction', async (transaction: LargeTransaction) => {
      if (!this.isActive) return;

      try {
        await this.handleWhaleTransaction(transaction);
      } catch (error) {
        logger.error('Error handling whale transaction:', error);
      }
    });

    // Handle whale exits
    this.whaleTracker.on('whaleRemoved', async (whale: { formatted: string }) => {
      await this.handleWhaleRemoval(whale.formatted);
    });
  }

  /**
   * Process a new copy trading signal
   */
  private async processCopyTradingSignal(signal: CopyTradingSignal): Promise<void> {
    logger.info(`📡 Processing copy trading signal from ${signal.whale.tier} whale`, {
      signalId: signal.id.substring(0, 12),
      confidence: `${(signal.signal.confidence * 100).toFixed(1)}%`,
      pair: `${signal.signal.tokenIn} → ${signal.signal.tokenOut}`,
      recommendedSize: `$${signal.signal.recommendedSize}`
    });

    this.stats.totalSignals++;

    // Pre-filter signal quality
    if (!this.isSignalQualified(signal)) {
      logger.debug(`❌ Signal ${signal.id.substring(0, 12)} filtered out - does not meet criteria`);
      return;
    }

    // Check risk limits
    if (!this.checkRiskLimits()) {
      logger.warn(`⚠️ Signal ${signal.id.substring(0, 12)} blocked - risk limits exceeded`);
      return;
    }

    // Store pending signal
    this.pendingSignals.set(signal.id, signal);

    // Schedule entry execution
    const entryDelay = signal.signal.entryWindow * 60 * 1000; // Convert minutes to milliseconds

    setTimeout(async () => {
      if (this.pendingSignals.has(signal.id) && this.isActive) {
        await this.executeCopyTradeEntry(signal);
      }
    }, entryDelay);

    logger.debug(`⏰ Scheduled copy trade entry for signal ${signal.id.substring(0, 12)} in ${signal.signal.entryWindow} minutes`);
  }

  /**
   * Execute copy trade entry
   */
  private async executeCopyTradeEntry(signal: CopyTradingSignal): Promise<void> {
    const positionId = `copy_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
      logger.info(`🎯 Executing copy trade entry for signal ${signal.id.substring(0, 12)}`);

      // Final risk check before execution
      if (!this.checkRiskLimits()) {
        logger.warn(`⚠️ Entry cancelled for signal ${signal.id.substring(0, 12)} - risk limits now exceeded`);
        return;
      }

      // Calculate position size
      const positionSize = Math.min(
        signal.signal.recommendedSize,
        this.config.maxPositionSize
      );

      // Create copy position record
      const copyPosition: CopyTradePosition = {
        id: positionId,
        signalId: signal.id,
        whale: signal.whale,
        originalTx: signal.transaction,
        tokenIn: signal.signal.tokenIn,
        tokenOut: signal.signal.tokenOut,
        amountIn: positionSize,
        signalCreatedAt: signal.createdAt,
        status: 'pending'
      };

      this.activeCopyPositions.set(positionId, copyPosition);

      // Execute the trade using arbitrage executor
      const tradeResult = await this.swapExecutor.executeSwap({
        tokenIn: signal.signal.tokenIn,
        tokenOut: signal.signal.tokenOut,
        userAddress: this.userAddress,
        amountIn: positionSize.toString(),
        slippageTolerance: signal.signal.maxSlippage,
      });

      if (tradeResult.success) {
        // Update position with execution details
        copyPosition.status = 'entered';
        copyPosition.entryTime = new Date();
        copyPosition.amountOut = tradeResult.amountOut ? parseFloat(tradeResult.amountOut) : undefined;
        copyPosition.slippage = tradeResult.actualSlippage;
        copyPosition.gasUsed = tradeResult.gasUsed ? parseFloat(tradeResult.gasUsed) : undefined;

        this.stats.executedTrades++;

        logger.info(`✅ Copy trade entered successfully`, {
          positionId: positionId.substring(0, 12),
          amountIn: positionSize,
          amountOut: tradeResult.amountOut,
          slippage: `${((tradeResult.actualSlippage || 0) * 100).toFixed(2)}%`
        });

        this.emit('copyTradeEntered', copyPosition);

        // Schedule exit based on strategy
        this.schedulePositionExit(copyPosition);

      } else {
        copyPosition.status = 'failed';

        logger.error(`❌ Copy trade execution failed for signal ${signal.id.substring(0, 12)}:`, tradeResult.error);

        this.emit('copyTradeFailed', { signal, error: tradeResult.error });
      }

    } catch (error) {
      logger.error(`❌ Failed to execute copy trade entry for signal ${signal.id.substring(0, 12)}:`, error);

      const position = this.activeCopyPositions.get(positionId);
      if (position) {
        position.status = 'failed';
      }
    } finally {
      // Remove from pending signals
      this.pendingSignals.delete(signal.id);
    }
  }

  /**
   * Schedule position exit based on strategy and whale behavior
   */
  private schedulePositionExit(position: CopyTradePosition): void {
    const holdTimeMs = this.config.defaultHoldTime * 60 * 60 * 1000; // Convert hours to milliseconds

    // Schedule automatic exit after hold time
    setTimeout(async () => {
      if (this.activeCopyPositions.has(position.id) &&
          this.activeCopyPositions.get(position.id)?.status === 'entered') {
        await this.exitCopyPosition(position.id, 'time_limit');
      }
    }, holdTimeMs);

    logger.debug(`⏰ Scheduled automatic exit for position ${position.id.substring(0, 12)} in ${this.config.defaultHoldTime} hours`);
  }

  /**
   * Exit a copy trading position
   */
  private async exitCopyPosition(positionId: string, reason: CopyTradePosition['exitReason']): Promise<boolean> {
    const position = this.activeCopyPositions.get(positionId);

    if (!position || position.status !== 'entered') {
      logger.warn(`Cannot exit position ${positionId}: not found or not entered`);
      return false;
    }

    try {
      logger.info(`🚪 Exiting copy position ${positionId.substring(0, 12)} - reason: ${reason}`);

      // Execute reverse trade to close position
      const exitResult = await this.swapExecutor.executeSwap({
        tokenIn: position.tokenOut,
        tokenOut: position.tokenIn,
        userAddress: this.userAddress,
        amountIn: (position.amountOut || 0).toString(),
        slippageTolerance: 0.02, // 2% max slippage for exit
      });

      if (exitResult.success) {
        // Calculate P&L
        const originalValue = position.amountIn;
        const exitValue = exitResult.amountOut ? parseFloat(exitResult.amountOut) : 0;
        const pnl = exitValue - originalValue;
        const pnlPercentage = (pnl / originalValue) * 100;

        // Update position
        position.status = 'exited';
        position.exitTime = new Date();
        position.exitReason = reason;
        position.pnl = pnl;
        position.pnlPercentage = pnlPercentage;

        // Update statistics
        if (pnl > 0) {
          this.stats.successfulTrades++;
          if (pnl > this.stats.bestTrade) {
            this.stats.bestTrade = pnl;
          }
        } else if (pnl < this.stats.worstTrade) {
          this.stats.worstTrade = pnl;
        }

        this.stats.totalPnL += pnl;

        logger.info(`✅ Copy position exited successfully`, {
          positionId: positionId.substring(0, 12),
          pnl: `$${pnl.toFixed(2)}`,
          pnlPercentage: `${pnlPercentage.toFixed(2)}%`,
          holdTime: position.entryTime ?
            `${((Date.now() - position.entryTime.getTime()) / (60 * 60 * 1000)).toFixed(1)}h` : 'unknown'
        });

        this.emit('copyTradeExited', position);
        return true;

      } else {
        logger.error(`❌ Failed to exit copy position ${positionId.substring(0, 12)}:`, exitResult.error);
        return false;
      }

    } catch (error) {
      logger.error(`❌ Error exiting copy position ${positionId.substring(0, 12)}:`, error);
      return false;
    }
  }

  /**
   * Handle whale transaction for position mirroring
   */
  private async handleWhaleTransaction(transaction: LargeTransaction): Promise<void> {
    // Check if we have any active positions following this whale
    const whalePositions = Array.from(this.activeCopyPositions.values()).filter(
      position => position.whale.address.formatted === transaction.whale.address.formatted &&
                  position.status === 'entered'
    );

    if (whalePositions.length === 0) return;

    // If whale is exiting a position we're copying, consider exiting too
    if (transaction.type === 'sell' && transaction.copySignal.exitStrategy === 'mirror') {
      logger.info(`🔄 Whale exit detected - considering mirror exits for ${whalePositions.length} positions`);

      for (const position of whalePositions) {
        if (this.shouldMirrorWhaleExit(position, transaction)) {
          await this.exitCopyPosition(position.id, 'whale_exit');
        }
      }
    }
  }

  /**
   * Handle whale removal from tracking
   */
  private async handleWhaleRemoval(whaleAddress: string): Promise<void> {
    // Exit any positions following the removed whale
    const whalePositions = Array.from(this.activeCopyPositions.values()).filter(
      position => position.whale.address.formatted === whaleAddress &&
                  position.status === 'entered'
    );

    if (whalePositions.length > 0) {
      logger.info(`🗑️ Whale removed from tracking - exiting ${whalePositions.length} copy positions`);

      for (const position of whalePositions) {
        await this.exitCopyPosition(position.id, 'manual');
      }
    }
  }

  /**
   * Start monitoring active positions for exit conditions
   */
  private startPositionMonitoring(): void {
    // Check positions every 30 seconds
    setInterval(async () => {
      if (!this.isActive) return;

      try {
        await this.monitorActivePositions();
      } catch (error) {
        logger.error('Error monitoring copy positions:', error);
      }
    }, 30 * 1000);
  }

  /**
   * Monitor active positions for exit conditions
   */
  private async monitorActivePositions(): Promise<void> {
    const activePositions = Array.from(this.activeCopyPositions.values()).filter(
      position => position.status === 'entered'
    );

    for (const position of activePositions) {
      // Check take profit and stop loss conditions
      const currentPnL = await this.calculatePositionPnL(position);

      if (currentPnL !== null) {
        const pnlPercentage = (currentPnL / position.amountIn) * 100;

        // Take profit check
        if (pnlPercentage >= this.config.takeProfitPercentage) {
          logger.info(`🎯 Take profit triggered for position ${position.id.substring(0, 12)} at ${pnlPercentage.toFixed(2)}%`);
          await this.exitCopyPosition(position.id, 'take_profit');
          continue;
        }

        // Stop loss check
        if (pnlPercentage <= -this.config.stopLossPercentage) {
          logger.warn(`🛑 Stop loss triggered for position ${position.id.substring(0, 12)} at ${pnlPercentage.toFixed(2)}%`);
          await this.exitCopyPosition(position.id, 'stop_loss');
          continue;
        }
      }
    }
  }

  /**
   * Calculate current P&L for a position
   */
  private async calculatePositionPnL(position: CopyTradePosition): Promise<number | null> {
    try {
      // Get current price to estimate position value
      const tokenOutPrice = this.priceTracker.getPrice(position.tokenOut);
      const tokenInPrice = this.priceTracker.getPrice(position.tokenIn);

      if (!tokenOutPrice || !tokenInPrice || !position.amountOut) {
        return null;
      }

      const currentValue = position.amountOut * (tokenOutPrice.priceUsd / tokenInPrice.priceUsd);
      return currentValue - position.amountIn;

    } catch (error) {
      logger.debug(`Failed to calculate P&L for position ${position.id}:`, error);
      return null;
    }
  }

  /**
   * Check if a signal meets qualification criteria
   */
  private isSignalQualified(signal: CopyTradingSignal): boolean {
    // Confidence threshold
    if (signal.signal.confidence < this.config.minConfidenceThreshold) {
      return false;
    }

    // Whale volume threshold
    if (signal.whale.monthlyVolume < this.config.minWhaleVolume) {
      return false;
    }

    // Preferred whale tiers
    if (!this.config.preferredWhaleTiers.includes(signal.whale.tier)) {
      return false;
    }

    // Maximum whale risk score
    if (signal.whale.riskScore > this.config.maxWhaleRiskScore) {
      return false;
    }

    return true;
  }

  /**
   * Check if risk limits allow new position
   */
  private checkRiskLimits(): boolean {
    // Check maximum concurrent positions
    const activePositionCount = Array.from(this.activeCopyPositions.values()).filter(
      position => position.status === 'entered' || position.status === 'pending'
    ).length;

    if (activePositionCount >= this.config.maxConcurrentPositions) {
      return false;
    }

    // Check total exposure limit
    const totalExposure = Array.from(this.activeCopyPositions.values())
      .filter(position => position.status === 'entered')
      .reduce((sum, position) => sum + position.amountIn, 0);

    const portfolioValue = 100000; // Would get from portfolio tracker
    const currentExposurePercentage = (totalExposure / portfolioValue) * 100;

    if (currentExposurePercentage >= this.config.totalExposureLimit) {
      return false;
    }

    return true;
  }

  /**
   * Determine if we should mirror a whale's exit
   */
  private shouldMirrorWhaleExit(position: CopyTradePosition, whaleTransaction: LargeTransaction): boolean {
    // Mirror exit if tokens match and it's a significant exit
    return whaleTransaction.tokenIn === position.tokenOut &&
           whaleTransaction.valueUSD >= position.amountIn * 0.5; // At least 50% of our position size
  }

  /**
   * Update performance statistics
   */
  private updateStats(): void {
    const executedPositions = Array.from(this.activeCopyPositions.values()).filter(
      position => position.status === 'exited'
    );

    if (executedPositions.length > 0) {
      this.stats.winRate = (this.stats.successfulTrades / this.stats.executedTrades) * 100;

      const totalHoldTime = executedPositions
        .filter(p => p.entryTime && p.exitTime)
        .reduce((sum, p) => sum + (p.exitTime!.getTime() - p.entryTime!.getTime()), 0);

      this.stats.averageHoldTime = totalHoldTime / executedPositions.length / (60 * 60 * 1000); // Convert to hours
    }

    this.stats.lastUpdated = new Date();
  }
}

/**
 * Create a whale copy trading strategy with default configuration
 */
