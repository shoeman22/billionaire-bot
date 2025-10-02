/**
 * Whale Tracker Service
 *
 * Specialized service for tracking and analyzing whale trader behavior.
 * Monitors large traders, identifies patterns, and provides copy-trading
 * signals for profitable arbitrage opportunities.
 */

import { logger } from '../utils/logger';
import { createTransactionHistoryClient, TransactionHistoryClient } from '../api/transaction-history-client';
import { PersistenceService, createPersistenceService } from '../services/persistence-service';
import { getActiveWhales } from '../config/configuration';
import { AlertType, AlertSeverity } from '../entities/analytics';
import {
  TransactionRecord
} from '../api/types';

export interface WhaleAlert {
  whaleAddress: string;
  alertType: 'entry' | 'exit' | 'accumulation' | 'distribution' | 'pattern_change';
  poolHash: string;
  token0: string;
  token1: string;
  volume: number;
  confidence: number;
  timestamp: string;
  reasoning: string[];
  actionRecommendation: {
    action: 'copy' | 'counter' | 'watch' | 'ignore';
    urgency: 'immediate' | 'high' | 'medium' | 'low';
    positionSize: 'large' | 'medium' | 'small';
  };
}

export interface WhaleWatchlist {
  whaleAddress: string;
  addedAt: string;
  totalVolume: number;
  winRate: number;
  averageProfit: number;
  lastActivity: string;
  alertsGenerated: number;
  status: 'active' | 'inactive' | 'blacklisted';
  notes: string;
}

export interface WhalePortfolio {
  whaleAddress: string;
  positions: Array<{
    poolHash: string;
    token0: string;
    token1: string;
    netAmount0: number;
    netAmount1: number;
    totalVolume: number;
    entryTime: string;
    lastUpdate: string;
    estimatedPnL: number;
  }>;
  totalVolume: number;
  activePositions: number;
  profitability: number;
}

/**
 * Whale Tracker Service
 *
 * Monitors whale trader behavior and generates actionable trading signals.
 * Tracks entry/exit patterns, identifies accumulation phases, and provides
 * copy-trading recommendations for profitable arbitrage strategies.
 *
 * @example
 * ```typescript
 * const whaleTracker = new WhaleTracker();
 *
 * // Add whale to watchlist
 * await whaleTracker.addToWatchlist('client|64f8caf887fd8551315d8509');
 *
 * // Monitor for alerts
 * const alerts = await whaleTracker.checkForAlerts();
 *
 * // Get whale portfolio
 * const portfolio = await whaleTracker.getWhalePortfolio('client|64f8caf887fd8551315d8509');
 * ```
 */
export class WhaleTracker {
  private historyClient: TransactionHistoryClient;
  private persistence: PersistenceService | null = null;
  private watchlist: Map<string, WhaleWatchlist> = new Map();
  private recentAlerts: WhaleAlert[] = [];
  private portfolioCache: Map<string, { portfolio: WhalePortfolio; timestamp: number }> = new Map();
  private readonly PORTFOLIO_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_ALERTS = 100; // Keep last 100 alerts

  constructor(historyClient?: TransactionHistoryClient, persistenceService?: PersistenceService) {
    this.historyClient = historyClient || createTransactionHistoryClient();
    this.persistence = persistenceService || null;

    // Initialize watchlist and persistence (async initialization required)
    this.initializeAsync();

    logger.info('🐋 Whale Tracker Service initialized', {
      watchlistSize: this.watchlist.size
    });
  }

  /**
   * Initialize persistence service and load configuration
   */
  private async initializeAsync(): Promise<void> {
    try {
      // Initialize persistence service if not provided
      if (!this.persistence) {
        this.persistence = await createPersistenceService();
      }

      // Load watchlist from configuration and database
      await this.initializeWatchlist();

      // Start monitoring interval
      this.startMonitoring();

      logger.info('✅ Whale Tracker async initialization complete');

    } catch (error) {
      logger.error('❌ Whale Tracker async initialization failed:', error);
      // Continue without persistence if it fails
      this.persistence = null;

      // Fallback to hardcoded initialization
      this.initializeWatchlistFallback();
      this.startMonitoring();
    }
  }

