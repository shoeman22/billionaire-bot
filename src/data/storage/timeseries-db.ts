/**
 * Time-Series Database Storage
 * Optimized storage and retrieval for price and market data
 */

import { Repository } from 'typeorm';
import { getDataSource } from '../../config/database';
import { PriceHistory, PriceOHLCV, PriceStatistics, IntervalType, StatisticType, StatisticPeriod } from '../../entities/analytics';
import { logger } from '../../utils/logger';
import { safeParseFloat } from '../../utils/safe-parse';

export interface PricePoint {
  token: string;
  timestamp: number;
  price: number;
  volume24h?: number;
  marketCap?: number;
  priceChange24h?: number;
  source?: string;
}

export interface OHLCVData {
  token: string;
  intervalStart: number;
  intervalType: IntervalType;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount?: number;
}

export interface StatisticData {
  token: string;
  statisticType: StatisticType;
  period: StatisticPeriod;
  timestamp: number;
  value: number;
  secondaryValue?: number;
  tertiaryValue?: number;
  metadata?: Record<string, any>;
}

export interface PriceQueryOptions {
  startTime?: number;
  endTime?: number;
  limit?: number;
  orderBy?: 'ASC' | 'DESC';
  source?: string;
}

export interface OHLCVQueryOptions {
  startTime?: number;
  endTime?: number;
  limit?: number;
  intervalType?: IntervalType;
  orderBy?: 'ASC' | 'DESC';
}

export interface StatisticsQueryOptions {
  startTime?: number;
  endTime?: number;
  limit?: number;
  statisticType?: StatisticType;
  period?: StatisticPeriod;
  orderBy?: 'ASC' | 'DESC';
}

export class TimeSeriesDB {
  private priceHistoryRepo!: Repository<PriceHistory>;
  private priceOHLCVRepo!: Repository<PriceOHLCV>;
  private priceStatisticsRepo!: Repository<PriceStatistics>;
  private isInitialized = false;

  constructor() {}

  /**
   * Initialize database repositories
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const dataSource = await getDataSource();

      this.priceHistoryRepo = dataSource.getRepository(PriceHistory);
      this.priceOHLCVRepo = dataSource.getRepository(PriceOHLCV);
      this.priceStatisticsRepo = dataSource.getRepository(PriceStatistics);

      this.isInitialized = true;
      logger.info('✅ TimeSeriesDB initialized successfully');

    } catch (error) {
      logger.error('❌ Failed to initialize TimeSeriesDB:', error);
      throw error;
    }
  }

  /**
   * Store price data point
   */
  async storePricePoint(pricePoint: PricePoint): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    try {
      const entity = new PriceHistory();
      entity.token = pricePoint.token;
      entity.timestamp = pricePoint.timestamp;
      entity.setPriceUsd(pricePoint.price);
      entity.setVolume24h(pricePoint.volume24h || null);
      entity.setMarketCap(pricePoint.marketCap || null);
      entity.setPriceChange24h(pricePoint.priceChange24h || null);
      entity.source = pricePoint.source || 'galaswap_api';

      await this.priceHistoryRepo.save(entity);

      logger.debug(`✅ Stored price point: ${entity.token} = $${entity.getPriceUsd()} at ${new Date(entity.timestamp).toISOString()}`);

    } catch (error) {
      // Handle unique constraint violations gracefully (duplicate data)
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        logger.debug(`Price point already exists: ${pricePoint.token} at ${new Date(pricePoint.timestamp).toISOString()}`);
        return;
      }

