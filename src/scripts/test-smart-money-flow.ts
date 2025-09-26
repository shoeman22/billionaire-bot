/**
 * Smart Money Flow Analysis Test Script
 *
 * Tests the Smart Money Tracker and Profitable Wallets Monitor
 * with real-time copy-trading signal generation and portfolio allocation.
 */

import { logger } from '../utils/logger';
import { createSmartMoneyTracker } from '../analytics/smart-money-tracker';
import { createProfitableWalletsMonitor } from '../monitoring/profitable-wallets';

async function testSmartMoneyFlowAnalysis(): Promise<void> {
  logger.info('🚀 Starting Smart Money Flow Analysis Test...');

  try {
    // Initialize services with $50k test risk budget
    const smartMoneyTracker = createSmartMoneyTracker();
    const profitableWalletsMonitor = createProfitableWalletsMonitor(50000);

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 1: Analyze known whale wallets for smart money characteristics
    logger.info('\n📊 Test 1: Smart Money Analysis');
    const testWallets = [
      'client|64f8caf887fd8551315d8509', // Dominant whale
      'client|604161f025e6931a676ccf37', // Secondary whale
      'eth|0628E50F2338762eCaCCC53506c33bcb5327C964' // ETH whale
    ];

    for (const walletAddress of testWallets) {
      try {
        logger.info('🔍 Analyzing wallet: ' + walletAddress.substring(0, 12) + '...');
        const profile = await smartMoneyTracker.analyzeWallet(walletAddress);
        
        logger.info('✅ Smart Money Profile:', {
          wallet: walletAddress.substring(0, 12),
          tier: profile.tier,
          smartMoneyIndex: profile.smartMoneyIndex.toFixed(1),
          winRate: (profile.metrics.winRate * 100).toFixed(1) + '%',
          sharpeRatio: profile.metrics.sharpeRatio.toFixed(2),
          copyTradingScore: profile.copyTradingScore.toFixed(1),
          tradingStyle: profile.tradingStyle,
          specialization: {
            tokens: profile.specialization.tokens.slice(0, 3),
            strengths: profile.specialization.strengths
          },
          riskProfile: {
            maxDrawdown: (profile.riskProfile.drawdownRecovery) + ' days',
            riskPerTrade: profile.riskProfile.riskPerTrade.toFixed(2)
          }
        });

        // Add qualified wallets to monitoring
        if (profile.tier !== 'unqualified' && profile.minimumTrackingPeriod) {
          await profitableWalletsMonitor.addWalletToMonitoring(walletAddress, 'high');
          logger.info('📡 Added to profitable wallet monitoring');
        }

      } catch (error) {
        logger.warn('⚠️ Skipped wallet ' + walletAddress.substring(0, 12) + ': ' + (error as Error).message);
      }
    }

    // Test 2: Smart Money Rankings
    logger.info('\n🏆 Test 2: Smart Money Rankings');
    const rankings = smartMoneyTracker.getSmartMoneyRankings('skilled_retail');
    logger.info('Smart Money Rankings (Top 5):', {
      totalProfiles: rankings.length,
      top5: rankings.slice(0, 5).map(p => ({
        wallet: p.walletAddress.substring(0, 12),
        tier: p.tier,
        index: p.smartMoneyIndex.toFixed(1),
        copyScore: p.copyTradingScore.toFixed(1)
      }))
    });

    // Test 3: Copy Trading Candidates
    logger.info('\n🎯 Test 3: Copy Trading Candidates');
    const candidates = smartMoneyTracker.getCopyTradingCandidates(60);
    logger.info('Copy Trading Candidates:', {
      totalCandidates: candidates.length,
      highConfidence: candidates.filter(c => c.confidence === 'high').length,
      mediumConfidence: candidates.filter(c => c.confidence === 'medium').length,
      candidates: candidates.slice(0, 3).map(c => ({
        wallet: c.profile.walletAddress.substring(0, 12),
        confidence: c.confidence,
        allocation: c.recommendedAllocation + '%',
        tier: c.profile.tier
      }))
    });

    // Test 4: Portfolio Allocation
    logger.info('\n💼 Test 4: Portfolio Allocation');
    const allocation = profitableWalletsMonitor.updatePortfolioAllocation();
    logger.info('Portfolio Allocation:', {
      totalBudget: allocation.totalRiskBudget,
      allocated: allocation.allocatedAmount,
      available: allocation.availableAmount,
      utilizationRate: ((allocation.allocatedAmount / allocation.totalRiskBudget) * 100).toFixed(1) + '%',
      highConfidenceAllocations: allocation.highConfidenceAllocations.length,
      mediumConfidenceAllocations: allocation.mediumConfidenceAllocations.length,
      rebalanceNeeded: allocation.rebalanceNeeded
    });

    // Show top allocations
    const topAllocations = [
      ...allocation.highConfidenceAllocations.slice(0, 2),
      ...allocation.mediumConfidenceAllocations.slice(0, 2)
    ];
    
    if (topAllocations.length > 0) {
      logger.info('Top Allocations:', topAllocations.map(a => ({
        wallet: a.walletAddress.substring(0, 12),
        allocation: '$' + a.allocation.toFixed(0),
        reasoning: a.reasoning.substring(0, 100) + '...'
      })));
    }

    // Test 5: Smart Money Flow Analysis
    logger.info('\n🌊 Test 5: Smart Money Flow Analysis');
    const smartMoneyFlow = profitableWalletsMonitor.analyzeSmartMoneyFlow('4h');
    logger.info('Smart Money Flow (4h):', {
      direction: smartMoneyFlow.direction,
      netFlow: '$' + smartMoneyFlow.netFlow.toLocaleString(),
      institutionalFlow: '$' + smartMoneyFlow.institutionalFlow.toLocaleString(),
      professionalFlow: '$' + smartMoneyFlow.professionalFlow.toLocaleString(),
      retailFlow: '$' + smartMoneyFlow.retailFlow.toLocaleString(),
      marketSentiment: smartMoneyFlow.marketSentiment,
      flowAcceleration: smartMoneyFlow.flowAcceleration.toFixed(0),
      convergenceScore: smartMoneyFlow.convergenceScore.toFixed(1),
      topTokenFlows: smartMoneyFlow.tokenFlows.slice(0, 3).map(tf => ({
        token: tf.token,
        flow: '$' + tf.flow.toLocaleString(),
        participants: tf.participantCount
      }))
    });

    // Test 6: Monitored Wallets Status
    logger.info('\n📊 Test 6: Monitored Wallets Status');
    const monitoredWallets = profitableWalletsMonitor.getMonitoredWalletsStatus();
    logger.info('Monitored Wallets:', {
      totalMonitored: monitoredWallets.length,
      activeWallets: monitoredWallets.filter(w => w.isActive).length,
      topWallets: monitoredWallets.slice(0, 3).map(w => ({
        wallet: w.walletAddress.substring(0, 12),
        tier: w.profile.tier,
        smartIndex: w.profile.smartMoneyIndex.toFixed(1),
        isActive: w.isActive,
        recentSignals: w.recentSignals
      }))
    });

    // Test 7: Active Copy Trading Signals
    logger.info('\n🚨 Test 7: Active Copy Trading Signals');
    const activeSignals = profitableWalletsMonitor.getActiveCopyTradingSignals('medium');
    logger.info('Active Copy Trading Signals:', {
      totalActive: activeSignals.length,
      highConfidence: activeSignals.filter(s => s.confidence === 'high').length,
      immediateUrgency: activeSignals.filter(s => s.urgency === 'immediate').length,
      recentSignals: activeSignals.slice(0, 2).map(s => ({
        wallet: s.walletAddress.substring(0, 12),
        type: s.signalType,
        confidence: s.confidence,
        score: s.confidenceScore,
        action: s.recommendedAction,
        volume: '$' + s.volume.toLocaleString(),
        allocation: s.allocationPercentage + '%'
      }))
    });

    // Test 8: Service Statistics
    logger.info('\n📈 Test 8: Service Statistics');
    const smartMoneyStats = smartMoneyTracker.getStats();
    const profitableWalletsStats = profitableWalletsMonitor.getStats();
    
    logger.info('Smart Money Tracker Stats:', {
      totalProfiles: smartMoneyStats.totalProfiles,
      institutional: smartMoneyStats.institutionalCount,
      professional: smartMoneyStats.professionalCount,
      skilledRetail: smartMoneyStats.skilledRetailCount,
      copyTradingCandidates: smartMoneyStats.copyTradingCandidates,
      avgSmartMoneyIndex: smartMoneyStats.avgSmartMoneyIndex.toFixed(1)
    });
    
    logger.info('Profitable Wallets Monitor Stats:', {
      monitoredWallets: profitableWalletsStats.monitoredWallets,
      activeWallets: profitableWalletsStats.activeWallets,
      activeSignals: profitableWalletsStats.activeSignals,
      recentSignals: profitableWalletsStats.recentSignals,
      totalAllocation: '$' + profitableWalletsStats.totalAllocation.toFixed(0),
      availableBudget: '$' + profitableWalletsStats.availableBudget.toFixed(0)
    });

    logger.info('\n✅ Smart Money Flow Analysis Test completed successfully!');

    // Performance Summary
    logger.info('\n🎯 Performance Summary:', {
      smartMoneyProfiles: smartMoneyStats.totalProfiles,
      qualifiedTraders: smartMoneyStats.copyTradingCandidates,
      monitoredWallets: profitableWalletsStats.monitoredWallets,
      portfolioUtilization: ((profitableWalletsStats.totalAllocation / 50000) * 100).toFixed(1) + '%',
      activeSignalGeneration: profitableWalletsStats.activeSignals > 0 ? 'Working' : 'Standby',
      smartMoneyFlowDirection: smartMoneyFlow.direction,
      systemStatus: 'Operational'
    });

    // Cleanup
    profitableWalletsMonitor.shutdown();

  } catch (error) {
    logger.error('❌ Smart Money Flow Analysis Test failed:', error);
    throw error;
  }
}

// Execute test
if (require.main === module) {
  testSmartMoneyFlowAnalysis()
    .then(() => {
      logger.info('🎉 Test script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Test script failed:', error);
      process.exit(1);
    });
}

export { testSmartMoneyFlowAnalysis };
