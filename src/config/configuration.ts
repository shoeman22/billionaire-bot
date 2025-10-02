/**
 * Configuration Management
 *
 * Centralized configuration loading and validation for the trading bot.
 * Loads JSON configuration files with type safety and environment overrides.
 */

import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Type definitions for configuration structures
export interface WhaleConfig {
  address: string;
  nickname: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  copyTrading: boolean;
  profitabilityScore: number;
  notes: string;
  addedAt: string;
  tags: string[];
  tradingStyle: string;
  averageTradeSize: number;
  winRate: number;
  riskProfile: string;
}

export interface WhalesConfiguration {
  version: string;
  lastUpdated: string;
  description: string;
  knownWhales: WhaleConfig[];
  watchlistSettings: {
    maxWhales: number;
    autoRemoveInactiveDays: number;
    minVolumeThreshold: number;
    minWinRateThreshold: number;
    maxRiskScore: number;
    autoUpdateMetricsInterval: string;
    alertCheckInterval: string;
  };
  copyTradingSettings: {
    enabled: boolean;
    maxPositionSize: number;
    minConfidenceLevel: number;
    delaySeconds: number;
    enabledPriorities: string[];
    blacklistedAddresses: string[];
    emergencyStopLoss: number;
    maxConcurrentCopies: number;
  };
  alertSettings: {
    volumeThresholds: Record<string, number>;
    confidenceThresholds: Record<string, number>;
    urgencySettings: Record<string, number | string | boolean>;
    maxAlertsPerHour: number;
    cooldownMinutes: number;
    enablePatternChangeAlerts: boolean;
    enableExitSignalAlerts: boolean;
  };
  performanceTracking: Record<string, unknown>;
  riskManagement: Record<string, unknown>;
}

export interface AnalyticsConfiguration {
  version: string;
  lastUpdated: string;
  description: string;
  database: {
    cacheSettings: Record<string, unknown>;
    batchSettings: Record<string, unknown>;
    performance: Record<string, unknown>;
  };
  volumeAnalysis: {
    resolutions: Record<string, unknown>;
    patternDetection: Record<string, unknown>;
    anomalyDetection: Record<string, unknown>;
  };
  snapshots: {
    schedule: Record<string, unknown>;
    metrics: Record<string, unknown>;
  };
  alerting: Record<string, unknown>;
  optimization: Record<string, unknown>;
  monitoring: Record<string, unknown>;
  maintenance: Record<string, unknown>;
  integration: Record<string, unknown>;
}

/**
 * Configuration loading errors
 */
