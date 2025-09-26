/**
 * Game Migration Tracker
 * Tracks player migration between Gala games and analyzes lifecycle patterns
 */

import { logger } from '../utils/logger';
// Unused imports removed to fix linting

export enum GameStage {
  LAUNCH = 'launch',           // 0-6 months: High volatility, speculative
  GROWTH = 'growth',           // 6-18 months: Strong fundamentals, user growth
  MATURE = 'mature',           // 18+ months: Stable, predictable patterns
  DECLINE = 'decline',         // Variable: Decreasing users, value rotation
  REVIVAL = 'revival'          // Variable: Major updates, renewed interest
}

export interface GameData {
  symbol: string;
  name: string;
  launchDate: number;
  stage: GameStage;
  dailyActiveUsers: number;
  transactionVolume24h: number;
  assetCreationRate: number;
  retentionRate7d: number;
  retentionRate30d: number;
  revenuePerUser: number;
  socialSentiment: number;      // -1 to 1
  developerActivity: number;    // Updates per month
  competitionRisk: number;      // 0-1 risk score
}

export interface GameMigration {
  sourceGame: string;
  targetGame: string;
  playerCount: number;
  assetValue: number;
  migrationRate: number;
  timeframe: number;
  catalyst: string;
  confidence: number;           // 0-1 prediction confidence
  timestamp: number;
}

export interface AssetFlow {
  fromToken: string;
  toToken: string;
  volume24h: number;
  priceImpact: number;
  migrationStrength: number;
  predictedContinuation: number;
  timestamp: number;
}

export interface GameRiskProfile {
  developmentRisk: number;
  competitionRisk: number;
  regulatoryRisk: number;
  technicalRisk: number;
  communityRisk: number;
  overallRisk: number;
}

export interface SeasonalPattern {
  season: 'spring' | 'summer' | 'fall' | 'winter';
  monthlyMultipliers: number[];
  peakActivity: number;
  lowActivity: number;
  eventCorrelation: Record<string, number>;
}

export class GameMigrationTracker {
  private gameData: Map<string, GameData> = new Map();
  private migrationHistory: GameMigration[] = [];
  private assetFlows: AssetFlow[] = [];
  private seasonalPatterns: Map<string, SeasonalPattern> = new Map();
  private crossGameCorrelations: Map<string, Map<string, number>> = new Map();
  private lastUpdateTime: number = 0;

  // Gaming ecosystem constants
  private readonly GALA_GAMES = {
    'TOWN': { name: 'Town Crush', token: 'TOWN|Unit|none|none' },
    'LEGACY': { name: 'Legacy', token: 'LEGACY|Unit|none|none' },
    'SILK': { name: 'Spider Tanks', token: 'SILK|Unit|none|none' },
    'MATERIUM': { name: 'Mirandus', token: 'MATERIUM|Unit|none|none' },
    'FORTIFIED': { name: 'Fortified', token: 'FORTIFIED|Unit|none|none' },
    'GALA': { name: 'Ecosystem Base', token: 'GALA|Unit|none|none' }
  };

  private migrationTracking = {
    totalMigrations: 0,
    accuratePredictions: 0,
    avgMigrationTime: 0,
    strongestFlows: [] as AssetFlow[]
  };

  constructor() {
    this.initializeGameData();
    this.initializeSeasonalPatterns();
    logger.info('GameMigrationTracker initialized for Gala ecosystem');
  }

