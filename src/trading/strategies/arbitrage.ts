/**
 * Arbitrage Strategy
 * Detects and executes arbitrage opportunities across GalaSwap pools
 */

import { GSwap } from '@gala-chain/gswap-sdk';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { safeParseFloat } from '../../utils/safe-parse';

export interface ArbitrageOpportunity {
  tokenA: string;
  tokenB: string;
  poolA: string;
  poolB: string;
  priceA: number;
  priceB: number;
  profitPotential: number;
  amountIn: string;
  expectedAmountOut: string;
}

export class ArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private isActive: boolean = false;
  private lastScanTime: number = 0;
  private executionStats = {
    totalOpportunities: 0,
    executedTrades: 0,
    successfulTrades: 0,
    totalProfit: 0
  };

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
    logger.info('Arbitrage Strategy initialized');
  }

  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Arbitrage Strategy already running');
      return;
    }

    this.isActive = true;
    logger.info('🔄 Starting Arbitrage Strategy...');

    // Start scanning for opportunities
    this.scanForOpportunities();
  }

  async stop(): Promise<void> {
    this.isActive = false;
    logger.info('⏹️ Arbitrage Strategy stopped');
  }

  /**
   * Initialize the strategy
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Arbitrage Strategy...');
    // Strategy-specific initialization if needed
  }

  /**
   * Execute strategy (called by trading engine)
   */
  async execute(): Promise<void> {
    if (!this.isActive) return;
    await this.scanForOpportunities();
  }

  private async scanForOpportunities(): Promise<void> {
    if (!this.isActive) return;

    try {
      const opportunities = await this.findArbitrageOpportunities();

      for (const opportunity of opportunities) {
        if (!this.isActive) break;

        const isValid = await this.validateOpportunity(opportunity);
        if (isValid) {
          await this.executeArbitrage(opportunity);
        }
      }

    } catch (error) {
      logger.error('Error scanning for arbitrage opportunities:', error);
    }

    // Schedule next scan
    if (this.isActive) {
      setTimeout(() => this.scanForOpportunities(), TRADING_CONSTANTS.ARBITRAGE_SCAN_INTERVAL);
    }
  }

  private async findArbitrageOpportunities(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    const tokens = Object.values(TRADING_CONSTANTS.TOKENS);

    try {
      // Check all token pairs for arbitrage opportunities
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const tokenA = tokens[i];
          const tokenB = tokens[j];

          const opportunity = await this.checkArbitrageOpportunity(tokenA, tokenB, 500, 3000);
          if (opportunity) {
            opportunities.push(opportunity);
          }
        }
      }

      this.executionStats.totalOpportunities += opportunities.length;
      return opportunities;

    } catch (error) {
      logger.error('Error finding arbitrage opportunities:', error);
      return [];
    }
  }

  private async checkArbitrageOpportunity(
    tokenA: string,
    tokenB: string,
    feeA: number,
    feeB: number
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const poolA = await this.gswap.pools.getPoolData(tokenA, tokenB, feeA);
      const poolB = await this.gswap.pools.getPoolData(tokenA, tokenB, feeB);

      if (!poolA || !poolB) {
        return null;
      }

      // Simplified price calculation
      const priceA = 1.0;
      const priceB = 1.0;

      const priceDifference = Math.abs(priceA - priceB);
      const profitPotential = (priceDifference / Math.min(priceA, priceB)) * 100;

      if (profitPotential < this.config.minProfitThreshold) {
        return null;
      }

      return {
        tokenA,
        tokenB,
        poolA: `${tokenA}-${tokenB}-${feeA}`,
        poolB: `${tokenA}-${tokenB}-${feeB}`,
        priceA,
        priceB,
        profitPotential,
        amountIn: '1000',
        expectedAmountOut: (1000 * (1 + profitPotential / 100)).toString()
      };

    } catch (error) {
      logger.error('Error checking arbitrage opportunity:', error);
      return null;
    }
  }

  private async validateOpportunity(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      const quote1 = await this.gswap.quoting.quoteExactInput('USDC', opportunity.tokenA, '1000', 500);
      const quote2 = await this.gswap.quoting.quoteExactInput(opportunity.tokenA, 'USDC', quote1.outTokenAmount?.toString() || '1000', 3000);

      if (!quote1 || !quote2) {
        return false;
      }

      const amountOut = safeParseFloat(quote2.outTokenAmount?.toString() || '0', 0);
      const amountIn = 1000;
      const currentProfit = ((amountOut - amountIn) / amountIn) * 100;

      return currentProfit > this.config.minProfitThreshold;
    } catch (error) {
      logger.error('Error validating arbitrage opportunity:', error);
      return false;
    }
  }

  private async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<void> {
    try {
      logger.info(`🎯 Executing arbitrage: ${opportunity.poolA} -> ${opportunity.poolB}`);
      this.executionStats.executedTrades++;

      // Execute buy leg
      const buyResult = await this.swapExecutor.executeSwap({
        tokenIn: 'USDC',
        tokenOut: opportunity.tokenA,
        amountIn: opportunity.amountIn,
        slippageTolerance: 0.005,
        userAddress: 'configured',
        urgency: 'high'
      });

      if (!buyResult.success) {
        logger.error('Arbitrage buy leg failed:', buyResult.error);
        return;
      }

      // Execute sell leg
      const sellResult = await this.swapExecutor.executeSwap({
        tokenIn: opportunity.tokenA,
        tokenOut: 'USDC',
        amountIn: buyResult.amountOut || opportunity.expectedAmountOut,
        slippageTolerance: 0.005,
        userAddress: 'configured',
        urgency: 'high'
      });

      if (sellResult.success) {
        this.executionStats.successfulTrades++;
        const profit = safeParseFloat(sellResult.amountOut || '0', 0) - safeParseFloat(opportunity.amountIn, 0);
        this.executionStats.totalProfit += profit;

        logger.info(`✅ Arbitrage completed: ${profit.toFixed(2)} profit`);
      } else {
        logger.error('Arbitrage sell leg failed:', sellResult.error);
      }

    } catch (error) {
      logger.error('Error executing arbitrage:', error);
    }
  }

  getStatus(): any {
    const successRate = this.executionStats.executedTrades > 0
      ? (this.executionStats.successfulTrades / this.executionStats.executedTrades) * 100
      : 0;

    return {
      isActive: this.isActive,
      opportunities: {
        total: this.executionStats.totalOpportunities,
        executed: this.executionStats.executedTrades,
        successful: this.executionStats.successfulTrades,
        successRate: successRate.toFixed(2) + '%'
      },
      performance: {
        totalProfit: this.executionStats.totalProfit.toFixed(2),
        avgProfitPerTrade: this.executionStats.successfulTrades > 0
          ? (this.executionStats.totalProfit / this.executionStats.successfulTrades).toFixed(2)
          : '0'
      },
      lastScan: new Date().toISOString()
    };
  }
}