/**
 * Volume Analyzer
 * Real-time volume monitoring and surge detection for momentum trading
 * 
 * Key Features:
 * - Statistical volume analysis (1hr, 4hr, 24hr averages)
 * - Volume surge classification system
 * - Volume-price correlation analysis
 * - False signal filtering
 * - Gaming token considerations
 */

import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { PriceTracker, PriceData } from './price-tracker';

export interface VolumeData {
  token: string;
  timestamp: number;
  volume: number;
  volumeUSD: number;
  price: number;
  trades: number;
  avgTradeSize: number;
}

export interface VolumeMetrics {
  token: string;
  currentVolume: number;
  volume1h: number;
  volume4h: number;
  volume24h: number;
  avg1h: number;
  avg4h: number;
  avg24h: number;
  timestamp: number;
}

export interface VolumeSurgeSignal {
  token: string;
  timestamp: number;
  surgeType: 'moderate' | 'strong' | 'extreme';
  surgePercent: number;
  currentVolume: number;
  averageVolume: number;
  duration: number;
  priceCorrelation: number;
  qualityScore: number; // 0-100
  isValid: boolean;
  falseSignalRisk: 'low' | 'medium' | 'high';
  gameRelatedContext?: {
    newsEvent?: string;
    tournamentActive?: boolean;
    seasonStart?: boolean;
    communityDriven?: boolean;
  };
}

export interface VolumeAnalysis {
  token: string;
  currentMetrics: VolumeMetrics;
  surgeSignal?: VolumeSurgeSignal;
  marketCondition: 'normal' | 'accumulation' | 'distribution' | 'breakout';
  liquidityDepth: number;
  whaleActivity: boolean;
  recommendation: 'hold' | 'watch' | 'enter' | 'exit';
}

export class VolumeAnalyzer {
  private priceTracker: PriceTracker;
  private volumeHistory: Map<string, VolumeData[]> = new Map();
  private activeSignals: Map<string, VolumeSurgeSignal> = new Map();
  private isRunning: boolean = false;
  private analysisInterval: NodeJS.Timeout | null = null;

  // Volume thresholds
  private readonly SURGE_THRESHOLDS = {
    MODERATE: 2.0,   // 200% of 1hr average
    STRONG: 4.0,     // 400% of 1hr average
    EXTREME: 8.0     // 800% of 1hr average
  };

  // Minimum volume requirements (USD equivalent)
  private readonly MIN_VOLUME_USD = 1000;
  private readonly MIN_LIQUIDITY_USD = 5000;

  // Gaming token patterns
  private readonly GAMING_TOKENS = new Set([
    'GALA', 'ETIME', 'SILK', 'GTON'
  ]);

  // Quality filters
  private readonly QUALITY_WEIGHTS = {
    DURATION: 0.25,        // How long surge is sustained
    CORRELATION: 0.30,     // Volume-price correlation
    LIQUIDITY: 0.20,       // Market depth
    CONSISTENCY: 0.15,     // Volume pattern consistency
    WHALE_FACTOR: 0.10     // Large order detection
  };

  constructor(priceTracker: PriceTracker) {
    this.priceTracker = priceTracker;
    this.initializeVolumeTracking();
    logger.info('Volume Analyzer initialized');
  }

  /**
   * Start volume analysis
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Volume Analyzer already running');
      return;
    }

    try {
      logger.info('Starting Volume Analyzer...');
      
      // Initial volume collection
      await this.collectCurrentVolumeData();

      // Start analysis loop
      this.analysisInterval = setInterval(async () => {
        try {
          await this.performVolumeAnalysis();
        } catch (error) {
          logger.error('Error in volume analysis cycle:', error);
        }
      }, 30000); // Analyze every 30 seconds for real-time detection

      this.isRunning = true;
      logger.info('✅ Volume Analyzer started successfully');

    } catch (error) {
      logger.error('❌ Failed to start Volume Analyzer:', error);
      throw error;
    }
  }

  /**
   * Stop volume analysis
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }

    this.isRunning = false;
    logger.info('Volume Analyzer stopped');
  }

  /**
   * Initialize volume tracking for all tokens
   */
  private initializeVolumeTracking(): void {
    const tokens = Object.values(TRADING_CONSTANTS.TOKENS);
    
    tokens.forEach(tokenKey => {
      const symbol = tokenKey.split('|')[0];
      this.volumeHistory.set(symbol, []);
    });

    logger.info(`Volume tracking initialized for ${tokens.length} tokens`);
  }

