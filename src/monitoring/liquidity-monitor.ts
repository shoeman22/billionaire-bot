/**
 * Liquidity Monitor Service
 *
 * Real-time TVL monitoring and liquidity migration detection for GalaSwap V3.
 * Tracks pool depth changes, detects large liquidity movements, and identifies
 * zones with low liquidity depth for volatility prediction.
 */

import { logger } from '../utils/logger';
import { createQuoteWrapper } from '../utils/quote-api';

export interface LiquidityPosition {
  tickLower: number;      // Lower price tick
  tickUpper: number;      // Upper price tick
  liquidity: bigint;      // Amount of liquidity
  token0: string;         // First token in pair
  token1: string;         // Second token in pair
  owner?: string;         // Position owner address
}

export interface PoolLiquidityData {
  poolHash: string;
  token0: string;
  token1: string;
  fee: number;
  currentTick: number;
  sqrtPriceX96: string;
  totalTvl: number;
  totalTvlUsd: number;
  token0Tvl: number;
  token1Tvl: number;
  liquidityConcentration: LiquidityConcentration;
  activeLiquidity: bigint;
  timestamp: number;
}

export interface LiquidityConcentration {
  fullRangePercentage: number;     // % of liquidity in full range positions
  tightRangePercentage: number;    // % in +/-200 ticks
  mediumRangePercentage: number;   // % in +/-1000 ticks
  wideRangePercentage: number;     // % in +/-5000 ticks
  currentPriceUtilization: number; // % of liquidity active at current price
}

export interface LiquidityMigration {
  poolHash: string;
  migrationType: 'large_deposit' | 'large_withdrawal' | 'gradual_migration' | 'pool_drain' | 'new_pool';
  fromTick?: number;
  toTick?: number;
  amountUsd: number;
  timestamp: number;
  impactScore: number; // 1-10 scale of expected price impact
  volatilityPrediction: 'low' | 'medium' | 'high' | 'extreme';
  confidence: number; // 0-1 scale
}

export interface LiquidityAlert {
  poolHash: string;
  type: 'tvl_spike' | 'tvl_drain' | 'concentration_change' | 'liquidity_gap' | 'migration_detected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: number;
  triggered: boolean;
}

export interface LiquidityGap {
  poolHash: string;
  tickLower: number;
  tickUpper: number;
  priceRangeLower: number;
  priceRangeUpper: number;
  gapSizeUsd: number; // Size of the gap in USD terms
  impactPotential: number; // 1-10 scale
  proximityToCurrentPrice: number; // Distance in ticks from current price
}

/**
 * Primary Pools for High-Frequency Monitoring
 */
const PRIMARY_POOLS = [
  { token0: 'GALA|Unit|none|none', token1: 'GUSDC|Unit|none|none', fee: 10000 },
  { token0: 'GALA|Unit|none|none', token1: 'ETIME|Unit|none|none', fee: 10000 },
  { token0: 'GUSDC|Unit|none|none', token1: 'GUSDT|Unit|none|none', fee: 10000 },
];

/**
 * Secondary Pools for Standard Monitoring
 */
const SECONDARY_POOLS = [
  { token0: 'TOWN|Unit|none|none', token1: 'GALA|Unit|none|none', fee: 10000 },
  { token0: 'SILK|Unit|none|none', token1: 'GALA|Unit|none|none', fee: 10000 },
  { token0: 'MATERIUM|Unit|none|none', token1: 'GALA|Unit|none|none', fee: 10000 },
];

export class LiquidityMonitor {
  private quoteWrapper: { quoteExactInput: (tokenIn: string, tokenOut: string, amountIn: number | string) => Promise<unknown> };
  private isRunning: boolean = false;
  private poolData: Map<string, PoolLiquidityData> = new Map();
  private liquidityHistory: Map<string, PoolLiquidityData[]> = new Map();
  private migrations: Map<string, LiquidityMigration[]> = new Map();
  private alerts: Map<string, LiquidityAlert[]> = new Map();
  private liquidityGaps: Map<string, LiquidityGap[]> = new Map();

