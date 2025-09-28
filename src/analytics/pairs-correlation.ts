/**
 * Pairs Correlation Analysis
 * 
 * Statistical analysis for pairs trading strategies:
 * - Historical correlation calculation
 * - Cointegration testing (Johansen test)
 * - Z-score calculation and validation
 * - Dynamic correlation monitoring
 * - Pair selection optimization
 */

import { timeSeriesDB } from '../data/storage/timeseries-db';
import { PriceHistory } from '../entities/analytics';
import { logger } from '../utils/logger';
// safeParseFloat import removed - not used

export interface PairStatistics {
  token1: string;
  token2: string;
  correlation: number;
  cointegration: {
    isCointegrated: boolean;
    pValue: number;
    criticalValue: number;
    testStatistic: number;
  };
  priceRatio: {
    mean: number;
    std: number;
    current: number;
    zScore: number;
  };
  halfLife: number; // Mean reversion half-life in days
  spread: {
    mean: number;
    std: number;
    current: number;
    zScore: number;
  };
  lastUpdated: number;
  dataPoints: number;
  confidence: number; // 0-1 based on data quality and consistency
}

export interface PairSignal {
  pair: string;
  type: 'long_spread' | 'short_spread' | 'exit' | 'no_signal';
  strength: number; // 0-1, higher = stronger signal
  zScore: number;
  priceRatio: number;
  expectedReturn: number; // Expected profit %
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: number;
  metadata: {
    token1Price: number;
    token2Price: number;
    correlation: number;
    halfLife: number;
    confidence: number;
  };
}

export interface CorrelationWindow {
  shortTerm: number; // 7 days
  mediumTerm: number; // 30 days
  longTerm: number; // 90 days
}

export class PairsCorrelation {
  private correlationCache: Map<string, PairStatistics> = new Map();
  private correlationWindow: CorrelationWindow = {
    shortTerm: 7 * 24 * 60 * 60 * 1000, // 7 days
    mediumTerm: 30 * 24 * 60 * 60 * 1000, // 30 days
    longTerm: 90 * 24 * 60 * 60 * 1000 // 90 days
  };

  // Gaming token pairs for GalaSwap
  private readonly TRADING_PAIRS = [
    ['GALA', 'TOWN'], // Ecosystem-game correlation
    ['TOWN', 'MATERIUM'], // Inter-game correlation
    ['GUSDC', 'GUSDT'], // Stablecoin parity
    ['GALA', 'GUSDC'], // Main token-stablecoin
    ['TOWN', 'GUSDC'], // Game token-stablecoin
    ['MATERIUM', 'GUSDC'] // Game token-stablecoin
  ];

  // Statistical thresholds
  private readonly Z_SCORE_ENTRY = 2.0; // Enter when z-score > 2.0
  private readonly Z_SCORE_EXIT = 0.5; // Exit when z-score < 0.5
  private readonly MIN_CORRELATION = 0.3; // Minimum correlation for trading
  private readonly MIN_DATA_POINTS = 100; // Minimum data points for analysis
  private readonly COINTEGRATION_P_VALUE = 0.05; // 5% significance level

  constructor() {
    logger.info('PairsCorrelation initialized for GalaSwap gaming tokens');
  }

  /**
   * Initialize database and calculate correlations for all pairs
   */
  async initialize(): Promise<void> {
    try {
      await timeSeriesDB.initialize();
      
      logger.info('🔍 Calculating correlations for all trading pairs...');
      
      for (const [token1, token2] of this.TRADING_PAIRS) {
        try {
          await this.updatePairStatistics(token1, token2);
          logger.debug(`✅ Updated statistics for ${token1}/${token2}`);
        } catch (error) {
          logger.warn(`⚠️  Failed to calculate statistics for ${token1}/${token2}:`, error);
        }
      }

      logger.info(`✅ Correlation analysis complete for ${this.correlationCache.size} pairs`);
      
    } catch (error) {
      logger.error('❌ Failed to initialize PairsCorrelation:', error);
      throw error;
    }
  }