  /**
   * Collect current volume data from all sources
   */
  private async collectCurrentVolumeData(): Promise<void> {
    try {
      const timestamp = Date.now();
      const allPrices = this.priceTracker.getAllPrices();

      for (const [token, priceData] of Object.entries(allPrices)) {
        try {
          // For production bot, volume data would come from API
          // Since GalaSwap API doesn't provide volume reliably, we'll estimate
          const estimatedVolume = await this.estimateTokenVolume(token, priceData);
          
          const volumeData: VolumeData = {
            token,
            timestamp,
            volume: estimatedVolume.volume,
            volumeUSD: estimatedVolume.volumeUSD,
            price: priceData.priceUsd,
            trades: estimatedVolume.trades,
            avgTradeSize: estimatedVolume.avgTradeSize
          };

          // Store volume data with size limits
          const history = this.volumeHistory.get(token) || [];
          history.push(volumeData);

          // Keep only last 24 hours (2880 data points at 30-second intervals)
          const oneDayAgo = timestamp - (24 * 60 * 60 * 1000);
          const filteredHistory = history.filter(d => d.timestamp > oneDayAgo);
          
          this.volumeHistory.set(token, filteredHistory);

        } catch (error) {
          logger.debug(`Failed to collect volume data for ${token}:`, error);
        }
      }

      logger.debug(`Volume data collection completed for ${Object.keys(allPrices).length} tokens`);

    } catch (error) {
      logger.error('Error collecting volume data:', error);
    }
  }

  /**
   * Estimate token volume from available data
   */
  private async estimateTokenVolume(token: string, priceData: PriceData): Promise<{
    volume: number;
    volumeUSD: number;
    trades: number;
    avgTradeSize: number;
  }> {
    try {
      // Base volume estimation from price movements and market activity
      const baseVolume = this.calculateBaseVolumeEstimate(token, priceData);
      
      // Apply gaming token multipliers
      let volumeMultiplier = 1.0;
      if (this.GAMING_TOKENS.has(token)) {
        volumeMultiplier = this.calculateGamingTokenMultiplier(token);
      }

      const estimatedVolume = baseVolume * volumeMultiplier;
      const volumeUSD = estimatedVolume * priceData.priceUsd;
      
      // Estimate trade count and average size
      const estimatedTrades = Math.max(1, Math.floor(estimatedVolume / 100)); // ~100 tokens per trade average
      const avgTradeSize = estimatedVolume / estimatedTrades;

      return {
        volume: estimatedVolume,
        volumeUSD,
        trades: estimatedTrades,
        avgTradeSize
      };

    } catch (error) {
      logger.error(`Error estimating volume for ${token}:`, error);
      return {
        volume: 0,
        volumeUSD: 0,
        trades: 0,
        avgTradeSize: 0
      };
    }
  }

  /**
   * Calculate base volume estimate from price and market data
   */
  private calculateBaseVolumeEstimate(token: string, priceData: PriceData): number {
    // Use price change to estimate trading activity
    const priceChange = Math.abs(priceData.change24h) / 100;
    const baseActivity = 1000; // Base daily volume in tokens
    
    // Higher price volatility typically correlates with higher volume
    const volatilityMultiplier = 1 + (priceChange * 10);
    
    // Token-specific volume patterns
    let tokenMultiplier = 1.0;
    switch (token) {
      case 'GALA':
        tokenMultiplier = 5.0; // High volume main token
        break;
      case 'GUSDC':
        tokenMultiplier = 3.0; // High volume stable token
        break;
      case 'ETIME':
      case 'SILK':
        tokenMultiplier = 2.0; // Medium volume gaming tokens
        break;
      default:
        tokenMultiplier = 1.0;
    }

    return baseActivity * volatilityMultiplier * tokenMultiplier;
  }

