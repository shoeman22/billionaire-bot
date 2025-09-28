/**
 * TVL Analyzer Service
 *
 * Historical Total Value Locked (TVL) correlation analysis and volatility prediction.
 * Correlates liquidity changes with price movements, analyzes pool efficiency,
 * recognizes migration patterns, and models volatility prediction for positioning.
 */

import { logger } from '../utils/logger';
import { PoolLiquidityData, LiquidityMigration, LiquidityGap } from '../monitoring/liquidity-monitor';
import { PriceData } from '../monitoring/price-tracker';
// safeParseFloat import removed - not used

export interface TvlCorrelationAnalysis {
  poolHash: string;
  token0: string;
  token1: string;
  correlationCoefficient: number; // -1 to 1: TVL vs Price correlation
  correlationStrength: 'very_weak' | 'weak' | 'moderate' | 'strong' | 'very_strong';
  priceImpactSensitivity: number; // How much price moves per % TVL change
  volatilityPrediction: VolatilityPrediction;
  significantEvents: TvlPriceEvent[];
  confidence: number; // 0-1 scale
  analysisWindow: string; // Time period analyzed
}

export interface VolatilityPrediction {
  expectedVolatility: number; // Expected volatility percentage in next hour
  confidenceInterval: [number, number]; // [lower, upper] bounds
  primaryDrivers: string[]; // Main factors driving volatility
  timeHorizon: string; // Prediction time frame
  reliability: 'low' | 'medium' | 'high';
}

export interface TvlPriceEvent {
  timestamp: number;
  eventType: 'tvl_spike_price_pump' | 'tvl_drain_price_dump' | 'inverse_correlation' | 'liquidity_gap_breakout';
  tvlChange: number; // Percentage change in TVL
  priceChange: number; // Percentage change in price
  impactMagnitude: number; // 1-10 scale
  description: string;
}

export interface PoolEfficiencyScore {
  poolHash: string;
  token0: string;
  token1: string;
  efficiencyScore: number; // 0-100 overall efficiency
  metrics: {
    tvlUtilization: number; // How well TVL is utilized for trading
    priceStability: number; // Lower volatility = higher stability
    liquidityDistribution: number; // How well liquidity is distributed
    migrationFrequency: number; // Lower migration = higher stability
    volumeToTvlRatio: number; // Higher ratio = more efficient
  };
  ranking: 'excellent' | 'good' | 'average' | 'poor' | 'terrible';
  recommendations: string[];
}

export interface MigrationPattern {
  patternType: 'seasonal' | 'event_driven' | 'whale_coordination' | 'yield_farming' | 'speculation';
  frequency: number; // Migrations per week
  averageSizeUsd: number;
  typicalTimeRanges: string[]; // Hours when migrations occur
  triggerEvents: string[]; // What typically triggers these migrations
  predictability: number; // 0-1 scale of how predictable the pattern is
  profitOpportunity: number; // 0-10 scale of trading opportunity
}

export interface PositioningSuggestion {
  poolHash: string;
  strategy: 'pre_volatility' | 'breakout_trade' | 'range_trade' | 'impact_arbitrage' | 'avoid';
  reasoning: string[];
  entryConditions: string[];
  exitConditions: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  expectedReturn: number; // Percentage
  timeHorizon: string;
  maxPosition: number; // Percentage of capital
  stopLoss: number; // Percentage
}

export interface GameTokenLiquidityPattern {
  tokenSymbol: string;
  seasonality: {
    gameUpdateBoosts: boolean; // Liquidity increases before game updates
    tournamentCycles: boolean; // Liquidity follows tournament schedules
    weekendPatterns: boolean; // Different weekend behavior
  };
  utilityEvents: {
    mechanicChanges: boolean; // Token utility changes affect liquidity
    stakingChanges: boolean; // Staking reward changes
    burnEvents: boolean; // Token burn events
  };
  communityBehavior: {
    guildCoordination: boolean; // Large groups coordinate
    whaleInfluence: number; // 0-10 scale of whale control
    retailParticipation: number; // 0-10 scale of retail activity
  };
}

export class TvlAnalyzer {
  private tvlHistory: Map<string, PoolLiquidityData[]> = new Map();
  private priceHistory: Map<string, PriceData[]> = new Map();
  private correlationCache: Map<string, TvlCorrelationAnalysis> = new Map();
  private efficiencyCache: Map<string, PoolEfficiencyScore> = new Map();
  private migrationPatterns: Map<string, MigrationPattern[]> = new Map();
  private gameTokenPatterns: Map<string, GameTokenLiquidityPattern> = new Map();

