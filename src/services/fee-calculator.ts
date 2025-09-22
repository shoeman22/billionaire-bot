/**
 * Fee Calculator Service
 * Comprehensive fee tracking, calculation, and analytics for liquidity positions
 * Handles fee collection optimization and yield calculations
 */

import { Position } from '../entities/Position';
import { getPositionRepository } from '../config/database';
import { logger } from '../utils/logger';
// Unused imports removed
// import { TRADING_CONSTANTS, STRATEGY_CONSTANTS } from '../config/constants';
// import { safeParseFloat } from '../utils/safe-parse';
// import BigNumber from 'bignumber.js';
import { Repository } from 'typeorm';

export interface FeeSnapshot {
  positionId: string;
  timestamp: number;
  token0Fees: string;
  token1Fees: string;
  token0Price: number;
  token1Price: number;
  feesUSD: number;
  positionValueUSD: number;
  feeYield: number; // Daily yield percentage
}

export interface FeeAnalytics {
  positionId: string;
  totalFeesToken0: string;
  totalFeesToken1: string;
  totalFeesUSD: number;
  dailyFeeRate: number;
  weeklyFeeRate: number;
  monthlyFeeRate: number;
  annualizedAPR: number;
  feeYieldHistory: FeeSnapshot[];
  optimalCollectionThreshold: number;
  nextCollectionRecommendation: Date | null;
  compoundingEffect: number;
}

export interface PoolFeeMetrics {
  token0: string;
  token1: string;
  fee: number;
  totalVolume24h: number;
  totalFees24h: number;
  avgFeeRate: number;
  liquidityUtilization: number;
  topPerformers: string[]; // Position IDs
  feeDistribution: {
    top10Percent: number;
    median: number;
    bottom10Percent: number;
  };
}

export interface FeeOptimization {
  positionId: string;
  currentCollectionCost: number;
  accruedFeesUSD: number;
  optimalCollectionTime: Date;
  costBenefitRatio: number;
  recommendation: 'collect_now' | 'wait' | 'rebalance_first';
  estimatedAdditionalYield: number;
  gasCostThreshold: number;
}

export interface GlobalFeeMetrics {
  totalPositions: number;
  activePositions: number;
  totalFeesEarnedUSD: number;
  totalFeesUncollectedUSD: number;
  avgDailyYield: number;
  avgMonthlyYield: number;
  avgAnnualizedAPR: number;
  averageAPR: number;
  topPerformingPairs: Array<{
    token0: string;
    token1: string;
    fee: number;
    totalFeesUSD: number;
    avgAPR: number;
  }>;
  topPerformingPosition: {
    id: string;
    apr: number;
    feesUSD: number;
  } | null;
  poorestPerformingPosition: {
    id: string;
    apr: number;
    feesUSD: number;
  } | null;
  feeCollectionEfficiency: number;
  compoundingOpportunities: number;
}

export class FeeCalculator {
  private positionRepo: Repository<Position> | null = null;
  private feeSnapshots: Map<string, FeeSnapshot[]> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly maxSnapshotsPerPosition = 10000;
  private readonly priceValidityMs = 60000; // 1 minute
  private readonly defaultGasCostUSD = 5; // $5 default gas cost

  constructor() {
    logger.info('FeeCalculator initialized');
  }

  /**
   * Initialize fee calculator with database connection
   */
  async initialize(): Promise<void> {
    try {
      this.positionRepo = await getPositionRepository();
      logger.info('✅ FeeCalculator database connection established');
    } catch (error) {
      logger.error('❌ Failed to initialize FeeCalculator:', error);
      throw error;
    }
  }

