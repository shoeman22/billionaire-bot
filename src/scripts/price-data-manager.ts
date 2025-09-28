#!/usr/bin/env tsx

/**
 * Price Data Manager CLI
 * Command-line interface for managing the historical price data collection system
 */

import { Command } from 'commander';
import { priceCollector, timeSeriesDB } from '../data';
import { logger } from '../utils/logger';
import { IntervalType } from '../entities/analytics';

const program = new Command();

program
  .name('price-data-manager')
  .description('Manage historical price data collection and storage')
  .version('1.0.0');

// Start price collection
program
  .command('start')
  .description('Start continuous price data collection')
  .option('-i, --interval <ms>', 'Collection interval in milliseconds', '30000')
  .option('-r, --retention <days>', 'Data retention period in days', '30')
  .option('--no-ohlcv', 'Disable OHLCV aggregation')
  .action(async (options) => {
    try {
      logger.info('🚀 Starting Historical Price Data Collection System');

      // Configure collector
      priceCollector.updateConfig({
        collectionInterval: parseInt(options.interval),
        retentionDays: parseInt(options.retention),
        enableOHLCVAggregation: options.ohlcv !== false
      });

      logger.info(`📊 Configuration:`);
      logger.info(`   Collection interval: ${options.interval}ms (${Math.round(parseInt(options.interval) / 1000)}s)`);
      logger.info(`   Data retention: ${options.retention} days`);
      logger.info(`   OHLCV aggregation: ${options.ohlcv !== false ? 'enabled' : 'disabled'}`);

      // Start the collector
      await priceCollector.start();

      logger.info('✅ Price data collection started successfully');
      logger.info('📈 System is now collecting prices continuously...');
      logger.info('💡 Press Ctrl+C to stop');

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        logger.info('\n🛑 Stopping price data collection...');
        await priceCollector.stop();
        logger.info('✅ Price data collection stopped');
        process.exit(0);
      });

      // Keep the process running
      await new Promise(() => {});

    } catch (error) {
      logger.error('❌ Failed to start price data collection:', error);
      process.exit(1);
    }
  });

// Stop price collection
program
  .command('stop')
  .description('Stop price data collection (if running in background)')
  .action(async () => {
    try {
      logger.info('🛑 Stopping price data collection...');

      if (priceCollector.isActive()) {
        await priceCollector.stop();
        logger.info('✅ Price data collection stopped');
      } else {
        logger.info('ℹ️ Price collector is not currently running');
      }

    } catch (error) {
      logger.error('❌ Failed to stop price data collection:', error);
      process.exit(1);
    }
  });

// Get status
program
  .command('status')
  .description('Check status of price data collection system')
  .action(async () => {
    try {
      logger.info('📊 Price Data Collection System Status');
      logger.info('='.repeat(50));

      // Collection status
      const isActive = priceCollector.isActive();
      logger.info(`🟢 Collector Status: ${isActive ? 'RUNNING' : 'STOPPED'}`);

      // Collection statistics
      const stats = priceCollector.getStatistics();
      logger.info(`\n📈 Collection Statistics:`);
      logger.info(`   Total collected: ${stats.totalCollected}`);
      logger.info(`   Successful: ${stats.successfulCollections}`);
      logger.info(`   Failed: ${stats.failedCollections}`);
      logger.info(`   Success rate: ${stats.successfulCollections + stats.failedCollections > 0 ?
        ((stats.successfulCollections / (stats.successfulCollections + stats.failedCollections)) * 100).toFixed(2) : 0}%`);
      logger.info(`   Last collection: ${stats.lastCollectionTime ? new Date(stats.lastCollectionTime).toISOString() : 'Never'}`);
      logger.info(`   Average time: ${stats.averageCollectionTime.toFixed(2)}ms`);

      // Database statistics
      await timeSeriesDB.initialize();
      const dbStats = await timeSeriesDB.getDatabaseStats();
      logger.info(`\n💾 Database Statistics:`);
      logger.info(`   Price records: ${dbStats.priceHistoryCount.toLocaleString()}`);
      logger.info(`   OHLCV records: ${dbStats.ohlcvCount.toLocaleString()}`);
      logger.info(`   Statistics records: ${dbStats.statisticsCount.toLocaleString()}`);
      logger.info(`   Tokens tracked: ${dbStats.tokensTracked}`);
      logger.info(`   Date range: ${dbStats.oldestRecord?.toLocaleDateString()} to ${dbStats.newestRecord?.toLocaleDateString()}`);

      // Recent errors
      if (stats.collectionErrors.length > 0) {
        logger.info(`\n⚠️ Recent Errors (${stats.collectionErrors.length}):`);
        stats.collectionErrors.slice(0, 5).forEach(error => {
          logger.info(`   ${error.token}: ${error.error.substring(0, 80)}`);
        });
      }

    } catch (error) {
      logger.error('❌ Failed to get status:', error);
      process.exit(1);
    }
  });

