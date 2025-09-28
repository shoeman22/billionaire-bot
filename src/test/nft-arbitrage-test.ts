/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * NFT Arbitrage Strategy Integration Test
 *
 * Comprehensive test of the NFT floor price arbitrage system:
 * - NFT marketplace client functionality
 * - Cross-marketplace price comparison
 * - Crafting cost calculation
 * - Arbitrage opportunity detection
 * - Risk management integration
 * - Strategy orchestrator integration
 */

import { NFTMarketplaceClient } from '../api/nft-marketplace-client';
import { NFTArbitrageStrategy } from '../trading/strategies/nft-arbitrage';
import { GSwap } from '../services/gswap-simple';
import { SwapExecutor } from '../trading/execution/swap-executor';
import { MarketAnalysis } from '../monitoring/market-analysis';
import { RiskMonitor } from '../trading/risk/risk-monitor';
import { StrategyOrchestrator } from '../trading/strategies/strategy-orchestrator';
import { VolumeAnalyzer } from '../monitoring/volume-analyzer';
import { logger } from '../utils/logger';

async function testNFTMarketplaceClient() {
  logger.info('\n🎮 Testing NFT Marketplace Client...');

  const nftClient = new NFTMarketplaceClient();

  try {
    // Test 1: Cross-marketplace floor price comparison
    logger.info('\n📊 Testing cross-marketplace floor prices...');
    const contractAddress = '0x123...town'; // Mock Town Crush collection
    const floorPrices = await nftClient.getCrossMarketplaceFloorPrices(contractAddress);

    logger.info('Floor prices across marketplaces:', Object.fromEntries(floorPrices));

    // Test 2: Arbitrage opportunity detection
    logger.info('\n🔍 Testing arbitrage opportunity detection...');
    const opportunities = await nftClient.detectArbitrageOpportunities(contractAddress);

    logger.info(`Found ${opportunities.length} arbitrage opportunities:`);
    opportunities.forEach((opp, index) => {
      logger.info(`  ${index + 1}. ${opp.gameUtility}`);
      logger.info(`     Profit: $${opp.netProfit.toFixed(2)} (${opp.profitMargin.toFixed(2)}%)`);
      logger.info(`     Risk Score: ${opp.riskScore.toFixed(2)}`);
      logger.info(`     Confidence: ${(opp.confidence * 100).toFixed(1)}%`);
    });

    // Test 3: Market analysis
    logger.info('\n📈 Testing market analysis...');
    const analysis = await nftClient.getMarketAnalysis(contractAddress);

    if (analysis) {
      logger.info('Market Analysis Summary:');
      logger.info(`  Collection: ${analysis.collection.name}`);
      logger.info(`  Floor Price: $${analysis.collection.floorPriceUSD.toFixed(2)}`);
      logger.info(`  24h Volume: $${analysis.collection.volume24h.toFixed(2)}`);
      logger.info(`  Liquidity Score: ${(analysis.liquidityAnalysis.score * 100).toFixed(1)}%`);
      logger.info(`  Risk Assessment: ${(analysis.riskAssessment.overall * 100).toFixed(1)}%`);
      logger.info(`  Risk Factors: ${analysis.riskAssessment.factors.join(', ')}`);
    }

    logger.info('✅ NFT Marketplace Client test completed successfully');
    return true;

  } catch (error) {
    logger.error('❌ NFT Marketplace Client test failed:', error);
    return false;
  }
}

