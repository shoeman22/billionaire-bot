/**
 * Environment Configuration and Validation
 * Secure handling of environment variables with validation
 */

import { logger } from '../utils/logger';
import { safeParseFloat } from '../utils/safe-parse';

export interface BotConfig {
  trading: TradingConfig;
  api: ApiConfig;
  wallet: WalletConfig;
  development: DevelopmentConfig;
}

export interface TradingConfig {
  maxPositionSize: number;
  defaultSlippageTolerance?: number; // Optional for test compatibility
  minProfitThreshold?: number; // Optional for test compatibility
  maxDailyVolume?: number;
  maxSlippage?: number;
  maxPortfolioConcentration?: number;
  emergencyStopLoss?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  wallet?: {
    address?: string;
  };
  riskThresholds?: {
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  strategies?: {
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

export interface ApiConfig {
  baseUrl: string;
  wsUrl: string;
  maxRetries?: number;
  timeout?: number; // API request timeout in milliseconds
}

export interface WalletConfig {
  address: string;
  maxPositionSize?: number;
  // Private key removed for security - use SignerService instead
}

export interface DevelopmentConfig {
  nodeEnv: string;
  logLevel: string;
  productionTestMode: boolean;
}

/**
 * Validates and returns the complete bot configuration
 */
export function validateEnvironment(): BotConfig {
  const requiredEnvVars = [
    'WALLET_ADDRESS',
    'WALLET_PRIVATE_KEY',
    'GALASWAP_API_URL',
    'GALASWAP_WS_URL'
  ];

  // Check for required environment variables
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}\n` +
      'Please copy .env.example to .env and configure your settings.'
    );
  }

  // Validate wallet address format
  const walletAddress = process.env.WALLET_ADDRESS!;
  if (!walletAddress.startsWith('eth|')) {
    throw new Error('WALLET_ADDRESS must start with "eth|" for Ethereum address');
  }

  // Check for production test mode
  const productionTestMode = process.env.PRODUCTION_TEST_MODE === 'true';
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Validate private key is base64
  const privateKey = process.env.WALLET_PRIVATE_KEY!;
  try {
    Buffer.from(privateKey, 'base64');
  } catch (_error) {
    throw new Error('WALLET_PRIVATE_KEY must be a valid base64 encoded key');
  }

  // Production test mode safety validations
  if (productionTestMode) {
    logger.warn('⚠️  PRODUCTION TEST MODE ACTIVE ⚠️');
    logger.warn('   • Connected to PRODUCTION APIs for real data');
    logger.warn('   • Trade execution is DISABLED');
    logger.warn('   • All transactions will be simulated only');

    // Validate we're not using production wallet in test mode
    if (process.env.GALASWAP_API_URL?.includes('prod') &&
        !walletAddress.includes('test') &&
        !walletAddress.includes('Test') &&
        !walletAddress.includes('0x0000000000000000000000000000000000000000')) {
      logger.error('🚨 SECURITY WARNING: Production API + Non-test wallet detected!');
      logger.error('   Use test wallet credentials only in production test mode');
      // Allow but warn strongly - user responsibility
    }
  }

  // Production mode safety check
  if (!productionTestMode &&
      nodeEnv === 'production' &&
      process.env.GALASWAP_API_URL?.includes('prod')) {
    logger.warn('🔥 LIVE PRODUCTION MODE - Real trades will be executed!');
    logger.warn('   • Using production APIs with real funds');
    logger.warn('   • All transactions will affect your wallet');
  }

  const config: BotConfig = {
    trading: {
      maxPositionSize: safeParseFloat(process.env.MAX_POSITION_SIZE, 1000),
      defaultSlippageTolerance: safeParseFloat(process.env.DEFAULT_SLIPPAGE_TOLERANCE, 0.01),
      minProfitThreshold: safeParseFloat(process.env.MIN_PROFIT_THRESHOLD, 0.001),
    },
    api: {
      baseUrl: process.env.GALASWAP_API_URL!,
      wsUrl: process.env.GALASWAP_WS_URL!,
    },
    wallet: {
      address: walletAddress,
      // Private key no longer stored in config for security
    },
    development: {
      nodeEnv,
      logLevel: process.env.LOG_LEVEL || 'info',
      productionTestMode,
    }
  };

  logger.info('Configuration validated successfully');

  // Log non-sensitive configuration for debugging
  logger.debug('Configuration:', {
    trading: config.trading,
    api: { baseUrl: config.api.baseUrl, wsUrl: config.api.wsUrl },
    wallet: { address: config.wallet.address.substring(0, 10) + '...' },
    development: config.development
  });

  // Additional production test mode logging
  if (productionTestMode) {
    logger.info('📊 Production Test Mode Configuration:');
    logger.info(`   • APIs: ${config.api.baseUrl}`);
    logger.info(`   • Environment: ${config.development.nodeEnv}`);
    logger.info(`   • Test Mode: ${productionTestMode ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`   • Max Position: $${config.trading.maxPositionSize}`);
  }

  return config;
}

/**
 * Get configuration (assumes validation has been done)
 */
export function getConfig(): BotConfig {
  return validateEnvironment();
}