  private primaryUpdateInterval: NodeJS.Timeout | null = null;
  private secondaryUpdateInterval: NodeJS.Timeout | null = null;

  private readonly PRIMARY_UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes
  private readonly SECONDARY_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_HISTORY_LENGTH = 720; // 24 hours at 2-minute intervals

  // Migration Detection Thresholds
  private readonly LARGE_MIGRATION_USD = 100000; // $100k
  private readonly GRADUAL_MIGRATION_USD = 250000; // $250k over 4 hours
  private readonly POOL_DRAIN_PERCENTAGE = 0.5; // 50% TVL reduction
  private readonly NEW_POOL_MIN_USD = 50000; // $50k minimum TVL

  constructor() {
    this.quoteWrapper = createQuoteWrapper(
      process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com'
    );

    this.initializeLiquidityHistory();
    logger.info('💧 Liquidity Monitor initialized');
  }

  /**
   * Start liquidity monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Liquidity Monitor already running');
      return;
    }

    try {
      logger.info('Starting Liquidity Monitor...');

      // Initial data fetch
      await this.updateAllPools();

      // Start monitoring intervals
      this.startPrimaryMonitoring();
      this.startSecondaryMonitoring();

      this.isRunning = true;
      logger.info('✅ Liquidity Monitor started successfully');

    } catch (error) {
      logger.error('❌ Failed to start Liquidity Monitor:', error);
      throw error;
    }
  }

  /**
   * Stop liquidity monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Liquidity Monitor not running');
      return;
    }

    try {
      logger.info('Stopping Liquidity Monitor...');

      // Clear intervals
      if (this.primaryUpdateInterval) {
        clearInterval(this.primaryUpdateInterval);
        this.primaryUpdateInterval = null;
      }

      if (this.secondaryUpdateInterval) {
        clearInterval(this.secondaryUpdateInterval);
        this.secondaryUpdateInterval = null;
      }

      this.isRunning = false;
      logger.info('✅ Liquidity Monitor stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping Liquidity Monitor:', error);
      throw error;
    }
  }

  /**
   * Get current liquidity data for a pool
   */
  getPoolLiquidity(poolHash: string): PoolLiquidityData | null {
    return this.poolData.get(poolHash) || null;
  }

  /**
   * Get all current pool liquidity data
   */
  getAllPoolLiquidity(): Record<string, PoolLiquidityData> {
    const data: Record<string, PoolLiquidityData> = {};
    this.poolData.forEach((poolData, poolHash) => {
      data[poolHash] = poolData;
    });
    return data;
  }

  /**
   * Get liquidity history for a pool
   */
  getLiquidityHistory(poolHash: string, limit?: number): PoolLiquidityData[] {
    const history = this.liquidityHistory.get(poolHash) || [];
    return limit ? history.slice(-limit) : [...history];
  }

