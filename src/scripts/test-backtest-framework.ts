/**
 * Test Script for Backtesting Framework
 *
 * Comprehensive testing of the backtesting engine and strategy validator
 * with realistic GalaSwap V3 trading scenarios and gaming token considerations.
 */

import { BacktestEngine, BacktestConfig, StrategyBacktestConfig } from '../testing/backtest-engine';
import { StrategyValidator, ValidationConfig } from '../analytics/strategy-validator';
import { timeSeriesDB } from '../data/storage/timeseries-db';
import { logger } from '../utils/logger';

async function testBacktestingFramework(): Promise<void> {
  logger.info('🚀 Starting comprehensive backtesting framework test...');

  try {
    // Initialize components
    await timeSeriesDB.initialize();
    const backtestEngine = new BacktestEngine(timeSeriesDB);
    const strategyValidator = new StrategyValidator(backtestEngine, timeSeriesDB);

    // Test configuration
    const testConfig = await createTestConfiguration();
    const validationConfig = createValidationConfiguration();

    // 1. Test individual strategy backtesting
    await testIndividualStrategyBacktest(backtestEngine, testConfig);

    // 2. Test portfolio-level backtesting
    await testPortfolioBacktest(backtestEngine, testConfig);

    // 3. Test strategy validation
    await testStrategyValidation(strategyValidator, testConfig, validationConfig);

    // 4. Test strategy comparison
    await testStrategyComparison(strategyValidator, testConfig, validationConfig);

    // 5. Test gaming-specific features
    await testGamingFeatures(backtestEngine, testConfig);

    // 6. Test validation methodologies
    await testValidationMethodologies(strategyValidator, testConfig, validationConfig);

    // 7. Test risk analysis
    await testRiskAnalysis(strategyValidator, testConfig, validationConfig);

    logger.info('✅ All backtesting framework tests completed successfully!');

  } catch (error) {
    logger.error('❌ Backtesting framework test failed:', error);
    throw error;
  }
}

async function createTestConfiguration(): Promise<BacktestConfig> {
  // 3-month backtesting period
  const endTime = Date.now();
  const startTime = endTime - (90 * 24 * 60 * 60 * 1000);

  // Define strategies to test (all 14 implemented strategies)
  const strategies: StrategyBacktestConfig[] = [
    {
      strategyName: 'priority-gas-bidding',
      enabled: true,
      capitalAllocation: 10,
      parameters: {
        gasPriorityFactor: 1.2,
        maxGasPremium: 50
      },
      priority: 9
    },
    {
      strategyName: 'multi-path-arbitrage',
      enabled: true,
      capitalAllocation: 15,
      parameters: {
        minProfitThreshold: 0.005,
        maxHops: 3,
        slippageTolerance: 0.01
      },
      priority: 10
    },
    {
      strategyName: 'statistical-arbitrage',
      enabled: true,
      capitalAllocation: 12,
      parameters: {
        lookbackPeriod: 30,
        zScoreThreshold: 2.0,
        halfLife: 10
      },
      priority: 8
    },
    {
      strategyName: 'time-based-patterns',
      enabled: true,
      capitalAllocation: 8,
      parameters: {
        timeWindows: ['weekend', 'evening', 'morning'],
        seasonalFactors: true
      },
      priority: 7
    },
    {
      strategyName: 'volume-surge-momentum',
      enabled: true,
      capitalAllocation: 10,
      parameters: {
        volumeThreshold: 2.0,
        momentumWindow: 15,
        maxHoldingPeriod: 60
      },
      priority: 8
    },
    {
      strategyName: 'whale-tracking',
      enabled: true,
      capitalAllocation: 5,
      parameters: {
        minWhaleSize: 10000,
        followDelay: 5,
        maxCopyRatio: 0.1
      },
      priority: 6
    },
    {
      strategyName: 'liquidity-migration',
      enabled: true,
      capitalAllocation: 8,
      parameters: {
        tvlThreshold: 100000,
        migrationSpeed: 0.2,
        volatilityWindow: 24
      },
      priority: 7
    },
    {
      strategyName: 'smart-money-flow',
      enabled: true,
      capitalAllocation: 6,
      parameters: {
        profitableTraderThreshold: 0.7,
        followRatio: 0.05,
        confidenceThreshold: 0.8
      },
      priority: 6
    },
    {
      strategyName: 'event-arbitrage',
      enabled: true,
      capitalAllocation: 10,
      parameters: {
        eventSensitivity: 0.8,
        preEventWindow: 30,
        postEventWindow: 120
      },
      priority: 9
    },
    {
      strategyName: 'nft-arbitrage',
      enabled: true,
      capitalAllocation: 8,
      parameters: {
        craftingProfitThreshold: 0.1,
        maxCraftingTime: 24,
        crossPlatformEnabled: true
      },
      priority: 7
    },
    {
      strategyName: 'cross-game-rotation',
      enabled: true,
      capitalAllocation: 8,
      parameters: {
        rotationPeriod: 7,
        gameWeights: {
          'TOWN': 0.4,
          'GALA': 0.3,
          'ETIME': 0.3
        }
      },
      priority: 6
    }
  ];

  const config: BacktestConfig = {
    startTime,
    endTime,
    initialCapital: 10000, // $10,000 test capital
    maxPositionSize: 1000, // $1,000 max position
    riskBudget: 0.02, // 2% capital at risk
    slippageModel: 'realistic',
    includeGasCosts: true,
    includeLiquidityConstraints: true,
    strategies,
    portfolioMode: false, // Test individual first
    includeGamingEvents: true,
    seasonalPatterns: true,
    crossGameCorrelations: true,
    walkForwardPeriods: 6,
    outOfSampleRatio: 0.3,
    monteCarloRuns: 100,
    benchmark: 'GALA|Unit|none|none',
    riskFreeRate: 0.02
  };

  return config;
}

