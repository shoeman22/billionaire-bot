/**
 * Trading Engine
 * Core trading orchestrator for the billionaire bot
 */

import { GSwap, PrivateKeySigner } from '../services/gswap-simple';
import { BotConfig } from '../config/environment';
import { TRADING_CONSTANTS } from '../config/constants';
import { logger } from '../utils/logger';
import { PriceTracker } from '../monitoring/price-tracker';
import { PositionTracker } from '../monitoring/position-tracker';
import { ArbitrageStrategy } from './strategies/arbitrage';
import { RangeOrderStrategy } from '../strategies/range-order-strategy';
import { MarketMakingStrategy } from '../strategies/market-making-strategy';
import { LiquidityManager } from '../services/liquidity-manager';
import { FeeCalculator } from '../services/fee-calculator';
import { RebalanceEngine } from '../services/rebalance-engine';
import { PositionLimits } from './risk/position-limits';
import { SlippageProtection } from './risk/slippage';
import { RiskMonitor } from './risk/risk-monitor';
import { EmergencyControls } from './risk/emergency-controls';
import { SwapExecutor } from './execution/swap-executor';
import { MarketAnalysis } from '../monitoring/market-analysis';
import { AlertSystem } from '../monitoring/alerts';
import { initializeDatabase } from '../config/database';
import { safeParseFloat } from '../utils/safe-parse';
import { BlockchainPosition, PortfolioBalance, MarketCondition, RiskValidationResult, RangeOrder, MarketMakingPosition } from '../types/galaswap';
// Unused imports removed: LiquidityAnalytics, PositionPerformance, RangeOrderStats, MarketMakingStats, FeeAnalysis, RebalanceRecommendation

export class TradingEngine {
  private config: BotConfig;
  protected gswap: GSwap;
  private priceTracker: PriceTracker;
  private arbitrageStrategy: ArbitrageStrategy;
  private positionLimits: PositionLimits;
  private slippageProtection: SlippageProtection;
  private riskMonitor: RiskMonitor;
  private emergencyControls: EmergencyControls;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private alertSystem: AlertSystem;

  // Liquidity Infrastructure
  private liquidityManager: LiquidityManager;
  private positionTracker: PositionTracker;
  private feeCalculator: FeeCalculator;
  private rebalanceEngine: RebalanceEngine;
  private rangeOrderStrategy: RangeOrderStrategy;
  private marketMakingStrategy: MarketMakingStrategy;
  private isRunning: boolean = false;
  private tradingStats = {
    totalTrades: 0,
    successfulTrades: 0,
    totalVolume: 0,
    totalProfit: 0,
    startTime: Date.now(),
    initialBalance: 1000 // Default initial balance, will be updated on first portfolio calculation
  };
  private dailyStartValue: number = 0;
  private lastDailyReset: Date = new Date();
  private tradingIntervalId: NodeJS.Timeout | null = null;

  constructor(config: BotConfig) {
    this.config = config;

    // Validate private key exists in environment
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('WALLET_PRIVATE_KEY environment variable is required');
    }

    // Initialize GSwap SDK - using simple wrapper with baseUrl override
    this.gswap = new GSwap({
      signer: new PrivateKeySigner(privateKey),
      baseUrl: config.api.baseUrl
    });

    // Initialize core systems
    this.priceTracker = new PriceTracker(this.gswap);
    this.positionLimits = new PositionLimits(config.trading, this.gswap);
    this.slippageProtection = new SlippageProtection(config.trading);
    this.riskMonitor = new RiskMonitor(config.trading, this.gswap);

    // Initialize execution systems
    this.swapExecutor = new SwapExecutor(this.gswap, this.slippageProtection);

    // Initialize emergency controls (must be after execution systems)
    this.emergencyControls = new EmergencyControls(
      config.trading,
      this.gswap,
      this.swapExecutor,
      this.config.wallet.address // CRITICAL FIX: Pass actual wallet address
    );

    // Initialize monitoring systems
    this.marketAnalysis = new MarketAnalysis(this.priceTracker, this.gswap);
    this.alertSystem = new AlertSystem();

    // Initialize trading strategies
    this.arbitrageStrategy = new ArbitrageStrategy(
      this.gswap,
      config.trading,
      this.swapExecutor,
      this.marketAnalysis
    );

    // Initialize liquidity infrastructure
    this.liquidityManager = new LiquidityManager(this.gswap, this.config.wallet.address);
    this.positionTracker = new PositionTracker(this.gswap);
    this.feeCalculator = new FeeCalculator();
    this.rebalanceEngine = new RebalanceEngine(this.liquidityManager, this.feeCalculator);
    this.rangeOrderStrategy = new RangeOrderStrategy(this.liquidityManager);
    const mockMarketMakingConfig = {
      token0: 'GALA$Unit$none$none',
      token1: 'GUSDC$Unit$none$none',
      fee: 3000,
      totalCapital: '1000',
      rangeWidth: 0.1,
      spread: 0.002,
      rebalanceThreshold: 0.05,
      autoRebalance: true,
      feeCollectionThreshold: 0.01,
      riskParameters: {
        maxPositionValue: 10000,
        maxDrawdown: 0.2,
        utilizationTarget: 0.8
      }
    };
    this.marketMakingStrategy = new MarketMakingStrategy(this.liquidityManager, mockMarketMakingConfig);

