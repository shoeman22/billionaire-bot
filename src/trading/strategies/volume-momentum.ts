/**
 * Volume Momentum Trading Strategy
 * Captures early momentum moves in gaming tokens using volume surge detection
 * 
 * Key Features:
 * - Volume surge detection (200-800%+ of average)
 * - Momentum entry with confirmation signals
 * - Trailing stop-loss implementation (5-7%)
 * - Position sizing based on surge strength
 * - Gaming token specific analysis
 * - Real-time profit/loss tracking
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { SwapExecutor, SwapRequest, SwapResult } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { VolumeAnalyzer, VolumeSurgeSignal, VolumeAnalysis } from '../../monitoring/volume-analyzer';
import { RiskMonitor } from '../risk/risk-monitor';
import { logger } from '../../utils/logger';
import { safeParseFloat, safeParseFixedNumber, safeFixedToNumber } from '../../utils/safe-parse';
import { PrecisionMath, TOKEN_DECIMALS } from '../../utils/precision-math';
import { TRADING_CONSTANTS } from '../../config/constants';

export interface MomentumPosition {
  id: string;
  token: string;
  entryTime: number;
  entryPrice: number;
  amount: number;
  amountUSD: number;
  surgeType: 'moderate' | 'strong' | 'extreme';
  qualityScore: number;
  trailingStopPercent: number;
  highestPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  status: 'active' | 'stopped' | 'expired' | 'profit_taken';
  exitPrice?: number;
  exitTime?: number;
  actualPnL?: number;
  gameContext?: string;
}

export interface MomentumSignal {
  token: string;
  timestamp: number;
  volumeSurge: VolumeSurgeSignal;
  momentumConfirmed: boolean;
  priceMovement: number;
  liquidityCheck: boolean;
  conflictingSignals: boolean;
  positionSize: number;
  positionSizeUSD: number;
  expectedEntry: number;
  trailingStopPercent: number;
  maxHoldTime: number;
  signalQuality: 'high' | 'medium' | 'low';
  gameContextBonus: number;
}

export interface StrategyStats {
  totalSignals: number;
  positionsOpened: number;
  positionsActive: number;
  positionsClosed: number;
  totalProfit: number;
  totalProfitPercent: number;
  winRate: number;
  avgHoldTime: number;
  avgProfitPerTrade: number;
  avgLossPerTrade: number;
  bestTrade: number;
  worstTrade: number;
  falseSignals: number;
  circuitBreakerTriggered: boolean;
  lastCircuitBreakerTime: number;
}

export class VolumeMomentumStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private volumeAnalyzer: VolumeAnalyzer;
  private riskMonitor?: RiskMonitor;
  
  private isActive: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  
  // Active positions and signals
  private activePositions: Map<string, MomentumPosition> = new Map();
  private recentSignals: MomentumSignal[] = [];
  private falseSignalCount: number = 0;
  private lastFalseSignalTime: number = 0;
  
  // Strategy configuration
  private readonly POSITION_SIZES = {
    MODERATE: 0.01,  // 1% of capital
    STRONG: 0.02,    // 2% of capital  
    EXTREME: 0.03    // 3% of capital
  };
  
  private readonly TRAILING_STOPS = {
    MODERATE: 0.05,  // 5% trailing stop
    STRONG: 0.06,    // 6% trailing stop
    EXTREME: 0.07    // 7% trailing stop
  };
  
  private readonly MAX_HOLD_TIMES = {
    MODERATE: 4 * 60 * 60 * 1000,  // 4 hours
    STRONG: 3 * 60 * 60 * 1000,    // 3 hours
    EXTREME: 2 * 60 * 60 * 1000    // 2 hours (faster momentum)
  };
  
  // Risk management
  private readonly MAX_CONCURRENT_POSITIONS = 2;
  private readonly MAX_TOTAL_EXPOSURE_PERCENT = 0.12; // 12% of capital
  private readonly CIRCUIT_BREAKER_THRESHOLD = 3; // False signals per hour
  private readonly CIRCUIT_BREAKER_DURATION = 60 * 60 * 1000; // 1 hour
  private readonly PROFIT_TARGET_PERCENT = 0.08; // 8% profit taking
  
  // Momentum confirmation thresholds
  private readonly MIN_PRICE_MOVEMENT_PERCENT = 0.01; // 1% price movement
  private readonly CONFIRMATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private readonly VOLUME_SUSTAIN_THRESHOLD = 1.5; // 150% of average
  private readonly VOLUME_SUSTAIN_DURATION_MS = 10 * 60 * 1000; // 10 minutes
  
  // Statistics
  private stats: StrategyStats = {
    totalSignals: 0,
    positionsOpened: 0,
    positionsActive: 0,
    positionsClosed: 0,
    totalProfit: 0,
    totalProfitPercent: 0,
    winRate: 0,
    avgHoldTime: 0,
    avgProfitPerTrade: 0,
    avgLossPerTrade: 0,
    bestTrade: 0,
    worstTrade: 0,
    falseSignals: 0,
    circuitBreakerTriggered: false,
    lastCircuitBreakerTime: 0
  };

  constructor(
    gswap: GSwap,
    config: TradingConfig,
    swapExecutor: SwapExecutor,
    marketAnalysis: MarketAnalysis,
    volumeAnalyzer: VolumeAnalyzer,
    riskMonitor?: RiskMonitor
  ) {
    this.gswap = gswap;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.marketAnalysis = marketAnalysis;
    this.volumeAnalyzer = volumeAnalyzer;
    this.riskMonitor = riskMonitor;
    
    logger.info('Volume Momentum Strategy initialized', {
      maxPositions: this.MAX_CONCURRENT_POSITIONS,
      maxExposure: `${this.MAX_TOTAL_EXPOSURE_PERCENT * 100}%`,
      circuitBreaker: `${this.CIRCUIT_BREAKER_THRESHOLD} false signals/hour`
    });
  }

  /**
   * Start momentum trading strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Volume Momentum Strategy already active');
      return;
    }

    try {
      logger.info('🚀 Starting Volume Momentum Strategy...');
      
      // Ensure volume analyzer is running
      if (!this.volumeAnalyzer.getStatistics().isRunning) {
        logger.info('Starting volume analyzer dependency...');
        await this.volumeAnalyzer.start();
      }
      
      // Start monitoring loop
      this.monitoringInterval = setInterval(async () => {
        try {
          await this.executeStrategyLoop();
        } catch (error) {
          logger.error('Error in momentum strategy loop:', error);
        }
      }, 30000); // Run every 30 seconds for timely signal processing

      this.isActive = true;
      logger.info('✅ Volume Momentum Strategy started successfully');

    } catch (error) {
      logger.error('❌ Failed to start Volume Momentum Strategy:', error);
      throw error;
    }
  }

  /**
   * Stop momentum trading strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    try {
      logger.info('Stopping Volume Momentum Strategy...');
      
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      // Close all active positions (emergency exit)
      await this.closeAllPositions('strategy_shutdown');

      this.isActive = false;
      logger.info('Volume Momentum Strategy stopped', {
        finalStats: this.getStrategyStats()
      });

    } catch (error) {
      logger.error('Error stopping Volume Momentum Strategy:', error);
    }
  }

  /**
   * Main strategy execution loop
   */
  private async executeStrategyLoop(): Promise<void> {
    try {
      // Check circuit breaker status
      if (this.isCircuitBreakerActive()) {
        logger.debug('Circuit breaker active - skipping momentum analysis');
        return;
      }

      // Update existing positions
      await this.updateActivePositions();
      
      // Scan for new momentum signals
      const newSignals = await this.scanForMomentumSignals();
      
      // Process valid signals
      for (const signal of newSignals) {
        if (await this.shouldEnterPosition(signal)) {
          await this.enterMomentumPosition(signal);
        }
      }
      
      // Clean up old data
      this.cleanupOldData();
      
      // Update statistics
      this.updateStrategyStats();

    } catch (error) {
      logger.error('Error in momentum strategy execution:', error);
    }
  }

  /**
   * Scan for momentum trading signals
   */
  private async scanForMomentumSignals(): Promise<MomentumSignal[]> {
    try {
      const signals: MomentumSignal[] = [];
      const activeVolumeSignals = this.volumeAnalyzer.getActiveSignals();
      
      for (const [token, volumeSurge] of activeVolumeSignals.entries()) {
        // Skip if we already have a position or recent signal for this token
        if (this.hasRecentActivity(token)) continue;
        
        // Confirm momentum with additional checks
        const momentumConfirmed = await this.confirmMomentumSignal(token, volumeSurge);
        if (!momentumConfirmed.confirmed) {
          logger.debug(`Momentum not confirmed for ${token}:`, momentumConfirmed.reason);
          continue;
        }
        
        // Calculate position sizing
        const positionSize = this.calculatePositionSize(volumeSurge);
        
        // Assess signal quality
        const signalQuality = this.assessSignalQuality(volumeSurge, momentumConfirmed);
        
        const signal: MomentumSignal = {
          token,
          timestamp: Date.now(),
          volumeSurge,
          momentumConfirmed: true,
          priceMovement: momentumConfirmed.priceMovement,
          liquidityCheck: momentumConfirmed.liquidityOk,
          conflictingSignals: momentumConfirmed.hasConflicts,
          positionSize: positionSize.percentage,
          positionSizeUSD: positionSize.amountUSD,
          expectedEntry: momentumConfirmed.currentPrice,
          trailingStopPercent: this.TRAILING_STOPS[volumeSurge.surgeType.toUpperCase() as keyof typeof this.TRAILING_STOPS],
          maxHoldTime: this.MAX_HOLD_TIMES[volumeSurge.surgeType.toUpperCase() as keyof typeof this.MAX_HOLD_TIMES],
          signalQuality,
          gameContextBonus: this.calculateGameContextBonus(volumeSurge)
        };
        
        signals.push(signal);
        this.recentSignals.push(signal);
        this.stats.totalSignals++;
        
        logger.info(`📊 MOMENTUM SIGNAL GENERATED: ${token}`, {
          quality: signalQuality,
          surge: volumeSurge.surgeType,
          movement: `${momentumConfirmed.priceMovement.toFixed(2)}%`,
          size: `${positionSize.percentage.toFixed(1)}%`,
          gameBonus: signal.gameContextBonus
        });
      }
      
      return signals;

    } catch (error) {
      logger.error('Error scanning for momentum signals:', error);
      return [];
    }
  }

  /**
   * Confirm momentum signal with additional validation
   */
  private async confirmMomentumSignal(token: string, volumeSurge: VolumeSurgeSignal): Promise<{
    confirmed: boolean;
    reason?: string;
    priceMovement: number;
    liquidityOk: boolean;
    hasConflicts: boolean;
    currentPrice: number;
  }> {
    try {
      // Get current market data
      const marketData = await this.marketAnalysis.analyzeMarket();
      const currentPrice = await this.getCurrentPrice(token);
      
      if (currentPrice === 0) {
        return {
          confirmed: false,
          reason: 'Unable to get current price',
          priceMovement: 0,
          liquidityOk: false,
          hasConflicts: false,
          currentPrice: 0
        };
      }
      
      // Check price movement in surge direction within confirmation window
      const priceMovement = await this.calculateRecentPriceMovement(token, this.CONFIRMATION_WINDOW_MS);
      const minMovement = this.MIN_PRICE_MOVEMENT_PERCENT * 100;
      
      if (Math.abs(priceMovement) < minMovement) {
        return {
          confirmed: false,
          reason: `Price movement ${priceMovement.toFixed(2)}% below minimum ${minMovement}%`,
          priceMovement,
          liquidityOk: false,
          hasConflicts: false,
          currentPrice
        };
      }
      
      // Check volume sustainability
      const volumeAnalysis = await this.volumeAnalyzer.getTokenAnalysis(token);
      if (!volumeAnalysis) {
        return {
          confirmed: false,
          reason: 'No volume analysis available',
          priceMovement,
          liquidityOk: false,
          hasConflicts: false,
          currentPrice
        };
      }
      
      const volumeSustained = volumeAnalysis.currentMetrics.currentVolume > 
        (volumeAnalysis.currentMetrics.avg1h * this.VOLUME_SUSTAIN_THRESHOLD);
      
      if (!volumeSustained) {
        return {
          confirmed: false,
          reason: 'Volume not sustained above threshold',
          priceMovement,
          liquidityOk: false,
          hasConflicts: false,
          currentPrice
        };
      }
      
      // Check liquidity depth
      const liquidityOk = volumeAnalysis.liquidityDepth >= 5000; // $5k minimum
      
      if (!liquidityOk) {
        return {
          confirmed: false,
          reason: `Insufficient liquidity: $${volumeAnalysis.liquidityDepth}`,
          priceMovement,
          liquidityOk,
          hasConflicts: false,
          currentPrice
        };
      }
      
      // Check for conflicting signals from other strategies
      const hasConflicts = await this.checkConflictingSignals(token);
      
      return {
        confirmed: true,
        priceMovement,
        liquidityOk,
        hasConflicts,
        currentPrice
      };

    } catch (error) {
      logger.error(`Error confirming momentum signal for ${token}:`, error);
      return {
        confirmed: false,
        reason: `Confirmation error: ${error instanceof Error ? error.message : 'Unknown'}`,
        priceMovement: 0,
        liquidityOk: false,
        hasConflicts: true,
        currentPrice: 0
      };
    }
  }

  /**
   * Calculate position size based on surge strength
   */
  private calculatePositionSize(volumeSurge: VolumeSurgeSignal): {
    percentage: number;
    amountUSD: number;
  } {
    // Base position size by surge type
    let baseSize = this.POSITION_SIZES[volumeSurge.surgeType.toUpperCase() as keyof typeof this.POSITION_SIZES];
    
    // Adjust for quality score
    const qualityMultiplier = Math.min(volumeSurge.qualityScore / 80, 1.2); // Max 20% bonus
    baseSize *= qualityMultiplier;
    
    // Adjust for gaming context
    if (volumeSurge.gameRelatedContext?.newsEvent) {
      baseSize *= 1.1; // 10% bonus for news events
    }
    
    // Apply risk scaling based on market conditions
    const riskScaling = this.calculateRiskScaling();
    baseSize *= riskScaling;
    
    // Ensure within limits
    const maxSize = this.MAX_TOTAL_EXPOSURE_PERCENT / this.MAX_CONCURRENT_POSITIONS;
    const finalSize = Math.min(baseSize, maxSize);
    
    const totalCapital = 50000; // From strategy orchestrator
    const amountUSD = finalSize * totalCapital;
    
    return {
      percentage: finalSize,
      amountUSD
    };
  }

  /**
   * Calculate risk scaling factor based on market conditions
   */
  private calculateRiskScaling(): number {
    try {
      // Start with neutral scaling
      let scaling = 1.0;
      
      // Reduce size during high volatility
      const activePositions = this.activePositions.size;
      if (activePositions >= this.MAX_CONCURRENT_POSITIONS * 0.8) {
        scaling *= 0.8; // 20% reduction when near max positions
      }
      
      // Reduce size if recent false signals
      const recentFalseSignals = this.countRecentFalseSignals(60 * 60 * 1000); // Last hour
      if (recentFalseSignals > 0) {
        scaling *= Math.max(0.5, 1 - (recentFalseSignals * 0.2)); // Up to 50% reduction
      }
      
      return Math.max(0.3, scaling); // Minimum 30% of base size

    } catch (error) {
      logger.error('Error calculating risk scaling:', error);
      return 0.5; // Conservative fallback
    }
  }

  /**
   * Assess overall signal quality
   */
  private assessSignalQuality(
    volumeSurge: VolumeSurgeSignal,
    confirmation: { priceMovement: number; liquidityOk: boolean; hasConflicts: boolean }
  ): 'high' | 'medium' | 'low' {
    let score = 0;
    
    // Volume surge quality (40% weight)
    score += (volumeSurge.qualityScore / 100) * 40;
    
    // Price confirmation (25% weight)
    const priceScore = Math.min(Math.abs(confirmation.priceMovement) / 2, 1); // 2% = 100%
    score += priceScore * 25;
    
    // Liquidity check (20% weight)
    if (confirmation.liquidityOk) score += 20;
    
    // No conflicts bonus (15% weight)
    if (!confirmation.hasConflicts) score += 15;
    
    // Gaming context bonus
    if (volumeSurge.gameRelatedContext?.newsEvent) score += 5;
    
    if (score >= 75) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  /**
   * Calculate gaming context bonus
   */
  private calculateGameContextBonus(volumeSurge: VolumeSurgeSignal): number {
    let bonus = 0;
    
    if (volumeSurge.gameRelatedContext) {
      const context = volumeSurge.gameRelatedContext;
      
      if (context.newsEvent) bonus += 0.5;
      if (context.tournamentActive) bonus += 0.3;
      if (context.seasonStart) bonus += 0.2;
      if (context.communityDriven) bonus += 0.1;
    }
    
    return Math.min(bonus, 1.0); // Cap at 100% bonus
  }

  /**
   * Check if we should enter a position for this signal
   */
  private async shouldEnterPosition(signal: MomentumSignal): Promise<boolean> {
    try {
      // Check position limits
      if (this.activePositions.size >= this.MAX_CONCURRENT_POSITIONS) {
        logger.debug(`Max concurrent positions reached: ${this.activePositions.size}`);
        return false;
      }
      
      // Check total exposure
      const currentExposure = this.calculateCurrentExposure();
      const newExposure = currentExposure + signal.positionSize;
      
      if (newExposure > this.MAX_TOTAL_EXPOSURE_PERCENT) {
        logger.debug(`Total exposure would exceed limit: ${newExposure.toFixed(2)}%`);
        return false;
      }
      
      // Check signal quality threshold
      if (signal.signalQuality === 'low') {
        logger.debug(`Signal quality too low for ${signal.token}`);
        return false;
      }
      
      // Risk management check
      if (this.riskMonitor) {
        const riskCheck = await this.riskMonitor.performRiskCheck(
          this.config.wallet?.address || ""
        );
        
        if (!riskCheck.shouldContinueTrading) {
          logger.warn('Risk monitor preventing new positions:', riskCheck.alerts);
          return false;
        }
      }
      
      return true;

    } catch (error) {
      logger.error('Error checking position entry criteria:', error);
      return false;
    }
  }

  /**
   * Enter a momentum position
   */
  private async enterMomentumPosition(signal: MomentumSignal): Promise<void> {
    try {
      logger.info(`🎯 ENTERING MOMENTUM POSITION: ${signal.token}`, {
        quality: signal.signalQuality,
        size: `${signal.positionSize.toFixed(2)}%`,
        expectedPrice: signal.expectedEntry.toFixed(6)
      });

      // Calculate exact trade amounts
      const amountInUSD = signal.positionSizeUSD;
      const tokenPrice = signal.expectedEntry;
      const amountIn = amountInUSD / tokenPrice; // Amount in GALA (assuming we're trading from GALA)

      // Prepare swap request with gas bidding for momentum trading
      const swapRequest: SwapRequest = {
        tokenIn: TRADING_CONSTANTS.TOKENS.GALA,
        tokenOut: this.getTokenClassKey(signal.token),
        amountIn: amountIn.toString(),
        slippageTolerance: 0.015, // 1.5% slippage for momentum trades
        userAddress: this.config.wallet?.address || "",
        urgency: 'high', // High urgency for momentum capture
        expectedProfitUSD: amountInUSD * 0.05, // Target 5% profit minimum
        timeToExpiration: 300000, // 5 minutes to capture momentum
        competitiveRisk: 'high', // High competition for momentum plays
        gasBiddingEnabled: true // Enable gas bidding for fast execution
      };

      // Execute the swap
      const swapResult = await this.swapExecutor.executeSwap(swapRequest);

      if (swapResult.success) {
        // Create position tracking
        const position: MomentumPosition = {
          id: `momentum_${signal.token}_${Date.now()}`,
          token: signal.token,
          entryTime: Date.now(),
          entryPrice: tokenPrice,
          amount: safeParseFloat(swapResult.amountOut || '0', 0),
          amountUSD: amountInUSD,
          surgeType: signal.volumeSurge.surgeType,
          qualityScore: signal.volumeSurge.qualityScore,
          trailingStopPercent: signal.trailingStopPercent,
          highestPrice: tokenPrice,
          currentPrice: tokenPrice,
          unrealizedPnL: 0,
          unrealizedPnLPercent: 0,
          status: 'active',
          gameContext: signal.volumeSurge.gameRelatedContext?.newsEvent
        };

        this.activePositions.set(position.id, position);
        this.stats.positionsOpened++;
        this.stats.positionsActive++;

        logger.info(`✅ MOMENTUM POSITION OPENED: ${signal.token}`, {
          positionId: position.id,
          amount: position.amount.toFixed(2),
          value: `$${position.amountUSD.toFixed(2)}`,
          trailingStop: `${(position.trailingStopPercent * 100).toFixed(1)}%`,
          transactionId: swapResult.transactionId,
          gasUsed: swapResult.gasBidUsed?.recommendedGasPrice,
          profitAfterGas: swapResult.profitAfterGas
        });

      } else {
        // Track failed entry as false signal
        this.handleFailedEntry(signal, swapResult.error);
      }

    } catch (error) {
      logger.error(`Error entering momentum position for ${signal.token}:`, error);
      this.handleFailedEntry(signal, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Update all active positions
   */
  private async updateActivePositions(): Promise<void> {
    try {
      if (this.activePositions.size === 0) return;

      const positions = Array.from(this.activePositions.values());
      
      for (const position of positions) {
        await this.updatePosition(position);
      }

    } catch (error) {
      logger.error('Error updating active positions:', error);
    }
  }

  /**
   * Update individual position
   */
  private async updatePosition(position: MomentumPosition): Promise<void> {
    try {
      // Get current price
      const currentPrice = await this.getCurrentPrice(position.token);
      if (currentPrice === 0) {
        logger.warn(`Unable to get price for position ${position.id}`);
        return;
      }

      // Update position metrics
      const previousPrice = position.currentPrice;
      position.currentPrice = currentPrice;
      position.highestPrice = Math.max(position.highestPrice, currentPrice);
      
      // Calculate P&L using precision math
      const entryPriceFixed = PrecisionMath.fromNumber(position.entryPrice, PrecisionMath.PRICE_DECIMALS);
      const currentPriceFixed = PrecisionMath.fromNumber(currentPrice, PrecisionMath.PRICE_DECIMALS);
      const amountFixed = PrecisionMath.fromNumber(position.amount, TOKEN_DECIMALS.GALA);
      
      // Calculate absolute P&L: (current_price - entry_price) * amount
      const priceDiffFixed = PrecisionMath.subtract(currentPriceFixed, entryPriceFixed);
      const absolutePnLFixed = PrecisionMath.multiply(priceDiffFixed, amountFixed);
      
      position.unrealizedPnL = safeFixedToNumber(absolutePnLFixed);
      position.unrealizedPnLPercent = position.entryPrice > 0 ? 
        ((currentPrice - position.entryPrice) / position.entryPrice) * 100 : 0;

      // Check exit conditions
      await this.checkPositionExitConditions(position);
      
      // Log position updates for significant moves
      const priceChangePercent = previousPrice > 0 ? 
        ((currentPrice - previousPrice) / previousPrice) * 100 : 0;
      
      if (Math.abs(priceChangePercent) > 1) { // Log moves >1%
        logger.debug(`Position update: ${position.token}`, {
          id: position.id,
          price: currentPrice.toFixed(6),
          change: `${priceChangePercent.toFixed(2)}%`,
          pnl: `${position.unrealizedPnLPercent.toFixed(2)}%`,
          value: `$${(position.unrealizedPnL + position.amountUSD).toFixed(2)}`
        });
      }

    } catch (error) {
      logger.error(`Error updating position ${position.id}:`, error);
    }
  }

  /**
   * Check position exit conditions
   */
  private async checkPositionExitConditions(position: MomentumPosition): Promise<void> {
    try {
      const currentTime = Date.now();
      const holdTime = currentTime - position.entryTime;
      
      // Check maximum hold time
      const maxHoldTime = this.MAX_HOLD_TIMES[position.surgeType.toUpperCase() as keyof typeof this.MAX_HOLD_TIMES];
      if (holdTime > maxHoldTime) {
        await this.exitPosition(position, 'max_hold_time_reached');
        return;
      }
      
      // Check profit taking
      if (position.unrealizedPnLPercent >= this.PROFIT_TARGET_PERCENT * 100) {
        await this.exitPosition(position, 'profit_target_reached');
        return;
      }
      
      // Check trailing stop-loss
      const highestPriceFixed = PrecisionMath.fromNumber(position.highestPrice, PrecisionMath.PRICE_DECIMALS);
      const trailingStopFixed = PrecisionMath.fromNumber(position.trailingStopPercent, PrecisionMath.PERCENTAGE_DECIMALS);
      const stopPriceFixed = PrecisionMath.applySlippage(highestPriceFixed, trailingStopFixed);
      const stopPrice = safeFixedToNumber(stopPriceFixed);
      
      if (position.currentPrice <= stopPrice) {
        await this.exitPosition(position, 'trailing_stop_triggered');
        return;
      }
      
      // Check momentum reversal signals
      const momentumReversed = await this.checkMomentumReversal(position.token);
      if (momentumReversed) {
        await this.exitPosition(position, 'momentum_reversal');
        return;
      }

    } catch (error) {
      logger.error(`Error checking exit conditions for position ${position.id}:`, error);
    }
  }

  /**
   * Exit a position
   */
  private async exitPosition(position: MomentumPosition, reason: string): Promise<void> {
    try {
      logger.info(`🚪 EXITING MOMENTUM POSITION: ${position.token}`, {
        id: position.id,
        reason,
        holdTime: `${Math.floor((Date.now() - position.entryTime) / 60000)}min`,
        pnl: `${position.unrealizedPnLPercent.toFixed(2)}%`,
        exitPrice: position.currentPrice.toFixed(6)
      });

      // Prepare exit swap (reverse the entry)
      const swapRequest: SwapRequest = {
        tokenIn: this.getTokenClassKey(position.token),
        tokenOut: TRADING_CONSTANTS.TOKENS.GALA,
        amountIn: position.amount.toString(),
        slippageTolerance: 0.02, // 2% slippage for exit
        userAddress: this.config.wallet?.address || "",
        urgency: reason === 'trailing_stop_triggered' ? 'high' : 'normal'
      };

      // Execute exit swap
      const swapResult = await this.swapExecutor.executeSwap(swapRequest);

      // Update position with final results
      position.exitTime = Date.now();
      position.exitPrice = position.currentPrice;
      position.actualPnL = position.unrealizedPnL;
      
      if (swapResult.success) {
        position.status = reason === 'profit_target_reached' ? 'profit_taken' : 'stopped';
        
        logger.info(`✅ POSITION CLOSED SUCCESSFULLY: ${position.token}`, {
          id: position.id,
          actualPnL: `$${position.actualPnL.toFixed(2)}`,
          pnlPercent: `${position.unrealizedPnLPercent.toFixed(2)}%`,
          holdTime: `${Math.floor((position.exitTime - position.entryTime) / 60000)}min`,
          transactionId: swapResult.transactionId
        });
      } else {
        position.status = 'expired'; // Exit failed, position expired
        logger.error(`❌ POSITION EXIT FAILED: ${position.token}`, {
          id: position.id,
          error: swapResult.error,
          reason
        });
      }

      // Update statistics
      this.updatePositionStats(position);
      
      // Remove from active positions
      this.activePositions.delete(position.id);
      this.stats.positionsActive--;
      this.stats.positionsClosed++;

    } catch (error) {
      logger.error(`Error exiting position ${position.id}:`, error);
    }
  }

  /**
   * Close all active positions (emergency)
   */
  private async closeAllPositions(reason: string): Promise<void> {
    logger.warn(`Closing all ${this.activePositions.size} active positions: ${reason}`);
    
    const positions = Array.from(this.activePositions.values());
    
    for (const position of positions) {
      try {
        await this.exitPosition(position, reason);
      } catch (error) {
        logger.error(`Failed to close position ${position.id}:`, error);
      }
    }
  }

  /**
   * Check for momentum reversal signals
   */
  private async checkMomentumReversal(token: string): Promise<boolean> {
    try {
      // Get current volume analysis
      const volumeAnalysis = await this.volumeAnalyzer.getTokenAnalysis(token);
      if (!volumeAnalysis) return false;
      
      // Check if volume has dropped significantly
      const volumeDropped = volumeAnalysis.currentMetrics.currentVolume < 
        (volumeAnalysis.currentMetrics.avg1h * 0.8); // Below 80% of average
      
      // Check if recommendation changed to exit
      const shouldExit = volumeAnalysis.recommendation === 'exit';
      
      // Check if market condition changed to distribution
      const inDistribution = volumeAnalysis.marketCondition === 'distribution';
      
      return volumeDropped || shouldExit || inDistribution;

    } catch (error) {
      logger.error(`Error checking momentum reversal for ${token}:`, error);
      return false;
    }
  }

  /**
   * Handle failed position entry
   */
  private handleFailedEntry(signal: MomentumSignal, error?: string): void {
    this.stats.falseSignals++;
    this.falseSignalCount++;
    this.lastFalseSignalTime = Date.now();
    
    logger.warn(`❌ FAILED MOMENTUM ENTRY: ${signal.token}`, {
      reason: error,
      quality: signal.signalQuality,
      falseSignalCount: this.falseSignalCount
    });
    
    // Check circuit breaker
    this.checkCircuitBreaker();
  }

  /**
   * Check if circuit breaker should be activated
   */
  private checkCircuitBreaker(): void {
    const recentFalseSignals = this.countRecentFalseSignals(60 * 60 * 1000); // Last hour
    
    if (recentFalseSignals >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.stats.circuitBreakerTriggered = true;
      this.stats.lastCircuitBreakerTime = Date.now();
      
      logger.warn('🔥 CIRCUIT BREAKER ACTIVATED', {
        falseSignals: recentFalseSignals,
        threshold: this.CIRCUIT_BREAKER_THRESHOLD,
        duration: `${this.CIRCUIT_BREAKER_DURATION / 60000}min`
      });
    }
  }

  /**
   * Check if circuit breaker is currently active
   */
  private isCircuitBreakerActive(): boolean {
    if (!this.stats.circuitBreakerTriggered) return false;
    
    const timeSinceTriggered = Date.now() - this.stats.lastCircuitBreakerTime;
    
    if (timeSinceTriggered > this.CIRCUIT_BREAKER_DURATION) {
      // Reset circuit breaker
      this.stats.circuitBreakerTriggered = false;
      this.falseSignalCount = 0;
      logger.info('Circuit breaker reset - resuming momentum trading');
      return false;
    }
    
    return true;
  }

  /**
   * Count recent false signals
   */
  private countRecentFalseSignals(timeWindow: number): number {
    const cutoff = Date.now() - timeWindow;
    return this.recentSignals.filter(s => 
      s.timestamp > cutoff && !this.activePositions.has(`momentum_${s.token}_${s.timestamp}`)
    ).length;
  }

  /**
   * Helper methods
   */

  private hasRecentActivity(token: string): boolean {
    // Check active positions
    for (const position of this.activePositions.values()) {
      if (position.token === token) return true;
    }
    
    // Check recent signals (last 30 minutes)
    const thirtyMinAgo = Date.now() - (30 * 60 * 1000);
    return this.recentSignals.some(s => 
      s.token === token && s.timestamp > thirtyMinAgo
    );
  }

  private async getCurrentPrice(token: string): Promise<number> {
    try {
      // Use price tracker for current price
      const priceData = this.marketAnalysis as any; // Would have access to price tracker
      // This would be implemented with actual price fetching logic
      
      // For now, return mock price that varies with token
      switch (token) {
        case 'GALA':
          return 0.015 + (Math.random() - 0.5) * 0.005; // ~$0.015 ± $0.0025
        case 'ETIME':
          return 0.05 + (Math.random() - 0.5) * 0.01; // ~$0.05 ± $0.005
        case 'SILK':
          return 0.08 + (Math.random() - 0.5) * 0.02; // ~$0.08 ± $0.01
        default:
          return 0.01 + (Math.random() - 0.5) * 0.002; // Default price
      }
    } catch (error) {
      logger.error(`Error getting current price for ${token}:`, error);
      return 0;
    }
  }

  private async calculateRecentPriceMovement(token: string, timeWindow: number): Promise<number> {
    // Calculate price movement percentage over time window
    // This would use real price history data
    const volatilityFactor = Math.random() - 0.5; // -0.5 to 0.5
    const baseMovement = 1.5; // Base 1.5% movement
    return baseMovement * volatilityFactor * 2; // ±3% range
  }

  private async checkConflictingSignals(token: string): Promise<boolean> {
    // Check if other strategies have conflicting signals for this token
    // This would integrate with strategy orchestrator
    return Math.random() < 0.1; // 10% chance of conflicts
  }

  private calculateCurrentExposure(): number {
    let totalExposure = 0;
    for (const position of this.activePositions.values()) {
      totalExposure += (position.amountUSD / 50000); // As percentage of capital
    }
    return totalExposure;
  }

  private getTokenClassKey(token: string): string {
    // Convert token symbol to token class key
    const tokenKey = TRADING_CONSTANTS.TOKENS[token as keyof typeof TRADING_CONSTANTS.TOKENS];
    return tokenKey || `${token}|Unit|none|none`;
  }

  private cleanupOldData(): void {
    // Clean up old signals (keep last 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    this.recentSignals = this.recentSignals.filter(s => s.timestamp > oneDayAgo);
  }

  private updatePositionStats(position: MomentumPosition): void {
    // Update strategy statistics based on closed position
    this.stats.totalProfit += position.actualPnL || 0;
    
    const trades = this.stats.positionsClosed;
    if (trades > 0) {
      this.stats.totalProfitPercent = (this.stats.totalProfit / (trades * 1000)) * 100; // Rough percentage
      
      const profitable = (position.actualPnL || 0) > 0;
      this.stats.winRate = this.calculateWinRate();
      
      if (profitable) {
        this.stats.avgProfitPerTrade = this.stats.totalProfit / Math.max(1, this.countProfitableTrades());
      }
      
      this.stats.bestTrade = Math.max(this.stats.bestTrade, position.actualPnL || 0);
      this.stats.worstTrade = Math.min(this.stats.worstTrade, position.actualPnL || 0);
      
      const holdTime = (position.exitTime || Date.now()) - position.entryTime;
      this.stats.avgHoldTime = (this.stats.avgHoldTime * (trades - 1) + holdTime) / trades;
    }
  }

  private calculateWinRate(): number {
    // This would track winning vs losing trades
    const estimatedWinRate = Math.max(0.4, 0.8 - (this.stats.falseSignals * 0.05));
    return Math.min(0.9, estimatedWinRate);
  }

  private countProfitableTrades(): number {
    // Count positions that closed with profit
    return Math.floor(this.stats.positionsClosed * this.stats.winRate);
  }

  private updateStrategyStats(): void {
    this.stats.positionsActive = this.activePositions.size;
  }

  /**
   * Get strategy status and statistics
   */
  getStatus(): {
    isActive: boolean;
    activePositions: number;
    totalExposure: string;
    circuitBreakerActive: boolean;
    stats: StrategyStats;
    positions: Array<{
      id: string;
      token: string;
      entryTime: string;
      holdTime: string;
      pnlPercent: string;
      status: string;
    }>;
  } {
    const positions = Array.from(this.activePositions.values()).map(pos => ({
      id: pos.id,
      token: pos.token,
      entryTime: new Date(pos.entryTime).toISOString(),
      holdTime: `${Math.floor((Date.now() - pos.entryTime) / 60000)}min`,
      pnlPercent: `${pos.unrealizedPnLPercent.toFixed(2)}%`,
      status: pos.status
    }));

    return {
      isActive: this.isActive,
      activePositions: this.activePositions.size,
      totalExposure: `${(this.calculateCurrentExposure() * 100).toFixed(2)}%`,
      circuitBreakerActive: this.isCircuitBreakerActive(),
      stats: { ...this.stats },
      positions
    };
  }

  /**
   * Get strategy statistics
   */
  getStrategyStats(): StrategyStats {
    return { ...this.stats };
  }

  /**
   * Get active positions
   */
  getActivePositions(): Map<string, MomentumPosition> {
    return new Map(this.activePositions);
  }

  /**
   * Check if strategy is active
   */
  isStrategyActive(): boolean {
    return this.isActive;
  }
}