      logger.error(`❌ Failed to store price point for ${pricePoint.token}:`, error);
      throw error;
    }
  }

  /**
   * Store multiple price points in batch
   */
  async storePricePoints(pricePoints: PricePoint[]): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    if (pricePoints.length === 0) return;

    try {
      const entities = pricePoints.map(point => {
        const entity = new PriceHistory();
        entity.token = point.token;
        entity.timestamp = point.timestamp;
        entity.setPriceUsd(point.price);
        entity.setVolume24h(point.volume24h || null);
        entity.setMarketCap(point.marketCap || null);
        entity.setPriceChange24h(point.priceChange24h || null);
        entity.source = point.source || 'galaswap_api';
        return entity;
      });

      // Use upsert to handle duplicates gracefully
      await this.priceHistoryRepo.upsert(entities, {
        conflictPaths: ['token', 'timestamp', 'source'],
        skipUpdateIfNoValuesChanged: true
      });

      logger.info(`✅ Stored ${entities.length} price points in batch`);

    } catch (error) {
      logger.error('❌ Failed to store price points batch:', error);
      throw error;
    }
  }

  /**
   * Get price history for a token
   */
  async getPriceHistory(token: string, options: PriceQueryOptions = {}): Promise<PriceHistory[]> {
    if (!this.isInitialized) await this.initialize();

    try {
      const query = this.priceHistoryRepo
        .createQueryBuilder('ph')
        .where('ph.token = :token', { token: token.toUpperCase() });

      if (options.startTime) {
        query.andWhere('ph.timestamp >= :startTime', { startTime: options.startTime });
      }

      if (options.endTime) {
        query.andWhere('ph.timestamp <= :endTime', { endTime: options.endTime });
      }

      if (options.source) {
        query.andWhere('ph.source = :source', { source: options.source });
      }

      query.orderBy('ph.timestamp', options.orderBy || 'ASC');

      if (options.limit) {
        query.limit(options.limit);
      }

      const results = await query.getMany();
      logger.debug(`Retrieved ${results.length} price history records for ${token}`);

      return results;

    } catch (error) {
      logger.error(`❌ Failed to get price history for ${token}:`, error);
      throw error;
    }
  }

  /**
   * Store OHLCV data
   */
  async storeOHLCV(ohlcvData: OHLCVData): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    try {
      const entity = new PriceOHLCV();
      entity.token = ohlcvData.token;
      entity.interval_start = ohlcvData.intervalStart;
      entity.interval_type = ohlcvData.intervalType;
      entity.setOpenPrice(ohlcvData.open);
      entity.setHighPrice(ohlcvData.high);
      entity.setLowPrice(ohlcvData.low);
      entity.setClosePrice(ohlcvData.close);
      entity.setVolume(ohlcvData.volume);
      entity.trade_count = ohlcvData.tradeCount || 0;

      await this.priceOHLCVRepo.save(entity);

      logger.debug(`✅ Stored OHLCV: ${entity.token} ${entity.interval_type} O:${entity.getOpenPrice()} H:${entity.getHighPrice()} L:${entity.getLowPrice()} C:${entity.getClosePrice()}`);

    } catch (error) {
      // Handle unique constraint violations gracefully
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        logger.debug(`OHLCV data already exists: ${ohlcvData.token} ${ohlcvData.intervalType} at ${new Date(ohlcvData.intervalStart).toISOString()}`);
        return;
      }

      logger.error(`❌ Failed to store OHLCV data for ${ohlcvData.token}:`, error);
      throw error;
    }
  }

  /**
   * Get OHLCV data for a token
   */
  async getOHLCV(token: string, options: OHLCVQueryOptions = {}): Promise<PriceOHLCV[]> {
    if (!this.isInitialized) await this.initialize();

    try {
      const query = this.priceOHLCVRepo
        .createQueryBuilder('ohlcv')
        .where('ohlcv.token = :token', { token: token.toUpperCase() });

      if (options.startTime) {
        query.andWhere('ohlcv.interval_start >= :startTime', { startTime: options.startTime });
      }

      if (options.endTime) {
        query.andWhere('ohlcv.interval_start <= :endTime', { endTime: options.endTime });
      }

      if (options.intervalType) {
        query.andWhere('ohlcv.interval_type = :intervalType', { intervalType: options.intervalType });
      }

      query.orderBy('ohlcv.interval_start', options.orderBy || 'ASC');

      if (options.limit) {
        query.limit(options.limit);
      }

      const results = await query.getMany();
      logger.debug(`Retrieved ${results.length} OHLCV records for ${token}`);

      return results;

    } catch (error) {
      logger.error(`❌ Failed to get OHLCV data for ${token}:`, error);
      throw error;
    }
  }

  /**
   * Store statistical data
   */
  async storeStatistic(statisticData: StatisticData): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    try {
      const entity = new PriceStatistics();
      entity.token = statisticData.token;
      entity.statistic_type = statisticData.statisticType;
      entity.period = statisticData.period;
      entity.timestamp = statisticData.timestamp;
      entity.setValue(statisticData.value);
      entity.setSecondaryValue(statisticData.secondaryValue || null);
      entity.setTertiaryValue(statisticData.tertiaryValue || null);
      entity.metadata = statisticData.metadata || {};

      await this.priceStatisticsRepo.save(entity);

      logger.debug(`✅ Stored statistic: ${entity.token} ${entity.statistic_type} (${entity.period}) = ${entity.getValue()}`);

    } catch (error) {
      // Handle unique constraint violations gracefully
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        logger.debug(`Statistic already exists: ${statisticData.token} ${statisticData.statisticType} (${statisticData.period}) at ${new Date(statisticData.timestamp).toISOString()}`);
        return;
      }

      logger.error(`❌ Failed to store statistic for ${statisticData.token}:`, error);
      throw error;
    }
  }

  /**
   * Get statistics for a token
   */
  async getStatistics(token: string, options: StatisticsQueryOptions = {}): Promise<PriceStatistics[]> {
    if (!this.isInitialized) await this.initialize();

    try {
      const query = this.priceStatisticsRepo
        .createQueryBuilder('stats')
        .where('stats.token = :token', { token: token.toUpperCase() });

      if (options.startTime) {
        query.andWhere('stats.timestamp >= :startTime', { startTime: options.startTime });
      }

      if (options.endTime) {
        query.andWhere('stats.timestamp <= :endTime', { endTime: options.endTime });
      }

      if (options.statisticType) {
        query.andWhere('stats.statistic_type = :statisticType', { statisticType: options.statisticType });
      }

      if (options.period) {
        query.andWhere('stats.period = :period', { period: options.period });
      }

      query.orderBy('stats.timestamp', options.orderBy || 'ASC');

      if (options.limit) {
        query.limit(options.limit);
      }

      const results = await query.getMany();
      logger.debug(`Retrieved ${results.length} statistics records for ${token}`);

      return results;

    } catch (error) {
      logger.error(`❌ Failed to get statistics for ${token}:`, error);
      throw error;
    }
  }

  /**
   * Get latest price for a token
   */
  async getLatestPrice(token: string): Promise<PriceHistory | null> {
    if (!this.isInitialized) await this.initialize();

    try {
      const result = await this.priceHistoryRepo
        .createQueryBuilder('ph')
        .where('ph.token = :token', { token: token.toUpperCase() })
        .orderBy('ph.timestamp', 'DESC')
        .limit(1)
        .getOne();

      return result;

    } catch (error) {
      logger.error(`❌ Failed to get latest price for ${token}:`, error);
      throw error;
    }
  }

  /**
   * Calculate price volatility for a token over a period
   */
  async calculateVolatility(token: string, periodMs: number): Promise<number> {
    if (!this.isInitialized) await this.initialize();

    try {
      const endTime = Date.now();
      const startTime = endTime - periodMs;

      const prices = await this.getPriceHistory(token, {
        startTime,
        endTime,
        orderBy: 'ASC'
      });

      if (prices.length < 2) return 0;

      // Calculate returns
      const returns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        const prevPrice = prices[i - 1].getPriceUsd();
        const currentPrice = prices[i].getPriceUsd();
        const return_ = (currentPrice - prevPrice) / prevPrice;
        returns.push(return_);
      }

      // Calculate standard deviation of returns
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);

      // Annualize volatility (assuming daily data)
      const annualizedVolatility = volatility * Math.sqrt(365);

      return annualizedVolatility;

    } catch (error) {
      logger.error(`❌ Failed to calculate volatility for ${token}:`, error);
      return 0;
    }
  }

  /**
   * Clean up old data (older than specified days)
   */
  async cleanupOldData(retentionDays: number = 30): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    try {
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

      // Clean price history
      const priceDeleteResult = await this.priceHistoryRepo
        .createQueryBuilder()
        .delete()
        .where('timestamp < :cutoffTime', { cutoffTime })
        .execute();

      // Clean OHLCV data
      const ohlcvDeleteResult = await this.priceOHLCVRepo
        .createQueryBuilder()
        .delete()
        .where('interval_start < :cutoffTime', { cutoffTime })
        .execute();

      // Clean statistics (keep longer for analysis)
      const statsRetentionDays = retentionDays * 2; // Keep stats twice as long
      const statsCutoffTime = Date.now() - (statsRetentionDays * 24 * 60 * 60 * 1000);
      const statsDeleteResult = await this.priceStatisticsRepo
        .createQueryBuilder()
        .delete()
        .where('timestamp < :cutoffTime', { cutoffTime: statsCutoffTime })
        .execute();

      logger.info(`✅ Cleanup complete: deleted ${priceDeleteResult.affected} price records, ${ohlcvDeleteResult.affected} OHLCV records, ${statsDeleteResult.affected} statistics records older than ${retentionDays} days`);

    } catch (error) {
      logger.error('❌ Failed to cleanup old data:', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<{
    priceHistoryCount: number;
    ohlcvCount: number;
    statisticsCount: number;
    tokensTracked: number;
    oldestRecord: Date | null;
    newestRecord: Date | null;
  }> {
    if (!this.isInitialized) await this.initialize();

    try {
      const [
        priceHistoryCount,
        ohlcvCount,
        statisticsCount,
        tokensResult,
        oldestResult,
        newestResult
      ] = await Promise.all([
        this.priceHistoryRepo.count(),
        this.priceOHLCVRepo.count(),
        this.priceStatisticsRepo.count(),
        this.priceHistoryRepo
          .createQueryBuilder('ph')
          .select('COUNT(DISTINCT ph.token)', 'count')
          .getRawOne(),
        this.priceHistoryRepo
          .createQueryBuilder('ph')
          .select('MIN(ph.timestamp)', 'timestamp')
          .getRawOne(),
        this.priceHistoryRepo
          .createQueryBuilder('ph')
          .select('MAX(ph.timestamp)', 'timestamp')
          .getRawOne()
      ]);

      return {
        priceHistoryCount,
        ohlcvCount,
        statisticsCount,
        tokensTracked: parseInt(tokensResult.count) || 0,
        oldestRecord: oldestResult.timestamp ? new Date(parseInt(oldestResult.timestamp)) : null,
        newestRecord: newestResult.timestamp ? new Date(parseInt(newestResult.timestamp)) : null
      };

    } catch (error) {
      logger.error('❌ Failed to get database statistics:', error);
      throw error;
    }
  }

  /**
   * Create OHLCV data from price history
   */
  async aggregateOHLCVFromHistory(
    token: string,
    intervalType: IntervalType,
    startTime: number,
    endTime: number
  ): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    try {
      const intervalMs = this.getIntervalMs(intervalType);
      const priceData = await this.getPriceHistory(token, {
        startTime,
        endTime,
        orderBy: 'ASC'
      });

      if (priceData.length === 0) return;

      // Group price data by intervals
      const intervals = new Map<number, PriceHistory[]>();

      for (const price of priceData) {
        const intervalStart = Math.floor(price.timestamp / intervalMs) * intervalMs;
        if (!intervals.has(intervalStart)) {
          intervals.set(intervalStart, []);
        }
        intervals.get(intervalStart)!.push(price);
      }

      // Create OHLCV records for each interval
      for (const [intervalStart, prices] of intervals) {
        if (prices.length === 0) continue;

        const sortedPrices = prices.sort((a, b) => a.timestamp - b.timestamp);
        const open = sortedPrices[0].getPriceUsd();
        const close = sortedPrices[sortedPrices.length - 1].getPriceUsd();
        const high = Math.max(...sortedPrices.map(p => p.getPriceUsd()));
        const low = Math.min(...sortedPrices.map(p => p.getPriceUsd()));
        const volume = sortedPrices.reduce((sum, p) => sum + (p.getVolume24h() || 0), 0);

        await this.storeOHLCV({
          token,
          intervalStart,
          intervalType,
          open,
          high,
          low,
          close,
          volume,
          tradeCount: sortedPrices.length
        });
      }

      logger.info(`✅ Created ${intervals.size} OHLCV records for ${token} (${intervalType})`);

    } catch (error) {
      logger.error(`❌ Failed to aggregate OHLCV for ${token}:`, error);
      throw error;
    }
  }

  /**
   * Get interval duration in milliseconds
   */
  private getIntervalMs(intervalType: IntervalType): number {
    switch (intervalType) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '30m': return 30 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case '1d': return 24 * 60 * 60 * 1000;
      case '1w': return 7 * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }
}

// Export singleton instance
export const timeSeriesDB = new TimeSeriesDB();