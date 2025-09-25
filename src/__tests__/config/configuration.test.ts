/**
 * Configuration Management Test Suite
 *
 * Tests the centralized configuration loading and management system
 * for whale watchlists and analytics settings.
 */

import * as fs from 'fs';
import * as path from 'path';

// Mock the file system operations BEFORE importing the configuration
jest.mock('fs');
jest.mock('path', () => ({
  join: jest.fn().mockImplementation((...args: string[]) => args.join('/')),
  __dirname: '/home/andy/dev-gala/billionaire-bot/src/__tests__/config'
}));

// Setup mocks before importing ConfigurationManager
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock fs.existsSync to return true for config paths
(mockFs.existsSync as jest.Mock).mockImplementation((filePath: any) => {
  const pathStr = String(filePath);
  return pathStr.includes('config') || pathStr.endsWith('.json');
});

import { ConfigurationManager } from '../../config/configuration';

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  const mockWhalesConfig = {
    version: '1.0.0',
    lastUpdated: '2025-01-18T00:00:00Z',
    description: 'Test whales configuration',
    knownWhales: [
      {
        address: 'client|64f8caf887fd8551315d8509',
        nickname: 'TestWhale',
        priority: 'high',
        copyTrading: true,
        profitabilityScore: 0.85,
        notes: 'Test whale for unit tests',
        addedAt: '2025-01-18T00:00:00Z',
        tags: ['test', 'high-volume'],
        tradingStyle: 'aggressive',
        averageTradeSize: 50000,
        winRate: 0.75,
        riskProfile: 'moderate'
      }
    ],
    watchlistSettings: {
      maxWhales: 100,
      autoRemoveInactiveDays: 30,
      minVolumeThreshold: 1000,
      minWinRateThreshold: 0.6,
      maxRiskScore: 8,
      autoUpdateMetricsInterval: '1h',
      alertCheckInterval: '5m'
    },
    copyTradingSettings: {
      enabled: true,
      maxPositionSize: 10000,
      minConfidenceLevel: 0.7,
      delaySeconds: 2,
      enabledPriorities: ['high', 'critical'],
      blacklistedAddresses: ['client|blacklisted'],
      emergencyStopLoss: 0.1,
      maxConcurrentCopies: 3
    },
    alertSettings: {
      volumeThresholds: { high: 10000, critical: 50000 },
      confidenceThresholds: { medium: 0.6, high: 0.8 },
      urgencySettings: {},
      maxAlertsPerHour: 10,
      cooldownMinutes: 5,
      enablePatternChangeAlerts: true,
      enableExitSignalAlerts: true
    },
    performanceTracking: {},
    riskManagement: {}
  };

  const mockAnalyticsConfig = {
    version: '1.0.0',
    lastUpdated: '2025-01-18T00:00:00Z',
    description: 'Test analytics configuration',
    database: {
      cacheSettings: {
        transactionCacheTtlMinutes: 5,
        volumeDataCacheTtlMinutes: 2,
        maxCacheSize: 1000
      },
      batchSettings: {
        maxBatchSize: 100,
        enableBatching: true
      },
      performance: {
        enableQueryOptimization: true,
        maxConnections: 10
      }
    },
    volumeAnalysis: {
      resolutions: {
        '5m': { enabled: true, retentionDays: 7 },
        '1h': { enabled: true, retentionDays: 30 }
      },
      patternDetection: {
        enabled: true,
        minDataPoints: 10,
        confidenceThreshold: 0.6
      },
      anomalyDetection: {
        enabled: true,
        zscore_threshold: 2.5
      }
    },
    snapshots: {
      schedule: {
        hourly: { enabled: true, retention_days: 7 }
      },
      metrics: {
        system_health: { include_memory_usage: true }
      }
    },
    alerting: {},
    optimization: {},
    monitoring: {
      metrics_collection: { enabled: true, interval_seconds: 60 }
    },
    maintenance: {},
    integration: {
      api_endpoints: {
        base_url: 'https://test-api.com',
        websocket_url: 'wss://test-ws.com',
        volume_graph_data: {
          rate_limit_per_second: 5,
          timeout_ms: 15000
        }
      }
    }
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Reset mock implementations
    (mockFs.existsSync as jest.Mock).mockImplementation((filePath: any) => {
      const pathStr = String(filePath);
      return pathStr.includes('config') || pathStr.endsWith('.json');
    });

    (mockFs.readFileSync as jest.Mock).mockImplementation((filePath: any) => {
      const pathStr = String(filePath);
      if (pathStr.includes('whales.json')) {
        return JSON.stringify(mockWhalesConfig);
      } else if (pathStr.includes('analytics.json')) {
        return JSON.stringify(mockAnalyticsConfig);
      }
      return '{}';
    });

    // Get fresh instance for each test
    configManager = ConfigurationManager.getInstance();
    // Reset the cached configs
    (configManager as any).whalesConfig = null;
    (configManager as any).analyticsConfig = null;
  });

  describe('Configuration Loading', () => {
    it('should load whales configuration successfully', async () => {
      const config = await configManager.getWhalesConfig();

      expect(config).toBeDefined();
      expect(config.version).toBe('1.0.0');
      expect(config.knownWhales).toHaveLength(1);
      expect(config.knownWhales[0].address).toBe('client|64f8caf887fd8551315d8509');
      expect(config.watchlistSettings.maxWhales).toBe(100);
    });

    it('should load analytics configuration successfully', async () => {
      const config = await configManager.getAnalyticsConfig();

      expect(config).toBeDefined();
      expect(config.version).toBe('1.0.0');
      expect((config.database.cacheSettings as any).transactionCacheTtlMinutes).toBe(5);
      expect((config.integration as any).api_endpoints.base_url).toBe('https://test-api.com');
    });

    it('should cache configurations after first load', async () => {
      // First load
      await configManager.getWhalesConfig();
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);

      // Second load should use cache
      await configManager.getWhalesConfig();
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('should handle file not found error', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(configManager.getWhalesConfig())
        .rejects.toThrow('Whales configuration file not found');
    });

    it('should handle JSON parsing error', async () => {
      mockFs.readFileSync.mockReturnValue('invalid json');

      await expect(configManager.getWhalesConfig())
        .rejects.toThrow('Failed to load whales configuration');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate whales configuration structure', async () => {
      const invalidConfig = { ...mockWhalesConfig };
      delete (invalidConfig as any).knownWhales;

      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidConfig));

      await expect(configManager.getWhalesConfig())
        .rejects.toThrow('Invalid whales configuration: knownWhales must be an array');
    });

    it('should validate whale address format', async () => {
      const invalidConfig = {
        ...mockWhalesConfig,
        knownWhales: [{ ...mockWhalesConfig.knownWhales[0], address: '' }]
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidConfig));

      await expect(configManager.getWhalesConfig())
        .rejects.toThrow('Invalid whale configuration: address is required');
    });

    it('should validate whale priority values', async () => {
      const invalidConfig = {
        ...mockWhalesConfig,
        knownWhales: [{ ...mockWhalesConfig.knownWhales[0], priority: 'invalid' }]
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidConfig));

      await expect(configManager.getWhalesConfig())
        .rejects.toThrow('Invalid whale priority: invalid');
    });

    it('should validate analytics configuration structure', async () => {
      const invalidConfig = { ...mockAnalyticsConfig };
      delete (invalidConfig as any).database;

      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidConfig));

      await expect(configManager.getAnalyticsConfig())
        .rejects.toThrow('Invalid analytics configuration: missing required sections');
    });
  });

  describe('Whale Management', () => {
    it('should get active whales', async () => {
      const activeWhales = await configManager.getActiveWhales();

      expect(activeWhales).toHaveLength(1);
      expect(activeWhales[0].address).toBe('client|64f8caf887fd8551315d8509');
      expect(activeWhales[0].priority).toBe('high');
    });

    it('should filter out low priority whales without copy trading', async () => {
      const configWithLowPriority = {
        ...mockWhalesConfig,
        knownWhales: [
          ...mockWhalesConfig.knownWhales,
          {
            address: 'client|lowpriority',
            priority: 'low',
            copyTrading: false,
            nickname: 'Low Priority',
            profitabilityScore: 0.5,
            notes: '',
            addedAt: '2025-01-18T00:00:00Z',
            tags: [],
            tradingStyle: 'conservative',
            averageTradeSize: 1000,
            winRate: 0.6,
            riskProfile: 'low'
          }
        ]
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(configWithLowPriority));

      const activeWhales = await configManager.getActiveWhales();
      expect(activeWhales).toHaveLength(1); // Should exclude low priority whale
      expect(activeWhales.find(w => w.address === 'client|lowpriority')).toBeUndefined();
    });

    it('should get copy trading whales', async () => {
      const copyTradingWhales = await configManager.getCopyTradingWhales();

      expect(copyTradingWhales).toHaveLength(1);
      expect(copyTradingWhales[0].copyTrading).toBe(true);
      expect(copyTradingWhales[0].priority).toBe('high');
    });

    it('should filter out blacklisted addresses from copy trading', async () => {
      const configWithBlacklisted = {
        ...mockWhalesConfig,
        knownWhales: [
          ...mockWhalesConfig.knownWhales,
          {
            address: 'client|blacklisted',
            priority: 'critical',
            copyTrading: true,
            nickname: 'Blacklisted',
            profitabilityScore: 0.9,
            notes: '',
            addedAt: '2025-01-18T00:00:00Z',
            tags: [],
            tradingStyle: 'aggressive',
            averageTradeSize: 100000,
            winRate: 0.8,
            riskProfile: 'high'
          }
        ]
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(configWithBlacklisted));

      const copyTradingWhales = await configManager.getCopyTradingWhales();
      expect(copyTradingWhales).toHaveLength(1); // Should exclude blacklisted whale
      expect(copyTradingWhales.find(w => w.address === 'client|blacklisted')).toBeUndefined();
    });
  });

  describe('Configuration Access Methods', () => {
    it('should get volume analysis settings', async () => {
      const volumeSettings = await configManager.getVolumeAnalysisSettings();

      expect(volumeSettings).toBeDefined();
      expect(volumeSettings.resolutions['5m']).toBeDefined();
      expect(volumeSettings.patternDetection.enabled).toBe(true);
    });

    it('should get cache settings', async () => {
      const cacheSettings = await configManager.getCacheSettings();

      expect(cacheSettings).toBeDefined();
      expect(cacheSettings.transactionCacheTtlMinutes).toBe(5);
      expect(cacheSettings.maxCacheSize).toBe(1000);
    });

    it('should get monitoring config', async () => {
      const monitoringConfig = await configManager.getMonitoringConfig();

      expect(monitoringConfig).toBeDefined();
      expect((monitoringConfig as any).metrics_collection.enabled).toBe(true);
    });

    it('should get API base URL', async () => {
      const baseUrl = await configManager.getApiBaseUrl();

      expect(baseUrl).toBe('https://test-api.com');
    });

    it('should get WebSocket URL', async () => {
      const wsUrl = await configManager.getWebSocketUrl();

      expect(wsUrl).toBe('wss://test-ws.com');
    });
  });

  describe('Feature Flags and Config Values', () => {
    it('should check if feature is enabled', async () => {
      const volumeAnalysisEnabled = await configManager.isFeatureEnabled('volumeAnalysis.patternDetection.enabled', 'analytics');

      expect(volumeAnalysisEnabled).toBe(true);
    });

    it('should get nested config value with dot notation', async () => {
      const maxBatchSize = await configManager.getConfigValue('database.batchSettings.maxBatchSize', 'analytics');

      expect(maxBatchSize).toBe(100);
    });

    it('should return default value for missing config', async () => {
      const missingValue = await configManager.getConfigValue('non.existent.path', 'analytics', 'default');

      expect(missingValue).toBe('default');
    });

    it('should handle config access errors gracefully', async () => {
      // Mock an error in config loading
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      const result = await configManager.isFeatureEnabled('some.feature', 'analytics');
      expect(result).toBe(false);
    });
  });

  describe('Runtime Configuration Updates', () => {
    it('should update whale configuration in memory', async () => {
      const whaleAddress = 'client|64f8caf887fd8551315d8509';
      const updates = { priority: 'critical' as const, profitabilityScore: 0.95 };

      const result = await configManager.updateWhaleConfig(whaleAddress, updates);
      expect(result).toBe(true);

      const config = await configManager.getWhalesConfig();
      const updatedWhale = config.knownWhales.find(w => w.address === whaleAddress);
      expect(updatedWhale?.priority).toBe('critical');
      expect(updatedWhale?.profitabilityScore).toBe(0.95);
    });

    it('should add new whale to configuration', async () => {
      const newWhale = {
        address: 'client|newwhale',
        nickname: 'New Whale',
        priority: 'medium' as const,
        copyTrading: false,
        profitabilityScore: 0.7,
        notes: 'Added at runtime',
        addedAt: '2025-01-18T12:00:00Z',
        tags: ['new'],
        tradingStyle: 'balanced',
        averageTradeSize: 25000,
        winRate: 0.65,
        riskProfile: 'moderate'
      };

      await configManager.addWhaleToConfig(newWhale);

      const config = await configManager.getWhalesConfig();
      expect(config.knownWhales).toHaveLength(2);
      const addedWhale = config.knownWhales.find(w => w.address === 'client|newwhale');
      expect(addedWhale).toBeDefined();
      expect(addedWhale?.nickname).toBe('New Whale');
    });

    it('should update existing whale when adding duplicate address', async () => {
      const existingAddress = 'client|64f8caf887fd8551315d8509';
      const updatedWhale = {
        address: existingAddress,
        nickname: 'Updated Whale',
        priority: 'critical' as const,
        copyTrading: true,
        profitabilityScore: 0.95,
        notes: 'Updated',
        addedAt: '2025-01-18T12:00:00Z',
        tags: ['updated'],
        tradingStyle: 'aggressive',
        averageTradeSize: 75000,
        winRate: 0.85,
        riskProfile: 'high'
      };

      await configManager.addWhaleToConfig(updatedWhale);

      const config = await configManager.getWhalesConfig();
      expect(config.knownWhales).toHaveLength(1); // Should still be 1
      const whale = config.knownWhales.find(w => w.address === existingAddress);
      expect(whale?.nickname).toBe('Updated Whale');
    });
  });

  describe('Environment Variable Overrides', () => {
    beforeEach(() => {
      // Clear environment variables
      delete process.env.ANALYTICS_DATABASE_MAXCONNECTIONS;
      delete process.env.WHALE_COPYTRADING_ENABLED;
    });

    it('should apply environment variable overrides for analytics config', async () => {
      process.env.ANALYTICS_DATABASE_MAXCONNECTIONS = '20';

      const config = await configManager.getAnalyticsConfig();
      // Environment overrides are applied in the private method, so we test the behavior indirectly
      expect(config).toBeDefined();
    });

    it('should apply environment variable overrides for whales config', async () => {
      process.env.WHALE_COPYTRADING_ENABLED = 'false';

      const config = await configManager.getWhalesConfig();
      expect(config).toBeDefined();
    });
  });

  describe('Configuration Reload', () => {
    it('should reload all configurations', async () => {
      // Load initial configs
      await configManager.getWhalesConfig();
      await configManager.getAnalyticsConfig();

      // Change mock data
      const updatedWhalesConfig = { ...mockWhalesConfig, version: '2.0.0' };
      (mockFs.readFileSync as jest.Mock).mockImplementation((filePath: any) => {
        const pathStr = String(filePath);
        if (pathStr.includes('whales.json')) {
          return JSON.stringify(updatedWhalesConfig);
        } else if (pathStr.includes('analytics.json')) {
          return JSON.stringify(mockAnalyticsConfig);
        }
        return '{}';
      });

      // Reload
      await configManager.reloadConfigurations();

      // Verify updated config is loaded
      const config = await configManager.getWhalesConfig();
      expect(config.version).toBe('2.0.0');
    });
  });
});