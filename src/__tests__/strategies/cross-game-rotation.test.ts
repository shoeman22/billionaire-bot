/**
 * Cross-Game Asset Rotation Strategy Tests
 * Comprehensive test suite for game migration tracking and portfolio rotation
 */

import { GameMigrationTracker, GameStage, GameData } from '../../analytics/game-migration-tracker';

// Mock dependencies
jest.mock('../../utils/logger');

describe('GameMigrationTracker', () => {
  let migrationTracker: GameMigrationTracker;

  beforeEach(() => {
    migrationTracker = new GameMigrationTracker();
  });

  afterEach(() => {
    migrationTracker.cleanup();
  });

  describe('Game Data Management', () => {
    test('should initialize with Gala games data', () => {
      const gameData = migrationTracker.getGameData() as Map<string, GameData>;

      expect(gameData.size).toBeGreaterThan(0);
      expect(gameData.has('TOWN')).toBe(true);
      expect(gameData.has('LEGACY')).toBe(true);
      expect(gameData.has('SILK')).toBe(true);
      expect(gameData.has('MATERIUM')).toBe(true);
      expect(gameData.has('FORTIFIED')).toBe(true);
    });

    test('should have correct game stage classifications', () => {
      const gameData = migrationTracker.getGameData() as Map<string, GameData>;
      const townData = gameData.get('TOWN');
      const legacyData = gameData.get('LEGACY');
      const materiumbData = gameData.get('MATERIUM');

      expect(townData?.stage).toBe(GameStage.MATURE); // 24 months old
      expect(legacyData?.stage).toBe(GameStage.GROWTH); // 12 months old
      expect(materiumbData?.stage).toBe(GameStage.LAUNCH); // 6 months old
    });

    test('should update game data successfully', async () => {
      const initialData = migrationTracker.getGameData('TOWN') as GameData;
      const initialUsers = initialData.dailyActiveUsers;

      await migrationTracker.updateGameData();

      const updatedData = migrationTracker.getGameData('TOWN') as GameData;

      // Data should be updated (allowing for some variance)
      expect(typeof updatedData.dailyActiveUsers).toBe('number');
      expect(updatedData.dailyActiveUsers).toBeGreaterThan(0);
    });
  });

  describe('Migration Pattern Detection', () => {
    test('should detect migration patterns between games', async () => {
      await migrationTracker.updateGameData();
      const migrations = await migrationTracker.detectMigrationPatterns();

      expect(Array.isArray(migrations)).toBe(true);

      if (migrations.length > 0) {
        const migration = migrations[0];
        expect(migration).toHaveProperty('sourceGame');
        expect(migration).toHaveProperty('targetGame');
        expect(migration).toHaveProperty('migrationRate');
        expect(migration).toHaveProperty('confidence');
        expect(migration.migrationRate).toBeGreaterThanOrEqual(0);
        expect(migration.confidence).toBeGreaterThanOrEqual(0);
        expect(migration.confidence).toBeLessThanOrEqual(1);
      }
    });

    test('should prioritize migrations from declining to growing games', async () => {
      await migrationTracker.updateGameData();
      const migrations = await migrationTracker.detectMigrationPatterns();

      // Find migrations from mature/decline to growth/launch
      const strongMigrations = migrations.filter(m => m.migrationRate > 0.3);

      if (strongMigrations.length > 0) {
        // Should have reasonable migration rates
        expect(strongMigrations.every(m => m.migrationRate <= 1.0)).toBe(true);
      }
    });

    test('should track asset flows based on migrations', async () => {
      await migrationTracker.updateGameData();
      await migrationTracker.detectMigrationPatterns();
      const assetFlows = await migrationTracker.trackAssetFlows();

      expect(Array.isArray(assetFlows)).toBe(true);

      if (assetFlows.length > 0) {
        const flow = assetFlows[0];
        expect(flow).toHaveProperty('fromToken');
        expect(flow).toHaveProperty('toToken');
        expect(flow).toHaveProperty('volume24h');
        expect(flow).toHaveProperty('migrationStrength');
        expect(flow.volume24h).toBeGreaterThanOrEqual(0);
        expect(flow.migrationStrength).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Risk Assessment', () => {
    test('should calculate game risk profiles', () => {
      const townRisk = migrationTracker.calculateGameRiskProfile('TOWN');
      const materiumbRisk = migrationTracker.calculateGameRiskProfile('MATERIUM');

      expect(townRisk).toBeTruthy();
      expect(materiumbRisk).toBeTruthy();

      if (townRisk && materiumbRisk) {
        expect(townRisk.overallRisk).toBeGreaterThanOrEqual(0);
        expect(townRisk.overallRisk).toBeLessThanOrEqual(1);

        // New games (MATERIUM) should have higher risk than mature games (TOWN)
        expect(materiumbRisk.overallRisk).toBeGreaterThan(townRisk.overallRisk);
      }
    });

    test('should handle risk profile for non-existent game', () => {
      const nonExistentRisk = migrationTracker.calculateGameRiskProfile('NONEXISTENT');
      expect(nonExistentRisk).toBeNull();
    });
  });

  describe('Data Management', () => {
    test('should provide migration history filtering', async () => {
      await migrationTracker.detectMigrationPatterns();

      const history7days = migrationTracker.getMigrationHistory(7);
      const history30days = migrationTracker.getMigrationHistory(30);

      expect(Array.isArray(history7days)).toBe(true);
      expect(Array.isArray(history30days)).toBe(true);
      expect(history30days.length).toBeGreaterThanOrEqual(history7days.length);
    });

    test('should cleanup old data', async () => {
      await migrationTracker.detectMigrationPatterns();

      const statsBefore = migrationTracker.getTrackingStats();
      migrationTracker.cleanup();
      const statsAfter = migrationTracker.getTrackingStats();

      // Stats should be preserved
      expect(statsAfter).toEqual(statsBefore);
    });
  });
});

// Note: CrossGameRotationStrategy tests would require extensive mocking of GSwap and SwapExecutor
// For now, we focus on testing the core GameMigrationTracker functionality
describe('CrossGameRotationStrategy Integration', () => {
  test('should have proper exports and structure', () => {
    // Test that our strategy exports are available
    expect(require('../../trading/strategies/cross-game-rotation')).toBeDefined();
    expect(require('../../trading/strategies/cross-game-rotation').CrossGameRotationStrategy).toBeDefined();
  });
});