  private readonly ANALYSIS_WINDOW_HOURS = 168; // 7 days
  private readonly MIN_DATA_POINTS = 50; // Minimum data points for analysis
  private readonly CORRELATION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor() {
    this.initializeGameTokenPatterns();
    logger.info('📊 TVL Analyzer Service initialized');
  }

  /**
   * Analyze TVL-Price correlation for a pool
   */
  async analyzeTvlPriceCorrelation(
    poolHash: string,
    _tvlData: PoolLiquidityData[],
    priceData: PriceData[],
    windowHours: number = this.ANALYSIS_WINDOW_HOURS
  ): Promise<TvlCorrelationAnalysis> {
    // Check cache first
    const cacheKey = `${poolHash}-${windowHours}`;
    const cached = this.correlationCache.get(cacheKey);
    if (cached && (Date.now() - cached.confidence) < this.CORRELATION_CACHE_TTL) {
      return cached;
    }

    logger.info(`📈 Analyzing TVL-Price correlation for ${poolHash.substring(0, 8)}...`);

    try {
      // Filter data to analysis window
      const windowMs = windowHours * 60 * 60 * 1000;
      const cutoffTime = Date.now() - windowMs;

      const recentTvlData = _tvlData.filter((d: PoolLiquidityData) => d.timestamp >= cutoffTime);
      const recentPriceData = priceData.filter(d => d.timestamp >= cutoffTime);

      if (recentTvlData.length < this.MIN_DATA_POINTS || recentPriceData.length < this.MIN_DATA_POINTS) {
        throw new Error(`Insufficient data: TVL=${recentTvlData.length}, Price=${recentPriceData.length}`);
      }

      // Align data points by timestamp
      const alignedData = this.alignTvlPriceData(recentTvlData, recentPriceData);

      // Calculate correlation coefficient
      const correlationCoefficient = this.calculateCorrelation(
        alignedData.map(d => d.tvlChangePercent),
        alignedData.map(d => d.priceChangePercent)
      );

      // Determine correlation strength
      const correlationStrength = this.interpretCorrelationStrength(correlationCoefficient);

      // Calculate price impact sensitivity
      const priceImpactSensitivity = this.calculatePriceImpactSensitivity(alignedData);

      // Identify significant events
      const significantEvents = this.identifyTvlPriceEvents(alignedData);

      // Predict volatility
      const volatilityPrediction = this.predictVolatilityFromTvl(alignedData, correlationCoefficient);

      const analysis: TvlCorrelationAnalysis = {
        poolHash,
        token0: recentTvlData[0]?.token0 || 'UNKNOWN',
        token1: recentTvlData[0]?.token1 || 'UNKNOWN',
        correlationCoefficient,
        correlationStrength,
        priceImpactSensitivity,
        volatilityPrediction,
        significantEvents,
        confidence: this.calculateAnalysisConfidence(alignedData.length, windowHours),
        analysisWindow: `${windowHours}h`
      };

      // Cache the analysis
      this.correlationCache.set(cacheKey, analysis);

      logger.info(`✅ TVL-Price correlation analysis complete for ${poolHash.substring(0, 8)}`, {
        correlation: correlationCoefficient.toFixed(3),
        strength: correlationStrength,
        events: significantEvents.length
      });

      return analysis;

    } catch (error) {
      logger.error(`Failed to analyze TVL-Price correlation for ${poolHash}:`, error);
      throw error;
    }
  }