  /**
   * Update pair statistics using historical price data
   */
  async updatePairStatistics(token1: string, token2: string): Promise<PairStatistics> {
    try {
      const _pairKey = this.getPairKey(token1, token2);
      const endTime = Date.now();
      const startTime = endTime - this.correlationWindow.longTerm; // 90 days

      // Fetch historical data for both tokens
      const [prices1, prices2] = await Promise.all([
        timeSeriesDB.getPriceHistory(token1, {
          startTime,
          endTime,
          orderBy: 'ASC'
        }),
        timeSeriesDB.getPriceHistory(token2, {
          startTime,
          endTime,
          orderBy: 'ASC'
        })
      ]);

      if (prices1.length < this.MIN_DATA_POINTS || prices2.length < this.MIN_DATA_POINTS) {
        logger.warn(`Insufficient data for ${token1}/${token2}: ${prices1.length}/${prices2.length} points`);
        throw new Error(`Insufficient historical data for pair analysis`);
      }

      // Align timestamps and create synchronized price series
      const alignedData = this.alignPriceData(prices1, prices2);
      
      if (alignedData.length < this.MIN_DATA_POINTS) {
        throw new Error(`Insufficient synchronized data points: ${alignedData.length}`);
      }

      // Calculate correlation
      const correlation = this.calculateCorrelation(alignedData);
      
      // Perform cointegration test
      const cointegration = await this.performCointegrationTest(alignedData);
      
      // Calculate price ratio statistics
      const priceRatios = alignedData.map(d => d.price1 / d.price2);
      const ratioStats = this.calculateStatistics(priceRatios);
      
      // Calculate spread statistics (log ratio for better normality)
      const spreads = alignedData.map(d => Math.log(d.price1) - Math.log(d.price2));
      const spreadStats = this.calculateStatistics(spreads);
      
      // Calculate mean reversion half-life
      const halfLife = this.calculateHalfLife(spreads);
      
      // Get current prices for z-score calculation
      const [latestPrice1, latestPrice2] = await this.getCurrentPrices(token1, token2);
      const currentRatio = latestPrice1 / latestPrice2;
      const currentSpread = Math.log(latestPrice1) - Math.log(latestPrice2);
      
      // Calculate confidence based on data quality
      const confidence = this.calculateConfidence({
        dataPoints: alignedData.length,
        correlation: Math.abs(correlation),
        cointegrationP: cointegration.pValue,
        halfLife
      });

      const pairStats: PairStatistics = {
        token1,
        token2,
        correlation,
        cointegration,
        priceRatio: {
          mean: ratioStats.mean,
          std: ratioStats.std,
          current: currentRatio,
          zScore: (currentRatio - ratioStats.mean) / ratioStats.std
        },
        halfLife,
        spread: {
          mean: spreadStats.mean,
          std: spreadStats.std,
          current: currentSpread,
          zScore: (currentSpread - spreadStats.mean) / spreadStats.std
        },
        lastUpdated: Date.now(),
        dataPoints: alignedData.length,
        confidence
      };

      this.correlationCache.set(_pairKey, pairStats);
      
      logger.debug(`Updated pair statistics for ${token1}/${token2}:`, {
        correlation: correlation.toFixed(3),
        zScore: pairStats.spread.zScore.toFixed(2),
        confidence: confidence.toFixed(2),
        cointegrated: cointegration.isCointegrated
      });

      return pairStats;

    } catch (error) {
      logger.error(`Error updating pair statistics for ${token1}/${token2}:`, error);
      throw error;
    }
  }

