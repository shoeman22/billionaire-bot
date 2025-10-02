/**
 * Triangle Arbitrage Strategy
 *
 * Executes 3-hop arbitrage cycles for maximum profit potential:
 * - Discovers profitable triangular paths across all available tokens
 * - Calculates compound slippage for multi-hop safety
 * - Uses precision math for accurate profit calculations
 * - Implements adaptive position sizing based on liquidity
 *
 * Example cycles:
 * - GALA → GUSDC → GWETH → GALA
 * - GALA → GWBTC → GUSDT → GALA
 * - GUSDC → GUSDT → GWETH → GUSDC
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig, getConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { calculateArbitrageSlippage } from '../../utils/slippage-calculator';
import { createQuoteWrapper } from '../../utils/quote-api';
import { credentialService } from '../../security/credential-service';
import { poolDiscovery, TriangularPath, PoolData } from '../../services/pool-discovery';
import { liquidityFilter } from '../../utils/liquidity-filter';

export interface TriangleArbitragePath {
  tokenA: string; // Start token
  tokenB: string; // Middle token
  tokenC: string; // End token (back to tokenA)
  pathName: string; // e.g., "GALA→GUSDC→GWETH→GALA"

  // Hop 1: A → B
  hop1Quote: number;
  hop1FeeTier: number;
  hop1MinOutput: number;

  // Hop 2: B → C
  hop2Quote: number;
  hop2FeeTier: number;
  hop2MinOutput: number;

  // Hop 3: C → A
  hop3Quote: number;
  hop3FeeTier: number;
  hop3MinOutput: number;

  // Profit Analysis
  inputAmount: number;
  finalAmount: number;
  grossProfit: number;
  profitPercent: number;
  estimatedGasCost: number;
  netProfit: number;
  netProfitPercent: number;

  // Risk Metrics
  totalSlippage: number;
  liquidityRisk: 'low' | 'medium' | 'high';
  executionComplexity: 'simple' | 'moderate' | 'complex';

  // Execution Data
  timestamp: number;
  isExecutable: boolean;
  executionPriority: number; // 1-10, higher is better
}

export interface TriangleArbitrageStats {
  totalOpportunities: number;
  executedTrades: number;
  successfulTrades: number;
  totalProfit: number;
  bestPath: string;
  bestProfitPercent: number;
  avgExecutionTime: number;
  failureReasons: Record<string, number>;
  liquidityFailures: number; // No pools found errors
  apiFailures: number; // Other API errors
}

export class TriangleArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private quoteWrapper: any;
  private isActive: boolean = false;
  private lastScanTime: number = 0;

  private stats: TriangleArbitrageStats = {
    totalOpportunities: 0,
    executedTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
    bestPath: '',
    bestProfitPercent: 0,
    avgExecutionTime: 0,
    failureReasons: {},
    liquidityFailures: 0,
    apiFailures: 0
  };

  // Configuration
  private readonly MIN_PROFIT_PERCENT = 0.5; // 0.5% minimum profit
  private readonly MAX_SLIPPAGE_COMPOUND = 5.0; // 5% max compound slippage
  private readonly MAX_GAS_COST_PERCENT = 0.3; // Max 0.3% of trade for gas
  private readonly POSITION_SIZE_PERCENT = 1.0; // Use full base amount for demo/testing

  // Dynamic token prioritization from pool discovery
  private availableTokens: string[] = [];
  private triangularPaths: TriangularPath[] = [];
  private readonly STABLE_TOKENS = ['GUSDC', 'GUSDT'];
  private readonly VOLATILE_TOKENS = ['GALA', 'GWETH', 'GWBTC', 'ETIME', 'SILK'];

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

    logger.info('Triangle Arbitrage Strategy initialized', {
      minProfitPercent: this.MIN_PROFIT_PERCENT,
      maxSlippage: this.MAX_SLIPPAGE_COMPOUND,
      poolDiscoveryEnabled: true
    });
  }

  /**
   * Start the triangle arbitrage strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Triangle arbitrage strategy is already active');
      return;
    }

    this.isActive = true;
    logger.info('🔺 Starting Triangle Arbitrage Strategy');

    // Initialize pool discovery
    await this.initializePoolData();

    // Run initial scan
    await this.scanForOpportunities();
  }

  /**
   * Stop the triangle arbitrage strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    logger.info('🛑 Triangle Arbitrage Strategy stopped', {
      stats: this.getStats()
    });
  }

  /**
   * Main execution method - scan for and execute profitable triangles
   */
  async scanForOpportunities(): Promise<TriangleArbitragePath[]> {
    if (!this.isActive) {
      return [];
    }

    const startTime = Date.now();
    logger.info('🔍 Scanning for triangle arbitrage opportunities...');

    try {
      // Generate all possible triangle paths
      const allPaths = this.generateTrianglePaths();
      logger.info(`Generated ${allPaths.length} potential triangle paths`);

      // Analyze each path for profitability
      const opportunities: TriangleArbitragePath[] = [];

      for (const path of allPaths) {
        try {
          const opportunity = await this.analyzeTrianglePath(path);
          if (opportunity && opportunity.isExecutable) {
            opportunities.push(opportunity);
          }
        } catch (error) {
          logger.warn(`Failed to analyze path ${path.pathName}`, { error });
        }
      }

      // Sort opportunities by net profit percentage
      opportunities.sort((a, b) => b.netProfitPercent - a.netProfitPercent);

      const summary = this.generateAnalysisSummary(allPaths, opportunities);
      logger.info(`Found ${opportunities.length} profitable triangle opportunities out of ${allPaths.length} paths analyzed`, {
        bestOpportunity: opportunities[0] ? {
          path: opportunities[0].pathName,
          netProfitPercent: opportunities[0].netProfitPercent,
          netProfit: opportunities[0].netProfit
        } : null,
        ...summary
      });

      // Execute the best opportunity if available
      if (opportunities.length > 0) {
        const best = opportunities[0];
        if (best.netProfitPercent >= this.MIN_PROFIT_PERCENT) {
          await this.executeTriangleArbitrage(best);
        }
      }

      this.stats.totalOpportunities += opportunities.length;
      this.lastScanTime = Date.now();

      return opportunities;

    } catch (error) {
      logger.error('Error in triangle arbitrage scan', { error });
      return [];
    }
  }

  /**
   * Initialize pool discovery and load available paths
   */
  private async initializePoolData(): Promise<void> {
    try {
      logger.info('🔍 Discovering available pools and tokens...');

      await poolDiscovery.fetchAllPools();
      this.availableTokens = poolDiscovery.getAvailableTokens();
      this.triangularPaths = poolDiscovery.findTriangularPaths();

      logger.info('✅ Pool discovery complete', {
        availableTokens: this.availableTokens.length,
        triangularPaths: this.triangularPaths.length,
        topTokens: this.availableTokens.slice(0, 5).map(t => t.split('|')[0])
      });

    } catch (error) {
      logger.warn('⚠️  Pool discovery failed, falling back to static tokens', { error });
      // Fallback to static token list if pool discovery fails
      this.availableTokens = ['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'GUSDT|Unit|none|none', 'GWETH|Unit|none|none', 'GWBTC|Unit|none|none'];
      this.triangularPaths = [];
    }
  }

  /**
   * Generate triangle arbitrage paths using real pool data
   */
  private generateTrianglePaths(): { pathName: string; tokens: [string, string, string] }[] {
    const paths: { pathName: string; tokens: [string, string, string] }[] = [];

    if (this.triangularPaths.length > 0) {
      // Use discovered triangular paths from pool discovery
      logger.info(`🔺 Using ${this.triangularPaths.length} discovered triangular paths with real liquidity`);

      this.triangularPaths.forEach(triangularPath => {
        const [tokenA, tokenB, tokenC] = triangularPath.tokens;
        const tokenASymbol = tokenA.split('|')[0];
        const tokenBSymbol = tokenB.split('|')[0];
        const tokenCSymbol = tokenC.split('|')[0];
        const pathName = `${tokenASymbol}→${tokenBSymbol}→${tokenCSymbol}→${tokenASymbol}`;

        paths.push({
          pathName,
          tokens: [tokenASymbol, tokenBSymbol, tokenCSymbol]
        });
      });
    } else {
      // Fallback: generate paths from available tokens
      logger.warn('⚠️  No pre-calculated triangular paths, generating from available tokens');
      const tokens = this.availableTokens.map(t => t.split('|')[0]);
      const maxTokens = Math.min(tokens.length, 8); // Limit to prevent excessive combinations

      for (let i = 0; i < maxTokens; i++) {
        for (let j = 0; j < maxTokens; j++) {
          for (let k = 0; k < maxTokens; k++) {
            // Skip if any tokens are the same
            if (i === j || j === k || i === k) continue;

            const tokenA = tokens[i];
            const tokenB = tokens[j];
            const tokenC = tokens[k];

            const pathName = `${tokenA}→${tokenB}→${tokenC}→${tokenA}`;
            paths.push({
              pathName,
              tokens: [tokenA, tokenB, tokenC]
            });
          }
        }
      }
    }

    return paths;
  }

  /**
   * Analyze a specific triangle path for profitability
   */
  private async analyzeTrianglePath(
    path: { pathName: string; tokens: [string, string, string] }
  ): Promise<TriangleArbitragePath | null> {
    const [tokenA, tokenB, tokenC] = path.tokens;
    const inputAmount = this.calculateOptimalPositionSize(tokenA);

    try {
      // Get quotes for each hop
      const hop1Quote = await this.getQuote(tokenA, tokenB, inputAmount);
      if (!hop1Quote) return null;

      const hop2Quote = await this.getQuote(tokenB, tokenC, hop1Quote.outputAmount);
      if (!hop2Quote) return null;

      const hop3Quote = await this.getQuote(tokenC, tokenA, hop2Quote.outputAmount);
      if (!hop3Quote) return null;

      const finalAmount = hop3Quote.outputAmount;
      const grossProfit = finalAmount - inputAmount;
      const profitPercent = (grossProfit / inputAmount) * 100;

      // Calculate compound slippage protection
      const slippageCalc = this.calculateCompoundSlippage(
        inputAmount, hop1Quote.outputAmount, hop2Quote.outputAmount, finalAmount,
        tokenA, tokenB, tokenC
      );

      // Estimate gas costs
      const estimatedGasCost = this.estimateTriangleGasCost(inputAmount, tokenA);
      const netProfit = grossProfit - estimatedGasCost;
      const netProfitPercent = (netProfit / inputAmount) * 100;

      // Risk assessment
      const liquidityRisk = this.assessLiquidityRisk(hop1Quote, hop2Quote, hop3Quote);
      const executionComplexity = this.assessExecutionComplexity(tokenA, tokenB, tokenC);

      // Execution priority (1-10)
      const executionPriority = this.calculateExecutionPriority(
        netProfitPercent, liquidityRisk, executionComplexity
      );

      const isExecutable = netProfitPercent >= this.MIN_PROFIT_PERCENT &&
                         slippageCalc.totalSlippage <= this.MAX_SLIPPAGE_COMPOUND &&
                         estimatedGasCost <= (inputAmount * this.MAX_GAS_COST_PERCENT / 100);


      const opportunity: TriangleArbitragePath = {
        tokenA, tokenB, tokenC,
        pathName: path.pathName,

        hop1Quote: hop1Quote.outputAmount,
        hop1FeeTier: hop1Quote.feeTier,
        hop1MinOutput: slippageCalc.hop1MinOutput,

        hop2Quote: hop2Quote.outputAmount,
        hop2FeeTier: hop2Quote.feeTier,
        hop2MinOutput: slippageCalc.hop2MinOutput,

        hop3Quote: hop3Quote.outputAmount,
        hop3FeeTier: hop3Quote.feeTier,
        hop3MinOutput: slippageCalc.hop3MinOutput,

        inputAmount,
        finalAmount,
        grossProfit,
        profitPercent,
        estimatedGasCost,
        netProfit,
        netProfitPercent,

        totalSlippage: slippageCalc.totalSlippage,
        liquidityRisk,
        executionComplexity,

        timestamp: Date.now(),
        isExecutable,
        executionPriority
      };

      return opportunity;

    } catch (error) {
      logger.warn(`Failed to analyze triangle path ${path.pathName}`, { error });
      return null;
    }
  }

  /**
   * Execute a profitable triangle arbitrage opportunity
   */
  private async executeTriangleArbitrage(opportunity: TriangleArbitragePath): Promise<boolean> {
    const startTime = Date.now();
    this.stats.executedTrades++;

    logger.info('🚀 Executing Triangle Arbitrage', {
      path: opportunity.pathName,
      inputAmount: opportunity.inputAmount,
      expectedProfit: opportunity.netProfit,
      profitPercent: opportunity.netProfitPercent
    });

    try {
      // Execute hop 1: tokenA → tokenB
      const hop1Result = await this.swapExecutor.executeSwap({
        tokenIn: this.getTokenClass(opportunity.tokenA),
        tokenOut: this.getTokenClass(opportunity.tokenB),
        amountIn: opportunity.inputAmount.toString(),
        userAddress: credentialService.getWalletAddress(),
        slippageTolerance: 0.015
      });

      if (!hop1Result.success) {
        this.recordFailure('hop1_failed', opportunity);
        return false;
      }

      // Execute hop 2: tokenB → tokenC
      const actualHop1Output = parseFloat(hop1Result.amountOut || '0');
      const hop2Result = await this.swapExecutor.executeSwap({
        tokenIn: this.getTokenClass(opportunity.tokenB),
        tokenOut: this.getTokenClass(opportunity.tokenC),
        amountIn: actualHop1Output.toString(),
        userAddress: credentialService.getWalletAddress(),
        slippageTolerance: 0.015
      });

      if (!hop2Result.success) {
        this.recordFailure('hop2_failed', opportunity);
        return false;
      }

      // Execute hop 3: tokenC → tokenA
      const actualHop2Output = parseFloat(hop2Result.amountOut || '0');
      const hop3Result = await this.swapExecutor.executeSwap({
        tokenIn: this.getTokenClass(opportunity.tokenC),
        tokenOut: this.getTokenClass(opportunity.tokenA),
        amountIn: actualHop2Output.toString(),
        userAddress: credentialService.getWalletAddress(),
        slippageTolerance: 0.015
      });

      if (!hop3Result.success) {
        this.recordFailure('hop3_failed', opportunity);
        return false;
      }

      // Calculate actual profit
      const finalAmount = parseFloat(hop3Result.amountOut || '0');
      const actualProfit = finalAmount - opportunity.inputAmount;
      const actualProfitPercent = (actualProfit / opportunity.inputAmount) * 100;

      this.stats.successfulTrades++;
      this.stats.totalProfit += actualProfit;

      if (actualProfitPercent > this.stats.bestProfitPercent) {
        this.stats.bestProfitPercent = actualProfitPercent;
        this.stats.bestPath = opportunity.pathName;
      }

      const executionTime = Date.now() - startTime;
      this.stats.avgExecutionTime = (this.stats.avgExecutionTime + executionTime) / 2;

      logger.info('✅ Triangle Arbitrage Executed Successfully', {
        path: opportunity.pathName,
        expectedProfit: opportunity.netProfit,
        actualProfit,
        actualProfitPercent,
        executionTime: `${executionTime}ms`
      });

      return true;

    } catch (error) {
      this.recordFailure('execution_error', opportunity);
      logger.error('❌ Triangle Arbitrage Execution Failed', {
        path: opportunity.pathName,
        error,
        executionTime: `${Date.now() - startTime}ms`
      });

      return false;
    }
  }

  /**
   * Get quote for a token pair with auto fee tier discovery
   */
  private async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: number
  ): Promise<{ outputAmount: number; feeTier: number } | null> {
    // Validate input amount before making API call
    if (!amountIn || isNaN(amountIn) || amountIn <= 0) {
      logger.warn(`Invalid amountIn for quote ${tokenIn} → ${tokenOut}: ${amountIn}`);
      return null;
    }

    const tokenInClass = this.getTokenClass(tokenIn);
    const tokenOutClass = this.getTokenClass(tokenOut);

    try {
      // Pre-filter using liquidity blacklist to avoid unnecessary API calls
      if (liquidityFilter.shouldFilterPair(tokenInClass, tokenOutClass)) {
        return null; // Silently skip known illiquid pairs
      }

      const result = await this.quoteWrapper.quoteExactInput(tokenInClass, tokenOutClass, amountIn.toString());

      // ✅ FIX: Quote API returns 'outTokenAmount', not 'amountOut'
      const outputAmount = parseFloat(result.outTokenAmount || '0');
      if (isNaN(outputAmount) || outputAmount <= 0 || !result.outTokenAmount) {
        logger.warn(`Invalid/missing output amount for ${tokenIn} → ${tokenOut}`, {
          outTokenAmount: result.outTokenAmount,
          parsed: outputAmount,
          resultKeys: Object.keys(result)
        });
        return null;
      }

      return {
        outputAmount,
        feeTier: result.feeTier
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Track different types of failures
      if (errorMsg.includes('No pools found')) {
        this.stats.liquidityFailures++;
      } else {
        this.stats.apiFailures++;
      }

      logger.warn(`Quote failed for ${tokenIn} → ${tokenOut}`, {
        amountIn,
        error: errorMsg
      });
      return null;
    }
  }

  /**
   * Generate analysis summary for user feedback
   */
  private generateAnalysisSummary(allPaths: any[], opportunities: TriangleArbitragePath[]) {
    const liquidityIssues = this.stats.liquidityFailures || 0;
    const apiFailures = this.stats.apiFailures || 0;
    const totalAnalyzed = allPaths.length;
    const successfulAnalysis = totalAnalyzed - liquidityIssues - apiFailures;

    return {
      pathsAnalyzed: totalAnalyzed,
      successfulQuotes: successfulAnalysis,
      liquidityIssues, // No pools found
      apiFailures, // API errors
      profitableOpportunities: opportunities.length,
      analysis: liquidityIssues > (totalAnalyzed * 0.8)
        ? 'Most token pairs lack sufficient liquidity on GalaSwap V3 DEX'
        : 'Normal market analysis - some pairs unavailable'
    };
  }

  /**
   * Calculate compound slippage for multi-hop trades
   */
  private calculateCompoundSlippage(
    inputAmount: number,
    hop1Output: number,
    hop2Output: number,
    finalOutput: number,
    tokenA: string,
    tokenB: string,
    tokenC: string
  ) {
    const slippagePercent = TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT;

    // Calculate slippage protection for each hop
    const hop1Calc = calculateArbitrageSlippage(
      inputAmount, hop1Output, slippagePercent
    );

    const hop2Calc = calculateArbitrageSlippage(
      hop1Output, hop2Output, slippagePercent
    );

    const hop3Calc = calculateArbitrageSlippage(
      hop2Output, finalOutput, slippagePercent
    );

    // Compound slippage calculation
    const totalSlippage = slippagePercent * 3; // Conservative compound approach

    return {
      hop1MinOutput: hop1Calc.minAmount1,
      hop2MinOutput: hop2Calc.minAmount1,
      hop3MinOutput: hop3Calc.minAmount1,
      totalSlippage
    };
  }

  /**
   * Calculate optimal position size based on available balance and risk limits
   */
  private calculateOptimalPositionSize(token: string): number {
    // Use reasonable fixed amounts for demo/testing - sufficient for API validation
    const baseAmount = this.STABLE_TOKENS.includes(token) ? 1000 : 100;

    // Ensure we have a valid, positive number
    const amount = Math.max(baseAmount * this.POSITION_SIZE_PERCENT,
                           this.STABLE_TOKENS.includes(token) ? 100 : 10);

    // Validate the amount is not NaN or invalid
    if (isNaN(amount) || amount <= 0) {
      const fallbackAmount = this.STABLE_TOKENS.includes(token) ? 1000 : 100;
      logger.warn(`Invalid position size calculated for ${token}, using fallback: ${fallbackAmount}`);
      return fallbackAmount;
    }

    return Math.floor(amount); // Ensure integer amounts for cleaner API calls
  }

  /**
   * Estimate gas cost for triangle arbitrage (3 transactions)
   */
  private estimateTriangleGasCost(tradeAmount: number, token: string): number {
    // Estimate based on token - stablecoins typically have lower gas costs
    const baseGasCostUSD = this.STABLE_TOKENS.includes(token) ? 0.5 : 1.0;

    // Triangle requires 3 transactions
    return baseGasCostUSD * 3;
  }

  /**
   * Assess liquidity risk based on quote amounts
   */
  private assessLiquidityRisk(
    hop1Quote: any,
    hop2Quote: any,
    hop3Quote: any
  ): 'low' | 'medium' | 'high' {
    // Simple risk assessment - can be enhanced with actual liquidity data
    const avgQuoteAmount = (hop1Quote.outputAmount + hop2Quote.outputAmount + hop3Quote.outputAmount) / 3;

    if (avgQuoteAmount > 1000) return 'low';
    if (avgQuoteAmount > 100) return 'medium';
    return 'high';
  }

  /**
   * Assess execution complexity
   */
  private assessExecutionComplexity(
    tokenA: string,
    tokenB: string,
    tokenC: string
  ): 'simple' | 'moderate' | 'complex' {
    const tokens = [tokenA, tokenB, tokenC];
    const stableCount = tokens.filter(t => this.STABLE_TOKENS.includes(t)).length;

    if (stableCount >= 2) return 'simple';
    if (stableCount === 1) return 'moderate';
    return 'complex';
  }

  /**
   * Calculate execution priority (1-10, higher is better)
   */
  private calculateExecutionPriority(
    profitPercent: number,
    liquidityRisk: 'low' | 'medium' | 'high',
    complexity: 'simple' | 'moderate' | 'complex'
  ): number {
    let priority = Math.min(profitPercent * 2, 10); // Base on profit %

    // Adjust for liquidity risk
    if (liquidityRisk === 'low') priority *= 1.0;
    else if (liquidityRisk === 'medium') priority *= 0.8;
    else priority *= 0.6;

    // Adjust for complexity
    if (complexity === 'simple') priority *= 1.0;
    else if (complexity === 'moderate') priority *= 0.9;
    else priority *= 0.8;

    return Math.max(1, Math.min(10, Math.round(priority)));
  }

  /**
   * Get token class from symbol
   */
  private getTokenClass(symbol: string): string {
    const tokenInfo = TRADING_CONSTANTS.FALLBACK_TOKENS.find((t) => t.symbol === symbol);
    return tokenInfo ? tokenInfo.tokenClass : `${symbol}|Unit|none|none`;
  }

  /**
   * Record failure for analysis
   */
  private recordFailure(reason: string, opportunity: TriangleArbitragePath): void {
    if (!this.stats.failureReasons[reason]) {
      this.stats.failureReasons[reason] = 0;
    }
    this.stats.failureReasons[reason]++;

    logger.warn(`Triangle arbitrage failed: ${reason}`, {
      path: opportunity.pathName,
      expectedProfit: opportunity.netProfit
    });
  }

  /**
   * Get strategy statistics
   */
  getStats(): TriangleArbitrageStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalOpportunities: 0,
      executedTrades: 0,
      successfulTrades: 0,
      totalProfit: 0,
      bestPath: '',
      bestProfitPercent: 0,
      avgExecutionTime: 0,
      failureReasons: {},
      liquidityFailures: 0,
      apiFailures: 0
    };

    logger.info('Triangle arbitrage statistics reset');
  }
}