  /**
   * Calculate gaming token volume multiplier based on market conditions
   */
  private calculateGamingTokenMultiplier(token: string): number {
    // Base multiplier for gaming tokens
    let multiplier = 1.5;

    // Time-based adjustments (gaming activity peaks)
    const now = new Date();
    const hour = now.getUTCHours();

    // Peak gaming hours (EST/PST evening = UTC morning/afternoon)
    if (hour >= 1 && hour <= 5) { // 8PM-12AM EST
      multiplier *= 1.3;
    } else if (hour >= 12 && hour <= 16) { // 8PM-12AM PST
      multiplier *= 1.2;
    }

    // Weekend bonus
    const day = now.getUTCDay();
    if (day === 6 || day === 0) { // Saturday or Sunday
      multiplier *= 1.1;
    }

    // Token-specific gaming patterns
    switch (token) {
      case 'GALA':
        multiplier *= 1.2; // Main gaming ecosystem token
        break;
      case 'ETIME':
        multiplier *= 1.1; // Tournament-related volume spikes
        break;
    }

    return multiplier;
  }

  /**
   * Perform comprehensive volume analysis
   */
  private async performVolumeAnalysis(): Promise<void> {
    try {
      logger.debug('Performing volume analysis cycle...');

      // Collect fresh volume data
      await this.collectCurrentVolumeData();

      // Analyze each token
      for (const [token, history] of this.volumeHistory.entries()) {
        if (history.length < 10) continue; // Need minimum data points

        try {
          const analysis = await this.analyzeTokenVolume(token, history);
          
          // Check for volume surge signals
          if (analysis.surgeSignal && analysis.surgeSignal.isValid) {
            await this.processVolumeSurgeSignal(analysis.surgeSignal);
          }

          // Update market condition assessment
          await this.updateMarketConditionAssessment(token, analysis);

        } catch (error) {
          logger.debug(`Volume analysis failed for ${token}:`, error);
        }
      }

      // Clean up old signals
      this.cleanupOldSignals();

      logger.debug('Volume analysis cycle completed');

    } catch (error) {
      logger.error('Error in volume analysis:', error);
    }
  }

  /**
   * Analyze volume patterns for a specific token
   */
  private async analyzeTokenVolume(token: string, history: VolumeData[]): Promise<VolumeAnalysis> {
    const metrics = this.calculateVolumeMetrics(token, history);
    
    // Detect volume surge
    let surgeSignal: VolumeSurgeSignal | undefined;
    const surge = this.detectVolumeSurge(token, metrics, history);
    
    if (surge) {
      // Validate surge signal
      const validated = await this.validateSurgeSignal(surge);
      if (validated.isValid) {
        surgeSignal = validated;
      }
    }

    // Determine market condition
    const marketCondition = this.assessMarketCondition(metrics, history);
    
    // Calculate liquidity depth
    const liquidityDepth = await this.calculateLiquidityDepth(token);
    
    // Detect whale activity
    const whaleActivity = this.detectWhaleActivity(history);
    
    // Generate recommendation
    const recommendation = this.generateRecommendation(metrics, surgeSignal, marketCondition);

    return {
      token,
      currentMetrics: metrics,
      surgeSignal,
      marketCondition,
      liquidityDepth,
      whaleActivity,
      recommendation
    };
  }