function createValidationConfiguration(): ValidationConfig {
  return {
    confidenceLevel: 0.95,
    minSampleSize: 50,
    bootstrapSamples: 1000,
    kFolds: 5,
    holdoutRatio: 0.3,
    seasonalValidation: true,
    eventValidation: true,
    crossGameValidation: true,
    maxDrawdownThreshold: 0.15,
    minSharpeRatio: 1.0,
    minWinRate: 0.55,
    maxVolatility: 0.3,
    overfittingThreshold: 0.3,
    stabilityWindow: 30
  };
}

async function testIndividualStrategyBacktest(
  backtestEngine: BacktestEngine,
  config: BacktestConfig
): Promise<void> {
  logger.info('📊 Testing individual strategy backtesting...');

  // Test multi-path arbitrage strategy
  const singleStrategyConfig = {
    ...config,
    strategies: [config.strategies.find(s => s.strategyName === 'multi-path-arbitrage')!],
    portfolioMode: false
  };

  const results = await backtestEngine.runBacktest(singleStrategyConfig);

  // Validate results
  logger.info('\n=== Individual Strategy Backtest Results ===');
  logger.info(`Strategy: ${results.strategyResults[0].strategyName}`);
  logger.info(`Total Trades: ${results.totalTrades}`);
  logger.info(`Total Return: ${(results.totalReturn * 100).toFixed(2)}%`);
  logger.info(`Annualized Return: ${(results.annualizedReturn * 100).toFixed(2)}%`);
  logger.info(`Win Rate: ${(results.winRate * 100).toFixed(2)}%`);
  logger.info(`Sharpe Ratio: ${results.sharpeRatio.toFixed(2)}`);
  logger.info(`Max Drawdown: ${(results.maxDrawdown * 100).toFixed(2)}%`);
  logger.info(`Profit Factor: ${results.profitFactor.toFixed(2)}`);

  // Assertions
  if (results.totalTrades === 0) {
    throw new Error('No trades generated in backtest');
  }

  if (results.strategyResults.length === 0) {
    throw new Error('No strategy results generated');
  }

  if (results.validationResults.walkForwardResults.length === 0) {
    throw new Error('No walk-forward results generated');
  }

  logger.info('✅ Individual strategy backtest test passed');
}