  /**
   * Initialize game data with current ecosystem state
   */
  private initializeGameData(): void {
    const currentTime = Date.now();

    // Initialize with representative data for Gala games
    const games: Partial<GameData>[] = [
      {
        symbol: 'TOWN',
        name: 'Town Crush',
        launchDate: currentTime - (24 * 30 * 24 * 60 * 60 * 1000), // 24 months ago
        stage: GameStage.MATURE,
        dailyActiveUsers: 15000,
        transactionVolume24h: 50000,
        retentionRate7d: 0.65,
        retentionRate30d: 0.45,
        socialSentiment: 0.2,
        developerActivity: 2
      },
      {
        symbol: 'LEGACY',
        name: 'Legacy',
        launchDate: currentTime - (12 * 30 * 24 * 60 * 60 * 1000), // 12 months ago
        stage: GameStage.GROWTH,
        dailyActiveUsers: 8500,
        transactionVolume24h: 35000,
        retentionRate7d: 0.72,
        retentionRate30d: 0.58,
        socialSentiment: 0.6,
        developerActivity: 4
      },
      {
        symbol: 'SILK',
        name: 'Spider Tanks',
        launchDate: currentTime - (20 * 30 * 24 * 60 * 60 * 1000), // 20 months ago
        stage: GameStage.MATURE,
        dailyActiveUsers: 12000,
        transactionVolume24h: 42000,
        retentionRate7d: 0.68,
        retentionRate30d: 0.52,
        socialSentiment: 0.3,
        developerActivity: 3
      },
      {
        symbol: 'MATERIUM',
        name: 'Mirandus',
        launchDate: currentTime - (6 * 30 * 24 * 60 * 60 * 1000), // 6 months ago
        stage: GameStage.LAUNCH,
        dailyActiveUsers: 3200,
        transactionVolume24h: 18000,
        retentionRate7d: 0.55,
        retentionRate30d: 0.35,
        socialSentiment: 0.4,
        developerActivity: 6
      },
      {
        symbol: 'FORTIFIED',
        name: 'Fortified',
        launchDate: currentTime - (2 * 30 * 24 * 60 * 60 * 1000), // 2 months ago
        stage: GameStage.LAUNCH,
        dailyActiveUsers: 1800,
        transactionVolume24h: 12000,
        retentionRate7d: 0.48,
        retentionRate30d: 0.28,
        socialSentiment: 0.7,
        developerActivity: 8
      }
    ];

    games.forEach(gameInfo => {
      if (gameInfo.symbol) {
        const gameData: GameData = {
          symbol: gameInfo.symbol,
          name: gameInfo.name!,
          launchDate: gameInfo.launchDate!,
          stage: gameInfo.stage!,
          dailyActiveUsers: gameInfo.dailyActiveUsers!,
          transactionVolume24h: gameInfo.transactionVolume24h!,
          assetCreationRate: Math.random() * 1000 + 500,
          retentionRate7d: gameInfo.retentionRate7d!,
          retentionRate30d: gameInfo.retentionRate30d!,
          revenuePerUser: Math.random() * 50 + 25,
          socialSentiment: gameInfo.socialSentiment!,
          developerActivity: gameInfo.developerActivity!,
          competitionRisk: Math.random() * 0.5 + 0.2
        };

        this.gameData.set(gameInfo.symbol, gameData);
      }
    });

    logger.info(`Initialized ${this.gameData.size} games in migration tracker`);
  }

  /**
   * Initialize seasonal gaming patterns
   */
  private initializeSeasonalPatterns(): void {
    const patterns: Array<{season: SeasonalPattern['season'], data: Omit<SeasonalPattern, 'season'>}> = [
      {
        season: 'spring',
        data: {
          monthlyMultipliers: [1.1, 1.15, 1.2], // March, April, May
          peakActivity: 1.2,
          lowActivity: 1.0,
          eventCorrelation: { 'spring_events': 0.3, 'easter': 0.2 }
        }
      },
      {
        season: 'summer',
        data: {
          monthlyMultipliers: [1.3, 1.4, 1.25], // June, July, August
          peakActivity: 1.4,
          lowActivity: 1.15,
          eventCorrelation: { 'summer_vacation': 0.6, 'tournaments': 0.4 }
        }
      },
      {
        season: 'fall',
        data: {
          monthlyMultipliers: [1.1, 1.05, 1.15], // September, October, November
          peakActivity: 1.15,
          lowActivity: 1.0,
          eventCorrelation: { 'back_to_school': -0.2, 'halloween': 0.3 }
        }
      },
      {
        season: 'winter',
        data: {
          monthlyMultipliers: [1.5, 1.2, 1.1], // December, January, February
          peakActivity: 1.5,
          lowActivity: 1.0,
          eventCorrelation: { 'holidays': 0.8, 'new_year': 0.3 }
        }
      }
    ];

    patterns.forEach(({ season, data }) => {
      this.seasonalPatterns.set(season, { season, ...data });
    });

    logger.info('Initialized seasonal gaming patterns');
  }