  /**
   * Calculate volume metrics for analysis
   */
  private calculateVolumeMetrics(token: string, history: VolumeData[]): VolumeMetrics {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const fourHours = 4 * oneHour;
    const twentyFourHours = 24 * oneHour;

    // Filter data by time periods
    const last1h = history.filter(d => d.timestamp > now - oneHour);
    const last4h = history.filter(d => d.timestamp > now - fourHours);
    const last24h = history.filter(d => d.timestamp > now - twentyFourHours);

    // Calculate volume sums
    const volume1h = last1h.reduce((sum, d) => sum + d.volumeUSD, 0);
    const volume4h = last4h.reduce((sum, d) => sum + d.volumeUSD, 0);
    const volume24h = last24h.reduce((sum, d) => sum + d.volumeUSD, 0);

    // Calculate averages (per hour)
    const avg1h = volume1h; // Already 1 hour
    const avg4h = volume4h / 4;
    const avg24h = volume24h / 24;

    const currentVolume = last1h.length > 0 ? 
      last1h[last1h.length - 1].volumeUSD : 0;

    return {
      token,
      currentVolume,
      volume1h,
      volume4h,
      volume24h,
      avg1h,
      avg4h,
      avg24h,
      timestamp: now
    };
  }

  /**
   * Detect volume surge patterns
   */
  private detectVolumeSurge(token: string, metrics: VolumeMetrics, history: VolumeData[]): VolumeSurgeSignal | null {
    try {
      // Skip if insufficient data
      if (metrics.avg1h === 0 || history.length < 20) return null;

      // Calculate surge ratio against 1hr average
      const surgeRatio = metrics.currentVolume / metrics.avg1h;
      
      // Determine surge type
      let surgeType: 'moderate' | 'strong' | 'extreme';
      if (surgeRatio >= this.SURGE_THRESHOLDS.EXTREME) {
        surgeType = 'extreme';
      } else if (surgeRatio >= this.SURGE_THRESHOLDS.STRONG) {
        surgeType = 'strong';
      } else if (surgeRatio >= this.SURGE_THRESHOLDS.MODERATE) {
        surgeType = 'moderate';
      } else {
        return null; // No significant surge
      }

      // Check minimum volume threshold
      if (metrics.currentVolume < this.MIN_VOLUME_USD) {
        logger.debug(`Volume surge below minimum threshold for ${token}: $${metrics.currentVolume}`);
        return null;
      }

      // Calculate surge duration
      const surgeStartTime = this.findSurgeStartTime(history, metrics.avg1h);
      const duration = Date.now() - surgeStartTime;

      // Calculate price correlation
      const priceCorrelation = this.calculatePriceVolumeCorrelation(history);

      // Initial quality score
      const qualityScore = this.calculateSurgeQualityScore(
        surgeType, duration, priceCorrelation, metrics, history
      );

      // Gaming context detection
      const gameContext = this.GAMING_TOKENS.has(token) ? 
        this.detectGamingContext(token, surgeType) : undefined;

      return {
        token,
        timestamp: Date.now(),
        surgeType,
        surgePercent: (surgeRatio - 1) * 100,
        currentVolume: metrics.currentVolume,
        averageVolume: metrics.avg1h,
        duration,
        priceCorrelation,
        qualityScore,
        isValid: false, // Will be validated separately
        falseSignalRisk: 'medium', // Will be calculated in validation
        gameRelatedContext: gameContext
      };

    } catch (error) {
      logger.error(`Error detecting volume surge for ${token}:`, error);
      return null;
    }
  }

