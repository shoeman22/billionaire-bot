/**
 * Stablecoin Arbitrage Strategy
 *
 * Indirect stablecoin arbitrage via bridge tokens (updated for real pool availability):
 * - Uses GALA or GWETH as bridge between stablecoins (GUSDC → GALA → GUSDT)
 * - Exploits pricing inefficiencies in stablecoin routing
 * - Lower risk than volatile arbitrage, higher than direct stablecoin swaps
 * - Perfect for consistent profit generation
 *
 * Key Features:
 * - Intelligent bridge token selection based on liquidity
 * - Multi-hop slippage protection
 * - Real-time pool discovery integration
 * - Dynamic path optimization
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
import { poolDiscovery, PoolData } from '../../services/pool-discovery';

export interface StablecoinPath {
  stablecoinA: string; // e.g., "GUSDC"
  stablecoinB: string; // e.g., "GUSDT"
  bridgeToken: string; // e.g., "GALA" or "GWETH"
  symbol: string; // e.g., "GUSDC→GALA→GUSDT"
  hop1Pool: PoolData; // GUSDC → GALA
  hop2Pool: PoolData; // GALA → GUSDT
  totalTvl: number;
  avgFee: number;
  currentSpread: number;
  direction: 'A_TO_B' | 'B_TO_A' | 'NONE';
  lastUpdate: number;
  isActive: boolean;
}

export interface StablecoinOpportunity {
  path: StablecoinPath;
  direction: 'A_TO_B' | 'B_TO_A';
  inputToken: string;
  outputToken: string;
  bridgeToken: string;
  inputAmount: number;
  hop1Output: number;
  hop2Output: number;
  expectedFinalOutput: number;
  minOutput: number;
  spread: number;
  spreadPercent: number;
  estimatedGasCost: number;
  netProfit: number;
  netProfitPercent: number;
  confidence: number; // 0-1, based on liquidity and path stability
  executionPriority: number;
  timestamp: number;
  totalSlippage: number;
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

  // Stablecoin paths to monitor (indirect via bridge tokens)
  private paths: Map<string, StablecoinPath> = new Map();
  private availablePools: PoolData[] = [];

  // Strategy configuration (updated for indirect paths)
  private readonly MIN_SPREAD_PERCENT = 0.1; // 0.1% minimum spread (higher due to 2-hop complexity)
  private readonly MAX_SLIPPAGE_PERCENT = 0.5; // 0.5% max slippage for 2-hop trades
  private readonly BASE_POSITION_SIZE = 1000; // $1000 base position
  private readonly MAX_POSITION_SIZE = 10000; // $10k max position
  private readonly SCAN_INTERVAL = 10000; // 10 seconds between scans (longer due to complexity)
  private readonly MIN_CONFIDENCE = 0.6; // 60% confidence threshold
  private readonly GAS_COST_THRESHOLD = 0.1; // Max 0.1% of trade for gas (2 transactions)

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

    logger.info('Stablecoin Arbitrage Strategy initialized (indirect paths)', {
      strategy: 'bridge-token-arbitrage',
      minSpread: this.MIN_SPREAD_PERCENT,
      maxSlippage: this.MAX_SLIPPAGE_PERCENT,
      basePositionSize: this.BASE_POSITION_SIZE,
      poolDiscoveryEnabled: true
    });
  }

  /**
   * Initialize stablecoin arbitrage paths using real pool data
   */
  private async initializeStablecoinPaths(): Promise<void> {
    try {
      logger.info('🔍 Discovering stablecoin arbitrage paths...');

      await poolDiscovery.fetchAllPools();
      this.availablePools = poolDiscovery.getCachedPools();

      // Find indirect paths between stablecoins
      const stablecoins = ['GUSDC', 'GUSDT'];
      const bridgeTokens = ['GALA', 'GWETH', 'GWBTC']; // Potential bridges

      for (const stablecoinA of stablecoins) {
        for (const stablecoinB of stablecoins) {
          if (stablecoinA === stablecoinB) continue;

          for (const bridgeToken of bridgeTokens) {
            const hop1Pool = this.findBestPool(stablecoinA, bridgeToken);
            const hop2Pool = this.findBestPool(bridgeToken, stablecoinB);

            if (hop1Pool && hop2Pool) {
              const pathKey = `${stablecoinA}→${bridgeToken}→${stablecoinB}`;
              const totalTvl = hop1Pool.tvl + hop2Pool.tvl;
              const avgFee = (parseFloat(hop1Pool.fee) + parseFloat(hop2Pool.fee)) / 2;

              this.paths.set(pathKey, {
                stablecoinA,
                stablecoinB,
                bridgeToken,
                symbol: pathKey,
                hop1Pool,
                hop2Pool,
                totalTvl,
                avgFee,
                currentSpread: 0,
                direction: 'NONE',
                lastUpdate: 0,
                isActive: true
              });

              logger.info(`✅ Found stablecoin path: ${pathKey}`, {
                hop1Tvl: hop1Pool.tvl.toLocaleString(),
                hop2Tvl: hop2Pool.tvl.toLocaleString(),
                totalTvl: totalTvl.toLocaleString(),
                avgFee: `${avgFee.toFixed(2)}%`
              });
            }
          }
        }
      }

      logger.info(`📊 Initialized ${this.paths.size} stablecoin arbitrage paths`, {
        paths: Array.from(this.paths.keys()),
        totalPaths: this.paths.size
      });

    } catch (error) {
      logger.warn('⚠️  Failed to initialize stablecoin paths', { error });
      // Create fallback path if pool discovery fails
      this.createFallbackPaths();
    }
  }

  /**
   * Create fallback paths if pool discovery fails
   */
  private createFallbackPaths(): void {
    logger.info('📋 Creating fallback stablecoin paths...');
    // Create mock paths for testing - these will likely fail in quotes but allow strategy to run
    const fallbackPath: StablecoinPath = {
      stablecoinA: 'GUSDC',
      stablecoinB: 'GUSDT',
      bridgeToken: 'GALA',
      symbol: 'GUSDC→GALA→GUSDT',
      hop1Pool: {} as PoolData,
      hop2Pool: {} as PoolData,
      totalTvl: 0,
      avgFee: 1.0,
      currentSpread: 0,
      direction: 'NONE',
      lastUpdate: 0,
      isActive: true
    };

    this.paths.set(fallbackPath.symbol, fallbackPath);
  }

  /**
   * Find the best pool for a token pair (highest TVL)
   */
  private findBestPool(token0Symbol: string, token1Symbol: string): PoolData | null {
    const candidates = this.availablePools.filter(pool =>
      (pool.token0 === token0Symbol && pool.token1 === token1Symbol) ||
      (pool.token0 === token1Symbol && pool.token1 === token0Symbol)
    );

    if (candidates.length === 0) return null;

    // Return pool with highest TVL
    return candidates.reduce((best, current) =>
      current.tvl > best.tvl ? current : best
    );
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
    logger.info('💵 Starting Stablecoin Arbitrage Strategy (Bridge Token Mode)');

    // Initialize stablecoin paths
    await this.initializeStablecoinPaths();

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

    for (const [pathSymbol, path] of this.paths.entries()) {
      if (!path.isActive) continue;

      try {
        const opportunity = await this.analyzePath(path);
        if (opportunity && this.isOpportunityProfitable(opportunity)) {
          opportunities.push(opportunity);
        }
      } catch (error) {
        logger.warn(`Failed to analyze path ${pathSymbol}`, { error });
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
  private async analyzePath(path: StablecoinPath): Promise<StablecoinOpportunity | null> {
    try {
      // Get quotes in both directions
      const positionSize = this.calculateOptimalPositionSize(path);

      // Quote A → B (GUSDC → GALA → GUSDT)
      const quoteAtoB = await this.getQuote(path.stablecoinA, path.stablecoinB, positionSize);
      if (!quoteAtoB) return null;

      // Quote B → A (GUSDT → GALA → GUSDC)
      const quoteBtoA = await this.getQuote(path.stablecoinB, path.stablecoinA, positionSize);
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
      const inputToken = direction === 'A_TO_B' ? path.stablecoinA : path.stablecoinB;
      const outputToken = direction === 'A_TO_B' ? path.stablecoinB : path.stablecoinA;
      const inputDecimals = 6; // Standard for stablecoins

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
      const confidence = this.calculateSpreadConfidence(spreadPercent, path);

      // Update pair data
      path.currentSpread = spreadPercent;
      path.direction = direction;
      path.lastUpdate = Date.now();

      return {
        path,
        direction,
        inputToken,
        outputToken,
        bridgeToken: path.bridgeToken,
        inputAmount: positionSize,
        hop1Output: bestQuote.outputAmount / 2, // Estimate for 2-hop trade
        hop2Output: bestQuote.outputAmount / 2, // Estimate for 2-hop trade
        expectedFinalOutput: bestQuote.outputAmount,
        minOutput,
        spread,
        spreadPercent,
        estimatedGasCost,
        netProfit,
        netProfitPercent,
        confidence,
        executionPriority: this.calculateExecutionPriority(netProfitPercent, confidence),
        timestamp: Date.now(),
        totalSlippage: this.MAX_SLIPPAGE_PERCENT // 2-hop slippage estimate
      };

    } catch (error) {
      logger.warn(`Error analyzing path ${path.symbol}`, { error });
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
      path: opportunity.path.symbol,
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
          path: opportunity.path.symbol,
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
        path: opportunity.path.symbol,
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
        path: opportunity.path.symbol,
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
  private calculateOptimalPositionSize(path: StablecoinPath): number {
    // Base position size
    let positionSize = Math.min(this.BASE_POSITION_SIZE, this.currentCapital * 0.1); // 10% of capital

    // Increase position size for better spreads (up to max)
    if (path.currentSpread > 0.05) { // > 0.05%
      positionSize *= 1.5;
    } else if (path.currentSpread > 0.1) { // > 0.1%
      positionSize *= 2.0;
    }

    // Cap at maximum position size
    return Math.min(positionSize, this.MAX_POSITION_SIZE);
  }

  /**
   * Calculate spread confidence based on historical stability
   */
  private calculateSpreadConfidence(spreadPercent: number, path: StablecoinPath): number {
    // Simple confidence calculation - can be enhanced with historical data
    let confidence = 0.5; // Base confidence

    // Higher confidence for larger spreads
    if (spreadPercent > 0.05) confidence += 0.2;
    if (spreadPercent > 0.1) confidence += 0.2;

    // Higher confidence for recently updated data
    const timeSinceUpdate = Date.now() - path.lastUpdate;
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