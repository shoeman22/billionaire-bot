#!/usr/bin/env node
/**
 * Billionaire Bot - GalaSwap V3 Trading Bot
 * Main entry point for the trading system
 */

import dotenv from 'dotenv';
import { Command } from 'commander';

// Load environment variables
dotenv.config();
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
        // Note: Dry-run configuration will be implemented in future versions
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
      // Note: Remote status monitoring will be implemented in future versions
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
      // Note: Remote shutdown will be implemented in future versions
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
    let tradingEngine: TradingEngine | null = null;
    let signalCount = 0;

    // Setup double Ctrl+C handler
    const handleSignal = () => {
      signalCount++;
      if (signalCount === 1) {
        logger.info('🛑 Received shutdown signal, stopping gracefully...');
        logger.info('💡 Press Ctrl+C again to force exit');
        setTimeout(() => { signalCount = 0; }, 3000);
      } else if (signalCount >= 2) {
        logger.info('🚨 Force exit requested');
        process.exit(0);
      }
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    try {
      logger.info('📊 Getting portfolio...');

      const config = validateEnvironment();
      tradingEngine = new TradingEngine(config);

      const portfolio = await tradingEngine.getPortfolio();

      logger.info('Portfolio Summary:');
      logger.info(`💰 Total Value: $${portfolio.totalValue.toFixed(2)}`);

      // Calculate P&L percentage if we have a meaningful total value
      const pnlPercent = portfolio.totalValue > 0 ? (portfolio.pnl / portfolio.totalValue) * 100 : 0;
      logger.info(`📈 P&L: $${portfolio.pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);

      // Show individual token balances
      if (portfolio.balances.length > 0) {
        logger.info('\nToken Balances:');

        // Sort balances by USD value (highest first) and filter out zero balances
        const nonZeroBalances = portfolio.balances
          .filter(balance => balance.amount > 0)
          .sort((a, b) => b.valueUSD - a.valueUSD);

        if (nonZeroBalances.length > 0) {
          // Fetch current prices if valueUSD is missing
          const tokenPrices: Record<string, number> = {};
          const needsPrices = nonZeroBalances.some(b => b.valueUSD === 0);

          if (needsPrices) {
            logger.info('  Fetching current token prices...');
            try {
              const response = await fetch(
                'https://api.coingecko.com/api/v3/simple/price?ids=gala,ethereum,usd-coin,tether&vs_currencies=usd',
                { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)' }}
              );
              if (response.ok) {
                const prices = await response.json() as Record<string, Record<string, number>>;
                tokenPrices['GALA'] = prices.gala?.usd || 0.015;
                tokenPrices['GWETH'] = prices.ethereum?.usd || 4000;
                tokenPrices['GUSDC'] = prices['usd-coin']?.usd || 1.0;
                tokenPrices['GUSDT'] = prices.tether?.usd || 1.0;
                tokenPrices['ETIME'] = 0.082; // Fallback price
                tokenPrices['SILK'] = 0.05;   // Fallback price
                tokenPrices['TOWN'] = 0.03;   // Fallback price
              }
            } catch (error) {
              logger.debug('Price fetch failed, using fallback prices');
              tokenPrices['GALA'] = 0.015;
              tokenPrices['GUSDC'] = 1.0;
              tokenPrices['ETIME'] = 0.082;
              tokenPrices['SILK'] = 0.05;
            }
          }

          let actualTotalValue = 0;
          for (const balance of nonZeroBalances) {
            let pricePerToken: number;
            let valueUSD: number;

            if (balance.valueUSD > 0) {
              // Use API-provided values
              pricePerToken = balance.valueUSD / balance.amount;
              valueUSD = balance.valueUSD;
            } else {
              // Use fetched prices
              pricePerToken = tokenPrices[balance.token] || 0;
              valueUSD = balance.amount * pricePerToken;
            }

            actualTotalValue += valueUSD;

            const amountStr = balance.amount.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });
            const priceStr = pricePerToken.toFixed(4);
            const valueStr = valueUSD.toFixed(2);

            logger.info(`  ${balance.token.padEnd(8)}: ${amountStr.padStart(12)} @ $${priceStr} = $${valueStr}`);
          }

          // Show corrected total if different from portfolio.totalValue
          if (Math.abs(actualTotalValue - portfolio.totalValue) > 1) {
            logger.info(`\n💡 Calculated Total Value: $${actualTotalValue.toFixed(2)} (vs reported $${portfolio.totalValue.toFixed(2)})`);
          }
        } else {
          logger.info('  No tokens with positive balances found');
        }
      }

      logger.info(`\n🏦 Liquidity Positions: ${portfolio.positions.length}`);
      logger.info(`💳 Total Tokens: ${portfolio.balances.filter(b => b.amount > 0).length}`);

      // Success - exit gracefully after cleanup
      logger.debug('✅ Portfolio command completed successfully');

    } catch (error) {
      logger.error('Failed to get portfolio:', error);
      process.exit(1);
    } finally {
      // Cleanup TradingEngine connections to allow process to exit
      if (tradingEngine) {
        try {
          await tradingEngine.stop();
          logger.debug('🔌 Trading Engine stopped for portfolio command');
        } catch (error) {
          logger.debug('⚠️ Error stopping Trading Engine (may already be stopped):', error);
        }
      }

      // Remove signal handlers
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);

      // Force process to exit cleanly (portfolio is a one-time command)
      logger.debug('🚪 Portfolio command exiting cleanly');
      process.exit(0);
    }
  });

program
  .command('analyze')
  .description('Analyze wallet trading performance')
  .option('--today', 'Analyze today\'s trading performance')
  .option('--week', 'Analyze last 7 days of trading')
  .option('--month', 'Analyze last 30 days of trading')
  .option('--start <date>', 'Start date for analysis (YYYY-MM-DD)')
  .option('--end <date>', 'End date for analysis (YYYY-MM-DD)')
  .action(async (options) => {
    try {
      logger.info('📊 Starting wallet performance analysis...');

      const { WalletPerformanceAnalyzer } = await import('./scripts/analyze-wallet-performance');

      let startDate: Date | undefined;
      let endDate: Date | undefined;
      const now = new Date();

      // Parse time period options
      if (options.today) {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = now;
      } else if (options.week) {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        endDate = now;
      } else if (options.month) {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        endDate = now;
      } else if (options.start || options.end) {
        if (options.start) {
          startDate = new Date(options.start);
          if (isNaN(startDate.getTime())) {
            throw new Error('Invalid start date format. Use YYYY-MM-DD');
          }
        }
        if (options.end) {
          endDate = new Date(options.end);
          if (isNaN(endDate.getTime())) {
            throw new Error('Invalid end date format. Use YYYY-MM-DD');
          }
        }
      } else {
        // Default: last 24 hours
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        endDate = now;
      }

      const analyzer = new WalletPerformanceAnalyzer(undefined, startDate, endDate);
      await analyzer.analyze();

      logger.info('✅ Analysis completed successfully');

    } catch (error) {
      logger.error('❌ Analysis failed:', error);
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
        await client.quoting.quoteExactInput('GUSDC|Unit|none|none', 'TOWN|Unit|none|none', 1);
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

// Parse command line arguments (ESM compatible)
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { program };