/**
 * Stablecoin Arbitrage Strategy
 *
 * Low-risk, high-frequency arbitrage strategy for stablecoin pairs:
 * - Focuses on GUSDC ↔ GUSDT price differences
 * - Minimal volatility exposure with consistent small profits
 * - Higher trading frequency with tight spreads
 * - Perfect for risk-averse operation modes
 *
 * Key Features:
 * - Ultra-tight slippage protection (0.1% max)
 * - Rapid execution with minimal market impact
 * - Compound profit tracking with reinvestment
 * - Smart position sizing based on spread width
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig, getConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { createQuoteWrapper } from '../../utils/quote-api';
import { calculateMinOutputAmount, getTokenDecimals } from '../../utils/slippage-calculator';
import { credentialService } from '../../security/credential-service';

export interface StablecoinPair {
  tokenA: string;
  tokenB: string;
  symbol: string; // e.g., "GUSDC/GUSDT"
  decimalsA: number;
  decimalsB: number;
  minSpread: number; // Minimum profitable spread %
  maxPositionSize: number;
  currentSpread: number;
  direction: 'A_TO_B' | 'B_TO_A' | 'NONE';
  lastUpdate: number;
  isActive: boolean;
}

export interface StablecoinOpportunity {
  pair: StablecoinPair;
  direction: 'A_TO_B' | 'B_TO_A';
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  expectedOutput: number;
  minOutput: number;
  spread: number;
  spreadPercent: number;
  estimatedGasCost: number;
  netProfit: number;
  netProfitPercent: number;
  confidence: number; // 0-1, based on spread stability
  executionPriority: number;
  timestamp: number;
  feeTier: number;
}

export interface StablecoinStats {
  totalTrades: number;
  successfulTrades: number;
  totalVolume: number;
  totalProfit: number;
  avgSpread: number;
  avgProfitPerTrade: number;
  bestSpread: number;
  avgExecutionTime: number;
  successRate: number;
  compoundGrowth: number;
  dailyProfit: number;
  hourlyStats: Record<string, { trades: number; profit: number }>;
}

export class StablecoinArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private quoteWrapper: any;
  private isActive: boolean = false;
  private lastScanTime: number = 0;

  // Stablecoin pairs to monitor
  private pairs: Map<string, StablecoinPair> = new Map();

  // Strategy configuration
  private readonly MIN_SPREAD_PERCENT = 0.02; // 0.02% minimum spread
  private readonly MAX_SLIPPAGE_PERCENT = 0.1; // 0.1% max slippage for stablecoins
  private readonly BASE_POSITION_SIZE = 1000; // $1000 base position
  private readonly MAX_POSITION_SIZE = 10000; // $10k max position
  private readonly SCAN_INTERVAL = 5000; // 5 seconds between scans
  private readonly MIN_CONFIDENCE = 0.7; // 70% confidence threshold
  private readonly GAS_COST_THRESHOLD = 0.05; // Max 0.05% of trade for gas

  // Statistics tracking
  private stats: StablecoinStats = {
    totalTrades: 0,
    successfulTrades: 0,
    totalVolume: 0,
    totalProfit: 0,
    avgSpread: 0,
    avgProfitPerTrade: 0,
    bestSpread: 0,
    avgExecutionTime: 0,
    successRate: 0,
    compoundGrowth: 0,
    dailyProfit: 0,
    hourlyStats: {}
  };

  // Running profitability calculation
  private initialCapital: number = 10000; // $10k starting capital
  private currentCapital: number = 10000;
  private dailyStartCapital: number = 10000;
  private lastDailyReset: Date = new Date();

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
    this.quoteWrapper = createQuoteWrapper(fullConfig.api.baseUrl);

    this.initializeStablecoinPairs();

    logger.info('Stablecoin Arbitrage Strategy initialized', {
      pairs: Array.from(this.pairs.keys()),
      minSpread: this.MIN_SPREAD_PERCENT,
      maxSlippage: this.MAX_SLIPPAGE_PERCENT,
      basePositionSize: this.BASE_POSITION_SIZE
    });
  }

  /**
   * Initialize supported stablecoin pairs
   */
  private initializeStablecoinPairs(): void {
    // Primary pair: GUSDC/GUSDT
    this.pairs.set('GUSDC/GUSDT', {
      tokenA: 'GUSDC',
      tokenB: 'GUSDT',
      symbol: 'GUSDC/GUSDT',
      decimalsA: getTokenDecimals('GUSDC'),
      decimalsB: getTokenDecimals('GUSDT'),
      minSpread: this.MIN_SPREAD_PERCENT,
      maxPositionSize: this.MAX_POSITION_SIZE,
      currentSpread: 0,
      direction: 'NONE',
      lastUpdate: 0,
      isActive: true
    });

    // Future pairs can be added here
    // this.pairs.set('GUSDC/GWETH', { ... }); // If treating GWETH as quasi-stable
  }

  /**
   * Start the stablecoin arbitrage strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Stablecoin arbitrage strategy is already active');
      return;
    }

    this.isActive = true;
    logger.info('💵 Starting Stablecoin Arbitrage Strategy');

    // Start continuous monitoring
    this.startContinuousMonitoring();
  }

  /**
   * Stop the stablecoin arbitrage strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    logger.info('🛑 Stablecoin Arbitrage Strategy stopped', {
      stats: this.getStats(),
      finalCapital: this.currentCapital,
      totalReturn: ((this.currentCapital - this.initialCapital) / this.initialCapital * 100).toFixed(2) + '%'
    });
  }

  /**
   * Start continuous monitoring loop
   */
  private startContinuousMonitoring(): void {
    const scan = async () => {
      if (!this.isActive) return;

      try {
        await this.scanForOpportunities();
      } catch (error) {
        logger.error('Error in stablecoin arbitrage scan', { error });
      }

      // Schedule next scan
      if (this.isActive) {
        setTimeout(scan, this.SCAN_INTERVAL);
      }
    };

    scan();
  }

  /**
   * Scan for stablecoin arbitrage opportunities
   */
  async scanForOpportunities(): Promise<StablecoinOpportunity[]> {
    if (!this.isActive) return [];

    const opportunities: StablecoinOpportunity[] = [];

    for (const [pairSymbol, pair] of this.pairs.entries()) {
      if (!pair.isActive) continue;

      try {
        const opportunity = await this.analyzePair(pair);
        if (opportunity && this.isOpportunityProfitable(opportunity)) {
          opportunities.push(opportunity);
        }
      } catch (error) {
        logger.warn(`Failed to analyze pair ${pairSymbol}`, { error });
      }
    }

    // Sort by net profit percentage
    opportunities.sort((a, b) => b.netProfitPercent - a.netProfitPercent);

    // Execute the best opportunity
    if (opportunities.length > 0) {
      const best = opportunities[0];
      await this.executeStablecoinTrade(best);
    }

    this.lastScanTime = Date.now();
    return opportunities;
  }

  /**
   * Analyze a stablecoin pair for arbitrage opportunity
   */
  private async analyzePair(pair: StablecoinPair): Promise<StablecoinOpportunity | null> {
    try {
      // Get quotes in both directions
      const positionSize = this.calculateOptimalPositionSize(pair);

      // Quote A → B
      const quoteAtoB = await this.getQuote(pair.tokenA, pair.tokenB, positionSize);
      if (!quoteAtoB) return null;

      // Quote B → A
      const quoteBtoA = await this.getQuote(pair.tokenB, pair.tokenA, positionSize);
      if (!quoteBtoA) return null;

      // Calculate spreads
      const priceAtoB = quoteAtoB.outputAmount / positionSize;
      const priceBtoA = 1 / (quoteBtoA.outputAmount / positionSize);

      // Determine best direction
      let direction: 'A_TO_B' | 'B_TO_A' | null = null;
      let bestQuote: any = null;
      let spread: number = 0;

      if (priceAtoB > 1 + this.MIN_SPREAD_PERCENT / 100) {
        direction = 'A_TO_B';
        bestQuote = quoteAtoB;
        spread = (priceAtoB - 1) * positionSize;
      } else if (priceBtoA > 1 + this.MIN_SPREAD_PERCENT / 100) {
        direction = 'B_TO_A';
        bestQuote = quoteBtoA;
        spread = (priceBtoA - 1) * positionSize;
      }

      if (!direction || !bestQuote) return null;

      // Calculate slippage protection
      const inputToken = direction === 'A_TO_B' ? pair.tokenA : pair.tokenB;
      const outputToken = direction === 'A_TO_B' ? pair.tokenB : pair.tokenA;
      const inputDecimals = direction === 'A_TO_B' ? pair.decimalsA : pair.decimalsB;

      const minOutput = calculateMinOutputAmount(
        bestQuote.outputAmount,
        this.MAX_SLIPPAGE_PERCENT,
        inputDecimals
      );

      // Estimate gas cost (lower for stablecoins)
      const estimatedGasCost = this.estimateStablecoinGasCost(positionSize, inputToken);

      // Calculate net profit
      const grossProfit = spread;
      const netProfit = grossProfit - estimatedGasCost;
      const netProfitPercent = (netProfit / positionSize) * 100;
      const spreadPercent = (spread / positionSize) * 100;

      // Calculate confidence based on spread stability
      const confidence = this.calculateSpreadConfidence(spreadPercent, pair);

      // Update pair data
      pair.currentSpread = spreadPercent;
      pair.direction = direction;
      pair.lastUpdate = Date.now();

      return {
        pair,
        direction,
        inputToken,
        outputToken,
        inputAmount: positionSize,
        expectedOutput: bestQuote.outputAmount,
        minOutput,
        spread,
        spreadPercent,
        estimatedGasCost,
        netProfit,
        netProfitPercent,
        confidence,
        executionPriority: this.calculateExecutionPriority(netProfitPercent, confidence),
        timestamp: Date.now(),
        feeTier: bestQuote.feeTier
      };

    } catch (error) {
      logger.warn(`Error analyzing pair ${pair.symbol}`, { error });
      return null;
    }
  }

  /**
   * Execute a stablecoin arbitrage trade
   */
  private async executeStablecoinTrade(opportunity: StablecoinOpportunity): Promise<boolean> {
    const startTime = Date.now();
    this.stats.totalTrades++;

    logger.info('💰 Executing Stablecoin Arbitrage', {
      pair: opportunity.pair.symbol,
      direction: opportunity.direction,
      inputAmount: opportunity.inputAmount,
      expectedProfit: opportunity.netProfit,
      spread: opportunity.spreadPercent.toFixed(4) + '%',
      confidence: (opportunity.confidence * 100).toFixed(1) + '%'
    });

    try {
      const result = await this.swapExecutor.executeSwap({
        tokenIn: this.getTokenClass(opportunity.inputToken),
        tokenOut: this.getTokenClass(opportunity.outputToken),
        amountIn: opportunity.inputAmount.toString(),
        userAddress: credentialService.getWalletAddress(),
        slippageTolerance: this.MAX_SLIPPAGE_PERCENT / 100
      });

      if (!result.success) {
        logger.warn('Stablecoin arbitrage trade failed', {
          pair: opportunity.pair.symbol,
          error: result.error
        });
        return false;
      }

      // Calculate actual profit
      const actualOutput = parseFloat(result.amountOut || '0');
      const actualProfit = actualOutput - opportunity.inputAmount;
      const actualProfitPercent = (actualProfit / opportunity.inputAmount) * 100;

      // Update statistics
      this.stats.successfulTrades++;
      this.stats.totalVolume += opportunity.inputAmount;
      this.stats.totalProfit += actualProfit;
      this.stats.avgProfitPerTrade = this.stats.totalProfit / this.stats.successfulTrades;
      this.stats.successRate = (this.stats.successfulTrades / this.stats.totalTrades) * 100;

      if (opportunity.spreadPercent > this.stats.bestSpread) {
        this.stats.bestSpread = opportunity.spreadPercent;
      }

      this.stats.avgSpread = (this.stats.avgSpread + opportunity.spreadPercent) / 2;

      // Update capital tracking
      this.currentCapital += actualProfit;
      this.stats.compoundGrowth = ((this.currentCapital - this.initialCapital) / this.initialCapital) * 100;

      // Update daily profit tracking
      this.updateDailyProfitTracking(actualProfit);

      // Update execution time
      const executionTime = Date.now() - startTime;
      this.stats.avgExecutionTime = (this.stats.avgExecutionTime + executionTime) / 2;

      // Update hourly statistics
      this.updateHourlyStats(actualProfit);

      logger.info('✅ Stablecoin Arbitrage Executed Successfully', {
        pair: opportunity.pair.symbol,
        expectedProfit: opportunity.netProfit.toFixed(6),
        actualProfit: actualProfit.toFixed(6),
        actualProfitPercent: actualProfitPercent.toFixed(4) + '%',
        currentCapital: this.currentCapital.toFixed(2),
        compoundGrowth: this.stats.compoundGrowth.toFixed(2) + '%',
        executionTime: `${executionTime}ms`
      });

      return true;

    } catch (error) {
      logger.error('❌ Stablecoin Arbitrage Execution Failed', {
        pair: opportunity.pair.symbol,
        error,
        executionTime: `${Date.now() - startTime}ms`
      });

      return false;
    }
  }

  /**
   * Get quote for a token pair
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
   * Calculate optimal position size based on spread and available capital
   */
  private calculateOptimalPositionSize(pair: StablecoinPair): number {
    // Base position size
    let positionSize = Math.min(this.BASE_POSITION_SIZE, this.currentCapital * 0.1); // 10% of capital

    // Increase position size for better spreads (up to max)
    if (pair.currentSpread > 0.05) { // > 0.05%
      positionSize *= 1.5;
    } else if (pair.currentSpread > 0.1) { // > 0.1%
      positionSize *= 2.0;
    }

    // Cap at maximum position size
    return Math.min(positionSize, pair.maxPositionSize);
  }

  /**
   * Calculate spread confidence based on historical stability
   */
  private calculateSpreadConfidence(spreadPercent: number, pair: StablecoinPair): number {
    // Simple confidence calculation - can be enhanced with historical data
    let confidence = 0.5; // Base confidence

    // Higher confidence for larger spreads
    if (spreadPercent > 0.05) confidence += 0.2;
    if (spreadPercent > 0.1) confidence += 0.2;

    // Higher confidence for recently updated data
    const timeSinceUpdate = Date.now() - pair.lastUpdate;
    if (timeSinceUpdate < 30000) confidence += 0.1; // < 30 seconds

    return Math.min(1.0, confidence);
  }

  /**
   * Calculate execution priority (1-10)
   */
  private calculateExecutionPriority(netProfitPercent: number, confidence: number): number {
    const profitScore = Math.min(netProfitPercent * 50, 5); // Max 5 points for profit
    const confidenceScore = confidence * 5; // Max 5 points for confidence

    return Math.max(1, Math.min(10, Math.round(profitScore + confidenceScore)));
  }

  /**
   * Check if opportunity meets profitability requirements
   */
  private isOpportunityProfitable(opportunity: StablecoinOpportunity): boolean {
    return (
      opportunity.netProfitPercent >= this.MIN_SPREAD_PERCENT &&
      opportunity.confidence >= this.MIN_CONFIDENCE &&
      opportunity.estimatedGasCost <= (opportunity.inputAmount * this.GAS_COST_THRESHOLD / 100)
    );
  }

  /**
   * Estimate gas cost for stablecoin trades (typically lower)
   */
  private estimateStablecoinGasCost(tradeAmount: number, token: string): number {
    // Stablecoins typically have lower gas costs
    return Math.min(0.25, tradeAmount * 0.0001); // 0.01% or $0.25, whichever is lower
  }

  /**
   * Update daily profit tracking
   */
  private updateDailyProfitTracking(profit: number): void {
    const now = new Date();
    const today = now.toDateString();
    const lastResetDate = this.lastDailyReset.toDateString();

    if (today !== lastResetDate) {
      // New day - reset daily tracking
      this.dailyStartCapital = this.currentCapital - profit;
      this.lastDailyReset = now;
      this.stats.dailyProfit = profit;
    } else {
      // Same day - add to daily profit
      this.stats.dailyProfit += profit;
    }
  }

  /**
   * Update hourly statistics
   */
  private updateHourlyStats(profit: number): void {
    const hour = new Date().getHours().toString().padStart(2, '0');

    if (!this.stats.hourlyStats[hour]) {
      this.stats.hourlyStats[hour] = { trades: 0, profit: 0 };
    }

    this.stats.hourlyStats[hour].trades++;
    this.stats.hourlyStats[hour].profit += profit;
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
  getStats(): StablecoinStats {
    return { ...this.stats };
  }

  /**
   * Get current capital and returns
   */
  getCapitalInfo(): {
    initialCapital: number;
    currentCapital: number;
    totalReturn: number;
    dailyReturn: number;
    compoundGrowthRate: number;
  } {
    const totalReturn = this.currentCapital - this.initialCapital;
    const dailyReturn = this.stats.dailyProfit;
    const compoundGrowthRate = this.stats.compoundGrowth;

    return {
      initialCapital: this.initialCapital,
      currentCapital: this.currentCapital,
      totalReturn,
      dailyReturn,
      compoundGrowthRate
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalTrades: 0,
      successfulTrades: 0,
      totalVolume: 0,
      totalProfit: 0,
      avgSpread: 0,
      avgProfitPerTrade: 0,
      bestSpread: 0,
      avgExecutionTime: 0,
      successRate: 0,
      compoundGrowth: 0,
      dailyProfit: 0,
      hourlyStats: {}
    };

    // Reset capital tracking
    this.currentCapital = this.initialCapital;
    this.dailyStartCapital = this.initialCapital;
    this.lastDailyReset = new Date();

    logger.info('Stablecoin arbitrage statistics reset');
  }
}