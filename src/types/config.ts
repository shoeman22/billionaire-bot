/**
 * Configuration Type Definitions
 * Types for bot configuration, environment settings, and runtime parameters
 */

// Re-export from config/environment.ts for convenience
export {
  BotConfig,
  TradingConfig,
  ApiConfig,
  WalletConfig,
  DevelopmentConfig,
} from '../config/environment';

// Extended configuration types

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  connectionLimit: number;
  timeout: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  database: number;
  keyPrefix: string;
  ttl: number;
}

export interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  outputs: LogOutput[];
  rotation: LogRotationConfig;
  structured: boolean;
  sanitize: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogFormat = 'json' | 'text' | 'pretty';
export type LogOutput = 'console' | 'file' | 'database' | 'elasticsearch';

export interface LogRotationConfig {
  enabled: boolean;
  maxSize: string; // e.g., "10MB"
  maxFiles: number;
  maxAge: string; // e.g., "7d"
  compress: boolean;
}

export interface SecurityConfig {
  encryptionKey: string;
  jwtSecret: string;
  sessionTimeout: number;
  rateLimiting: RateLimitConfig;
  cors: CorsConfig;
  authentication: AuthConfig;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests: boolean;
  skipFailedRequests: boolean;
  keyGenerator?: string;
}

export interface CorsConfig {
  enabled: boolean;
  origins: string[];
  methods: string[];
  credentials: boolean;
  maxAge: number;
}

export interface AuthConfig {
  required: boolean;
  providers: AuthProvider[];
  tokenExpiry: number;
  refreshTokenExpiry: number;
}

export type AuthProvider = 'jwt' | 'oauth' | 'apikey';

export interface MonitoringConfig {
  enabled: boolean;
  metricsPort: number;
  healthCheckPort: number;
  prometheusPath: string;
  intervals: {
    healthCheck: number;
    metrics: number;
    cleanup: number;
  };
  alerts: AlertingConfig;
}

export interface AlertingConfig {
  enabled: boolean;
  channels: AlertChannel[];
  thresholds: AlertThresholds;
  rateLimits: AlertRateLimit;
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'sms';
  config: Record<string, any>;
  enabled: boolean;
  severity: AlertSeverity[];
}

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertThresholds {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  responseTime: number;
  errorRate: number;
  tradingLoss: number;
}

export interface AlertRateLimit {
  maxPerHour: number;
  maxPerDay: number;
  cooldownPeriod: number;
}

export interface PerformanceConfig {
  caching: CachingConfig;
  pooling: PoolingConfig;
  optimization: OptimizationConfig;
  profiling: ProfilingConfig;
}

export interface CachingConfig {
  enabled: boolean;
  provider: 'memory' | 'redis' | 'memcached';
  ttl: Record<string, number>;
  maxSize: number;
  compression: boolean;
}

export interface PoolingConfig {
  database: {
    min: number;
    max: number;
    acquireTimeoutMillis: number;
    idleTimeoutMillis: number;
  };
  http: {
    maxSockets: number;
    maxFreeSockets: number;
    timeout: number;
    keepAlive: boolean;
  };
}

export interface OptimizationConfig {
  batchProcessing: boolean;
  parallelExecution: boolean;
  maxConcurrency: number;
  queueSize: number;
  memoryLimit: string;
}

export interface ProfilingConfig {
  enabled: boolean;
  samplingRate: number;
  outputPath: string;
  includeSourceMaps: boolean;
}

export interface BackupConfig {
  enabled: boolean;
  schedule: string; // cron expression
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  storage: BackupStorage;
  encryption: boolean;
  compression: boolean;
}

export interface BackupStorage {
  type: 'local' | 's3' | 'gcs' | 'azure';
  config: Record<string, any>;
}

export interface MaintenanceConfig {
  enabled: boolean;
  schedule: string; // cron expression
  tasks: MaintenanceTask[];
  notification: boolean;
  gracefulShutdown: GracefulShutdownConfig;
}

export interface MaintenanceTask {
  name: string;
  type: 'cleanup' | 'optimization' | 'backup' | 'health_check';
  config: Record<string, any>;
  enabled: boolean;
}

export interface GracefulShutdownConfig {
  timeout: number;
  signals: string[];
  hooks: ShutdownHook[];
}

