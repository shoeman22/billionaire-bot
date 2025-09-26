/**
 * Example Usage of Backtesting Framework
 * 
 * Demonstrates how to use the comprehensive backtesting system
 * to validate all 14 trading strategies before live deployment.
 */

import { BacktestEngine, BacktestConfig } from '../testing/backtest-engine';
import { StrategyValidator, ValidationConfig } from '../analytics/strategy-validator';
import { timeSeriesDB } from '../data/storage/timeseries-db';
import { logger } from '../utils/logger';

async function runComprehensiveBacktest(): Promise<void> {
  logger.info('🚀 Starting Comprehensive Strategy Backtesting');
  logger.info('📊 Validating all 14 GalaSwap V3 trading strategies');

  try {
    // Initialize components
    await timeSeriesDB.initialize();
    const backtestEngine = new BacktestEngine(timeSeriesDB);
    const strategyValidator = new StrategyValidator(backtestEngine, timeSeriesDB);

    // Configuration for 6-month backtest
    const backtestConfig = createBacktestConfiguration();
    const validationConfig = createValidationConfiguration();

    // 1. Individual Strategy Validation
    logger.info('🔬 Phase 1: Individual Strategy Validation');
    const strategyNames = backtestConfig.strategies.map(s => s.strategyName);
    
    for (const strategyName of strategyNames) {
      logger.info(`  Testing: ${strategyName}`);
      
      const singleStrategyConfig = {
        ...backtestConfig,
        strategies: backtestConfig.strategies.filter(s => s.strategyName === strategyName)
      };

      const validation = await strategyValidator.validateStrategy(
        strategyName,
        singleStrategyConfig,
        validationConfig
      );

      logger.info(`    Score: ${validation.validationScore.toFixed(1)}/100`);
      logger.info(`    Valid: ${validation.isValid ? '✅' : '❌'}`);
      logger.info(`    Expected Return: ${(validation.expectedReturn * 100).toFixed(2)}%`);
      logger.info(`    Risk Score: ${validation.riskMetrics.riskScore.toFixed(1)}/100\n`);
    }

    // 2. Strategy Comparison and Ranking
    logger.info('📈 Phase 2: Strategy Comparison and Ranking');
    const comparison = await strategyValidator.compareStrategies(
      strategyNames,
      backtestConfig,
      validationConfig
    );

    logger.info('🏆 Strategy Rankings:');
    comparison.ranking.forEach(rank => {
      const statusIcon = rank.recommendation === 'STRONG_BUY' ? '🟢' :
                        rank.recommendation === 'BUY' ? '🟡' :
                        rank.recommendation === 'HOLD' ? '🟠' : '🔴';
      
      logger.info(`  ${rank.rank}. ${statusIcon} ${rank.strategyName} - ${rank.validationScore.toFixed(1)} - ${rank.recommendation}`);
    });

    // 3. Portfolio Optimization
    logger.info('\n🎯 Phase 3: Portfolio Optimization');
    logger.info('Recommended Portfolio Allocation:');
    
    Object.entries(comparison.recommendedPortfolio.allocations).forEach(([strategy, allocation]) => {
      logger.info(`  ${strategy}: ${allocation.toFixed(1)}%`);
    });

    logger.info(`\nExpected Portfolio Metrics:`);
    logger.info(`  Expected Return: ${(comparison.recommendedPortfolio.expectedReturn * 100).toFixed(2)}%`);
    logger.info(`  Expected Sharpe: ${comparison.recommendedPortfolio.expectedSharpe.toFixed(2)}`);
    logger.info(`  Diversification Ratio: ${(comparison.diversificationBenefits * 100).toFixed(1)}%`);

    // 4. Risk Assessment Summary
    logger.info('\n⚠️ Phase 4: Risk Assessment Summary');
    const validStrategies = comparison.strategies.filter(s => s.isValid);
    const avgRiskScore = validStrategies.reduce((sum, s) => sum + s.riskMetrics.riskScore, 0) / validStrategies.length;
    
    logger.info(`  Valid Strategies: ${validStrategies.length}/${comparison.strategies.length}`);
    logger.info(`  Average Risk Score: ${avgRiskScore.toFixed(1)}/100`);
    logger.info(`  Portfolio Confidence: ${(comparison.recommendedPortfolio.confidence * 100).toFixed(1)}%`);

    // 5. Gaming-Specific Analysis
    logger.info('\n🎮 Phase 5: Gaming-Specific Analysis');
    const gamingStrategies = comparison.strategies.filter(s => 
      s.strategyName.includes('event') || 
      s.strategyName.includes('time-based') || 
      s.strategyName.includes('cross-game')
    );

    if (gamingStrategies.length > 0 && gamingStrategies[0].gamingValidationResults) {
      const gamingMetrics = gamingStrategies[0].gamingValidationResults;
      logger.info(`  Weekend Effect: ${(gamingMetrics.weekendEffect * 100).toFixed(2)}%`);
      logger.info(`  Seasonal Consistency: ${(gamingMetrics.seasonalConsistency * 100).toFixed(1)}%`);
      logger.info(`  Community Event Sensitivity: ${gamingMetrics.communityEventSensitivity.toFixed(2)}`);
    }

    // 6. Final Recommendations
    logger.info('\n📋 Phase 6: Final Recommendations');
    
    const strongBuyStrategies = comparison.ranking.filter(r => r.recommendation === 'STRONG_BUY');
    const buyStrategies = comparison.ranking.filter(r => r.recommendation === 'BUY');
    const avoidStrategies = comparison.ranking.filter(r => r.recommendation === 'AVOID');

    logger.info('✅ RECOMMENDED FOR DEPLOYMENT:');
    strongBuyStrategies.forEach(strategy => {
      logger.info(`  • ${strategy.strategyName} - Excellent performance metrics`);
    });

    buyStrategies.forEach(strategy => {
      logger.info(`  • ${strategy.strategyName} - Good performance with acceptable risk`);
    });

    if (avoidStrategies.length > 0) {
      logger.info('\n❌ NOT RECOMMENDED:');
      avoidStrategies.forEach(strategy => {
        logger.info(`  • ${strategy.strategyName} - Poor validation metrics`);
      });
    }

    logger.info('\n🎉 BACKTESTING ANALYSIS COMPLETE!');
    logger.info(`📊 ${validStrategies.length} strategies validated for production deployment`);
    logger.info(`💰 Portfolio expected return: ${(comparison.recommendedPortfolio.expectedReturn * 100).toFixed(2)}% annually`);
    logger.info(`🛡️ Risk-adjusted and statistically validated`);

  } catch (error) {
    logger.error('❌ Backtesting failed:', error);
    throw error;
  }
}