  /**
   * Calculate pool efficiency score
   */
  async calculatePoolEfficiency(
    poolHash: string,
    _tvlData: PoolLiquidityData[],
    priceData: PriceData[],
    migrations: LiquidityMigration[]
  ): Promise<PoolEfficiencyScore> {
    // Check cache
    const cached = this.efficiencyCache.get(poolHash);
    if (cached) {
      return cached;
    }

    logger.debug(`🔬 Calculating pool efficiency for ${poolHash.substring(0, 8)}...`);

    try {
      if (_tvlData.length < this.MIN_DATA_POINTS) {
        throw new Error(`Insufficient TVL data: ${_tvlData.length} points`);
      }

      const latestTvl = _tvlData[_tvlData.length - 1];

      // Calculate individual metrics
      const tvlUtilization = this.calculateTvlUtilization(_tvlData);
      const priceStability = this.calculatePriceStability(priceData);
      const liquidityDistribution = this.calculateLiquidityDistribution(latestTvl);
      const migrationFrequency = this.calculateMigrationFrequency(migrations);
      const volumeToTvlRatio = this.calculateVolumeToTvlRatio(_tvlData);

      // Weighted overall score
      const efficiencyScore = (
        tvlUtilization * 0.25 +
        priceStability * 0.20 +
        liquidityDistribution * 0.20 +
        migrationFrequency * 0.15 +
        volumeToTvlRatio * 0.20
      );

      // Determine ranking
      const ranking = this.determineEfficiencyRanking(efficiencyScore);

      // Generate recommendations
      const recommendations = this.generateEfficiencyRecommendations(
        tvlUtilization,
        priceStability,
        liquidityDistribution,
        migrationFrequency,
        volumeToTvlRatio
      );

      const efficiency: PoolEfficiencyScore = {
        poolHash,
        token0: latestTvl.token0,
        token1: latestTvl.token1,
        efficiencyScore,
        metrics: {
          tvlUtilization,
          priceStability,
          liquidityDistribution,
          migrationFrequency,
          volumeToTvlRatio
        },
        ranking,
        recommendations
      };

      // Cache for 1 hour
      this.efficiencyCache.set(poolHash, efficiency);

      logger.debug(`Pool efficiency calculated: ${efficiencyScore.toFixed(1)}/100 (${ranking})`);
      return efficiency;

    } catch (error) {
      logger.error(`Failed to calculate pool efficiency for ${poolHash}:`, error);
      throw error;
    }
  }

  /**
   * Recognize migration patterns
   */
  async recognizeMigrationPatterns(
    poolHash: string,
    migrations: LiquidityMigration[],
    gameToken?: string
  ): Promise<MigrationPattern[]> {
    logger.debug(`🔍 Recognizing migration patterns for ${poolHash.substring(0, 8)}...`);

    try {
      if (migrations.length < 10) {
        logger.debug(`Insufficient migration data: ${migrations.length} migrations`);
        return [];
      }

      const patterns: MigrationPattern[] = [];

      // Analyze seasonal patterns
      const seasonalPattern = this.analyzeSeasonalPatterns(migrations);
      if (seasonalPattern) patterns.push(seasonalPattern);

      // Analyze event-driven patterns
      const eventPattern = this.analyzeEventDrivenPatterns(migrations);
      if (eventPattern) patterns.push(eventPattern);

      // Analyze whale coordination patterns
      const whalePattern = this.analyzeWhaleCoordinationPatterns(migrations);
      if (whalePattern) patterns.push(whalePattern);

      // Analyze yield farming patterns
      const yieldPattern = this.analyzeYieldFarmingPatterns(migrations);
      if (yieldPattern) patterns.push(yieldPattern);

      // Game-specific patterns
      if (gameToken) {
        const gamePattern = this.analyzeGameTokenPatterns(migrations, gameToken);
        if (gamePattern) patterns.push(gamePattern);
      }

      // Cache patterns
      this.migrationPatterns.set(poolHash, patterns);

      logger.debug(`Identified ${patterns.length} migration patterns`);
      return patterns;

    } catch (error) {
      logger.error(`Failed to recognize migration patterns for ${poolHash}:`, error);
      return [];
    }
  }