  /**
   * Record fee snapshot for a position
   */
  async recordFeeSnapshot(
    positionId: string,
    token0Fees: string,
    token1Fees: string,
    token0Price: number,
    token1Price: number,
    positionValueUSD: number
  ): Promise<void> {
    try {
      const feesUSD = parseFloat(token0Fees) * token0Price + parseFloat(token1Fees) * token1Price;

      // Calculate daily yield (simplified)
      const feeYield = positionValueUSD > 0 ? (feesUSD / positionValueUSD) * 365 * 100 : 0;

      const snapshot: FeeSnapshot = {
        positionId,
        timestamp: Date.now(),
        token0Fees,
        token1Fees,
        token0Price,
        token1Price,
        feesUSD,
        positionValueUSD,
        feeYield
      };

      // Store snapshot
      const snapshots = this.feeSnapshots.get(positionId) || [];
      snapshots.push(snapshot);

      // Maintain snapshot limit
      if (snapshots.length > this.maxSnapshotsPerPosition) {
        snapshots.splice(0, snapshots.length - this.maxSnapshotsPerPosition);
      }

      this.feeSnapshots.set(positionId, snapshots);

      logger.debug(`Fee snapshot recorded for position ${positionId}`, {
        feesUSD: feesUSD.toFixed(6),
        feeYield: feeYield.toFixed(4) + '%'
      });

    } catch (error) {
      logger.error(`Failed to record fee snapshot for position ${positionId}:`, error);
    }
  }

  /**
   * Calculate comprehensive fee analytics for a position
   */
  async calculatePositionFeeAnalytics(positionId: string): Promise<FeeAnalytics | null> {
    if (!this.positionRepo) {
      throw new Error('FeeCalculator not initialized');
    }

    try {
      const position = await this.positionRepo.findOne({ where: { id: positionId } });
      if (!position) {
        return null;
      }

      const snapshots = this.feeSnapshots.get(positionId) || [];
      const now = Date.now();

      // Calculate time-based fee rates
      const dailyRate = this.calculateTimeBasedFeeRate(snapshots, 24 * 60 * 60 * 1000); // 24 hours
      const weeklyRate = this.calculateTimeBasedFeeRate(snapshots, 7 * 24 * 60 * 60 * 1000); // 7 days
      const monthlyRate = this.calculateTimeBasedFeeRate(snapshots, 30 * 24 * 60 * 60 * 1000); // 30 days

      // Calculate annualized APR
      const positionAge = now - position.createdAt.getTime();
      const totalFeesUSD = parseFloat(position.totalFeesCollected0) + parseFloat(position.totalFeesCollected1);
      const annualizedAPR = this.calculateAnnualizedAPR(totalFeesUSD, position.initialValueUSD, positionAge);

      // Calculate optimal collection threshold
      const optimalThreshold = this.calculateOptimalCollectionThreshold(position, snapshots);

      // Determine next collection recommendation
      const currentFeesUSD = parseFloat(position.uncollectedFees0) + parseFloat(position.uncollectedFees1);
      const nextCollection = this.calculateNextCollectionTime(position, currentFeesUSD, optimalThreshold);

      // Calculate compounding effect
      const compoundingEffect = this.calculateCompoundingEffect(snapshots);

      return {
        positionId,
        totalFeesToken0: position.totalFeesCollected0,
        totalFeesToken1: position.totalFeesCollected1,
        totalFeesUSD,
        dailyFeeRate: dailyRate,
        weeklyFeeRate: weeklyRate,
        monthlyFeeRate: monthlyRate,
        annualizedAPR,
        feeYieldHistory: snapshots.slice(-100), // Last 100 snapshots
        optimalCollectionThreshold: optimalThreshold,
        nextCollectionRecommendation: nextCollection,
        compoundingEffect
      };

    } catch (error) {
      logger.error(`Failed to calculate fee analytics for position ${positionId}:`, error);
      return null;
    }
  }

