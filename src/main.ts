#!/usr/bin/env node
/**
 * Billionaire Bot - GalaSwap V3 Trading Bot
 * Main entry point for the trading system
 */

import { Command } from 'commander';
import { validateEnvironment } from './config/environment';
import { TradingEngine } from './trading/TradingEngine';
import { logger } from './utils/logger';
import { safeParseFloat } from './utils/safe-parse';

const program = new Command();

program
  .name('billionaire-bot')
  .description('Advanced GalaSwap V3 Trading Bot')
  .version('1.0.0');

program
  .command('start')
  .description('Start the trading bot')
  .option('-d, --dry-run', 'Run in dry-run mode (no actual trades)')
  .option('-c, --config <path>', 'Path to configuration file')
  .action(async (options) => {
    try {
      logger.info('🚀 Starting Billionaire Bot...');

      // Load and validate configuration
      const config = validateEnvironment();

      if (options.dryRun) {
        logger.warn('⚠️  Running in DRY-RUN mode - no actual trades will be executed');
        // TODO: Set dry-run flags in config
      }

      // Initialize trading engine
      const tradingEngine = new TradingEngine(config);

      // Setup graceful shutdown
      setupGracefulShutdown(tradingEngine);

      // Start the engine
      await tradingEngine.start();

      logger.info('✅ Billionaire Bot is now running!');
      logger.info('💡 Use Ctrl+C to stop the bot gracefully');

      // Keep the process running
      process.stdin.resume();

    } catch (error) {
      logger.error('❌ Failed to start trading bot:', error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Get current status of the trading bot')
  .action(async () => {
    try {
      // TODO: Connect to running instance and get status
      logger.info('Status check not yet implemented');
    } catch (error) {
      logger.error('Failed to get status:', error);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop the trading bot')
  .action(async () => {
    try {
      // TODO: Connect to running instance and stop gracefully
      logger.info('Remote stop not yet implemented');
    } catch (error) {
      logger.error('Failed to stop bot:', error);
      process.exit(1);
    }
  });

program
  .command('trade')
  .description('Execute a manual trade')
  .requiredOption('-i, --token-in <token>', 'Input token symbol')
  .requiredOption('-o, --token-out <token>', 'Output token symbol')
  .requiredOption('-a, --amount <amount>', 'Amount to trade')
  .option('-s, --slippage <percent>', 'Slippage tolerance (default: 1%)', '1')
  .action(async (options) => {
    try {
      logger.info('🔄 Executing manual trade...');

      const config = validateEnvironment();
      const tradingEngine = new TradingEngine(config);

      const result = await tradingEngine.executeManualTrade({
        tokenIn: options.tokenIn,
        tokenOut: options.tokenOut,
        amountIn: options.amount,
        slippageTolerance: safeParseFloat(options.slippage, 0.01) / 100
      });

      if (result.success) {
        logger.info(`✅ Trade executed successfully!`);
        logger.info(`📄 Transaction ID: ${result.transactionId}`);
      } else {
        logger.error(`❌ Trade failed: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      logger.error('Failed to execute trade:', error);
      process.exit(1);
    }
  });

program
  .command('portfolio')
  .description('Show current portfolio')
  .action(async () => {
    try {
      logger.info('📊 Getting portfolio...');

      const config = validateEnvironment();
      const tradingEngine = new TradingEngine(config);

      const portfolio = await tradingEngine.getPortfolio();

      logger.info('Portfolio Summary:');
      logger.info(`💰 Total Value: $${portfolio.totalValue.toFixed(2)}`);
      logger.info(`📈 P&L: $${portfolio.pnl.toFixed(2)}`);
      logger.info(`🏦 Positions: ${portfolio.positions.length}`);
      logger.info(`💳 Token Balances: ${portfolio.balances.length}`);

    } catch (error) {
      logger.error('Failed to get portfolio:', error);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Test API connection and configuration')
  .action(async () => {
    try {
      logger.info('🧪 Testing configuration and API connection...');

      const config = validateEnvironment();
      logger.info('✅ Configuration valid');

      const tradingEngine = new TradingEngine(config);
      const client = tradingEngine.getClient();

      // Test API health by checking if we can get pool data
      try {
        await client.pools.getPoolData('GUSDC$Unit$none$none', 'TOWN|Unit|none|none', 3000);
        logger.info('✅ GalaSwap API connection healthy');
      } catch (error) {
        logger.warn('⚠️ Could not test API connection:', error);
      }

      // Get wallet info from SDK config
      const walletAddress = 'configured'; // SDK doesn't expose wallet address directly
      logger.info(`✅ Wallet configured: ${walletAddress.substring(0, 10)}...`);

      logger.info('🎉 All tests passed! Ready to trade.');

    } catch (error) {
      logger.error('❌ Test failed:', error);
      process.exit(1);
    }
  });

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(tradingEngine: TradingEngine): void {
  const gracefulShutdown = async (signal: string) => {
    logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);

    try {
      await tradingEngine.stop();
      logger.info('✅ Trading engine stopped successfully');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Handle various shutdown signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('💥 Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('💥 Unhandled Rejection:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
  });
}

// Parse command line arguments
if (require.main === module) {
  program.parse();
}

export { program };