  /**
   * Update game data from various sources
   */
  async updateGameData(): Promise<void> {
    try {
      const currentTime = Date.now();

      // In production, this would fetch from:
      // - GalaSwap transaction APIs
      // - Game launcher analytics
      // - Social media sentiment APIs
      // - Discord/community engagement metrics

      // For now, simulate realistic data updates
      for (const [symbol, gameData] of this.gameData.entries()) {
        const ageInMonths = (currentTime - gameData.launchDate) / (30 * 24 * 60 * 60 * 1000);

        // Update stage based on age and performance
        const newStage = this.determineGameStage(gameData, ageInMonths);
        if (newStage !== gameData.stage) {
          logger.info(`${symbol} stage changed: ${gameData.stage} -> ${newStage}`);
          gameData.stage = newStage;
        }

        // Simulate realistic data fluctuations
        const seasonalMultiplier = this.getSeasonalMultiplier(currentTime);
        gameData.dailyActiveUsers = Math.floor(gameData.dailyActiveUsers * (0.95 + Math.random() * 0.1) * seasonalMultiplier);
        gameData.transactionVolume24h = Math.floor(gameData.transactionVolume24h * (0.9 + Math.random() * 0.2));
        gameData.socialSentiment = Math.max(-1, Math.min(1, gameData.socialSentiment + (Math.random() - 0.5) * 0.1));
      }

      this.lastUpdateTime = currentTime;
      logger.info('Game data updated successfully');

    } catch (error) {
      logger.error('Failed to update game data:', error);
    }
  }

  /**
   * Determine game stage based on age and metrics
   */
  private determineGameStage(gameData: GameData, ageInMonths: number): GameStage {
    // Stage transition logic
    if (ageInMonths < 6) {
      return GameStage.LAUNCH;
    } else if (ageInMonths < 18 && gameData.retentionRate7d > 0.6 && gameData.socialSentiment > 0.2) {
      return GameStage.GROWTH;
    } else if (ageInMonths >= 18 && gameData.retentionRate7d > 0.5) {
      return GameStage.MATURE;
    } else if (gameData.retentionRate7d < 0.4 && gameData.socialSentiment < 0) {
      return GameStage.DECLINE;
    } else if (gameData.developerActivity > 5 && gameData.socialSentiment > 0.5) {
      return GameStage.REVIVAL;
    }

    return gameData.stage; // No change
  }

  /**
   * Get seasonal activity multiplier
   */
  private getSeasonalMultiplier(timestamp: number): number {
    const date = new Date(timestamp);
    const month = date.getMonth(); // 0-11

    let season: SeasonalPattern['season'];
    if (month >= 2 && month <= 4) season = 'spring';
    else if (month >= 5 && month <= 7) season = 'summer';
    else if (month >= 8 && month <= 10) season = 'fall';
    else season = 'winter';

    const pattern = this.seasonalPatterns.get(season);
    if (!pattern) return 1.0;

    const seasonIndex = month % 3;
    return pattern.monthlyMultipliers[seasonIndex] || 1.0;
  }

  /**
   * Detect player migration patterns
   */
  async detectMigrationPatterns(): Promise<GameMigration[]> {
    try {
      const migrations: GameMigration[] = [];
      const currentTime = Date.now();

      // Analyze all game pairs for migration signals
      const games = Array.from(this.gameData.values());

      for (let i = 0; i < games.length; i++) {
        for (let j = 0; j < games.length; j++) {
          if (i === j) continue;

          const sourceGame = games[i];
          const targetGame = games[j];

          const migrationStrength = this.calculateMigrationStrength(sourceGame, targetGame);

          if (migrationStrength > 0.3) { // Threshold for significant migration
            const migration: GameMigration = {
              sourceGame: sourceGame.symbol,
              targetGame: targetGame.symbol,
              playerCount: Math.floor(sourceGame.dailyActiveUsers * migrationStrength * 0.1),
              assetValue: sourceGame.transactionVolume24h * migrationStrength * 0.05,
              migrationRate: migrationStrength,
              timeframe: this.estimateMigrationTimeframe(sourceGame, targetGame),
              catalyst: this.identifyMigrationCatalyst(sourceGame, targetGame),
              confidence: this.calculatePredictionConfidence(sourceGame, targetGame, migrationStrength),
              timestamp: currentTime
            };

            migrations.push(migration);
          }
        }
      }

      // Store detected migrations
      this.migrationHistory.push(...migrations);

      // Keep only recent migrations (last 30 days)
      const thirtyDaysAgo = currentTime - (30 * 24 * 60 * 60 * 1000);
      this.migrationHistory = this.migrationHistory.filter(m => m.timestamp > thirtyDaysAgo);

      logger.info(`Detected ${migrations.length} migration patterns`);
      return migrations;

    } catch (error) {
      logger.error('Failed to detect migration patterns:', error);
      return [];
    }
  }