async function testPortfolioBacktest(
  backtestEngine: BacktestEngine,
  config: BacktestConfig
): Promise<void> {
  logger.info('🎯 Testing portfolio-level backtesting...');

  // Test with portfolio mode
  const portfolioConfig = {
    ...config,
    portfolioMode: true,
    strategies: config.strategies.slice(0, 5) // Test with 5 strategies
  };

  const results = await backtestEngine.runBacktest(portfolioConfig);

  // Validate results
  logger.info('\n=== Portfolio Backtest Results ===');
  logger.info(`Total Strategies: ${results.strategyResults.length}`);
  logger.info(`Total Trades: ${results.totalTrades}`);
  logger.info(`Total Return: ${(results.totalReturn * 100).toFixed(2)}%`);
  logger.info(`Annualized Return: ${(results.annualizedReturn * 100).toFixed(2)}%`);
  logger.info(`Portfolio Sharpe: ${results.sharpeRatio.toFixed(2)}`);

  // Strategy contributions
  logger.info('\nStrategy Contributions:');
  results.strategyResults.forEach(strategy => {
    logger.info(`- ${strategy.strategyName}: ${(strategy.contribution * 100).toFixed(1)}% contribution`);
  });

  // Assertions
  if (results.strategyResults.length !== 5) {
    throw new Error(`Expected 5 strategy results, got ${results.strategyResults.length}`);
  }

  const totalContribution = results.strategyResults.reduce((sum, s) => sum + s.contribution, 0);
  if (Math.abs(totalContribution - 1.0) > 0.1) {
    throw new Error(`Strategy contributions should sum to 1.0, got ${totalContribution}`);
  }

  logger.info('✅ Portfolio backtest test passed');
}

async function testStrategyValidation(
  strategyValidator: StrategyValidator,
  backtestConfig: BacktestConfig,
  validationConfig: ValidationConfig
): Promise<void> {
  logger.info('🔬 Testing strategy validation...');

  const strategyName = 'multi-path-arbitrage';
  const singleStrategyConfig = {
    ...backtestConfig,
    strategies: [backtestConfig.strategies.find(s => s.strategyName === strategyName)!]
  };

  const validation = await strategyValidator.validateStrategy(
    strategyName,
    singleStrategyConfig,
    validationConfig
  );

  // Display validation results
  logger.info('\n=== Strategy Validation Results ===');
  logger.info(`Strategy: ${validation.strategyName}`);
  logger.info(`Is Valid: ${validation.isValid}`);
  logger.info(`Validation Score: ${validation.validationScore.toFixed(1)}/100`);
  logger.info(`Expected Return: ${(validation.expectedReturn * 100).toFixed(2)}%`);
  logger.info(`Expected Sharpe: ${validation.expectedSharpe.toFixed(2)}`);
  logger.info(`Statistical Significance: ${validation.statisticalTests.statisticallySignificant}`);

  // Out-of-sample performance
  logger.info('\nOut-of-Sample Test:');
  logger.info(`- In-Sample Return: ${(validation.outOfSampleResults.inSampleReturn * 100).toFixed(2)}%`);
  logger.info(`- Out-of-Sample Return: ${(validation.outOfSampleResults.outOfSampleReturn * 100).toFixed(2)}%`);
  logger.info(`- Degradation Factor: ${validation.outOfSampleResults.degradationFactor.toFixed(2)}`);
  logger.info(`- Is Stable: ${validation.outOfSampleResults.isStable}`);

  // Risk metrics
  logger.info('\nRisk Assessment:');
  logger.info(`- Risk Score: ${validation.riskMetrics.riskScore.toFixed(1)}/100`);
  logger.info(`- Risk-Adjusted Return: ${validation.riskMetrics.riskAdjustedReturn.toFixed(2)}`);
  logger.info(`- VaR 99%: ${(validation.riskMetrics.var99 * 100).toFixed(2)}%`);

  // Recommendations and warnings
  logger.info('\nRecommendations:');
  validation.recommendations.forEach(rec => logger.info(`- ${rec}`));

  if (validation.warnings.length > 0) {
    logger.info('\nWarnings:');
    validation.warnings.forEach(warning => logger.info(`- ${warning}`));
  }

  // Assertions
  if (validation.validationScore < 0 || validation.validationScore > 100) {
    throw new Error(`Invalid validation score: ${validation.validationScore}`);
  }

  if (validation.recommendations.length === 0) {
    throw new Error('No recommendations generated');
  }

  logger.info('✅ Strategy validation test passed');
}

