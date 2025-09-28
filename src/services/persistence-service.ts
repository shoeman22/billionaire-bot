/**
 * Persistence Service
 *
 * Unified service for all database operations related to analytics data persistence.
 * Provides high-level abstractions over TypeORM repositories with intelligent caching,
 * batch operations, and performance optimization for trading bot analytics.
 */

import { Repository, DataSource, FindManyOptions, In, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { logger } from '../utils/logger';
import { getDataSource } from '../config/database';
import {
  WhaleWatchlist,
  WhaleAlert,
  VolumeGraphData,
  TransactionCache,
  VolumePattern,
  AnalyticsSnapshot,
  AlertType,
  AlertSeverity,
  VolumeResolution,
  // PatternType,
  // PatternStatus,
  SnapshotType
} from '../entities/analytics';

export interface PersistenceStats {
  whales: number;
  alerts: number;
  volumeData: number;
  cachedTransactions: number;
  patterns: number;
  snapshots: number;
  totalRecords: number;
  cacheEfficiency: number;
}

export interface WhaleFilters {
  priority?: 'low' | 'medium' | 'high' | 'critical';
  copyTrading?: boolean;
  isActive?: boolean;
  minProfitabilityScore?: number;
  maxProfitabilityScore?: number;
}

export interface VolumeDataQuery {
  poolHash?: string;
  duration?: VolumeResolution;
  startTime?: number;
  endTime?: number;
  limit?: number;
  orderBy?: 'startTime' | 'volume';
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Error classes for persistence operations
 */
export class PersistenceError extends Error {
  constructor(message: string, public operation?: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

/**
 * Unified Persistence Service
 *
 * Central service for all analytics data persistence operations with intelligent
 * caching, batch processing, and performance optimization.
 *
 * @example
 * ```typescript
 * const persistence = new PersistenceService();
 * await persistence.initialize();
 *
 * // Whale management
 * await persistence.addWhaleToWatchlist('client|123', 'high', true);
 * const whales = await persistence.getActiveWhales();
 *
 * // Volume data storage
 * await persistence.storeVolumeData(poolHash, volumeData);
 * const patterns = await persistence.detectVolumePatterns(poolHash);
 *
 * // Analytics snapshots
 * await persistence.createAnalyticsSnapshot('hourly', systemStats);
 * ```
 */
export class PersistenceService {
  private dataSource: DataSource | null = null;

  // Repository references
  private whaleWatchlistRepo!: Repository<WhaleWatchlist>;
  private whaleAlertRepo!: Repository<WhaleAlert>;
  private volumeGraphRepo!: Repository<VolumeGraphData>;
  private transactionCacheRepo!: Repository<TransactionCache>;
  private volumePatternRepo!: Repository<VolumePattern>;
  private analyticsSnapshotRepo!: Repository<AnalyticsSnapshot>;

  // Performance tracking
  private operationCounts = {
    reads: 0,
    writes: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  constructor() {
    logger.info('🗄️ Persistence Service created');
  }

  /**
   * Initialize the persistence service
   */
  async initialize(): Promise<void> {
    try {
      this.dataSource = await getDataSource();

      // Get repository references
      this.whaleWatchlistRepo = this.dataSource.getRepository(WhaleWatchlist);
      this.whaleAlertRepo = this.dataSource.getRepository(WhaleAlert);
      this.volumeGraphRepo = this.dataSource.getRepository(VolumeGraphData);
      this.transactionCacheRepo = this.dataSource.getRepository(TransactionCache);
      this.volumePatternRepo = this.dataSource.getRepository(VolumePattern);
      this.analyticsSnapshotRepo = this.dataSource.getRepository(AnalyticsSnapshot);

      // Cleanup expired cache entries on startup
      await this.cleanupExpiredCache();

      logger.info('✅ Persistence Service initialized successfully');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Persistence Service initialization failed:', errorMessage);
      throw new PersistenceError(`Initialization failed: ${errorMessage}`, 'initialize');
    }
  }

  // ===========================================
  // WHALE WATCHLIST OPERATIONS
  // ===========================================

  /**
   * Add whale to watchlist or update existing entry
   */
  async addWhaleToWatchlist(
    whaleAddress: string,
    priority: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    copyTrading: boolean = false,
    profitabilityScore: number = 0.5
  ): Promise<WhaleWatchlist> {
    // Validate inputs
    if (!whaleAddress || whaleAddress.trim() === '') {
      throw new PersistenceError('Whale address cannot be empty', 'addWhaleToWatchlist');
    }

    try {
      let whale = await this.whaleWatchlistRepo.findOne({
        where: { whaleAddress }
      });

      if (whale) {
        // Update existing whale
        whale.priority = priority;
        whale.copyTrading = copyTrading;
        whale.profitabilityScore = profitabilityScore;
        whale.updatedAt = new Date();
      } else {
        // Create new whale entry
        whale = this.whaleWatchlistRepo.create({
          whaleAddress,
          notes: `Added whale with ${priority} priority`,
          priority,
          copyTrading,
          profitabilityScore,
          isActive: true,
          addedAt: new Date()
        });
      }

      whale = await this.whaleWatchlistRepo.save(whale);
      this.operationCounts.writes++;

      logger.debug(`Whale watchlist updated: ${whaleAddress.substring(0, 12)}... (${priority})`);
      return whale;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to add whale to watchlist: ${errorMessage}`, 'addWhaleToWatchlist');
    }
  }

  /**
   * Get whales by filters
   */
  async getWhales(filters: WhaleFilters = {}): Promise<WhaleWatchlist[]> {
    try {
      const options: FindManyOptions<WhaleWatchlist> = {
        order: { profitabilityScore: 'DESC', addedAt: 'DESC' }
      };

      const whereConditions: Record<string, unknown> = {};

      if (filters.priority) whereConditions.priority = filters.priority;
      if (filters.copyTrading !== undefined) whereConditions.copyTrading = filters.copyTrading;
      if (filters.isActive !== undefined) whereConditions.isActive = filters.isActive;

      options.where = whereConditions;

      const whales = await this.whaleWatchlistRepo.find(options);

      // Apply numeric filters
      let filteredWhales = whales;
      if (filters.minProfitabilityScore !== undefined) {
        filteredWhales = filteredWhales.filter(w => (w.profitabilityScore ?? 0) >= filters.minProfitabilityScore!);
      }
      if (filters.maxProfitabilityScore !== undefined) {
        filteredWhales = filteredWhales.filter(w => (w.profitabilityScore ?? 1) <= filters.maxProfitabilityScore!);
      }

      this.operationCounts.reads++;
      return filteredWhales;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to get whales: ${errorMessage}`, 'getWhales');
    }
  }

  /**
   * Get active whales for copy trading
   */
  async getActiveWhales(): Promise<WhaleWatchlist[]> {
    return this.getWhales({ isActive: true, copyTrading: true });
  }

  /**
   * Remove whale from watchlist
   */
  async removeWhaleFromWatchlist(whaleAddress: string): Promise<boolean> {
    try {
      const result = await this.whaleWatchlistRepo.delete({ whaleAddress });
      this.operationCounts.writes++;

      logger.debug(`Whale removed from watchlist: ${whaleAddress.substring(0, 12)}...`);
      return (result.affected ?? 0) > 0;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to remove whale: ${errorMessage}`, 'removeWhaleFromWatchlist');
    }
  }

  // ===========================================
  // WHALE ALERT OPERATIONS
  // ===========================================

  /**
   * Create whale alert
   */
  async createWhaleAlert(
    whaleAddress: string,
    alertType: AlertType,
    severity: AlertSeverity,
    data: WhaleAlert['data'],
    _poolHash?: string
  ): Promise<WhaleAlert> {
    try {
      const alert = this.whaleAlertRepo.create({
        whaleAddress,
        alertType,
        severity,
        message: `${alertType} alert for whale ${whaleAddress}`,
        data,
        processed: false
      });

      const savedAlert = await this.whaleAlertRepo.save(alert);
      this.operationCounts.writes++;

      logger.debug(`Whale alert created: ${alertType} (${severity}) for ${whaleAddress.substring(0, 12)}...`);
      return savedAlert;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to create whale alert: ${errorMessage}`, 'createWhaleAlert');
    }
  }

  /**
   * Get unprocessed alerts
   */
  async getUnprocessedAlerts(limit: number = 50): Promise<WhaleAlert[]> {
    try {
      const alerts = await this.whaleAlertRepo.find({
        where: { processed: false },
        order: { createdAt: 'DESC' },
        take: limit
      });

      this.operationCounts.reads++;
      return alerts;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to get unprocessed alerts: ${errorMessage}`, 'getUnprocessedAlerts');
    }
  }

  /**
   * Mark alert as processed
   */
  async markAlertProcessed(alertId: number, resultingProfit?: number): Promise<void> {
    try {
      await this.whaleAlertRepo.update(alertId, {
        processed: true,
        processedAt: new Date(),
        resultingProfit
      });

      this.operationCounts.writes++;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to mark alert as processed: ${errorMessage}`, 'markAlertProcessed');
    }
  }

  // ===========================================
  // VOLUME DATA OPERATIONS
  // ===========================================

  /**
   * Store volume graph data
   */
  async storeVolumeData(volumeData: Partial<VolumeGraphData>[]): Promise<void> {
    try {
      // Use upsert to handle duplicates gracefully
      const entities = volumeData.map(data => this.volumeGraphRepo.create(data));

      for (const entity of entities) {
        await this.volumeGraphRepo.upsert(entity, ['poolHash', 'duration', 'startTime', 'endTime']);
      }

      this.operationCounts.writes += entities.length;
      logger.debug(`Stored ${entities.length} volume data points`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to store volume data: ${errorMessage}`, 'storeVolumeData');
    }
  }

  /**
   * Get volume data with flexible querying
   */
  async getVolumeData(query: VolumeDataQuery = {}): Promise<VolumeGraphData[]> {
    try {
      const options: FindManyOptions<VolumeGraphData> = {};
      const whereConditions: Record<string, unknown> = {};

      if (query.poolHash) whereConditions.poolHash = query.poolHash;
      if (query.duration) whereConditions.duration = query.duration;

      // Time range filters - find overlapping time ranges
      if (query.startTime !== undefined) {
        whereConditions.endTime = MoreThanOrEqual(query.startTime);
      }
      if (query.endTime !== undefined) {
        whereConditions.startTime = LessThanOrEqual(query.endTime);
      }

      options.where = Object.keys(whereConditions).length > 0 ? whereConditions : undefined;

      // Ordering
      const orderBy = query.orderBy || 'startTime';
      const orderDirection = query.orderDirection || 'ASC';
      options.order = { [orderBy]: orderDirection };

      // Limit
      if (query.limit) options.take = query.limit;

      const data = await this.volumeGraphRepo.find(options);
      this.operationCounts.reads++;

      return data;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to get volume data: ${errorMessage}`, 'getVolumeData');
    }
  }

  // ===========================================
  // TRANSACTION CACHE OPERATIONS
  // ===========================================

  /**
   * Store transaction cache entry
   */
  async storeTransactionCache(cacheEntry: Partial<TransactionCache>): Promise<TransactionCache> {
    try {
      const entity = this.transactionCacheRepo.create(cacheEntry);
      const saved = await this.transactionCacheRepo.save(entity);

      this.operationCounts.writes++;
      return saved;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to store transaction cache: ${errorMessage}`, 'storeTransactionCache');
    }
  }

  /**
   * Get cached transactions by key
   */
  async getCachedTransactions(cacheKey: string): Promise<TransactionCache | null> {
    try {
      const cached = await this.transactionCacheRepo.findOne({
        where: { cacheKey }
      });

      if (cached && !cached.isExpired) {
        cached.recordAccess();
        await this.transactionCacheRepo.save(cached);
        this.operationCounts.cacheHits++;
        return cached;
      }

      this.operationCounts.cacheMisses++;
      return null;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to get cached transactions: ${errorMessage}`, 'getCachedTransactions');
    }
  }

  // ===========================================
  // VOLUME PATTERN OPERATIONS
  // ===========================================

  /**
   * Store volume pattern
   */
  async storeVolumePattern(pattern: Partial<VolumePattern>): Promise<VolumePattern> {
    try {
      const entity = this.volumePatternRepo.create(pattern);
      const saved = await this.volumePatternRepo.save(entity);

      this.operationCounts.writes++;
      logger.debug(`Volume pattern stored: ${pattern.patternType} (${pattern.confidence})`);
      return saved;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to store volume pattern: ${errorMessage}`, 'storeVolumePattern');
    }
  }

  /**
   * Get active patterns for a pool
   */
  async getActivePatterns(poolHash: string): Promise<VolumePattern[]> {
    try {
      const patterns = await this.volumePatternRepo.find({
        where: {
          poolHash,
          status: In(['detected', 'confirmed'])
        },
        order: { confidence: 'DESC', detectedAt: 'DESC' }
      });

      this.operationCounts.reads++;
      return patterns;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to get active patterns: ${errorMessage}`, 'getActivePatterns');
    }
  }

  // ===========================================
  // ANALYTICS SNAPSHOT OPERATIONS
  // ===========================================

  /**
   * Create analytics snapshot
   */
  async createAnalyticsSnapshot(
    snapshotType: SnapshotType,
    stats: {
      whaleTracking: AnalyticsSnapshot['whaleTrackingStats'];
      volumeAnalysis: AnalyticsSnapshot['volumeAnalysisStats'];
      cachePerformance: AnalyticsSnapshot['cachePerformance'];
      systemHealth: AnalyticsSnapshot['systemHealth'];
      tradingPerformance?: AnalyticsSnapshot['tradingPerformance'];
      customMetrics?: AnalyticsSnapshot['customMetrics'];
    },
    poolHash?: string
  ): Promise<AnalyticsSnapshot> {
    try {
      const snapshotData = AnalyticsSnapshot.createSnapshot(snapshotType, poolHash, stats);
      const entity = this.analyticsSnapshotRepo.create(snapshotData);
      const saved = await this.analyticsSnapshotRepo.save(entity);

      this.operationCounts.writes++;
      logger.debug(`Analytics snapshot created: ${snapshotType} (health: ${saved.healthScore.toFixed(2)})`);
      return saved;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to create analytics snapshot: ${errorMessage}`, 'createAnalyticsSnapshot');
    }
  }

  /**
   * Get latest snapshots
   */
  async getLatestSnapshots(type?: SnapshotType, limit: number = 10): Promise<AnalyticsSnapshot[]> {
    try {
      const options: FindManyOptions<AnalyticsSnapshot> = {
        order: { createdAt: 'DESC' },
        take: limit
      };

      if (type) {
        options.where = { snapshotType: type };
      }

      const snapshots = await this.analyticsSnapshotRepo.find(options);
      this.operationCounts.reads++;

      return snapshots;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to get latest snapshots: ${errorMessage}`, 'getLatestSnapshots');
    }
  }

  // ===========================================
  // UTILITY OPERATIONS
  // ===========================================

  /**
   * Get comprehensive persistence statistics
   */
  async getStats(): Promise<PersistenceStats> {
    try {
      const [
        whaleCount,
        alertCount,
        volumeDataCount,
        cacheCount,
        patternCount,
        snapshotCount
      ] = await Promise.all([
        this.whaleWatchlistRepo.count(),
        this.whaleAlertRepo.count(),
        this.volumeGraphRepo.count(),
        this.transactionCacheRepo.count(),
        this.volumePatternRepo.count(),
        this.analyticsSnapshotRepo.count()
      ]);

      const totalRecords = whaleCount + alertCount + volumeDataCount + cacheCount + patternCount + snapshotCount;
      const totalCacheRequests = this.operationCounts.cacheHits + this.operationCounts.cacheMisses;
      const cacheEfficiency = totalCacheRequests > 0 ? this.operationCounts.cacheHits / totalCacheRequests : 0;

      return {
        whales: whaleCount,
        alerts: alertCount,
        volumeData: volumeDataCount,
        cachedTransactions: cacheCount,
        patterns: patternCount,
        snapshots: snapshotCount,
        totalRecords,
        cacheEfficiency
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PersistenceError(`Failed to get persistence stats: ${errorMessage}`, 'getStats');
    }
  }

  /**
   * Cleanup expired cache entries
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      const result = await this.transactionCacheRepo
        .createQueryBuilder()
        .delete()
        .where('expiresAt < :now', { now: new Date() })
        .execute();

      const deletedCount = result.affected || 0;
      if (deletedCount > 0) {
        logger.debug(`Cleaned up ${deletedCount} expired transaction cache entries`);
      }

      return deletedCount;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Cache cleanup failed: ${errorMessage}`);
      return 0;
    }
  }

  /**
   * Reset all operation counters
   */
  resetOperationCounters(): void {
    this.operationCounts = {
      reads: 0,
      writes: 0,
      cacheHits: 0,
      cacheMisses: 0
    };

    logger.debug('Persistence operation counters reset');
  }

  /**
   * Get operation performance metrics
   */
  getOperationMetrics(): {
    reads: number;
    writes: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
    totalOperations: number;
  } {
    const totalOperations = this.operationCounts.reads + this.operationCounts.writes;
    const totalCacheRequests = this.operationCounts.cacheHits + this.operationCounts.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 ? this.operationCounts.cacheHits / totalCacheRequests : 0;

    return {
      ...this.operationCounts,
      cacheHitRate,
      totalOperations
    };
  }

  /**
   * Close the persistence service
   */
  async close(): Promise<void> {
    // The data source is shared, so we don't close it here
    // This is handled by the application lifecycle
    logger.info('Persistence Service closed');
  }
}