  /**
   * Add a whale to the watchlist
   */
  async addToWatchlist(whaleAddress: string, notes: string = ''): Promise<void> {
    if (this.watchlist.has(whaleAddress)) {
      logger.warn(`Whale ${whaleAddress.substring(0, 12)} already in watchlist`);
      return;
    }

    try {
      // Get recent activity to validate the whale
      const recentHistory = await this.historyClient.getUserHistory(whaleAddress, {
        limit: 100,
        fromTime: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString() // Last 7 days
      });

      if (recentHistory.length === 0) {
        throw new Error('No recent trading activity found');
      }

      const totalVolume = recentHistory.reduce((sum, tx) => sum + tx.volume, 0);
      const winRate = this.calculateWinRate(recentHistory);
      const averageProfit = this.estimateAverageProfit(recentHistory);

      const watchlistEntry: WhaleWatchlist = {
        whaleAddress,
        addedAt: new Date().toISOString(),
        totalVolume,
        winRate,
        averageProfit,
        lastActivity: recentHistory[0]?.transactionTime || new Date().toISOString(),
        alertsGenerated: 0,
        status: 'active',
        notes
      };

      this.watchlist.set(whaleAddress, watchlistEntry);

      // Save to database if persistence is available
      if (this.persistence) {
        try {
          await this.persistence.addWhaleToWatchlist(
            whaleAddress,
            'medium', // Default priority
            false, // Default copy trading
            averageProfit / 100 // Convert percentage to decimal
          );
        } catch (error) {
          logger.warn(`Failed to save whale to database: ${error}`);
        }
      }

      logger.info(`✅ Added whale to watchlist: ${whaleAddress.substring(0, 12)}`, {
        totalVolume,
        winRate,
        recentTrades: recentHistory.length
      });

    } catch (error) {
      logger.error(`Failed to add whale ${whaleAddress.substring(0, 12)} to watchlist:`, error);
      throw error;
    }
  }

  /**
   * Remove whale from watchlist
   */
  async removeFromWatchlist(whaleAddress: string): Promise<void> {
    if (this.watchlist.delete(whaleAddress)) {
      logger.info(`Removed whale from watchlist: ${whaleAddress.substring(0, 12)}`);

      // Remove from database if persistence is available
      if (this.persistence) {
        try {
          await this.persistence.removeWhaleFromWatchlist(whaleAddress);
        } catch (error) {
          logger.warn(`Failed to remove whale from database: ${error}`);
        }
      }
    } else {
      logger.warn(`Whale not found in watchlist: ${whaleAddress.substring(0, 12)}`);
    }
  }

  /**
   * Get current watchlist
   */
  getWatchlist(): WhaleWatchlist[] {
    return Array.from(this.watchlist.values())
      .sort((a, b) => b.totalVolume - a.totalVolume);
  }

  /**
   * Check for new whale alerts
   */
  async checkForAlerts(): Promise<WhaleAlert[]> {
    const newAlerts: WhaleAlert[] = [];

    logger.debug(`Checking for alerts across ${this.watchlist.size} tracked whales`);

    for (const [whaleAddress, watchlistEntry] of this.watchlist.entries()) {
      if (watchlistEntry.status !== 'active') continue;

      try {
        // Get recent transactions (last 2 hours)
        const recentTxs = await this.historyClient.getUserHistory(whaleAddress, {
          limit: 50,
          fromTime: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString()
        });

        if (recentTxs.length === 0) continue;

        // Analyze for alerts
        const alerts = await this.analyzeWhaleActivity(whaleAddress, recentTxs);
        newAlerts.push(...alerts);

        // Update watchlist entry
        watchlistEntry.lastActivity = recentTxs[0].transactionTime;
        watchlistEntry.alertsGenerated += alerts.length;

      } catch (error) {
        logger.warn(`Failed to check alerts for whale ${whaleAddress.substring(0, 12)}:`, error);
      }
    }

    // Add new alerts to recent alerts list
    this.recentAlerts.unshift(...newAlerts);

    // Keep only recent alerts
    if (this.recentAlerts.length > this.MAX_ALERTS) {
      this.recentAlerts = this.recentAlerts.slice(0, this.MAX_ALERTS);
    }

    if (newAlerts.length > 0) {
      logger.info(`🚨 Generated ${newAlerts.length} whale alerts`, {
        immediate: newAlerts.filter(a => a.actionRecommendation.urgency === 'immediate').length,
        high: newAlerts.filter(a => a.actionRecommendation.urgency === 'high').length
      });
    }

    return newAlerts;
  }

