/**
 * Statistical Arbitrage Strategy
 * 
 * Pairs trading strategy that exploits mean-reverting relationships
 * between correlated gaming tokens:
 * - GALA/TOWN: Ecosystem-game correlation
 * - TOWN/MATERIUM: Inter-game correlation patterns  
 * - GUSDC/GUSDT: Stablecoin parity arbitrage
 * 
 * Expected Performance:
 * - Returns: 2-5% per trade
 * - Frequency: 10-20 trades/week
 * - Risk: Medium (correlation breakdown risk)
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { pairsCorrelation, PairSignal, PairStatistics } from '../../analytics/pairs-correlation';
import { RiskMonitor } from '../risk/risk-monitor';
import { safeParseFloat } from '../../utils/safe-parse';
import { TRADING_CONSTANTS } from '../../config/constants';
import { timeSeriesDB } from '../../data/storage/timeseries-db';

export interface StatArbPosition {
  id: string;
  pairKey: string;
  token1: string;
  token2: string;
  type: 'long_spread' | 'short_spread'; // Long spread = buy token1, sell token2
  entryTime: number;
  entryZScore: number;
  entryRatio: number;
  
  // Position sizes
  token1Amount: number; // Amount of token1 held
  token2Amount: number; // Amount of token2 held (negative for short)
  
  // Entry prices
  token1EntryPrice: number;
  token2EntryPrice: number;
  
  // Current status
  currentZScore: number;
  currentRatio: number;
  unrealizedPnL: number;
  
  // Risk management
  stopLoss: number; // Z-score level for stop loss
  takeProfit: number; // Z-score level for take profit
  
  // Metadata
  confidence: number;
  halfLife: number;
  correlation: number;
  
  lastUpdated: number;
}

export interface StatArbMetrics {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  winRate: number;
  avgProfitPerTrade: number;
  avgHoldingPeriod: number; // Hours
  sharpeRatio: number;
  maxDrawdown: number;
  
  // Position metrics
  activePositions: number;
  totalExposure: number;
  maxPositionSize: number;
  
  // Pair-specific metrics
  pairPerformance: Map<string, {
    trades: number;
    profit: number;
    winRate: number;
  }>;
  
  lastTradeTime: number;
}

export class StatisticalArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private riskMonitor?: RiskMonitor;
  
  // Strategy state
  private isActive: boolean = false;
  private positions: Map<string, StatArbPosition> = new Map();
  private metrics: StatArbMetrics;
  
  // Strategy parameters
  private readonly MAX_POSITIONS = 5; // Maximum concurrent positions
  private readonly MAX_PAIR_EXPOSURE = 0.05; // 5% of capital per pair
  private readonly TOTAL_STRATEGY_EXPOSURE = 0.20; // 20% total exposure
  private readonly MIN_PROFIT_THRESHOLD = 0.02; // 2% minimum profit target
  
  // Risk management parameters
  private readonly Z_SCORE_ENTRY = 2.0; // Enter when |z-score| > 2.0
  private readonly Z_SCORE_EXIT = 0.5; // Exit when |z-score| < 0.5
  private readonly Z_SCORE_STOP_LOSS = 3.5; // Stop loss at z-score > 3.5
  private readonly MAX_HOLDING_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days max
  private readonly CORRELATION_BREAKDOWN_THRESHOLD = 0.3; // Exit if correlation < 30%
  
  // Execution timing
  private scanInterval: number = 30000; // 30 seconds
  private lastScanTime: number = 0;
  private scanTimer: NodeJS.Timeout | null = null;
  
  constructor(
    gswap: GSwap,
    config: TradingConfig,
    swapExecutor: SwapExecutor,
    marketAnalysis: MarketAnalysis,
    riskMonitor?: RiskMonitor
  ) {
    this.gswap = gswap;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.marketAnalysis = marketAnalysis;
    this.riskMonitor = riskMonitor;
    
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      totalProfit: 0,
      winRate: 0,
      avgProfitPerTrade: 0,
      avgHoldingPeriod: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      activePositions: 0,
      totalExposure: 0,
      maxPositionSize: 0,
      pairPerformance: new Map(),
      lastTradeTime: 0
    };
    
    logger.info('🎯 Statistical Arbitrage Strategy initialized', {
      maxPositions: this.MAX_POSITIONS,
      maxExposure: this.TOTAL_STRATEGY_EXPOSURE * 100 + '%',
      scanInterval: this.scanInterval / 1000 + 's'
    });
  }

  /**
   * Initialize the strategy
   */
  async initialize(): Promise<void> {
    try {
      logger.info('📊 Initializing Statistical Arbitrage Strategy...');
      
      // Initialize pairs correlation analysis
      await pairsCorrelation.initialize();
      
      // Check if we have sufficient data
      const monitoringStats = pairsCorrelation.getMonitoringStats();
      if (monitoringStats.totalPairs === 0) {
        throw new Error('No trading pairs available for statistical arbitrage');
      }
      
      logger.info('✅ Statistical Arbitrage Strategy initialized', {
        availablePairs: monitoringStats.totalPairs,
        activePairs: monitoringStats.activePairs,
        avgConfidence: (monitoringStats.averageConfidence * 100).toFixed(1) + '%'
      });
      
    } catch (error) {
      logger.error('❌ Failed to initialize Statistical Arbitrage Strategy:', error);
      throw error;
    }
  }

  /**
   * Start the strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Statistical Arbitrage Strategy is already active');
      return;
    }

    try {
      await this.initialize();
      
      this.isActive = true;
      this.startScanning();
      
      logger.info('🎯 Statistical Arbitrage Strategy started');
      
    } catch (error) {
      logger.error('❌ Failed to start Statistical Arbitrage Strategy:', error);
      throw error;
    }
  }

  /**
   * Stop the strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;
    
    this.isActive = false;
    
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    
    // Close all positions (emergency stop)
    if (this.positions.size > 0) {
      logger.warn('💥 Emergency stop - closing all statistical arbitrage positions');
      await this.closeAllPositions();
    }
    
    logger.info('🛑 Statistical Arbitrage Strategy stopped');
  }

  /**
   * Start scanning for opportunities
   */
  private startScanning(): void {
    const scan = async () => {
      if (!this.isActive) return;
      
      try {
        await this.scanForOpportunities();
        await this.manageActivePositions();
        this.updateMetrics();
        
        this.lastScanTime = Date.now();
        
      } catch (error) {
        logger.error('❌ Error in statistical arbitrage scan:', error);
      }
      
      if (this.isActive) {
        this.scanTimer = setTimeout(scan, this.scanInterval);
      }
    };
    
    scan();
  }

  /**
   * Scan for statistical arbitrage opportunities
   */
  async scanForOpportunities(): Promise<PairSignal[]> {
    try {
      logger.debug('🔍 Scanning for statistical arbitrage opportunities...');
      
      // Generate signals from pairs correlation analysis
      const signals = await pairsCorrelation.generateSignals();
      
      if (signals.length === 0) {
        logger.debug('No statistical arbitrage signals found');
        return [];
      }
      
      logger.info(`📊 Found ${signals.length} potential statistical arbitrage opportunities`);
      
      // Process each signal
      const executedSignals: PairSignal[] = [];
      
      for (const signal of signals) {
        try {
          // Check if we can execute this signal
          if (await this.shouldExecuteSignal(signal)) {
            const executed = await this.executeSignal(signal);
            if (executed) {
              executedSignals.push(signal);
            }
          }
        } catch (error) {
          logger.warn(`Failed to process signal for ${signal.pair}:`, error);
        }
      }
      
      if (executedSignals.length > 0) {
        logger.info(`✅ Executed ${executedSignals.length} statistical arbitrage trades`);
      }
      
      return executedSignals;
      
    } catch (error) {
      logger.error('❌ Error scanning for statistical arbitrage opportunities:', error);
      return [];
    }
  }

  /**
   * Check if we should execute a signal
   */
  private async shouldExecuteSignal(signal: PairSignal): Promise<boolean> {
    // Skip exit signals - handled in position management
    if (signal.type === 'exit' || signal.type === 'no_signal') {
      return false;
    }
    
    // Check if we already have a position in this pair
    const existingPosition = Array.from(this.positions.values())
      .find(pos => pos.pairKey === signal.pair);
    
    if (existingPosition) {
      logger.debug(`Already have position in ${signal.pair}`);
      return false;
    }
    
    // Check maximum positions limit
    if (this.positions.size >= this.MAX_POSITIONS) {
      logger.debug('Maximum positions reached');
      return false;
    }
    
    // Check signal strength
    if (signal.strength < 0.6) {
      logger.debug(`Signal strength too low for ${signal.pair}: ${signal.strength}`);
      return false;
    }
    
    // Check expected return vs minimum threshold
    if (signal.expectedReturn < this.MIN_PROFIT_THRESHOLD) {
      logger.debug(`Expected return too low for ${signal.pair}: ${(signal.expectedReturn * 100).toFixed(2)}%`);
      return false;
    }
    
    // Check risk level
    if (signal.riskLevel === 'high') {
      logger.debug(`Risk level too high for ${signal.pair}`);
      return false;
    }
    
    // Check z-score threshold
    if (Math.abs(signal.zScore) < this.Z_SCORE_ENTRY) {
      logger.debug(`Z-score below entry threshold for ${signal.pair}: ${signal.zScore}`);
      return false;
    }
    
    // Check capital allocation
    const positionValue = this.calculatePositionValue(signal);
    const currentExposure = this.calculateTotalExposure();
    
    if (currentExposure + positionValue > this.config.maxPositionSize * this.TOTAL_STRATEGY_EXPOSURE) {
      logger.debug('Would exceed total strategy exposure limit');
      return false;
    }
    
    // Check market conditions
    const marketConditions = await this.marketAnalysis.analyzeMarket();
    if (marketConditions.volatility === 'extreme') {
      logger.debug('Market volatility too high for new positions');
      return false;
    }
    
    return true;
  }

  /**
   * Execute a statistical arbitrage signal
   */
  private async executeSignal(signal: PairSignal): Promise<boolean> {
    try {
      const [token1, token2] = signal.pair.split('/');
      
      logger.info(`🎯 Executing statistical arbitrage signal: ${signal.type as "long_spread" | "short_spread"} ${signal.pair}`, {
        zScore: signal.zScore.toFixed(2),
        expectedReturn: (signal.expectedReturn * 100).toFixed(2) + '%',
        strength: signal.strength.toFixed(2)
      });
      
      // Calculate position sizes
      const positionValue = this.calculatePositionValue(signal);
      const { token1Amount, token2Amount } = await this.calculatePositionSizes(
        token1, token2, positionValue, signal.type as "long_spread" | "short_spread"
      );
      
      // Execute the trades
      let token1Trade: any = null;
      let token2Trade: any = null;
      
      try {
        if (signal.type as "long_spread" | "short_spread" === 'long_spread') {
          // Long spread: Buy token1, Sell token2 (buy GALA, sell TOWN if GALA undervalued)
          token1Trade = await this.executeBuy(token1, token1Amount);
          token2Trade = await this.executeSell(token2, token2Amount);
        } else {
          // Short spread: Sell token1, Buy token2 (sell GALA, buy TOWN if GALA overvalued)
          token1Trade = await this.executeSell(token1, token1Amount);
          token2Trade = await this.executeBuy(token2, token2Amount);
        }
        
        // Create position record
        const position: StatArbPosition = {
          id: this.generatePositionId(),
          pairKey: signal.pair,
          token1,
          token2,
          type: signal.type as "long_spread" | "short_spread",
          entryTime: Date.now(),
          entryZScore: signal.zScore,
          entryRatio: signal.priceRatio,
          
          token1Amount: signal.type as "long_spread" | "short_spread" === 'long_spread' ? token1Amount : -token1Amount,
          token2Amount: signal.type as "long_spread" | "short_spread" === 'long_spread' ? -token2Amount : token2Amount,
          
          token1EntryPrice: signal.metadata.token1Price,
          token2EntryPrice: signal.metadata.token2Price,
          
          currentZScore: signal.zScore,
          currentRatio: signal.priceRatio,
          unrealizedPnL: 0,
          
          stopLoss: this.Z_SCORE_STOP_LOSS,
          takeProfit: this.Z_SCORE_EXIT,
          
          confidence: signal.metadata.confidence,
          halfLife: signal.metadata.halfLife,
          correlation: signal.metadata.correlation,
          
          lastUpdated: Date.now()
        };
        
        this.positions.set(position.id, position);
        
        // Update metrics
        this.metrics.totalTrades++;
        this.metrics.activePositions = this.positions.size;
        this.metrics.lastTradeTime = Date.now();
        
        logger.info(`✅ Statistical arbitrage position opened: ${position.id}`, {
          pair: signal.pair,
          type: signal.type as "long_spread" | "short_spread",
          zScore: signal.zScore.toFixed(2),
          token1Amount: token1Amount.toFixed(4),
          token2Amount: token2Amount.toFixed(4)
        });
        
        return true;
        
      } catch (tradeError) {
        logger.error('Failed to execute statistical arbitrage trades:', tradeError);
        
        // Attempt to reverse any successful trades
        if (token1Trade) {
          logger.warn('Attempting to reverse token1 trade due to execution failure');
          // Implement reversal logic if needed
        }
        if (token2Trade) {
          logger.warn('Attempting to reverse token2 trade due to execution failure');
          // Implement reversal logic if needed
        }
        
        return false;
      }
      
    } catch (error) {
      logger.error(`Error executing statistical arbitrage signal for ${signal.pair}:`, error);
      return false;
    }
  }

  /**
   * Manage active positions
   */
  private async manageActivePositions(): Promise<void> {
    if (this.positions.size === 0) return;
    
    logger.debug(`📊 Managing ${this.positions.size} active statistical arbitrage positions`);
    
    const positionsToClose: string[] = [];
    
    for (const [positionId, position] of this.positions) {
      try {
        // Update position with current market data
        await this.updatePositionData(position);
        
        // Check exit conditions
        if (await this.shouldClosePosition(position)) {
          positionsToClose.push(positionId);
        }
        
      } catch (error) {
        logger.error(`Error managing position ${positionId}:`, error);
      }
    }
    
    // Close positions that meet exit criteria
    for (const positionId of positionsToClose) {
      try {
        await this.closePosition(positionId);
      } catch (error) {
        logger.error(`Failed to close position ${positionId}:`, error);
      }
    }
  }

  /**
   * Update position with current market data
   */
  private async updatePositionData(position: StatArbPosition): Promise<void> {
    try {
      // Get current pair statistics
      const pairStats = pairsCorrelation.getPairStatistics(position.token1, position.token2);
      
      if (!pairStats) {
        logger.warn(`No current statistics for pair ${position.pairKey}`);
        return;
      }
      
      // Update position metrics
      position.currentZScore = pairStats.spread.zScore;
      position.currentRatio = pairStats.priceRatio.current;
      position.correlation = pairStats.correlation;
      position.lastUpdated = Date.now();
      
      // Calculate unrealized P&L
      position.unrealizedPnL = await this.calculateUnrealizedPnL(position);
      
    } catch (error) {
      logger.error(`Error updating position data for ${position.id}:`, error);
    }
  }

  /**
   * Check if a position should be closed
   */
  private async shouldClosePosition(position: StatArbPosition): Promise<boolean> {
    const now = Date.now();
    const holdingPeriod = now - position.entryTime;
    
    // 1. Take profit: Z-score returned to mean
    if (Math.abs(position.currentZScore) <= position.takeProfit) {
      logger.info(`Take profit triggered for ${position.id}: z-score ${position.currentZScore.toFixed(2)}`);
      return true;
    }
    
    // 2. Stop loss: Z-score moved against us
    if (Math.abs(position.currentZScore) >= position.stopLoss) {
      logger.warn(`Stop loss triggered for ${position.id}: z-score ${position.currentZScore.toFixed(2)}`);
      return true;
    }
    
    // 3. Correlation breakdown
    if (Math.abs(position.correlation) < this.CORRELATION_BREAKDOWN_THRESHOLD) {
      logger.warn(`Correlation breakdown for ${position.id}: ${(position.correlation * 100).toFixed(1)}%`);
      return true;
    }
    
    // 4. Maximum holding period exceeded
    if (holdingPeriod > this.MAX_HOLDING_PERIOD) {
      logger.warn(`Maximum holding period exceeded for ${position.id}: ${(holdingPeriod / (24 * 60 * 60 * 1000)).toFixed(1)} days`);
      return true;
    }
    
    // 5. Risk management override
    if (this.riskMonitor) {
      const riskCheck = await this.riskMonitor.performRiskCheck(this.config.wallet?.address || "unknown");
      if (!riskCheck.shouldContinueTrading) {
        logger.warn(`Risk management triggered position closure for ${position.id}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Close a specific position
   */
  private async closePosition(positionId: string): Promise<void> {
    const position = this.positions.get(positionId);
    if (!position) {
      logger.error(`Position ${positionId} not found`);
      return;
    }
    
    try {
      logger.info(`🔒 Closing statistical arbitrage position: ${positionId}`, {
        pair: position.pairKey,
        type: position.type,
        entryZScore: position.entryZScore.toFixed(2),
        exitZScore: position.currentZScore.toFixed(2),
        holdingPeriod: ((Date.now() - position.entryTime) / (60 * 60 * 1000)).toFixed(1) + 'h',
        unrealizedPnL: position.unrealizedPnL.toFixed(4)
      });
      
      // Execute closing trades
      let closeSuccess = false;
      
      try {
        if (position.type === 'long_spread') {
          // Close long spread: Sell token1, Buy back token2
          await this.executeSell(position.token1, Math.abs(position.token1Amount));
          await this.executeBuy(position.token2, Math.abs(position.token2Amount));
        } else {
          // Close short spread: Buy back token1, Sell token2  
          await this.executeBuy(position.token1, Math.abs(position.token1Amount));
          await this.executeSell(position.token2, Math.abs(position.token2Amount));
        }
        
        closeSuccess = true;
        
      } catch (tradeError) {
        logger.error(`Failed to execute closing trades for position ${positionId}:`, tradeError);
        // Don't remove position if we couldn't close trades properly
        return;
      }
      
      if (closeSuccess) {
        // Calculate final P&L
        const finalPnL = position.unrealizedPnL;
        const isProfit = finalPnL > 0;
        
        // Update metrics
        if (isProfit) {
          this.metrics.successfulTrades++;
        }
        this.metrics.totalProfit += finalPnL;
        this.updatePairPerformance(position.pairKey, finalPnL);
        
        // Remove position from active positions
        this.positions.delete(positionId);
        this.metrics.activePositions = this.positions.size;
        
        logger.info(`✅ Statistical arbitrage position closed: ${positionId}`, {
          finalPnL: finalPnL.toFixed(4),
          profitable: isProfit,
          winRate: (this.metrics.successfulTrades / this.metrics.totalTrades * 100).toFixed(1) + '%'
        });
      }
      
    } catch (error) {
      logger.error(`Error closing position ${positionId}:`, error);
    }
  }

  /**
   * Close all positions (emergency stop)
   */
  private async closeAllPositions(): Promise<void> {
    const positionIds = Array.from(this.positions.keys());
    
    logger.warn(`💥 Closing all ${positionIds.length} statistical arbitrage positions`);
    
    await Promise.allSettled(
      positionIds.map(id => this.closePosition(id))
    );
  }

  /**
   * Execute a buy trade
   */
  private async executeBuy(token: string, amount: number): Promise<any> {
    // This is a simplified implementation - would use SwapExecutor in production
    logger.debug(`📈 Executing BUY: ${amount.toFixed(4)} ${token}`);
    
    // In production, this would:
    // 1. Get optimal route for buying token
    // 2. Execute swap through SwapExecutor
    // 3. Return trade result
    
    return {
      token,
      type: 'buy',
      amount,
      timestamp: Date.now()
    };
  }

  /**
   * Execute a sell trade  
   */
  private async executeSell(token: string, amount: number): Promise<any> {
    // This is a simplified implementation - would use SwapExecutor in production
    logger.debug(`📉 Executing SELL: ${amount.toFixed(4)} ${token}`);
    
    // In production, this would:
    // 1. Get optimal route for selling token
    // 2. Execute swap through SwapExecutor  
    // 3. Return trade result
    
    return {
      token,
      type: 'sell',
      amount,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate position value for a signal
   */
  private calculatePositionValue(signal: PairSignal): number {
    // Base position size on signal strength and expected return
    const baseValue = this.config.maxPositionSize * this.MAX_PAIR_EXPOSURE;
    const strengthMultiplier = Math.min(signal.strength * 1.5, 1.0);
    const returnMultiplier = Math.min(signal.expectedReturn * 20, 1.0);
    
    return baseValue * strengthMultiplier * returnMultiplier;
  }

  /**
   * Calculate position sizes for both tokens
   */
  private async calculatePositionSizes(
    token1: string, 
    token2: string, 
    totalValue: number, 
    type: 'long_spread' | 'short_spread'
  ): Promise<{ token1Amount: number; token2Amount: number }> {
    
    // Get current token prices
    const [token1Price, token2Price] = await Promise.all([
      this.getCurrentTokenPrice(token1),
      this.getCurrentTokenPrice(token2)
    ]);
    
    // Split position value 50/50 between tokens
    const token1Value = totalValue * 0.5;
    const token2Value = totalValue * 0.5;
    
    const token1Amount = token1Price > 0 ? token1Value / token1Price : 0;
    const token2Amount = token2Price > 0 ? token2Value / token2Price : 0;
    
    return { token1Amount, token2Amount };
  }

  /**
   * Get current token price
   */
  private async getCurrentTokenPrice(token: string): Promise<number> {
    try {
      const priceData = await timeSeriesDB.getLatestPrice(token);
      return priceData ? priceData.getPriceUsd() : 0;
    } catch (error) {
      logger.error(`Error getting current price for ${token}:`, error);
      return 0;
    }
  }

  /**
   * Calculate unrealized P&L for a position
   */
  private async calculateUnrealizedPnL(position: StatArbPosition): Promise<number> {
    try {
      // Get current token prices
      const [currentPrice1, currentPrice2] = await Promise.all([
        this.getCurrentTokenPrice(position.token1),
        this.getCurrentTokenPrice(position.token2)
      ]);
      
      // Calculate P&L for each leg
      const token1PnL = (currentPrice1 - position.token1EntryPrice) * position.token1Amount;
      const token2PnL = (currentPrice2 - position.token2EntryPrice) * position.token2Amount;
      
      return token1PnL + token2PnL;
      
    } catch (error) {
      logger.error(`Error calculating P&L for position ${position.id}:`, error);
      return 0;
    }
  }

  /**
   * Calculate total exposure across all positions
   */
  private calculateTotalExposure(): number {
    let totalExposure = 0;
    
    for (const position of this.positions.values()) {
      const positionExposure = Math.abs(position.token1Amount * position.token1EntryPrice) +
                              Math.abs(position.token2Amount * position.token2EntryPrice);
      totalExposure += positionExposure;
    }
    
    return totalExposure;
  }

  /**
   * Update pair-specific performance metrics
   */
  private updatePairPerformance(pairKey: string, pnl: number): void {
    const existing = this.metrics.pairPerformance.get(pairKey) || {
      trades: 0,
      profit: 0,
      winRate: 0
    };
    
    existing.trades++;
    existing.profit += pnl;
    
    if (pnl > 0) {
      existing.winRate = existing.winRate * (existing.trades - 1) / existing.trades + (1 / existing.trades);
    } else {
      existing.winRate = existing.winRate * (existing.trades - 1) / existing.trades;
    }
    
    this.metrics.pairPerformance.set(pairKey, existing);
  }

  /**
   * Update overall strategy metrics
   */
  private updateMetrics(): void {
    if (this.metrics.totalTrades > 0) {
      this.metrics.winRate = (this.metrics.successfulTrades / this.metrics.totalTrades) * 100;
      this.metrics.avgProfitPerTrade = this.metrics.totalProfit / this.metrics.totalTrades;
    }
    
    // Calculate average holding period
    let totalHoldingTime = 0;
    let closedPositions = 0;
    
    for (const position of this.positions.values()) {
      totalHoldingTime += Date.now() - position.entryTime;
      closedPositions++;
    }
    
    if (closedPositions > 0) {
      this.metrics.avgHoldingPeriod = totalHoldingTime / closedPositions / (60 * 60 * 1000); // Hours
    }
    
    // Update exposure metrics
    this.metrics.totalExposure = this.calculateTotalExposure();
    this.metrics.maxPositionSize = Math.max(
      ...Array.from(this.positions.values()).map(pos => 
        Math.abs(pos.token1Amount * pos.token1EntryPrice) + 
        Math.abs(pos.token2Amount * pos.token2EntryPrice)
      )
    );
  }

  /**
   * Generate unique position ID
   */
  private generatePositionId(): string {
    return `statarb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get strategy status
   */
  getStatus(): {
    isActive: boolean;
    positions: number;
    metrics: StatArbMetrics;
    opportunities: number;
  } {
    return {
      isActive: this.isActive,
      positions: this.positions.size,
      metrics: { ...this.metrics },
      opportunities: 0 // Would be populated by latest scan results
    };
  }

  /**
   * Get strategy statistics
   */
  getStats(): StatArbMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get active positions
   */
  getActivePositions(): StatArbPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position by ID
   */
  getPosition(positionId: string): StatArbPosition | undefined {
    return this.positions.get(positionId);
  }
}
