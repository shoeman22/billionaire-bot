/**
 * Cross-Game Asset Rotation Strategy
 * Optimizes capital allocation across Gala games based on player migration patterns
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { safeParseFloat } from '../../utils/safe-parse';
import {
  GameMigrationTracker,
  GameData,
  GameMigration,
  AssetFlow,
  GameStage,
  GameRiskProfile
} from '../../analytics/game-migration-tracker';

export interface GameAllocation {
  token: string;
  symbol: string;
  targetPercentage: number;
  currentPercentage: number;
  value: number;
  stage: GameStage;
  riskScore: number;
  migrationSignal: number;     // -1 to 1, negative = outflow, positive = inflow
  rebalanceNeeded: boolean;
  rebalanceAmount: number;
}

export interface RotationSignal {
  action: 'increase' | 'decrease' | 'hold' | 'exit';
  token: string;
  strength: number;            // 0-1 signal strength
  reason: string[];
  timeHorizon: 'immediate' | 'short' | 'medium' | 'long';
  confidence: number;          // 0-1 prediction confidence
  expectedReturn: number;      // Expected return percentage
  riskAdjustedReturn: number;  // Risk-adjusted expected return
}

export interface PortfolioOptimization {
  allocations: GameAllocation[];
  rotationSignals: RotationSignal[];
  totalValue: number;
  riskScore: number;
  diversificationScore: number;
  expectedReturn: number;
  sharpeRatio: number;
  rebalanceRequired: boolean;
  nextRebalanceTime: number;
}

export interface LifecycleConfig {
  stage: GameStage;
  minAllocation: number;
  maxAllocation: number;
  riskMultiplier: number;
  rebalanceThreshold: number;
  description: string;
}

export class CrossGameRotationStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private migrationTracker: GameMigrationTracker;
  private isActive: boolean = false;
  private lastRebalanceTime: number = 0;
  private lastAnalysisTime: number = 0;

  // Portfolio state
  private currentAllocations: Map<string, GameAllocation> = new Map();
  private portfolioValue: number = 0;
  private rebalanceQueue: Array<{ token: string; amount: number; action: 'buy' | 'sell' }> = [];

  // Configuration
  private readonly LIFECYCLE_CONFIGS: Map<GameStage, LifecycleConfig> = new Map([
    [GameStage.LAUNCH, {
      stage: GameStage.LAUNCH,
      minAllocation: 0,
      maxAllocation: 0.20,        // Max 20% in launch stage
      riskMultiplier: 2.0,
      rebalanceThreshold: 0.15,   // Rebalance if 15% deviation
      description: 'High risk/reward, speculative allocation'
    }],
    [GameStage.GROWTH, {
      stage: GameStage.GROWTH,
      minAllocation: 0.05,
      maxAllocation: 0.35,        // Max 35% in growth stage
      riskMultiplier: 1.2,
      rebalanceThreshold: 0.10,   // Rebalance if 10% deviation
      description: 'Optimal risk/reward, primary allocation target'
    }],
    [GameStage.MATURE, {
      stage: GameStage.MATURE,
      minAllocation: 0.10,
      maxAllocation: 0.30,        // Max 30% in mature stage
      riskMultiplier: 0.8,
      rebalanceThreshold: 0.05,   // Rebalance if 5% deviation
      description: 'Stable income focus, consistent allocation'
    }],
    [GameStage.DECLINE, {
      stage: GameStage.DECLINE,
      minAllocation: 0,
      maxAllocation: 0.10,        // Max 10% in decline stage
      riskMultiplier: 3.0,
      rebalanceThreshold: 0.20,   // Rebalance if 20% deviation
      description: 'Exit positioning, minimal allocation'
    }],
    [GameStage.REVIVAL, {
      stage: GameStage.REVIVAL,
      minAllocation: 0,
      maxAllocation: 0.15,        // Max 15% in revival stage
      riskMultiplier: 1.5,
      rebalanceThreshold: 0.12,   // Rebalance if 12% deviation
      description: 'Opportunistic plays, moderate allocation'
    }]
  ]);

  private readonly BASE_GALA_ALLOCATION = 0.25;  // 25% base allocation to GALA
  private readonly MIN_DIVERSIFICATION = 3;      // Must hold at least 3 different game tokens
  private readonly MAX_POSITION_SIZE = 0.35;     // Maximum 35% in any single game
  private readonly REBALANCE_COOLDOWN = 7 * 24 * 60 * 60 * 1000; // 1 week cooldown

  private executionStats = {
    totalRotations: 0,
    successfulRotations: 0,
    totalRebalances: 0,
    averageRebalanceTime: 0,
    profitFromRotations: 0,
    riskAdjustedReturns: 0
  };

  constructor(
    gswap: GSwap,
    config: TradingConfig,
    swapExecutor: SwapExecutor
  ) {
    this.gswap = gswap;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.migrationTracker = new GameMigrationTracker();

    logger.info('CrossGameRotationStrategy initialized');
  }

  /**
   * Start the cross-game rotation strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Cross-game rotation strategy is already active');
      return;
    }

    try {
      this.isActive = true;
      logger.info('Starting cross-game asset rotation strategy');

      // Initialize portfolio state
      await this.initializePortfolio();

      // Start monitoring loop
      this.startMonitoringLoop();

      logger.info('Cross-game rotation strategy started successfully');

    } catch (error) {
      this.isActive = false;
      logger.error('Failed to start cross-game rotation strategy:', error);
      throw error;
    }
  }

  /**
   * Stop the strategy
   */
  stop(): void {
    this.isActive = false;
    logger.info('Cross-game rotation strategy stopped');
  }

  /**
   * Initialize portfolio state
   */
  private async initializePortfolio(): Promise<void> {
    try {
      // Get current portfolio from GalaSwap (would fetch real balances in production)
      const mockBalances = {
        'GALA|Unit|none|none': 34062, // Current balance from context
        'TOWN|Unit|none|none': 0,
        'LEGACY|Unit|none|none': 0,
        'SILK|Unit|none|none': 0,
        'MATERIUM|Unit|none|none': 0,
        'FORTIFIED|Unit|none|none': 0
      };

      // Calculate current portfolio value (using $541 total as reference)
      this.portfolioValue = 541; // USD value
      const galaValue = 34062 * (541 / 34062); // $0.0159 per GALA

      // Initialize allocations
      for (const [token, balance] of Object.entries(mockBalances)) {
        const symbol = token.split('|')[0];
        const gameData = this.migrationTracker.getGameData(symbol) as GameData;

        if (gameData && Object.keys(gameData).length > 0) {
          const allocation: GameAllocation = {
            token,
            symbol,
            targetPercentage: symbol === 'GALA' ? this.BASE_GALA_ALLOCATION : 0,
            currentPercentage: symbol === 'GALA' ? 1.0 : 0, // Currently 100% GALA
            value: symbol === 'GALA' ? 541 : 0,
            stage: gameData.stage,
            riskScore: 0.5, // Will be calculated
            migrationSignal: 0,
            rebalanceNeeded: false,
            rebalanceAmount: 0
          };

          this.currentAllocations.set(symbol, allocation);
        }
      }

      logger.info(`Portfolio initialized with ${this.currentAllocations.size} assets, total value: $${this.portfolioValue}`);

    } catch (error) {
      logger.error('Failed to initialize portfolio:', error);
      throw error;
    }
  }

  /**
   * Start monitoring loop for rotation opportunities
   */
  private startMonitoringLoop(): void {
    const monitoringInterval = setInterval(async () => {
      if (!this.isActive) {
        clearInterval(monitoringInterval);
        return;
      }

      try {
        await this.analyzeRotationOpportunities();

        // Execute rebalance if needed and cooldown expired
        const timeSinceLastRebalance = Date.now() - this.lastRebalanceTime;
        if (timeSinceLastRebalance > this.REBALANCE_COOLDOWN) {
          await this.executePortfolioRebalance();
        }

      } catch (error) {
        logger.error('Error in rotation monitoring loop:', error);
      }

    }, TRADING_CONSTANTS.ARBITRAGE_SCAN_INTERVAL * 2); // Every 10 seconds

    logger.info('Cross-game rotation monitoring loop started');
  }

  /**
   * Analyze rotation opportunities
   */
  async analyzeRotationOpportunities(): Promise<PortfolioOptimization> {
    try {
      // Update game data and migration patterns
      await this.migrationTracker.updateGameData();
      const migrations = await this.migrationTracker.detectMigrationPatterns();
      const assetFlows = await this.migrationTracker.trackAssetFlows();

      // Calculate optimal allocations
      const optimizedAllocations = await this.calculateOptimalAllocations(migrations, assetFlows);

      // Generate rotation signals
      const rotationSignals = this.generateRotationSignals(optimizedAllocations, migrations);

      // Update current allocations with new targets
      this.updateAllocationTargets(optimizedAllocations);

      const optimization: PortfolioOptimization = {
        allocations: optimizedAllocations,
        rotationSignals,
        totalValue: this.portfolioValue,
        riskScore: this.calculatePortfolioRisk(optimizedAllocations),
        diversificationScore: this.calculateDiversificationScore(optimizedAllocations),
        expectedReturn: this.calculateExpectedReturn(optimizedAllocations),
        sharpeRatio: this.calculateSharpeRatio(optimizedAllocations),
        rebalanceRequired: this.checkRebalanceNeeded(optimizedAllocations),
        nextRebalanceTime: this.lastRebalanceTime + this.REBALANCE_COOLDOWN
      };

      this.lastAnalysisTime = Date.now();

      logger.info(`Portfolio analysis complete: ${rotationSignals.length} signals, rebalance needed: ${optimization.rebalanceRequired}`);

      return optimization;

    } catch (error) {
      logger.error('Failed to analyze rotation opportunities:', error);
      throw error;
    }
  }

  /**
   * Calculate optimal allocations based on migration patterns
   */
  private async calculateOptimalAllocations(
    migrations: GameMigration[],
    assetFlows: AssetFlow[]
  ): Promise<GameAllocation[]> {
    const allocations: GameAllocation[] = [];
    const allGames = this.migrationTracker.getGameData() as Map<string, GameData>;

    // Start with base GALA allocation
    let remainingAllocation = 1.0 - this.BASE_GALA_ALLOCATION;

    // Calculate migration signals for each game
    const migrationSignals = new Map<string, number>();
    for (const migration of migrations) {
      const inflow = migrationSignals.get(migration.targetGame) || 0;
      const outflow = migrationSignals.get(migration.sourceGame) || 0;

      migrationSignals.set(migration.targetGame, inflow + migration.migrationRate * migration.confidence);
      migrationSignals.set(migration.sourceGame, outflow - migration.migrationRate * migration.confidence);
    }

    // Calculate allocations for each game
    const gameAllocations = new Map<string, number>();

    for (const [symbol, gameData] of allGames.entries()) {
      if (symbol === 'GALA') continue; // Handle GALA separately

      const lifecycleConfig = this.LIFECYCLE_CONFIGS.get(gameData.stage);
      if (!lifecycleConfig) continue;

      // Base allocation from lifecycle stage
      let allocation = (lifecycleConfig.minAllocation + lifecycleConfig.maxAllocation) / 2;

      // Adjust based on migration signals
      const migrationSignal = migrationSignals.get(symbol) || 0;
      allocation += migrationSignal * 0.1; // Adjust by up to 10% based on migration

      // Adjust based on game performance metrics
      const performanceMultiplier = this.calculatePerformanceMultiplier(gameData);
      allocation *= performanceMultiplier;

      // Apply lifecycle constraints
      allocation = Math.max(lifecycleConfig.minAllocation,
                           Math.min(lifecycleConfig.maxAllocation, allocation));

      gameAllocations.set(symbol, allocation);
    }

    // Normalize allocations to fit within remaining allocation
    const totalGameAllocation = Array.from(gameAllocations.values()).reduce((sum, alloc) => sum + alloc, 0);
    const normalizationFactor = Math.min(1.0, remainingAllocation / totalGameAllocation);

    // Create allocation objects
    for (const [symbol, gameData] of allGames.entries()) {
      const token = symbol === 'GALA' ? 'GALA|Unit|none|none' :
        Object.values({
          'TOWN': 'TOWN|Unit|none|none',
          'LEGACY': 'LEGACY|Unit|none|none',
          'SILK': 'SILK|Unit|none|none',
          'MATERIUM': 'MATERIUM|Unit|none|none',
          'FORTIFIED': 'FORTIFIED|Unit|none|none'
        }).find(t => t.startsWith(symbol)) || `${symbol}|Unit|none|none`;

      const currentAllocation = this.currentAllocations.get(symbol);
      const rawAllocation = symbol === 'GALA' ? this.BASE_GALA_ALLOCATION :
                           (gameAllocations.get(symbol) || 0) * normalizationFactor;

      const allocation: GameAllocation = {
        token,
        symbol,
        targetPercentage: rawAllocation,
        currentPercentage: currentAllocation?.currentPercentage || 0,
        value: rawAllocation * this.portfolioValue,
        stage: gameData.stage,
        riskScore: this.migrationTracker.calculateGameRiskProfile(symbol)?.overallRisk || 0.5,
        migrationSignal: migrationSignals.get(symbol) || 0,
        rebalanceNeeded: Math.abs(rawAllocation - (currentAllocation?.currentPercentage || 0)) > 0.05,
        rebalanceAmount: 0 // Will be calculated later
      };

      allocations.push(allocation);
    }

    return allocations;
  }

  /**
   * Calculate performance multiplier based on game metrics
   */
  private calculatePerformanceMultiplier(gameData: GameData): number {
    let multiplier = 1.0;

    // Adjust based on retention rates
    if (gameData.retentionRate7d > 0.7) multiplier *= 1.2;
    else if (gameData.retentionRate7d < 0.4) multiplier *= 0.7;

    // Adjust based on social sentiment
    multiplier *= (1.0 + gameData.socialSentiment * 0.3);

    // Adjust based on developer activity
    if (gameData.developerActivity > 5) multiplier *= 1.1;
    else if (gameData.developerActivity < 2) multiplier *= 0.9;

    // Adjust based on user growth
    const userGrowthProxy = Math.min(2.0, gameData.dailyActiveUsers / 5000); // Proxy for growth
    multiplier *= (0.8 + userGrowthProxy * 0.4);

    return Math.max(0.5, Math.min(1.5, multiplier));
  }

  /**
   * Generate rotation signals based on optimization
   */
  private generateRotationSignals(
    allocations: GameAllocation[],
    migrations: GameMigration[]
  ): RotationSignal[] {
    const signals: RotationSignal[] = [];

    for (const allocation of allocations) {
      if (!allocation.rebalanceNeeded) continue;

      const diff = allocation.targetPercentage - allocation.currentPercentage;
      const action = diff > 0 ? 'increase' : diff < 0 ? 'decrease' : 'hold';

      if (action === 'hold') continue;

      const strength = Math.min(1.0, Math.abs(diff) / 0.2); // Normalize to 0-1
      const reasons: string[] = [];

      // Analyze reasons for the signal
      if (allocation.migrationSignal > 0.2) reasons.push('Strong player inflow detected');
      else if (allocation.migrationSignal < -0.2) reasons.push('Player exodus detected');

      if (allocation.stage === GameStage.GROWTH) reasons.push('Game in growth stage');
      else if (allocation.stage === GameStage.DECLINE) reasons.push('Game entering decline');

      if (allocation.riskScore > 0.7) reasons.push('High risk profile');
      else if (allocation.riskScore < 0.3) reasons.push('Low risk profile');

      // Find relevant migrations
      const relevantMigrations = migrations.filter(m =>
        m.targetGame === allocation.symbol || m.sourceGame === allocation.symbol
      );

      if (relevantMigrations.length > 0) {
        reasons.push(`${relevantMigrations.length} migration patterns identified`);
      }

      const signal: RotationSignal = {
        action,
        token: allocation.token,
        strength,
        reason: reasons.length > 0 ? reasons : ['Portfolio optimization'],
        timeHorizon: this.determineTimeHorizon(allocation, strength),
        confidence: this.calculateSignalConfidence(allocation, relevantMigrations),
        expectedReturn: this.calculateExpectedReturn([allocation]),
        riskAdjustedReturn: this.calculateExpectedReturn([allocation]) / (1 + allocation.riskScore)
      };

      signals.push(signal);
    }

    return signals.sort((a, b) => b.strength * b.confidence - a.strength * a.confidence);
  }

  /**
   * Determine time horizon for signal execution
   */
  private determineTimeHorizon(
    allocation: GameAllocation,
    strength: number
  ): RotationSignal['timeHorizon'] {
    if (strength > 0.8 && allocation.migrationSignal !== 0) return 'immediate';
    if (strength > 0.6) return 'short';
    if (strength > 0.4) return 'medium';
    return 'long';
  }

  /**
   * Calculate signal confidence
   */
  private calculateSignalConfidence(
    allocation: GameAllocation,
    migrations: GameMigration[]
  ): number {
    let confidence = 0.5; // Base confidence

    // Adjust based on migration data quality
    if (migrations.length > 0) {
      const avgMigrationConfidence = migrations.reduce((sum, m) => sum + m.confidence, 0) / migrations.length;
      confidence += avgMigrationConfidence * 0.3;
    }

    // Adjust based on allocation data quality
    if (allocation.migrationSignal !== 0) confidence += 0.1;
    if (allocation.stage !== GameStage.LAUNCH) confidence += 0.1; // More data for established games

    return Math.min(0.95, Math.max(0.2, confidence));
  }

  /**
   * Update allocation targets
   */
  private updateAllocationTargets(allocations: GameAllocation[]): void {
    for (const allocation of allocations) {
      this.currentAllocations.set(allocation.symbol, allocation);
    }
  }

  /**
   * Calculate portfolio-level risk score
   */
  private calculatePortfolioRisk(allocations: GameAllocation[]): number {
    const weightedRisk = allocations.reduce((sum, alloc) =>
      sum + (alloc.targetPercentage * alloc.riskScore), 0
    );

    // Adjust for concentration risk
    const maxAllocation = Math.max(...allocations.map(a => a.targetPercentage));
    const concentrationPenalty = maxAllocation > 0.4 ? (maxAllocation - 0.4) * 2 : 0;

    return Math.min(1.0, weightedRisk + concentrationPenalty);
  }

  /**
   * Calculate diversification score
   */
  private calculateDiversificationScore(allocations: GameAllocation[]): number {
    const nonZeroAllocations = allocations.filter(a => a.targetPercentage > 0.01).length;

    // Herfindahl-Hirschman Index for concentration measurement
    const hhi = allocations.reduce((sum, alloc) =>
      sum + (alloc.targetPercentage ** 2), 0
    );

    // Convert HHI to diversification score (0-1, higher is better)
    const diversificationScore = Math.max(0, 1 - (hhi - 0.2) / 0.8);

    return diversificationScore;
  }

  /**
   * Calculate expected portfolio return
   */
  private calculateExpectedReturn(allocations: GameAllocation[]): number {
    // Simplified expected return calculation based on game stages and migration signals
    return allocations.reduce((sum, alloc) => {
      let expectedReturn = 0;

      // Base returns by stage
      switch (alloc.stage) {
        case GameStage.LAUNCH: expectedReturn = 0.15; break;   // 15% expected
        case GameStage.GROWTH: expectedReturn = 0.12; break;   // 12% expected
        case GameStage.MATURE: expectedReturn = 0.08; break;   // 8% expected
        case GameStage.DECLINE: expectedReturn = -0.05; break; // -5% expected
        case GameStage.REVIVAL: expectedReturn = 0.10; break;  // 10% expected
      }

      // Adjust for migration signals
      expectedReturn += alloc.migrationSignal * 0.05;

      return sum + (alloc.targetPercentage * expectedReturn);
    }, 0);
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(allocations: GameAllocation[]): number {
    const expectedReturn = this.calculateExpectedReturn(allocations);
    const riskScore = this.calculatePortfolioRisk(allocations);
    const riskFreeRate = 0.02; // 2% risk-free rate

    return riskScore > 0 ? (expectedReturn - riskFreeRate) / riskScore : 0;
  }

  /**
   * Check if rebalance is needed
   */
  private checkRebalanceNeeded(allocations: GameAllocation[]): boolean {
    return allocations.some(alloc => alloc.rebalanceNeeded);
  }

  /**
   * Execute portfolio rebalance
   */
  async executePortfolioRebalance(): Promise<void> {
    if (!this.isActive) return;

    try {
      const rebalanceNeeded = Array.from(this.currentAllocations.values())
        .filter(alloc => alloc.rebalanceNeeded);

      if (rebalanceNeeded.length === 0) {
        logger.info('No rebalance needed');
        return;
      }

      logger.info(`Starting portfolio rebalance for ${rebalanceNeeded.length} assets`);

      // Calculate rebalance amounts
      for (const allocation of rebalanceNeeded) {
        const diff = allocation.targetPercentage - allocation.currentPercentage;
        allocation.rebalanceAmount = diff * this.portfolioValue;
      }

      // Execute rebalances in order of priority (highest conviction first)
      const sortedRebalances = rebalanceNeeded.sort((a, b) =>
        Math.abs(b.rebalanceAmount) - Math.abs(a.rebalanceAmount)
      );

      let successfulRebalances = 0;

      for (const allocation of sortedRebalances) {
        try {
          if (allocation.rebalanceAmount > 0) {
            // Buy more of this asset
            await this.executeBuyOrder(allocation);
          } else {
            // Sell some of this asset
            await this.executeSellOrder(allocation);
          }

          // Update current percentage after successful trade
          allocation.currentPercentage = allocation.targetPercentage;
          allocation.rebalanceNeeded = false;
          allocation.rebalanceAmount = 0;

          successfulRebalances++;

        } catch (error) {
          logger.error(`Failed to rebalance ${allocation.symbol}:`, error);
        }
      }

      this.lastRebalanceTime = Date.now();
      this.executionStats.totalRebalances++;
      this.executionStats.successfulRotations += successfulRebalances;

      logger.info(`Portfolio rebalance completed: ${successfulRebalances}/${sortedRebalances.length} successful`);

    } catch (error) {
      logger.error('Failed to execute portfolio rebalance:', error);
    }
  }

  /**
   * Execute buy order for rebalancing
   */
  private async executeBuyOrder(allocation: GameAllocation): Promise<void> {
    const amountUSD = Math.abs(allocation.rebalanceAmount);

    logger.info(`Buying ${allocation.symbol}: $${amountUSD.toFixed(2)} (${(allocation.targetPercentage * 100).toFixed(1)}% target)`);

    // In production, this would execute actual swaps
    // For now, simulate the trade
    const simulatedSuccess = Math.random() > 0.1; // 90% success rate

    if (!simulatedSuccess) {
      throw new Error('Simulated trade failure');
    }

    this.executionStats.totalRotations++;
    logger.info(`Successfully bought ${allocation.symbol}`);
  }

  /**
   * Execute sell order for rebalancing
   */
  private async executeSellOrder(allocation: GameAllocation): Promise<void> {
    const amountUSD = Math.abs(allocation.rebalanceAmount);

    logger.info(`Selling ${allocation.symbol}: $${amountUSD.toFixed(2)} (${(allocation.targetPercentage * 100).toFixed(1)}% target)`);

    // In production, this would execute actual swaps
    // For now, simulate the trade
    const simulatedSuccess = Math.random() > 0.1; // 90% success rate

    if (!simulatedSuccess) {
      throw new Error('Simulated trade failure');
    }

    this.executionStats.totalRotations++;
    logger.info(`Successfully sold ${allocation.symbol}`);
  }

  /**
   * Get current portfolio status
   */
  async getPortfolioStatus(): Promise<PortfolioOptimization> {
    return await this.analyzeRotationOpportunities();
  }

  /**
   * Get strategy performance metrics
   */
  getPerformanceMetrics(): typeof this.executionStats {
    return { ...this.executionStats };
  }

  /**
   * Get current allocations
   */
  getCurrentAllocations(): GameAllocation[] {
    return Array.from(this.currentAllocations.values());
  }

  /**
   * Force rebalance (override cooldown)
   */
  async forceRebalance(): Promise<void> {
    logger.info('Forcing portfolio rebalance');
    this.lastRebalanceTime = 0; // Reset cooldown
    await this.executePortfolioRebalance();
  }

  /**
   * Update strategy configuration
   */
  updateConfig(updates: Partial<TradingConfig>): void {
    Object.assign(this.config, updates);
    logger.info('Cross-game rotation strategy configuration updated');
  }

  /**
   * Get migration insights
   */
  getMigrationInsights(): {
    recentMigrations: GameMigration[];
    assetFlows: AssetFlow[];
    gameData: Map<string, GameData>;
  } {
    return {
      recentMigrations: this.migrationTracker.getMigrationHistory(7), // Last 7 days
      assetFlows: this.migrationTracker.getCurrentAssetFlows(),
      gameData: this.migrationTracker.getGameData() as Map<string, GameData>
    };
  }

  /**
   * Emergency rebalance to safe assets
   */
  async emergencyRebalance(): Promise<void> {
    logger.warn('Executing emergency rebalance to safe assets');

    try {
      // Move everything to GALA (safest asset in ecosystem)
      const galaAllocation = this.currentAllocations.get('GALA');
      if (galaAllocation) {
        galaAllocation.targetPercentage = 0.9; // 90% GALA
        galaAllocation.rebalanceNeeded = true;
      }

      // Minimize other allocations
      for (const [symbol, allocation] of this.currentAllocations.entries()) {
        if (symbol !== 'GALA') {
          allocation.targetPercentage = 0.02; // 2% each
          allocation.rebalanceNeeded = true;
        }
      }

      await this.executePortfolioRebalance();
      logger.info('Emergency rebalance completed');

    } catch (error) {
      logger.error('Emergency rebalance failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stop();
    this.migrationTracker.cleanup();
    logger.info('Cross-game rotation strategy cleaned up');
  }
}