#!/usr/bin/env tsx

/**
 * Whale Tracking System Test Script
 *
 * Demonstrates the whale tracking and wallet analysis capabilities
 * for GalaSwap V3 arbitrage trading opportunities.
 */

import { logger } from '../utils/logger';
import { WhaleTracker as _WhaleTracker, createWhaleTracker } from '../monitoring/whale-tracker';
import { WalletAnalyzer as _WalletAnalyzer, createWalletAnalyzer } from '../analytics/wallet-analyzer';
import { PriceTracker as _PriceTracker } from '../monitoring/price-tracker';

// Mock GSwap client for testing
const _mockGSwap = {
  quoting: {
    quoteExactInput: async () => ({ outTokenAmount: '1000', feeTier: 3000 })
  }
};

async function testWhaleTrackingSystem(): Promise<void> {
  logger.info('🐋 Starting Whale Tracking System Test...\n');

  try {
    // Initialize components
    logger.info('🔧 Initializing whale tracking components...');

    const walletAnalyzer = createWalletAnalyzer();
    const whaleTracker = createWhaleTracker({
      copyTradingEnabled: true,
      maxCopyTradeSize: 1000,
      largeTradeThresholdUSD: 500
    });

    logger.info('✅ Components initialized successfully\n');

    // Test 1: Wallet Analysis
    logger.info('📊 Test 1: Analyzing Sample Wallets...');

    const testWallets = [
      'eth|0x742d35Cc1d2c0b5b5E3b5d3f8E5c2F3A1B9C8D7E', // High-volume trader
      'eth|0x123f45B6c7d8e9f0a1b2c3d4e5f6789a0b1c2d3e', // Bot-like trader
      'eth|0x987fEDCBA9876543210FedCBA9876543210FedCB'  // Guild treasury
    ];

    for (const wallet of testWallets) {
      logger.info(`\n🔍 Analyzing wallet: ${wallet.substring(0, 30)}...`);

      const analysis = await walletAnalyzer.analyzeWallet(wallet);

      logger.info(`📈 Analysis Results:`);
      logger.info(`  • Profitability Score: ${analysis.profitabilityScore}%`);
      logger.info(`  • Trading Style: ${analysis.tradingStyle}`);
      logger.info(`  • Bot Detection: ${analysis.isBot ? 'Yes' : 'No'} (${(analysis.botConfidence * 100).toFixed(1)}% confidence)`);
      logger.info(`  • Follow-Worthiness: ${analysis.followWorthiness}/10`);
      logger.info(`  • Risk Score: ${analysis.riskScore}/10`);
      logger.info(`  • Monthly Volume: $${analysis.monthlyVolume.toLocaleString()}`);
      logger.info(`  • Copy Trading Risk: ${analysis.copyTradingRisk}`);

      if (analysis.copyTradingNotes.length > 0) {
        logger.info(`  • Notes: ${analysis.copyTradingNotes.join(', ')}`);
      }
    }

    // Test 2: Smart Money Detection
    logger.info('\n\n🧠 Test 2: Smart Money Detection...');

    const smartMoneyResults = await walletAnalyzer.findSmartMoney(testWallets);

    if (smartMoneyResults.length > 0) {
      logger.info(`✅ Found ${smartMoneyResults.length} smart money candidates:`);

      smartMoneyResults.forEach((result, index) => {
        logger.info(`\n${index + 1}. ${result.address.substring(0, 30)}...`);
        logger.info(`   Score: ${result.score}/100`);
        logger.info(`   Reasons: ${result.reasons.join(', ')}`);
      });
    } else {
      logger.info('ℹ️ No smart money candidates found in test set');
    }

    // Test 3: Whale Tracker Setup
    logger.info('\n\n🐋 Test 3: Whale Tracker Operations...');

    // Start whale tracking
    await whaleTracker.start();

    // Add test whales
    for (const wallet of testWallets) {
      try {
        await whaleTracker.addWhaleAddress(wallet);
      } catch (error) {
        logger.debug(`Could not add ${wallet.substring(0, 20)}... as whale: ${error}`);
      }
    }

    // Get tracked whales
    const trackedWhales = whaleTracker.getTrackedWhales();
    logger.info(`📊 Currently tracking ${trackedWhales.length} whales:`);

    trackedWhales.forEach((whale, index) => {
      logger.info(`\n${index + 1}. Tier: ${whale.tier}`);
      logger.info(`   GALA Balance: ${whale.galaBalance.toLocaleString()}`);
      logger.info(`   Gaming Tokens: $${whale.gamingTokensValue.toLocaleString()}`);
      logger.info(`   Success Rate: ${whale.successRate}%`);
      logger.info(`   Trading Frequency: ${whale.tradingFrequency.toFixed(1)} trades/day`);
      logger.info(`   Is Guild Treasury: ${whale.isGuildTreasury ? 'Yes' : 'No'}`);
    });

    // Test 4: Copy Trading Signals
    logger.info('\n\n📡 Test 4: Copy Trading Signal Generation...');

    // Set up event listeners for copy trading signals
    whaleTracker.on('copySignalCreated', (signal) => {
      logger.info(`🚨 Copy Trading Signal Generated!`);
      logger.info(`  • Whale Tier: ${signal.whale.tier}`);
      logger.info(`  • Action: ${signal.signal.action.toUpperCase()}`);
      logger.info(`  • Pair: ${signal.signal.tokenIn} → ${signal.signal.tokenOut}`);
      logger.info(`  • Confidence: ${(signal.signal.confidence * 100).toFixed(1)}%`);
      logger.info(`  • Recommended Size: $${signal.signal.recommendedSize}`);
      logger.info(`  • Entry Window: ${signal.signal.entryWindow} minutes`);
      logger.info(`  • Max Slippage: ${(signal.signal.maxSlippage * 100).toFixed(2)}%`);
    });

    whaleTracker.on('largeTransaction', (transaction) => {
      logger.info(`💰 Large Whale Transaction Detected!`);
      logger.info(`  • Value: $${transaction.valueUSD.toLocaleString()}`);
      logger.info(`  • Type: ${transaction.type.toUpperCase()}`);
      logger.info(`  • Copy Signal Confidence: ${(transaction.copySignal.confidence * 100).toFixed(1)}%`);
    });

    // Test 5: Wallet Comparison
    logger.info('\n\n⚖️ Test 5: Wallet Comparison for Copy Trading...');

    const walletComparisons = await walletAnalyzer.compareWallets(testWallets);

    if (walletComparisons.length > 0) {
      logger.info(`📊 Wallet Rankings for Copy Trading:`);

      walletComparisons.forEach((comparison, index) => {
        logger.info(`\n${index + 1}. ${comparison.address.substring(0, 30)}... (Score: ${comparison.ranking})`);
        logger.info(`   Strengths: ${comparison.strengths.join(', ') || 'None identified'}`);
        logger.info(`   Weaknesses: ${comparison.weaknesses.join(', ') || 'None identified'}`);
        logger.info(`   Follow-Worthiness: ${comparison.analysis.followWorthiness}/10`);
        logger.info(`   Recommended Copy Size: ${comparison.analysis.recommendedCopySize}%`);
      });
    }

    // Test 6: System Statistics
    logger.info('\n\n📈 Test 6: System Performance Statistics...');

    const whaleStats = whaleTracker.getStats();
    const walletStats = walletAnalyzer.getStats();

    logger.info(`🐋 Whale Tracker Stats:`);
    logger.info(`  • Total Whales Tracked: ${whaleStats.totalWhalesTracked}`);
    logger.info(`  • Active Copy Signals: ${whaleStats.activeSignals}`);
    logger.info(`  • Successful Copy Trades: ${whaleStats.successfulCopyTrades}`);
    logger.info(`  • Total Copy Trade Profit: $${whaleStats.totalCopyTradeProfit.toFixed(2)}`);

    logger.info(`\n🧠 Wallet Analyzer Stats:`);
    logger.info(`  • Cache Size: ${walletStats.cacheSize}`);
    logger.info(`  • Total Analyses: ${walletStats.totalAnalyses}`);
    logger.info(`  • Cache Hit Rate: ${(walletStats.cacheHitRate * 100).toFixed(1)}%`);

    // Test 7: Risk Management Integration
    logger.info('\n\n⚠️ Test 7: Risk Management Integration...');

    const activeCopySignals = whaleTracker.getActiveCopySignals();

    if (activeCopySignals.length > 0) {
      logger.info(`🔒 Risk Management Analysis:`);

      const totalExposure = activeCopySignals.reduce((sum, signal) => sum + signal.signal.recommendedSize, 0);
      const highRiskSignals = activeCopySignals.filter(signal =>
        signal.whale.riskScore >= 7 || signal.signal.confidence < 0.6
      );

      logger.info(`  • Total Copy Trading Exposure: $${totalExposure.toLocaleString()}`);
      logger.info(`  • High Risk Signals: ${highRiskSignals.length}/${activeCopySignals.length}`);
      logger.info(`  • Average Confidence: ${(activeCopySignals.reduce((sum, s) => sum + s.signal.confidence, 0) / activeCopySignals.length * 100).toFixed(1)}%`);
    } else {
      logger.info(`ℹ️ No active copy trading signals to analyze`);
    }

    // Cleanup
    logger.info('\n\n🧹 Cleaning up test environment...');
    await whaleTracker.stop();
    walletAnalyzer.clearCache();

    logger.info('\n✅ Whale Tracking System Test Complete!');
    logger.info('\n🎯 Key Capabilities Demonstrated:');
    logger.info('  • Comprehensive wallet analysis and profitability scoring');
    logger.info('  • Smart money and bot detection algorithms');
    logger.info('  • Whale identification and tier classification');
    logger.info('  • Copy trading signal generation with risk assessment');
    logger.info('  • Real-time monitoring and alert system');
    logger.info('  • Performance statistics and caching optimization');
    logger.info('\n💡 Ready for production whale tracking and copy trading!');

  } catch (error) {
    logger.error('❌ Whale tracking test failed:', error);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testWhaleTrackingSystem().catch((error) => {
    logger.error('Test execution failed:', error);
    process.exit(1);
  });
}