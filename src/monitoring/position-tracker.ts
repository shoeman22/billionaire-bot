/**
 * Position Tracker
 * Real-time monitoring and analytics for liquidity positions
 */

import { GSwapWrapper } from '../services/gswap-wrapper';
import { Position } from '../entities/Position';
import { getPositionRepository } from '../config/database';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { safeParseFloat } from '../utils/safe-parse';
import BigNumber from 'bignumber.js';
import { Repository } from 'typeorm';

export interface PositionUpdate {
  positionId: string;
  liquidity: string;
  inRange: boolean;
  currentPrice: number;
  uncollectedFees0: string;
  uncollectedFees1: string;
  valueUSD: number;
  priceChange24h: number;
  timestamp: number;
}

export interface PositionAlert {
  positionId: string;
  type: 'out_of_range' | 'high_fees' | 'impermanent_loss' | 'rebalance_needed' | 'low_utilization';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  timestamp: number;
  acknowledged: boolean;
}

export interface PositionMetrics {
  totalPositions: number;
  activePositions: number;
  totalValueUSD: number;
  totalFeesCollected: number;
  avgAPR: number;
  totalImpermanentLoss: number;
  positionsInRange: number;
  utilizationRate: number;
  profitablePositions: number;
  rebalanceAlerts: number;
}

export class PositionTracker {
  private gswap: GSwapWrapper;
  private positionRepo: Repository<Position> | null = null;
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private alerts: Map<string, PositionAlert[]> = new Map();
  private lastPrices: Map<string, number> = new Map();

  private readonly UPDATE_INTERVAL = TRADING_CONSTANTS.PRICE_UPDATE_INTERVAL;
  private readonly ALERT_COOLDOWN = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ALERTS_PER_POSITION = 10;

  constructor(gswap: GSwapWrapper) {
    this.gswap = gswap;
    logger.info('PositionTracker initialized');
  }

  /**
   * Start position tracking
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('PositionTracker already running');
      return;
    }

    try {
      logger.info('Starting PositionTracker...');

      // Initialize database connection
      this.positionRepo = await getPositionRepository();

      // Initial position sync
      await this.syncAllPositions();

      // Start monitoring loop
      this.startMonitoring();

      this.isRunning = true;
      logger.info('✅ PositionTracker started successfully');

    } catch (error) {
      logger.error('❌ Failed to start PositionTracker:', error);
      throw error;
    }
  }

  /**
   * Stop position tracking
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('PositionTracker not running');
      return;
    }

    try {
      logger.info('Stopping PositionTracker...');

      // Stop monitoring
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      this.isRunning = false;
      logger.info('✅ PositionTracker stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping PositionTracker:', error);
      throw error;
    }
  }

  /**
   * Track a new position
   */
  async trackPosition(position: Position): Promise<void> {
    if (!this.positionRepo) {
      throw new Error('Database not initialized');
    }

    try {
      logger.info(`Adding position to tracking: ${position.id}`);

      // Calculate initial metrics
      await this.updatePositionMetrics(position);

      // Save to database
      await this.positionRepo.save(position);

      logger.info(`✅ Position tracking started: ${position.id}`);

    } catch (error) {
      logger.error(`Failed to track position ${position.id}:`, error);
      throw error;
    }
  }