/**
 * Create a persistence service with default configuration
 */
export async function createPersistenceService(): Promise<PersistenceService> {
  const service = new PersistenceService();
  await service.initialize();
  return service;
}

/**
 * Utility functions for data transformation
 */
export class PersistenceUtils {
  /**
   * Convert API volume data to database entities
   */
  static volumeDataToEntities(
    poolHash: string,
    duration: VolumeResolution,
    apiData: Array<{ startTime: number; endTime: number; midTime: number; volume: number }>
  ): Partial<VolumeGraphData>[] {
    return apiData.map(point => ({
      poolHash,
      duration,
      startTime: point.startTime,
      endTime: point.endTime,
      midTime: point.midTime,
      volume: point.volume,
      isComplete: true
    }));
  }

  /**
   * Calculate cache key for transaction data
   */
  static generateTransactionCacheKey(
    poolHash: string,
    userAddress: string | undefined,
    params: Record<string, unknown>
  ): string {
    const keyData = {
      poolHash,
      userAddress: userAddress || 'all',
      ...params
    };

    // Create deterministic hash of parameters
    const sortedKeys = Object.keys(keyData).sort();
    const keyString = sortedKeys.map(key => `${key}:${String((keyData as Record<string, unknown>)[key])}`).join('|');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < keyString.length; i++) {
      const char = keyString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return `tx_cache_${Math.abs(hash).toString(36)}`;
  }
}