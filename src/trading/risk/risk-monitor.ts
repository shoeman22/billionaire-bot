/**
 * Risk Monitor
 * Real-time portfolio monitoring and risk assessment
 */

import { GalaSwapClient } from '../../api/GalaSwapClient';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { AlertSystem } from '../../monitoring/alerts';

export interface RiskConfig {
  maxDailyLossPercent: number;
  maxTotalLossPercent: number;
  maxDrawdownPercent: number;
  maxDailyVolume: number;
  maxPositionAge: number; // in hours
  emergencyStopTriggers: {
    portfolioLoss: number;
    dailyLoss: number;
    unusualVolatility: number;
    lowLiquidity: number;
  };
}

export interface PortfolioSnapshot {
  timestamp: number;
  totalValue: number;
  positions: PositionSnapshot[];
  dailyPnL: number;
  totalPnL: number;
  dailyVolume: number;
  riskMetrics: RiskMetrics;
}

export interface PositionSnapshot {
  token: string;
  amount: number;
  valueUSD: number;
  percentOfPortfolio: number;
  unrealizedPnL: number;
  openTime: number;
  age: number; // in hours
}

export interface RiskMetrics {
  totalExposure: number;
  maxConcentration: number;
  volatilityScore: number;
  liquidityScore: number;
  drawdown: number;
  sharpeRatio: number;
  riskScore: number; // 0-100, higher is riskier
}

export interface MarketAnomalyAlert {
  type: 'price_spike' | 'volume_surge' | 'liquidity_drop' | 'volatility_spike';
  severity: 'low' | 'medium' | 'high' | 'critical';
  token?: string;
  data: any;
  recommendation: string;
}

export class RiskMonitor {
  private config: TradingConfig;
  private riskConfig: RiskConfig;
  protected galaSwapClient: GalaSwapClient;
  private alertSystem: AlertSystem;
  private portfolioSnapshots: PortfolioSnapshot[] = [];
  private baselinePortfolioValue: number = 0;
  private dailyStartValue: number = 0;
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  // Risk thresholds
  private readonly RISK_THRESHOLDS = {
    LOW_RISK: 25,
    MEDIUM_RISK: 50,
    HIGH_RISK: 75,
    CRITICAL_RISK: 90
  };

  constructor(config: TradingConfig, galaSwapClient: GalaSwapClient) {
    this.config = config;
    this.galaSwapClient = galaSwapClient;
    this.alertSystem = new AlertSystem();

    // Initialize risk configuration from environment
    this.riskConfig = {
      maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '0.05'),
      maxTotalLossPercent: parseFloat(process.env.MAX_TOTAL_LOSS_PERCENT || '0.15'),
      maxDrawdownPercent: parseFloat(process.env.MAX_DRAWDOWN_PERCENT || '0.10'),
      maxDailyVolume: parseFloat(process.env.MAX_DAILY_VOLUME || '5000'),
      maxPositionAge: parseFloat(process.env.MAX_POSITION_AGE_HOURS || '24'),
      emergencyStopTriggers: {
        portfolioLoss: parseFloat(process.env.EMERGENCY_PORTFOLIO_LOSS || '0.20'),
        dailyLoss: parseFloat(process.env.EMERGENCY_DAILY_LOSS || '0.10'),
        unusualVolatility: parseFloat(process.env.EMERGENCY_VOLATILITY || '0.50'),
        lowLiquidity: parseFloat(process.env.EMERGENCY_LOW_LIQUIDITY || '0.10'),
      }
    };