// Manual collection
program
  .command('collect')
  .description('Perform one-time price collection')
  .option('-t, --tokens <tokens>', 'Comma-separated list of tokens to collect', 'GALA,GUSDC,ETIME')
  .action(async (options) => {
    try {
      const tokens = options.tokens.split(',').map((t: string) => t.trim().toUpperCase());

      logger.info('💱 Manual Price Collection');
      logger.info(`📊 Collecting prices for: ${tokens.join(', ')}`);

      await priceCollector.collectSpecificTokens(tokens);

      logger.info('✅ Manual collection completed');

      // Show collected data
      await timeSeriesDB.initialize();
      for (const token of tokens) {
        const latestPrice = await timeSeriesDB.getLatestPrice(token);
        if (latestPrice) {
          logger.info(`   ${token}: $${latestPrice.getPriceUsd().toFixed(6)} at ${new Date(latestPrice.timestamp).toLocaleString()}`);
        } else {
          logger.info(`   ${token}: No data collected`);
        }
      }

    } catch (error) {
      logger.error('❌ Manual collection failed:', error);
      process.exit(1);
    }
  });

// Database statistics
program
  .command('stats')
  .description('Show detailed database statistics')
  .option('-t, --token <token>', 'Show statistics for specific token')
  .action(async (options) => {
    try {
      await timeSeriesDB.initialize();

      logger.info('💾 Database Statistics');
      logger.info('='.repeat(50));

      const dbStats = await timeSeriesDB.getDatabaseStats();
      logger.info(`📊 Overall Statistics:`);
      logger.info(`   Total price records: ${dbStats.priceHistoryCount.toLocaleString()}`);
      logger.info(`   Total OHLCV records: ${dbStats.ohlcvCount.toLocaleString()}`);
      logger.info(`   Total statistics: ${dbStats.statisticsCount.toLocaleString()}`);
      logger.info(`   Tokens tracked: ${dbStats.tokensTracked}`);
      logger.info(`   Data age: ${dbStats.oldestRecord?.toLocaleDateString()} to ${dbStats.newestRecord?.toLocaleDateString()}`);

      if (options.token) {
        const token = options.token.toUpperCase();
        logger.info(`\n📈 Token-Specific Statistics: ${token}`);

        // Recent prices
        const recentPrices = await timeSeriesDB.getPriceHistory(token, {
          orderBy: 'DESC',
          limit: 10
        });

        if (recentPrices.length > 0) {
          logger.info(`   Latest price: $${recentPrices[0].getPriceUsd().toFixed(6)}`);
          logger.info(`   Records available: ${recentPrices.length >= 10 ? '10+ (showing latest 10)' : recentPrices.length}`);
          logger.info(`   Recent prices:`);
          recentPrices.slice(0, 5).forEach(price => {
            logger.info(`     $${price.getPriceUsd().toFixed(6)} at ${new Date(price.timestamp).toLocaleString()}`);
          });

          // Calculate volatility
          try {
            const volatility = await timeSeriesDB.calculateVolatility(token, 24 * 60 * 60 * 1000); // 24h
            logger.info(`   24h volatility: ${(volatility * 100).toFixed(2)}%`);
          } catch (error) {
            logger.info(`   24h volatility: Unable to calculate`);
          }
        } else {
          logger.info(`   No price data found for ${token}`);
        }

        // OHLCV data
        const ohlcvData = await timeSeriesDB.getOHLCV(token, {
          intervalType: '1h',
          orderBy: 'DESC',
          limit: 5
        });

        if (ohlcvData.length > 0) {
          logger.info(`   Latest OHLCV (1h candles):`);
          ohlcvData.forEach(candle => {
            logger.info(`     ${new Date(candle.interval_start).toLocaleString()}: O:${candle.getOpenPrice().toFixed(6)} H:${candle.getHighPrice().toFixed(6)} L:${candle.getLowPrice().toFixed(6)} C:${candle.getClosePrice().toFixed(6)}`);
          });
        }
      }

    } catch (error) {
      logger.error('❌ Failed to get statistics:', error);
      process.exit(1);
    }
  });