async function testStrategyComparison(
  strategyValidator: StrategyValidator,
  backtestConfig: BacktestConfig,
  validationConfig: ValidationConfig
): Promise<void> {
  logger.info('📈 Testing strategy comparison...');

  // Test with 3 strategies
  const strategies = ['multi-path-arbitrage', 'statistical-arbitrage', 'event-arbitrage'];
  
  const comparison = await strategyValidator.compareStrategies(
    strategies,
    backtestConfig,
    validationConfig
  );

  // Display comparison results
  logger.info('\n=== Strategy Comparison Results ===');
  logger.info(`Strategies Analyzed: ${comparison.strategies.length}`);
  logger.info(`Diversification Benefits: ${(comparison.diversificationBenefits * 100).toFixed(1)}%`);

  logger.info('\nStrategy Rankings:');
  comparison.ranking.forEach(rank => {
    logger.info(`${rank.rank}. ${rank.strategyName} - Score: ${rank.validationScore.toFixed(1)} - ${rank.recommendation}`);
  });

  logger.info('\nRecommended Portfolio:');
  Object.entries(comparison.recommendedPortfolio.allocations).forEach(([strategy, allocation]) => {
    logger.info(`- ${strategy}: ${allocation.toFixed(1)}%`);
  });

  logger.info(`Expected Portfolio Return: ${(comparison.recommendedPortfolio.expectedReturn * 100).toFixed(2)}%`);
  logger.info(`Expected Portfolio Sharpe: ${comparison.recommendedPortfolio.expectedSharpe.toFixed(2)}`);

  // Assertions
  if (comparison.ranking.length !== strategies.length) {
    throw new Error(`Expected ${strategies.length} rankings, got ${comparison.ranking.length}`);
  }

  // Check ranking order
  for (let i = 1; i < comparison.ranking.length; i++) {
    if (comparison.ranking[i-1].validationScore < comparison.ranking[i].validationScore) {
      throw new Error('Rankings not properly sorted by validation score');
    }
  }

  const totalAllocation = Object.values(comparison.recommendedPortfolio.allocations)
    .reduce((sum, allocation) => sum + allocation, 0);
  if (Math.abs(totalAllocation - 100) > 1) {
    throw new Error(`Portfolio allocations should sum to 100%, got ${totalAllocation}%`);
  }

  logger.info('✅ Strategy comparison test passed');
}

async function testGamingFeatures(
  backtestEngine: BacktestEngine,
  config: BacktestConfig
): Promise<void> {
  logger.info('🎮 Testing gaming-specific features...');

  // Test with gaming events enabled
  const gamingConfig = {
    ...config,
    strategies: [
      config.strategies.find(s => s.strategyName === 'event-arbitrage')!,
      config.strategies.find(s => s.strategyName === 'time-based-patterns')!,
      config.strategies.find(s => s.strategyName === 'cross-game-rotation')!
    ],
    includeGamingEvents: true,
    seasonalPatterns: true,
    crossGameCorrelations: true
  };

  const results = await backtestEngine.runBacktest(gamingConfig);

  // Check gaming metrics
  if (!results.gamingMetrics) {
    throw new Error('Gaming metrics not generated');
  }

  logger.info('\n=== Gaming Features Test Results ===');
  logger.info(`Event Arbitrage Count: ${results.gamingMetrics.eventArbitrageCount}`);
  logger.info(`Event Arbitrage Profitability: ${(results.gamingMetrics.eventArbitrageProfitability * 100).toFixed(2)}%`);
  logger.info(`Seasonal Pattern Accuracy: ${(results.gamingMetrics.seasonalPatternAccuracy * 100).toFixed(1)}%`);
  logger.info(`Cross-Game Correlation: ${results.gamingMetrics.crossGameCorrelation.toFixed(2)}`);
  logger.info(`Weekend Effect Capture: ${(results.gamingMetrics.weekendEffectCapture * 100).toFixed(2)}%`);
  logger.info(`Community Event Sensitivity: ${results.gamingMetrics.communityEventSensitivity.toFixed(2)}`);

  // Assertions
  if (results.gamingMetrics.eventArbitrageCount < 0) {
    throw new Error('Invalid event arbitrage count');
  }

  if (results.gamingMetrics.seasonalPatternAccuracy < 0 || results.gamingMetrics.seasonalPatternAccuracy > 1) {
    throw new Error('Invalid seasonal pattern accuracy');
  }

  logger.info('✅ Gaming features test passed');
}

