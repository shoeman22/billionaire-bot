/**
 * AnalyticsSnapshot Entity
 *
 * Periodic snapshots of analytics state for historical tracking,
 * performance monitoring, and system health analysis.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index
} from 'typeorm';

export type SnapshotType = 'hourly' | 'daily' | 'weekly' | 'manual';

@Entity('analytics_snapshots')
@Index(['snapshotType', 'createdAt'])
@Index(['poolHash', 'createdAt'])
export class AnalyticsSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar', { length: 64, nullable: true })
  poolHash?: string; // Optional - for pool-specific snapshots

  @Column('varchar', { length: 20 })
  snapshotType!: SnapshotType;

  @Column('bigint')
  snapshotTimestamp!: number;

  @Column('json')
  whaleTrackingStats!: {
    totalWhales: number;
    activeWhales: number;
    highPriorityWhales: number;
    totalAlerts: number;
    processedAlerts: number;
    alertsByType: Record<string, number>;
    averageSuccessRate: number;
    topPerformingWhales: Array<{
      address: string;
      successRate: number;
      profitabilityScore: number;
    }>;
  };

  @Column('json')
  volumeAnalysisStats!: {
    totalVolumeDataPoints: number;
    uniquePools: number;
    averageDailyVolume: number;
    volumeGrowthRate: number;
    patternsDetected: number;
    patternsByType: Record<string, number>;
    predictionAccuracy: {
      overall: number;
      byTimeframe: Record<string, number>;
      byPatternType: Record<string, number>;
    };
  };

  @Column('json')
  cachePerformance!: {
    transactionCacheHits: number;
    transactionCacheMisses: number;
    volumeDataCacheHits: number;
    volumeDataCacheMisses: number;
    averageApiResponseTime: number;
    cacheEfficiencyRatio: number;
    totalCacheSize: number;
    cacheCleanupEvents: number;
  };

  @Column('json')
  systemHealth!: {
    uptime: number; // in seconds
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      external: number;
      rss: number;
    };
    apiCallCounts: Record<string, number>;
    errorCounts: Record<string, number>;
    processingLatencies: Record<string, number>;
    databaseConnectionPool: {
      active: number;
      idle: number;
      total: number;
    };
  };

  @Column('json', { nullable: true })
  tradingPerformance?: {
    totalOpportunities: number;
    opportunitiesTaken: number;
    successfulTrades: number;
    totalProfit: number;
    winRate: number;
    averageProfit: number;
    largestWin: number;
    largestLoss: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
  };

  @Column('json', { nullable: true })
  customMetrics?: {
    [key: string]: any;
  };

  @Column('integer')
  dataVersion!: number; // For schema evolution tracking

  @CreateDateColumn()
  createdAt!: Date;

  /**
   * Calculate overall system health score
   */
  get healthScore(): number {
    const metrics = [
      // Cache efficiency (0-1)
      this.cachePerformance.cacheEfficiencyRatio,

      // Error rate (inverse - lower is better)
      1 - Math.min(1, Object.values(this.systemHealth.errorCounts).reduce((a, b) => a + b, 0) / 100),

      // Alert processing rate
      this.whaleTrackingStats.totalAlerts > 0
        ? this.whaleTrackingStats.processedAlerts / this.whaleTrackingStats.totalAlerts
        : 1,

      // Pattern detection accuracy
      this.volumeAnalysisStats.predictionAccuracy.overall,

      // Memory usage efficiency (inverse)
      1 - Math.min(1, this.systemHealth.memoryUsage.heapUsed / this.systemHealth.memoryUsage.heapTotal)
    ];

    return metrics.reduce((sum, metric) => sum + metric, 0) / metrics.length;
  }

  /**
   * Get performance trends compared to baseline
   */
  getTrends(baseline?: AnalyticsSnapshot): {
    whaleTracking: string;
    volumeAnalysis: string;
    cachePerformance: string;
    systemHealth: string;
  } {
    if (!baseline) {
      return {
        whaleTracking: 'baseline',
        volumeAnalysis: 'baseline',
        cachePerformance: 'baseline',
        systemHealth: 'baseline'
      };
    }

    const getTrend = (current: number, previous: number): string => {
      const change = (current - previous) / previous;
      if (change > 0.1) return 'improving';
      if (change < -0.1) return 'declining';
      return 'stable';
    };

    return {
      whaleTracking: getTrend(
        this.whaleTrackingStats.averageSuccessRate,
        baseline.whaleTrackingStats.averageSuccessRate
      ),
      volumeAnalysis: getTrend(
        this.volumeAnalysisStats.predictionAccuracy.overall,
        baseline.volumeAnalysisStats.predictionAccuracy.overall
      ),
      cachePerformance: getTrend(
        this.cachePerformance.cacheEfficiencyRatio,
        baseline.cachePerformance.cacheEfficiencyRatio
      ),
      systemHealth: getTrend(this.healthScore, baseline.healthScore)
    };
  }

  /**
   * Get key insights from this snapshot
   */
  getInsights(): string[] {
    const insights: string[] = [];

    // Whale tracking insights
    if (this.whaleTrackingStats.averageSuccessRate > 0.8) {
      insights.push('Whale tracking showing high accuracy');
    }
    if (this.whaleTrackingStats.totalAlerts > 50) {
      insights.push('High whale activity detected');
    }

    // Volume analysis insights
    if (this.volumeAnalysisStats.predictionAccuracy.overall > 0.75) {
      insights.push('Volume predictions performing well');
    }
    if (this.volumeAnalysisStats.patternsDetected > 10) {
      insights.push('Multiple volume patterns identified');
    }

    // Performance insights
    if (this.cachePerformance.cacheEfficiencyRatio > 0.8) {
      insights.push('Cache performance is optimal');
    }
    if (this.healthScore > 0.9) {
      insights.push('System operating at peak performance');
    } else if (this.healthScore < 0.7) {
      insights.push('System performance needs attention');
    }

    return insights;
  }

  /**
   * Create snapshot from current system state
   */
  static createSnapshot(
    type: SnapshotType,
    poolHash: string | undefined,
    stats: {
      whaleTracking: AnalyticsSnapshot['whaleTrackingStats'];
      volumeAnalysis: AnalyticsSnapshot['volumeAnalysisStats'];
      cachePerformance: AnalyticsSnapshot['cachePerformance'];
      systemHealth: AnalyticsSnapshot['systemHealth'];
      tradingPerformance?: AnalyticsSnapshot['tradingPerformance'];
      customMetrics?: AnalyticsSnapshot['customMetrics'];
    }
  ): Partial<AnalyticsSnapshot> {
    return {
      poolHash,
      snapshotType: type,
      snapshotTimestamp: Math.floor(Date.now() / 1000),
      whaleTrackingStats: stats.whaleTracking,
      volumeAnalysisStats: stats.volumeAnalysis,
      cachePerformance: stats.cachePerformance,
      systemHealth: stats.systemHealth,
      tradingPerformance: stats.tradingPerformance,
      customMetrics: stats.customMetrics,
      dataVersion: 1
    };
  }
}