  /**
   * Calculate pool-wide fee metrics
   */
  async calculatePoolFeeMetrics(token0: string, token1: string, fee: number): Promise<PoolFeeMetrics | null> {
    if (!this.positionRepo) {
      throw new Error('FeeCalculator not initialized');
    }

    try {
      const positions = await this.positionRepo.find({
        where: { token0, token1, fee, isActive: true }
      });

      if (positions.length === 0) {
        return null;
      }

      // Calculate aggregate metrics
      const totalFees24h = positions.reduce((sum, pos) => {
        const dailyFees = this.estimateDailyFees(pos);
        return sum + dailyFees;
      }, 0);

      const avgFeeRate = positions.reduce((sum, pos) => sum + pos.feeAPR, 0) / positions.length;

      // Calculate utilization (simplified)
      const inRangePositions = positions.filter(pos => pos.inRange).length;
      const liquidityUtilization = positions.length > 0 ? (inRangePositions / positions.length) * 100 : 0;

      // Find top performers
      const sortedPositions = positions.sort((a, b) => b.feeAPR - a.feeAPR);
      const topPerformers = sortedPositions.slice(0, Math.min(5, positions.length)).map(pos => pos.id);

      // Calculate fee distribution
      const feeRates = positions.map(pos => pos.feeAPR).sort((a, b) => a - b);
      const feeDistribution = {
        top10Percent: this.calculatePercentile(feeRates, 90),
        median: this.calculatePercentile(feeRates, 50),
        bottom10Percent: this.calculatePercentile(feeRates, 10)
      };

      return {
        token0,
        token1,
        fee,
        totalVolume24h: 0, // Would need external data source
        totalFees24h,
        avgFeeRate,
        liquidityUtilization,
        topPerformers,
        feeDistribution
      };

    } catch (error) {
      logger.error(`Failed to calculate pool fee metrics:`, error);
      return null;
    }
  }

  /**
   * Generate fee collection optimization recommendations
   */
  async generateCollectionOptimization(positionId: string): Promise<FeeOptimization | null> {
    if (!this.positionRepo) {
      throw new Error('FeeCalculator not initialized');
    }

    try {
      const position = await this.positionRepo.findOne({ where: { id: positionId } });
      if (!position) {
        return null;
      }

      const accruedFeesUSD = parseFloat(position.uncollectedFees0) + parseFloat(position.uncollectedFees1);
      const currentCollectionCost = this.defaultGasCostUSD; // Simplified gas cost

      // Calculate cost-benefit ratio
      const costBenefitRatio = accruedFeesUSD > 0 ? currentCollectionCost / accruedFeesUSD : Infinity;

      // Determine optimal collection time
      const snapshots = this.feeSnapshots.get(positionId) || [];
      const feeAccrualRate = this.calculateFeeAccrualRate(snapshots);
      const optimalCollectionTime = this.calculateOptimalCollectionTime(
        accruedFeesUSD,
        feeAccrualRate,
        currentCollectionCost
      );

      // Generate recommendation
      let recommendation: 'collect_now' | 'wait' | 'rebalance_first';
      if (costBenefitRatio < 0.1) { // Less than 10% cost
        recommendation = 'collect_now';
      } else if (costBenefitRatio > 0.5) { // More than 50% cost
        recommendation = 'wait';
      } else {
        recommendation = position.inRange ? 'collect_now' : 'rebalance_first';
      }

      // Estimate additional yield if waiting
      const additionalYield = this.estimateAdditionalYield(feeAccrualRate, optimalCollectionTime);

      return {
        positionId,
        currentCollectionCost,
        accruedFeesUSD,
        optimalCollectionTime,
        costBenefitRatio,
        recommendation,
        estimatedAdditionalYield: additionalYield,
        gasCostThreshold: this.defaultGasCostUSD * 2 // 2x gas as threshold
      };

    } catch (error) {
      logger.error(`Failed to generate collection optimization for position ${positionId}:`, error);
      return null;
    }
  }