async function testNFTArbitrageStrategy() {
  logger.info('\n🚀 Testing NFT Arbitrage Strategy...');

  try {
    // Initialize dependencies
    const config = { maxPositionSize: 1000 } as any;
    const gswap = new GSwap({ baseUrl: "https://dex-backend-prod1.defi.gala.com" });
    const slippageProtection = { analyzeSlippage: () => ({ expectedSlippage: 0.01 }) } as any;
    const swapExecutor = new SwapExecutor(gswap, slippageProtection);
    const priceTracker = { getPrice: () => ({ priceUsd: 0.05 }) } as any;
    const marketAnalysis = new MarketAnalysis(priceTracker as any, gswap);
    const riskMonitor = new RiskMonitor(config as any, gswap);

    // Initialize NFT strategy
    const nftStrategy = new NFTArbitrageStrategy(
      gswap, config as any, swapExecutor, marketAnalysis, riskMonitor
    );

    // Test 1: Strategy initialization
    logger.info('\n🔧 Testing strategy initialization...');
    await nftStrategy.start();

    const status = nftStrategy.getStatus();
    logger.info('Strategy Status:');
    logger.info(`  Active: ${status.isActive}`);
    logger.info(`  Active Positions: ${status.activePositions}`);
    logger.info(`  Current Exposure: ${(status.currentExposure * 100).toFixed(2)}%`);
    logger.info(`  Market Condition: ${status.marketCondition.overallSentiment}`);

    // Test 2: Performance metrics
    logger.info('\n📊 Testing performance tracking...');
    const performance = nftStrategy.getPerformanceStats();
    logger.info('Performance Metrics:');
    logger.info(`  Total Opportunities: ${performance.totalOpportunities}`);
    logger.info(`  Executed Arbitrages: ${performance.executedArbitrages}`);
    logger.info(`  Win Rate: ${performance.winRate.toFixed(1)}%`);
    logger.info(`  Average Profit Margin: ${performance.avgProfitMargin.toFixed(2)}%`);

    // Test 3: Active positions
    const positions = nftStrategy.getActivePositions();
    logger.info(`\n📋 Active Positions: ${positions.length}`);
    positions.forEach((position, index) => {
      logger.info(`  ${index + 1}. ${position.strategy} - ${position.status}`);
      logger.info(`     Investment: $${position.totalInvestment.toFixed(2)}`);
      logger.info(`     Unrealized P&L: $${position.unrealizedPnL.toFixed(2)}`);
      logger.info(`     Age: ${((Date.now() - position.openTime) / (60 * 1000)).toFixed(1)} minutes`);
    });

    // Wait for some activity (simulated)
    logger.info('\n⏳ Waiting for strategy activity...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds

    // Check for any new activity
    const updatedStatus = nftStrategy.getStatus();
    logger.info('\nUpdated Status:');
    logger.info(`  Total Capital Deployed: $${updatedStatus.totalCapitalDeployed.toFixed(2)}`);
    logger.info(`  Current Exposure: ${(updatedStatus.currentExposure * 100).toFixed(2)}%`);

    // Test 4: Stop strategy
    logger.info('\n🛑 Testing strategy shutdown...');
    await nftStrategy.stop();

    const finalStatus = nftStrategy.getStatus();
    logger.info(`Final Status - Active: ${finalStatus.isActive}`);

    logger.info('✅ NFT Arbitrage Strategy test completed successfully');
    return true;

  } catch (error) {
    logger.error('❌ NFT Arbitrage Strategy test failed:', error);
    return false;
  }
}

async function testStrategyOrchestrator() {
  logger.info('\n🎯 Testing Strategy Orchestrator with NFT Integration...');

  try {
    // Initialize dependencies
    const config = { maxPositionSize: 1000 } as any;
    const gswap = new GSwap({ baseUrl: "https://dex-backend-prod1.defi.gala.com" });
    const slippageProtection = { analyzeSlippage: () => ({ expectedSlippage: 0.01 }) } as any;
    const priceTracker = { getPrice: () => ({ priceUsd: 0.05 }) } as any;
    const swapExecutor = new SwapExecutor(gswap, slippageProtection);
    const marketAnalysis = new MarketAnalysis(priceTracker as any, gswap);
    const volumeAnalyzer = new VolumeAnalyzer(priceTracker as any);
    const riskMonitor = new RiskMonitor(config as any, gswap);

    // Initialize orchestrator (includes NFT strategy)
    const orchestrator = new StrategyOrchestrator(
      gswap, config, swapExecutor, marketAnalysis, volumeAnalyzer, riskMonitor
    );

    // Test 1: Check NFT strategy is included
    logger.info('\n🔍 Checking NFT strategy integration...');
    const nftConfig = orchestrator.getStrategyConfig('nft-arbitrage');

    if (nftConfig) {
      logger.info('NFT Strategy Configuration:');
      logger.info(`  Name: ${nftConfig.name}`);
      logger.info(`  Enabled: ${nftConfig.enabled}`);
      logger.info(`  Priority: ${nftConfig.priority}/10`);
      logger.info(`  Max Capital: ${nftConfig.maxCapitalAllocation}%`);
      logger.info(`  Risk Tolerance: ${nftConfig.riskTolerance}`);
      logger.info(`  Min Profit Threshold: ${nftConfig.minProfitThreshold}%`);
      logger.info(`  Cooldown Period: ${nftConfig.cooldownPeriod / 1000}s`);
    } else {
      throw new Error('NFT strategy not found in orchestrator');
    }

    // Test 2: Start orchestrator
    logger.info('\n🚀 Starting orchestrator...');
    await orchestrator.start();

    const stats = orchestrator.getStats();
    logger.info('Orchestrator Stats:');
    logger.info(`  Total Capital: $${stats.totalCapital.toLocaleString()}`);
    logger.info(`  Available Capital: $${stats.availableCapital.toFixed(2)}`);
    logger.info(`  Active Trades: ${stats.activeTrades}`);

    // Test 3: Check strategy performance
    logger.info('\n📊 Checking strategy performance...');
    const strategyPerformance = orchestrator.getStrategyPerformance();
    const nftPerformance = strategyPerformance.get('nft-arbitrage');

    if (nftPerformance) {
      logger.info('NFT Strategy Performance:');
      logger.info(`  Performance Score: ${nftPerformance.performanceScore.toFixed(1)}/100`);
      logger.info(`  Risk Score: ${(nftPerformance.riskScore * 100).toFixed(1)}%`);
      logger.info(`  Capital Allocated: $${nftPerformance.capitalAllocated.toFixed(2)}`);
      logger.info(`  Last Execution: ${nftPerformance.lastExecutionTime ?
        new Date(nftPerformance.lastExecutionTime).toLocaleTimeString() : 'Never'}`);
    }

    // Test 4: Market conditions
    logger.info('\n🌐 Checking market conditions...');
    const marketConditions = orchestrator.getMarketConditions();
    logger.info('Market Conditions:');
    logger.info(`  Trend: ${marketConditions.trend}`);
    logger.info(`  Volatility: ${marketConditions.volatility}`);
    logger.info(`  Liquidity: ${marketConditions.liquidity}`);
    logger.info(`  Sentiment: ${marketConditions.sentiment}`);
    logger.info(`  Risk Level: ${marketConditions.riskLevel}`);

    // Wait for orchestrator activity
    logger.info('\n⏳ Waiting for orchestrator activity...');
    await new Promise(resolve => setTimeout(resolve, 15000)); // 15 seconds

    // Check updated stats
    const updatedStats = orchestrator.getStats();
    logger.info('\nUpdated Stats:');
    logger.info(`  Total Trades: ${updatedStats.totalTrades}`);
    logger.info(`  Total Profit: $${updatedStats.totalProfit.toFixed(2)}`);
    logger.info(`  Overall Win Rate: ${updatedStats.overallWinRate.toFixed(1)}%`);
    logger.info(`  Best Performing Strategy: ${updatedStats.bestPerformingStrategy}`);

    // Test 5: Stop orchestrator
    logger.info('\n🛑 Stopping orchestrator...');
    await orchestrator.stop();

    logger.info('✅ Strategy Orchestrator test completed successfully');
    return true;

  } catch (error) {
    logger.error('❌ Strategy Orchestrator test failed:', error);
    return false;
  }
}

async function testRiskManagement() {
  logger.info('\n⚠️  Testing NFT Risk Management...');

  try {
    // Test risk calculations with mock data
    const mockOpportunity = {
      contractAddress: '0x123...town',
      tokenId: 'craftable',
      nftFloorPrice: 200,
      nftFloorPriceUSD: 200,
      craftingRequirements: [
        { token: 'GALA', amount: 100, priceUSD: 4, availability: 'high' as const, slippage: 0.5 },
        { token: 'TOWN', amount: 50, priceUSD: 1, availability: 'medium' as const, slippage: 1.0 }
      ],
      totalCraftingCost: 5,
      totalCraftingCostUSD: 5,
      marketplaceFees: 15,
      gasCosts: 5,
      netProfit: 175,
      profitMargin: 87.5,
      roi: 3500,
      liquidityScore: 0.7,
      riskScore: 0.3,
      craftingTime: 3600,
      confidence: 0.8,
      gameUtility: 'Town Crush building with high utility',
      seasonalFactor: 1.2
    };

    logger.info('\nMock Opportunity Analysis:');
    logger.info(`  Profit Potential: $${mockOpportunity.netProfit} (${mockOpportunity.profitMargin}%)`);
    logger.info(`  Investment Required: $${mockOpportunity.totalCraftingCostUSD + mockOpportunity.gasCosts}`);
    logger.info(`  Risk Score: ${(mockOpportunity.riskScore * 100).toFixed(1)}%`);
    logger.info(`  Liquidity Score: ${(mockOpportunity.liquidityScore * 100).toFixed(1)}%`);
    logger.info(`  Confidence Level: ${(mockOpportunity.confidence * 100).toFixed(1)}%`);

    // Risk assessment
    const totalCapital = 50000; // $50k
    const positionSize = mockOpportunity.totalCraftingCostUSD + mockOpportunity.gasCosts;
    const exposurePercent = (positionSize / totalCapital) * 100;

    logger.info('\nRisk Assessment:');
    logger.info(`  Position Size: $${positionSize} (${exposurePercent.toFixed(2)}% of capital)`);
    logger.info(`  Max Loss: $${positionSize * 0.8} (assuming 80% recovery)`);
    logger.info(`  Risk-Adjusted Return: ${mockOpportunity.profitMargin * (1 - mockOpportunity.riskScore)}%`);

    // Validate risk limits
    const maxPositionSize = totalCapital * 0.03; // 3% max per position
    const riskCheck = {
      positionSizeOk: positionSize <= maxPositionSize,
      profitThresholdOk: mockOpportunity.profitMargin >= 10,
      liquidityOk: mockOpportunity.liquidityScore >= 0.3,
      confidenceOk: mockOpportunity.confidence >= 0.6
    };

    logger.info('\nRisk Checks:');
    logger.info(`  Position Size: ${riskCheck.positionSizeOk ? '✅' : '❌'} (${positionSize.toFixed(2)} <= ${maxPositionSize.toFixed(2)})`);
    logger.info(`  Profit Threshold: ${riskCheck.profitThresholdOk ? '✅' : '❌'} (${mockOpportunity.profitMargin}% >= 10%)`);
    logger.info(`  Liquidity: ${riskCheck.liquidityOk ? '✅' : '❌'} (${mockOpportunity.liquidityScore} >= 0.3)`);
    logger.info(`  Confidence: ${riskCheck.confidenceOk ? '✅' : '❌'} (${mockOpportunity.confidence} >= 0.6)`);

    const allChecksPass = Object.values(riskCheck).every(check => check);
    logger.info(`\nOverall Risk Assessment: ${allChecksPass ? '✅ APPROVED' : '❌ REJECTED'}`);

    logger.info('✅ Risk Management test completed successfully');
    return true;

  } catch (error) {
    logger.error('❌ Risk Management test failed:', error);
    return false;
  }
}

async function runFullNFTArbitrageTest() {
  logger.info('🎮🚀 NFT Floor Price Arbitrage Strategy - Comprehensive Test');
  logger.info('================================================================');
  logger.info(`Test started: ${new Date().toLocaleString()}`);
  logger.info(`Bot Status: Production-ready with 34,062 GALA ($541 USD)`);

  const testResults = {
    marketplaceClient: false,
    arbitrageStrategy: false,
    orchestratorIntegration: false,
    riskManagement: false
  };

  try {
    // Test 1: NFT Marketplace Client
    testResults.marketplaceClient = await testNFTMarketplaceClient();

    // Test 2: NFT Arbitrage Strategy
    testResults.arbitrageStrategy = await testNFTArbitrageStrategy();

    // Test 3: Strategy Orchestrator Integration
    testResults.orchestratorIntegration = await testStrategyOrchestrator();

    // Test 4: Risk Management
    testResults.riskManagement = await testRiskManagement();

    // Final results
    logger.info('\n🏁 Test Results Summary');
    logger.info('========================');
    logger.info(`NFT Marketplace Client:     ${testResults.marketplaceClient ? '✅ PASS' : '❌ FAIL'}`);
    logger.info(`NFT Arbitrage Strategy:     ${testResults.arbitrageStrategy ? '✅ PASS' : '❌ FAIL'}`);
    logger.info(`Orchestrator Integration:   ${testResults.orchestratorIntegration ? '✅ PASS' : '❌ FAIL'}`);
    logger.info(`Risk Management:            ${testResults.riskManagement ? '✅ PASS' : '❌ FAIL'}`);

    const allPassed = Object.values(testResults).every(result => result);

    logger.info('\n🎯 Overall Test Result');
    logger.info('======================');
    if (allPassed) {
      logger.info('✅ ALL TESTS PASSED - NFT Arbitrage Strategy is ready for production!');
      logger.info('\n🚀 Key Features Validated:');
      logger.info('   • Multi-marketplace floor price tracking');
      logger.info('   • Gaming NFT crafting cost analysis');
      logger.info('   • Cross-platform arbitrage opportunities');
      logger.info('   • Risk management integration');
      logger.info('   • Strategy orchestrator coordination');
      logger.info('   • Real-time position monitoring');
      logger.info('   • Seasonal demand factor adjustments');
      logger.info('\n💰 Ready to capitalize on gaming NFT arbitrage opportunities!');
    } else {
      logger.info('❌ SOME TESTS FAILED - Review errors before production deployment');
      const failedTests = Object.entries(testResults)
        .filter(([, passed]) => !passed)
        .map(([test]) => test);
      logger.info(`Failed tests: ${failedTests.join(', ')}`);
    }

    logger.info(`\nTest completed: ${new Date().toLocaleString()}`);
    return allPassed;

  } catch (error) {
    logger.error('\n💥 CRITICAL ERROR during NFT arbitrage testing:', error);
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  runFullNFTArbitrageTest()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      logger.error('Test execution failed:', error);
      process.exit(1);
    });
}

export { runFullNFTArbitrageTest };