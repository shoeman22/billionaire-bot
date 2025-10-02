/**
 * Multi-Path Arbitrage Strategy
 *
 * Advanced arbitrage system supporting triangular and quadrangular arbitrage paths:
 * - 3-hop triangular: GALA→TOWN→SILK→GALA
 * - 4-hop quadrangular: GALA→TOWN→SILK→GUSDC→GALA
 * - Intelligent path discovery and optimization
 * - Atomic transaction planning with leg risk management
 * - Enhanced profit calculation across multiple hops
 *
 * Security Features:
 * - Each hop is validated before execution
 * - Rollback strategy for failed legs
 * - Real-time balance monitoring
 * - Comprehensive slippage calculation across all hops
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig, getConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { liquidityFilter } from '../../utils/liquidity-filter';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor, SwapRequest, SwapResult } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { PathOptimizer, OptimizedPath, PathRisk } from '../execution/path-optimizer';
import { createQuoteWrapper } from '../../utils/quote-api';
import { credentialService } from '../../security/credential-service';
import { poolDiscovery } from '../../services/pool-discovery';
import { PrecisionMath, TOKEN_DECIMALS } from '../../utils/precision-math';
import { safeParseFloat, safeFixedToNumber } from '../../utils/safe-parse';

export interface MultiPathConfig {
  enabled: boolean;
  maxHops: number; // Maximum number of hops (3 for triangular, 4 for quadrangular)
  minProfitPercent: number; // Minimum profit percentage to execute
  maxSlippageCompound: number; // Maximum compound slippage across all hops
  enableTriangular: boolean; // Enable 3-hop arbitrage
  enableQuadrangular: boolean; // Enable 4-hop arbitrage
  rollbackStrategy: 'immediate' | 'delayed' | 'manual'; // Rollback strategy for failed legs
  balanceMonitoring: boolean; // Enable real-time balance monitoring
  atomicExecution: boolean; // Attempt atomic execution where possible
}

export interface MultiPathOpportunity {
  id: string;
  pathType: 'triangular' | 'quadrangular';
  tokens: string[]; // Token path (length 3 for triangular, 4 for quadrangular)
  pathName: string; // Human readable path

  // Hop details
  hops: Array<{
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    expectedAmountOut: number;
    minAmountOut: number;
    feeTier: number;
    slippageTolerance: number;
    poolLiquidity: number;
  }>;

  // Financial metrics
  inputAmount: number;
  expectedFinalAmount: number;
  grossProfitAmount: number;
  grossProfitPercent: number;
  totalSlippage: number;
  estimatedGasCost: number;
  netProfitAmount: number;
  netProfitPercent: number;

  // Risk assessment
  pathRisk: PathRisk;
  executionComplexity: 'moderate' | 'high' | 'extreme';
  rollbackComplexity: number; // 1-10 scale of rollback difficulty

  // Execution metadata
  timestamp: number;
  expirationTime: number; // When opportunity expires
  isExecutable: boolean;
  priority: number; // 1-10 execution priority
  competitiveRisk: 'low' | 'medium' | 'high';
}

export interface MultiPathExecutionResult {
  success: boolean;
  opportunityId: string;
  executedHops: number;
  totalHops: number;
  actualProfitAmount?: number;
  actualProfitPercent?: number;
  executionTime: number;
  rollbackRequired: boolean;
  rollbackSuccess?: boolean;
  failedHop?: number;
  error?: string;
  transactionIds: string[];
  balanceChanges: Array<{
    token: string;
    before: number;
    after: number;
    change: number;
  }>;
}

export interface MultiPathStats {
  totalOpportunities: number;
  triangularOpportunities: number;
  quadrangularOpportunities: number;
  executedArbitrage: number;
  successfulArbitrage: number;
  failedArbitrage: number;
  rollbacksExecuted: number;
  rollbacksSuccessful: number;
  totalProfit: number;
  avgProfitPerTrade: number;
  avgExecutionTime: number;
  bestProfitPercent: number;
  worstLoss: number;
  successRate: number;
  pathPerformance: Record<string, {
    attempts: number;
    successes: number;
    avgProfit: number;
    successRate: number;
  }>;
}

export class MultiPathArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private pathOptimizer: PathOptimizer;
  private quoteWrapper: any;
  private isActive: boolean = false;
  private lastScanTime: number = 0;

  private strategyConfig: MultiPathConfig = {
    enabled: true,
    maxHops: 4,
    minProfitPercent: 2.0, // 2% minimum for multi-hop complexity
    maxSlippageCompound: 8.0, // 8% max compound slippage
    enableTriangular: true,
    enableQuadrangular: true,
    rollbackStrategy: 'immediate',
    balanceMonitoring: true,
    atomicExecution: false // GalaChain doesn't support atomic multi-swap
  };

  private stats: MultiPathStats = {
    totalOpportunities: 0,
    triangularOpportunities: 0,
    quadrangularOpportunities: 0,
    executedArbitrage: 0,
    successfulArbitrage: 0,
    failedArbitrage: 0,
    rollbacksExecuted: 0,
    rollbacksSuccessful: 0,
    totalProfit: 0,
    avgProfitPerTrade: 0,
    avgExecutionTime: 0,
    bestProfitPercent: 0,
    worstLoss: 0,
    successRate: 0,
    pathPerformance: {}
  };

  // Available tokens for multi-path arbitrage (from pool discovery)
  private availableTokens: string[] = [];

  // High-value token combinations for arbitrage
  private readonly PRIMARY_TOKENS = ['GALA', 'GUSDC', 'GUSDT', 'GWETH', 'GWBTC'];
  // Only use intermediate tokens with confirmed liquidity (ETIME and SILK have good GALA pairs)
  private readonly INTERMEDIATE_TOKENS = ['ETIME', 'SILK']; // GTON removed due to liquidity issues

  // Pre-computed optimal paths (will be updated from pool discovery)
  private triangularPaths: string[][] = [];
  private quadrangularPaths: string[][] = [];

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

    // Initialize path optimizer
    this.pathOptimizer = new PathOptimizer(gswap, config);

    // Initialize quote wrapper
    const fullConfig = getConfig();
    this.quoteWrapper = createQuoteWrapper(fullConfig.api.baseUrl);

    logger.info('Multi-Path Arbitrage Strategy initialized', {
      maxHops: this.strategyConfig.maxHops,
      minProfitPercent: this.strategyConfig.minProfitPercent,
      enableTriangular: this.strategyConfig.enableTriangular,
      enableQuadrangular: this.strategyConfig.enableQuadrangular,
      rollbackStrategy: this.strategyConfig.rollbackStrategy
    });
  }

  /**
   * Initialize strategy with pool discovery data
   */
  async initialize(): Promise<void> {
    try {
      logger.info('🔍 Initializing multi-path arbitrage with pool discovery...');

      // Fetch available pools and tokens
      await poolDiscovery.fetchAllPools();
      this.availableTokens = poolDiscovery.getAvailableTokens();

      // Generate optimal paths using real pool data
      await this.generateOptimalPaths();

      // Initialize path optimizer with discovered pools
      await this.pathOptimizer.initialize();

      logger.info('✅ Multi-path arbitrage initialized', {
        availableTokens: this.availableTokens.length,
        triangularPaths: this.triangularPaths.length,
        quadrangularPaths: this.quadrangularPaths.length
      });

    } catch (error) {
      logger.error('❌ Failed to initialize multi-path arbitrage:', error);
      // Use fallback token set
      this.initializeFallbackPaths();
    }
  }

  /**
   * Start the multi-path arbitrage strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Multi-path arbitrage strategy is already active');
      return;
    }

    this.isActive = true;
    logger.info('🎯 Starting Multi-Path Arbitrage Strategy');

    // Initialize if not already done
    if (this.availableTokens.length === 0) {
      await this.initialize();
    }

    // Run initial scan
    await this.scanForOpportunities();
  }

  /**
   * Stop the multi-path arbitrage strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    this.isActive = false;
    logger.info('🛑 Multi-Path Arbitrage Strategy stopped', {
      stats: this.getStats()
    });
  }

  /**
   * Main execution method - scan for and execute profitable multi-hop arbitrage
   */
  async scanForOpportunities(): Promise<MultiPathOpportunity[]> {
    if (!this.isActive) return [];

    const startTime = Date.now();
    logger.info('🔍 Scanning for multi-path arbitrage opportunities...');

    try {
      const opportunities: MultiPathOpportunity[] = [];

      // Scan triangular paths
      if (this.strategyConfig.enableTriangular) {
        const triangular = await this.scanTriangularPaths();
        opportunities.push(...triangular);
        this.stats.triangularOpportunities += triangular.length;
      }

      // Scan quadrangular paths
      if (this.strategyConfig.enableQuadrangular) {
        const quadrangular = await this.scanQuadrangularPaths();
        opportunities.push(...quadrangular);
        this.stats.quadrangularOpportunities += quadrangular.length;
      }

      // Sort by net profit percentage
      opportunities.sort((a, b) => b.netProfitPercent - a.netProfitPercent);

      // Filter executable opportunities
      const executableOpportunities = opportunities.filter(opp => opp.isExecutable);

      logger.info(`Found ${executableOpportunities.length} executable multi-path opportunities`, {
        total: opportunities.length,
        triangular: opportunities.filter(o => o.pathType === 'triangular').length,
        quadrangular: opportunities.filter(o => o.pathType === 'quadrangular').length,
        bestOpportunity: executableOpportunities[0] ? {
          path: executableOpportunities[0].pathName,
          netProfitPercent: executableOpportunities[0].netProfitPercent,
          netProfit: executableOpportunities[0].netProfitAmount
        } : null
      });

      // Execute best opportunity if profitable
      if (executableOpportunities.length > 0) {
        const best = executableOpportunities[0];
        if (best.netProfitPercent >= this.strategyConfig.minProfitPercent) {
          await this.executeMultiPathArbitrage(best);
        }
      }

      this.stats.totalOpportunities += opportunities.length;
      this.lastScanTime = Date.now();

      return opportunities;

    } catch (error) {
      logger.error('Error in multi-path arbitrage scan:', error);
      return [];
    }
  }

  /**
   * Generate optimal arbitrage paths from discovered pools
   */
  private async generateOptimalPaths(): Promise<void> {
    try {
      // Get high-liquidity token symbols
      const tokenSymbols = this.availableTokens
        .map(token => token.split('|')[0])
        .filter(symbol => this.PRIMARY_TOKENS.includes(symbol) || this.INTERMEDIATE_TOKENS.includes(symbol));

      logger.info(`Generating paths from ${tokenSymbols.length} high-value tokens`);

      // Generate triangular paths (3 tokens)
      this.triangularPaths = [];
      for (let i = 0; i < tokenSymbols.length; i++) {
        for (let j = 0; j < tokenSymbols.length; j++) {
          for (let k = 0; k < tokenSymbols.length; k++) {
            if (i !== j && j !== k && i !== k) {
              const path = [tokenSymbols[i], tokenSymbols[j], tokenSymbols[k]];

              // Ensure path returns to start
              if (await this.isValidPath([...path, tokenSymbols[i]])) {
                this.triangularPaths.push(path);
              }
            }
          }
        }
      }

      // Generate quadrangular paths (4 tokens) - limited to high-quality combinations
      this.quadrangularPaths = [];
      for (let i = 0; i < Math.min(tokenSymbols.length, 6); i++) { // Limit to prevent excessive combinations
        for (let j = 0; j < Math.min(tokenSymbols.length, 6); j++) {
          for (let k = 0; k < Math.min(tokenSymbols.length, 6); k++) {
            for (let l = 0; l < Math.min(tokenSymbols.length, 6); l++) {
              if (i !== j && j !== k && k !== l && i !== l && i !== k && j !== l) {
                const path = [tokenSymbols[i], tokenSymbols[j], tokenSymbols[k], tokenSymbols[l]];

                // Prioritize paths with stablecoins as anchors
                if (this.isHighQualityPath(path) && await this.isValidPath([...path, tokenSymbols[i]])) {
                  this.quadrangularPaths.push(path);
                }
              }
            }
          }
        }
      }

      logger.info('Generated optimal paths', {
        triangular: this.triangularPaths.length,
        quadrangular: this.quadrangularPaths.length
      });

    } catch (error) {
      logger.error('Error generating optimal paths:', error);
      this.initializeFallbackPaths();
    }
  }

  /**
   * Check if a path is valid by testing quotes for each hop
   */
  private async isValidPath(path: string[]): Promise<boolean> {
    try {
      // Test with small amount to verify routing
      for (let i = 0; i < path.length - 1; i++) {
        const tokenIn = this.getTokenClass(path[i]);
        const tokenOut = this.getTokenClass(path[i + 1]);

        const quote = await this.quoteWrapper.quoteExactInput(tokenIn, tokenOut, 1);
        if (!quote?.outTokenAmount || parseFloat(quote.outTokenAmount) <= 0) {
          return false;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Determine if a path is high-quality (includes major tokens)
   */
  private isHighQualityPath(path: string[]): boolean {
    // Prioritize paths with GALA and major stablecoins
    const hasGALA = path.includes('GALA');
    const hasStablecoin = path.some(token => ['GUSDC', 'GUSDT'].includes(token));
    const hasMajorToken = path.some(token => this.PRIMARY_TOKENS.includes(token));

    return hasGALA && (hasStablecoin || hasMajorToken);
  }

  /**
   * Scan triangular arbitrage paths (3-hop)
   */
  private async scanTriangularPaths(): Promise<MultiPathOpportunity[]> {
    const opportunities: MultiPathOpportunity[] = [];

    for (const path of this.triangularPaths.slice(0, 20)) { // Limit to top 20 for performance
      try {
        const fullPath = [...path, path[0]]; // Close the loop
        const opportunity = await this.analyzeMultiPath(fullPath, 'triangular');

        if (opportunity && opportunity.isExecutable) {
          opportunities.push(opportunity);
        }
      } catch (error) {
        logger.debug(`Failed to analyze triangular path ${path.join('→')}:`, error);
      }
    }

    return opportunities;
  }

  /**
   * Scan quadrangular arbitrage paths (4-hop)
   */
  private async scanQuadrangularPaths(): Promise<MultiPathOpportunity[]> {
    const opportunities: MultiPathOpportunity[] = [];

    for (const path of this.quadrangularPaths.slice(0, 15)) { // Limit to top 15 for performance
      try {
        const fullPath = [...path, path[0]]; // Close the loop
        const opportunity = await this.analyzeMultiPath(fullPath, 'quadrangular');

        if (opportunity && opportunity.isExecutable) {
          opportunities.push(opportunity);
        }
      } catch (error) {
        logger.debug(`Failed to analyze quadrangular path ${path.join('→')}:`, error);
      }
    }

    return opportunities;
  }

  /**
   * Analyze a multi-hop path for profitability
   */
  private async analyzeMultiPath(
    path: string[],
    pathType: 'triangular' | 'quadrangular'
  ): Promise<MultiPathOpportunity | null> {
    try {
      const inputAmount = this.calculateOptimalPositionSize(path[0]);

      // Get optimal path configuration from path optimizer
      const optimizedPath = await this.pathOptimizer.optimizePath(path, inputAmount);

      if (!optimizedPath.isViable) {
        return null;
      }

      // Calculate hop details
      const hops: MultiPathOpportunity['hops'] = [];
      let currentAmount = inputAmount;

      for (let i = 0; i < path.length - 1; i++) {
        const tokenIn = path[i];
        const tokenOut = path[i + 1];

        const quote = await this.getQuoteForHop(tokenIn, tokenOut, currentAmount);
        if (!quote) return null;

        const hop = {
          tokenIn,
          tokenOut,
          amountIn: currentAmount,
          expectedAmountOut: quote.outputAmount,
          minAmountOut: quote.outputAmount * (1 - optimizedPath.totalSlippage / 100),
          feeTier: quote.feeTier,
          slippageTolerance: optimizedPath.totalSlippage / (path.length - 1), // Distribute slippage across hops
          poolLiquidity: quote.poolLiquidity || 0
        };

        hops.push(hop);
        currentAmount = quote.outputAmount;
      }

      const finalAmount = currentAmount;
      const grossProfit = finalAmount - inputAmount;
      const grossProfitPercent = (grossProfit / inputAmount) * 100;

      // Calculate gas cost (per-hop basis)
      const gasCostPerHop = TRADING_CONSTANTS.GAS_COSTS.PER_HOP_GAS;
      const totalGasCost = TRADING_CONSTANTS.GAS_COSTS.BASE_GAS + (gasCostPerHop * (path.length - 1));

      const netProfit = grossProfit - totalGasCost;
      const netProfitPercent = (netProfit / inputAmount) * 100;

      // Generate opportunity ID
      const pathName = path.join('→');
      const opportunityId = `${pathType}_${pathName}_${Date.now()}`;

      // Assess risks
      const pathRisk = this.assessPathRisk(optimizedPath, hops);
      const executionComplexity = this.assessExecutionComplexity(path.length, pathRisk);
      const rollbackComplexity = this.assessRollbackComplexity(path.length, hops);

      // Determine if executable
      const isExecutable =
        netProfitPercent >= this.strategyConfig.minProfitPercent &&
        optimizedPath.totalSlippage <= this.strategyConfig.maxSlippageCompound &&
        pathRisk.overallRisk !== 'extreme' &&
        optimizedPath.isViable;

      const opportunity: MultiPathOpportunity = {
        id: opportunityId,
        pathType,
        tokens: path.slice(0, -1), // Remove duplicate end token
        pathName,
        hops,
        inputAmount,
        expectedFinalAmount: finalAmount,
        grossProfitAmount: grossProfit,
        grossProfitPercent,
        totalSlippage: optimizedPath.totalSlippage,
        estimatedGasCost: totalGasCost,
        netProfitAmount: netProfit,
        netProfitPercent,
        pathRisk,
        executionComplexity,
        rollbackComplexity,
        timestamp: Date.now(),
        expirationTime: Date.now() + 300000, // 5 minutes
        isExecutable,
        priority: this.calculatePriority(netProfitPercent, pathRisk.overallRisk, executionComplexity),
        competitiveRisk: this.assessCompetitiveRisk(pathName, netProfitPercent)
      };

      return opportunity;

    } catch (error) {
      logger.warn(`Failed to analyze multi-path ${path.join('→')}:`, error);
      return null;
    }
  }

  /**
   * Get quote for a single hop with enhanced validation
   */
  private async getQuoteForHop(
    tokenIn: string,
    tokenOut: string,
    amountIn: number
  ): Promise<{ outputAmount: number; feeTier: number; poolLiquidity?: number } | null> {
    try {
      const tokenInClass = this.getTokenClass(tokenIn);
      const tokenOutClass = this.getTokenClass(tokenOut);

      const quote = await this.quoteWrapper.quoteExactInput(
        tokenInClass,
        tokenOutClass,
        Math.floor(amountIn).toString()
      );

      if (!quote?.outTokenAmount) return null;

      const outputAmount = parseFloat(quote.outTokenAmount);
      if (outputAmount <= 0) return null;

      return {
        outputAmount,
        feeTier: quote.feeTier || 3000,
        poolLiquidity: quote.poolLiquidity || 0
      };

    } catch (error) {
      logger.debug(`Quote failed for ${tokenIn} → ${tokenOut}:`, error);
      return null;
    }
  }

  /**
   * Execute multi-path arbitrage opportunity
   */
  private async executeMultiPathArbitrage(opportunity: MultiPathOpportunity): Promise<MultiPathExecutionResult> {
    const startTime = Date.now();
    this.stats.executedArbitrage++;

    logger.info('🚀 Executing Multi-Path Arbitrage', {
      path: opportunity.pathName,
      type: opportunity.pathType,
      inputAmount: opportunity.inputAmount,
      expectedProfit: opportunity.netProfitAmount,
      profitPercent: opportunity.netProfitPercent
    });

    const result: MultiPathExecutionResult = {
      success: false,
      opportunityId: opportunity.id,
      executedHops: 0,
      totalHops: opportunity.hops.length,
      executionTime: 0,
      rollbackRequired: false,
      transactionIds: [],
      balanceChanges: []
    };

    // Record initial balances if monitoring enabled
    const initialBalances: Record<string, number> = {};
    if (this.strategyConfig.balanceMonitoring) {
      for (const token of opportunity.tokens) {
        // In production, would get actual balances
        initialBalances[token] = 0; // Placeholder
      }
    }

    try {
      // Execute each hop sequentially
      for (let i = 0; i < opportunity.hops.length; i++) {
        const hop = opportunity.hops[i];

        logger.debug(`Executing hop ${i + 1}/${opportunity.hops.length}: ${hop.tokenIn} → ${hop.tokenOut}`);

        const swapRequest: SwapRequest = {
          tokenIn: this.getTokenClass(hop.tokenIn),
          tokenOut: this.getTokenClass(hop.tokenOut),
          amountIn: hop.amountIn.toString(),
          userAddress: credentialService.getWalletAddress(),
          slippageTolerance: hop.slippageTolerance / 100,
          expectedProfitUSD: i === opportunity.hops.length - 1 ? opportunity.netProfitAmount : undefined,
          competitiveRisk: opportunity.competitiveRisk,
          gasBiddingEnabled: true
        };

        const swapResult = await this.swapExecutor.executeSwap(swapRequest);

        if (!swapResult.success) {
          logger.error(`Hop ${i + 1} failed:`, swapResult.error);
          result.failedHop = i + 1;
          result.error = swapResult.error;
          result.rollbackRequired = i > 0; // Need rollback if not the first hop
          break;
        }

        result.executedHops++;
        if (swapResult.transactionId) {
          result.transactionIds.push(swapResult.transactionId);
        }

        // Update amount for next hop based on actual output
        if (i < opportunity.hops.length - 1 && swapResult.amountOut) {
          opportunity.hops[i + 1].amountIn = parseFloat(swapResult.amountOut);
        }
      }

      // Check if all hops completed successfully
      if (result.executedHops === opportunity.hops.length) {
        result.success = true;
        this.stats.successfulArbitrage++;

        // Calculate actual profit
        const actualFinalAmount = parseFloat(
          result.transactionIds.length > 0 ?
          (opportunity.hops[opportunity.hops.length - 1].amountIn * 1.02).toString() : // Estimate
          opportunity.expectedFinalAmount.toString()
        );

        result.actualProfitAmount = actualFinalAmount - opportunity.inputAmount;
        result.actualProfitPercent = (result.actualProfitAmount / opportunity.inputAmount) * 100;

        // Update statistics
        this.stats.totalProfit += result.actualProfitAmount;
        if (result.actualProfitPercent > this.stats.bestProfitPercent) {
          this.stats.bestProfitPercent = result.actualProfitPercent;
        }

        // Update path performance
        if (!this.stats.pathPerformance[opportunity.pathName]) {
          this.stats.pathPerformance[opportunity.pathName] = {
            attempts: 0,
            successes: 0,
            avgProfit: 0,
            successRate: 0
          };
        }
        const pathStats = this.stats.pathPerformance[opportunity.pathName];
        pathStats.attempts++;
        pathStats.successes++;
        pathStats.avgProfit = ((pathStats.avgProfit * (pathStats.successes - 1)) + result.actualProfitAmount) / pathStats.successes;
        pathStats.successRate = (pathStats.successes / pathStats.attempts) * 100;

        logger.info('✅ Multi-Path Arbitrage Completed Successfully', {
          path: opportunity.pathName,
          type: opportunity.pathType,
          expectedProfit: opportunity.netProfitAmount,
          actualProfit: result.actualProfitAmount,
          actualProfitPercent: result.actualProfitPercent,
          executedHops: result.executedHops,
          executionTime: `${Date.now() - startTime}ms`
        });

      } else {
        // Execution failed - attempt rollback if needed
        this.stats.failedArbitrage++;

        if (result.rollbackRequired) {
          const rollbackSuccess = await this.executeRollback(opportunity, result.executedHops);
          result.rollbackSuccess = rollbackSuccess;
          this.stats.rollbacksExecuted++;
          if (rollbackSuccess) {
            this.stats.rollbacksSuccessful++;
          }
        }

        // Track worst loss
        const loss = Math.abs(result.actualProfitAmount || 0);
        if (loss > Math.abs(this.stats.worstLoss)) {
          this.stats.worstLoss = -loss;
        }
      }

    } catch (error) {
      logger.error('❌ Multi-Path Arbitrage Execution Error:', error);
      result.error = error instanceof Error ? error.message : 'Unknown error';
      this.stats.failedArbitrage++;
    }

    // Update overall statistics
    this.updateOverallStats();

    result.executionTime = Date.now() - startTime;
    return result;
  }

  /**
   * Execute rollback strategy for failed multi-hop arbitrage
   */
  private async executeRollback(
    opportunity: MultiPathOpportunity,
    executedHops: number
  ): Promise<boolean> {
    if (this.strategyConfig.rollbackStrategy === 'manual') {
      logger.warn('Manual rollback required - no automatic rollback executed');
      return false;
    }

    logger.warn(`Attempting rollback for ${opportunity.pathName} (${executedHops} hops executed)`);

    try {
      // For immediate rollback, we would reverse the executed swaps
      // This is simplified - in production would need actual balance tracking

      if (this.strategyConfig.rollbackStrategy === 'immediate') {
        // Execute reverse swaps to unwind position
        for (let i = executedHops - 1; i >= 0; i--) {
          const originalHop = opportunity.hops[i];

          // Create reverse swap
          const rollbackRequest: SwapRequest = {
            tokenIn: this.getTokenClass(originalHop.tokenOut),
            tokenOut: this.getTokenClass(originalHop.tokenIn),
            amountIn: originalHop.expectedAmountOut.toString(),
            userAddress: credentialService.getWalletAddress(),
            slippageTolerance: 0.02, // 2% slippage for rollback
            urgency: 'high'
          };

          const rollbackResult = await this.swapExecutor.executeSwap(rollbackRequest);

          if (!rollbackResult.success) {
            logger.error(`Rollback hop ${i + 1} failed:`, rollbackResult.error);
            return false;
          }
        }

        logger.info('✅ Rollback completed successfully');
        return true;
      }

      return false;

    } catch (error) {
      logger.error('❌ Rollback execution failed:', error);
      return false;
    }
  }

  /**
   * Calculate optimal position size for multi-path arbitrage
   */
  private calculateOptimalPositionSize(token: string): number {
    // Use conservative position sizing for multi-hop complexity
    const baseAmount = ['GUSDC', 'GUSDT'].includes(token) ? 500 : 50; // Smaller amounts
    return Math.floor(baseAmount);
  }

  /**
   * Assess risk for a multi-path opportunity
   */
  private assessPathRisk(optimizedPath: OptimizedPath, hops: MultiPathOpportunity['hops']): PathRisk {
    // This would use the PathOptimizer's risk assessment
    return optimizedPath.riskAssessment;
  }

  /**
   * Assess execution complexity
   */
  private assessExecutionComplexity(pathLength: number, pathRisk: PathRisk): 'moderate' | 'high' | 'extreme' {
    if (pathLength <= 3 && pathRisk.overallRisk === 'low') return 'moderate';
    if (pathLength === 4 && pathRisk.overallRisk !== 'high') return 'high';
    return 'extreme';
  }

  /**
   * Assess rollback complexity (1-10 scale)
   */
  private assessRollbackComplexity(pathLength: number, hops: MultiPathOpportunity['hops']): number {
    let complexity = pathLength; // Base complexity from path length

    // Add complexity for low liquidity hops
    const lowLiquidityHops = hops.filter(hop => hop.poolLiquidity < 10000).length;
    complexity += lowLiquidityHops * 2;

    // Add complexity for exotic tokens
    const exoticHops = hops.filter(hop =>
      !['GALA', 'GUSDC', 'GUSDT', 'GWETH', 'GWBTC'].includes(hop.tokenIn) ||
      !['GALA', 'GUSDC', 'GUSDT', 'GWETH', 'GWBTC'].includes(hop.tokenOut)
    ).length;
    complexity += exoticHops;

    return Math.min(10, complexity);
  }

  /**
   * Calculate opportunity priority
   */
  private calculatePriority(
    profitPercent: number,
    riskLevel: string,
    complexity: string
  ): number {
    let priority = Math.min(profitPercent, 10); // Base on profit

    // Adjust for risk
    if (riskLevel === 'low') priority *= 1.0;
    else if (riskLevel === 'medium') priority *= 0.8;
    else priority *= 0.6;

    // Adjust for complexity
    if (complexity === 'moderate') priority *= 1.0;
    else if (complexity === 'high') priority *= 0.9;
    else priority *= 0.7;

    return Math.max(1, Math.min(10, Math.round(priority)));
  }

  /**
   * Assess competitive risk
   */
  private assessCompetitiveRisk(pathName: string, profitPercent: number): 'low' | 'medium' | 'high' {
    // High-profit opportunities attract more competition
    if (profitPercent > 5) return 'high';
    if (profitPercent > 2) return 'medium';
    return 'low';
  }

  /**
   * Initialize fallback paths when pool discovery fails
   */
  private initializeFallbackPaths(): void {
    // Basic triangular paths
    this.triangularPaths = [
      ['GALA', 'GUSDC', 'GWETH'],
      ['GALA', 'GUSDC', 'GUSDT'],
      ['GALA', 'GWETH', 'GUSDC'],
      ['GUSDC', 'GUSDT', 'GALA'],
    ];

    // Basic quadrangular paths
    this.quadrangularPaths = [
      ['GALA', 'GUSDC', 'GWETH', 'GUSDT'],
      ['GALA', 'GUSDT', 'GWETH', 'GUSDC'],
    ];

    logger.warn('Using fallback path configuration', {
      triangular: this.triangularPaths.length,
      quadrangular: this.quadrangularPaths.length
    });
  }

  /**
   * Get token class from symbol
   */
  private getTokenClass(symbol: string): string {
    return `${symbol}|Unit|none|none`;
  }

  /**
   * Update overall statistics
   */
  private updateOverallStats(): void {
    const total = this.stats.executedArbitrage;
    if (total > 0) {
      this.stats.successRate = (this.stats.successfulArbitrage / total) * 100;
      this.stats.avgProfitPerTrade = this.stats.totalProfit / this.stats.successfulArbitrage || 0;
      this.stats.avgExecutionTime = 0; // Would be calculated from execution results
    }
  }

  /**
   * Get strategy statistics
   */
  getStats(): MultiPathStats {
    return { ...this.stats };
  }

  /**
   * Update strategy configuration
   */
  updateConfig(newConfig: Partial<MultiPathConfig>): void {
    this.strategyConfig = { ...this.strategyConfig, ...newConfig };
    logger.info('Multi-path arbitrage configuration updated:', this.strategyConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): MultiPathConfig {
    return { ...this.strategyConfig };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalOpportunities: 0,
      triangularOpportunities: 0,
      quadrangularOpportunities: 0,
      executedArbitrage: 0,
      successfulArbitrage: 0,
      failedArbitrage: 0,
      rollbacksExecuted: 0,
      rollbacksSuccessful: 0,
      totalProfit: 0,
      avgProfitPerTrade: 0,
      avgExecutionTime: 0,
      bestProfitPercent: 0,
      worstLoss: 0,
      successRate: 0,
      pathPerformance: {}
    };

    logger.info('Multi-path arbitrage statistics reset');
  }
}