async function testValidationMethodologies(
  strategyValidator: StrategyValidator,
  backtestConfig: BacktestConfig,
  validationConfig: ValidationConfig
): Promise<void> {
  logger.info('🔍 Testing validation methodologies...');

  const strategyName = 'statistical-arbitrage';
  const singleStrategyConfig = {
    ...backtestConfig,
    strategies: [backtestConfig.strategies.find(s => s.strategyName === strategyName)!]
  };

  const validation = await strategyValidator.validateStrategy(
    strategyName,
    singleStrategyConfig,
    validationConfig
  );

  logger.info('\n=== Validation Methodologies Test ===');

  // Cross-validation results
  logger.info('Cross-Validation:');
  logger.info(`- Mean Return: ${(validation.crossValidationResults.meanReturn * 100).toFixed(2)}%`);
  logger.info(`- Std Return: ${(validation.crossValidationResults.stdReturn * 100).toFixed(2)}%`);
  logger.info(`- Consistency: ${(validation.crossValidationResults.consistency * 100).toFixed(1)}%`);

  // Bootstrap results
  logger.info('Bootstrap Analysis:');
  logger.info(`- Samples: ${validation.bootstrapResults.samples}`);
  logger.info(`- Probability Positive: ${(validation.bootstrapResults.probabilityPositive * 100).toFixed(1)}%`);
  logger.info(`- Bootstrap Ratio: ${validation.bootstrapResults.bootstrapRatio.toFixed(2)}`);

  // Stability analysis
  logger.info('Stability Analysis:');
  logger.info(`- Is Stable: ${validation.stabilityResults.isStable}`);
  logger.info(`- Stability Score: ${(validation.stabilityResults.stabilityScore * 100).toFixed(1)}%`);
  logger.info(`- Max Consecutive Losses: ${validation.stabilityResults.maxConsecutiveLosses}`);
  logger.info(`- Recovery Time: ${validation.stabilityResults.recoveryTime.toFixed(1)} periods`);

  // Statistical tests
  logger.info('Statistical Tests:');
  logger.info(`- T-Test Significant: ${validation.statisticalTests.tTest.isSignificant}`);
  logger.info(`- T-Test p-value: ${validation.statisticalTests.tTest.pValue.toFixed(4)}`);
  logger.info(`- Jarque-Bera Normal: ${validation.statisticalTests.jarqueBera.isNormal}`);
  logger.info(`- Runs Test Random: ${validation.statisticalTests.runsTest.isRandom}`);

  // Assertions
  if (validation.crossValidationResults.foldResults.length !== validationConfig.kFolds) {
    throw new Error(`Expected ${validationConfig.kFolds} cross-validation folds`);
  }

  if (validation.bootstrapResults.samples !== validationConfig.bootstrapSamples) {
    throw new Error(`Expected ${validationConfig.bootstrapSamples} bootstrap samples`);
  }

  if (validation.stabilityResults.stabilityScore < 0 || validation.stabilityResults.stabilityScore > 1) {
    throw new Error('Invalid stability score');
  }

  logger.info('✅ Validation methodologies test passed');
}