  /**
   * Calculate migration strength between two games
   */
  private calculateMigrationStrength(sourceGame: GameData, targetGame: GameData): number {
    let strength = 0;

    // Stage-based migration factors
    if (sourceGame.stage === GameStage.DECLINE && targetGame.stage === GameStage.LAUNCH) {
      strength += 0.4; // Strong migration from declining to new games
    } else if (sourceGame.stage === GameStage.MATURE && targetGame.stage === GameStage.GROWTH) {
      strength += 0.3; // Moderate migration from mature to growing games
    } else if (sourceGame.stage === GameStage.LAUNCH && targetGame.stage === GameStage.GROWTH) {
      strength += 0.2; // Some migration between new games
    }

    // Sentiment-based migration
    const sentimentDiff = targetGame.socialSentiment - sourceGame.socialSentiment;
    if (sentimentDiff > 0.3) {
      strength += 0.2; // Migration towards more positive sentiment
    }

    // Developer activity factor
    if (targetGame.developerActivity > sourceGame.developerActivity * 1.5) {
      strength += 0.15; // Migration towards more active development
    }

    // Retention rate factor
    if (targetGame.retentionRate7d > sourceGame.retentionRate7d * 1.1) {
      strength += 0.1; // Migration towards better retention
    }

    return Math.min(1.0, strength);
  }

  /**
   * Estimate migration completion timeframe in days
   */
  private estimateMigrationTimeframe(sourceGame: GameData, targetGame: GameData): number {
    const baseTimeframe = 14; // 2 weeks base

    // Adjust based on game stages
    let multiplier = 1.0;
    if (sourceGame.stage === GameStage.DECLINE) multiplier *= 0.7; // Faster exodus
    if (targetGame.stage === GameStage.LAUNCH) multiplier *= 1.3; // Slower adoption
    if (targetGame.stage === GameStage.REVIVAL) multiplier *= 0.8; // Faster re-adoption

    return Math.floor(baseTimeframe * multiplier);
  }

  /**
   * Identify the main catalyst driving migration
   */
  private identifyMigrationCatalyst(sourceGame: GameData, targetGame: GameData): string {
    const catalysts = [];

    if (targetGame.developerActivity > 5) catalysts.push('Major updates');
    if (targetGame.socialSentiment > 0.5) catalysts.push('Positive community sentiment');
    if (sourceGame.stage === GameStage.DECLINE) catalysts.push('Source game declining');
    if (targetGame.stage === GameStage.LAUNCH) catalysts.push('New game launch hype');
    if (targetGame.retentionRate7d > 0.7) catalysts.push('Strong gameplay retention');

    return catalysts.length > 0 ? catalysts.join(', ') : 'Market dynamics';
  }

  /**
   * Calculate prediction confidence based on historical accuracy
   */
  private calculatePredictionConfidence(sourceGame: GameData, targetGame: GameData, strength: number): number {
    let confidence = 0.5; // Base confidence

    // Adjust based on data quality
    if (sourceGame.dailyActiveUsers > 5000) confidence += 0.1;
    if (targetGame.dailyActiveUsers > 1000) confidence += 0.1;

    // Adjust based on pattern strength
    confidence += strength * 0.3;

    // Adjust based on historical accuracy (would use real data)
    const historicalAccuracy = this.migrationTracking.totalMigrations > 0 ?
      this.migrationTracking.accuratePredictions / this.migrationTracking.totalMigrations : 0.5;
    confidence = (confidence + historicalAccuracy) / 2;

    return Math.min(0.95, Math.max(0.1, confidence));
  }