  /**
   * Calculate global fee metrics across all positions
   */
  async calculateGlobalFeeMetrics(): Promise<GlobalFeeMetrics> {
    if (!this.positionRepo) {
      throw new Error('FeeCalculator not initialized');
    }

    try {
      const positions = await this.positionRepo.find({ where: { isActive: true } });

      const totalFeesEarnedUSD = positions.reduce((sum, pos) =>
        sum + parseFloat(pos.totalFeesCollected0) + parseFloat(pos.totalFeesCollected1), 0);

      const totalFeesUncollectedUSD = positions.reduce((sum, pos) =>
        sum + parseFloat(pos.uncollectedFees0) + parseFloat(pos.uncollectedFees1), 0);

      // Calculate average yields
      const dailyYields = await Promise.all(
        positions.map(pos => this.calculateDailyYield(pos.id))
      );
      const validYields = dailyYields.filter(yield_ => yield_ !== null) as number[];

      const avgDailyYield = validYields.length > 0
        ? validYields.reduce((sum, yield_) => sum + yield_, 0) / validYields.length
        : 0;

      const avgMonthlyYield = avgDailyYield * 30;
      const avgAnnualizedAPR = positions.reduce((sum, pos) => sum + pos.totalAPR, 0) / positions.length;

      // Calculate top performing pairs
      const pairMetrics = new Map<string, { totalFeesUSD: number; count: number; totalAPR: number }>();

      for (const pos of positions) {
        const pairKey = `${pos.token0}-${pos.token1}-${pos.fee}`;
        const existing = pairMetrics.get(pairKey) || { totalFeesUSD: 0, count: 0, totalAPR: 0 };

        existing.totalFeesUSD += parseFloat(pos.totalFeesCollected0) + parseFloat(pos.totalFeesCollected1);
        existing.count += 1;
        existing.totalAPR += pos.totalAPR;

        pairMetrics.set(pairKey, existing);
      }

      const topPerformingPairs = Array.from(pairMetrics.entries())
        .map(([key, metrics]) => {
          const [token0, token1, feeStr] = key.split('-');
          return {
            token0,
            token1,
            fee: parseInt(feeStr),
            totalFeesUSD: metrics.totalFeesUSD,
            avgAPR: metrics.totalAPR / metrics.count
          };
        })
        .sort((a, b) => b.totalFeesUSD - a.totalFeesUSD)
        .slice(0, 10);

      // Calculate fee collection efficiency
      const totalCollectableFeesUSD = totalFeesEarnedUSD + totalFeesUncollectedUSD;
      const feeCollectionEfficiency = totalCollectableFeesUSD > 0
        ? (totalFeesEarnedUSD / totalCollectableFeesUSD) * 100
        : 0;

      // Count compounding opportunities
      const compoundingOpportunities = positions.filter(pos => {
        const uncollectedUSD = parseFloat(pos.uncollectedFees0) + parseFloat(pos.uncollectedFees1);
        return uncollectedUSD > this.defaultGasCostUSD * 2; // Worth collecting
      }).length;

      // Calculate active positions
      const activePositions = positions.filter(pos => pos.inRange).length;

      // Find top and poorest performing positions
      let topPerformingPosition = null;
      let poorestPerformingPosition = null;

      if (positions.length > 0) {
        const sortedByAPR = positions.sort((a, b) => b.totalAPR - a.totalAPR);
        const topPos = sortedByAPR[0];
        const poorPos = sortedByAPR[sortedByAPR.length - 1];

        topPerformingPosition = {
          id: topPos.id,
          apr: topPos.totalAPR,
          feesUSD: parseFloat(topPos.totalFeesCollected0) + parseFloat(topPos.totalFeesCollected1)
        };

        if (sortedByAPR.length > 1) {
          poorestPerformingPosition = {
            id: poorPos.id,
            apr: poorPos.totalAPR,
            feesUSD: parseFloat(poorPos.totalFeesCollected0) + parseFloat(poorPos.totalFeesCollected1)
          };
        }
      }

      return {
        totalPositions: positions.length,
        activePositions,
        totalFeesEarnedUSD,
        totalFeesUncollectedUSD,
        avgDailyYield,
        avgMonthlyYield,
        avgAnnualizedAPR,
        averageAPR: avgAnnualizedAPR, // Alias for compatibility
        topPerformingPairs,
        topPerformingPosition,
        poorestPerformingPosition,
        feeCollectionEfficiency,
        compoundingOpportunities
      };

    } catch (error) {
      logger.error('Failed to calculate global fee metrics:', error);
      return {
        totalPositions: 0,
        activePositions: 0,
        totalFeesEarnedUSD: 0,
        totalFeesUncollectedUSD: 0,
        avgDailyYield: 0,
        avgMonthlyYield: 0,
        avgAnnualizedAPR: 0,
        averageAPR: 0,
        topPerformingPairs: [],
        topPerformingPosition: null,
        poorestPerformingPosition: null,
        feeCollectionEfficiency: 0,
        compoundingOpportunities: 0
      };
    }
  }

  /**
   * Identify positions that should collect fees now
   */
  async identifyCollectionOpportunities(): Promise<string[]> {
    if (!this.positionRepo) {
      throw new Error('FeeCalculator not initialized');
    }

    try {
      const positions = await this.positionRepo.find({ where: { isActive: true } });
      const opportunities: string[] = [];

      for (const position of positions) {
        const optimization = await this.generateCollectionOptimization(position.id);
        if (optimization && optimization.recommendation === 'collect_now') {
          opportunities.push(position.id);
        }
      }

      return opportunities;

    } catch (error) {
      logger.error('Failed to identify collection opportunities:', error);
      return [];
    }
  }