async function testRiskAnalysis(
  strategyValidator: StrategyValidator,
  backtestConfig: BacktestConfig,
  validationConfig: ValidationConfig
): Promise<void> {
  logger.info('⚠️ Testing risk analysis...');

  const strategyName = 'volume-surge-momentum';
  const singleStrategyConfig = {
    ...backtestConfig,
    strategies: [backtestConfig.strategies.find(s => s.strategyName === strategyName)!]
  };

  const validation = await strategyValidator.validateStrategy(
    strategyName,
    singleStrategyConfig,
    validationConfig
  );

  logger.info('\n=== Risk Analysis Test ===');
  
  const risk = validation.riskMetrics;
  logger.info(`Risk Score: ${risk.riskScore.toFixed(1)}/100`);
  logger.info(`Concentration Risk: ${(risk.concentrationRisk * 100).toFixed(1)}%`);
  logger.info(`Liquidity Risk: ${(risk.liquidityRisk * 100).toFixed(1)}%`);
  logger.info(`Volatility Risk: ${(risk.volatilityRisk * 100).toFixed(1)}%`);
  logger.info(`Drawdown Risk: ${(risk.drawdownRisk * 100).toFixed(1)}%`);
  logger.info(`Risk-Adjusted Return: ${risk.riskAdjustedReturn.toFixed(2)}`);
  logger.info(`Max Acceptable Loss: ${risk.maxAcceptableLoss.toFixed(2)}%`);
  logger.info(`Capital at Risk: $${risk.capitalAtRisk.toFixed(0)}`);
  logger.info(`VaR 99%: ${(risk.var99 * 100).toFixed(2)}%`);
  logger.info(`Expected Shortfall 99%: ${(risk.expectedShortfall99 * 100).toFixed(2)}%`);
  logger.info(`Stress Tolerance: ${(risk.stressTolerance * 100).toFixed(1)}%`);

  // Confidence intervals
  logger.info('\nConfidence Intervals (95%):');
  logger.info(`Return CI: [${(validation.returnConfidenceInterval[0] * 100).toFixed(2)}%, ${(validation.returnConfidenceInterval[1] * 100).toFixed(2)}%]`);
  logger.info(`Sharpe CI: [${validation.sharpeConfidenceInterval[0].toFixed(2)}, ${validation.sharpeConfidenceInterval[1].toFixed(2)}]`);
  logger.info(`Drawdown CI: [${(validation.drawdownConfidenceInterval[0] * 100).toFixed(2)}%, ${(validation.drawdownConfidenceInterval[1] * 100).toFixed(2)}%]`);

  // Assertions
  if (risk.riskScore < 0 || risk.riskScore > 100) {
    throw new Error('Invalid risk score');
  }

  if (risk.concentrationRisk < 0 || risk.concentrationRisk > 1) {
    throw new Error('Invalid concentration risk');
  }

  if (risk.stressTolerance < 0 || risk.stressTolerance > 1) {
    throw new Error('Invalid stress tolerance');
  }

  logger.info('✅ Risk analysis test passed');
}

// Performance benchmarking
async function benchmarkBacktestPerformance(): Promise<void> {
  logger.info('⏱️ Benchmarking backtest performance...');

  const startTime = Date.now();
  
  // Run a performance test
  const config = await createTestConfiguration();
  config.monteCarloRuns = 50; // Reduce for performance test
  
  await timeSeriesDB.initialize();
  const backtestEngine = new BacktestEngine(timeSeriesDB);
  
  const results = await backtestEngine.runBacktest(config);
  
  const executionTime = Date.now() - startTime;
  
  logger.info('\n=== Performance Benchmark ===');
  logger.info(`Execution Time: ${executionTime}ms`);
  logger.info(`Trades Simulated: ${results.totalTrades}`);
  logger.info(`Trades per Second: ${(results.totalTrades / (executionTime / 1000)).toFixed(0)}`);
  logger.info(`Validation Tests: ${results.validationResults.monteCarloResults.length}`);

  if (executionTime > 60000) { // 1 minute threshold
    logger.warn('⚠️ Backtest execution time exceeds 1 minute - consider optimization');
  }

  logger.info('✅ Performance benchmark completed');
}

// Export main test function
if (require.main === module) {
  testBacktestingFramework()
    .then(() => benchmarkBacktestPerformance())
    .then(() => {
      logger.info('\n🎉 ALL BACKTESTING FRAMEWORK TESTS PASSED! 🎉');
      logger.info('\n📊 The backtesting framework is ready for production validation');
      logger.info('📈 All 14 trading strategies can now be comprehensively tested');
      logger.info('🔬 Statistical validation ensures robust strategy selection');
      logger.info('🎮 Gaming-specific features capture unique token behaviors');
      logger.info('⚠️ Risk analysis provides comprehensive capital protection');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('\n💥 BACKTESTING FRAMEWORK TESTS FAILED:', error);
      process.exit(1);
    });
}

export { testBacktestingFramework };