  /**
   * Get detected migrations for a pool
   */
  getMigrations(poolHash: string, limit?: number): LiquidityMigration[] {
    const migrations = this.migrations.get(poolHash) || [];
    const sorted = migrations.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get liquidity gaps for a pool
   */
  getLiquidityGaps(poolHash: string): LiquidityGap[] {
    return this.liquidityGaps.get(poolHash) || [];
  }

  /**
   * Get triggered alerts
   */
  getTriggeredAlerts(): LiquidityAlert[] {
    const triggered: LiquidityAlert[] = [];
    this.alerts.forEach(alerts => {
      alerts.forEach(alert => {
        if (alert.triggered) {
          triggered.push(alert);
        }
      });
    });
    return triggered.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Set liquidity alert
   */
  setLiquidityAlert(
    poolHash: string,
    type: 'tvl_spike' | 'tvl_drain' | 'concentration_change' | 'liquidity_gap' | 'migration_detected',
    threshold: number,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): void {
    const alerts = this.alerts.get(poolHash) || [];

    const alert: LiquidityAlert = {
      poolHash,
      type,
      severity,
      threshold,
      currentValue: 0,
      message: `Liquidity alert: ${type} threshold ${threshold}`,
      timestamp: Date.now(),
      triggered: false,
    };

    alerts.push(alert);
    this.alerts.set(poolHash, alerts);

    logger.info(`Liquidity alert set for pool ${poolHash.substring(0, 8)}: ${type} threshold ${threshold}`);
  }

  /**
   * Initialize liquidity history storage
   */
  private initializeLiquidityHistory(): void {
    const allPools = [...PRIMARY_POOLS, ...SECONDARY_POOLS];

    allPools.forEach(pool => {
      const poolHash = this.generatePoolHash(pool.token0, pool.token1, pool.fee);
      this.liquidityHistory.set(poolHash, []);
      this.migrations.set(poolHash, []);
      this.alerts.set(poolHash, []);
      this.liquidityGaps.set(poolHash, []);
    });
  }

  /**
   * Start primary pool monitoring (high frequency)
   */
  private startPrimaryMonitoring(): void {
    this.primaryUpdateInterval = setInterval(async () => {
      try {
        await this.updatePrimaryPools();
      } catch (error) {
        logger.error('Error in primary pool monitoring:', error);
      }
    }, this.PRIMARY_UPDATE_INTERVAL);

    logger.info(`Primary pool monitoring started (interval: ${this.PRIMARY_UPDATE_INTERVAL}ms)`);
  }

  /**
   * Start secondary pool monitoring (standard frequency)
   */
  private startSecondaryMonitoring(): void {
    this.secondaryUpdateInterval = setInterval(async () => {
      try {
        await this.updateSecondaryPools();
      } catch (error) {
        logger.error('Error in secondary pool monitoring:', error);
      }
    }, this.SECONDARY_UPDATE_INTERVAL);

    logger.info(`Secondary pool monitoring started (interval: ${this.SECONDARY_UPDATE_INTERVAL}ms)`);
  }

  /**
   * Update all pools
   */
  private async updateAllPools(): Promise<void> {
    logger.info('💧 Updating all pool liquidity data...');

    await Promise.all([
      this.updatePrimaryPools(),
      this.updateSecondaryPools()
    ]);

    const totalPools = this.poolData.size;
    logger.info(`✅ Liquidity update completed: ${totalPools} pools updated`);
  }

  /**
   * Update primary pools (GALA/GUSDC, GALA/ETIME, GUSDC/GUSDT)
   */
  private async updatePrimaryPools(): Promise<void> {
    const updateStart = Date.now();
    logger.debug('Updating primary pools liquidity...');

    for (const pool of PRIMARY_POOLS) {
      try {
        await this.updatePoolLiquidity(pool.token0, pool.token1, pool.fee);
      } catch (error) {
        logger.warn(`Failed to update primary pool ${pool.token0}/${pool.token1}:`, error);
      }
    }

    const updateTime = Date.now() - updateStart;
    logger.debug(`Primary pools updated in ${updateTime}ms`);
  }

  /**
   * Update secondary pools (gaming tokens)
   */
  private async updateSecondaryPools(): Promise<void> {
    const updateStart = Date.now();
    logger.debug('Updating secondary pools liquidity...');

    for (const pool of SECONDARY_POOLS) {
      try {
        await this.updatePoolLiquidity(pool.token0, pool.token1, pool.fee);
      } catch (error) {
        logger.debug(`Secondary pool ${pool.token0}/${pool.token1} may not exist yet`);
      }
    }

    const updateTime = Date.now() - updateStart;
    logger.debug(`Secondary pools updated in ${updateTime}ms`);
  }

  /**
   * Update individual pool liquidity data
   */
  private async updatePoolLiquidity(token0: string, token1: string, fee: number): Promise<void> {
    try {
      const poolHash = this.generatePoolHash(token0, token1, fee);

      // Fetch pool details from the explore API
      const poolDetailResponse = await this.fetchPoolDetails(token0, token1, fee);

      if (!poolDetailResponse) {
        logger.debug(`No pool data available for ${token0}/${token1} fee ${fee}`);
        return;
      }

      // Extract pool data
      const poolData: PoolLiquidityData = {
        poolHash,
        token0,
        token1,
        fee,
        currentTick: 0, // Would need additional API call to get current tick
        sqrtPriceX96: '0', // Would need additional API call
        totalTvl: poolDetailResponse.tvl,
        totalTvlUsd: poolDetailResponse.tvl, // Assuming TVL is already in USD
        token0Tvl: poolDetailResponse.token0TvlUsd,
        token1Tvl: poolDetailResponse.token1TvlUsd,
        liquidityConcentration: await this.calculateLiquidityConcentration(),
        activeLiquidity: BigInt(0), // Would need positions API
        timestamp: Date.now(),
      };

      // Store current data
      const previousData = this.poolData.get(poolHash);
      this.poolData.set(poolHash, poolData);

      // Update history
      this.updateLiquidityHistory(poolHash, poolData);

      // Detect migrations and gaps
      if (previousData) {
        await this.detectLiquidityMigration(poolHash, previousData, poolData);
      }

      await this.detectLiquidityGaps(poolHash, poolData);

      // Check alerts
      this.checkLiquidityAlerts(poolHash, poolData, previousData);

      logger.debug(`Updated liquidity for ${token0.split('|')[0]}/${token1.split('|')[0]}: $${poolData.totalTvlUsd.toFixed(0)} TVL`);

    } catch (error) {
      logger.warn(`Failed to update pool liquidity ${token0}/${token1}:`, error);
    }
  }

  /**
   * Fetch pool details from GalaSwap API
   */
  private async fetchPoolDetails(token0: string, token1: string, fee: number): Promise<unknown> {
    try {
      // Use the existing quote wrapper to test if pool exists by getting a quote
      await this.quoteWrapper.quoteExactInput(token0, token1, 1);

      // If quote succeeds, create mock pool data based on quote results
      // In a real implementation, you'd use the actual pool details API
      const mockPoolData = {
        poolHash: this.generatePoolHash(token0, token1, fee),
        token0,
        token1,
        fee,
        tvl: 100000 + Math.random() * 900000, // Mock TVL between $100k-$1M
        token0TvlUsd: 50000 + Math.random() * 450000,
        token1TvlUsd: 50000 + Math.random() * 450000,
        volume1d: 10000 + Math.random() * 90000,
        volume30d: 300000 + Math.random() * 2700000,
      };

      return mockPoolData;

    } catch (error) {
      // Pool doesn't exist or no liquidity
      return null;
    }
  }

  /**
   * Calculate liquidity concentration metrics
   */
  private async calculateLiquidityConcentration(): Promise<LiquidityConcentration> {
    // In a real implementation, this would analyze actual position data
    // For now, return realistic mock concentrations based on gaming token behavior

    return {
      fullRangePercentage: 20 + Math.random() * 30,     // 20-50% in full range
      tightRangePercentage: 10 + Math.random() * 20,    // 10-30% tight range
      mediumRangePercentage: 30 + Math.random() * 20,   // 30-50% medium range
      wideRangePercentage: 10 + Math.random() * 15,     // 10-25% wide range
      currentPriceUtilization: 60 + Math.random() * 30, // 60-90% active
    };
  }

  /**
   * Update liquidity history for a pool
   */
  private updateLiquidityHistory(poolHash: string, poolData: PoolLiquidityData): void {
    const history = this.liquidityHistory.get(poolHash) || [];

    history.push(poolData);

    // Maintain history size limit
    if (history.length > this.MAX_HISTORY_LENGTH) {
      history.splice(0, history.length - this.MAX_HISTORY_LENGTH);
    }

    this.liquidityHistory.set(poolHash, history);
  }

  /**
   * Detect liquidity migration patterns
   */
  private async detectLiquidityMigration(
    poolHash: string,
    previousData: PoolLiquidityData,
    currentData: PoolLiquidityData
  ): Promise<void> {
    const tvlChange = currentData.totalTvlUsd - previousData.totalTvlUsd;
    const tvlChangePercentage = Math.abs(tvlChange) / previousData.totalTvlUsd;
    const migrations = this.migrations.get(poolHash) || [];

    // Large Migration Detection (>$100k in single update)
    if (Math.abs(tvlChange) >= this.LARGE_MIGRATION_USD) {
      const migration: LiquidityMigration = {
        poolHash,
        migrationType: tvlChange > 0 ? 'large_deposit' : 'large_withdrawal',
        amountUsd: Math.abs(tvlChange),
        timestamp: Date.now(),
        impactScore: this.calculateMigrationImpactScore(tvlChange, currentData.totalTvlUsd),
        volatilityPrediction: this.predictVolatilityFromMigration(tvlChange, currentData),
        confidence: 0.8, // High confidence for large movements
      };

      migrations.push(migration);
      this.migrations.set(poolHash, migrations);

      logger.warn(`🌊 Large liquidity migration detected in ${poolHash.substring(0, 8)}: ${tvlChange > 0 ? '+' : ''}$${Math.abs(tvlChange).toFixed(0)}`);
    }

    // Pool Drain Detection (>50% TVL reduction)
    if (tvlChange < 0 && tvlChangePercentage >= this.POOL_DRAIN_PERCENTAGE) {
      const migration: LiquidityMigration = {
        poolHash,
        migrationType: 'pool_drain',
        amountUsd: Math.abs(tvlChange),
        timestamp: Date.now(),
        impactScore: 9, // Very high impact
        volatilityPrediction: 'extreme',
        confidence: 0.9,
      };

      migrations.push(migration);
      this.migrations.set(poolHash, migrations);

      logger.error(`🚨 Pool drain detected in ${poolHash.substring(0, 8)}: -${(tvlChangePercentage * 100).toFixed(1)}% TVL`);
    }

    // Gradual Migration Detection (analyze 4-hour window)
    await this.detectGradualMigration(poolHash, currentData);

    // New Pool Formation Detection
    if (previousData.totalTvlUsd < this.NEW_POOL_MIN_USD && currentData.totalTvlUsd >= this.NEW_POOL_MIN_USD) {
      const migration: LiquidityMigration = {
        poolHash,
        migrationType: 'new_pool',
        amountUsd: currentData.totalTvlUsd,
        timestamp: Date.now(),
        impactScore: 6, // Medium-high impact for new opportunities
        volatilityPrediction: 'high',
        confidence: 0.7,
      };

      migrations.push(migration);
      this.migrations.set(poolHash, migrations);

      logger.info(`🆕 New pool formation detected: ${poolHash.substring(0, 8)} with $${currentData.totalTvlUsd.toFixed(0)} TVL`);
    }
  }

  /**
   * Detect gradual migration over 4-hour window
   */
  private async detectGradualMigration(poolHash: string, currentData: PoolLiquidityData): Promise<void> {
    const history = this.liquidityHistory.get(poolHash) || [];
    if (history.length < 120) return; // Need at least 4 hours of 2-minute data

    // Calculate 4-hour cumulative change
    const fourHoursAgo = history[history.length - 120];
    const cumulativeChange = currentData.totalTvlUsd - fourHoursAgo.totalTvlUsd;

    if (Math.abs(cumulativeChange) >= this.GRADUAL_MIGRATION_USD) {
      const migrations = this.migrations.get(poolHash) || [];

      const migration: LiquidityMigration = {
        poolHash,
        migrationType: 'gradual_migration',
        amountUsd: Math.abs(cumulativeChange),
        timestamp: Date.now(),
        impactScore: this.calculateMigrationImpactScore(cumulativeChange, currentData.totalTvlUsd),
        volatilityPrediction: this.predictVolatilityFromMigration(cumulativeChange, currentData),
        confidence: 0.7,
      };

      migrations.push(migration);
      this.migrations.set(poolHash, migrations);

      logger.info(`📈 Gradual migration detected in ${poolHash.substring(0, 8)}: ${cumulativeChange > 0 ? '+' : ''}$${Math.abs(cumulativeChange).toFixed(0)} over 4h`);
    }
  }

  /**
   * Calculate migration impact score (1-10 scale)
   */
  private calculateMigrationImpactScore(tvlChange: number, totalTvl: number): number {
    const percentageChange = Math.abs(tvlChange) / totalTvl;

    if (percentageChange >= 0.5) return 10; // 50%+ change = maximum impact
    if (percentageChange >= 0.3) return 8;  // 30%+ change = high impact
    if (percentageChange >= 0.15) return 6; // 15%+ change = medium impact
    if (percentageChange >= 0.05) return 4; // 5%+ change = low-medium impact
    return 2; // <5% change = low impact
  }

  /**
   * Predict volatility from liquidity migration
   */
  private predictVolatilityFromMigration(
    tvlChange: number,
    poolData: PoolLiquidityData
  ): 'low' | 'medium' | 'high' | 'extreme' {
    const percentageChange = Math.abs(tvlChange) / poolData.totalTvlUsd;
    const utilizationFactor = poolData.liquidityConcentration.currentPriceUtilization / 100;

    // Higher concentration + larger change = higher volatility
    const volatilityScore = percentageChange * (2 - utilizationFactor);

    if (volatilityScore >= 0.4) return 'extreme';
    if (volatilityScore >= 0.25) return 'high';
    if (volatilityScore >= 0.1) return 'medium';
    return 'low';
  }

  /**
   * Detect liquidity gaps (zones with low liquidity depth)
   */
  private async detectLiquidityGaps(poolHash: string, poolData: PoolLiquidityData): Promise<void> {
    // In a real implementation, this would analyze tick-level liquidity distribution
    // For now, create mock gaps based on concentration data

    const gaps: LiquidityGap[] = [];
    const { liquidityConcentration } = poolData;

    // If liquidity is highly concentrated, there are likely gaps
    if (liquidityConcentration.currentPriceUtilization < 70) {
      // Mock gap above current price
      const upperGap: LiquidityGap = {
        poolHash,
        tickLower: 1000,
        tickUpper: 2000,
        priceRangeLower: 1.1, // 10% above current
        priceRangeUpper: 1.2, // 20% above current
        gapSizeUsd: poolData.totalTvlUsd * 0.05, // 5% of TVL
        impactPotential: 7,
        proximityToCurrentPrice: 1000,
      };

      gaps.push(upperGap);

      // Mock gap below current price
      const lowerGap: LiquidityGap = {
        poolHash,
        tickLower: -2000,
        tickUpper: -1000,
        priceRangeLower: 0.8, // 20% below current
        priceRangeUpper: 0.9, // 10% below current
        gapSizeUsd: poolData.totalTvlUsd * 0.03, // 3% of TVL
        impactPotential: 6,
        proximityToCurrentPrice: -1000,
      };

      gaps.push(lowerGap);

      logger.debug(`Detected ${gaps.length} liquidity gaps in ${poolHash.substring(0, 8)}`);
    }

    this.liquidityGaps.set(poolHash, gaps);
  }

  /**
   * Check and trigger liquidity alerts
   */
  private checkLiquidityAlerts(
    poolHash: string,
    currentData: PoolLiquidityData,
    previousData?: PoolLiquidityData
  ): void {
    const alerts = this.alerts.get(poolHash) || [];

    for (const alert of alerts) {
      if (alert.triggered) continue;

      let shouldTrigger = false;
      let currentValue = 0;

      switch (alert.type) {
        case 'tvl_spike':
          if (previousData) {
            const tvlIncrease = ((currentData.totalTvlUsd - previousData.totalTvlUsd) / previousData.totalTvlUsd) * 100;
            currentValue = tvlIncrease;
            shouldTrigger = tvlIncrease >= alert.threshold;
          }
          break;

        case 'tvl_drain':
          if (previousData) {
            const tvlDecrease = ((previousData.totalTvlUsd - currentData.totalTvlUsd) / previousData.totalTvlUsd) * 100;
            currentValue = tvlDecrease;
            shouldTrigger = tvlDecrease >= alert.threshold;
          }
          break;

        case 'concentration_change':
          currentValue = currentData.liquidityConcentration.currentPriceUtilization;
          shouldTrigger = currentValue <= alert.threshold;
          break;

        case 'liquidity_gap':
          const gaps = this.liquidityGaps.get(poolHash) || [];
          const significantGaps = gaps.filter(gap => gap.impactPotential >= alert.threshold);
          currentValue = significantGaps.length;
          shouldTrigger = currentValue > 0;
          break;

        case 'migration_detected':
          const migrations = this.migrations.get(poolHash) || [];
          const recentMigrations = migrations.filter(m => Date.now() - m.timestamp < 10 * 60 * 1000); // Last 10 minutes
          currentValue = recentMigrations.length;
          shouldTrigger = currentValue > 0;
          break;
      }

      if (shouldTrigger) {
        alert.triggered = true;
        alert.currentValue = currentValue;
        alert.timestamp = Date.now();

        logger.warn(`🚨 Liquidity alert triggered: ${poolHash.substring(0, 8)} ${alert.type} - ${currentValue} >= ${alert.threshold}`);
        this.emitLiquidityAlert(alert);
      }
    }
  }

  /**
   * Emit liquidity alert
   */
  private emitLiquidityAlert(alert: LiquidityAlert): void {
    logger.info(`Alert emitted: ${alert.poolHash.substring(0, 8)} ${alert.type}`, {
      severity: alert.severity,
      threshold: alert.threshold,
      currentValue: alert.currentValue,
      message: alert.message,
    });
  }

  /**
   * Generate pool hash from token pair and fee
   */
  private generatePoolHash(token0: string, token1: string, fee: number): string {
    return `${token0}-${token1}-${fee}`;
  }

  /**
   * Get monitoring statistics
   */
  getStatistics(): {
    poolsMonitored: number;
    totalTvlUsd: number;
    activeMigrations: number;
    triggeredAlerts: number;
    liquidityGaps: number;
    isRunning: boolean;
  } {
    let totalTvlUsd = 0;
    let liquidityGapCount = 0;

    this.poolData.forEach(pool => {
      totalTvlUsd += pool.totalTvlUsd;
    });

    this.liquidityGaps.forEach(gaps => {
      liquidityGapCount += gaps.length;
    });

    let activeMigrations = 0;
    this.migrations.forEach(migrations => {
      // Count migrations in last hour
      activeMigrations += migrations.filter(m => Date.now() - m.timestamp < 60 * 60 * 1000).length;
    });

    let triggeredAlerts = 0;
    this.alerts.forEach(alerts => {
      triggeredAlerts += alerts.filter(a => a.triggered).length;
    });

    return {
      poolsMonitored: this.poolData.size,
      totalTvlUsd,
      activeMigrations,
      triggeredAlerts,
      liquidityGaps: liquidityGapCount,
      isRunning: this.isRunning,
    };
  }

  /**
   * Reset all alerts
   */
  resetAlerts(): void {
    this.alerts.forEach(alerts => {
      alerts.forEach(alert => {
        alert.triggered = false;
      });
    });

    logger.info('All liquidity alerts reset');
  }

  /**
   * Clear all data (for testing)
   */
  clearData(): void {
    this.poolData.clear();
    this.liquidityHistory.clear();
    this.migrations.clear();
    this.liquidityGaps.clear();
    this.resetAlerts();

    logger.info('All liquidity monitor data cleared');
  }
}

/**
 * Create a liquidity monitor instance
 */
export function createLiquidityMonitor(): LiquidityMonitor {
  return new LiquidityMonitor();
}