  /**
   * Calculate time-based fee rate
   */
  private calculateTimeBasedFeeRate(snapshots: FeeSnapshot[], timeWindowMs: number): number {
    if (snapshots.length < 2) return 0;

    const now = Date.now();
    const cutoffTime = now - timeWindowMs;
    const recentSnapshots = snapshots.filter(s => s.timestamp >= cutoffTime);

    if (recentSnapshots.length < 2) return 0;

    const oldest = recentSnapshots[0];
    const newest = recentSnapshots[recentSnapshots.length - 1];

    const timeDiff = newest.timestamp - oldest.timestamp;
    const feeDiff = newest.feesUSD - oldest.feesUSD;

    if (timeDiff <= 0 || newest.positionValueUSD <= 0) return 0;

    return (feeDiff / newest.positionValueUSD) * (timeWindowMs / timeDiff) * 100;
  }

  /**
   * Calculate annualized APR
   */
  private calculateAnnualizedAPR(totalFeesUSD: number, initialValueUSD: number, positionAgeMs: number): number {
    if (initialValueUSD <= 0 || positionAgeMs <= 0) return 0;

    const yearsElapsed = positionAgeMs / (365 * 24 * 60 * 60 * 1000);
    return (totalFeesUSD / initialValueUSD) / yearsElapsed * 100;
  }

  /**
   * Calculate optimal collection threshold
   */
  private calculateOptimalCollectionThreshold(position: Position, snapshots: FeeSnapshot[]): number {
    // Dynamic threshold based on position size and fee accrual rate
    const baseThreshold = this.defaultGasCostUSD * 2; // 2x gas cost minimum
    const positionMultiplier = Math.max(1, position.currentValueUSD / 1000); // Higher threshold for larger positions
    const feeRate = this.calculateTimeBasedFeeRate(snapshots, 24 * 60 * 60 * 1000); // Daily rate

    // If high fee rate, allow lower threshold for more frequent collection
    const rateMultiplier = feeRate > 1 ? 0.5 : 1; // 50% lower threshold for high-yield positions

    return baseThreshold * positionMultiplier * rateMultiplier;
  }

  /**
   * Calculate next collection time
   */
  private calculateNextCollectionTime(
    position: Position,
    currentFeesUSD: number,
    optimalThreshold: number
  ): Date | null {
    if (currentFeesUSD >= optimalThreshold) {
      return new Date(); // Collect now
    }

    // Estimate time to reach threshold based on current fee rate
    const snapshots = this.feeSnapshots.get(position.id) || [];
    const dailyFeeRate = this.calculateTimeBasedFeeRate(snapshots, 24 * 60 * 60 * 1000);

    if (dailyFeeRate <= 0) return null;

    const remainingFees = optimalThreshold - currentFeesUSD;
    const daysToThreshold = remainingFees / (position.currentValueUSD * dailyFeeRate / 100);
    const msToThreshold = daysToThreshold * 24 * 60 * 60 * 1000;

    return new Date(Date.now() + msToThreshold);
  }

  /**
   * Calculate compounding effect
   */
  private calculateCompoundingEffect(snapshots: FeeSnapshot[]): number {
    if (snapshots.length < 2) return 0;

    // Calculate the difference between compound and simple interest
    let compoundValue = snapshots[0].positionValueUSD;
    let simpleInterest = 0;

    for (let i = 1; i < snapshots.length; i++) {
      const timeDiff = snapshots[i].timestamp - snapshots[i - 1].timestamp;
      const daysFraction = timeDiff / (24 * 60 * 60 * 1000);
      const feeYield = snapshots[i].feeYield / 365; // Daily yield

      // Compound interest
      compoundValue *= (1 + feeYield * daysFraction);

      // Simple interest
      simpleInterest += snapshots[0].positionValueUSD * feeYield * daysFraction;
    }

    const simpleValue = snapshots[0].positionValueUSD + simpleInterest;
    return simpleValue > 0 ? ((compoundValue - simpleValue) / simpleValue) * 100 : 0;
  }