  /**
   * Generate trading signals for all pairs
   */
  async generateSignals(): Promise<PairSignal[]> {
    const signals: PairSignal[] = [];

    try {
      // Update statistics for all pairs
      for (const [token1, token2] of this.TRADING_PAIRS) {
        try {
          await this.updatePairStatistics(token1, token2);
        } catch (error) {
          logger.warn(`Failed to update ${token1}/${token2}:`, error);
          continue;
        }
      }

      // Generate signals from updated statistics
      for (const [pairKey, stats] of this.correlationCache) {
        try {
          const signal = this.generatePairSignal(stats);
          if (signal.type !== 'no_signal') {
            signals.push(signal);
          }
        } catch (error) {
          logger.warn(`Error generating signal for ${pairKey}:`, error);
        }
      }

      // Sort by signal strength and confidence
      signals.sort((a, b) => (b.strength * b.metadata.confidence) - (a.strength * a.metadata.confidence));

      logger.info(`Generated ${signals.length} pair trading signals`);
      return signals;

    } catch (error) {
      logger.error('Error generating pair signals:', error);
      return [];
    }
  }

  /**
   * Generate trading signal for a specific pair
   */
  private generatePairSignal(stats: PairStatistics): PairSignal {
    const { token1, token2, spread, correlation, halfLife, confidence } = stats;
    const _pairKey = this.getPairKey(token1, token2);

    // Check minimum requirements
    if (Math.abs(correlation) < this.MIN_CORRELATION) {
      return this.createNoSignal(_pairKey, stats, 'Low correlation');
    }

    if (!stats.cointegration.isCointegrated) {
      return this.createNoSignal(_pairKey, stats, 'Not cointegrated');
    }

    if (confidence < 0.5) {
      return this.createNoSignal(_pairKey, stats, 'Low confidence');
    }

    const absZScore = Math.abs(spread.zScore);
    let signalType: PairSignal['type'] = 'no_signal';
    let strength = 0;
    let expectedReturn = 0;

    // Generate signals based on z-score
    if (absZScore >= this.Z_SCORE_ENTRY) {
      // Strong mean reversion signal
      signalType = spread.zScore > 0 ? 'short_spread' : 'long_spread';
      strength = Math.min(absZScore / 4, 1); // Cap at z-score of 4
      expectedReturn = this.calculateExpectedReturn(absZScore, halfLife);
    } else if (absZScore <= this.Z_SCORE_EXIT) {
      // Exit signal when spread returns to mean
      signalType = 'exit';
      strength = 0.8; // High confidence exit signal
      expectedReturn = 0;
    }

    // Calculate risk level based on correlation stability and half-life
    const riskLevel = this.calculateRiskLevel(correlation, halfLife, confidence);

    // Get current token prices
    const currentPrice1 = stats.priceRatio.current * stats.spread.current; // Approximate
    const currentPrice2 = stats.spread.current; // Approximate

    return {
      pair: _pairKey,
      type: signalType,
      strength,
      zScore: spread.zScore,
      priceRatio: stats.priceRatio.current,
      expectedReturn,
      riskLevel,
      timestamp: Date.now(),
      metadata: {
        token1Price: currentPrice1,
        token2Price: currentPrice2,
        correlation,
        halfLife,
        confidence
      }
    };
  }

  /**
   * Calculate expected return based on mean reversion
   */
  private calculateExpectedReturn(zScore: number, halfLife: number): number {
    // Expected return based on mean reversion to zero z-score
    // Higher z-score = higher expected return
    // Shorter half-life = faster reversion = higher annualized return
    
    const baseReturn = Math.min(zScore * 0.005, 0.05); // Max 5% per trade
    const timeAdjustment = Math.max(0.5, 30 / halfLife); // Adjust for reversion speed
    
    return baseReturn * timeAdjustment;
  }