    logger.info('Trading Engine initialized with all components including liquidity infrastructure');
  }

  /**
   * Start the trading engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Trading Engine already running');
      return;
    }

    try {
      logger.info('Starting Trading Engine...');

      // Health check API connection (SDK doesn't have healthCheck, implement basic check)
      try {
        // Test SDK connectivity by attempting to get a basic asset query
        await this.gswap.assets.getUserAssets(this.config.wallet.address, 1, 1);
        logger.info('GSwap SDK connectivity verified');
      } catch (error) {
        throw new Error('GSwap SDK connection failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }

      // Initialize database for position tracking
      await initializeDatabase();

      // Connect WebSocket for real-time data
      await GSwap.events.connectEventSocket();

      // Start price tracking
      await this.priceTracker.start();

      // Start risk monitoring
      await this.riskMonitor.startMonitoring(this.config.wallet.address);

      // Start position tracking
      await this.positionTracker.start();

      // Initialize strategies
      await this.arbitrageStrategy.initialize();
      await this.marketMakingStrategy.initialize();
      await this.rebalanceEngine.initialize();
    
      // Start trading loops
      this.startTradingLoop();

      this.isRunning = true;
      logger.info('✅ Trading Engine started successfully');

    } catch (error) {
      logger.error('❌ Failed to start Trading Engine:', error);
      throw error;
    }
  }

  /**
   * Stop the trading engine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Trading Engine not running');
      return;
    }

    try {
      logger.info('Stopping Trading Engine...');

      // Stop strategies
      await this.arbitrageStrategy.stop();
      await this.marketMakingStrategy.stop();
      await this.rebalanceEngine.stop();
    
      // Stop risk monitoring
      this.riskMonitor.stopMonitoring();

      // Stop position tracking
      await this.positionTracker.stop();

      // Stop price tracking
      await this.priceTracker.stop();

      // Stop alert system
      this.alertSystem.destroy();

      // Clear trading interval
      if (this.tradingIntervalId) {
        clearInterval(this.tradingIntervalId);
        this.tradingIntervalId = null;
      }

      // Disconnect WebSocket
      GSwap.events.disconnectEventSocket();

      this.isRunning = false;
      logger.info('✅ Trading Engine stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping Trading Engine:', error);
      throw error;
    }
  }

  /**
   * Main trading loop
   */
  private startTradingLoop(): void {
    this.tradingIntervalId = setInterval(async () => {
      try {
        if (!this.isRunning) {
          if (this.tradingIntervalId) {
            clearInterval(this.tradingIntervalId);
            this.tradingIntervalId = null;
          }
          return;
        }

        await this.executeTradingCycle();

      } catch (error) {
        logger.error('Error in trading cycle:', error);
      }
    }, 5000); // Run every 5 seconds

    logger.info('Trading loop started');
  }

  /**
   * Convert MarketCondition from MarketAnalysis to GalaSwap types
   */
  private convertMarketCondition(condition: import('../monitoring/market-analysis').MarketCondition): MarketCondition {
    // Convert MarketTrend to the accepted values
    let overall: 'bullish' | 'bearish' | 'neutral';
    switch (condition.overall) {
      case 'bullish':
        overall = 'bullish';
        break;
      case 'bearish':
        overall = 'bearish';
        break;
      case 'sideways':
      case 'unknown':
      default:
        overall = 'neutral';
        break;
    }

    return {
      overall,
      confidence: condition.confidence,
      volatility: condition.volatility,
      liquidity: condition.liquidity,
      trend: condition.overall
    };
  }

  /**
   * Execute a single trading cycle
   */
  private async executeTradingCycle(): Promise<void> {
    logger.debug('Executing trading cycle...');

    try {
      // 1. Check emergency stop
      if (this.emergencyControls.isEmergencyStopEnabled()) {
        logger.warn('Emergency stop active - skipping trading cycle');
        return;
      }

      // 2. Check system health (basic connectivity test)
      try {
        await this.gswap.assets.getUserAssets(this.config.wallet.address, 1, 1);
        this.emergencyControls.recordSuccess();
      } catch (error) {
        this.emergencyControls.recordApiFailure('SDK connectivity check failed');
        logger.warn('GSwap SDK unhealthy, skipping cycle');
        return;
      }

      // 3. Comprehensive risk assessment
      const riskCheck = await this.riskMonitor.performRiskCheck(this.config.wallet.address);

      if (!riskCheck.shouldContinueTrading) {
        logger.warn('Risk assessment failed - stopping trading:', riskCheck.alerts);

        // Check if emergency action is needed
        if (riskCheck.emergencyActions.length > 0) {
          for (const action of riskCheck.emergencyActions) {
            switch (action) {
              case 'STOP_ALL_TRADING':
                await this.emergencyControls.activateEmergencyStop('PORTFOLIO_LOSS', 'Automatic stop due to risk limits');
                break;
              case 'EMERGENCY_LIQUIDATION':
                await this.emergencyControls.activateEmergencyStop('PORTFOLIO_LOSS', 'Automatic liquidation due to critical losses', true);
                break;
              case 'REDUCE_EXPOSURE':
                logger.warn('Reducing exposure due to market conditions');
                // Note: Exposure reduction logic will be implemented in future versions
                break;
            }
          }
        }
        return;
      }

      // 4. Check position limits
      const withinLimits = await this.positionLimits.checkLimits(this.config.wallet.address);
      if (!withinLimits) {
        logger.warn('Position limits exceeded, skipping cycle');
        await this.alertSystem.riskAlert('position_limits_exceeded', {
          wallet: this.config.wallet.address,
          limits: this.positionLimits.getCurrentLimits()
        });
        return;
      }

      // 5. Update market analysis
      const rawMarketCondition = await this.marketAnalysis.analyzeMarket();
      const marketCondition = this.convertMarketCondition(rawMarketCondition);

      // 6. Check for critical market conditions and emergency triggers
      const portfolioSnapshot = await this.getPortfolioSnapshot();
      const emergencyCheck = await this.emergencyControls.checkEmergencyConditions({
        totalValue: portfolioSnapshot.totalValue,
        dailyPnL: portfolioSnapshot.dailyPnL,
        totalPnL: portfolioSnapshot.totalPnL,
        baselineValue: portfolioSnapshot.baselineValue,
        dailyStartValue: portfolioSnapshot.dailyStartValue,
        maxConcentration: portfolioSnapshot.maxConcentration,
        volatility: marketCondition.volatility === 'extreme' ? 0.6 : 0.1
      });

      if (emergencyCheck.shouldTrigger && emergencyCheck.emergencyType && emergencyCheck.reason) {
        logger.error('Emergency conditions detected:', emergencyCheck);
        await this.emergencyControls.activateEmergencyStop(
          emergencyCheck.emergencyType,
          emergencyCheck.reason,
          emergencyCheck.severity === 'critical'
        );
        return;
      }

      // 7. Check for extreme market volatility
      if (marketCondition.volatility === 'extreme') {
        logger.warn('Extreme market volatility detected, reducing activity');
        await this.alertSystem.createAlert(
          'system_error',
          'warning',
          'Extreme Volatility',
          'Trading activity reduced due to extreme market volatility',
          { volatility: marketCondition.volatility }
        );
        return;
      }

      // 8. Check if market conditions are favorable for trading
      const isFavorable = this.marketAnalysis.isFavorableForTrading();
      if (!isFavorable) {
        logger.debug('Market conditions not favorable for trading');
        return;
      }

      // 9. Check and execute liquidity position management
      await this.executeLiquidityManagement(marketCondition, riskCheck.riskLevel);

      // 10. Execute strategies based on market conditions and risk level
      const riskAdjustedExecution = this.shouldExecuteStrategies(marketCondition, riskCheck.riskLevel);

      if (riskAdjustedExecution.shouldExecute) {
        if (marketCondition.overall === 'bullish' && marketCondition.confidence > 70 && riskCheck.riskLevel !== 'high') {
          // Strong bullish trend - favor arbitrage (only if not high risk)
          await this.arbitrageStrategy.execute();

          // Also consider market making in stable conditions
          if (marketCondition.volatility === 'low' || marketCondition.volatility === 'medium') {
            await this.marketMakingStrategy.execute();
          }
        } else if (marketCondition.volatility === 'low' && marketCondition.liquidity === 'good' && riskCheck.riskLevel === 'low') {
          // Low volatility, good liquidity, low risk - ideal for concentrated liquidity strategies
          await this.marketMakingStrategy.execute();
          await this.arbitrageStrategy.execute();
        } else if (marketCondition.confidence > 50 && riskCheck.riskLevel === 'low') {
          // Balanced conditions, low risk - execute based on volatility
          if (marketCondition.volatility === 'low') {
            await this.marketMakingStrategy.execute();
          }
          await this.arbitrageStrategy.execute();
        } else {
          logger.debug('Conditions not suitable for strategy execution', {
            marketCondition: marketCondition.overall,
            confidence: marketCondition.confidence,
            riskLevel: riskCheck.riskLevel
          });
        }
      } else {
        logger.debug('Strategy execution skipped:', riskAdjustedExecution.reason);
      }

      // 11. Update statistics
      this.updateTradingStats();

      logger.debug('Trading cycle completed successfully');

    } catch (error) {
      logger.error('Error in trading cycle:', error);
      this.emergencyControls.recordSystemError(error);
      await this.alertSystem.systemAlert('trading_engine', error);
    }
  }

  /**
   * Execute liquidity position management
   */
  private async executeLiquidityManagement(
    marketCondition: MarketCondition,
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<void> {
    try {
      // Update range order statuses
      await this.rangeOrderStrategy.updateOrderStatuses();

      // Check for rebalancing signals
      if (riskLevel === 'low' || riskLevel === 'medium') {
        const rebalanceSignals = await this.rebalanceEngine.checkRebalanceSignals();

        if (rebalanceSignals.length > 0) {
          logger.info(`Processing ${rebalanceSignals.length} rebalance signals`);

          for (const signal of rebalanceSignals) {
            if (signal.urgency === 'high' || (signal.urgency === 'medium' && riskLevel === 'low')) {
              await this.rebalanceEngine.executeRebalance();
            }
          }
        }
      }

      // Clean up old range orders
      this.rangeOrderStrategy.cleanup();

      // Collect fees if conditions are favorable
      if (marketCondition.volatility !== 'extreme' && riskLevel !== 'high') {
        await this.collectOptimalFees();
      }

    } catch (error) {
      logger.error('Error in liquidity management:', error);
    }
  }

  /**
   * Collect fees when conditions are optimal
   */
  private async collectOptimalFees(): Promise<void> {
    try {
      const positions = await this.liquidityManager.getAllPositions();

      for (const position of positions) {
        const optimization = await this.feeCalculator.generateCollectionOptimization(position.id);

        if (optimization && optimization.recommendation === 'collect_now') {
          logger.info(`Collecting fees for position ${position.id} - Cost/Benefit: ${optimization.costBenefitRatio}`);

          await this.liquidityManager.collectFees({
            positionId: position.id
          });
        }
      }
    } catch (error) {
      logger.error('Error collecting optimal fees:', error);
    }
  }

  /**
   * Determine if strategies should execute based on risk level
   */
  private shouldExecuteStrategies(
    marketCondition: MarketCondition,
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ): { shouldExecute: boolean; reason?: string } {
    switch (riskLevel) {
      case 'critical':
        return { shouldExecute: false, reason: 'Critical risk level - all trading halted' };
      case 'high':
        return { shouldExecute: false, reason: 'High risk level - trading suspended' };
      case 'medium':
        if (marketCondition.confidence < 70) {
          return { shouldExecute: false, reason: 'Medium risk with low market confidence' };
        }
        return { shouldExecute: true };
      case 'low':
        return { shouldExecute: true };
      default:
        return { shouldExecute: false, reason: 'Unknown risk level' };
    }
  }

  /**
   * Execute a manual trade with comprehensive risk validation
   */
  async executeManualTrade(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageTolerance?: number;
    bypassRiskCheck?: boolean;
  }): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
    riskValidation?: RiskValidationResult;
    adjustedAmount?: string;
  }> {
    try {
      logger.info('Executing manual trade with risk validation', params);

      // 1. Check emergency stop
      if (this.emergencyControls.isEmergencyStopEnabled()) {
        return {
          success: false,
          error: 'Emergency stop is active - manual trading disabled'
        };
      }

      // 2. Risk validation (unless bypassed)
      if (!params.bypassRiskCheck) {
        // Get current portfolio snapshot for validation
        const currentPortfolio = this.riskMonitor.getRiskStatus().latestSnapshot;

        if (currentPortfolio) {
          const riskValidation = await this.riskMonitor.validateTrade({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: safeParseFloat(params.amountIn, 0),
            currentPortfolio,
            marketConditions: {
              volatility: 0,
              liquidity: 0,
              priceStability: 0
            } // Note: Real-time market conditions will be implemented in future versions
          });

          if (!riskValidation.approved) {
            return {
              success: false,
              error: riskValidation.reason,
              riskValidation
            };
          }

          // Apply risk-adjusted amount if suggested
          if (riskValidation.adjustedAmount) {
            params.amountIn = riskValidation.adjustedAmount.toString();
            logger.info(`Trade amount adjusted for risk compliance: ${riskValidation.adjustedAmount}`);
          }
        }
      }

      // 3. Position limits validation
      const positionCheck = await this.positionLimits.canOpenPosition(
        params.tokenIn,
        safeParseFloat(params.amountIn, 0),
        this.config.wallet.address
      );

      if (!positionCheck.allowed) {
        return {
          success: false,
          error: positionCheck.reason
        };
      }

      // 4. Enhanced slippage validation
      if (params.slippageTolerance && params.slippageTolerance > 0.05) {
        logger.warn(`High slippage tolerance requested: ${params.slippageTolerance * 100}%`);
      }

      // 5. Execute the trade
      const result = await this.swapExecutor.executeSwap({
        ...params,
        userAddress: this.config.wallet.address,
        urgency: 'normal'
      });

      // 6. Update statistics and record success/failure
      if (result.success) {
        this.tradingStats.totalTrades++;
        this.tradingStats.successfulTrades++;
        this.tradingStats.totalVolume += safeParseFloat(params.amountIn, 0);
        this.emergencyControls.recordSuccess();

        logger.info('Manual trade executed successfully:', {
          transactionId: result.transactionId,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn
        });
      } else {
        this.emergencyControls.recordSystemError(result.error);
        logger.error('Manual trade failed:', result.error);
      }

      return {
        success: result.success,
        transactionId: result.transactionId,
        error: result.error,
        adjustedAmount: params.amountIn
      };

    } catch (error) {
      logger.error('Manual trade execution failed:', error);
      this.emergencyControls.recordSystemError(error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get portfolio overview
   */
  async getPortfolio(): Promise<{
    positions: BlockchainPosition[];
    balances: PortfolioBalance[];
    totalValue: number;
    pnl: number;
    liquidityPositions: BlockchainPosition[];
    rangeOrders: RangeOrder[];
    marketMakingPositions: MarketMakingPosition[];
  }> {
    try {
      // Get liquidity positions from our infrastructure
      const liquidityPositions = await this.liquidityManager.getAllPositions();
      const rangeOrders = this.rangeOrderStrategy.getAllOrders();
      const marketMakingPositions = await this.marketMakingStrategy.getActivePositions();

      // Get token balances from wallet
      const balances = await this.getTokenBalances();

      // Calculate total portfolio value including liquidity positions
      const totalValue = await this.calculatePortfolioValue(liquidityPositions, balances);

      return {
        positions: liquidityPositions,
        balances,
        totalValue,
        pnl: this.tradingStats.totalProfit,
        liquidityPositions,
        rangeOrders: rangeOrders as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        marketMakingPositions: marketMakingPositions as any // eslint-disable-line @typescript-eslint/no-explicit-any
      };

    } catch (error) {
      logger.error('Error getting portfolio:', error);
      return {
        positions: [],
        balances: [],
        totalValue: 0,
        pnl: 0,
        liquidityPositions: [],
        rangeOrders: [],
        marketMakingPositions: []
      };
    }
  }

  /**
   * Get token balances from wallet
   */
  private async getTokenBalances(): Promise<PortfolioBalance[]> {
    try {
      if (!this.config.wallet?.address) {
        return [];
      }

      // Get user positions using SDK
      const positionsResponse = await this.gswap.positions.getUserPositions(this.config.wallet.address);

      const balances = new Map<string, number>();

      if (positionsResponse?.positions) {
        for (const position of positionsResponse.positions) {
          // Note: SDK positions API exists but liquidity operations are not supported
          if (position.token0Symbol && position.liquidity) {
            const token0 = position.token0Symbol;
            // CRITICAL FIX: Calculate actual V3 position amounts based on price range
            const amount0 = this.calculateV3PositionAmount0(position as any); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (amount0 > 0) {
              balances.set(token0, (balances.get(token0) || 0) + amount0);
            }
          }

          if (position.token1Symbol && position.liquidity) {
            const token1 = position.token1Symbol;
            // CRITICAL FIX: Calculate actual V3 position amounts based on price range
            const amount1 = this.calculateV3PositionAmount1(position as any); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (amount1 > 0) {
              balances.set(token1, (balances.get(token1) || 0) + amount1);
            }
          }
        }
      }

      return Array.from(balances.entries()).map(([token, amount]) => ({
        token,
        amount,
        valueUSD: 0 // Will be calculated in calculatePortfolioValue
      }));

    } catch (error) {
      logger.error('Error getting token balances:', error);
      return [];
    }
  }

  /**
   * Calculate total portfolio value (optimized to avoid N+1 queries)
   */
  private async calculatePortfolioValue(positions: BlockchainPosition[], balances: PortfolioBalance[]): Promise<number> {
    try {
      let totalValue = 0;

      // Batch fetch prices for all unique tokens to avoid N+1 queries
      if (balances.length > 0) {
        const uniqueTokens = [...new Set(balances.map(b => b.token))];

        try {
          // Get prices by fetching pool data against GUSDC (USD stable coin)
          const usdcToken = TRADING_CONSTANTS.TOKENS.GUSDC;
          const priceMap = new Map<string, number>();

          // Parallelize price fetching for all tokens
          const pricePromises = uniqueTokens.map(async (token) => {
            if (token === usdcToken) {
              return { token, price: 1.0 }; // GUSDC is 1:1 with USD
            }

            try {
              // Try to get pool data for this token paired with GUSDC
              const poolData = await this.gswap.pools.getPoolData(token, usdcToken, 3000);
              if (poolData?.sqrtPrice) {
                const price = this.gswap.pools.calculateSpotPrice(token, usdcToken, poolData.sqrtPrice);
                return { token, price: safeParseFloat(price.toString(), 0) };
              }
            } catch (error) {
              logger.debug(`Could not get pool price for ${token}:`, error);
              // Try with lower fee tier
              try {
                const poolData = await this.gswap.pools.getPoolData(token, usdcToken, 500);
                if (poolData?.sqrtPrice) {
                  const price = this.gswap.pools.calculateSpotPrice(token, usdcToken, poolData.sqrtPrice);
                  return { token, price: safeParseFloat(price.toString(), 0) };
                }
              } catch (error) {
                logger.debug(`Could not get pool price for ${token} on lower fee tier:`, error);
              }
            }

            return { token, price: 0 };
          });

          // Wait for all price fetches to complete
          const priceResults = await Promise.allSettled(pricePromises);

          // Process results and populate price map
          priceResults.forEach((result) => {
            if (result.status === 'fulfilled') {
              priceMap.set(result.value.token, result.value.price);
            }
          });

          // Calculate value from token balances using cached prices
          for (const balance of balances) {
            const price = priceMap.get(balance.token) || 0;
            if (price > 0) {
              totalValue += balance.amount * price;
            }
          }
        } catch (error) {
          logger.warn('Price calculation failed:', error);
        }
      }

      // Add value from liquidity positions
      for (const position of positions) {
        if (position.valueUSD) {
          totalValue += safeParseFloat(position.valueUSD, 0);
        }
      }

      return totalValue;

    } catch (error) {
      logger.error('Error calculating portfolio value:', error);
      return 0;
    }
  }

  /**
   * Calculate actual token0 amount in V3 position based on current price and range
   * CRITICAL FIX: V3 positions are NOT 50/50 - amounts depend on current price vs range
   * CRITICAL FIX: Added comprehensive mathematical bounds checking
   */
  private calculateV3PositionAmount0(position: BlockchainPosition): number {
    try {
      // CRITICAL FIX: Input validation and bounds checking
      const liquidity = safeParseFloat(position.liquidity?.toString(), 0);
      if (liquidity <= 0 || !isFinite(liquidity)) {
        return 0;
      }

      // Validate liquidity is within reasonable bounds
      if (liquidity > 1e18) {
        logger.warn(`Extremely high liquidity value detected: ${liquidity}`);
        return 0;
      }

      // Get current price from pool data with validation
      const currentPrice = this.getCurrentPriceForPosition(position);
      if (!isFinite(currentPrice) || currentPrice <= 0) {
        logger.error(`Invalid current price: ${currentPrice}`);
        return 0;
      }

      const tickLower = position.tickLower || 0;
      const tickUpper = position.tickUpper || 0;

      // CRITICAL FIX: Validate tick bounds (Uniswap V3 limits)
      if (tickLower < -887272 || tickLower > 887272) {
        logger.error(`Tick lower out of bounds: ${tickLower}`);
        return 0;
      }
      if (tickUpper < -887272 || tickUpper > 887272) {
        logger.error(`Tick upper out of bounds: ${tickUpper}`);
        return 0;
      }
      if (tickLower >= tickUpper) {
        logger.error(`Invalid tick range: lower=${tickLower}, upper=${tickUpper}`);
        return 0;
      }

      // Convert ticks to prices with bounds checking
      const priceLower = Math.pow(1.0001, tickLower);
      const priceUpper = Math.pow(1.0001, tickUpper);

      // CRITICAL FIX: Validate calculated prices
      if (!isFinite(priceLower) || !isFinite(priceUpper) || priceLower <= 0 || priceUpper <= 0) {
        logger.error(`Invalid calculated prices: lower=${priceLower}, upper=${priceUpper}`);
        return 0;
      }

      // If current price is below range, position is 100% token0
      if (currentPrice <= priceLower) {
        // CRITICAL FIX: Safe sqrt calculations with bounds checking
        const sqrtPriceUpper = Math.sqrt(priceUpper);
        const sqrtPriceLower = Math.sqrt(priceLower);

        if (!isFinite(sqrtPriceUpper) || !isFinite(sqrtPriceLower) || sqrtPriceUpper <= 0 || sqrtPriceLower <= 0) {
          logger.error(`Invalid sqrt prices: upper=${sqrtPriceUpper}, lower=${sqrtPriceLower}`);
          return 0;
        }

        const amount = liquidity * (1 / sqrtPriceUpper - 1 / sqrtPriceLower);
        return isFinite(amount) && amount >= 0 ? amount : 0;
      }

      // If current price is above range, position is 0% token0
      if (currentPrice >= priceUpper) {
        return 0;
      }

      // If current price is in range, calculate proportional amount
      const sqrtPrice = Math.sqrt(currentPrice);
      const sqrtPriceLower = Math.sqrt(priceLower);
      const sqrtPriceUpper = Math.sqrt(priceUpper);

      // CRITICAL FIX: Validate all sqrt calculations
      if (!isFinite(sqrtPrice) || !isFinite(sqrtPriceLower) || !isFinite(sqrtPriceUpper) ||
          sqrtPrice <= 0 || sqrtPriceLower <= 0 || sqrtPriceUpper <= 0) {
        logger.error(`Invalid sqrt calculations: price=${sqrtPrice}, lower=${sqrtPriceLower}, upper=${sqrtPriceUpper}`);
        return 0;
      }

      const amount = liquidity * (1 / sqrtPrice - 1 / sqrtPriceUpper);

      // CRITICAL FIX: Final bounds check on result
      if (!isFinite(amount) || amount < 0) {
        logger.error(`Invalid calculated amount: ${amount}`);
        return 0;
      }

      return amount;

    } catch (error) {
      logger.error('Error calculating V3 position amount0:', error);
      // Fallback to conservative estimate if calculation fails
      return safeParseFloat(position.liquidity?.toString(), 0) * 0.3;
    }
  }

  /**
   * Calculate actual token1 amount in V3 position based on current price and range
   * CRITICAL FIX: V3 positions are NOT 50/50 - amounts depend on current price vs range
   * CRITICAL FIX: Added comprehensive mathematical bounds checking
   */
  private calculateV3PositionAmount1(position: BlockchainPosition): number {
    try {
      // CRITICAL FIX: Input validation and bounds checking
      const liquidity = safeParseFloat(position.liquidity?.toString(), 0);
      if (liquidity <= 0 || !isFinite(liquidity)) {
        return 0;
      }

      // Validate liquidity is within reasonable bounds
      if (liquidity > 1e18) {
        logger.warn(`Extremely high liquidity value detected: ${liquidity}`);
        return 0;
      }

      // Get current price from pool data with validation
      const currentPrice = this.getCurrentPriceForPosition(position);
      if (!isFinite(currentPrice) || currentPrice <= 0) {
        logger.error(`Invalid current price: ${currentPrice}`);
        return 0;
      }

      const tickLower = position.tickLower || 0;
      const tickUpper = position.tickUpper || 0;

      // CRITICAL FIX: Validate tick bounds (Uniswap V3 limits)
      if (tickLower < -887272 || tickLower > 887272) {
        logger.error(`Tick lower out of bounds: ${tickLower}`);
        return 0;
      }
      if (tickUpper < -887272 || tickUpper > 887272) {
        logger.error(`Tick upper out of bounds: ${tickUpper}`);
        return 0;
      }
      if (tickLower >= tickUpper) {
        logger.error(`Invalid tick range: lower=${tickLower}, upper=${tickUpper}`);
        return 0;
      }

      // Convert ticks to prices with bounds checking
      const priceLower = Math.pow(1.0001, tickLower);
      const priceUpper = Math.pow(1.0001, tickUpper);

      // CRITICAL FIX: Validate calculated prices
      if (!isFinite(priceLower) || !isFinite(priceUpper) || priceLower <= 0 || priceUpper <= 0) {
        logger.error(`Invalid calculated prices: lower=${priceLower}, upper=${priceUpper}`);
        return 0;
      }

      // If current price is below range, position is 0% token1
      if (currentPrice <= priceLower) {
        return 0;
      }

      // If current price is above range, position is 100% token1
      if (currentPrice >= priceUpper) {
        // CRITICAL FIX: Safe sqrt calculations with bounds checking
        const sqrtPriceUpper = Math.sqrt(priceUpper);
        const sqrtPriceLower = Math.sqrt(priceLower);

        if (!isFinite(sqrtPriceUpper) || !isFinite(sqrtPriceLower) || sqrtPriceUpper <= 0 || sqrtPriceLower <= 0) {
          logger.error(`Invalid sqrt prices: upper=${sqrtPriceUpper}, lower=${sqrtPriceLower}`);
          return 0;
        }

        const amount = liquidity * (sqrtPriceUpper - sqrtPriceLower);
        return isFinite(amount) && amount >= 0 ? amount : 0;
      }

      // If current price is in range, calculate proportional amount
      const sqrtPrice = Math.sqrt(currentPrice);
      const sqrtPriceLower = Math.sqrt(priceLower);

      // CRITICAL FIX: Validate sqrt calculations
      if (!isFinite(sqrtPrice) || !isFinite(sqrtPriceLower) || sqrtPrice <= 0 || sqrtPriceLower <= 0) {
        logger.error(`Invalid sqrt calculations: price=${sqrtPrice}, lower=${sqrtPriceLower}`);
        return 0;
      }

      const amount = liquidity * (sqrtPrice - sqrtPriceLower);

      // CRITICAL FIX: Final bounds check on result
      if (!isFinite(amount) || amount < 0) {
        logger.error(`Invalid calculated amount: ${amount}`);
        return 0;
      }

      return amount;

    } catch (error) {
      logger.error('Error calculating V3 position amount1:', error);
      // Fallback to conservative estimate if calculation fails
      return safeParseFloat(position.liquidity?.toString(), 0) * 0.3;
    }
  }

  /**
   * Get current price for a position's token pair
   */
  private getCurrentPriceForPosition(position: BlockchainPosition): number {
    try {
      // Try to get current pool price
      // This is a simplified approach - in production would cache pool prices
      const _token0 = position.token0 || position.token0Symbol;
      const _token1 = position.token1 || position.token1Symbol;
      const _fee = position.fee || 3000;

      // For now, return a reasonable default based on tick range center
      // In production, this should fetch actual pool.slot0 current price
      const tickLower = position.tickLower || 0;
      const tickUpper = position.tickUpper || 0;
      const midTick = (tickLower + tickUpper) / 2;

      return Math.pow(1.0001, midTick);

    } catch (error) {
      logger.error('Error getting current price for position:', error);
      return 1.0; // Safe fallback
    }
  }

  /**
   * Get portfolio snapshot for risk management
   */
  private async getPortfolioSnapshot(): Promise<{
    totalValue: number;
    dailyPnL: number;
    totalPnL: number;
    baselineValue: number;
    dailyStartValue: number;
    maxConcentration: number;
  }> {
    try {
      const portfolio = await this.getPortfolio();
      const totalValue = portfolio.totalValue;

      // Check for daily reset
      await this.checkDailyReset();

      // Use trading stats for P&L calculations
      const totalPnL = ((totalValue - this.tradingStats.initialBalance) / this.tradingStats.initialBalance) * 100;
      const dailyPnL = ((totalValue - this.dailyStartValue) / this.dailyStartValue) * 100;

      // Calculate concentration (simplified - largest position percentage)
      let maxConcentration = 0;
      if (portfolio.balances.length > 0 && totalValue > 0) {
        const maxBalance = Math.max(...portfolio.balances.map(b => b.valueUSD));
        maxConcentration = maxBalance / totalValue;
      }

      return {
        totalValue,
        dailyPnL,
        totalPnL,
        baselineValue: this.tradingStats.initialBalance,
        dailyStartValue: this.dailyStartValue,
        maxConcentration
      };

    } catch (error) {
      logger.error('Error getting portfolio snapshot:', error);
      return {
        totalValue: 0,
        dailyPnL: 0,
        totalPnL: 0,
        baselineValue: 0,
        dailyStartValue: 0,
        maxConcentration: 0
      };
    }
  }

  /**
   * Check if daily reset is needed and reset values
   */
  private async checkDailyReset(): Promise<void> {
    const now = new Date();
    if (now.getDate() !== this.lastDailyReset.getDate()) {
      const portfolio = await this.getPortfolio();
      this.dailyStartValue = portfolio.totalValue;
      this.lastDailyReset = now;
      logger.info(`Daily P&L reset: Starting value ${this.dailyStartValue}`);
    }
  }

  /**
   * Update trading statistics
   */
  private updateTradingStats(): void {
    // Get strategy statistics
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const arbitrageStats = this.arbitrageStrategy.getStatus();
  
    // Update aggregated stats
    // Note: Advanced statistics aggregation will be implemented in future versions
  }

  /**
   * Get current engine status
   */
  getStatus(): {
    isRunning: boolean;
    uptime: number;
    apiHealth: boolean;
    strategies: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    performance: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    market: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    positions: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    risk: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  } {
    const uptime = Date.now() - this.tradingStats.startTime;
    const successRate = this.tradingStats.totalTrades > 0
      ? (this.tradingStats.successfulTrades / this.tradingStats.totalTrades) * 100
      : 0;

    return {
      isRunning: this.isRunning,
      uptime: uptime / 1000, // in seconds
      apiHealth: true, // Note: Real-time API health monitoring will be implemented in future versions
      strategies: {
        arbitrage: this.arbitrageStrategy.getStatus(),
        marketMaking: this.marketMakingStrategy.getStatus(),
        rangeOrders: this.rangeOrderStrategy.getStatistics()
      },
      performance: {
        totalTrades: this.tradingStats.totalTrades,
        successfulTrades: this.tradingStats.successfulTrades,
        totalVolume: this.tradingStats.totalVolume,
        totalProfit: this.tradingStats.totalProfit,
        successRate: successRate.toFixed(2) + '%'
      },
      market: {
        conditions: this.marketAnalysis?.getMarketCondition() || {},
        prices: this.priceTracker.getAllPrices(),
        alerts: this.priceTracker.getTriggeredAlerts()
      },
      positions: {
        liquidity: this.liquidityManager.getStatus(),
        limits: this.positionLimits.getCurrentLimits(),
        tracker: this.positionTracker.getStatus(),
        rebalancing: this.rebalanceEngine.getStatus()
      },
      risk: {
        emergencyStop: this.emergencyControls.isEmergencyStopEnabled(),
        emergencyStatus: this.emergencyControls.getEmergencyStatus(),
        riskLevel: this.riskMonitor.getRiskStatus().latestSnapshot?.riskMetrics.riskScore || 0,
        monitoring: this.riskMonitor.getRiskStatus().isMonitoring,
        slippageProtection: this.slippageProtection.getProtectionSettings()
      }
    };
  }

  /**
   * Emergency stop - immediately halt all trading
   */
  async emergencyStop(reason: string = 'Manual emergency stop', liquidatePositions: boolean = false): Promise<void> {
    logger.error('🚨 EMERGENCY STOP activated:', reason);

    try {
      await this.emergencyControls.activateEmergencyStop('MANUAL_STOP', reason, liquidatePositions);
      await this.stop();

      logger.error('Emergency stop completed');

    } catch (error) {
      logger.error('Error during emergency stop:', error);
    }
  }

  /**
   * Get comprehensive risk status
   */
  getRiskStatus(): {
    emergencyStatus: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    riskMonitor: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    positionLimits: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    slippageProtection: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  } {
    return {
      emergencyStatus: this.emergencyControls.getEmergencyStatus(),
      riskMonitor: this.riskMonitor.getRiskStatus(),
      positionLimits: this.positionLimits.getLimitsConfig(),
      slippageProtection: this.slippageProtection.getProtectionSettings()
    };
  }

  /**
   * Manually deactivate emergency stop
   */
  async deactivateEmergencyStop(reason: string): Promise<void> {
    logger.warn('Manually deactivating emergency stop:', reason);
    await this.emergencyControls.deactivateEmergencyStop(reason);
  }

  /**
   * Test emergency procedures
   */
  async testEmergencyProcedures(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    logger.info('Testing emergency procedures...');
    return await this.emergencyControls.testEmergencyProcedures();
  }

  /**
   * Get position violations
   */
  async getPositionViolations(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return await this.positionLimits.getViolations(this.config.wallet.address);
  }

  /**
   * Update risk configuration
   */
  updateRiskConfiguration(config: {
    positionLimits?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    riskMonitor?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    emergencyTriggers?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }): void {
    if (config.positionLimits) {
      this.positionLimits.updateLimits(config.positionLimits);
    }
    if (config.riskMonitor) {
      this.riskMonitor.updateRiskConfig(config.riskMonitor);
    }
    if (config.emergencyTriggers) {
      this.emergencyControls.updateTriggers(config.emergencyTriggers);
    }

    logger.info('Risk configuration updated');
  }

  /**
   * Get GSwap SDK for external access
   */
  getClient(): GSwap {
    return this.gswap;
  }

  /**
   * Get swap executor for external access
   */
  getSwapExecutor(): SwapExecutor {
    return this.swapExecutor;
  }

  /**
   * Enable arbitrage strategy
   */
  async enableArbitrageStrategy(): Promise<void> {
    try {
      await this.arbitrageStrategy.initialize();
      logger.info('✅ Arbitrage strategy enabled');
    } catch (error) {
      logger.error('❌ Failed to enable arbitrage strategy:', error);
      throw error;
    }
  }

  // ============================================
  // LIQUIDITY STRATEGY MANAGEMENT METHODS
  // ============================================

  /**
   * Place a range order (limit order using liquidity)
   */
  async placeRangeOrder(config: {
    token0: string;
    token1: string;
    fee: number;
    direction: 'buy' | 'sell';
    amount: string;
    targetPrice: number;
    rangeWidth: number;
    autoExecute: boolean;
    slippageTolerance?: number;
  }): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      logger.info('Placing range order via TradingEngine', config);
      return await this.rangeOrderStrategy.placeRangeOrder(config);
    } catch (error) {
      logger.error('Failed to place range order:', error);
      throw error;
    }
  }

  /**
   * Cancel a range order
   */
  async cancelRangeOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info(`Cancelling range order: ${orderId}`);
      return await this.rangeOrderStrategy.cancelRangeOrder(orderId);
    } catch (error) {
      logger.error('Failed to cancel range order:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get range order status
   */
  getRangeOrderStatus(orderId: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.rangeOrderStrategy.getOrderStatus(orderId);
  }

  /**
   * Get all range orders
   */
  getAllRangeOrders(): any[] { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.rangeOrderStrategy.getAllOrders();
  }

  /**
   * Add a new liquidity position
   */
  async addLiquidityPosition(params: {
    token0: string;
    token1: string;
    fee: number;
    minPrice: number;
    maxPrice: number;
    amount0Desired: string;
    amount1Desired: string;
    slippageTolerance?: number;
  }): Promise<string> {
    try {
      logger.info('Adding liquidity position via TradingEngine', params);
      return await this.liquidityManager.addLiquidityByPrice(params);
    } catch (error) {
      logger.error('Failed to add liquidity position:', error);
      throw error;
    }
  }

  /**
   * Remove a liquidity position
   */
  async removeLiquidityPosition(params: {
    positionId: string;
    liquidity: string;
    slippageTolerance?: number;
  }): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      logger.info('Removing liquidity position via TradingEngine', params);
      return await this.liquidityManager.removeLiquidity(params);
    } catch (error) {
      logger.error('Failed to remove liquidity position:', error);
      throw error;
    }
  }

  /**
   * Collect fees from a position
   */
  async collectPositionFees(positionId: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      logger.info(`Collecting fees for position: ${positionId}`);
      return await this.liquidityManager.collectFees({ positionId });
    } catch (error) {
      logger.error('Failed to collect position fees:', error);
      throw error;
    }
  }

  /**
   * Get fee analysis for a position
   */
  async getPositionFeeAnalysis(_positionId: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      return await this.feeCalculator.calculateAccruedFees();
    } catch (error) {
      logger.error('Failed to get fee analysis:', error);
      throw error;
    }
  }

  /**
   * Get rebalance recommendations
   */
  async getRebalanceRecommendations(): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      return await this.rebalanceEngine.checkRebalanceSignals();
    } catch (error) {
      logger.error('Failed to get rebalance recommendations:', error);
      return [];
    }
  }

  /**
   * Execute manual rebalance
   */
  async executeManualRebalance(positionId: string, strategy: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      logger.info(`Manually executing rebalance for position ${positionId} with strategy ${strategy}`);
      return await this.rebalanceEngine.executeRebalance();
    } catch (error) {
      logger.error('Failed to execute manual rebalance:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive liquidity analytics
   */
  async getLiquidityAnalytics(): Promise<{
    totalPositions: number;
    totalLiquidity: number;
    totalFeesEarned: number;
    averageAPR: number;
    positionPerformance: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    rangeOrderStats: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    marketMakingStats: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }> {
    try {
      const positions = await this.liquidityManager.getAllPositions();
      const rangeOrderStats = this.rangeOrderStrategy.getStatistics();
      const marketMakingStats = this.marketMakingStrategy.getStatus();

      const totalFeesEarned = await this.feeCalculator.getTotalFeesCollected();
      const positionPerformance = await Promise.all(
        positions.map(async (pos) => {
          const analysis = await this.feeCalculator.calculateAccruedFees();
          return {
            positionId: pos.id,
            token0: pos.token0,
            token1: pos.token1,
            feesEarned: analysis,
            apr: 0, // Simplified calculation
            inRange: pos.inRange,
            timeInRange: 100 // Simplified calculation
          };
        })
      );

      const totalLiquidity = positions.reduce((sum, pos) => sum + parseFloat(pos.liquidity || '0'), 0);
      const averageAPR = positionPerformance.reduce((sum, perf) => sum + perf.apr, 0) / Math.max(positionPerformance.length, 1);

      return {
        totalPositions: positions.length,
        totalLiquidity,
        totalFeesEarned,
        averageAPR,
        positionPerformance,
        rangeOrderStats,
        marketMakingStats
      };

    } catch (error) {
      logger.error('Failed to get liquidity analytics:', error);
      return {
        totalPositions: 0,
        totalLiquidity: 0,
        totalFeesEarned: 0,
        averageAPR: 0,
        positionPerformance: [],
        rangeOrderStats: {},
        marketMakingStats: {}
      };
    }
  }
}