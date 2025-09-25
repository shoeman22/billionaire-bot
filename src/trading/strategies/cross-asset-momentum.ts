/**
 * Cross-Asset Momentum Strategy
 *
 * Capitalizes on momentum and correlation breakdown opportunities across crypto assets:
 * - Tracks GWETH/GWBTC and other volatile asset correlations
 * - Executes trades when correlation patterns break
 * - Uses volume-weighted momentum indicators
 * - Captures delayed price movements between correlated assets
 *
 * Key Features:
 * - Real-time correlation monitoring
 * - Volume-weighted price momentum
 * - Divergence detection algorithms
 * - Risk-adjusted position sizing
 * - Multi-timeframe analysis
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig, getConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { createQuoteWrapper } from '../../utils/quote-api';
import { credentialService } from '../../security/credential-service';

export interface AssetPair {
  assetA: string;
  assetB: string;
  symbol: string; // e.g., "GWETH/GWBTC"
  baseCorrelation: number; // Historical correlation (0-1)
  currentCorrelation: number; // Recent correlation
  correlationPeriod: number; // Lookback period in minutes
  momentumThreshold: number; // Minimum momentum % for signal
  volumeThreshold: number; // Minimum volume for validity
  isActive: boolean;
  lastUpdate: number;
}

export interface PricePoint {
  price: number;
  volume: number;
  timestamp: number;
}

export interface MomentumIndicators {
  price: number;
  volume: number;
  momentum: number; // Price change %
  volumeWeightedMomentum: number;
  relativeStrength: number; // vs other assets
  divergenceScore: number; // How much it diverges from correlation
  signal: 'BUY' | 'SELL' | 'HOLD';
  strength: number; // Signal strength 0-1
}

export interface MomentumOpportunity {
  pair: AssetPair;
  asset: string; // Which asset to trade
  direction: 'LONG' | 'SHORT'; // Long = expect price increase
  correlationBreakdown: {
    expected: number; // Expected price based on correlation
    actual: number; // Actual current price
    deviation: number; // Deviation %
  };
  indicators: MomentumIndicators;
  positionSize: number;
  expectedReturn: number;
  riskScore: number; // 0-1, higher is riskier
  confidenceLevel: number; // 0-1
  timeHorizon: number; // Expected holding time in minutes
  stopLoss: number; // Stop loss price
  takeProfit: number; // Take profit price
  timestamp: number;
}

export interface MomentumStats {
  totalSignals: number;
  executedTrades: number;
  profitableTrades: number;
  totalProfit: number;
  avgHoldingTime: number;
  bestCorrelationBreakdown: number;
  avgCorrelation: number;
  totalVolume: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
}

export class CrossAssetMomentumStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private quoteWrapper: any;
  private baseUrl: string;
  private isActive: boolean = false;

  // Asset pairs to monitor
  private pairs: Map<string, AssetPair> = new Map();

  // Price history for correlation analysis
  private priceHistory: Map<string, PricePoint[]> = new Map();
  private readonly PRICE_HISTORY_LIMIT = 1000; // Keep last 1000 data points

  // Strategy configuration
  private readonly CORRELATION_THRESHOLD = 0.7; // Min correlation for pairing
  private readonly BREAKOUT_MULTIPLIER = 1.5; // Momentum breakout threshold
  private readonly MAX_POSITION_SIZE = 5000; // $5k max position
  private readonly MIN_CONFIDENCE = 0.6; // 60% confidence threshold
  private readonly UPDATE_INTERVAL = 30000; // 30 seconds between updates
  private readonly CORRELATION_PERIOD = 60; // 60-minute correlation window
  private readonly VOLUME_WEIGHT = 0.3; // Volume weight in momentum calculation

  // Risk management
  private readonly MAX_RISK_PERCENTAGE = 2.0; // 2% max risk per trade
  private readonly STOP_LOSS_PERCENTAGE = 1.5; // 1.5% stop loss
  private readonly TAKE_PROFIT_PERCENTAGE = 3.0; // 3% take profit
  private readonly MAX_CORRELATION_DEVIATION = 0.3; // 30% max deviation from expected

  // Statistics
  private stats: MomentumStats = {
    totalSignals: 0,
    executedTrades: 0,
    profitableTrades: 0,
    totalProfit: 0,
    avgHoldingTime: 0,
    bestCorrelationBreakdown: 0,
    avgCorrelation: 0,
    totalVolume: 0,
    winRate: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    currentDrawdown: 0
  };

  // Active positions tracking
  private activePositions: Map<string, {
    asset: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    size: number;
    stopLoss: number;
    takeProfit: number;
    entryTime: number;
  }> = new Map();

  private updateTimer: NodeJS.Timeout | null = null;

  constructor(
    gswap: GSwap,
    config: TradingConfig,
    swapExecutor: SwapExecutor,
    marketAnalysis: MarketAnalysis
  ) {
    this.gswap = gswap;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.marketAnalysis = marketAnalysis;
    const fullConfig = getConfig();
    this.baseUrl = fullConfig.api.baseUrl;
    this.quoteWrapper = createQuoteWrapper(this.baseUrl);

    this.initializeAssetPairs();
    this.initializePriceHistory();

    logger.info('Cross-Asset Momentum Strategy initialized', {
      pairs: Array.from(this.pairs.keys()),
      correlationThreshold: this.CORRELATION_THRESHOLD,
      breakoutMultiplier: this.BREAKOUT_MULTIPLIER,
      updateInterval: this.UPDATE_INTERVAL
    });
  }

  /**
   * Initialize monitored asset pairs
   */
  private initializeAssetPairs(): void {
    // Primary crypto pair: GWETH/GWBTC
    this.pairs.set('GWETH/GWBTC', {
      assetA: 'GWETH',
      assetB: 'GWBTC',
      symbol: 'GWETH/GWBTC',
      baseCorrelation: 0.8, // Assume 80% base correlation
      currentCorrelation: 0,
      correlationPeriod: this.CORRELATION_PERIOD,
      momentumThreshold: 2.0, // 2% momentum threshold
      volumeThreshold: 1000, // $1k min volume
      isActive: true,
      lastUpdate: 0
    });

    // Secondary pairs
    this.pairs.set('GALA/GWETH', {
      assetA: 'GALA',
      assetB: 'GWETH',
      symbol: 'GALA/GWETH',
      baseCorrelation: 0.6,
      currentCorrelation: 0,
      correlationPeriod: this.CORRELATION_PERIOD,
      momentumThreshold: 3.0, // Higher threshold for more volatile pair
      volumeThreshold: 5000,
      isActive: true,
      lastUpdate: 0
    });

    this.pairs.set('GALA/GWBTC', {
      assetA: 'GALA',
      assetB: 'GWBTC',
      symbol: 'GALA/GWBTC',
      baseCorrelation: 0.65,
      currentCorrelation: 0,
      correlationPeriod: this.CORRELATION_PERIOD,
      momentumThreshold: 3.0,
      volumeThreshold: 5000,
      isActive: true,
      lastUpdate: 0
    });
  }

  /**
   * Initialize price history storage
   */
  private initializePriceHistory(): void {
    const assets = ['GALA', 'GWETH', 'GWBTC', 'GUSDC'];
    for (const asset of assets) {
      this.priceHistory.set(asset, []);
    }
  }

  /**
   * Start the cross-asset momentum strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Cross-asset momentum strategy is already active');
      return;
    }

    this.isActive = true;
    logger.info('📈 Starting Cross-Asset Momentum Strategy');

    // Start data collection
    await this.startDataCollection();

    // Start signal monitoring
    this.startSignalMonitoring();
  }

  /**
   * Stop the strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    this.isActive = false;

    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    logger.info('🛑 Cross-Asset Momentum Strategy stopped', {
      stats: this.getStats(),
      activePositions: this.activePositions.size
    });
  }

  /**
   * Start continuous data collection
   */
  private async startDataCollection(): Promise<void> {
    const updatePrices = async () => {
      if (!this.isActive) return;

      try {
        await this.updatePriceData();
        await this.updateCorrelations();
      } catch (error) {
        logger.error('Error updating market data', { error });
      }

      if (this.isActive) {
        this.updateTimer = setTimeout(updatePrices, this.UPDATE_INTERVAL);
      }
    };

    await updatePrices();
  }

  /**
   * Start signal monitoring and execution
   */
  private startSignalMonitoring(): void {
    const checkSignals = async () => {
      if (!this.isActive) return;

      try {
        const opportunities = await this.scanForMomentumOpportunities();

        for (const opportunity of opportunities) {
          if (this.shouldExecuteTrade(opportunity)) {
            await this.executeMomentumTrade(opportunity);
          }
        }

        // Check active positions for exit signals
        await this.checkActivePositions();

      } catch (error) {
        logger.error('Error in signal monitoring', { error });
      }

      if (this.isActive) {
        setTimeout(checkSignals, this.UPDATE_INTERVAL / 2); // Check signals more frequently
      }
    };

    checkSignals();
  }

  /**
   * Update price data for all monitored assets
   */
  private async updatePriceData(): Promise<void> {
    const assets = Array.from(this.priceHistory.keys());

    for (const asset of assets) {
      try {
        // Get current price (using GUSDC as base for consistency)
        const quote = await this.getQuote(asset, 'GUSDC', 1);
        if (!quote) continue;

        // Get real volume data from pool information
        const volume = await this.getAssetVolume(asset, 'GUSDC');

        const pricePoint: PricePoint = {
          price: quote.outputAmount,
          volume: volume,
          timestamp: Date.now()
        };

        // Add to history
        const history = this.priceHistory.get(asset) || [];
        history.push(pricePoint);

        // Trim history to limit
        if (history.length > this.PRICE_HISTORY_LIMIT) {
          history.shift();
        }

        this.priceHistory.set(asset, history);

      } catch (error) {
        logger.warn(`Failed to update price for ${asset}`, { error });
      }
    }
  }

  /**
   * Update correlation calculations for all pairs
   */
  private async updateCorrelations(): Promise<void> {
    for (const [pairSymbol, pair] of this.pairs.entries()) {
      try {
        const historyA = this.priceHistory.get(pair.assetA) || [];
        const historyB = this.priceHistory.get(pair.assetB) || [];

        if (historyA.length < 10 || historyB.length < 10) continue;

        // Calculate correlation over the specified period
        const correlation = this.calculateCorrelation(historyA, historyB, pair.correlationPeriod);

        pair.currentCorrelation = correlation;
        pair.lastUpdate = Date.now();

        // Update average correlation stat
        this.stats.avgCorrelation = (this.stats.avgCorrelation + correlation) / 2;

      } catch (error) {
        logger.warn(`Failed to update correlation for ${pairSymbol}`, { error });
      }
    }
  }

  /**
   * Calculate correlation between two asset price series
   */
  private calculateCorrelation(
    seriesA: PricePoint[],
    seriesB: PricePoint[],
    periodMinutes: number
  ): number {
    const cutoffTime = Date.now() - (periodMinutes * 60 * 1000);

    // Filter data to period
    const recentA = seriesA.filter(p => p.timestamp >= cutoffTime);
    const recentB = seriesB.filter(p => p.timestamp >= cutoffTime);

    if (recentA.length < 5 || recentB.length < 5) return 0;

    // Calculate price changes (returns)
    const returnsA = this.calculateReturns(recentA);
    const returnsB = this.calculateReturns(recentB);

    if (returnsA.length !== returnsB.length || returnsA.length < 3) return 0;

    // Calculate correlation coefficient
    const correlation = this.pearsonCorrelation(returnsA, returnsB);
    return Math.max(-1, Math.min(1, correlation)); // Clamp to [-1, 1]
  }

  /**
   * Calculate price returns from price series
   */
  private calculateReturns(prices: PricePoint[]): number[] {
    const returns: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const returnValue = (prices[i].price - prices[i-1].price) / prices[i-1].price;
      returns.push(returnValue);
    }

    return returns;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXX = x.reduce((a, b) => a + b * b, 0);
    const sumYY = y.reduce((a, b) => a + b * b, 0);
    const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Scan for momentum opportunities
   */
  private async scanForMomentumOpportunities(): Promise<MomentumOpportunity[]> {
    const opportunities: MomentumOpportunity[] = [];

    for (const [pairSymbol, pair] of this.pairs.entries()) {
      if (!pair.isActive) continue;

      try {
        // Analyze both assets in the pair
        const opportunityA = await this.analyzeMomentumForAsset(pair, pair.assetA);
        const opportunityB = await this.analyzeMomentumForAsset(pair, pair.assetB);

        if (opportunityA) opportunities.push(opportunityA);
        if (opportunityB) opportunities.push(opportunityB);

      } catch (error) {
        logger.warn(`Failed to analyze momentum for ${pairSymbol}`, { error });
      }
    }

    // Sort by confidence level
    opportunities.sort((a, b) => b.confidenceLevel - a.confidenceLevel);

    this.stats.totalSignals += opportunities.length;

    return opportunities;
  }

  /**
   * Analyze momentum for a specific asset
   */
  private async analyzeMomentumForAsset(
    pair: AssetPair,
    asset: string
  ): Promise<MomentumOpportunity | null> {
    const history = this.priceHistory.get(asset);
    if (!history || history.length < 10) return null;

    try {
      // Calculate momentum indicators
      const indicators = this.calculateMomentumIndicators(history);

      // Skip if no clear signal
      if (indicators.signal === 'HOLD') return null;

      // Calculate expected price based on correlation
      const correlationBreakdown = await this.calculateCorrelationBreakdown(pair, asset);

      if (Math.abs(correlationBreakdown.deviation) < this.MAX_CORRELATION_DEVIATION) {
        return null; // Not enough deviation to trade
      }

      // Calculate position size and risk
      const positionSize = this.calculatePositionSize(indicators.strength, correlationBreakdown.deviation);
      const riskScore = this.calculateRiskScore(indicators, correlationBreakdown);

      // Skip if risk is too high
      if (riskScore > 0.8) return null;

      // Calculate confidence level
      const confidenceLevel = this.calculateConfidenceLevel(indicators, correlationBreakdown, pair);

      if (confidenceLevel < this.MIN_CONFIDENCE) return null;

      // Determine direction based on correlation breakdown
      const direction: 'LONG' | 'SHORT' =
        correlationBreakdown.deviation > 0 ? 'SHORT' : 'LONG'; // Price too high = SHORT

      // Calculate stop loss and take profit
      const currentPrice = history[history.length - 1].price;
      const stopLoss = direction === 'LONG'
        ? currentPrice * (1 - this.STOP_LOSS_PERCENTAGE / 100)
        : currentPrice * (1 + this.STOP_LOSS_PERCENTAGE / 100);

      const takeProfit = direction === 'LONG'
        ? currentPrice * (1 + this.TAKE_PROFIT_PERCENTAGE / 100)
        : currentPrice * (1 - this.TAKE_PROFIT_PERCENTAGE / 100);

      const expectedReturn = Math.abs(correlationBreakdown.deviation) * positionSize / 100;

      return {
        pair,
        asset,
        direction,
        correlationBreakdown,
        indicators,
        positionSize,
        expectedReturn,
        riskScore,
        confidenceLevel,
        timeHorizon: 60, // 1 hour expected holding time
        stopLoss,
        takeProfit,
        timestamp: Date.now()
      };

    } catch (error) {
      logger.warn(`Failed to analyze momentum for asset ${asset}`, { error });
      return null;
    }
  }

  /**
   * Calculate momentum indicators for an asset
   */
  private calculateMomentumIndicators(history: PricePoint[]): MomentumIndicators {
    const recent = history.slice(-20); // Last 20 data points
    if (recent.length < 5) {
      return {
        price: 0,
        volume: 0,
        momentum: 0,
        volumeWeightedMomentum: 0,
        relativeStrength: 0.5,
        divergenceScore: 0,
        signal: 'HOLD',
        strength: 0
      };
    }

    const currentPrice = recent[recent.length - 1].price;
    const previousPrice = recent[0].price;
    const currentVolume = recent[recent.length - 1].volume;

    // Calculate momentum
    const momentum = ((currentPrice - previousPrice) / previousPrice) * 100;

    // Volume-weighted momentum
    const totalVolume = recent.reduce((sum, p) => sum + p.volume, 0);
    const avgVolume = totalVolume / recent.length;
    const volumeWeight = Math.min(2, currentVolume / avgVolume); // Max 2x weight
    const volumeWeightedMomentum = momentum * volumeWeight;

    // Relative strength (simplified)
    const relativeStrength = Math.max(0, Math.min(1, (momentum + 10) / 20)); // Normalize to 0-1

    // Divergence score (momentum vs volume)
    const volumeMomentum = ((currentVolume - avgVolume) / avgVolume) * 100;
    const divergenceScore = Math.abs(momentum - volumeMomentum) / 100;

    // Generate signal
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let strength = 0;

    if (Math.abs(volumeWeightedMomentum) > this.BREAKOUT_MULTIPLIER) {
      signal = volumeWeightedMomentum > 0 ? 'BUY' : 'SELL';
      strength = Math.min(1, Math.abs(volumeWeightedMomentum) / 10); // Normalize to 0-1
    }

    return {
      price: currentPrice,
      volume: currentVolume,
      momentum,
      volumeWeightedMomentum,
      relativeStrength,
      divergenceScore,
      signal,
      strength
    };
  }

  /**
   * Calculate correlation breakdown for an asset
   */
  private async calculateCorrelationBreakdown(
    pair: AssetPair,
    asset: string
  ): Promise<{ expected: number; actual: number; deviation: number }> {
    const otherAsset = asset === pair.assetA ? pair.assetB : pair.assetA;

    const assetHistory = this.priceHistory.get(asset);
    const otherHistory = this.priceHistory.get(otherAsset);

    if (!assetHistory || !otherHistory || assetHistory.length < 2 || otherHistory.length < 2) {
      return { expected: 0, actual: 0, deviation: 0 };
    }

    const currentPrice = assetHistory[assetHistory.length - 1].price;
    const previousPrice = assetHistory[assetHistory.length - 2].price;
    const actualChange = ((currentPrice - previousPrice) / previousPrice) * 100;

    const otherCurrentPrice = otherHistory[otherHistory.length - 1].price;
    const otherPreviousPrice = otherHistory[otherHistory.length - 2].price;
    const otherChange = ((otherCurrentPrice - otherPreviousPrice) / otherPreviousPrice) * 100;

    // Expected change based on correlation
    const expectedChange = otherChange * pair.currentCorrelation;

    // Calculate deviation
    const deviation = actualChange - expectedChange;

    return {
      expected: expectedChange,
      actual: actualChange,
      deviation
    };
  }

  /**
   * Calculate position size based on signal strength and deviation
   */
  private calculatePositionSize(signalStrength: number, deviation: number): number {
    const baseSize = 1000; // $1000 base
    const strengthMultiplier = 1 + signalStrength; // 1-2x based on strength
    const deviationMultiplier = 1 + Math.abs(deviation) / 10; // Increase for larger deviations

    let positionSize = baseSize * strengthMultiplier * deviationMultiplier;

    // Cap at maximum
    positionSize = Math.min(positionSize, this.MAX_POSITION_SIZE);

    return Math.round(positionSize);
  }

  /**
   * Calculate risk score (0-1)
   */
  private calculateRiskScore(
    indicators: MomentumIndicators,
    correlationBreakdown: { deviation: number }
  ): number {
    let riskScore = 0;

    // Higher risk for extreme momentum
    if (Math.abs(indicators.momentum) > 10) riskScore += 0.3;

    // Higher risk for high divergence
    if (indicators.divergenceScore > 0.5) riskScore += 0.3;

    // Higher risk for extreme correlation breakdown
    if (Math.abs(correlationBreakdown.deviation) > 20) riskScore += 0.4;

    return Math.min(1, riskScore);
  }

  /**
   * Calculate confidence level (0-1)
   */
  private calculateConfidenceLevel(
    indicators: MomentumIndicators,
    correlationBreakdown: { deviation: number },
    pair: AssetPair
  ): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence for strong signals
    confidence += indicators.strength * 0.3;

    // Higher confidence for good correlation data
    if (pair.currentCorrelation > this.CORRELATION_THRESHOLD) {
      confidence += 0.2;
    }

    // Higher confidence for significant deviation
    confidence += Math.min(0.3, Math.abs(correlationBreakdown.deviation) / 50);

    return Math.min(1, confidence);
  }

  /**
   * Determine if trade should be executed
   */
  private shouldExecuteTrade(opportunity: MomentumOpportunity): boolean {
    // Check if we already have a position in this asset
    if (this.activePositions.has(opportunity.asset)) return false;

    // Check confidence and risk thresholds
    if (opportunity.confidenceLevel < this.MIN_CONFIDENCE) return false;
    if (opportunity.riskScore > 0.7) return false;

    // Check minimum expected return
    if (opportunity.expectedReturn < 10) return false; // $10 minimum

    return true;
  }

  /**
   * Execute a momentum trade (simulate for now)
   */
  private async executeMomentumTrade(opportunity: MomentumOpportunity): Promise<boolean> {
    const startTime = Date.now();
    this.stats.executedTrades++;

    logger.info('🚀 Executing Cross-Asset Momentum Trade', {
      asset: opportunity.asset,
      direction: opportunity.direction,
      positionSize: opportunity.positionSize,
      expectedReturn: opportunity.expectedReturn,
      confidence: (opportunity.confidenceLevel * 100).toFixed(1) + '%',
      correlationDeviation: opportunity.correlationBreakdown.deviation.toFixed(2) + '%'
    });

    try {
      // Execute real momentum trade using SwapExecutor
      // For LONG: Buy the asset (trade from base currency to asset)
      // For SHORT: Sell the asset (trade from asset to base currency)

      const baseToken = 'GUSDC'; // Use GUSDC as base currency for momentum trades
      let tokenIn: string, tokenOut: string, amountIn: string;

      if (opportunity.direction === 'LONG') {
        // Buy the asset: GUSDC → Asset
        tokenIn = baseToken;
        tokenOut = opportunity.asset;
        amountIn = opportunity.positionSize.toString();
      } else {
        // Sell the asset: Asset → GUSDC
        tokenIn = opportunity.asset;
        tokenOut = baseToken;
        amountIn = opportunity.positionSize.toString();
      }

      // Execute the trade
      const tradeResult = await this.swapExecutor.executeSwap({
        tokenIn: this.getTokenClass(tokenIn),
        tokenOut: this.getTokenClass(tokenOut),
        amountIn,
        userAddress: credentialService.getWalletAddress(),
        slippageTolerance: 0.02 // 2% slippage for volatile momentum trades
      });

      if (!tradeResult.success) {
        logger.error('Momentum trade execution failed', {
          asset: opportunity.asset,
          direction: opportunity.direction,
          error: tradeResult.error
        });
        return false;
      }

      // Record the successful position
      this.activePositions.set(opportunity.asset, {
        asset: opportunity.asset,
        direction: opportunity.direction,
        entryPrice: opportunity.indicators.price,
        size: opportunity.positionSize,
        stopLoss: opportunity.stopLoss,
        takeProfit: opportunity.takeProfit,
        entryTime: Date.now()
      });

      // Update stats
      const executionTime = Date.now() - startTime;
      this.stats.totalVolume += opportunity.positionSize;

      logger.info('✅ Momentum Trade Executed Successfully', {
        asset: opportunity.asset,
        direction: opportunity.direction,
        amountIn,
        amountOut: tradeResult.amountOut,
        entryPrice: opportunity.indicators.price,
        executionTime: `${executionTime}ms`
      });

      return true;

    } catch (error) {
      logger.error('❌ Momentum Trade Failed', {
        asset: opportunity.asset,
        error,
        executionTime: `${Date.now() - startTime}ms`
      });

      return false;
    }
  }

  /**
   * Check active positions for exit signals
   */
  private async checkActivePositions(): Promise<void> {
    for (const [asset, position] of this.activePositions.entries()) {
      try {
        const currentHistory = this.priceHistory.get(asset);
        if (!currentHistory || currentHistory.length === 0) continue;

        const currentPrice = currentHistory[currentHistory.length - 1].price;
        const holdingTime = Date.now() - position.entryTime;

        // Check stop loss and take profit
        let shouldExit = false;
        let exitReason = '';

        if (position.direction === 'LONG') {
          if (currentPrice <= position.stopLoss) {
            shouldExit = true;
            exitReason = 'stop_loss';
          } else if (currentPrice >= position.takeProfit) {
            shouldExit = true;
            exitReason = 'take_profit';
          }
        } else { // SHORT
          if (currentPrice >= position.stopLoss) {
            shouldExit = true;
            exitReason = 'stop_loss';
          } else if (currentPrice <= position.takeProfit) {
            shouldExit = true;
            exitReason = 'take_profit';
          }
        }

        // Time-based exit (after 2 hours)
        if (holdingTime > 2 * 60 * 60 * 1000) {
          shouldExit = true;
          exitReason = 'time_exit';
        }

        if (shouldExit) {
          await this.exitPosition(asset, position, currentPrice, exitReason);
        }

      } catch (error) {
        logger.warn(`Failed to check position for ${asset}`, { error });
      }
    }
  }

  /**
   * Exit a position
   */
  private async exitPosition(
    asset: string,
    position: any,
    exitPrice: number,
    reason: string
  ): Promise<void> {
    // Calculate P&L
    let pnl: number;
    if (position.direction === 'LONG') {
      pnl = (exitPrice - position.entryPrice) * (position.size / position.entryPrice);
    } else {
      pnl = (position.entryPrice - exitPrice) * (position.size / position.entryPrice);
    }

    const holdingTime = Date.now() - position.entryTime;

    // Update stats
    this.stats.totalProfit += pnl;
    this.stats.totalVolume += position.size;

    if (pnl > 0) {
      this.stats.profitableTrades++;
    }

    this.stats.winRate = (this.stats.profitableTrades / this.stats.executedTrades) * 100;
    this.stats.avgHoldingTime = (this.stats.avgHoldingTime + holdingTime) / 2;

    // Remove position
    this.activePositions.delete(asset);

    logger.info('📉 Momentum Position Closed', {
      asset,
      direction: position.direction,
      entryPrice: position.entryPrice,
      exitPrice,
      pnl: pnl.toFixed(2),
      pnlPercent: ((pnl / position.size) * 100).toFixed(2) + '%',
      holdingTime: `${Math.round(holdingTime / 60000)}min`,
      reason
    });
  }

  /**
   * Get quote for token pair
   */
  private async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: number
  ): Promise<{ outputAmount: number; feeTier: number } | null> {
    const tokenInClass = this.getTokenClass(tokenIn);
    const tokenOutClass = this.getTokenClass(tokenOut);

    try {
      const result = await this.quoteWrapper.quoteExactInput(tokenInClass, tokenOutClass, amountIn.toString());

      return {
        outputAmount: parseFloat(result.amountOut),
        feeTier: result.feeTier
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get real volume data for asset pair from pool information
   */
  private async getAssetVolume(tokenIn: string, tokenOut: string): Promise<number> {
    try {
      // Get pool data to retrieve 24h volume
      const response = await fetch(`${this.baseUrl}/v1/trade/pool?token0=${tokenIn}&token1=${tokenOut}&fee=10000`);

      if (!response.ok) {
        // Try reverse order
        const reverseResponse = await fetch(`${this.baseUrl}/v1/trade/pool?token0=${tokenOut}&token1=${tokenIn}&fee=10000`);

        if (!reverseResponse.ok) {
          logger.warn(`Failed to get pool data for ${tokenIn}/${tokenOut}`, { status: response.status });
          return 1000; // Fallback minimum volume
        }

        const reverseData = await reverseResponse.json() as any;
        if (reverseData.success && reverseData.data) {
          return parseFloat(reverseData.data.volume24h) || 1000;
        }
      } else {
        const data = await response.json() as any;
        if (data.success && data.data) {
          return parseFloat(data.data.volume24h) || 1000;
        }
      }

      return 1000; // Fallback volume
    } catch (error) {
      logger.warn(`Error fetching volume for ${tokenIn}/${tokenOut}`, { error });
      return 1000; // Fallback volume
    }
  }

  /**
   * Get token class from symbol
   */
  private getTokenClass(symbol: string): string {
    const tokenInfo = TRADING_CONSTANTS.FALLBACK_TOKENS.find((t: any) => t.symbol === symbol);
    return tokenInfo ? tokenInfo.tokenClass : `${symbol}|Unit|none|none`;
  }

  /**
   * Get strategy statistics
   */
  getStats(): MomentumStats {
    return { ...this.stats };
  }

  /**
   * Get active positions
   */
  getActivePositions(): Map<string, any> {
    return new Map(this.activePositions);
  }


  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalSignals: 0,
      executedTrades: 0,
      profitableTrades: 0,
      totalProfit: 0,
      avgHoldingTime: 0,
      bestCorrelationBreakdown: 0,
      avgCorrelation: 0,
      totalVolume: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      currentDrawdown: 0
    };

    // Clear active positions (in production, you'd want to handle this more carefully)
    this.activePositions.clear();

    logger.info('Cross-asset momentum statistics reset');
  }
}