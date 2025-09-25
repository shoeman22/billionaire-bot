/**
 * Smart Learning Arbitrage Strategy
 *
 * An intelligent arbitrage strategy that learns from market patterns:
 * - Maintains dynamic pair prioritization based on historical success
 * - Adaptive scanning frequency based on profitability
 * - Rate limit intelligence with exponential backoff
 * - Persistent learning data storage
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { TRADING_CONSTANTS } from '../../config/constants';
import { TokenInfo } from '../../types/galaswap';
import { calculateMinOutputAmount } from '../../utils/slippage-calculator';
import { validateEnvironment } from '../../config/environment';
import { createQuoteWrapper } from '../../utils/quote-api';
import { safeParseFloat } from '../../utils/safe-parse';
import { poolDiscovery, PoolData } from '../../services/pool-discovery';

export interface PairMetadata {
  tokenA: string;
  tokenB: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  successCount: number;
  totalAttempts: number;
  lastSuccessTime: number;
  lastAttemptTime: number;
  avgProfitability: number;
  consecutiveErrors: number;
  liquidityLevel: 'high' | 'medium' | 'low' | 'none';
  scanFrequency: number; // seconds between scans
  priority: 'hot' | 'warm' | 'cold' | 'dead';
}

export interface LearningData {
  pairs: Record<string, PairMetadata>;
  globalStats: {
    totalSuccessfulTrades: number;
    totalAttemptedTrades: number;
    totalProfit: number;
    lastUpdateTime: number;
    apiErrorCount: number;
    rateLimitCount: number;
  };
}

export class SmartArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private quoteWrapper: any;
  private learningData: LearningData;
  private learningFilePath: string;
  private isActive: boolean = false;
  private scanTimeouts: Map<string, NodeJS.Timeout> = new Map();

  // Configuration constants
  private readonly MIN_PROFIT_THRESHOLD = 0.1; // 0.1% minimum profit
  private readonly HOT_SCAN_FREQUENCY = 5; // 5 seconds for hot pairs
  private readonly WARM_SCAN_FREQUENCY = 15; // 15 seconds for warm pairs
  private readonly COLD_SCAN_FREQUENCY = 60; // 60 seconds for cold pairs
  private readonly DEAD_PAIR_THRESHOLD = 10; // Mark as dead after 10 consecutive errors
  private readonly RATE_LIMIT_BACKOFF_BASE = 30; // 30 seconds base backoff
  private readonly MAX_BACKOFF_DELAY = 300; // 5 minutes max backoff

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

    // Initialize quote wrapper
    this.quoteWrapper = createQuoteWrapper(
      process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com'
    );

    // Set up learning data file path
    this.learningFilePath = join(process.cwd(), 'data', 'arbitrage-learning.json');

    // Initialize or load learning data
    this.learningData = this.loadLearningData();

    logger.info('Smart Arbitrage Strategy initialized with learning capabilities');
  }

  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Smart Arbitrage Strategy already running');
      return;
    }

    this.isActive = true;
    logger.info('🧠 Starting Smart Learning Arbitrage Strategy...');

    // Initialize pairs if first run
    if (Object.keys(this.learningData.pairs).length === 0) {
      await this.initializePairs();
    }

    // Start adaptive scanning for all pairs
    this.startAdaptiveScanning();

    // Periodic learning data save
    setInterval(() => {
      this.saveLearningData();
    }, 60000); // Save every minute
  }

  async stop(): Promise<void> {
    this.isActive = false;

    // Clear all scan timeouts
    for (const timeout of this.scanTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.scanTimeouts.clear();

    // Save final learning data
    this.saveLearningData();

    logger.info('⏹️ Smart Arbitrage Strategy stopped and learning data saved');
  }

  private async initializePairs(): Promise<void> {
    logger.info('🔢 Initializing token pairs from pool discovery...');

    try {
      // Fetch pool data for intelligent pair initialization
      await poolDiscovery.fetchAllPools();
      const tradingPairs = poolDiscovery.getTradingPairs();
      let pairCount = 0;

      logger.info(`📊 Found ${tradingPairs.length} real trading pairs from pool discovery`);

      // Initialize pairs based on actual pool data
      for (const pair of tradingPairs) {
        const pairKey = this.getPairKey(pair.token0, pair.token1);

        // Determine liquidity level based on pool TVL
        const highestTvlPool = pair.pools.reduce((max, pool) =>
          pool.tvl > max.tvl ? pool : max, pair.pools[0]);

        const liquidityLevel = this.determineLiquidityLevel(highestTvlPool.tvl);

        this.learningData.pairs[pairKey] = {
          tokenA: pair.token0,
          tokenB: pair.token1,
          tokenASymbol: pair.token0.split('|')[0], // Extract symbol from full token class
          tokenBSymbol: pair.token1.split('|')[0],
          successCount: 0,
          totalAttempts: 0,
          lastSuccessTime: 0,
          lastAttemptTime: 0,
          avgProfitability: 0,
          consecutiveErrors: 0,
          liquidityLevel,
          scanFrequency: this.COLD_SCAN_FREQUENCY, // Start as cold
          priority: 'cold'
        };

        pairCount++;
      }

      logger.info(`✅ Initialized ${pairCount} real trading pairs from pool discovery`);

    } catch (error) {
      logger.error('❌ Failed to initialize pairs from pool discovery:', error);
      logger.warn('⚠️  Falling back to hardcoded tokens');

      // Fallback to original hardcoded token initialization
      const tokens = TRADING_CONSTANTS.FALLBACK_TOKENS;
      let pairCount = 0;

      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const tokenA = tokens[i];
          const tokenB = tokens[j];
          const pairKey = this.getPairKey(tokenA.tokenClass, tokenB.tokenClass);

          this.learningData.pairs[pairKey] = {
            tokenA: tokenA.tokenClass,
            tokenB: tokenB.tokenClass,
            tokenASymbol: tokenA.symbol,
            tokenBSymbol: tokenB.symbol,
            successCount: 0,
            totalAttempts: 0,
            lastSuccessTime: 0,
            lastAttemptTime: 0,
            avgProfitability: 0,
            consecutiveErrors: 0,
            liquidityLevel: 'none',
            scanFrequency: this.COLD_SCAN_FREQUENCY,
            priority: 'cold'
          };

          pairCount++;
        }
      }

      logger.info(`📊 Initialized ${pairCount} fallback token pairs`);
    }

    this.saveLearningData();
  }

  /**
   * Determine liquidity level based on pool TVL
   */
  private determineLiquidityLevel(tvl: number): 'high' | 'medium' | 'low' | 'none' {
    if (tvl >= 1000000) return 'high';      // $1M+ TVL
    if (tvl >= 100000) return 'medium';     // $100k+ TVL
    if (tvl >= 10000) return 'low';         // $10k+ TVL
    return 'none';                          // < $10k TVL
  }

  private startAdaptiveScanning(): void {
    logger.info('🔄 Starting adaptive scanning for all pairs...');

    for (const [pairKey, pairData] of Object.entries(this.learningData.pairs)) {
      if (pairData.priority !== 'dead') {
        this.scheduleNextScan(pairKey, 0); // Start immediately
      }
    }
  }

  private scheduleNextScan(pairKey: string, delay: number): void {
    if (!this.isActive) return;

    // Clear existing timeout
    const existingTimeout = this.scanTimeouts.get(pairKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      this.scanPairForArbitrage(pairKey);
    }, delay * 1000);

    this.scanTimeouts.set(pairKey, timeout);
  }

  private async scanPairForArbitrage(pairKey: string): Promise<void> {
    const pairData = this.learningData.pairs[pairKey];
    if (!pairData || !this.isActive) return;

    logger.debug(`🔍 Scanning ${pairData.tokenASymbol}/${pairData.tokenBSymbol} for arbitrage...`);

    try {
      pairData.lastAttemptTime = Date.now();
      pairData.totalAttempts++;

      // Test arbitrage opportunity
      const opportunity = await this.testArbitrageOpportunity(pairData);

      if (opportunity && opportunity.profitPercent > this.MIN_PROFIT_THRESHOLD) {
        logger.info(`💰 Profitable opportunity: ${pairData.tokenASymbol}/${pairData.tokenBSymbol} (${opportunity.profitPercent.toFixed(4)}%)`);

        // Execute the arbitrage
        const success = await this.executeArbitrage(opportunity, pairData);

        if (success) {
          this.updatePairSuccess(pairKey, opportunity.profitPercent);
        } else {
          this.updatePairFailure(pairKey);
        }
      } else {
        // No profitable opportunity found
        this.updatePairNoOpportunity(pairKey);
      }

    } catch (error: any) {
      logger.debug(`❌ Error scanning ${pairData.tokenASymbol}/${pairData.tokenBSymbol}:`, error);

      // Check for rate limiting
      if (this.isRateLimitError(error)) {
        this.handleRateLimit();
        // Don't count as pair failure, it's an API issue
      } else {
        this.updatePairFailure(pairKey);
      }
    }

    // Schedule next scan
    const nextDelay = this.calculateNextScanDelay(pairKey);
    this.scheduleNextScan(pairKey, nextDelay);
  }

  private async testArbitrageOpportunity(pairData: PairMetadata): Promise<{
    profitPercent: number;
    amount: number;
    outputAmount: number;
    returnAmount: number;
    feeTier1: number;
    feeTier2: number;
  } | null> {
    const testAmount = 1; // Test with 1 unit

    try {
      // Get quote A → B
      const quote1 = await this.quoteWrapper.quoteExactInput(
        pairData.tokenA,
        pairData.tokenB,
        testAmount
      );

      if (!quote1?.outTokenAmount) return null;

      const outputAmount = safeParseFloat(quote1.outTokenAmount.toString(), 0);
      if (outputAmount <= 0) return null;

      // Small delay to avoid overwhelming API
      await this.sleep(500);

      // Get return quote B → A
      const quote2 = await this.quoteWrapper.quoteExactInput(
        pairData.tokenB,
        pairData.tokenA,
        outputAmount
      );

      if (!quote2?.outTokenAmount) return null;

      const returnAmount = safeParseFloat(quote2.outTokenAmount.toString(), 0);
      if (returnAmount <= 0) return null;

      // Calculate profit
      const profit = returnAmount - testAmount;
      const profitPercent = (profit / testAmount) * 100;

      return {
        profitPercent,
        amount: testAmount,
        outputAmount,
        returnAmount,
        feeTier1: quote1.feeTier || 3000, // Default to standard fee tier
        feeTier2: quote2.feeTier || 3000  // Default to standard fee tier
      };

    } catch (error) {
      logger.debug(`Quote error for ${pairData.tokenASymbol}/${pairData.tokenBSymbol}:`, error);
      return null;
    }
  }

  private async executeArbitrage(
    opportunity: any,
    pairData: PairMetadata
  ): Promise<boolean> {
    logger.info(`🚀 Executing arbitrage: ${pairData.tokenASymbol} ↔ ${pairData.tokenBSymbol}`);

    try {
      // Execute first trade: tokenA → tokenB
      logger.info(`📈 Step 1: ${pairData.tokenASymbol} → ${pairData.tokenBSymbol}`);
      const tx1 = await this.executeRealTrade(
        pairData.tokenA,
        pairData.tokenB,
        opportunity.amount,
        opportunity.outputAmount,
        opportunity.feeTier1
      );

      if (!tx1) {
        logger.error(`❌ First trade failed for ${pairData.tokenASymbol} → ${pairData.tokenBSymbol}`);
        return false;
      }

      logger.info(`✅ First trade executed: ${tx1}`);

      // Wait for transaction settlement
      logger.info('⏳ Waiting 8 seconds for transaction settlement...');
      await this.sleep(8000);

      // Execute return trade: tokenB → tokenA
      logger.info(`📉 Step 2: ${pairData.tokenBSymbol} → ${pairData.tokenASymbol}`);
      const tx2 = await this.executeRealTrade(
        pairData.tokenB,
        pairData.tokenA,
        opportunity.outputAmount,
        opportunity.returnAmount,
        opportunity.feeTier2
      );

      if (!tx2) {
        logger.error(`❌ Return trade failed for ${pairData.tokenBSymbol} → ${pairData.tokenASymbol}`);
        return false;
      }

      logger.info(`✅ Return trade executed: ${tx2}`);
      logger.info(`🎉 Complete arbitrage cycle successful!`);
      logger.info(`📊 Transactions: ${tx1} | ${tx2}`);
      logger.info(`💰 Expected profit: ${opportunity.profitPercent.toFixed(4)}% on ${pairData.tokenASymbol}`);

      return true;

    } catch (error) {
      logger.error(`❌ Arbitrage execution failed for ${pairData.tokenASymbol}/${pairData.tokenBSymbol}:`, error);
      return false;
    }
  }

  /**
   * Execute a real trade using GalaSwap SDK
   */
  private async executeRealTrade(
    tokenIn: string,
    tokenOut: string,
    inputAmount: number,
    minOutputAmount: number,
    feeTier: number
  ): Promise<string | null> {
    const tokenInSymbol = tokenIn.split('|')[0];
    const tokenOutSymbol = tokenOut.split('|')[0];

    logger.info(`🔄 Executing trade: ${inputAmount} ${tokenInSymbol} → ${tokenOutSymbol}`);

    try {
      // Generate swap payload using GSwap SDK
      const swapPayload = await this.gswap.swaps.swap(
        tokenIn,     // Token to sell
        tokenOut,    // Token to buy
        feeTier,     // Fee tier from quote
        {
          exactIn: inputAmount,
          amountOutMinimum: calculateMinOutputAmount(minOutputAmount), // Centralized slippage protection
        },
        validateEnvironment().wallet.address, // Validated wallet address
      );

      logger.info(`📝 Generated swap payload for ${tokenInSymbol} → ${tokenOutSymbol}`);

      // Handle different payload response formats
      if (swapPayload && typeof swapPayload === 'object') {
        const payload = swapPayload as any;

        // Check if transaction was submitted
        if (payload.transactionId) {
          logger.info(`✅ Transaction submitted: ${payload.transactionId}`);

          // If there's a waitDelegate function, await confirmation
          if (payload.waitDelegate && typeof payload.waitDelegate === 'function') {
            logger.info(`🔄 Waiting for transaction confirmation...`);
            try {
              const result = await payload.waitDelegate();
              logger.info(`✅ Transaction confirmed:`, result);
              return result.hash || payload.transactionId;
            } catch (confirmError: any) {
              logger.error(`❌ Transaction confirmation failed:`, confirmError);

              // Check if transaction was actually executed (common GalaSwap pattern)
              if (confirmError.details?.transactionHash) {
                logger.info(`✅ Transaction was executed: ${confirmError.details.transactionHash}`);
                logger.warn(`⚠️ But confirmation failed with: ${confirmError.details.Message}`);
                return confirmError.details.transactionHash;
              }

              throw confirmError;
            }
          }

          return payload.transactionId;
        }

        // Check for explicit errors
        if (payload.error) {
          logger.error(`❌ Transaction error: ${payload.error}`);
          throw new Error(payload.error);
        }
      }

      logger.warn(`❓ Unknown payload format from ${tokenInSymbol} → ${tokenOutSymbol}`);
      return null;

    } catch (error) {
      logger.error(`❌ Trade execution failed for ${tokenInSymbol} → ${tokenOutSymbol}:`, error);
      throw error;
    }
  }

  private updatePairSuccess(pairKey: string, profitPercent: number): void {
    const pairData = this.learningData.pairs[pairKey];
    pairData.successCount++;
    pairData.lastSuccessTime = Date.now();
    pairData.consecutiveErrors = 0;

    // Update average profitability
    pairData.avgProfitability =
      (pairData.avgProfitability * (pairData.successCount - 1) + profitPercent) / pairData.successCount;

    this.updatePairPriority(pairKey);
    this.learningData.globalStats.totalSuccessfulTrades++;
    this.learningData.globalStats.totalProfit += profitPercent;

    logger.info(`✅ Updated success for ${pairData.tokenASymbol}/${pairData.tokenBSymbol}: ${pairData.successCount} successes`);
  }

  private updatePairFailure(pairKey: string): void {
    const pairData = this.learningData.pairs[pairKey];
    pairData.consecutiveErrors++;
    this.updatePairPriority(pairKey);

    if (pairData.consecutiveErrors >= this.DEAD_PAIR_THRESHOLD) {
      logger.warn(`💀 Marking ${pairData.tokenASymbol}/${pairData.tokenBSymbol} as dead (${pairData.consecutiveErrors} consecutive errors)`);
    }
  }

  private updatePairNoOpportunity(pairKey: string): void {
    // Just update priority, don't count as error
    this.updatePairPriority(pairKey);
  }

  private updatePairPriority(pairKey: string): void {
    const pairData = this.learningData.pairs[pairKey];
    const successRate = pairData.totalAttempts > 0 ?
      pairData.successCount / pairData.totalAttempts : 0;

    // Determine priority and scan frequency
    if (pairData.consecutiveErrors >= this.DEAD_PAIR_THRESHOLD) {
      pairData.priority = 'dead';
      pairData.scanFrequency = 0; // Don't scan dead pairs
    } else if (successRate > 0.1 && pairData.avgProfitability > 0.2) {
      pairData.priority = 'hot';
      pairData.scanFrequency = this.HOT_SCAN_FREQUENCY;
    } else if (successRate > 0.05 || pairData.successCount > 0) {
      pairData.priority = 'warm';
      pairData.scanFrequency = this.WARM_SCAN_FREQUENCY;
    } else {
      pairData.priority = 'cold';
      pairData.scanFrequency = this.COLD_SCAN_FREQUENCY;
    }
  }

  private calculateNextScanDelay(pairKey: string): number {
    const pairData = this.learningData.pairs[pairKey];

    // Base delay from pair's scan frequency
    let delay = pairData.scanFrequency;

    // Apply rate limit backoff if needed
    if (this.learningData.globalStats.rateLimitCount > 0) {
      const backoffMultiplier = Math.min(this.learningData.globalStats.rateLimitCount, 5);
      delay = Math.min(
        delay * Math.pow(2, backoffMultiplier),
        this.MAX_BACKOFF_DELAY
      );
    }

    return delay;
  }

  private isRateLimitError(error: any): boolean {
    const errorMessage = error?.message || String(error);
    const rateLimitIndicators = ['429', 'rate limit', 'too many requests'];

    return rateLimitIndicators.some(indicator =>
      errorMessage.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  private handleRateLimit(): void {
    this.learningData.globalStats.rateLimitCount++;
    this.learningData.globalStats.apiErrorCount++;

    logger.warn(`🚫 Rate limit detected (count: ${this.learningData.globalStats.rateLimitCount})`);

    // Reduce scanning frequency globally for a period
    setTimeout(() => {
      if (this.learningData.globalStats.rateLimitCount > 0) {
        this.learningData.globalStats.rateLimitCount--;
      }
    }, this.RATE_LIMIT_BACKOFF_BASE * 1000);
  }

  private getPairKey(tokenA: string, tokenB: string): string {
    // Ensure consistent ordering
    return tokenA < tokenB ? `${tokenA}:${tokenB}` : `${tokenB}:${tokenA}`;
  }

  private loadLearningData(): LearningData {
    try {
      if (existsSync(this.learningFilePath)) {
        const data = readFileSync(this.learningFilePath, 'utf8');
        const parsed = JSON.parse(data) as LearningData;
        logger.info(`📚 Loaded learning data with ${Object.keys(parsed.pairs).length} pairs`);
        return parsed;
      }
    } catch (error) {
      logger.warn('⚠️ Error loading learning data, starting fresh:', error);
    }

    // Return default learning data
    return {
      pairs: {},
      globalStats: {
        totalSuccessfulTrades: 0,
        totalAttemptedTrades: 0,
        totalProfit: 0,
        lastUpdateTime: Date.now(),
        apiErrorCount: 0,
        rateLimitCount: 0
      }
    };
  }

  private saveLearningData(): void {
    try {
      // Ensure data directory exists
      const dataDir = join(process.cwd(), 'data');
      if (!existsSync(dataDir)) {
        require('fs').mkdirSync(dataDir, { recursive: true });
      }

      this.learningData.globalStats.lastUpdateTime = Date.now();
      writeFileSync(this.learningFilePath, JSON.stringify(this.learningData, null, 2));

      logger.debug('💾 Learning data saved successfully');
    } catch (error) {
      logger.error('❌ Error saving learning data:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public methods for external monitoring
  getLearningStats() {
    const hotPairs = Object.values(this.learningData.pairs).filter(p => p.priority === 'hot').length;
    const warmPairs = Object.values(this.learningData.pairs).filter(p => p.priority === 'warm').length;
    const coldPairs = Object.values(this.learningData.pairs).filter(p => p.priority === 'cold').length;
    const deadPairs = Object.values(this.learningData.pairs).filter(p => p.priority === 'dead').length;

    return {
      ...this.learningData.globalStats,
      pairDistribution: { hotPairs, warmPairs, coldPairs, deadPairs },
      totalPairs: Object.keys(this.learningData.pairs).length
    };
  }

  getTopPerformingPairs(limit: number = 5) {
    return Object.entries(this.learningData.pairs)
      .sort(([,a], [,b]) => b.avgProfitability - a.avgProfitability)
      .slice(0, limit)
      .map(([key, data]) => ({
        pair: `${data.tokenASymbol}/${data.tokenBSymbol}`,
        successRate: data.totalAttempts > 0 ? (data.successCount / data.totalAttempts * 100) : 0,
        avgProfitability: data.avgProfitability,
        priority: data.priority
      }));
  }
}