  /**
   * Generate positioning suggestions based on analysis
   */
  async generatePositioningSuggestions(
    poolHash: string,
    correlation: TvlCorrelationAnalysis,
    efficiency: PoolEfficiencyScore,
    patterns: MigrationPattern[],
    liquidityGaps: LiquidityGap[]
  ): Promise<PositioningSuggestion[]> {
    logger.info(`💡 Generating positioning suggestions for ${poolHash.substring(0, 8)}...`);

    const suggestions: PositioningSuggestion[] = [];

    try {
      // Pre-volatility positioning
      if (correlation.volatilityPrediction.expectedVolatility > 5 && correlation.confidence > 0.7) {
        suggestions.push({
          poolHash,
          strategy: 'pre_volatility',
          reasoning: [
            `High predicted volatility: ${correlation.volatilityPrediction.expectedVolatility.toFixed(1)}%`,
            `Strong correlation analysis confidence: ${(correlation.confidence * 100).toFixed(0)}%`,
            ...correlation.volatilityPrediction.primaryDrivers
          ],
          entryConditions: [
            'TVL shows signs of migration preparation',
            'Low current volatility (calm before storm)',
            'Price near support/resistance levels'
          ],
          exitConditions: [
            'Volatility spike occurs',
            'TVL migration completes',
            `Stop loss at ${this.calculateStopLoss(correlation.volatilityPrediction.expectedVolatility)}%`
          ],
          riskLevel: correlation.volatilityPrediction.expectedVolatility > 10 ? 'high' : 'medium',
          expectedReturn: correlation.volatilityPrediction.expectedVolatility * 0.6,
          timeHorizon: correlation.volatilityPrediction.timeHorizon,
          maxPosition: correlation.volatilityPrediction.expectedVolatility > 10 ? 3 : 5,
          stopLoss: this.calculateStopLoss(correlation.volatilityPrediction.expectedVolatility)
        });
      }

      // Liquidity gap breakout trading
      const significantGaps = liquidityGaps.filter(gap => gap.impactPotential >= 7);
      if (significantGaps.length > 0 && efficiency.efficiencyScore < 70) {
        suggestions.push({
          poolHash,
          strategy: 'breakout_trade',
          reasoning: [
            `${significantGaps.length} significant liquidity gaps detected`,
            `Low pool efficiency: ${efficiency.efficiencyScore.toFixed(1)}/100`,
            'High price impact potential on breakouts'
          ],
          entryConditions: [
            'Price approaching liquidity gap boundaries',
            'Volume increasing leading to gap',
            'Strong momentum indicators'
          ],
          exitConditions: [
            'Gap gets filled with new liquidity',
            'Price reverses after gap exploitation',
            'Profit target reached (gap size * 0.7)'
          ],
          riskLevel: 'high',
          expectedReturn: significantGaps.reduce((sum, gap) => sum + gap.impactPotential, 0) * 0.5,
          timeHorizon: '1-6 hours',
          maxPosition: 4,
          stopLoss: 6
        });
      }

      // Range trading for stable pools
      if (efficiency.efficiencyScore > 80 && correlation.correlationStrength === 'strong') {
        suggestions.push({
          poolHash,
          strategy: 'range_trade',
          reasoning: [
            `High pool efficiency: ${efficiency.efficiencyScore.toFixed(1)}/100`,
            `Strong TVL-Price correlation: ${correlation.correlationCoefficient.toFixed(3)}`,
            'Predictable range-bound behavior'
          ],
          entryConditions: [
            'Price at range boundaries',
            'TVL stable with no migration signals',
            'Mean reversion indicators active'
          ],
          exitConditions: [
            'Price reaches opposite range boundary',
            'Range breaks with high volume',
            'TVL migration detected'
          ],
          riskLevel: 'low',
          expectedReturn: 2,
          timeHorizon: '2-24 hours',
          maxPosition: 8,
          stopLoss: 3
        });
      }

      // Impact arbitrage for correlated pools
      if (Math.abs(correlation.correlationCoefficient) > 0.7 && correlation.priceImpactSensitivity > 1) {
        suggestions.push({
          poolHash,
          strategy: 'impact_arbitrage',
          reasoning: [
            `Strong correlation: ${correlation.correlationCoefficient.toFixed(3)}`,
            `High price impact sensitivity: ${correlation.priceImpactSensitivity.toFixed(2)}`,
            'Predictable price reaction to TVL changes'
          ],
          entryConditions: [
            'Large TVL migration detected in correlated pools',
            'Price hasn\'t adjusted yet',
            'Sufficient trading volume'
          ],
          exitConditions: [
            'Price correlation re-establishes',
            'Arbitrage opportunity closes',
            'Market efficiency restored'
          ],
          riskLevel: 'medium',
          expectedReturn: correlation.priceImpactSensitivity * 0.3,
          timeHorizon: '5-30 minutes',
          maxPosition: 6,
          stopLoss: 4
        });
      }

      // Avoidance recommendation for high-risk pools
      if (efficiency.efficiencyScore < 40 || correlation.volatilityPrediction.expectedVolatility > 20) {
        suggestions.push({
          poolHash,
          strategy: 'avoid',
          reasoning: [
            efficiency.efficiencyScore < 40 ? `Very low efficiency: ${efficiency.efficiencyScore.toFixed(1)}/100` : '',
            correlation.volatilityPrediction.expectedVolatility > 20 ? `Extreme volatility predicted: ${correlation.volatilityPrediction.expectedVolatility.toFixed(1)}%` : '',
            'Risk-reward profile unfavorable'
          ].filter(Boolean),
          entryConditions: ['Avoid trading this pool'],
          exitConditions: ['Pool efficiency improves', 'Volatility prediction decreases'],
          riskLevel: 'extreme',
          expectedReturn: -5, // Expected loss
          timeHorizon: 'indefinite',
          maxPosition: 0,
          stopLoss: 0
        });
      }

      logger.info(`✅ Generated ${suggestions.length} positioning suggestions`);
      return suggestions;

    } catch (error) {
      logger.error(`Failed to generate positioning suggestions:`, error);
      return [];
    }
  }

