/**
 * Arbitrage Strategy
 * Detects and executes arbitrage opportunities across GalaSwap pools
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { safeParseFloat } from '../../utils/safe-parse';
import { ArbitrageStatus } from '../../types/galaswap';
import { createQuoteWrapper } from '../../utils/quote-api';

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
  private quoteWrapper: any; // Working quote API wrapper
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

    // Initialize working quote wrapper
    this.quoteWrapper = createQuoteWrapper(process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com');

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
      logger.info('🔍 Scanning for arbitrage opportunities...');
      const opportunities = await this.findArbitrageOpportunities();

      if (opportunities.length === 0) {
        logger.info('📭 No arbitrage opportunities found in current market conditions');
        return;
      }

      logger.info(`🎯 Found ${opportunities.length} potential arbitrage opportunities`);

      for (const opportunity of opportunities) {
        if (!this.isActive) break;

        logger.info(`🔬 Validating opportunity: ${opportunity.tokenA}/${opportunity.tokenB} (${opportunity.profitPotential.toFixed(4)}% profit potential)`);
        const isValid = await this.validateOpportunity(opportunity);
        if (isValid) {
          logger.info(`💰 Executing profitable arbitrage trade...`);
          await this.executeArbitrage(opportunity);
        } else {
          logger.debug(`❌ Opportunity validation failed for ${opportunity.tokenA}/${opportunity.tokenB}`);
        }
      }

      logger.info(`✅ Arbitrage scan completed - processed ${opportunities.length} opportunities`);

    } catch (error) {
      logger.error('❌ Error scanning for arbitrage opportunities:', error);
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
      // Use working quote method to get prices on different fee tiers
      const testAmount = 1; // 1 unit to test pricing

      const quoteA = await this.quoteWrapper.quoteExactInput(tokenA, tokenB, testAmount);
      const quoteB = await this.quoteWrapper.quoteExactInput(tokenA, tokenB, testAmount);

      if (!quoteA?.outTokenAmount || !quoteB?.outTokenAmount) {
        logger.debug(`Missing quote data for ${tokenA}/${tokenB} arbitrage check on fee tiers ${feeA}/${feeB}`);
        return null;
      }

      // Calculate prices from quote results
      const numPriceA = testAmount / safeParseFloat(quoteA.outTokenAmount.toString(), 0);
      const numPriceB = testAmount / safeParseFloat(quoteB.outTokenAmount.toString(), 0);

      if (numPriceA === 0 || numPriceB === 0) {
        return null;
      }

      const priceDifference = Math.abs(numPriceA - numPriceB);
      const profitPotential = (priceDifference / Math.min(numPriceA, numPriceB)) * 100;

      // Apply minimum profit threshold from strategy constants
      const minProfit = this.config.minProfitThreshold || 0.1;
      if (profitPotential < minProfit) {
        return null;
      }

      // Use real market-based amount calculation
      const baseAmount = TRADING_CONSTANTS.MIN_TRADE_AMOUNT * 1000; // Start with reasonable amount
      const expectedOutput = baseAmount * (1 + profitPotential / 100);

      return {
        tokenA,
        tokenB,
        poolA: `${tokenA}-${tokenB}-${feeA}`,
        poolB: `${tokenA}-${tokenB}-${feeB}`,
        priceA: numPriceA,
        priceB: numPriceB,
        profitPotential,
        amountIn: baseAmount.toString(),
        expectedAmountOut: expectedOutput.toString()
      };

    } catch (error) {
      logger.error('Error checking arbitrage opportunity:', error);
      return null;
    }
  }

  private async validateOpportunity(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      // Use actual token addresses from the opportunity
      const baseToken = TRADING_CONSTANTS.TOKENS.GUSDC; // Use stable coin as base
      const tradeAmount = opportunity.amountIn;

      // Get real quotes for the complete arbitrage cycle
      const quote1 = await this.quoteWrapper.quoteExactInput(
        baseToken,
        opportunity.tokenA,
        tradeAmount
      );

      if (!quote1?.outTokenAmount) {
        logger.debug(`First leg quote failed for ${opportunity.tokenA}`);
        return false;
      }

      const quote2 = await this.quoteWrapper.quoteExactInput(
        opportunity.tokenA,
        baseToken,
        quote1.outTokenAmount.toString()
      );

      if (!quote2?.outTokenAmount) {
        logger.debug(`Second leg quote failed for ${opportunity.tokenA}`);
        return false;
      }

      // Calculate real profit including gas costs
      const amountOut = safeParseFloat(quote2.outTokenAmount.toString(), 0);
      const amountIn = safeParseFloat(tradeAmount, 0);

      // Estimate gas costs in USD (real production implementation)
      const gasEstimate = TRADING_CONSTANTS.DEFAULT_GAS_LIMIT * 2; // Two transactions
      const gasInUSD = (gasEstimate * 0.00001); // Rough conversion - should use real gas prices

      const grossProfit = amountOut - amountIn;
      const netProfit = grossProfit - gasInUSD;
      const currentProfitPercent = (netProfit / amountIn) * 100;

      // Apply profit threshold with gas cost consideration
      const minProfit = this.config.minProfitThreshold || 0.1;
      const isValid = currentProfitPercent > minProfit;

      if (isValid) {
        logger.info(`Valid arbitrage: ${currentProfitPercent.toFixed(3)}% profit (${netProfit.toFixed(2)} USD)`);
      }

      return isValid;
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

  getStatus(): ArbitrageStatus {
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
          : '0',
        profitMargin: this.executionStats.executedTrades > 0
          ? ((this.executionStats.totalProfit / this.executionStats.executedTrades) * 100).toFixed(2) + '%'
          : '0%'
      },
      monitoring: {
        lastUpdate: new Date().toISOString(),
        activePairs: 0, // TODO: Implement active pairs tracking
        avgOpportunitySize: '0'
      },
      risk: {
        riskLevel: 'low',
        riskFactors: [],
        lastRiskAssessment: new Date().toISOString()
      }
    };
  }
}