export class ConfigurationError extends Error {
  constructor(message: string, public configFile?: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Configuration Manager
 *
 * Loads and manages configuration files with validation and environment overrides.
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private whalesConfig: WhalesConfiguration | null = null;
  private analyticsConfig: AnalyticsConfiguration | null = null;
  private configPath: string;

  private constructor() {
    this.configPath = this.resolveConfigPath();
    logger.info('📋 Configuration Manager initialized', {
      configPath: this.configPath
    });
  }

  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Load whales configuration
   */
  public async getWhalesConfig(): Promise<WhalesConfiguration> {
    if (!this.whalesConfig) {
      await this.loadWhalesConfig();
    }
    return this.whalesConfig!;
  }

  /**
   * Load analytics configuration
   */
  public async getAnalyticsConfig(): Promise<AnalyticsConfiguration> {
    if (!this.analyticsConfig) {
      await this.loadAnalyticsConfig();
    }
    return this.analyticsConfig!;
  }

  /**
   * Reload all configurations
   */
  public async reloadConfigurations(): Promise<void> {
    this.whalesConfig = null;
    this.analyticsConfig = null;

    await Promise.all([
      this.loadWhalesConfig(),
      this.loadAnalyticsConfig()
    ]);

    logger.info('✅ All configurations reloaded');
  }

  /**
   * Get active whales from configuration
   */
  public async getActiveWhales(): Promise<WhaleConfig[]> {
    const config = await this.getWhalesConfig();
    return config.knownWhales.filter(whale =>
      whale.priority !== 'low' || whale.copyTrading
    );
  }

  /**
   * Get copy trading whales
   */
  public async getCopyTradingWhales(): Promise<WhaleConfig[]> {
    const config = await this.getWhalesConfig();

    if (!config.copyTradingSettings.enabled) {
      return [];
    }

    return config.knownWhales.filter(whale =>
      whale.copyTrading &&
      config.copyTradingSettings.enabledPriorities.includes(whale.priority) &&
      !config.copyTradingSettings.blacklistedAddresses.includes(whale.address)
    );
  }

  /**
   * Get volume analysis settings
   */
  public async getVolumeAnalysisSettings(): Promise<AnalyticsConfiguration['volumeAnalysis']> {
    const config = await this.getAnalyticsConfig();
    return config.volumeAnalysis;
  }

  /**
   * Get database cache settings
   */
  public async getCacheSettings(): Promise<AnalyticsConfiguration['database']['cacheSettings']> {
    const config = await this.getAnalyticsConfig();
    return config.database.cacheSettings;
  }

  /**
   * Get monitoring configuration
   */
  public async getMonitoringConfig(): Promise<AnalyticsConfiguration['monitoring']> {
    const config = await this.getAnalyticsConfig();
    return config.monitoring;
  }

  /**
   * Get API endpoints configuration
   */
  public async getApiEndpointsConfig(): Promise<Record<string, unknown>> {
    const config = await this.getAnalyticsConfig();
    return (config.integration as Record<string, unknown>)?.api_endpoints as Record<string, unknown> || {};
  }

  /**
   * Get base API URL
   */
  public async getApiBaseUrl(): Promise<string> {
    const config = await this.getApiEndpointsConfig();
    return (config.base_url as string) || 'https://dex-backend-prod1.defi.gala.com';
  }

  /**
   * Get WebSocket URL
   */
  public async getWebSocketUrl(): Promise<string> {
    const config = await this.getApiEndpointsConfig();
    return (config.websocket_url as string) || 'wss://bundle-backend-prod1.defi.gala.com';
  }

  /**
   * Check if a feature is enabled
   */
  public async isFeatureEnabled(feature: string, category: 'whales' | 'analytics'): Promise<boolean> {
    try {
      if (category === 'whales') {
        const config = await this.getWhalesConfig();
        return this.getNestedValue(config as unknown as Record<string, unknown>, feature, false) as boolean;
      } else {
        const config = await this.getAnalyticsConfig();
        return this.getNestedValue(config as unknown as Record<string, unknown>, feature, false) as boolean;
      }
    } catch (error) {
      logger.warn(`Failed to check feature enabled: ${feature}`, error);
      return false;
    }
  }

  /**
   * Get configuration value with dot notation
   */
  public async getConfigValue<T = unknown>(
    path: string,
    category: 'whales' | 'analytics',
    defaultValue?: T
  ): Promise<T> {
    try {
      if (category === 'whales') {
        const config = await this.getWhalesConfig();
        return this.getNestedValue(config as unknown as Record<string, unknown>, path, defaultValue) as T;
      } else {
        const config = await this.getAnalyticsConfig();
        return this.getNestedValue(config as unknown as Record<string, unknown>, path, defaultValue) as T;
      }
    } catch (error) {
      logger.warn(`Failed to get config value: ${path}`, error);
      return defaultValue as T;
    }
  }

  /**
   * Update whale configuration (runtime only - doesn't persist)
   */
  public async updateWhaleConfig(whaleAddress: string, updates: Partial<WhaleConfig>): Promise<boolean> {
    try {
      const config = await this.getWhalesConfig();
      const whaleIndex = config.knownWhales.findIndex(w => w.address === whaleAddress);

      if (whaleIndex === -1) {
        return false;
      }

      config.knownWhales[whaleIndex] = {
        ...config.knownWhales[whaleIndex],
        ...updates
      };

      logger.debug(`Updated whale config for ${whaleAddress.substring(0, 12)}...`);
      return true;

    } catch (error) {
      logger.error(`Failed to update whale config: ${error}`);
      return false;
    }
  }

  /**
   * Add new whale to configuration (runtime only)
   */
  public async addWhaleToConfig(whaleConfig: WhaleConfig): Promise<void> {
    const config = await this.getWhalesConfig();

    // Check if whale already exists
    const existingIndex = config.knownWhales.findIndex(w => w.address === whaleConfig.address);

    if (existingIndex >= 0) {
      // Update existing whale
      config.knownWhales[existingIndex] = whaleConfig;
    } else {
      // Add new whale
      config.knownWhales.push(whaleConfig);
    }

    logger.debug(`Added/updated whale in config: ${whaleConfig.address.substring(0, 12)}...`);
  }

  /**
   * Private methods
   */
  private resolveConfigPath(): string {
    // Check environment variable first
    const envConfigPath = process.env.CONFIG_PATH;
    if (envConfigPath && fs.existsSync(envConfigPath)) {
      return envConfigPath;
    }

    // Use process.cwd() as reliable base for all environments
    // This works in both ESM and CommonJS, and in test and production
    const currentDir = process.cwd();

    // Check common locations
    const possiblePaths = [
      path.join(process.cwd(), 'config'),
      path.join(process.cwd(), 'src', 'config'),
      path.join(currentDir, '../../config'),
      path.join(currentDir, '../../../config')
    ];

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }

    throw new ConfigurationError('Configuration directory not found. Checked paths: ' + possiblePaths.join(', '));
  }

