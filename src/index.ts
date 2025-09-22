/**
 * Billionaire Bot - Main Entry Point
 * Sophisticated GalaSwap V3 trading bot
 */

import dotenv from 'dotenv';
import { TradingEngine } from './trading/TradingEngine';
import { logger } from './utils/logger';
import { validateEnvironment } from './config/environment';

// Load environment variables
dotenv.config();

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    logger.info('🤖 Starting Billionaire Bot...');

    // Validate environment configuration
    const config = validateEnvironment();
    logger.info('✅ Environment configuration validated');

    // Initialize trading engine
    const tradingEngine = new TradingEngine(config);

    // Start the bot
    await tradingEngine.start();

    logger.info('🚀 Billionaire Bot is now running!');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down Billionaire Bot...');
      await tradingEngine.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('❌ Failed to start Billionaire Bot:', error);
    process.exit(1);
  }
}

// Start the application (ESM compatible)
import { fileURLToPath } from 'url';

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}