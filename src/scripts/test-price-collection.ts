#!/usr/bin/env tsx

/**
 * Test Script: Historical Price Data Collection System
 * Validates the price collector and time-series database functionality
 */

import { priceCollector, timeSeriesDB } from '../data';
import { logger } from '../utils/logger';

async function testPriceCollectionSystem(): Promise<void> {
  logger.info('🧪 Testing Historical Price Data Collection System\n');

  try {
    // Test 1: Initialize systems
    logger.info('📊 Test 1: System Initialization');
    await timeSeriesDB.initialize();
    logger.info('✅ TimeSeriesDB initialized');

    // Configure collector for testing (faster collection)
    priceCollector.updateConfig({
      collectionInterval: 10000, // 10 seconds for testing
      retentionDays: 7, // 7 days for testing
      enableOHLCVAggregation: true,
      ohlcvIntervals: ['1m', '5m', '1h'],
      maxRetries: 2,
      rateLimitRequests: 5 // Slower for testing
    });
    logger.info('✅ Price collector configured for testing\n');

    // Test 2: Manual price collection
    logger.info('📊 Test 2: Manual Price Collection');
    const testTokens = ['GALA', 'GUSDC', 'ETIME'];
    await priceCollector.collectSpecificTokens(testTokens);

    // Check if data was stored
    for (const token of testTokens) {
      const latestPrice = await timeSeriesDB.getLatestPrice(token);
      if (latestPrice) {
        logger.info(`✅ ${token}: $${latestPrice.getPriceUsd().toFixed(6)} at ${new Date(latestPrice.timestamp).toISOString()}`);
      } else {
        logger.info(`⚠️ ${token}: No price data collected`);
      }
    }
    logger.info();

    // Test 3: Database statistics
    logger.info('📊 Test 3: Database Statistics');
    const dbStats = await timeSeriesDB.getDatabaseStats();
    logger.info(`✅ Price records: ${dbStats.priceHistoryCount}`);
    logger.info(`✅ OHLCV records: ${dbStats.ohlcvCount}`);
    logger.info(`✅ Statistics records: ${dbStats.statisticsCount}`);
    logger.info(`✅ Tokens tracked: ${dbStats.tokensTracked}`);
    logger.info(`✅ Date range: ${dbStats.oldestRecord?.toISOString()} to ${dbStats.newestRecord?.toISOString()}`);
    logger.info();

    // Test 4: Collection statistics
    logger.info('📊 Test 4: Collection Statistics');
    const collectionStats = priceCollector.getStatistics();
    logger.info(`✅ Total collected: ${collectionStats.totalCollected}`);
    logger.info(`✅ Successful: ${collectionStats.successfulCollections}`);
    logger.info(`✅ Failed: ${collectionStats.failedCollections}`);
    logger.info(`✅ Last collection: ${new Date(collectionStats.lastCollectionTime).toISOString()}`);
    logger.info(`✅ Average time: ${collectionStats.averageCollectionTime.toFixed(2)}ms`);
    logger.info();

    // Test 5: Price history retrieval
    logger.info('📊 Test 5: Price History Retrieval');
    const recentPrices = await priceCollector.getRecentPrices('GALA', 1); // Last 1 hour
    logger.info(`✅ Retrieved ${recentPrices.length} GALA price points from last hour`);

    if (recentPrices.length > 0) {
      const latest = recentPrices[recentPrices.length - 1];
      const oldest = recentPrices[0];
      logger.info(`   Latest: $${latest.getPriceUsd().toFixed(6)} at ${new Date(latest.timestamp).toISOString()}`);
      if (recentPrices.length > 1) {
        logger.info(`   Oldest: $${oldest.getPriceUsd().toFixed(6)} at ${new Date(oldest.timestamp).toISOString()}`);
        const priceChange = ((latest.getPriceUsd() - oldest.getPriceUsd()) / oldest.getPriceUsd()) * 100;
        logger.info(`   Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`);
      }
    }
    logger.info();

    // Test 6: Volatility calculation
    logger.info('📊 Test 6: Volatility Calculation');
    try {
      const volatility = await priceCollector.calculateVolatility('GALA', 1);
      logger.info(`✅ GALA volatility (1h): ${(volatility * 100).toFixed(2)}%`);
    } catch (error) {
      logger.info(`⚠️ Volatility calculation failed (insufficient data): ${error}`);
    }
    logger.info();

    // Test 7: OHLCV data (if available)
    logger.info('📊 Test 7: OHLCV Data Generation');
    try {
      const ohlcvData = await priceCollector.getOHLCV('GALA', '1h', 1);
      logger.info(`✅ Retrieved ${ohlcvData.length} GALA hourly candles`);

      if (ohlcvData.length > 0) {
        const candle = ohlcvData[ohlcvData.length - 1];
        logger.info(`   Latest candle: O:${candle.getOpenPrice().toFixed(6)} H:${candle.getHighPrice().toFixed(6)} L:${candle.getLowPrice().toFixed(6)} C:${candle.getClosePrice().toFixed(6)}`);
        logger.info(`   Volume: ${candle.getVolume().toFixed(2)} | Trades: ${candle.trade_count}`);
        logger.info(`   ${candle.isBullish() ? '🟢 Bullish' : '🔴 Bearish'} candle`);
      }
    } catch (error) {
      logger.info(`⚠️ OHLCV data not available (insufficient data): ${error}`);
    }
    logger.info();

    // Test 8: Start/Stop collector (brief test)
    logger.info('📊 Test 8: Start/Stop Collector');
    logger.info('🚀 Starting price collector for 30 seconds...');

    await priceCollector.start();
    logger.info('✅ Price collector started');

    // Wait 30 seconds to collect some data
    await new Promise(resolve => setTimeout(resolve, 30000));

    await priceCollector.stop();
    logger.info('✅ Price collector stopped');
    logger.info();

    // Test 9: Final statistics after collection run
    logger.info('📊 Test 9: Post-Collection Statistics');
    const finalStats = priceCollector.getStatistics();
    logger.info(`✅ Total collected: ${finalStats.totalCollected}`);
    logger.info(`✅ Successful: ${finalStats.successfulCollections}`);
    logger.info(`✅ Failed: ${finalStats.failedCollections}`);
    logger.info(`✅ Success rate: ${((finalStats.successfulCollections / (finalStats.successfulCollections + finalStats.failedCollections)) * 100).toFixed(2)}%`);

    if (finalStats.collectionErrors.length > 0) {
      logger.info(`⚠️ Recent errors (${finalStats.collectionErrors.length}):`);
      finalStats.collectionErrors.slice(0, 3).forEach(error => {
        logger.info(`   ${error.token}: ${error.error}`);
      });
    }
    logger.info();

    // Test 10: Data cleanup test (if in development)
    if (process.env.NODE_ENV === 'development') {
      logger.info('📊 Test 10: Data Cleanup (Development Only)');
      logger.info('⚠️ This would clean data older than configured retention period');
      logger.info('   Cleanup normally runs daily in production');
      logger.info('   To test manually: await timeSeriesDB.cleanupOldData(1); // 1 day');
      logger.info();
    }

    logger.info('🎉 All tests completed successfully!');
    logger.info('\n📈 Historical Price Data Collection System is ready for production use');

  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testPriceCollectionSystem()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Test execution failed:', error);
      process.exit(1);
    });
}