  /**
   * Stop tracking a position
   */
  async untrackPosition(positionId: string): Promise<void> {
    if (!this.positionRepo) {
      throw new Error('Database not initialized');
    }

    try {
      logger.info(`Removing position from tracking: ${positionId}`);

      // Mark as inactive
      await this.positionRepo.update(positionId, { isActive: false });

      // Remove alerts
      this.alerts.delete(positionId);

      logger.info(`✅ Position tracking stopped: ${positionId}`);

    } catch (error) {
      logger.error(`Failed to untrack position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Get all tracked positions
   */
  async getTrackedPositions(): Promise<Position[]> {
    if (!this.positionRepo) {
      throw new Error('Database not initialized');
    }

    return await this.positionRepo.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Get position by ID
   */
  async getPosition(positionId: string): Promise<Position | null> {
    if (!this.positionRepo) {
      throw new Error('Database not initialized');
    }

    return await this.positionRepo.findOne({
      where: { id: positionId }
    });
  }

  /**
   * Get positions by wallet
   */
  async getPositionsByWallet(walletAddress: string): Promise<Position[]> {
    if (!this.positionRepo) {
      throw new Error('Database not initialized');
    }

    return await this.positionRepo.find({
      where: { walletAddress, isActive: true },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Get position alerts
   */
  getPositionAlerts(positionId?: string): PositionAlert[] {
    if (positionId) {
      return this.alerts.get(positionId) || [];
    }

    const allAlerts: PositionAlert[] = [];
    this.alerts.forEach(alerts => allAlerts.push(...alerts));
    return allAlerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(positionId: string, alertIndex: number): void {
    const positionAlerts = this.alerts.get(positionId);
    if (positionAlerts && positionAlerts[alertIndex]) {
      positionAlerts[alertIndex].acknowledged = true;
      logger.info(`Alert acknowledged: ${positionId}[${alertIndex}]`);
    }
  }

  /**
   * Get overall position metrics
   */
  async getPositionMetrics(): Promise<PositionMetrics> {
    if (!this.positionRepo) {
      throw new Error('Database not initialized');
    }

    try {
      const positions = await this.getTrackedPositions();

      const metrics: PositionMetrics = {
        totalPositions: positions.length,
        activePositions: positions.filter(p => new BigNumber(p.liquidity).gt(0)).length,
        totalValueUSD: positions.reduce((sum, p) => sum + p.currentValueUSD, 0),
        totalFeesCollected: positions.reduce((sum, p) =>
          sum + parseFloat(p.totalFeesCollected0) + parseFloat(p.totalFeesCollected1), 0),
        avgAPR: 0,
        totalImpermanentLoss: positions.reduce((sum, p) => sum + p.impermanentLoss, 0),
        positionsInRange: positions.filter(p => p.inRange).length,
        utilizationRate: 0,
        profitablePositions: positions.filter(p => p.profitLoss > 0).length,
        rebalanceAlerts: this.getPositionAlerts().filter(a => a.type === 'rebalance_needed').length
      };

      // Calculate averages
      if (positions.length > 0) {
        metrics.avgAPR = positions.reduce((sum, p) => sum + p.totalAPR, 0) / positions.length;
        metrics.utilizationRate = (metrics.positionsInRange / positions.length) * 100;
      }

      return metrics;

    } catch (error) {
      logger.error('Failed to calculate position metrics:', error);
      return {
        totalPositions: 0,
        activePositions: 0,
        totalValueUSD: 0,
        totalFeesCollected: 0,
        avgAPR: 0,
        totalImpermanentLoss: 0,
        positionsInRange: 0,
        utilizationRate: 0,
        profitablePositions: 0,
        rebalanceAlerts: 0
      };
    }
  }

  /**
   * Force update all positions
   */
  async forceUpdate(): Promise<void> {
    logger.info('Force updating all positions...');
    await this.syncAllPositions();
    logger.info('✅ Force update completed');
  }

  /**
   * Start monitoring loop
   */
  private startMonitoring(): void {
    this.updateInterval = setInterval(async () => {
      try {
        await this.syncAllPositions();
      } catch (error) {
        logger.error('Error in position monitoring:', error);
      }
    }, this.UPDATE_INTERVAL);

    logger.info(`Position monitoring started (interval: ${this.UPDATE_INTERVAL}ms)`);
  }

  /**
   * Sync all positions with blockchain state
   */
  private async syncAllPositions(): Promise<void> {
    if (!this.positionRepo) return;

    try {
      const positions = await this.getTrackedPositions();

      logger.debug(`Syncing ${positions.length} positions...`);

      for (const position of positions) {
        try {
          await this.updatePosition(position);
        } catch (error) {
          logger.warn(`Failed to update position ${position.id}:`, error);
        }
      }

      logger.debug(`Synced ${positions.length} positions`);

    } catch (error) {
      logger.error('Error syncing positions:', error);
    }
  }

  /**
   * Update individual position
   */
  private async updatePosition(position: Position): Promise<void> {
    if (!this.positionRepo) return;

    try {
      // Get current pool data
      const poolData = await this.gswap.pools.getPoolData(
        position.token0,
        position.token1,
        position.fee
      );

      if (!poolData) {
        logger.warn(`No pool data for position ${position.id}`);
        return;
      }

      // Calculate current price
      const currentPrice = this.gswap.pools.calculateSpotPrice(
        position.token0,
        position.token1,
        poolData.sqrtPrice
      );

      const currentPriceNum = safeParseFloat(currentPrice.toString(), 0);

      // Update position range status
      const deltaTime = Date.now() - position.updatedAt.getTime();
      position.updateInRangeStatus(currentPriceNum, deltaTime);

      // Get fresh position data from blockchain
      const blockchainPosition = await this.gswap.liquidityPositions.getPositionById(
        position.walletAddress,
        position.id
      );

      if (blockchainPosition) {
        // Update position data
        position.liquidity = blockchainPosition.liquidity || position.liquidity;
        position.uncollectedFees0 = blockchainPosition.tokensOwed0 || '0';
        position.uncollectedFees1 = blockchainPosition.tokensOwed1 || '0';
      }

      // Update metrics
      await this.updatePositionMetrics(position);

      // Store previous price for change calculation
      const previousPrice = this.lastPrices.get(position.id) || currentPriceNum;
      this.lastPrices.set(position.id, currentPriceNum);

      // Check for alerts
      await this.checkPositionAlerts(position, currentPriceNum, previousPrice);

      // Save updated position
      await this.positionRepo.save(position);

    } catch (error) {
      logger.error(`Error updating position ${position.id}:`, error);
    }
  }

  /**
   * Update position metrics and analytics
   */
  private async updatePositionMetrics(position: Position): Promise<void> {
    try {
      // Calculate current value (simplified - would need price feeds for USD conversion)
      const liquidityValue = parseFloat(position.amount0) + parseFloat(position.amount1);
      position.updateValue(liquidityValue);

      // Calculate APR
      position.totalAPR = position.calculateCurrentAPR();

    } catch (error) {
      logger.error(`Error calculating metrics for position ${position.id}:`, error);
    }
  }

  /**
   * Check for position alerts
   */
  private async checkPositionAlerts(
    position: Position,
    currentPrice: number,
    previousPrice: number
  ): Promise<void> {
    const alerts: PositionAlert[] = [];

    // Out of range alert
    if (!position.inRange) {
      alerts.push({
        positionId: position.id,
        type: 'out_of_range',
        severity: 'medium',
        message: `Position is out of range. Current price: ${currentPrice.toFixed(6)}`,
        data: { currentPrice, range: { min: position.minPrice, max: position.maxPrice } },
        timestamp: Date.now(),
        acknowledged: false
      });
    }

    // High uncollected fees alert
    const totalFees = parseFloat(position.uncollectedFees0) + parseFloat(position.uncollectedFees1);
    if (totalFees > 100) { // Threshold for high fees
      alerts.push({
        positionId: position.id,
        type: 'high_fees',
        severity: 'low',
        message: `High uncollected fees: ${totalFees.toFixed(2)}`,
        data: { fees0: position.uncollectedFees0, fees1: position.uncollectedFees1 },
        timestamp: Date.now(),
        acknowledged: false
      });
    }

    // Impermanent loss alert
    if (position.impermanentLoss < -10) { // > 10% loss
      alerts.push({
        positionId: position.id,
        type: 'impermanent_loss',
        severity: 'high',
        message: `High impermanent loss: ${position.impermanentLoss.toFixed(2)}%`,
        data: { impermanentLoss: position.impermanentLoss },
        timestamp: Date.now(),
        acknowledged: false
      });
    }

    // Rebalance needed alert
    if (position.needsRebalance()) {
      alerts.push({
        positionId: position.id,
        type: 'rebalance_needed',
        severity: 'medium',
        message: 'Position may benefit from rebalancing',
        data: { currentPrice, timeOutOfRange: position.timeOutOfRangeMs },
        timestamp: Date.now(),
        acknowledged: false
      });
    }

    // Low utilization alert
    if (position.timeInRangePercent < 50 && position.totalTimeTracked > 24 * 60 * 60 * 1000) { // < 50% over 24h
      alerts.push({
        positionId: position.id,
        type: 'low_utilization',
        severity: 'medium',
        message: `Low utilization: ${position.timeInRangePercent.toFixed(1)}% time in range`,
        data: { utilization: position.timeInRangePercent },
        timestamp: Date.now(),
        acknowledged: false
      });
    }

    // Store alerts (with cooldown and limits)
    if (alerts.length > 0) {
      this.storeAlerts(position.id, alerts);
    }
  }

  /**
   * Store alerts with cooldown and limits
   */
  private storeAlerts(positionId: string, newAlerts: PositionAlert[]): void {
    const existingAlerts = this.alerts.get(positionId) || [];
    const now = Date.now();

    // Filter out old alerts and apply cooldown
    const activeAlerts = existingAlerts.filter(alert => {
      const age = now - alert.timestamp;
      return age < this.ALERT_COOLDOWN || !alert.acknowledged;
    });

    // Add new alerts (avoiding duplicates)
    for (const newAlert of newAlerts) {
      const isDuplicate = activeAlerts.some(existing =>
        existing.type === newAlert.type &&
        existing.severity === newAlert.severity &&
        (now - existing.timestamp) < this.ALERT_COOLDOWN
      );

      if (!isDuplicate) {
        activeAlerts.push(newAlert);
      }
    }

    // Limit total alerts per position
    const limitedAlerts = activeAlerts
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, this.MAX_ALERTS_PER_POSITION);

    this.alerts.set(positionId, limitedAlerts);

    // Log new alerts
    newAlerts.forEach(alert => {
      logger.warn(`Position alert: ${alert.message}`, {
        positionId: alert.positionId,
        type: alert.type,
        severity: alert.severity
      });
    });
  }

  /**
   * Get tracking statistics
   */
  getStatistics(): {
    isRunning: boolean;
    positionsTracked: number;
    totalAlerts: number;
    unacknowledgedAlerts: number;
    lastUpdateTime: number;
    updateInterval: number;
  } {
    const allAlerts = this.getPositionAlerts();

    return {
      isRunning: this.isRunning,
      positionsTracked: this.lastPrices.size,
      totalAlerts: allAlerts.length,
      unacknowledgedAlerts: allAlerts.filter(a => !a.acknowledged).length,
      lastUpdateTime: Date.now(),
      updateInterval: this.UPDATE_INTERVAL
    };
  }
}