  /**
   * Calculate fee accrual rate
   */
  private calculateFeeAccrualRate(snapshots: FeeSnapshot[]): number {
    if (snapshots.length < 2) return 0;

    const recentSnapshots = snapshots.slice(-10); // Last 10 snapshots
    if (recentSnapshots.length < 2) return 0;

    const oldest = recentSnapshots[0];
    const newest = recentSnapshots[recentSnapshots.length - 1];

    const timeDiff = newest.timestamp - oldest.timestamp;
    const feeDiff = newest.feesUSD - oldest.feesUSD;

    return timeDiff > 0 ? feeDiff / (timeDiff / (24 * 60 * 60 * 1000)) : 0; // Fees per day
  }

  /**
   * Calculate optimal collection time
   */
  private calculateOptimalCollectionTime(
    currentFeesUSD: number,
    feeAccrualRate: number,
    collectionCost: number
  ): Date {
    // Simple optimization: collect when fees = 2x collection cost
    const targetFees = collectionCost * 2;
    const additionalFeesNeeded = Math.max(0, targetFees - currentFeesUSD);

    if (feeAccrualRate <= 0) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default to 1 week
    }

    const daysToTarget = additionalFeesNeeded / feeAccrualRate;
    const msToTarget = daysToTarget * 24 * 60 * 60 * 1000;

    return new Date(Date.now() + msToTarget);
  }

  /**
   * Estimate additional yield if waiting
   */
  private estimateAdditionalYield(feeAccrualRate: number, optimalTime: Date): number {
    const waitTimeMs = optimalTime.getTime() - Date.now();
    const waitTimeDays = waitTimeMs / (24 * 60 * 60 * 1000);
    return Math.max(0, feeAccrualRate * waitTimeDays);
  }

  /**
   * Calculate daily yield for a position
   */
  private async calculateDailyYield(positionId: string): Promise<number | null> {
    const snapshots = this.feeSnapshots.get(positionId) || [];
    return this.calculateTimeBasedFeeRate(snapshots, 24 * 60 * 60 * 1000);
  }

  /**
   * Estimate daily fees for a position
   */
  private estimateDailyFees(position: Position): number {
    const snapshots = this.feeSnapshots.get(position.id) || [];
    const dailyRate = this.calculateTimeBasedFeeRate(snapshots, 24 * 60 * 60 * 1000);
    return position.currentValueUSD * dailyRate / 100;
  }

  /**
   * Calculate percentile of an array
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;

    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedArray[lower];
    }

    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  /**
   * Get fee calculation statistics
   */
  getStatistics(): {
    totalSnapshots: number;
    positionsTracked: number;
    avgSnapshotsPerPosition: number;
    oldestSnapshot: number | null;
    newestSnapshot: number | null;
  } {
    let totalSnapshots = 0;
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;

    this.feeSnapshots.forEach(snapshots => {
      totalSnapshots += snapshots.length;

      if (snapshots.length > 0) {
        const oldest = snapshots[0].timestamp;
        const newest = snapshots[snapshots.length - 1].timestamp;

        if (oldestTimestamp === null || oldest < oldestTimestamp) {
          oldestTimestamp = oldest;
        }

        if (newestTimestamp === null || newest > newestTimestamp) {
          newestTimestamp = newest;
        }
      }
    });

    return {
      totalSnapshots,
      positionsTracked: this.feeSnapshots.size,
      avgSnapshotsPerPosition: this.feeSnapshots.size > 0 ? totalSnapshots / this.feeSnapshots.size : 0,
      oldestSnapshot: oldestTimestamp,
      newestSnapshot: newestTimestamp
    };
  }

  /**
   * Calculate accrued fees - required for TradingEngine compatibility
   */
  async calculateAccruedFees(): Promise<number> {
    const metrics = await this.calculateGlobalFeeMetrics();
    return metrics.totalFeesUncollectedUSD;
  }

  /**
   * Get total fees collected - required for TradingEngine compatibility
   */
  async getTotalFeesCollected(): Promise<number> {
    const metrics = await this.calculateGlobalFeeMetrics();
    return metrics.totalFeesEarnedUSD;
  }
}