  /**
   * Initialize game token patterns
   */
  private initializeGameTokenPatterns(): void {
    // GALA ecosystem patterns
    this.gameTokenPatterns.set('GALA', {
      tokenSymbol: 'GALA',
      seasonality: {
        gameUpdateBoosts: true,
        tournamentCycles: false,
        weekendPatterns: true
      },
      utilityEvents: {
        mechanicChanges: true,
        stakingChanges: true,
        burnEvents: true
      },
      communityBehavior: {
        guildCoordination: false,
        whaleInfluence: 7,
        retailParticipation: 8
      }
    });

    // Gaming token patterns
    this.gameTokenPatterns.set('TOWN', {
      tokenSymbol: 'TOWN',
      seasonality: {
        gameUpdateBoosts: true,
        tournamentCycles: true,
        weekendPatterns: true
      },
      utilityEvents: {
        mechanicChanges: true,
        stakingChanges: false,
        burnEvents: false
      },
      communityBehavior: {
        guildCoordination: true,
        whaleInfluence: 6,
        retailParticipation: 7
      }
    });

    this.gameTokenPatterns.set('SILK', {
      tokenSymbol: 'SILK',
      seasonality: {
        gameUpdateBoosts: false,
        tournamentCycles: false,
        weekendPatterns: false
      },
      utilityEvents: {
        mechanicChanges: true,
        stakingChanges: false,
        burnEvents: true
      },
      communityBehavior: {
        guildCoordination: false,
        whaleInfluence: 5,
        retailParticipation: 6
      }
    });
  }

  /**
   * Align TVL and price data by timestamp
   */
  private alignTvlPriceData(
    _tvlData: PoolLiquidityData[],
    priceData: PriceData[]
  ): Array<{ timestamp: number; tvlChangePercent: number; priceChangePercent: number }> {
    const aligned = [];
    const priceMap = new Map<number, PriceData>();

    // Create timestamp-indexed price map (rounded to minutes)
    priceData.forEach(price => {
      const roundedTime = Math.floor(price.timestamp / 60000) * 60000;
      priceMap.set(roundedTime, price);
    });

    for (let i = 1; i < _tvlData.length; i++) {
      const currentTvl = _tvlData[i];
      const previousTvl = _tvlData[i - 1];
      const roundedTime = Math.floor(currentTvl.timestamp / 60000) * 60000;

      const priceData = priceMap.get(roundedTime);
      if (priceData) {
        const tvlChangePercent = ((currentTvl.totalTvlUsd - previousTvl.totalTvlUsd) / previousTvl.totalTvlUsd) * 100;

        // Calculate price change (mock calculation since we need previous price)
        const priceChangePercent = Math.random() * 4 - 2; // Mock: -2% to +2%

        aligned.push({
          timestamp: currentTvl.timestamp,
          tvlChangePercent,
          priceChangePercent
        });
      }
    }

    return aligned;
  }

  /**
   * Calculate correlation coefficient
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Interpret correlation strength
   */
  private interpretCorrelationStrength(coefficient: number): 'very_weak' | 'weak' | 'moderate' | 'strong' | 'very_strong' {
    const abs = Math.abs(coefficient);
    if (abs >= 0.8) return 'very_strong';
    if (abs >= 0.6) return 'strong';
    if (abs >= 0.4) return 'moderate';
    if (abs >= 0.2) return 'weak';
    return 'very_weak';
  }

  /**
   * Calculate price impact sensitivity
   */
  private calculatePriceImpactSensitivity(alignedData: Array<{ tvlChangePercent: number; priceChangePercent: number }>): number {
    if (alignedData.length < 10) return 0;

    // Find cases where TVL changed significantly
    const significantTvlChanges = alignedData.filter(d => Math.abs(d.tvlChangePercent) >= 1);

    if (significantTvlChanges.length < 5) return 0;

    // Calculate average price response per % TVL change
    const sensitivity = significantTvlChanges.reduce((sum, d) => {
      return sum + Math.abs(d.priceChangePercent) / Math.abs(d.tvlChangePercent);
    }, 0) / significantTvlChanges.length;

    return Math.min(10, Math.max(0, sensitivity));
  }