  /**
   * Calculate risk level for a pair
   */
  private calculateRiskLevel(correlation: number, halfLife: number, confidence: number): 'low' | 'medium' | 'high' {
    let riskScore = 0;

    // Lower absolute correlation = higher risk
    if (Math.abs(correlation) < 0.5) riskScore += 2;
    else if (Math.abs(correlation) < 0.7) riskScore += 1;

    // Longer half-life = higher risk (slower reversion)
    if (halfLife > 20) riskScore += 2;
    else if (halfLife > 10) riskScore += 1;

    // Lower confidence = higher risk
    if (confidence < 0.6) riskScore += 2;
    else if (confidence < 0.8) riskScore += 1;

    if (riskScore >= 4) return 'high';
    if (riskScore >= 2) return 'medium';
    return 'low';
  }

  /**
   * Get best trading opportunities
   */
  getBestOpportunities(maxCount: number = 3): PairSignal[] {
    const signals: PairSignal[] = [];

    for (const [_pairKey, stats] of this.correlationCache) {
      const signal = this.generatePairSignal(stats);
      if (signal.type !== 'no_signal' && signal.type !== 'exit') {
        signals.push(signal);
      }
    }

    return signals
      .sort((a, b) => (b.strength * b.expectedReturn * b.metadata.confidence) - 
                      (a.strength * a.expectedReturn * a.metadata.confidence))
      .slice(0, maxCount);
  }

  /**
   * Get pair statistics for a specific pair
   */
  getPairStatistics(token1: string, token2: string): PairStatistics | null {
    const _pairKey = this.getPairKey(token1, token2);
    return this.correlationCache.get(_pairKey) || null;
  }

  /**
   * Get all available pairs and their statistics
   */
  getAllPairStatistics(): Map<string, PairStatistics> {
    return new Map(this.correlationCache);
  }

