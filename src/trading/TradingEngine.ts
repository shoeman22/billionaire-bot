/**
 * Trading Engine
 * Core trading orchestrator for the billionaire bot
 */

import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { BotConfig } from '../config/environment';
import { TRADING_CONSTANTS } from '../config/constants';
import { logger } from '../utils/logger';
import { PriceTracker } from '../monitoring/price-tracker';
import { ArbitrageStrategy } from './strategies/arbitrage';
import { PositionLimits } from './risk/position-limits';
import { SlippageProtection } from './risk/slippage';
import { RiskMonitor } from './risk/risk-monitor';
import { EmergencyControls } from './risk/emergency-controls';
import { SwapExecutor } from './execution/swap-executor';
import { MarketAnalysis } from '../monitoring/market-analysis';
import { AlertSystem } from '../monitoring/alerts';
import { safeParseFloat } from '../utils/safe-parse';

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

    // Initialize GSwap SDK - access private key directly from environment for security
    this.gswap = new GSwap({
      signer: new PrivateKeySigner(privateKey),
      walletAddress: config.wallet.address,
      gatewayBaseUrl: config.api.baseUrl,
      dexBackendBaseUrl: config.api.baseUrl,
      bundlerBaseUrl: config.api.baseUrl.replace('dex-backend', 'bundle-backend')
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
      this.swapExecutor
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

    logger.info('Trading Engine initialized with all components');
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

      // Connect WebSocket for real-time data
      await GSwap.events.connectEventSocket();

      // Start price tracking
      await this.priceTracker.start();

      // Start risk monitoring
      await this.riskMonitor.startMonitoring(this.config.wallet.address);

      // Initialize strategies
      await this.arbitrageStrategy.initialize();
    
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
    
      // Stop risk monitoring
      this.riskMonitor.stopMonitoring();

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
      const marketCondition = await this.marketAnalysis.analyzeMarket();

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

      // 9. Execute strategies based on market conditions and risk level
      const riskAdjustedExecution = this.shouldExecuteStrategies(marketCondition, riskCheck.riskLevel);

      if (riskAdjustedExecution.shouldExecute) {
        if (marketCondition.overall === 'bullish' && marketCondition.confidence > 70 && riskCheck.riskLevel !== 'high') {
          // Strong bullish trend - favor arbitrage (only if not high risk)
          await this.arbitrageStrategy.execute();
        } else if (marketCondition.volatility === 'low' && marketCondition.liquidity === 'good' && riskCheck.riskLevel === 'low') {
          // Low volatility, good liquidity, low risk - favorable conditions
          // Fall back to arbitrage if conditions are favorable
          await this.arbitrageStrategy.execute();
        } else if (marketCondition.confidence > 50 && riskCheck.riskLevel === 'low') {
          // Balanced conditions, low risk - only arbitrage available
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

      // 10. Update statistics
      this.updateTradingStats();

      logger.debug('Trading cycle completed successfully');

    } catch (error) {
      logger.error('Error in trading cycle:', error);
      this.emergencyControls.recordSystemError(error);
      await this.alertSystem.systemAlert('trading_engine', error);
    }
  }

  /**
   * Determine if strategies should execute based on risk level
   */
  private shouldExecuteStrategies(
    marketCondition: any, // eslint-disable-line @typescript-eslint/no-explicit-any
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
    riskValidation?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
            marketConditions: {} // Note: Real-time market conditions will be implemented in future versions
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
    positions: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    balances: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    totalValue: number;
    pnl: number;
  }> {
    try {
      // No liquidity positions available - SDK v0.0.7 doesn't support liquidity operations
      const positions: never[] = [];

      // Get token balances from wallet
      const balances = await this.getTokenBalances();

      // Calculate total portfolio value
      const totalValue = await this.calculatePortfolioValue(positions, balances);

      return {
        positions,
        balances,
        totalValue,
        pnl: this.tradingStats.totalProfit
      };

    } catch (error) {
      logger.error('Error getting portfolio:', error);
      return {
        positions: [],
        balances: [],
        totalValue: 0,
        pnl: 0
      };
    }
  }

  /**
   * Get token balances from wallet
   */
  private async getTokenBalances(): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
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
            const amount0 = safeParseFloat(position.liquidity.toString(), 0) / 2; // Simplified allocation
            balances.set(token0, (balances.get(token0) || 0) + amount0);
          }

          if (position.token1Symbol && position.liquidity) {
            const token1 = position.token1Symbol;
            const amount1 = safeParseFloat(position.liquidity.toString(), 0) / 2; // Simplified allocation
            balances.set(token1, (balances.get(token1) || 0) + amount1);
          }
        }
      }

      return Array.from(balances.entries()).map(([token, amount]) => ({
        token,
        amount,
        value: 0 // Will be calculated in calculatePortfolioValue
      }));

    } catch (error) {
      logger.error('Error getting token balances:', error);
      return [];
    }
  }

  /**
   * Calculate total portfolio value (optimized to avoid N+1 queries)
   */
  private async calculatePortfolioValue(positions: any[], balances: any[]): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
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
        const maxBalance = Math.max(...portfolio.balances.map(b => b.amount * (b.price || 0)));
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
        // No liquidity statistics - SDK v0.0.7 doesn't support liquidity operations
        limits: this.positionLimits.getCurrentLimits()
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
}