    logger.info('Risk Monitor initialized with configuration:', this.riskConfig);
  }

  /**
   * Start real-time portfolio monitoring
   */
  async startMonitoring(userAddress: string): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Risk monitoring already active');
      return;
    }

    try {
      // Initialize baseline portfolio value
      const initialSnapshot = await this.capturePortfolioSnapshot(userAddress);
      this.baselinePortfolioValue = initialSnapshot.totalValue;
      this.dailyStartValue = initialSnapshot.totalValue;
      this.portfolioSnapshots.push(initialSnapshot);

      // Start monitoring loop
      this.monitoringInterval = setInterval(async () => {
        try {
          await this.performRiskCheck(userAddress);
        } catch (error) {
          logger.error('Error in risk monitoring cycle:', error);
        }
      }, 30000); // Check every 30 seconds

      this.isMonitoring = true;
      logger.info('Risk monitoring started for portfolio:', {
        address: userAddress,
        baselineValue: this.baselinePortfolioValue,
        checkInterval: '30 seconds'
      });

    } catch (error) {
      logger.error('Failed to start risk monitoring:', error);
      throw error;
    }
  }

  /**
   * Stop portfolio monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    logger.info('Risk monitoring stopped');
  }

  /**
   * Perform comprehensive risk check
   */
  async performRiskCheck(userAddress: string): Promise<{
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    shouldContinueTrading: boolean;
    alerts: string[];
    emergencyActions: string[];
  }> {
    try {
      const snapshot = await this.capturePortfolioSnapshot(userAddress);
      this.portfolioSnapshots.push(snapshot);

      // Keep only last 24 hours of snapshots
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
      this.portfolioSnapshots = this.portfolioSnapshots.filter(s => s.timestamp > cutoffTime);

      const alerts: string[] = [];
      const emergencyActions: string[] = [];

      // Check daily loss limits
      const dailyLossCheck = this.checkDailyLossLimits(snapshot);
      if (dailyLossCheck.violated) {
        alerts.push(dailyLossCheck.message);
        if (dailyLossCheck.emergency) {
          emergencyActions.push('STOP_ALL_TRADING');
        }
      }

      // Check total portfolio loss limits
      const totalLossCheck = this.checkTotalLossLimits(snapshot);
      if (totalLossCheck.violated) {
        alerts.push(totalLossCheck.message);
        if (totalLossCheck.emergency) {
          emergencyActions.push('EMERGENCY_LIQUIDATION');
        }
      }

      // Check position concentration
      const concentrationCheck = this.checkConcentrationRisk(snapshot);
      if (concentrationCheck.violated) {
        alerts.push(concentrationCheck.message);
      }

      // Check position age limits
      const ageCheck = this.checkPositionAges(snapshot);
      if (ageCheck.violated) {
        alerts.push(ageCheck.message);
      }

      // Check daily volume limits
      const volumeCheck = await this.checkDailyVolumeLimits(userAddress);
      if (volumeCheck.violated) {
        alerts.push(volumeCheck.message);
      }

      // Detect market anomalies
      const anomalies = await this.detectMarketAnomalies();
      for (const anomaly of anomalies) {
        alerts.push(`Market anomaly detected: ${anomaly.type} - ${anomaly.recommendation}`);
        if (anomaly.severity === 'critical') {
          emergencyActions.push('REDUCE_EXPOSURE');
        }
      }

      // Calculate overall risk level
      const riskLevel = this.calculateRiskLevel(snapshot.riskMetrics.riskScore);
      const shouldContinueTrading = emergencyActions.length === 0 && riskLevel !== 'critical';

      // Send alerts if necessary
      if (alerts.length > 0) {
        await this.alertSystem.riskAlert('portfolio_risk', {
          riskLevel,
          alerts,
          emergencyActions,
          portfolio: snapshot
        });
      }

      logger.debug('Risk check completed:', {
        riskLevel,
        alertCount: alerts.length,
        emergencyActions: emergencyActions.length
      });

      return {
        riskLevel,
        shouldContinueTrading,
        alerts,
        emergencyActions
      };

    } catch (error) {
      logger.error('Error performing risk check:', error);
      return {
        riskLevel: 'critical',
        shouldContinueTrading: false,
        alerts: ['Risk monitoring system error'],
        emergencyActions: ['EMERGENCY_STOP']
      };
    }
  }

  /**
   * Capture current portfolio snapshot
   */
  private async capturePortfolioSnapshot(userAddress: string): Promise<PortfolioSnapshot> {
    try {
      // Get token balances (placeholder - implement actual balance fetching)
      const balances = await this.getTokenBalances(userAddress);

      // Get current prices for all tokens
      const prices = await this.getCurrentPrices(balances.map(b => b.token));

      // Calculate positions
      const positions: PositionSnapshot[] = balances.map(balance => {
        const price = prices[balance.token] || 0;
        const valueUSD = balance.amount * price;

        return {
          token: balance.token,
          amount: balance.amount,
          valueUSD,
          percentOfPortfolio: 0, // Will be calculated below
          unrealizedPnL: 0, // TODO: Calculate based on entry price
          openTime: Date.now(), // TODO: Get actual open time
          age: 0 // TODO: Calculate actual age
        };
      });

      // Calculate total value
      const totalValue = positions.reduce((sum, pos) => sum + pos.valueUSD, 0);

      // Update portfolio percentages
      positions.forEach(pos => {
        pos.percentOfPortfolio = totalValue > 0 ? pos.valueUSD / totalValue : 0;
      });

      // Calculate P&L
      const dailyPnL = totalValue - this.dailyStartValue;
      const totalPnL = totalValue - this.baselinePortfolioValue;

      // Calculate daily volume from price tracker if available
      const dailyVolume = this.calculateDailyVolume(userAddress);

      // Calculate risk metrics
      const riskMetrics = this.calculateRiskMetrics(positions, totalValue);

      return {
        timestamp: Date.now(),
        totalValue,
        positions,
        dailyPnL,
        totalPnL,
        dailyVolume,
        riskMetrics
      };

    } catch (error) {
      logger.error('Error capturing portfolio snapshot:', error);
      throw error;
    }
  }

  /**
   * Get token balances for the wallet
   */
  private async getTokenBalances(userAddress: string): Promise<{ token: string; amount: number }[]> {
    try {
      logger.debug(`Fetching real token balances for address: ${userAddress}`);

      // Get user positions to extract token balances
      const positionsResponse = await this.galaSwapClient.getUserPositions(userAddress);

      if (!positionsResponse || positionsResponse.error) {
        logger.warn('Failed to fetch user positions, falling back to empty balances');
        return [];
      }

      // Extract unique tokens from positions and calculate total balances
      const tokenBalances = new Map<string, number>();

      if (positionsResponse.data && positionsResponse.data.Data && positionsResponse.data.Data.positions) {
        for (const position of positionsResponse.data.Data.positions) {
          // Extract token balances from liquidity positions
          if (position.token0Symbol && position.liquidity) {
            const token0 = position.token0Symbol;
            const liquidityAmount = parseFloat(position.liquidity) / 2; // Approximate split
            const current = tokenBalances.get(token0) || 0;
            tokenBalances.set(token0, current + liquidityAmount);
          }

          if (position.token1Symbol && position.liquidity) {
            const token1 = position.token1Symbol;
            const liquidityAmount = parseFloat(position.liquidity) / 2; // Approximate split
            const current = tokenBalances.get(token1) || 0;
            tokenBalances.set(token1, current + liquidityAmount);
          }
        }
      }

      // Convert map to array format
      const balances = Array.from(tokenBalances.entries()).map(([token, amount]) => ({
        token,
        amount
      }));

      logger.debug(`Retrieved ${balances.length} token balances:`, balances);
      return balances;

    } catch (error) {
      logger.error('Error fetching token balances:', error);
      return [];
    }
  }

  /**
   * Get current prices for tokens
   */
  private async getCurrentPrices(tokens: string[]): Promise<{ [token: string]: number }> {
    try {
      if (tokens.length === 0) {
        return {};
      }

      logger.debug(`Fetching current prices for tokens: ${tokens.join(', ')}`);

      const prices: { [token: string]: number } = {};

      // Fetch prices for each token individually
      for (const token of tokens) {
        try {
          // Convert token symbol to composite key format if needed
          const tokenKey = token.includes('$') ? token : `${token}$Unit$none$none`;

          const priceResponse = await this.galaSwapClient.getPrice(tokenKey);

          if (priceResponse && !priceResponse.error && priceResponse.data) {
            const priceUsd = parseFloat(priceResponse.data.priceUsd || priceResponse.data.price || '0');
            prices[token] = priceUsd;
            logger.debug(`Price for ${token}: $${priceUsd}`);
          } else {
            logger.warn(`Failed to get price for ${token}:`, priceResponse?.message);
            prices[token] = 0;
          }
        } catch (tokenError) {
          logger.warn(`Error fetching price for ${token}:`, tokenError);
          prices[token] = 0;
        }
      }

      logger.debug('Current prices retrieved:', prices);
      return prices;

    } catch (error) {
      logger.error('Error fetching current prices:', error);
      return {};
    }
  }

  /**
   * Calculate comprehensive risk metrics
   */
  private calculateRiskMetrics(positions: PositionSnapshot[], totalValue: number): RiskMetrics {
    const totalExposure = positions.reduce((sum, pos) => sum + pos.valueUSD, 0);
    const maxConcentration = Math.max(...positions.map(pos => pos.percentOfPortfolio));

    // Calculate drawdown
    const peakValue = Math.max(...this.portfolioSnapshots.map(s => s.totalValue), totalValue);
    const drawdown = peakValue > 0 ? (peakValue - totalValue) / peakValue : 0;

    // Simple volatility calculation based on recent snapshots
    const recentSnapshots = this.portfolioSnapshots.slice(-10);
    const returns = recentSnapshots.slice(1).map((snapshot, i) => {
      const prevValue = recentSnapshots[i].totalValue;
      return prevValue > 0 ? (snapshot.totalValue - prevValue) / prevValue : 0;
    });

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatilityScore = Math.sqrt(variance) * 100;

    // Calculate overall risk score (0-100)
    let riskScore = 0;
    riskScore += maxConcentration * 40; // Concentration risk (max 40 points)
    riskScore += Math.min(volatilityScore, 30); // Volatility risk (max 30 points)
    riskScore += drawdown * 30; // Drawdown risk (max 30 points)

    return {
      totalExposure,
      maxConcentration,
      volatilityScore,
      liquidityScore: 80, // TODO: Calculate actual liquidity score
      drawdown,
      sharpeRatio: volatilityScore > 0 ? avgReturn / volatilityScore : 0,
      riskScore: Math.min(riskScore, 100)
    };
  }

  /**
   * Check daily loss limits
   */
  protected checkDailyLossLimits(snapshot: PortfolioSnapshot): {
    violated: boolean;
    emergency: boolean;
    message: string;
  } {
    const dailyLossPercent = this.dailyStartValue > 0 ?
      Math.abs(snapshot.dailyPnL) / this.dailyStartValue : 0;

    const violated = dailyLossPercent > this.riskConfig.maxDailyLossPercent;
    const emergency = dailyLossPercent > this.riskConfig.emergencyStopTriggers.dailyLoss;

    return {
      violated,
      emergency,
      message: `Daily loss: ${(dailyLossPercent * 100).toFixed(2)}% (limit: ${(this.riskConfig.maxDailyLossPercent * 100).toFixed(2)}%)`
    };
  }

  /**
   * Check total portfolio loss limits
   */
  protected checkTotalLossLimits(snapshot: PortfolioSnapshot): {
    violated: boolean;
    emergency: boolean;
    message: string;
  } {
    const totalLossPercent = this.baselinePortfolioValue > 0 ?
      Math.abs(snapshot.totalPnL) / this.baselinePortfolioValue : 0;

    const violated = totalLossPercent > this.riskConfig.maxTotalLossPercent;
    const emergency = totalLossPercent > this.riskConfig.emergencyStopTriggers.portfolioLoss;

    return {
      violated,
      emergency,
      message: `Total loss: ${(totalLossPercent * 100).toFixed(2)}% (limit: ${(this.riskConfig.maxTotalLossPercent * 100).toFixed(2)}%)`
    };
  }

  /**
   * Check position concentration risk
   */
  protected checkConcentrationRisk(snapshot: PortfolioSnapshot): {
    violated: boolean;
    message: string;
  } {
    const maxConcentration = snapshot.riskMetrics.maxConcentration;
    const violated = maxConcentration > 0.3; // 30% max concentration

    return {
      violated,
      message: `Maximum concentration: ${(maxConcentration * 100).toFixed(2)}% (limit: 30%)`
    };
  }

  /**
   * Check position age limits
   */
  private checkPositionAges(snapshot: PortfolioSnapshot): {
    violated: boolean;
    message: string;
  } {
    const oldPositions = snapshot.positions.filter(pos => pos.age > this.riskConfig.maxPositionAge);
    const violated = oldPositions.length > 0;

    return {
      violated,
      message: `${oldPositions.length} positions exceed age limit of ${this.riskConfig.maxPositionAge} hours`
    };
  }

  /**
   * Check daily volume limits
   */
  protected async checkDailyVolumeLimits(userAddress: string): Promise<{
    violated: boolean;
    message: string;
  }> {
    const dailyVolume = this.calculateDailyVolume(userAddress);
    const violated = dailyVolume > this.riskConfig.maxDailyVolume;

    return {
      violated,
      message: `Daily volume: $${dailyVolume.toFixed(2)} (limit: $${this.riskConfig.maxDailyVolume.toFixed(2)})`
    };
  }

  /**
   * Calculate daily volume from portfolio snapshots
   */
  protected calculateDailyVolume(userAddress: string): number {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentSnapshots = this.portfolioSnapshots.filter(s => s.timestamp > oneDayAgo);

    if (recentSnapshots.length < 2) {
      return 0;
    }

    let totalVolume = 0;

    // Calculate volume as sum of absolute value changes between snapshots
    for (let i = 1; i < recentSnapshots.length; i++) {
      const current = recentSnapshots[i];
      const previous = recentSnapshots[i - 1];

      const valueChange = Math.abs(current.totalValue - previous.totalValue);
      totalVolume += valueChange;
    }

    return totalVolume;
  }

  /**
   * Detect market anomalies
   */
  private async detectMarketAnomalies(): Promise<MarketAnomalyAlert[]> {
    const alerts: MarketAnomalyAlert[] = [];

    try {
      logger.debug('Detecting market anomalies...');

      // Analyze recent portfolio snapshots for market anomalies
      if (this.portfolioSnapshots.length < 5) {
        logger.debug('Insufficient snapshot data for anomaly detection');
        return alerts;
      }

      const recentSnapshots = this.portfolioSnapshots.slice(-10);
      const currentSnapshot = recentSnapshots[recentSnapshots.length - 1];

      // 1. Detect rapid portfolio value changes (> 10% in 5 minutes)
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const oldSnapshot = recentSnapshots.find(s => s.timestamp < fiveMinutesAgo);

      if (oldSnapshot && currentSnapshot) {
        const valueChange = Math.abs(currentSnapshot.totalValue - oldSnapshot.totalValue) / oldSnapshot.totalValue;

        if (valueChange > 0.10) { // 10% threshold
          alerts.push({
            type: 'volatility_spike',
            severity: valueChange > 0.25 ? 'critical' : valueChange > 0.15 ? 'high' : 'medium',
            data: {
              oldValue: oldSnapshot.totalValue,
              newValue: currentSnapshot.totalValue,
              changePercent: valueChange * 100,
              timeframe: '5 minutes'
            },
            recommendation: `Portfolio value changed ${(valueChange * 100).toFixed(2)}% rapidly - monitor closely`
          });
        }
      }

      // 2. Detect volatility spikes (> 3x normal)
      const normalVolatility = 0.02; // 2% normal volatility
      if (currentSnapshot.riskMetrics.volatilityScore > normalVolatility * 3) {
        alerts.push({
          type: 'volatility_spike',
          severity: currentSnapshot.riskMetrics.volatilityScore > normalVolatility * 10 ? 'critical' :
                   currentSnapshot.riskMetrics.volatilityScore > normalVolatility * 6 ? 'high' : 'medium',
          data: {
            currentVolatility: currentSnapshot.riskMetrics.volatilityScore,
            normalVolatility,
            multiple: currentSnapshot.riskMetrics.volatilityScore / normalVolatility
          },
          recommendation: 'High market volatility detected - reduce position sizes'
        });
      }

      // 3. Detect unusual concentration risk
      if (currentSnapshot.riskMetrics.maxConcentration > 0.5) { // 50% in single position
        alerts.push({
          type: 'liquidity_drop',
          severity: currentSnapshot.riskMetrics.maxConcentration > 0.8 ? 'critical' : 'high',
          data: {
            concentration: currentSnapshot.riskMetrics.maxConcentration,
            riskScore: currentSnapshot.riskMetrics.riskScore
          },
          recommendation: `High concentration risk: ${(currentSnapshot.riskMetrics.maxConcentration * 100).toFixed(1)}% in single position`
        });
      }

      // 4. Detect drawdown anomalies
      if (currentSnapshot.riskMetrics.drawdown > 0.15) { // 15% drawdown
        alerts.push({
          type: 'price_spike',
          severity: currentSnapshot.riskMetrics.drawdown > 0.25 ? 'critical' : 'high',
          data: {
            drawdown: currentSnapshot.riskMetrics.drawdown,
            portfolioValue: currentSnapshot.totalValue
          },
          recommendation: `Significant drawdown detected: ${(currentSnapshot.riskMetrics.drawdown * 100).toFixed(2)}%`
        });
      }

      // 5. Detect low liquidity conditions (mock implementation based on risk score)
      if (currentSnapshot.riskMetrics.liquidityScore < 30) {
        alerts.push({
          type: 'liquidity_drop',
          severity: currentSnapshot.riskMetrics.liquidityScore < 10 ? 'critical' : 'medium',
          data: {
            liquidityScore: currentSnapshot.riskMetrics.liquidityScore
          },
          recommendation: 'Low liquidity conditions detected - avoid large trades'
        });
      }

      if (alerts.length > 0) {
        logger.warn(`Detected ${alerts.length} market anomalies:`, alerts.map(a => `${a.type} (${a.severity})`));
      }

      return alerts;

    } catch (error) {
      logger.error('Error detecting market anomalies:', error);
      return alerts;
    }
  }

  /**
   * Calculate risk level from risk score
   */
  protected calculateRiskLevel(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
    if (riskScore >= this.RISK_THRESHOLDS.CRITICAL_RISK) return 'critical';
    if (riskScore >= this.RISK_THRESHOLDS.HIGH_RISK) return 'high';
    if (riskScore >= this.RISK_THRESHOLDS.MEDIUM_RISK) return 'medium';
    return 'low';
  }

  /**
   * Validate a trade before execution
   */
  async validateTrade(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    currentPortfolio: PortfolioSnapshot;
    marketConditions: any;
  }): Promise<{
    approved: boolean;
    reason?: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    adjustedAmount?: number;
  }> {
    try {
      // Check if trading should be halted
      const riskCheck = await this.performRiskCheck(params.currentPortfolio.positions[0]?.token || 'GALA');

      if (!riskCheck.shouldContinueTrading) {
        return {
          approved: false,
          reason: `Trading halted due to risk conditions: ${riskCheck.alerts.join(', ')}`,
          riskLevel: riskCheck.riskLevel
        };
      }

      // Check position size limits
      const newValue = params.amountIn;
      if (newValue > this.config.maxPositionSize) {
        const adjustedAmount = this.config.maxPositionSize * 0.8; // Use 80% of max
        return {
          approved: true,
          reason: 'Trade size reduced to comply with position limits',
          riskLevel: 'medium',
          adjustedAmount
        };
      }

      // Check concentration after trade
      const totalPortfolioValue = params.currentPortfolio.totalValue;
      const newConcentration = newValue / (totalPortfolioValue + newValue);

      if (newConcentration > 0.3) {
        return {
          approved: false,
          reason: `Trade would create excessive concentration: ${(newConcentration * 100).toFixed(2)}%`,
          riskLevel: 'high'
        };
      }

      return {
        approved: true,
        riskLevel: 'low'
      };

    } catch (error) {
      logger.error('Error validating trade:', error);
      return {
        approved: false,
        reason: 'Risk validation error',
        riskLevel: 'critical'
      };
    }
  }

  /**
   * Get current risk status
   */
  getRiskStatus(): {
    isMonitoring: boolean;
    latestSnapshot?: PortfolioSnapshot;
    riskConfig: RiskConfig;
    baselineValue: number;
    snapshotCount: number;
  } {
    return {
      isMonitoring: this.isMonitoring,
      latestSnapshot: this.portfolioSnapshots[this.portfolioSnapshots.length - 1],
      riskConfig: this.riskConfig,
      baselineValue: this.baselinePortfolioValue,
      snapshotCount: this.portfolioSnapshots.length
    };
  }

  /**
   * Update risk configuration
   */
  updateRiskConfig(newConfig: Partial<RiskConfig>): void {
    this.riskConfig = { ...this.riskConfig, ...newConfig };
    logger.info('Risk configuration updated:', this.riskConfig);
  }

  /**
   * Reset daily metrics (call at start of new trading day)
   */
  resetDailyMetrics(): void {
    const latestSnapshot = this.portfolioSnapshots[this.portfolioSnapshots.length - 1];
    if (latestSnapshot) {
      this.dailyStartValue = latestSnapshot.totalValue;
    }
    logger.info('Daily metrics reset');
  }
}