  /**
   * Get whale portfolio analysis
   */
  async getWhalePortfolio(whaleAddress: string): Promise<WhalePortfolio> {
    // Check cache first
    const cached = this.portfolioCache.get(whaleAddress);
    if (cached && (Date.now() - cached.timestamp) < this.PORTFOLIO_CACHE_TTL) {
      return cached.portfolio;
    }

    try {
      // Get comprehensive trading history (last 30 days)
      const history = await this.historyClient.getUserHistory(whaleAddress, {
        limit: 1000,
        fromTime: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString()
      });

      // Group by pool and calculate net positions
      const poolPositions = new Map<string, {
        poolHash: string;
        token0: string;
        token1: string;
        amount0: number;
        amount1: number;
        volume: number;
        trades: TransactionRecord[];
      }>();

      for (const tx of history) {
        const key = `${tx.poolHash}-${tx.token0}-${tx.token1}`;

        if (!poolPositions.has(key)) {
          poolPositions.set(key, {
            poolHash: tx.poolHash,
            token0: tx.token0,
            token1: tx.token1,
            amount0: 0,
            amount1: 0,
            volume: 0,
            trades: []
          });
        }

        const position = poolPositions.get(key)!;
        position.amount0 += tx.amount0;
        position.amount1 += tx.amount1;
        position.volume += tx.volume;
        position.trades.push(tx);
      }

      // Convert to portfolio positions
      const positions = Array.from(poolPositions.values()).map(pos => ({
        poolHash: pos.poolHash,
        token0: pos.token0,
        token1: pos.token1,
        netAmount0: pos.amount0,
        netAmount1: pos.amount1,
        totalVolume: pos.volume,
        entryTime: pos.trades[pos.trades.length - 1].transactionTime, // First trade
        lastUpdate: pos.trades[0].transactionTime, // Most recent trade
        estimatedPnL: this.estimatePositionPnL(pos.trades)
      }));

      const totalVolume = positions.reduce((sum, pos) => sum + pos.totalVolume, 0);
      const activePositions = positions.filter(pos =>
        Math.abs(pos.netAmount0) > 0.01 || Math.abs(pos.netAmount1) > 0.01
      ).length;

      const profitability = positions.reduce((sum, pos) => sum + pos.estimatedPnL, 0) / totalVolume * 100;

      const portfolio: WhalePortfolio = {
        whaleAddress,
        positions,
        totalVolume,
        activePositions,
        profitability
      };

      // Cache the result
      this.portfolioCache.set(whaleAddress, {
        portfolio,
        timestamp: Date.now()
      });

      return portfolio;

    } catch (error) {
      logger.error(`Failed to get whale portfolio for ${whaleAddress.substring(0, 12)}:`, error);
      throw error;
    }
  }