// Price history
program
  .command('history')
  .description('Show price history for a token')
  .argument('<token>', 'Token symbol (e.g., GALA)')
  .option('-h, --hours <hours>', 'Hours of history to show', '24')
  .option('-l, --limit <limit>', 'Maximum number of records', '50')
  .option('--ohlcv [interval]', 'Show OHLCV data instead of raw prices (1m,5m,1h,1d)', '1h')
  .action(async (token, options) => {
    try {
      await timeSeriesDB.initialize();

      const tokenSymbol = token.toUpperCase();
      const hours = parseInt(options.hours);
      const limit = parseInt(options.limit);

      logger.info(`📈 Price History: ${tokenSymbol}`);
      logger.info('='.repeat(50));

      if (options.ohlcv) {
        // Show OHLCV data
        const interval = typeof options.ohlcv === 'string' ? options.ohlcv : '1h';
        const ohlcvData = await timeSeriesDB.getOHLCV(tokenSymbol, {
          intervalType: interval as IntervalType,
          startTime: Date.now() - (hours * 60 * 60 * 1000),
          orderBy: 'DESC',
          limit
        });

        logger.info(`📊 OHLCV Data (${interval} candles, last ${hours}h):`);
        if (ohlcvData.length > 0) {
          logger.info(`${'Time'.padEnd(20)} ${'Open'.padStart(10)} ${'High'.padStart(10)} ${'Low'.padStart(10)} ${'Close'.padStart(10)} ${'Volume'.padStart(12)} ${'Trades'.padStart(8)}`);
          logger.info('-'.repeat(88));

          ohlcvData.forEach(candle => {
            const time = new Date(candle.interval_start).toLocaleString();
            const open = candle.getOpenPrice().toFixed(6);
            const high = candle.getHighPrice().toFixed(6);
            const low = candle.getLowPrice().toFixed(6);
            const close = candle.getClosePrice().toFixed(6);
            const volume = candle.getVolume().toFixed(2);
            const trades = candle.trade_count.toString();

            logger.info(`${time.padEnd(20)} ${open.padStart(10)} ${high.padStart(10)} ${low.padStart(10)} ${close.padStart(10)} ${volume.padStart(12)} ${trades.padStart(8)}`);
          });
        } else {
          logger.info(`No OHLCV data available for ${tokenSymbol}`);
        }

      } else {
        // Show raw price history
        const priceHistory = await timeSeriesDB.getPriceHistory(tokenSymbol, {
          startTime: Date.now() - (hours * 60 * 60 * 1000),
          orderBy: 'DESC',
          limit
        });

        logger.info(`💰 Raw Price Data (last ${hours}h, max ${limit} records):`);
        if (priceHistory.length > 0) {
          logger.info(`${'Time'.padEnd(20)} ${'Price (USD)'.padStart(12)} ${'Source'.padStart(15)}`);
          logger.info('-'.repeat(50));

          priceHistory.forEach(price => {
            const time = new Date(price.timestamp).toLocaleString();
            const priceUsd = price.getPriceUsd().toFixed(6);
            const source = price.source;

            logger.info(`${time.padEnd(20)} $${priceUsd.padStart(11)} ${source.padStart(15)}`);
          });

          // Summary statistics
          const prices = priceHistory.map(p => p.getPriceUsd());
          const minPrice = Math.min(...prices);
          const maxPrice = Math.max(...prices);
          const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
          const latestPrice = prices[0];
          const oldestPrice = prices[prices.length - 1];
          const change = ((latestPrice - oldestPrice) / oldestPrice) * 100;

          logger.info('\n📊 Summary:');
          logger.info(`   Records: ${priceHistory.length}`);
          logger.info(`   Price range: $${minPrice.toFixed(6)} - $${maxPrice.toFixed(6)}`);
          logger.info(`   Average: $${avgPrice.toFixed(6)}`);
          logger.info(`   Change: ${change > 0 ? '+' : ''}${change.toFixed(2)}%`);
        } else {
          logger.info(`No price history available for ${tokenSymbol}`);
        }
      }

    } catch (error) {
      logger.error('❌ Failed to get price history:', error);
      process.exit(1);
    }
  });

// Data cleanup
program
  .command('cleanup')
  .description('Clean up old price data')
  .option('-d, --days <days>', 'Keep data newer than this many days', '30')
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .action(async (options) => {
    try {
      await timeSeriesDB.initialize();

      const days = parseInt(options.days);
      logger.info(`🧹 Data Cleanup (keeping ${days} days)`);

      if (options.dryRun) {
        logger.info('🔍 DRY RUN - No data will be deleted');
        const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
        logger.info(`   Would delete data older than: ${new Date(cutoffTime).toLocaleDateString()}`);

        // Show current stats
        const dbStats = await timeSeriesDB.getDatabaseStats();
        logger.info(`   Current records:`);
        logger.info(`     Price history: ${dbStats.priceHistoryCount.toLocaleString()}`);
        logger.info(`     OHLCV: ${dbStats.ohlcvCount.toLocaleString()}`);
        logger.info(`     Statistics: ${dbStats.statisticsCount.toLocaleString()}`);
        logger.info('\n💡 Run without --dry-run to perform actual cleanup');
      } else {
        logger.info('⚠️ This will permanently delete old data!');
        logger.info(`   Cutoff date: ${new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toLocaleDateString()}`);

        // Perform cleanup
        await timeSeriesDB.cleanupOldData(days);
        logger.info('✅ Cleanup completed');

        // Show updated stats
        const dbStats = await timeSeriesDB.getDatabaseStats();
        logger.info(`   Remaining records:`);
        logger.info(`     Price history: ${dbStats.priceHistoryCount.toLocaleString()}`);
        logger.info(`     OHLCV: ${dbStats.ohlcvCount.toLocaleString()}`);
        logger.info(`     Statistics: ${dbStats.statisticsCount.toLocaleString()}`);
      }

    } catch (error) {
      logger.error('❌ Cleanup failed:', error);
      process.exit(1);
    }
  });

// Error handling
program.exitOverride();

try {
  program.parse();
} catch (error) {
  if (error instanceof Error) {
    if ((error as Error & { code: string }).code === 'commander.help' || (error as Error & { code: string }).code === 'commander.helpDisplayed') {
      process.exit(0);
    }
  }
  logger.error('❌ Command failed:', error);
  process.exit(1);
}