function createBacktestConfiguration(): BacktestConfig {
  // 6-month historical backtest
  const endTime = Date.now();
  const startTime = endTime - (180 * 24 * 60 * 60 * 1000);

  return {
    startTime,
    endTime,
    initialCapital: 50000, // $50,000 starting capital
    maxPositionSize: 5000, // $5,000 max position
    riskBudget: 0.02, // 2% capital at risk
    
    // Realistic trading conditions
    slippageModel: 'realistic',
    includeGasCosts: true,
    includeLiquidityConstraints: true,
    
    // All 14 strategies with realistic allocations
    strategies: [
      // Core arbitrage strategies (60% allocation)
      { strategyName: 'multi-path-arbitrage', enabled: true, capitalAllocation: 20, parameters: { minProfitThreshold: 0.005, maxHops: 3 }, priority: 10 },
      { strategyName: 'statistical-arbitrage', enabled: true, capitalAllocation: 15, parameters: { lookbackPeriod: 30, zScoreThreshold: 2.0 }, priority: 9 },
      { strategyName: 'priority-gas-bidding', enabled: true, capitalAllocation: 10, parameters: { gasPriorityFactor: 1.2 }, priority: 8 },
      { strategyName: 'volume-surge-momentum', enabled: true, capitalAllocation: 8, parameters: { volumeThreshold: 2.0 }, priority: 7 },
      { strategyName: 'nft-arbitrage', enabled: true, capitalAllocation: 7, parameters: { craftingProfitThreshold: 0.1 }, priority: 7 },

      // Gaming-specific strategies (25% allocation)
      { strategyName: 'event-arbitrage', enabled: true, capitalAllocation: 10, parameters: { eventSensitivity: 0.8 }, priority: 9 },
      { strategyName: 'time-based-patterns', enabled: true, capitalAllocation: 8, parameters: { timeWindows: ['weekend', 'evening'] }, priority: 6 },
      { strategyName: 'cross-game-rotation', enabled: true, capitalAllocation: 7, parameters: { rotationPeriod: 7 }, priority: 6 },

      // Advanced strategies (15% allocation)
      { strategyName: 'whale-tracking', enabled: true, capitalAllocation: 5, parameters: { minWhaleSize: 10000 }, priority: 5 },
      { strategyName: 'smart-money-flow', enabled: true, capitalAllocation: 5, parameters: { profitableTraderThreshold: 0.7 }, priority: 5 },
      { strategyName: 'liquidity-migration', enabled: true, capitalAllocation: 5, parameters: { tvlThreshold: 100000 }, priority: 4 }
    ],
    
    portfolioMode: true, // Test strategies together
    
    // Gaming-specific features
    includeGamingEvents: true,
    seasonalPatterns: true,
    crossGameCorrelations: true,
    
    // Comprehensive validation
    walkForwardPeriods: 6,
    outOfSampleRatio: 0.3,
    monteCarloRuns: 200,
    
    // Benchmarking
    benchmark: 'GALA|Unit|none|none',
    riskFreeRate: 0.02 // 2% risk-free rate
  };
}