  /**
   * Track asset flows between game tokens
   */
  async trackAssetFlows(): Promise<AssetFlow[]> {
    try {
      const flows: AssetFlow[] = [];
      const currentTime = Date.now();

      // Simulate asset flow tracking based on migration patterns
      const recentMigrations = this.migrationHistory.filter(m =>
        currentTime - m.timestamp < 7 * 24 * 60 * 60 * 1000 // Last 7 days
      );

      for (const migration of recentMigrations) {
        const sourceToken = this.GALA_GAMES[migration.sourceGame as keyof typeof this.GALA_GAMES]?.token;
        const targetToken = this.GALA_GAMES[migration.targetGame as keyof typeof this.GALA_GAMES]?.token;

        if (sourceToken && targetToken) {
          const flow: AssetFlow = {
            fromToken: sourceToken,
            toToken: targetToken,
            volume24h: migration.assetValue,
            priceImpact: Math.min(0.1, migration.migrationRate * 0.05), // Max 10% impact
            migrationStrength: migration.migrationRate,
            predictedContinuation: migration.timeframe,
            timestamp: currentTime
          };

          flows.push(flow);
        }
      }

      this.assetFlows = flows;
      logger.info(`Tracked ${flows.length} asset flows`);
      return flows;

    } catch (error) {
      logger.error('Failed to track asset flows:', error);
      return [];
    }
  }

  /**
   * Calculate risk profile for each game
   */
  calculateGameRiskProfile(gameSymbol: string): GameRiskProfile | null {
    const gameData = this.gameData.get(gameSymbol);
    if (!gameData) return null;

    const ageInMonths = (Date.now() - gameData.launchDate) / (30 * 24 * 60 * 60 * 1000);

    // Development risk (team execution)
    let developmentRisk = 0.3;
    if (gameData.developerActivity < 2) developmentRisk += 0.3;
    if (gameData.stage === GameStage.LAUNCH) developmentRisk += 0.2;

    // Competition risk
    const competitionRisk = gameData.competitionRisk;

    // Regulatory risk (gaming laws)
    let regulatoryRisk = 0.1;
    if (gameData.transactionVolume24h > 100000) regulatoryRisk += 0.1; // Higher volume = more scrutiny

    // Technical risk (blockchain/smart contracts)
    let technicalRisk = 0.15;
    if (ageInMonths < 6) technicalRisk += 0.15; // New games have more technical risks

    // Community risk (player base stability)
    let communityRisk = 0.2;
    if (gameData.retentionRate30d < 0.4) communityRisk += 0.3;
    if (gameData.socialSentiment < 0) communityRisk += 0.2;

    const overallRisk = (developmentRisk + competitionRisk + regulatoryRisk + technicalRisk + communityRisk) / 5;

    return {
      developmentRisk: Math.min(1.0, developmentRisk),
      competitionRisk: Math.min(1.0, competitionRisk),
      regulatoryRisk: Math.min(1.0, regulatoryRisk),
      technicalRisk: Math.min(1.0, technicalRisk),
      communityRisk: Math.min(1.0, communityRisk),
      overallRisk: Math.min(1.0, overallRisk)
    };
  }

  /**
   * Get current game data
   */
  getGameData(symbol?: string): GameData | Map<string, GameData> {
    if (symbol) {
      return this.gameData.get(symbol) || {} as GameData;
    }
    return this.gameData;
  }

  /**
   * Get migration history
   */
  getMigrationHistory(days: number = 30): GameMigration[] {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return this.migrationHistory.filter(m => m.timestamp > cutoff);
  }

  /**
   * Get current asset flows
   */
  getCurrentAssetFlows(): AssetFlow[] {
    return this.assetFlows;
  }

  /**
   * Get performance statistics
   */
  getTrackingStats(): typeof this.migrationTracking {
    return { ...this.migrationTracking };
  }

  /**
   * Cleanup old data
   */
  cleanup(): void {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    this.migrationHistory = this.migrationHistory.filter(m => m.timestamp > thirtyDaysAgo);
    this.assetFlows = this.assetFlows.filter(f => f.timestamp > thirtyDaysAgo);
    logger.info('Game migration tracker data cleaned up');
  }
}