  /**
   * Find when the volume surge started
   */
  private findSurgeStartTime(history: VolumeData[], averageVolume: number): number {
    const threshold = averageVolume * 1.5; // 50% above average

    // Look backwards from current time
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].volumeUSD < threshold) {
        return i < history.length - 1 ? history[i + 1].timestamp : history[i].timestamp;
      }
    }

    // If no start found, use oldest available data
    return history[0]?.timestamp || Date.now();
  }

  /**
   * Calculate price-volume correlation
   */
  private calculatePriceVolumeCorrelation(history: VolumeData[]): number {
    if (history.length < 10) return 0;

    const recentData = history.slice(-20); // Last 20 data points
    
    // Calculate price returns and volume changes
    const priceReturns: number[] = [];
    const volumeChanges: number[] = [];

    for (let i = 1; i < recentData.length; i++) {
      const priceReturn = (recentData[i].price - recentData[i-1].price) / recentData[i-1].price;
      const volumeChange = (recentData[i].volumeUSD - recentData[i-1].volumeUSD) / 
                          Math.max(recentData[i-1].volumeUSD, 1);
      
      priceReturns.push(priceReturn);
      volumeChanges.push(volumeChange);
    }

    // Calculate correlation coefficient
    if (priceReturns.length < 5) return 0;

    const correlation = this.calculateCorrelation(priceReturns, volumeChanges);
    return Math.abs(correlation); // Use absolute correlation
  }

  /**
   * Calculate correlation coefficient between two arrays
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n !== y.length || n < 2) return 0;

    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let sumXSquared = 0;
    let sumYSquared = 0;

    for (let i = 0; i < n; i++) {
      const deltaX = x[i] - meanX;
      const deltaY = y[i] - meanY;
      
      numerator += deltaX * deltaY;
      sumXSquared += deltaX * deltaX;
      sumYSquared += deltaY * deltaY;
    }

    const denominator = Math.sqrt(sumXSquared * sumYSquared);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Calculate surge signal quality score
   */
  private calculateSurgeQualityScore(
    surgeType: 'moderate' | 'strong' | 'extreme',
    duration: number,
    priceCorrelation: number,
    metrics: VolumeMetrics,
    history: VolumeData[]
  ): number {
    let score = 0;

    // Duration score (sustained volume is better)
    const maxDuration = 60 * 60 * 1000; // 1 hour
    const durationScore = Math.min(duration / maxDuration, 1) * 100;
    score += durationScore * this.QUALITY_WEIGHTS.DURATION;

    // Correlation score (volume should correlate with price movement)
    const correlationScore = Math.min(priceCorrelation * 2, 1) * 100;
    score += correlationScore * this.QUALITY_WEIGHTS.CORRELATION;

    // Liquidity score (higher volume in absolute terms is better)
    const liquidityScore = Math.min(metrics.currentVolume / 10000, 1) * 100;
    score += liquidityScore * this.QUALITY_WEIGHTS.LIQUIDITY;

    // Consistency score (volume should be consistent during surge)
    const consistencyScore = this.calculateVolumeConsistency(history) * 100;
    score += consistencyScore * this.QUALITY_WEIGHTS.CONSISTENCY;

    // Whale factor (large single orders are suspicious)
    const whaleScore = this.calculateWhaleScore(history) * 100;
    score += whaleScore * this.QUALITY_WEIGHTS.WHALE_FACTOR;

    // Surge type bonus
    switch (surgeType) {
      case 'extreme':
        score *= 1.2; // 20% bonus for extreme surges
        break;
      case 'strong':
        score *= 1.1; // 10% bonus for strong surges
        break;
      case 'moderate':
        score *= 1.0; // No bonus
        break;
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate volume consistency during surge period
   */
  private calculateVolumeConsistency(history: VolumeData[]): number {
    if (history.length < 5) return 0;

    const recent = history.slice(-10); // Last 10 data points
    const volumes = recent.map(d => d.volumeUSD);
    
    const mean = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const variance = volumes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / volumes.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Lower coefficient of variation = higher consistency
    const coefficientOfVariation = mean === 0 ? 1 : standardDeviation / mean;
    return Math.max(0, 1 - coefficientOfVariation);
  }

  /**
   * Calculate whale activity score (lower is better)
   */
  private calculateWhaleScore(history: VolumeData[]): number {
    if (history.length < 5) return 0.5;

    const recent = history.slice(-10);
    const avgTradeSize = recent.reduce((sum, d) => sum + d.avgTradeSize, 0) / recent.length;
    const maxTradeSize = Math.max(...recent.map(d => d.avgTradeSize));
    
    // If max trade size is much larger than average, it indicates whale activity
    const whaleRatio = avgTradeSize === 0 ? 1 : maxTradeSize / avgTradeSize;
    
    // Score decreases with whale activity (higher ratios)
    return Math.max(0, Math.min(1, 1 - ((whaleRatio - 1) / 10)));
  }

  /**
   * Detect gaming-related context for volume surges
   */
  private detectGamingContext(token: string, surgeType: 'moderate' | 'strong' | 'extreme'): {
    newsEvent?: string;
    tournamentActive?: boolean;
    seasonStart?: boolean;
    communityDriven?: boolean;
  } {
    const context: Record<string, unknown> = {};

    // Time-based gaming event detection
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();

    // Tournament hours detection (typical gaming tournament times)
    if (hour >= 0 && hour <= 6) { // Late night tournaments
      context.tournamentActive = true;
    }

    // Weekend gaming activity
    if (day === 6 || day === 0) {
      context.communityDriven = true;
    }

    // Token-specific patterns
    switch (token) {
      case 'ETIME':
        // ETIME surges often correlate with tournament announcements
        if (surgeType === 'extreme') {
          context.newsEvent = 'Possible tournament announcement';
        }
        break;
      
      case 'SILK':
        // SILK surges might indicate new game features
        if (surgeType === 'strong' || surgeType === 'extreme') {
          context.newsEvent = 'Possible game update or feature release';
        }
        break;
      
      case 'GALA':
        // Main token surges could indicate ecosystem news
        if (surgeType === 'extreme') {
          context.newsEvent = 'Possible major ecosystem announcement';
        }
        break;
    }

    // Season start detection (rough approximation)
    const month = now.getUTCMonth();
    if ([2, 5, 8, 11].includes(month)) { // Quarterly seasons
      context.seasonStart = true;
    }

    return context;
  }

  /**
   * Validate surge signal against false positive filters
   */
  private async validateSurgeSignal(
    signal: VolumeSurgeSignal
  ): Promise<VolumeSurgeSignal> {
    const validatedSignal = { ...signal };

    try {
      // Check time-of-day filter (avoid low-liquidity hours)
      const now = new Date();
      const hour = now.getUTCHours();
      
      // Low liquidity hours: 02:00-08:00 UTC
      const isLowLiquidityHour = hour >= 2 && hour <= 8;
      
      // Check market condition filter
      const isMarketStress = await this.checkMarketStress();
      
      // Check correlation filter (avoid if too many similar surges)
      const correlatedSurges = await this.checkCorrelatedSurges(signal.token);
      
      // Calculate false signal risk
      let riskFactors = 0;
      
      if (isLowLiquidityHour) riskFactors += 1;
      if (isMarketStress) riskFactors += 1;
      if (correlatedSurges >= 3) riskFactors += 2;
      if (signal.priceCorrelation < 0.3) riskFactors += 1;
      if (signal.duration < 10 * 60 * 1000) riskFactors += 1; // Less than 10 minutes
      
      // Determine false signal risk level
      if (riskFactors >= 4) {
        validatedSignal.falseSignalRisk = 'high';
        validatedSignal.isValid = false;
      } else if (riskFactors >= 2) {
        validatedSignal.falseSignalRisk = 'medium';
        validatedSignal.isValid = signal.qualityScore >= 60;
      } else {
        validatedSignal.falseSignalRisk = 'low';
        validatedSignal.isValid = signal.qualityScore >= 40;
      }

      // Additional validation for minimum thresholds
      if (signal.currentVolume < this.MIN_VOLUME_USD) {
        validatedSignal.isValid = false;
      }

      // Check liquidity depth requirement
      const liquidityDepth = await this.calculateLiquidityDepth(signal.token);
      if (liquidityDepth < this.MIN_LIQUIDITY_USD) {
        validatedSignal.isValid = false;
      }

      logger.debug(`Volume surge validation for ${signal.token}:`, {
        quality: signal.qualityScore,
        risk: validatedSignal.falseSignalRisk,
        valid: validatedSignal.isValid,
        riskFactors
      });

    } catch (error) {
      logger.error(`Error validating surge signal for ${signal.token}:`, error);
      validatedSignal.isValid = false;
      validatedSignal.falseSignalRisk = 'high';
    }

    return validatedSignal;
  }

  /**
   * Check for market stress conditions
   */
  private async checkMarketStress(): Promise<boolean> {
    try {
      // Check if multiple tokens are experiencing extreme volatility
      const allPrices = this.priceTracker.getAllPrices();
      const highVolatilityTokens = Object.values(allPrices)
        .filter(price => Math.abs(price.change24h) > 15) // >15% change
        .length;

      // Market stress if >50% of tokens showing high volatility
      return highVolatilityTokens > Object.keys(allPrices).length * 0.5;

    } catch (error) {
      logger.error('Error checking market stress:', error);
      return false;
    }
  }

  /**
   * Check for correlated surges in other tokens
   */
  private async checkCorrelatedSurges(excludeToken: string): Promise<number> {
    try {
      let correlatedCount = 0;
      
      for (const [token, signal] of this.activeSignals.entries()) {
        if (token === excludeToken) continue;
        
        // Check if signal is recent (within last hour)
        const oneHour = 60 * 60 * 1000;
        if (Date.now() - signal.timestamp < oneHour) {
          correlatedCount++;
        }
      }

      return correlatedCount;
    } catch (error) {
      logger.error('Error checking correlated surges:', error);
      return 0;
    }
  }

  /**
   * Calculate liquidity depth for a token
   */
  private async calculateLiquidityDepth(token: string): Promise<number> {
    try {
      // This would typically query pool depth data
      // For now, use price data to estimate
      const priceData = this.priceTracker.getPrice(token);
      if (!priceData) return 0;

      // Estimate based on token characteristics
      switch (token) {
        case 'GALA':
          return 100000; // High liquidity main token
        case 'GUSDC':
          return 50000; // High liquidity stable token
        case 'ETIME':
        case 'SILK':
          return 25000; // Medium liquidity gaming tokens
        default:
          return 10000; // Default liquidity estimate
      }
    } catch (error) {
      logger.error(`Error calculating liquidity depth for ${token}:`, error);
      return 0;
    }
  }

  /**
   * Assess market condition based on volume patterns
   */
  private assessMarketCondition(
    metrics: VolumeMetrics, 
    history: VolumeData[]
  ): 'normal' | 'accumulation' | 'distribution' | 'breakout' {
    if (history.length < 10) return 'normal';

    const currentVolume = metrics.currentVolume;
    const avgVolume = metrics.avg24h;
    
    // Breakout: High volume with increasing trend
    if (currentVolume > avgVolume * 3) {
      return 'breakout';
    }
    
    // Distribution: Above average volume with consistent selling
    if (currentVolume > avgVolume * 1.5) {
      const recent = history.slice(-10);
      const priceDecreasing = recent.every((d, i) => 
        i === 0 || d.price <= recent[i - 1].price
      );
      
      if (priceDecreasing) {
        return 'distribution';
      }
    }
    
    // Accumulation: Below average volume with price stability
    if (currentVolume < avgVolume * 0.7) {
      return 'accumulation';
    }
    
    return 'normal';
  }

  /**
   * Detect whale activity patterns
   */
  private detectWhaleActivity(history: VolumeData[]): boolean {
    if (history.length < 5) return false;

    const recent = history.slice(-5);
    const avgTradeSize = recent.reduce((sum, d) => sum + d.avgTradeSize, 0) / recent.length;
    
    // Whale activity if average trade size > $10k
    return avgTradeSize > 10000;
  }

  /**
   * Generate trading recommendation
   */
  private generateRecommendation(
    metrics: VolumeMetrics,
    surgeSignal?: VolumeSurgeSignal,
    marketCondition?: 'normal' | 'accumulation' | 'distribution' | 'breakout'
  ): 'hold' | 'watch' | 'enter' | 'exit' {
    // Strong surge signal = enter
    if (surgeSignal?.isValid && surgeSignal.surgeType === 'extreme' && surgeSignal.qualityScore > 70) {
      return 'enter';
    }
    
    // Good surge signal = watch
    if (surgeSignal?.isValid && surgeSignal.qualityScore > 50) {
      return 'watch';
    }
    
    // Distribution phase = exit
    if (marketCondition === 'distribution') {
      return 'exit';
    }
    
    // Accumulation phase = watch
    if (marketCondition === 'accumulation') {
      return 'watch';
    }
    
    return 'hold';
  }

  /**
   * Process validated volume surge signal
   */
  private async processVolumeSurgeSignal(signal: VolumeSurgeSignal): Promise<void> {
    try {
      // Store active signal
      this.activeSignals.set(signal.token, signal);
      
      logger.info(`📈 VOLUME SURGE DETECTED: ${signal.token}`, {
        type: signal.surgeType.toUpperCase(),
        surge: `${signal.surgePercent.toFixed(1)}%`,
        volume: `$${signal.currentVolume.toFixed(0)}`,
        quality: signal.qualityScore.toFixed(1),
        correlation: signal.priceCorrelation.toFixed(2),
        duration: `${Math.floor(signal.duration / 60000)}min`,
        risk: signal.falseSignalRisk,
        gameContext: signal.gameRelatedContext?.newsEvent || 'none'
      });

      // Emit signal for strategy consumption
      // This would integrate with the strategy orchestrator

    } catch (error) {
      logger.error(`Error processing volume surge signal for ${signal.token}:`, error);
    }
  }

  /**
   * Update market condition assessment
   */
  private async updateMarketConditionAssessment(
    token: string, 
    analysis: VolumeAnalysis
  ): Promise<void> {
    // Store market condition for strategy consumption
    logger.debug(`Market condition update for ${token}: ${analysis.marketCondition}`, {
      recommendation: analysis.recommendation,
      whaleActivity: analysis.whaleActivity,
      liquidityDepth: analysis.liquidityDepth
    });
  }

  /**
   * Clean up old signals
   */
  private cleanupOldSignals(): void {
    const oneHour = 60 * 60 * 1000;
    const cutoff = Date.now() - oneHour;
    
    for (const [token, signal] of this.activeSignals.entries()) {
      if (signal.timestamp < cutoff) {
        this.activeSignals.delete(token);
        logger.debug(`Cleaned up old volume signal for ${token}`);
      }
    }
  }

  /**
   * Get current volume surge signals
   */
  getActiveSignals(): Map<string, VolumeSurgeSignal> {
    return new Map(this.activeSignals);
  }

  /**
   * Get volume analysis for a specific token
   */
  async getTokenAnalysis(token: string): Promise<VolumeAnalysis | null> {
    const history = this.volumeHistory.get(token);
    if (!history || history.length < 10) return null;

    return this.analyzeTokenVolume(token, history);
  }

  /**
   * Get volume metrics for all tokens
   */
  getAllVolumeMetrics(): Map<string, VolumeMetrics> {
    const metrics = new Map<string, VolumeMetrics>();
    
    for (const [token, history] of this.volumeHistory.entries()) {
      if (history.length > 0) {
        metrics.set(token, this.calculateVolumeMetrics(token, history));
      }
    }
    
    return metrics;
  }

  /**
   * Get volume analyzer statistics
   */
  getStatistics(): {
    isRunning: boolean;
    tokensTracked: number;
    activeSignals: number;
    totalDataPoints: number;
    analysisCount: number;
  } {
    const totalDataPoints = Array.from(this.volumeHistory.values())
      .reduce((sum, history) => sum + history.length, 0);

    return {
      isRunning: this.isRunning,
      tokensTracked: this.volumeHistory.size,
      activeSignals: this.activeSignals.size,
      totalDataPoints,
      analysisCount: totalDataPoints // Proxy for analysis frequency
    };
  }
}