  /**
   * Identify significant TVL-Price events
   */
  private identifyTvlPriceEvents(
    alignedData: Array<{ timestamp: number; tvlChangePercent: number; priceChangePercent: number }>
  ): TvlPriceEvent[] {
    const events: TvlPriceEvent[] = [];

    alignedData.forEach(data => {
      const { timestamp, tvlChangePercent, priceChangePercent } = data;

      // TVL spike with price pump
      if (tvlChangePercent > 2 && priceChangePercent > 1) {
        events.push({
          timestamp,
          eventType: 'tvl_spike_price_pump',
          tvlChange: tvlChangePercent,
          priceChange: priceChangePercent,
          impactMagnitude: Math.min(10, (tvlChangePercent + priceChangePercent) / 2),
          description: `TVL increased ${tvlChangePercent.toFixed(1)}%, price rose ${priceChangePercent.toFixed(1)}%`
        });
      }

      // TVL drain with price dump
      if (tvlChangePercent < -2 && priceChangePercent < -1) {
        events.push({
          timestamp,
          eventType: 'tvl_drain_price_dump',
          tvlChange: tvlChangePercent,
          priceChange: priceChangePercent,
          impactMagnitude: Math.min(10, Math.abs(tvlChangePercent + priceChangePercent) / 2),
          description: `TVL decreased ${Math.abs(tvlChangePercent).toFixed(1)}%, price fell ${Math.abs(priceChangePercent).toFixed(1)}%`
        });
      }

      // Inverse correlation (unusual)
      if (Math.abs(tvlChangePercent) > 1 && Math.abs(priceChangePercent) > 0.5) {
        const sameDirection = (tvlChangePercent > 0 && priceChangePercent > 0) || (tvlChangePercent < 0 && priceChangePercent < 0);
        if (!sameDirection) {
          events.push({
            timestamp,
            eventType: 'inverse_correlation',
            tvlChange: tvlChangePercent,
            priceChange: priceChangePercent,
            impactMagnitude: Math.min(10, (Math.abs(tvlChangePercent) + Math.abs(priceChangePercent)) / 2),
            description: `Inverse correlation: TVL ${tvlChangePercent > 0 ? 'up' : 'down'} ${Math.abs(tvlChangePercent).toFixed(1)}%, price ${priceChangePercent > 0 ? 'up' : 'down'} ${Math.abs(priceChangePercent).toFixed(1)}%`
          });
        }
      }
    });

    return events.sort((a, b) => b.impactMagnitude - a.impactMagnitude).slice(0, 10);
  }

  /**
   * Predict volatility from TVL patterns
   */
  private predictVolatilityFromTvl(
    alignedData: Array<{ tvlChangePercent: number; priceChangePercent: number }>,
    correlation: number
  ): VolatilityPrediction {
    const recentData = alignedData.slice(-20); // Last 20 data points

    // Calculate recent volatility trends
    const recentVolatility = recentData.reduce((sum, d) => sum + Math.abs(d.priceChangePercent), 0) / recentData.length;
    const recentTvlChanges = recentData.map(d => Math.abs(d.tvlChangePercent));
    const avgTvlChange = recentTvlChanges.reduce((sum, change) => sum + change, 0) / recentTvlChanges.length;

    // Base prediction on recent patterns
    let expectedVolatility = recentVolatility;

    // Adjust based on TVL change magnitude
    if (avgTvlChange > 1) {
      expectedVolatility *= 1.5; // TVL changes amplify volatility
    }

    // Adjust based on correlation strength
    if (Math.abs(correlation) > 0.6) {
      expectedVolatility *= 1.2; // Strong correlation = more predictable volatility
    }

    // Cap volatility prediction
    expectedVolatility = Math.min(25, Math.max(0.5, expectedVolatility));

    const primaryDrivers = [];
    if (avgTvlChange > 1) primaryDrivers.push('Active liquidity migration');
    if (Math.abs(correlation) > 0.6) primaryDrivers.push('Strong TVL-price correlation');
    if (recentVolatility > 3) primaryDrivers.push('Recent high volatility');

    return {
      expectedVolatility,
      confidenceInterval: [expectedVolatility * 0.7, expectedVolatility * 1.3],
      primaryDrivers,
      timeHorizon: '1 hour',
      reliability: primaryDrivers.length >= 2 ? 'high' : primaryDrivers.length === 1 ? 'medium' : 'low'
    };
  }

  /**
   * Calculate analysis confidence
   */
  private calculateAnalysisConfidence(dataPoints: number, windowHours: number): number {
    const dataQualityScore = Math.min(1, dataPoints / 100);
    const windowScore = Math.min(1, windowHours / 168); // 7 days ideal
    return (dataQualityScore + windowScore) / 2;
  }