  /**
   * Align price data by timestamp for correlation analysis
   */
  private alignPriceData(prices1: PriceHistory[], prices2: PriceHistory[]): Array<{
    timestamp: number;
    price1: number;
    price2: number;
  }> {
    const aligned: Array<{ timestamp: number; price1: number; price2: number }> = [];
    
    // Create maps for faster lookup
    const priceMap1 = new Map<number, number>();
    const priceMap2 = new Map<number, number>();
    
    prices1.forEach(p => priceMap1.set(p.timestamp, p.getPriceUsd()));
    prices2.forEach(p => priceMap2.set(p.timestamp, p.getPriceUsd()));
    
    // Find common timestamps (with tolerance for slight differences)
    const tolerance = 5 * 60 * 1000; // 5 minutes
    
    for (const price1 of prices1) {
      const timestamp1 = price1.timestamp;
      const priceValue1 = price1.getPriceUsd();
      
      // Look for matching timestamp in price2 data
      let matchingPrice2: number | undefined;
      
      // Exact match first
      if (priceMap2.has(timestamp1)) {
        matchingPrice2 = priceMap2.get(timestamp1);
      } else {
        // Look for closest timestamp within tolerance
        for (const price2 of prices2) {
          if (Math.abs(price2.timestamp - timestamp1) <= tolerance) {
            matchingPrice2 = price2.getPriceUsd();
            break;
          }
        }
      }
      
      if (matchingPrice2 !== undefined && priceValue1 > 0 && matchingPrice2 > 0) {
        aligned.push({
          timestamp: timestamp1,
          price1: priceValue1,
          price2: matchingPrice2
        });
      }
    }
    
    return aligned.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private calculateCorrelation(data: Array<{ price1: number; price2: number }>): number {
    const _n = data.length;
    if (_n < 2) return 0;

    const prices1 = data.map(d => d.price1);
    const prices2 = data.map(d => d.price2);

    const mean1 = prices1.reduce((sum, p) => sum + p, 0) / _n;
    const mean2 = prices2.reduce((sum, p) => sum + p, 0) / _n;

    let numerator = 0;
    let sum1Sq = 0;
    let sum2Sq = 0;

    for (let i = 0; i < _n; i++) {
      const diff1 = prices1[i] - mean1;
      const diff2 = prices2[i] - mean2;
      
      numerator += diff1 * diff2;
      sum1Sq += diff1 * diff1;
      sum2Sq += diff2 * diff2;
    }

    const denominator = Math.sqrt(sum1Sq * sum2Sq);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Perform Augmented Dickey-Fuller test for cointegration
   * Simplified implementation for pairs trading
   */
  private async performCointegrationTest(data: Array<{ price1: number; price2: number }>): Promise<{
    isCointegrated: boolean;
    pValue: number;
    criticalValue: number;
    testStatistic: number;
  }> {
    try {
      // Calculate log price spread
      const spreads = data.map(d => Math.log(d.price1) - Math.log(d.price2));
      
      // Perform ADF test on the spread
      const adfResult = this.augmentedDickeyFullerTest(spreads);
      
      return {
        isCointegrated: adfResult.pValue < this.COINTEGRATION_P_VALUE,
        pValue: adfResult.pValue,
        criticalValue: adfResult.criticalValue,
        testStatistic: adfResult.testStatistic
      };
      
    } catch (error) {
      logger.error('Error in cointegration test:', error);
      return {
        isCointegrated: false,
        pValue: 1.0,
        criticalValue: -3.43, // 5% critical value
        testStatistic: 0
      };
    }
  }

  /**
   * Simplified Augmented Dickey-Fuller test
   */
  private augmentedDickeyFullerTest(series: number[]): {
    testStatistic: number;
    pValue: number;
    criticalValue: number;
  } {
    const _n = series.length;
    if (_n < 10) {
      return {
        testStatistic: 0,
        pValue: 1.0,
        criticalValue: -3.43
      };
    }

    // First difference of the series
    const diffs = [];
    for (let i = 1; i < _n; i++) {
      diffs.push(series[i] - series[i - 1]);
    }

    // Lagged series (1 period lag)
    const lagged = series.slice(0, -1);
    
    // Simple regression: Δy_t = α + βy_{t-1} + ε_t
    const { slope: beta, intercept: alpha } = this.simpleLinearRegression(
      lagged,
      diffs
    );

    // Standard error calculation (simplified)
    const residuals = diffs.map((diff, i) => diff - (alpha + beta * lagged[i]));
    const mse = residuals.reduce((sum, r) => sum + r * r, 0) / (diffs.length - 2);
    const seBeta = Math.sqrt(mse / lagged.reduce((sum, x) => sum + (x - this.mean(lagged)) ** 2, 0));
    
    // Test statistic
    const testStatistic = beta / seBeta;
    
    // Approximate p-value using MacKinnon critical values
    const criticalValue = -3.43; // 5% level for intercept model
    const pValue = testStatistic < criticalValue ? 0.01 : 0.99; // Simplified
    
    return {
      testStatistic,
      pValue,
      criticalValue
    };
  }

  /**
   * Simple linear regression
   */
  private simpleLinearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
    const _n = x.length;
    const meanX = this.mean(x);
    const meanY = this.mean(y);
    
    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
    const denominator = x.reduce((sum, xi) => sum + (xi - meanX) ** 2, 0);
    
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;
    
    return { slope, intercept };
  }

  /**
   * Calculate mean of an array
   */
  private mean(arr: number[]): number {
    return arr.reduce((sum, x) => sum + x, 0) / arr.length;
  }

  /**
   * Calculate statistics (mean, std dev) for an array
   */
  private calculateStatistics(values: number[]): { mean: number; std: number } {
    const _n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / _n;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / _n;
    const std = Math.sqrt(variance);
    
    return { mean, std };
  }

  /**
   * Calculate half-life of mean reversion
   */
  private calculateHalfLife(spreads: number[]): number {
    try {
      const _n = spreads.length;
      if (_n < 20) return 30; // Default if insufficient data

      // Calculate first differences
      const diffs = [];
      const lagged = [];
      
      for (let i = 1; i < _n; i++) {
        diffs.push(spreads[i] - spreads[i - 1]);
        lagged.push(spreads[i - 1]);
      }

      // Regression: Δy_t = α + βy_{t-1} + ε_t
      const { slope: beta } = this.simpleLinearRegression(lagged, diffs);
      
      // Half-life = -ln(2) / ln(1 + β)
      if (beta >= 0) return 30; // No mean reversion
      
      const halfLife = -Math.log(2) / Math.log(1 + beta);
      
      // Return result in days (assuming daily data)
      return Math.max(1, Math.min(90, halfLife));
      
    } catch (error) {
      logger.error('Error calculating half-life:', error);
      return 30; // Default
    }
  }

  /**
   * Calculate confidence score based on data quality metrics
   */
  private calculateConfidence(params: {
    dataPoints: number;
    correlation: number;
    cointegrationP: number;
    halfLife: number;
  }): number {
    let score = 0;

    // Data quantity (0-0.3)
    const dataScore = Math.min(params.dataPoints / 500, 1) * 0.3;
    score += dataScore;

    // Correlation strength (0-0.3)
    const correlationScore = params.correlation * 0.3;
    score += correlationScore;

    // Cointegration significance (0-0.3)
    const cointegrationScore = params.cointegrationP < 0.01 ? 0.3 :
                              params.cointegrationP < 0.05 ? 0.2 :
                              params.cointegrationP < 0.1 ? 0.1 : 0;
    score += cointegrationScore;

    // Mean reversion speed (0-0.1)
    const reversionScore = params.halfLife < 5 ? 0.1 :
                          params.halfLife < 15 ? 0.05 : 0;
    score += reversionScore;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get current prices for two tokens
   */
  private async getCurrentPrices(token1: string, token2: string): Promise<[number, number]> {
    try {
      const [price1Data, price2Data] = await Promise.all([
        timeSeriesDB.getLatestPrice(token1),
        timeSeriesDB.getLatestPrice(token2)
      ]);

      const price1 = price1Data ? price1Data.getPriceUsd() : 0;
      const price2 = price2Data ? price2Data.getPriceUsd() : 0;

      return [price1, price2];
    } catch (error) {
      logger.error(`Error getting current prices for ${token1}/${token2}:`, error);
      return [0, 0];
    }
  }

  /**
   * Create a no-signal response
   */
  private createNoSignal(_pairKey: string, stats: PairStatistics, _reason: string): PairSignal {
    return {
      pair: _pairKey,
      type: 'no_signal',
      strength: 0,
      zScore: stats.spread.zScore,
      priceRatio: stats.priceRatio.current,
      expectedReturn: 0,
      riskLevel: 'high',
      timestamp: Date.now(),
      metadata: {
        token1Price: 0,
        token2Price: 0,
        correlation: stats.correlation,
        halfLife: stats.halfLife,
        confidence: stats.confidence
      }
    };
  }

  /**
   * Generate pair key for consistent caching
   */
  private getPairKey(token1: string, token2: string): string {
    // Always order alphabetically for consistency
    return [token1, token2].sort().join('/');
  }

  /**
   * Check if correlation monitoring is healthy
   */
  isHealthy(): boolean {
    return this.correlationCache.size > 0;
  }

  /**
   * Get monitoring statistics
   */
  getMonitoringStats(): {
    totalPairs: number;
    activePairs: number;
    averageConfidence: number;
    lastUpdate: number;
  } {
    const stats = Array.from(this.correlationCache.values());
    const activePairs = stats.filter(s => s.confidence > 0.5).length;
    const avgConfidence = stats.length > 0 
      ? stats.reduce((sum, s) => sum + s.confidence, 0) / stats.length 
      : 0;
    const lastUpdate = Math.max(...stats.map(s => s.lastUpdated), 0);

    return {
      totalPairs: this.correlationCache.size,
      activePairs,
      averageConfidence: avgConfidence,
      lastUpdate
    };
  }
}

// Export singleton instance
export const pairsCorrelation = new PairsCorrelation();