export interface ShutdownHook {
  name: string;
  priority: number;
  timeout: number;
  handler: string;
}

// Complete application configuration
export interface AppConfig {
  trading: {
    maxPositionSize: number;
    defaultSlippageTolerance: number;
    minProfitThreshold: number;
  };
  api: {
    baseUrl: string;
    wsUrl: string;
  };
  wallet: {
    address: string;
    privateKey: string;
  };
  development: {
    nodeEnv: string;
    logLevel: string;
  };
  database?: DatabaseConfig;
  redis?: RedisConfig;
  logging: LoggingConfig;
  security?: SecurityConfig;
  monitoring: MonitoringConfig;
  performance: PerformanceConfig;
  backup?: BackupConfig;
  maintenance?: MaintenanceConfig;
}

// Environment-specific configurations
export interface EnvironmentConfig {
  name: string;
  description: string;
  config: Partial<AppConfig>;
  overrides: ConfigOverride[];
}

export interface ConfigOverride {
  path: string;
  value: any;
  condition?: string;
}

// Configuration validation
export interface ConfigValidationRule {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: any;
  validation?: ValidationConstraint[];
}

export interface ValidationConstraint {
  type: 'min' | 'max' | 'pattern' | 'enum' | 'custom';
  value: any;
  message?: string;
}

export interface ConfigSchema {
  version: string;
  rules: ConfigValidationRule[];
  environments: string[];
}

// Configuration loading and management
export interface ConfigLoader {
  load(environment: string): Promise<AppConfig>;
  validate(config: AppConfig): ValidationResult[];
  merge(base: AppConfig, override: Partial<AppConfig>): AppConfig;
  watch(callback: (config: AppConfig) => void): void;
}

export interface ValidationResult {
  path: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  value?: any;
}

// Runtime configuration updates
export interface ConfigUpdate {
  path: string;
  value: any;
  timestamp: number;
  source: string;
  reason?: string;
}

export interface ConfigHistory {
  updates: ConfigUpdate[];
  snapshots: Array<{
    timestamp: number;
    config: AppConfig;
    version: string;
  }>;
}

// Feature flags
export interface FeatureFlag {
  name: string;
  enabled: boolean;
  rollout: RolloutConfig;
  metadata: Record<string, any>;
}

export interface RolloutConfig {
  percentage: number;
  userGroups?: string[];
  conditions?: RolloutCondition[];
}

export interface RolloutCondition {
  type: 'user_id' | 'ip_address' | 'time_range' | 'custom';
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than';
  value: any;
}

export interface FeatureFlagConfig {
  enabled: boolean;
  provider: 'local' | 'remote';
  refreshInterval: number;
  flags: FeatureFlag[];
}

// Secrets management
export interface SecretsConfig {
  provider: 'env' | 'vault' | 'aws_secrets' | 'azure_keyvault';
  config: Record<string, any>;
  autoRefresh: boolean;
  refreshInterval: number;
}

export interface Secret {
  key: string;
  value: string;
  version: string;
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, any>;
}

// Configuration profiles for different deployment scenarios
export interface DeploymentProfile {
  name: string;
  description: string;
  environment: 'development' | 'testing' | 'staging' | 'production';
  config: Partial<AppConfig>;
  resources: ResourceRequirements;
  scaling: ScalingConfig;
}

export interface ResourceRequirements {
  cpu: string;
  memory: string;
  disk: string;
  network: string;
}

export interface ScalingConfig {
  enabled: boolean;
  minInstances: number;
  maxInstances: number;
  targetCpuUtilization: number;
  targetMemoryUtilization: number;
  scaleUpCooldown: number;
  scaleDownCooldown: number;
}

// Development and testing configurations
export interface TestConfig {
  mockData: boolean;
  seedDatabase: boolean;
  bypassAuth: boolean;
  logLevel: LogLevel;
  fixtures: string[];
  coverage: CoverageConfig;
}

export interface CoverageConfig {
  threshold: number;
  include: string[];
  exclude: string[];
  reporters: string[];
}

export interface DevelopmentOverrides {
  hotReload: boolean;
  debugMode: boolean;
  verboseLogging: boolean;
  mockExternalServices: boolean;
  disableRateLimiting: boolean;
}