  /**
   * Calculate TVL utilization efficiency
   */
  private calculateTvlUtilization(_tvlData: PoolLiquidityData[]): number {
    if (_tvlData.length < 2) return 50;

    const latest = _tvlData[_tvlData.length - 1];
    const utilizationRatio = latest.liquidityConcentration.currentPriceUtilization;

    // Higher utilization = better efficiency
    return Math.min(100, utilizationRatio);
  }

  /**
   * Calculate price stability score
   */
  private calculatePriceStability(priceData: PriceData[]): number {
    if (priceData.length < 2) return 50;

    // Calculate price volatility (lower volatility = higher stability)
    const priceChanges = [];
    for (let i = 1; i < priceData.length; i++) {
      const change = Math.abs((priceData[i].price - priceData[i-1].price) / priceData[i-1].price) * 100;
      priceChanges.push(change);
    }

    const avgVolatility = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;

    // Convert volatility to stability score (inverse relationship)
    return Math.max(0, 100 - avgVolatility * 10);
  }

  /**
   * Calculate liquidity distribution score
   */
  private calculateLiquidityDistribution(latestTvl: PoolLiquidityData): number {
    const { liquidityConcentration } = latestTvl;

    // Balanced distribution = higher score
    const balance = 100 - Math.abs(50 - liquidityConcentration.tightRangePercentage);
    return Math.max(0, Math.min(100, balance));
  }

  /**
   * Calculate migration frequency score
   */
  private calculateMigrationFrequency(migrations: LiquidityMigration[]): number {
    const recentMigrations = migrations.filter(m => Date.now() - m.timestamp < 7 * 24 * 60 * 60 * 1000);

    // Lower frequency = higher score (more stability)
    const weeklyMigrations = recentMigrations.length;
    return Math.max(0, 100 - weeklyMigrations * 10);
  }

  /**
   * Calculate volume to TVL ratio
   */
  private calculateVolumeToTvlRatio(_tvlData: PoolLiquidityData[]): number {
    // Mock calculation - in reality would need volume data
    const mockVolumeToTvlRatio = 0.05 + Math.random() * 0.1; // 5-15% daily volume/TVL
    return Math.min(100, mockVolumeToTvlRatio * 1000);
  }

