/**
 * Arbitrage Strategy
 * Detects and executes arbitrage opportunities across GalaSwap pools
 */

import { GalaSwapClient } from '../../api/GalaSwapClient';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { isSuccessResponse } from '../../types/galaswap';
import { getPriceFromPoolData } from '../../utils/price-math';
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
  private galaSwapClient: GalaSwapClient;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private isActive: boolean = false;
  private opportunities: ArbitrageOpportunity[] = [];
  private scanTimeoutId: NodeJS.Timeout | null = null;
  private executionStats = {
    totalOpportunities: 0,
    executedTrades: 0,
    successfulTrades: 0,
    totalProfit: 0
  };

  constructor(
    galaSwapClient: GalaSwapClient,
    config: TradingConfig,
    swapExecutor: SwapExecutor,
    marketAnalysis: MarketAnalysis
  ) {
    this.galaSwapClient = galaSwapClient;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.marketAnalysis = marketAnalysis;
    logger.info('Arbitrage Strategy initialized');
  }

  /**
   * Initialize the arbitrage strategy
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Arbitrage Strategy...');

      // Setup price monitoring for arbitrage detection
      await this.setupPriceMonitoring();

      this.isActive = true;
      logger.info('✅ Arbitrage Strategy initialized');

    } catch (error) {
      logger.error('❌ Failed to initialize Arbitrage Strategy:', error);
      throw error;
    }
  }

  /**
   * Stop the arbitrage strategy
   */
  async stop(): Promise<void> {
    this.isActive = false;
    this.opportunities = [];

    // Clean up timeout
    if (this.scanTimeoutId) {
      clearTimeout(this.scanTimeoutId);
      this.scanTimeoutId = null;
    }

    logger.info('Arbitrage Strategy stopped');
  }

  /**
   * Execute arbitrage detection and trading
   */
  async execute(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      // Use the market analysis to find arbitrage opportunities
      const opportunities = await this.marketAnalysis.findArbitrageOpportunities();
      this.executionStats.totalOpportunities += opportunities.length;

      if (opportunities.length === 0) {
        logger.debug('No arbitrage opportunities found');
        return;
      }

      // Filter profitable opportunities based on our criteria
      const profitableOpportunities = opportunities.filter(
        opp => opp.profitPercent > this.config.minProfitThreshold &&
               opp.confidence > 70 &&
               opp.netProfit > 10 // Minimum $10 profit after gas
      );

      if (profitableOpportunities.length > 0) {
        logger.info(`Found ${profitableOpportunities.length} profitable arbitrage opportunities`);

        // Execute the most profitable opportunity
        const bestOpportunity = profitableOpportunities[0];
        await this.executeArbitrage(bestOpportunity);
      } else {
        logger.debug('No profitable arbitrage opportunities after filtering');
      }

    } catch (error) {
      logger.error('Error in arbitrage execution:', error);
    }
  }

  /**
   * Scan for arbitrage opportunities across pools
   */
  private async scanForOpportunities(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    try {
      // Get all available tokens
      const tokens = Object.values(TRADING_CONSTANTS.TOKENS);

      // Compare prices across different pools/fee tiers
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const tokenA = tokens[i];
          const tokenB = tokens[j];

          // Check different fee tiers
          const feeTiers = Object.values(TRADING_CONSTANTS.FEE_TIERS);

          for (let k = 0; k < feeTiers.length; k++) {
            for (let l = k + 1; l < feeTiers.length; l++) {
              const opportunity = await this.checkArbitrageOpportunity(
                tokenA,
                tokenB,
                feeTiers[k],
                feeTiers[l]
              );

              if (opportunity) {
                opportunities.push(opportunity);
              }
            }
          }
        }
      }

    } catch (error) {
      logger.error('Error scanning for opportunities:', error);
    }

    return opportunities.sort((a, b) => b.profitPotential - a.profitPotential);
  }

  /**
   * Check for arbitrage opportunity between two pools
   */
  private async checkArbitrageOpportunity(
    tokenA: string,
    tokenB: string,
    feeA: number,
    feeB: number
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Get pool information
      const poolA = await this.galaSwapClient.getPool(tokenA, tokenB, feeA);
      const poolB = await this.galaSwapClient.getPool(tokenA, tokenB, feeB);

      if (!isSuccessResponse(poolA) || !isSuccessResponse(poolB)) {
        return null;
      }

      // Calculate price difference
      const priceA = getPriceFromPoolData(poolA.data);
      const priceB = getPriceFromPoolData(poolB.data);

      const priceDifference = Math.abs(priceA - priceB);
      const profitPotential = (priceDifference / Math.min(priceA, priceB)) * 100;

      // Check if opportunity is profitable
      if (profitPotential < this.config.minProfitThreshold) {
        return null;
      }

      // Calculate optimal trade amount
      const amountIn = this.calculateOptimalTradeAmount(poolA.data, poolB.data);

      return {
        tokenA,
        tokenB,
        poolA: `${tokenA}-${tokenB}-${feeA}`,
        poolB: `${tokenA}-${tokenB}-${feeB}`,
        priceA,
        priceB,
        profitPotential,
        amountIn,
        expectedAmountOut: '0', // Calculate based on actual quotes
      };

    } catch (error) {
      logger.debug(`Error checking arbitrage for ${tokenA}/${tokenB}:`, error);
      return null;
    }
  }

  /**
   * Execute arbitrage trade
   */
  private async executeArbitrage(opportunity: any): Promise<void> {
    try {
      logger.info(`Executing arbitrage: ${opportunity.tokenPair}`);
      logger.info(`Profit potential: ${opportunity.profitPercent.toFixed(4)}% (${opportunity.netProfit} USD)`);

      this.executionStats.executedTrades++;

      // Parse token pair
      const [tokenIn, tokenOut] = opportunity.tokenPair.split('/');

      // Calculate trade amount based on opportunity volume and our limits
      const maxTradeAmount = Math.min(
        opportunity.volume * 0.1, // Use 10% of available volume
        this.config.maxPositionSize * 0.5 // Use 50% of max position size
      );

      // Execute the first leg: buy at lower price
      const buyResult = await this.swapExecutor.executeSwap({
        tokenIn: 'USDC', // Assuming we start with USDC
        tokenOut: tokenIn,
        amountIn: maxTradeAmount.toString(),
        slippageTolerance: 0.005, // 0.5% slippage for arbitrage
        userAddress: this.galaSwapClient.getWalletAddress(),
        urgency: 'high'
      });

      if (!buyResult.success) {
        logger.error('Arbitrage buy leg failed:', buyResult.error);
        return;
      }

      logger.info(`Arbitrage buy leg completed: ${buyResult.transactionId}`);

      // Wait for confirmation and then execute sell leg
      await this.executeSellLeg(tokenIn, tokenOut, buyResult.amountOut || '0', opportunity);

    } catch (error) {
      logger.error('Error executing arbitrage:', error);
    }
  }


  /**
   * Calculate optimal trade amount for arbitrage
   */
  private calculateOptimalTradeAmount(poolA: any, poolB: any): string {
    try {
      // Get liquidity from both pools
      const liquidityA = safeParseFloat(poolA.liquidity, 0);
      const liquidityB = safeParseFloat(poolB.liquidity, 0);

      // Use the smaller liquidity as the limiting factor
      const availableLiquidity = Math.min(liquidityA, liquidityB);

      // Conservative approach: use 1% of available liquidity to minimize slippage
      const baseAmount = availableLiquidity * 0.01;

      // Apply position size limits from config
      const maxAllowed = this.config.maxPositionSize * 0.3; // Use 30% of max position
      const minTrade = 50; // Minimum $50 trade to be worthwhile

      // Calculate optimal amount considering all constraints
      const optimalAmount = Math.min(baseAmount, maxAllowed);

      return Math.max(optimalAmount, minTrade).toString();

    } catch (error) {
      logger.error('Error calculating optimal trade amount:', error);
      throw new Error(`Failed to calculate trade amount: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Setup price monitoring for arbitrage detection
   */
  private async setupPriceMonitoring(): Promise<void> {
    try {
      // Setup monitoring for major trading pairs
      const monitoredPairs = [
        'GALA/USDC',
        'ETH/USDC',
        'GALA/ETH'
      ];

      logger.info(`Setting up price monitoring for ${monitoredPairs.length} pairs`);

      // Initialize market analysis for arbitrage detection
      // Note: startPriceMonitoring method will be implemented in MarketAnalysis class
      logger.info(`Market analysis initialized for monitoring ${monitoredPairs.length} pairs`);

      // Setup periodic scanning for opportunities
      this.scheduleScan();

      logger.info('✅ Price monitoring initialized for arbitrage detection');

    } catch (error) {
      logger.error('Error setting up price monitoring:', error);
      throw error;
    }
  }

  /**
   * Schedule the next scan for arbitrage opportunities
   */
  private scheduleScan(): void {
    this.scanTimeoutId = setTimeout(async () => {
      if (this.isActive) {
        const opportunities = await this.scanForOpportunities();
        this.opportunities = opportunities.slice(0, 10); // Keep top 10 opportunities
        this.scheduleScan(); // Recursive call
      }
    }, 30000); // Scan every 30 seconds
  }

  /**
   * Execute the sell leg of arbitrage
   */
  private async executeSellLeg(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    opportunity: any
  ): Promise<void> {
    try {
      // Execute the second leg: sell at higher price
      const sellResult = await this.swapExecutor.executeSwap({
        tokenIn,
        tokenOut: 'USDC', // Convert back to USDC
        amountIn,
        slippageTolerance: 0.005, // 0.5% slippage
        userAddress: this.galaSwapClient.getWalletAddress(),
        urgency: 'high'
      });

      if (sellResult.success) {
        this.executionStats.successfulTrades++;

        // Calculate actual profit (simplified)
        const profit = safeParseFloat(sellResult.amountOut, 0) - safeParseFloat(amountIn, 0);
        this.executionStats.totalProfit += profit;

        logger.info(`Arbitrage completed successfully!`, {
          transactionId: sellResult.transactionId,
          estimatedProfit: profit,
          opportunityProfit: opportunity.netProfit
        });
      } else {
        logger.error('Arbitrage sell leg failed:', sellResult.error);
      }

    } catch (error) {
      logger.error('Error in arbitrage sell leg:', error);
    }
  }

  /**
   * Calculate optimal trade amount for arbitrage opportunity
   */
  private calculateOptimalArbitrageAmount(opportunity: any): string {
    // Use Kelly Criterion or similar for optimal position sizing
    const kelly = (opportunity.profitPercent / 100) / 0.1; // Assuming 10% risk
    const kellyAmount = this.config.maxPositionSize * Math.min(kelly, 0.25); // Cap at 25%

    // Use the smaller of Kelly amount or opportunity volume limit
    const optimalAmount = Math.min(
      kellyAmount,
      opportunity.volume * 0.05, // Use 5% of volume to minimize impact
      1000 // Hard cap at $1000 per trade
    );

    return Math.max(optimalAmount, 100).toString(); // Minimum $100 trade
  }

  /**
   * Validate arbitrage opportunity before execution
   */
  private async validateOpportunity(opportunity: any): Promise<boolean> {
    try {
      // Check if the opportunity is still valid
      const [tokenIn, tokenOut] = opportunity.tokenPair.split('/');

      // Get fresh quotes for both pools
      const quote1 = await this.galaSwapClient.getQuote({
        tokenIn: 'USDC',
        tokenOut: tokenIn,
        amountIn: '1000',
        fee: 500 // Standard fee tier
      });

      const quote2 = await this.galaSwapClient.getQuote({
        tokenIn,
        tokenOut: 'USDC',
        amountIn: quote1.data.amountOut,
        fee: 3000 // Different fee tier
      });

      if (!isSuccessResponse(quote1) || !isSuccessResponse(quote2)) {
        return false;
      }

      // Calculate current profit potential
      const amountOut = safeParseFloat(quote2.data.amountOut, 0);
      const amountIn = 1000; // Original amount
      const currentProfit = ((amountOut - amountIn) / amountIn) * 100;

      // Check if still profitable
      return currentProfit > this.config.minProfitThreshold;

    } catch (error) {
      logger.error('Error validating arbitrage opportunity:', error);
      return false;
    }
  }

  /**
   * Get strategy status
   */
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
      lastScan: new Date().toISOString(),
    };
  }
}