  /**
   * Get recent alerts (last 24 hours)
   */
  getRecentAlerts(hours: number = 24): WhaleAlert[] {
    const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));

    return this.recentAlerts.filter(alert =>
      new Date(alert.timestamp) > cutoff
    );
  }

  /**
   * Get whale performance metrics
   */
  async getWhalePerformance(whaleAddress: string): Promise<{
    totalVolume: number;
    tradeCount: number;
    winRate: number;
    averageProfit: number;
    sharpeRatio: number;
    maxDrawdown: number;
    consistency: number;
  }> {
    const history = await this.historyClient.getUserHistory(whaleAddress, {
      limit: 500,
      fromTime: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString()
    });

    const totalVolume = history.reduce((sum, tx) => sum + tx.volume, 0);
    const tradeCount = history.length;
    const winRate = this.calculateWinRate(history);
    const averageProfit = this.estimateAverageProfit(history);
    const sharpeRatio = this.calculateSharpeRatio(history);
    const maxDrawdown = this.calculateMaxDrawdown(history);
    const consistency = this.calculateConsistency(history);

    return {
      totalVolume,
      tradeCount,
      winRate,
      averageProfit,
      sharpeRatio,
      maxDrawdown,
      consistency
    };
  }

  /**
   * Private helper methods
   */
  /**
   * Initialize watchlist from configuration and database
   */
  private async initializeWatchlist(): Promise<void> {
    try {
      // Load whales from configuration
      const configWhales = await getActiveWhales();

      logger.info(`Loading ${configWhales.length} whales from configuration`);

      for (const whaleConfig of configWhales) {
        // Create watchlist entry from configuration
        const watchlistEntry: WhaleWatchlist = {
          whaleAddress: whaleConfig.address,
          addedAt: whaleConfig.addedAt,
          totalVolume: whaleConfig.averageTradeSize * 10, // Estimate based on average trade size
          winRate: whaleConfig.winRate * 100, // Convert to percentage
          averageProfit: whaleConfig.profitabilityScore * 20, // Estimate profit percentage
          lastActivity: new Date().toISOString(),
          alertsGenerated: 0,
          status: 'active',
          notes: whaleConfig.notes
        };

        this.watchlist.set(whaleConfig.address, watchlistEntry);

        // Ensure whale exists in database
        if (this.persistence) {
          try {
            await this.persistence.addWhaleToWatchlist(
              whaleConfig.address,
              whaleConfig.priority,
              whaleConfig.copyTrading,
              whaleConfig.profitabilityScore
            );
          } catch (error) {
            logger.warn(`Failed to sync whale to database: ${whaleConfig.address.substring(0, 12)}: ${error}`);
          }
        }
      }

      logger.info(`✅ Initialized watchlist with ${this.watchlist.size} whales`);

    } catch (error) {
      logger.error('Failed to initialize watchlist from configuration:', error);
      // Fallback to hardcoded initialization
      this.initializeWatchlistFallback();
    }
  }

  /**
   * Fallback initialization with hardcoded whales
   */
  private initializeWatchlistFallback(): void {
    logger.warn('Using fallback whale initialization');

    // Initialize with known high-volume whales from the transaction data
    const knownWhales = [
      { address: 'client|64f8caf887fd8551315d8509', notes: 'Dominant whale - 68% of pool activity' },
      { address: 'client|604161f025e6931a676ccf37', notes: 'Secondary whale - 20% of pool activity' },
      { address: 'eth|0628E50F2338762eCaCCC53506c33bcb5327C964', notes: 'ETH whale - 7% of pool activity' }
    ];

    for (const whale of knownWhales) {
      this.watchlist.set(whale.address, {
        whaleAddress: whale.address,
        addedAt: new Date().toISOString(),
        totalVolume: 0, // Would be populated on first update
        winRate: 0,
        averageProfit: 0,
        lastActivity: new Date().toISOString(),
        alertsGenerated: 0,
        status: 'active',
        notes: whale.notes
      });
    }
  }

  private startMonitoring(): void {
    // Check for alerts every 5 minutes
    setInterval(async () => {
      try {
        await this.checkForAlerts();
      } catch (error) {
        logger.error('Error during whale monitoring:', error);
      }
    }, 5 * 60 * 1000);

    // Update watchlist metrics every hour
    setInterval(async () => {
      try {
        await this.updateWatchlistMetrics();
      } catch (error) {
        logger.error('Error updating watchlist metrics:', error);
      }
    }, 60 * 60 * 1000);
  }

  private async analyzeWhaleActivity(
    whaleAddress: string,
    recentTxs: TransactionRecord[]
  ): Promise<WhaleAlert[]> {
    const alerts: WhaleAlert[] = [];

    // Group transactions by pool
    const poolGroups = new Map<string, TransactionRecord[]>();
    for (const tx of recentTxs) {
      const key = `${tx.poolHash}-${tx.token0}-${tx.token1}`;
      if (!poolGroups.has(key)) {
        poolGroups.set(key, []);
      }
      poolGroups.get(key)!.push(tx);
    }

    for (const [poolKey, poolTxs] of poolGroups.entries()) {
      const [poolHash, token0, token1] = poolKey.split('-');

      // Check for large volume spike
      const totalVolume = poolTxs.reduce((sum, tx) => sum + tx.volume, 0);
      if (totalVolume > 100) { // Significant volume threshold
        const alert: WhaleAlert = {
          whaleAddress,
          alertType: 'accumulation',
          poolHash,
          token0,
          token1,
          volume: totalVolume,
          confidence: 0.8,
          timestamp: new Date().toISOString(),
          reasoning: [`Large volume accumulation: $${totalVolume.toLocaleString()}`],
          actionRecommendation: {
            action: 'copy',
            urgency: totalVolume > 500 ? 'immediate' : 'high',
            positionSize: totalVolume > 1000 ? 'large' : 'medium'
          }
        };

        alerts.push(alert);

        // Store alert in database
        if (this.persistence) {
          try {
            await this.persistence.createWhaleAlert(
              whaleAddress,
              'large_trade' as AlertType,
              (totalVolume > 1000 ? 'critical' : totalVolume > 500 ? 'warning' : 'info') as AlertSeverity,
              {
                poolHash,
                token0,
                token1,
                volume: totalVolume,
                confidence: 0.8,
                alertType: 'accumulation',
                reasoning: alert.reasoning,
                actionRecommendation: alert.actionRecommendation
              },
              poolHash
            );
          } catch (error) {
            logger.warn(`Failed to store accumulation alert in database: ${error}`);
          }
        }
      }

      // Check for pattern changes
      const intervalPattern = this.analyzeIntervalPattern(poolTxs);
      if (intervalPattern.patternChanged) {
        const alert: WhaleAlert = {
          whaleAddress,
          alertType: 'pattern_change',
          poolHash,
          token0,
          token1,
          volume: totalVolume,
          confidence: 0.6,
          timestamp: new Date().toISOString(),
          reasoning: ['Trading pattern deviation detected', intervalPattern.reason],
          actionRecommendation: {
            action: 'watch',
            urgency: 'medium',
            positionSize: 'small'
          }
        };

        alerts.push(alert);

        // Store alert in database
        if (this.persistence) {
          try {
            await this.persistence.createWhaleAlert(
              whaleAddress,
              'unusual_activity' as AlertType,
              'info' as AlertSeverity,
              {
                poolHash,
                token0,
                token1,
                volume: totalVolume,
                confidence: 0.6,
                alertType: 'pattern_change',
                reasoning: alert.reasoning,
                actionRecommendation: alert.actionRecommendation,
                patternAnalysis: intervalPattern
              },
              poolHash
            );
          } catch (error) {
            logger.warn(`Failed to store pattern change alert in database: ${error}`);
          }
        }
      }

      // Check for potential exit signals
      const exitSignal = this.detectExitSignal(poolTxs);
      if (exitSignal.isExiting) {
        const alert: WhaleAlert = {
          whaleAddress,
          alertType: 'exit',
          poolHash,
          token0,
          token1,
          volume: totalVolume,
          confidence: exitSignal.confidence,
          timestamp: new Date().toISOString(),
          reasoning: exitSignal.reasons,
          actionRecommendation: {
            action: 'counter',
            urgency: 'high',
            positionSize: 'medium'
          }
        };

        alerts.push(alert);

        // Store alert in database
        if (this.persistence) {
          try {
            await this.persistence.createWhaleAlert(
              whaleAddress,
              'position_change' as AlertType,
              'warning' as AlertSeverity,
              {
                poolHash,
                token0,
                token1,
                volume: totalVolume,
                confidence: exitSignal.confidence,
                alertType: 'exit',
                reasoning: alert.reasoning,
                actionRecommendation: alert.actionRecommendation,
                exitAnalysis: exitSignal
              },
              poolHash
            );
          } catch (error) {
            logger.warn(`Failed to store exit signal alert in database: ${error}`);
          }
        }
      }
    }

    return alerts;
  }

  private analyzeIntervalPattern(transactions: TransactionRecord[]): {
    patternChanged: boolean;
    reason: string;
    averageInterval: number;
  } {
    if (transactions.length < 3) {
      return { patternChanged: false, reason: 'Insufficient data', averageInterval: 0 };
    }

    const intervals = [];
    const sorted = transactions.sort((a, b) =>
      new Date(a.transactionTime).getTime() - new Date(b.transactionTime).getTime()
    );

    for (let i = 1; i < sorted.length; i++) {
      const prevTime = new Date(sorted[i - 1].transactionTime).getTime();
      const currentTime = new Date(sorted[i].transactionTime).getTime();
      intervals.push(currentTime - prevTime);
    }

    const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - averageInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // Check if variance is higher than usual (pattern changed)
    const coefficientOfVariation = stdDev / averageInterval;
    const patternChanged = coefficientOfVariation > 1.0; // High variance suggests pattern change

    return {
      patternChanged,
      reason: patternChanged ? `High timing variance (CV: ${coefficientOfVariation.toFixed(2)})` : 'Pattern stable',
      averageInterval: averageInterval / 1000 // Convert to seconds
    };
  }

  private detectExitSignal(transactions: TransactionRecord[]): {
    isExiting: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    // Check for position size reduction
    const totalAmount0 = transactions.reduce((sum, tx) => sum + tx.amount0, 0);
    const totalAmount1 = transactions.reduce((sum, tx) => sum + tx.amount1, 0);

    if (totalAmount0 < 0 && totalAmount1 > 0) {
      reasons.push('Net selling of token0 detected');
      confidence += 0.3;
    }

    if (totalAmount1 < 0 && totalAmount0 > 0) {
      reasons.push('Net selling of token1 detected');
      confidence += 0.3;
    }

    // Check for reduced trade size
    const volumes = transactions.map(tx => tx.volume);
    const averageVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const recentVolumes = volumes.slice(0, Math.min(3, volumes.length));
    const recentAverage = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;

    if (recentAverage < averageVolume * 0.7) {
      reasons.push('Trade size reduction detected');
      confidence += 0.2;
    }

    return {
      isExiting: confidence > 0.4,
      confidence,
      reasons
    };
  }

  private calculateWinRate(transactions: TransactionRecord[]): number {
    // Simplified win rate calculation
    // In reality, would need price data to determine if trades were profitable
    const consistentVolumes = transactions.filter(tx => tx.volume > 10).length;
    return (consistentVolumes / transactions.length) * 100;
  }

  private estimateAverageProfit(transactions: TransactionRecord[]): number {
    // Simplified profit estimation based on volume consistency
    const totalVolume = transactions.reduce((sum, tx) => sum + tx.volume, 0);
    const averageVolume = totalVolume / transactions.length;

    // Assume higher volume consistency = better profits
    const volumeStdDev = this.calculateVolumeStdDev(transactions);
    const consistency = Math.max(0, 1 - (volumeStdDev / averageVolume));

    return consistency * 20; // Return percentage estimate
  }

  private calculateVolumeStdDev(transactions: TransactionRecord[]): number {
    const volumes = transactions.map(tx => tx.volume);
    const average = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const variance = volumes.reduce((sum, vol) => sum + Math.pow(vol - average, 2), 0) / volumes.length;
    return Math.sqrt(variance);
  }

  private estimatePositionPnL(trades: TransactionRecord[]): number {
    // Simplified P&L estimation
    const totalVolume = trades.reduce((sum, tx) => sum + tx.volume, 0);
    return totalVolume * 0.01; // Assume 1% average profit
  }

  private calculateSharpeRatio(transactions: TransactionRecord[]): number {
    // Simplified Sharpe ratio calculation
    const returns = this.calculateDailyReturns(transactions);
    if (returns.length < 2) return 0;

    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? (avgReturn / stdDev) : 0;
  }

  private calculateDailyReturns(transactions: TransactionRecord[]): number[] {
    // Group by day and calculate daily volume as proxy for returns
    const dailyVolumes = new Map<string, number>();

    for (const tx of transactions) {
      const date = tx.transactionTime.substring(0, 10); // YYYY-MM-DD
      dailyVolumes.set(date, (dailyVolumes.get(date) || 0) + tx.volume);
    }

    const volumes = Array.from(dailyVolumes.values());
    const returns: number[] = [];

    for (let i = 1; i < volumes.length; i++) {
      if (volumes[i - 1] > 0) {
        returns.push((volumes[i] - volumes[i - 1]) / volumes[i - 1]);
      }
    }

    return returns;
  }

  private calculateMaxDrawdown(transactions: TransactionRecord[]): number {
    const returns = this.calculateDailyReturns(transactions);
    if (returns.length === 0) return 0;

    let peak = 1;
    let maxDrawdown = 0;
    let portfolio = 1;

    for (const ret of returns) {
      portfolio *= (1 + ret);
      if (portfolio > peak) {
        peak = portfolio;
      }
      const drawdown = (peak - portfolio) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown * 100; // Return as percentage
  }

  private calculateConsistency(transactions: TransactionRecord[]): number {
    const volumes = transactions.map(tx => tx.volume);
    const average = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const stdDev = this.calculateVolumeStdDev(transactions);

    return average > 0 ? Math.max(0, 1 - (stdDev / average)) : 0;
  }

  private async updateWatchlistMetrics(): Promise<void> {
    logger.debug('Updating watchlist metrics...');

    for (const [whaleAddress, entry] of this.watchlist.entries()) {
      if (entry.status !== 'active') continue;

      try {
        const performance = await this.getWhalePerformance(whaleAddress);

        entry.totalVolume = performance.totalVolume;
        entry.winRate = performance.winRate;
        entry.averageProfit = performance.averageProfit;

        // Mark as inactive if no recent activity
        const lastActivity = new Date(entry.lastActivity).getTime();
        const daysSinceActivity = (Date.now() - lastActivity) / (24 * 60 * 60 * 1000);

        if (daysSinceActivity > 7) {
          entry.status = 'inactive';
          logger.info(`Marked whale as inactive: ${whaleAddress.substring(0, 12)} (${daysSinceActivity.toFixed(1)} days)`);
        }

      } catch (error) {
        logger.warn(`Failed to update metrics for whale ${whaleAddress.substring(0, 12)}:`, error);
      }
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    watchlistSize: number;
    activeWhales: number;
    totalAlerts: number;
    recentAlerts: number;
    cacheSize: number;
  } {
    const activeWhales = Array.from(this.watchlist.values()).filter(w => w.status === 'active').length;
    const recentAlerts = this.getRecentAlerts(24).length;

    return {
      watchlistSize: this.watchlist.size,
      activeWhales,
      totalAlerts: this.recentAlerts.length,
      recentAlerts,
      cacheSize: this.portfolioCache.size
    };
  }

  /**
   * Clear all caches and reset
   */
  clearCache(): void {
    this.portfolioCache.clear();
    this.historyClient.clearCache();
    logger.debug('Whale tracker caches cleared');
  }
}

/**
 * Create a whale tracker with default configuration
 *
 * NOTE: Whale tracking disabled - transaction history API not available on GalaSwap
 * Returns a no-op instance to prevent initialization errors
 */
export function createWhaleTracker(): WhaleTracker {
  // Return disabled instance to prevent transaction history API errors
  const disabledTracker = Object.create(WhaleTracker.prototype);
  disabledTracker.watchlist = new Map();
  disabledTracker.recentAlerts = [];
  disabledTracker.portfolioCache = new Map();

  // No-op methods to prevent errors
  disabledTracker.checkForAlerts = async () => [];
  disabledTracker.getWatchlist = () => [];
  disabledTracker.getRecentAlerts = () => [];
  disabledTracker.getStats = () => ({
    watchlistSize: 0,
    activeWhales: 0,
    totalAlerts: 0,
    recentAlerts: 0,
    cacheSize: 0
  });

  return disabledTracker;
}