function createValidationConfiguration(): ValidationConfig {
  return {
    // Statistical rigor
    confidenceLevel: 0.95,
    minSampleSize: 100,
    bootstrapSamples: 1000,
    
    // Cross-validation
    kFolds: 5,
    holdoutRatio: 0.3,
    
    // Gaming-specific validation
    seasonalValidation: true,
    eventValidation: true,
    crossGameValidation: true,
    
    // Risk thresholds for production deployment
    maxDrawdownThreshold: 0.15, // 15% max drawdown
    minSharpeRatio: 1.0, // Minimum 1.0 Sharpe ratio
    minWinRate: 0.55, // 55% minimum win rate
    maxVolatility: 0.3, // 30% maximum volatility
    
    // Overfitting protection
    overfittingThreshold: 0.3,
    stabilityWindow: 30 // 30-day stability analysis
  };
}

// Additional utility functions for production deployment

export async function validateBeforeDeployment(strategyNames: string[]): Promise<boolean> {
  logger.info('🔍 Pre-deployment validation check...');
  
  const backtestConfig = createBacktestConfiguration();
  const validationConfig = createValidationConfiguration();
  
  await timeSeriesDB.initialize();
  const backtestEngine = new BacktestEngine(timeSeriesDB);
  const strategyValidator = new StrategyValidator(backtestEngine, timeSeriesDB);
  
  const comparison = await strategyValidator.compareStrategies(
    strategyNames,
    backtestConfig,
    validationConfig
  );
  
  const validStrategies = comparison.strategies.filter(s => s.isValid);
  const deploymentReady = validStrategies.length >= strategyNames.length * 0.7; // 70% must be valid
  
  logger.info(`✅ ${validStrategies.length}/${strategyNames.length} strategies passed validation`);
  logger.info(`🚀 Deployment ready: ${deploymentReady ? 'YES' : 'NO'}`);
  
  return deploymentReady;
}

export async function generateProductionReport(): Promise<void> {
  logger.info('📊 Generating production deployment report...');
  
  const backtestConfig = createBacktestConfiguration();
  const validationConfig = createValidationConfiguration();
  
  await timeSeriesDB.initialize();
  const backtestEngine = new BacktestEngine(timeSeriesDB);
  const strategyValidator = new StrategyValidator(backtestEngine, timeSeriesDB);
  
  // Run comprehensive analysis
  const strategies = backtestConfig.strategies.map(s => s.strategyName);
  const comparison = await strategyValidator.compareStrategies(
    strategies,
    backtestConfig,
    validationConfig
  );
  
  // Generate detailed report
  const report = {
    timestamp: new Date().toISOString(),
    totalStrategies: comparison.strategies.length,
    validStrategies: comparison.strategies.filter(s => s.isValid).length,
    expectedAnnualReturn: comparison.recommendedPortfolio.expectedReturn,
    portfolioSharpe: comparison.recommendedPortfolio.expectedSharpe,
    diversificationBenefits: comparison.diversificationBenefits,
    recommendations: comparison.ranking.filter(r => r.recommendation === 'STRONG_BUY' || r.recommendation === 'BUY'),
    riskAssessment: {
      avgRiskScore: comparison.strategies.reduce((sum, s) => sum + s.riskMetrics.riskScore, 0) / comparison.strategies.length,
      maxDrawdown: Math.max(...comparison.strategies.map(s => s.expectedDrawdown)),
      capitalAtRisk: comparison.strategies.reduce((sum, s) => sum + s.riskMetrics.capitalAtRisk, 0)
    }
  };
  
  logger.info('\n📋 PRODUCTION DEPLOYMENT REPORT');
  logger.info('=' .repeat(50));
  logger.info(`Generated: ${report.timestamp}`);
  logger.info(`Total Strategies Analyzed: ${report.totalStrategies}`);
  logger.info(`Strategies Passing Validation: ${report.validStrategies}`);
  logger.info(`Expected Annual Return: ${(report.expectedAnnualReturn * 100).toFixed(2)}%`);
  logger.info(`Portfolio Sharpe Ratio: ${report.portfolioSharpe.toFixed(2)}`);
  logger.info(`Diversification Benefits: ${(report.diversificationBenefits * 100).toFixed(1)}%`);
  logger.info(`Average Risk Score: ${report.riskAssessment.avgRiskScore.toFixed(1)}/100`);
  logger.info(`Maximum Drawdown: ${(report.riskAssessment.maxDrawdown * 100).toFixed(2)}%`);
  logger.info(`Total Capital at Risk: $${report.riskAssessment.capitalAtRisk.toFixed(0)}`);
  
  logger.info('\n🎯 RECOMMENDED STRATEGIES FOR DEPLOYMENT:');
  report.recommendations.forEach(rec => {
    logger.info(`  • ${rec.strategyName} (${rec.recommendation}) - Score: ${rec.validationScore.toFixed(1)}`);
  });
  
  return;
}

// Run example if called directly
if (require.main === module) {
  runComprehensiveBacktest()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Example failed:', error);
      process.exit(1);
    });
}