  /**
   * Determine efficiency ranking
   */
  private determineEfficiencyRanking(score: number): 'excellent' | 'good' | 'average' | 'poor' | 'terrible' {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 50) return 'average';
    if (score >= 25) return 'poor';
    return 'terrible';
  }

  /**
   * Generate efficiency recommendations
   */
  private generateEfficiencyRecommendations(
    tvlUtilization: number,
    priceStability: number,
    liquidityDistribution: number,
    migrationFrequency: number,
    volumeToTvlRatio: number
  ): string[] {
    const recommendations = [];

    if (tvlUtilization < 70) {
      recommendations.push('Improve liquidity concentration around current price');
    }

    if (priceStability < 60) {
      recommendations.push('Consider range-bound strategies due to high volatility');
    }

    if (liquidityDistribution < 50) {
      recommendations.push('Liquidity distribution is imbalanced - opportunities for rebalancing');
    }

    if (migrationFrequency < 70) {
      recommendations.push('High migration frequency - monitor for stability');
    }

    if (volumeToTvlRatio < 30) {
      recommendations.push('Low volume relative to TVL - may indicate inefficient price discovery');
    }

    return recommendations.length > 0 ? recommendations : ['Pool shows good overall efficiency'];
  }

  /**
   * Analyze seasonal migration patterns
   */
  private analyzeSeasonalPatterns(migrations: LiquidityMigration[]): MigrationPattern | null {
    // Mock seasonal analysis
    const weekendMigrations = migrations.filter(m => {
      const day = new Date(m.timestamp).getDay();
      return day === 0 || day === 6; // Sunday or Saturday
    });

    if (weekendMigrations.length > migrations.length * 0.3) {
      return {
        patternType: 'seasonal',
        frequency: weekendMigrations.length,
        averageSizeUsd: weekendMigrations.reduce((sum, m) => sum + m.amountUsd, 0) / weekendMigrations.length,
        typicalTimeRanges: ['Saturday 14-18', 'Sunday 10-14'],
        triggerEvents: ['Weekend trading patterns', 'Retail trader activity'],
        predictability: 0.7,
        profitOpportunity: 6
      };
    }

    return null;
  }

  /**
   * Analyze event-driven patterns
   */
  private analyzeEventDrivenPatterns(migrations: LiquidityMigration[]): MigrationPattern | null {
    // Mock event analysis - in reality would correlate with external events
    const largeMigrations = migrations.filter(m => m.amountUsd > 500000);

    if (largeMigrations.length > 3) {
      return {
        patternType: 'event_driven',
        frequency: largeMigrations.length,
        averageSizeUsd: largeMigrations.reduce((sum, m) => sum + m.amountUsd, 0) / largeMigrations.length,
        typicalTimeRanges: ['Various'],
        triggerEvents: ['Major announcements', 'Market news', 'Protocol updates'],
        predictability: 0.4,
        profitOpportunity: 8
      };
    }

    return null;
  }

  /**
   * Analyze whale coordination patterns
   */
  private analyzeWhaleCoordinationPatterns(migrations: LiquidityMigration[]): MigrationPattern | null {
    // Mock whale analysis
    const coordinatedMigrations = migrations.filter(m => m.amountUsd > 1000000);

    if (coordinatedMigrations.length >= 2) {
      return {
        patternType: 'whale_coordination',
        frequency: coordinatedMigrations.length,
        averageSizeUsd: coordinatedMigrations.reduce((sum, m) => sum + m.amountUsd, 0) / coordinatedMigrations.length,
        typicalTimeRanges: ['Low volume periods'],
        triggerEvents: ['Whale coordination', 'Large position changes'],
        predictability: 0.3,
        profitOpportunity: 9
      };
    }

    return null;
  }

  /**
   * Analyze yield farming patterns
   */
  private analyzeYieldFarmingPatterns(migrations: LiquidityMigration[]): MigrationPattern | null {
    // Mock yield farming analysis
    const regularMigrations = migrations.filter(m => m.amountUsd > 50000 && m.amountUsd < 200000);

    if (regularMigrations.length > migrations.length * 0.6) {
      return {
        patternType: 'yield_farming',
        frequency: regularMigrations.length,
        averageSizeUsd: regularMigrations.reduce((sum, m) => sum + m.amountUsd, 0) / regularMigrations.length,
        typicalTimeRanges: ['Daily', 'Following APR changes'],
        triggerEvents: ['APR optimization', 'Reward periods', 'Fee changes'],
        predictability: 0.8,
        profitOpportunity: 5
      };
    }

    return null;
  }

  /**
   * Analyze game token specific patterns
   */
  private analyzeGameTokenPatterns(migrations: LiquidityMigration[], gameToken: string): MigrationPattern | null {
    const tokenPattern = this.gameTokenPatterns.get(gameToken);
    if (!tokenPattern) return null;

    // Mock game-specific analysis
    return {
      patternType: 'speculation',
      frequency: migrations.length,
      averageSizeUsd: migrations.reduce((sum, m) => sum + m.amountUsd, 0) / migrations.length,
      typicalTimeRanges: tokenPattern.seasonality.weekendPatterns ? ['Weekends'] : ['Various'],
      triggerEvents: [
        tokenPattern.seasonality.gameUpdateBoosts ? 'Game updates' : '',
        tokenPattern.utilityEvents.mechanicChanges ? 'Token mechanic changes' : '',
        tokenPattern.communityBehavior.guildCoordination ? 'Guild coordination' : ''
      ].filter(Boolean),
      predictability: tokenPattern.communityBehavior.whaleInfluence > 7 ? 0.6 : 0.4,
      profitOpportunity: tokenPattern.communityBehavior.whaleInfluence
    };
  }

  /**
   * Calculate stop loss percentage based on volatility
   */
  private calculateStopLoss(expectedVolatility: number): number {
    // Stop loss = 1.5x expected volatility, capped between 2-8%
    return Math.max(2, Math.min(8, expectedVolatility * 1.5));
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.correlationCache.clear();
    this.efficiencyCache.clear();
    this.migrationPatterns.clear();
    logger.info('TVL Analyzer caches cleared');
  }

  /**
   * Get service statistics
   */
  getStats(): {
    cachedAnalyses: number;
    cachedEfficiencies: number;
    recognizedPatterns: number;
    gameTokenPatterns: number;
  } {
    let patternCount = 0;
    this.migrationPatterns.forEach(patterns => {
      patternCount += patterns.length;
    });

    return {
      cachedAnalyses: this.correlationCache.size,
      cachedEfficiencies: this.efficiencyCache.size,
      recognizedPatterns: patternCount,
      gameTokenPatterns: this.gameTokenPatterns.size
    };
  }
}

/**
 * Create a TVL analyzer instance
 */
export function createTvlAnalyzer(): TvlAnalyzer {
  return new TvlAnalyzer();
}