  private async loadWhalesConfig(): Promise<void> {
    try {
      const configFile = path.join(this.configPath, 'whales.json');

      if (!fs.existsSync(configFile)) {
        throw new ConfigurationError(`Whales configuration file not found: ${configFile}`, 'whales.json');
      }

      const configContent = fs.readFileSync(configFile, 'utf8');
      this.whalesConfig = JSON.parse(configContent);

      // Apply environment overrides
      this.applyEnvironmentOverrides(this.whalesConfig as unknown as Record<string, unknown>, 'WHALE_');

      // Validate configuration
      this.validateWhalesConfig(this.whalesConfig as unknown as Record<string, unknown>);

      logger.info('✅ Whales configuration loaded', {
        whaleCount: this.whalesConfig?.knownWhales?.length || 0,
        version: this.whalesConfig?.version || 'unknown'
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigurationError(`Failed to load whales configuration: ${message}`, 'whales.json');
    }
  }

  private async loadAnalyticsConfig(): Promise<void> {
    try {
      const configFile = path.join(this.configPath, 'analytics.json');

      if (!fs.existsSync(configFile)) {
        throw new ConfigurationError(`Analytics configuration file not found: ${configFile}`, 'analytics.json');
      }

      const configContent = fs.readFileSync(configFile, 'utf8');
      this.analyticsConfig = JSON.parse(configContent);

      // Apply environment overrides
      this.applyEnvironmentOverrides(this.analyticsConfig as unknown as Record<string, unknown>, 'ANALYTICS_');

      // Validate configuration
      this.validateAnalyticsConfig(this.analyticsConfig as unknown as Record<string, unknown>);

      logger.info('✅ Analytics configuration loaded', {
        version: this.analyticsConfig?.version || 'unknown'
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigurationError(`Failed to load analytics configuration: ${message}`, 'analytics.json');
    }
  }

  private validateWhalesConfig(config: Record<string, unknown>): void {
    if (!config.knownWhales || !Array.isArray(config.knownWhales)) {
      throw new ConfigurationError('Invalid whales configuration: knownWhales must be an array');
    }

    for (const whale of (config.knownWhales as Record<string, unknown>[])) {
      if (!whale.address || typeof whale.address !== 'string') {
        throw new ConfigurationError('Invalid whale configuration: address is required and must be a string');
      }

      if (!['low', 'medium', 'high', 'critical'].includes(whale.priority as string)) {
        throw new ConfigurationError(`Invalid whale priority: ${whale.priority}`);
      }
    }
  }

  private validateAnalyticsConfig(config: Record<string, unknown>): void {
    if (!config.database || !config.volumeAnalysis) {
      throw new ConfigurationError('Invalid analytics configuration: missing required sections');
    }

    if (!(config.database as Record<string, unknown>)?.cacheSettings) {
      throw new ConfigurationError('Invalid analytics configuration: missing cache settings');
    }
  }

  private applyEnvironmentOverrides(config: Record<string, unknown>, prefix: string): void {
    // Simple environment variable override system
    // Format: PREFIX_SECTION_KEY=value
    Object.keys(process.env).forEach(envKey => {
      if (envKey.startsWith(prefix)) {
        const configKey = envKey.substring(prefix.length).toLowerCase().replace(/_/g, '.');
        const envValue = process.env[envKey];

        if (envValue) {
          try {
            // Try to parse as JSON first, fallback to string
            const parsedValue = this.parseEnvironmentValue(envValue);
            this.setNestedValue(config, configKey, parsedValue);
            logger.debug(`Applied environment override: ${configKey} = ${parsedValue}`);
          } catch (error) {
            logger.warn(`Failed to apply environment override for ${envKey}: ${error}`);
          }
        }
      }
    });
  }

  private parseEnvironmentValue(value: string): string | number | boolean {
    // Try boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Try number
    const numValue = Number(value);
    if (!isNaN(numValue)) return numValue;

    // Try JSON
    try {
      return JSON.parse(value);
    } catch {
      // Return as string
      return value;
    }
  }

  private getNestedValue(obj: Record<string, unknown>, path: string, defaultValue: unknown = undefined): unknown {
    return path.split('.').reduce((current: unknown, key: string) => {
      return current && typeof current === 'object' && current !== null && (current as Record<string, unknown>)[key] !== undefined
        ? (current as Record<string, unknown>)[key]
        : defaultValue;
    }, obj);
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;

    let current: Record<string, unknown> = obj;
    for (const key of keys) {
      if (current[key] === undefined) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[lastKey] = value;
  }
}

/**
 * Convenience functions for getting common configurations
 */

// Singleton instance
export const configManager = ConfigurationManager.getInstance();

// Convenience getters
export const getWhalesConfig = () => configManager.getWhalesConfig();
export const getAnalyticsConfig = () => configManager.getAnalyticsConfig();
export const getActiveWhales = () => configManager.getActiveWhales();
export const getCopyTradingWhales = () => configManager.getCopyTradingWhales();
export const getVolumeAnalysisSettings = () => configManager.getVolumeAnalysisSettings();
export const getCacheSettings = () => configManager.getCacheSettings();
export const getMonitoringConfig = () => configManager.getMonitoringConfig();
export const getApiEndpointsConfig = () => configManager.getApiEndpointsConfig();
export const getApiBaseUrl = () => configManager.getApiBaseUrl();
export const getWebSocketUrl = () => configManager.getWebSocketUrl();

// Feature flags
export const isFeatureEnabled = (feature: string, category: 'whales' | 'analytics' = 'analytics') =>
  configManager.isFeatureEnabled(feature, category);

// Generic config value getter
export const getConfigValue = <T = unknown>(
  path: string,
  category: 'whales' | 'analytics' = 'analytics',
  defaultValue?: T
) => configManager.getConfigValue<T>(path, category, defaultValue);

/**
 * Initialize configuration on startup
 */
export const initializeConfiguration = async (): Promise<void> => {
  try {
    const manager = ConfigurationManager.getInstance();
    await manager.reloadConfigurations();
    logger.info('✅ Configuration system initialized successfully');
  } catch (error) {
    logger.error('❌ Configuration initialization failed:', error);
    throw error;
  }
};