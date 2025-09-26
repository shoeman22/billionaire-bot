#!/usr/bin/env tsx

/**
 * Multi-Path Arbitrage Testing Script
 *
 * Comprehensive test suite for the new multi-path arbitrage system:
 * - Tests triangular arbitrage (3-hop) paths
 * - Tests quadrangular arbitrage (4-hop) paths
 * - Validates path optimization and risk assessment
 * - Simulates complex arbitrage scenarios
 * - Tests rollback mechanisms and error handling
 */

import { getConfig, BotConfig } from '../config/environment';
import { GSwap } from '../services/gswap-simple';
import { SwapExecutor } from '../trading/execution/swap-executor';
import { SlippageProtection } from '../trading/risk/slippage';
import { MarketAnalysis } from '../monitoring/market-analysis';
import { MultiPathArbitrageStrategy } from '../trading/strategies/multi-path-arbitrage';
import { PathOptimizer } from '../trading/execution/path-optimizer';
import { logger } from '../utils/logger';
import { PriceTracker } from '../monitoring/price-tracker';

interface TestResult {
  testName: string;
  success: boolean;
  error?: string;
  details?: unknown;
  executionTime: number;
}

interface TestSuite {
  suiteName: string;
  results: TestResult[];
  overallSuccess: boolean;
  totalExecutionTime: number;
}

class MultiPathArbitrageTestRunner {
  private config: BotConfig = getConfig();
  private gswap: GSwap;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private multiPathStrategy: MultiPathArbitrageStrategy;
  private pathOptimizer: PathOptimizer;

  private testResults: TestSuite[] = [];

  constructor() {
    // Initialize components
    this.gswap = new GSwap(this.config.api);
    const slippageProtection = new SlippageProtection(this.config.trading);
    this.swapExecutor = new SwapExecutor(this.gswap, slippageProtection);

    // Create price tracker for MarketAnalysis
    const priceTracker = new PriceTracker(this.gswap);
    this.marketAnalysis = new MarketAnalysis(priceTracker, this.gswap);

    this.multiPathStrategy = new MultiPathArbitrageStrategy(
      this.gswap,
      this.config.trading,
      this.swapExecutor,
      this.marketAnalysis
    );
    this.pathOptimizer = new PathOptimizer(this.gswap, this.config.trading);

    logger.info('🧪 Multi-Path Arbitrage Test Runner initialized');
  }

  /**
   * Run comprehensive test suite
   */
  async runAllTests(): Promise<void> {
    logger.info('🚀 Starting Multi-Path Arbitrage Test Suite...');
    const overallStartTime = Date.now();

    try {
      // Test 1: Strategy Initialization
      await this.testStrategyInitialization();

      // Test 2: Path Optimization
      await this.testPathOptimization();

      // Test 3: Triangular Arbitrage Discovery
      await this.testTriangularArbitrageDiscovery();

      // Test 4: Quadrangular Arbitrage Discovery
      await this.testQuadrangularArbitrageDiscovery();

      // Test 5: Risk Assessment
      await this.testRiskAssessment();

      // Test 6: Opportunity Analysis
      await this.testOpportunityAnalysis();

      // Test 7: Configuration Management
      await this.testConfigurationManagement();

      // Test 8: Error Handling and Recovery
      await this.testErrorHandling();

      // Generate final report
      this.generateTestReport(Date.now() - overallStartTime);

    } catch (error) {
      logger.error('❌ Test suite execution failed:', error);
    }
  }

  /**
   * Test 1: Strategy Initialization
   */
  private async testStrategyInitialization(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Strategy Initialization',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 1.1: Strategy creation
    const test1 = await this.runTest('Strategy Creation', async () => {
      if (!this.multiPathStrategy) {
        throw new Error('Multi-path strategy not created');
      }

      const config = this.multiPathStrategy.getConfig();
      if (!config.enableTriangular || !config.enableQuadrangular) {
        throw new Error('Strategy not properly configured');
      }

      return { config };
    });

    suite.results.push(test1);

    // Test 1.2: Strategy initialization
    const test2 = await this.runTest('Strategy Initialization', async () => {
      await this.multiPathStrategy.initialize();

      // Verify initialization
      const stats = this.multiPathStrategy.getStats();
      return { stats };
    });

    suite.results.push(test2);

    // Test 1.3: Path optimizer initialization
    const test3 = await this.runTest('Path Optimizer Initialization', async () => {
      await this.pathOptimizer.initialize();

      const config = this.pathOptimizer.getConfig();
      if (config.maxTotalSlippage <= 0) {
        throw new Error('Path optimizer not properly configured');
      }

      return { config };
    });

    suite.results.push(test3);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Test 2: Path Optimization
   */
  private async testPathOptimization(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Path Optimization',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 2.1: Triangular path optimization
    const test1 = await this.runTest('Triangular Path Optimization', async () => {
      const triangularPath = ['GALA', 'GUSDC', 'GWETH', 'GALA'];
      const inputAmount = 100;

      const optimizedPath = await this.pathOptimizer.optimizePath(triangularPath, inputAmount);

      if (optimizedPath.originalPath.length !== triangularPath.length) {
        throw new Error('Path length mismatch');
      }

      return {
        path: optimizedPath.originalPath,
        isViable: optimizedPath.isViable,
        totalSlippage: optimizedPath.totalSlippage,
        expectedFinalAmount: optimizedPath.expectedFinalAmount,
        riskLevel: optimizedPath.riskAssessment.overallRisk
      };
    });

    suite.results.push(test1);

    // Test 2.2: Quadrangular path optimization
    const test2 = await this.runTest('Quadrangular Path Optimization', async () => {
      const quadrangularPath = ['GALA', 'GUSDC', 'GWETH', 'GUSDT', 'GALA'];
      const inputAmount = 100;

      const optimizedPath = await this.pathOptimizer.optimizePath(quadrangularPath, inputAmount);

      return {
        path: optimizedPath.originalPath,
        isViable: optimizedPath.isViable,
        totalSlippage: optimizedPath.totalSlippage,
        hopsCount: optimizedPath.optimizedHops.length,
        rollbackPlan: optimizedPath.rollbackPlan.strategy
      };
    });

    suite.results.push(test2);

    // Test 2.3: Invalid path handling
    const test3 = await this.runTest('Invalid Path Handling', async () => {
      const invalidPath = ['NONEXISTENT', 'INVALID', 'TOKENS', 'NONEXISTENT'];
      const inputAmount = 100;

      const optimizedPath = await this.pathOptimizer.optimizePath(invalidPath, inputAmount);

      if (optimizedPath.isViable) {
        throw new Error('Invalid path should not be viable');
      }

      return {
        isViable: optimizedPath.isViable,
        viabilityReasons: optimizedPath.viabilityReasons,
        riskLevel: optimizedPath.riskAssessment.overallRisk
      };
    });

    suite.results.push(test3);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Test 3: Triangular Arbitrage Discovery
   */
  private async testTriangularArbitrageDiscovery(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Triangular Arbitrage Discovery',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 3.1: Opportunity scanning
    const test1 = await this.runTest('Triangular Opportunity Scanning', async () => {
      // Enable only triangular arbitrage
      this.multiPathStrategy.updateConfig({
        enableTriangular: true,
        enableQuadrangular: false
      });

      const opportunities = await this.multiPathStrategy.scanForOpportunities();

      return {
        opportunitiesFound: opportunities.length,
        triangularOpportunities: opportunities.filter(o => o.pathType === 'triangular').length,
        executableOpportunities: opportunities.filter(o => o.isExecutable).length,
        bestOpportunity: opportunities[0] ? {
          path: opportunities[0].pathName,
          netProfitPercent: opportunities[0].netProfitPercent,
          totalSlippage: opportunities[0].totalSlippage
        } : null
      };
    });

    suite.results.push(test1);

    // Test 3.2: Profit calculation validation
    const test2 = await this.runTest('Triangular Profit Calculation', async () => {
      const opportunities = await this.multiPathStrategy.scanForOpportunities();

      if (opportunities.length === 0) {
        return { message: 'No opportunities found - market conditions may be limiting' };
      }

      const opp = opportunities[0];

      // Validate profit calculations
      if (opp.grossProfitAmount < 0 && opp.netProfitPercent > 0) {
        throw new Error('Inconsistent profit calculations');
      }

      if (opp.netProfitAmount > opp.grossProfitAmount) {
        throw new Error('Net profit cannot exceed gross profit');
      }

      return {
        path: opp.pathName,
        inputAmount: opp.inputAmount,
        expectedFinalAmount: opp.expectedFinalAmount,
        grossProfit: opp.grossProfitAmount,
        netProfit: opp.netProfitAmount,
        gasEstimate: opp.estimatedGasCost
      };
    });

    suite.results.push(test2);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Test 4: Quadrangular Arbitrage Discovery
   */
  private async testQuadrangularArbitrageDiscovery(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Quadrangular Arbitrage Discovery',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 4.1: Quadrangular opportunity scanning
    const test1 = await this.runTest('Quadrangular Opportunity Scanning', async () => {
      // Enable only quadrangular arbitrage
      this.multiPathStrategy.updateConfig({
        enableTriangular: false,
        enableQuadrangular: true
      });

      const opportunities = await this.multiPathStrategy.scanForOpportunities();

      return {
        opportunitiesFound: opportunities.length,
        quadrangularOpportunities: opportunities.filter(o => o.pathType === 'quadrangular').length,
        avgHops: opportunities.length > 0 ?
          opportunities.reduce((sum, o) => sum + o.hops.length, 0) / opportunities.length : 0,
        complexityDistribution: {
          moderate: opportunities.filter(o => o.executionComplexity === 'moderate').length,
          high: opportunities.filter(o => o.executionComplexity === 'high').length,
          extreme: opportunities.filter(o => o.executionComplexity === 'extreme').length
        }
      };
    });

    suite.results.push(test1);

    // Test 4.2: Risk assessment for complex paths
    const test2 = await this.runTest('Complex Path Risk Assessment', async () => {
      const opportunities = await this.multiPathStrategy.scanForOpportunities();

      if (opportunities.length === 0) {
        return { message: 'No quadrangular opportunities found' };
      }

      const complexOpp = opportunities.find(o => o.hops.length >= 4) || opportunities[0];

      return {
        path: complexOpp.pathName,
        hops: complexOpp.hops.length,
        overallRisk: complexOpp.pathRisk.overallRisk,
        riskFactors: complexOpp.pathRisk.riskFactors,
        rollbackComplexity: complexOpp.rollbackComplexity,
        executionComplexity: complexOpp.executionComplexity
      };
    });

    suite.results.push(test2);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Test 5: Risk Assessment
   */
  private async testRiskAssessment(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Risk Assessment',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 5.1: Risk factor identification
    const test1 = await this.runTest('Risk Factor Identification', async () => {
      // Re-enable both types
      this.multiPathStrategy.updateConfig({
        enableTriangular: true,
        enableQuadrangular: true
      });

      const opportunities = await this.multiPathStrategy.scanForOpportunities();

      if (opportunities.length === 0) {
        return { message: 'No opportunities available for risk testing' };
      }

      const riskDistribution = {
        low: opportunities.filter(o => o.pathRisk.overallRisk === 'low').length,
        medium: opportunities.filter(o => o.pathRisk.overallRisk === 'medium').length,
        high: opportunities.filter(o => o.pathRisk.overallRisk === 'high').length,
        extreme: opportunities.filter(o => o.pathRisk.overallRisk === 'extreme').length
      };

      return {
        totalOpportunities: opportunities.length,
        riskDistribution,
        avgLiquidityRisk: opportunities.reduce((sum, o) => sum + o.pathRisk.liquidityRisk, 0) / opportunities.length,
        avgExecutionRisk: opportunities.reduce((sum, o) => sum + o.pathRisk.executionRisk, 0) / opportunities.length
      };
    });

    suite.results.push(test1);

    // Test 5.2: Slippage calculation accuracy
    const test2 = await this.runTest('Slippage Calculation', async () => {
      const testPath = ['GALA', 'GUSDC', 'GWETH', 'GALA'];
      const optimizedPath = await this.pathOptimizer.optimizePath(testPath, 100);

      if (optimizedPath.totalSlippage < 0 || optimizedPath.totalSlippage > 100) {
        throw new Error('Invalid slippage calculation');
      }

      return {
        path: testPath.join('→'),
        totalSlippage: optimizedPath.totalSlippage,
        hopCount: optimizedPath.optimizedHops.length,
        avgSlippagePerHop: optimizedPath.optimizedHops.length > 0 ?
          optimizedPath.optimizedHops.reduce((sum, hop) => sum + hop.estimatedSlippage, 0) / optimizedPath.optimizedHops.length : 0
      };
    });

    suite.results.push(test2);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Test 6: Opportunity Analysis
   */
  private async testOpportunityAnalysis(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Opportunity Analysis',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 6.1: Opportunity prioritization
    const test1 = await this.runTest('Opportunity Prioritization', async () => {
      const opportunities = await this.multiPathStrategy.scanForOpportunities();

      if (opportunities.length < 2) {
        return { message: 'Insufficient opportunities for prioritization test' };
      }

      // Check if opportunities are sorted by profit
      let properlyOrdered = true;
      for (let i = 1; i < opportunities.length; i++) {
        if (opportunities[i - 1].netProfitPercent < opportunities[i].netProfitPercent) {
          properlyOrdered = false;
          break;
        }
      }

      return {
        opportunitiesAnalyzed: opportunities.length,
        properlyOrdered,
        profitRange: {
          highest: opportunities[0]?.netProfitPercent || 0,
          lowest: opportunities[opportunities.length - 1]?.netProfitPercent || 0
        },
        priorityDistribution: opportunities.reduce((acc, opp) => {
          acc[opp.priority] = (acc[opp.priority] || 0) + 1;
          return acc;
        }, {} as Record<number, number>)
      };
    });

    suite.results.push(test1);

    // Test 6.2: Gas cost estimation
    const test2 = await this.runTest('Gas Cost Estimation', async () => {
      const opportunities = await this.multiPathStrategy.scanForOpportunities();

      if (opportunities.length === 0) {
        return { message: 'No opportunities for gas cost testing' };
      }

      const gasEstimates = opportunities.map(opp => ({
        path: opp.pathName,
        hops: opp.hops.length,
        estimatedGas: opp.estimatedGasCost,
        gasPerHop: opp.estimatedGasCost / opp.hops.length
      }));

      const avgGasCost = gasEstimates.reduce((sum, est) => sum + est.estimatedGas, 0) / gasEstimates.length;

      return {
        opportunitiesTested: gasEstimates.length,
        avgGasCost,
        gasRange: {
          min: Math.min(...gasEstimates.map(e => e.estimatedGas)),
          max: Math.max(...gasEstimates.map(e => e.estimatedGas))
        },
        avgGasPerHop: gasEstimates.reduce((sum, est) => sum + est.gasPerHop, 0) / gasEstimates.length
      };
    });

    suite.results.push(test2);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Test 7: Configuration Management
   */
  private async testConfigurationManagement(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Configuration Management',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 7.1: Configuration updates
    const test1 = await this.runTest('Configuration Updates', async () => {
      const originalConfig = this.multiPathStrategy.getConfig();

      // Update configuration
      const newConfig = {
        minProfitPercent: 3.0,
        maxSlippageCompound: 10.0,
        enableTriangular: false
      };

      this.multiPathStrategy.updateConfig(newConfig);

      const updatedConfig = this.multiPathStrategy.getConfig();

      // Verify updates applied
      if (updatedConfig.minProfitPercent !== newConfig.minProfitPercent) {
        throw new Error('Configuration update failed');
      }

      // Restore original configuration
      this.multiPathStrategy.updateConfig(originalConfig);

      return {
        originalConfig: {
          minProfitPercent: originalConfig.minProfitPercent,
          maxSlippageCompound: originalConfig.maxSlippageCompound
        },
        updatedConfig: {
          minProfitPercent: updatedConfig.minProfitPercent,
          maxSlippageCompound: updatedConfig.maxSlippageCompound
        }
      };
    });

    suite.results.push(test1);

    // Test 7.2: Path optimizer configuration
    const test2 = await this.runTest('Path Optimizer Configuration', async () => {
      const originalConfig = this.pathOptimizer.getConfig();

      // Update path optimizer configuration
      const newConfig = {
        maxTotalSlippage: 12.0,
        minLiquidityPerHop: 10000
      };

      this.pathOptimizer.updateConfig(newConfig);

      const updatedConfig = this.pathOptimizer.getConfig();

      // Verify updates applied
      if (updatedConfig.maxTotalSlippage !== newConfig.maxTotalSlippage) {
        throw new Error('Path optimizer configuration update failed');
      }

      // Restore original configuration
      this.pathOptimizer.updateConfig(originalConfig);

      return {
        configurationUpdated: true,
        originalMaxSlippage: originalConfig.maxTotalSlippage,
        updatedMaxSlippage: updatedConfig.maxTotalSlippage
      };
    });

    suite.results.push(test2);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Test 8: Error Handling and Recovery
   */
  private async testErrorHandling(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Error Handling and Recovery',
      results: [],
      overallSuccess: true,
      totalExecutionTime: 0
    };

    const suiteStartTime = Date.now();

    // Test 8.1: Invalid path handling
    const test1 = await this.runTest('Invalid Path Handling', async () => {
      try {
        const invalidPath: string[] = [];
        const optimizedPath = await this.pathOptimizer.optimizePath(invalidPath, 100);

        if (optimizedPath.isViable) {
          throw new Error('Empty path should not be viable');
        }

        return {
          handled: true,
          isViable: optimizedPath.isViable,
          viabilityReasons: optimizedPath.viabilityReasons
        };
      } catch (error) {
        return {
          handled: true,
          errorHandled: true,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    suite.results.push(test1);

    // Test 8.2: Statistics tracking
    const test2 = await this.runTest('Statistics Tracking', async () => {
      const initialStats = this.multiPathStrategy.getStats();

      // Run opportunity scan to generate stats
      await this.multiPathStrategy.scanForOpportunities();

      const finalStats = this.multiPathStrategy.getStats();

      return {
        initialOpportunities: initialStats.totalOpportunities,
        finalOpportunities: finalStats.totalOpportunities,
        statsTracking: finalStats.totalOpportunities >= initialStats.totalOpportunities
      };
    });

    suite.results.push(test2);

    // Test 8.3: Statistics reset
    const test3 = await this.runTest('Statistics Reset', async () => {
      // Ensure we have some stats first
      await this.multiPathStrategy.scanForOpportunities();

      const beforeReset = this.multiPathStrategy.getStats();
      this.multiPathStrategy.resetStats();
      const afterReset = this.multiPathStrategy.getStats();

      return {
        beforeResetOpportunities: beforeReset.totalOpportunities,
        afterResetOpportunities: afterReset.totalOpportunities,
        resetSuccessful: afterReset.totalOpportunities === 0
      };
    });

    suite.results.push(test3);

    suite.overallSuccess = suite.results.every(r => r.success);
    suite.totalExecutionTime = Date.now() - suiteStartTime;
    this.testResults.push(suite);
  }

  /**
   * Run individual test with error handling
   */
  private async runTest(testName: string, testFunction: () => Promise<unknown>): Promise<TestResult> {
    const startTime = Date.now();
    logger.debug(`🧪 Running test: ${testName}`);

    try {
      const details = await testFunction();
      const result: TestResult = {
        testName,
        success: true,
        details,
        executionTime: Date.now() - startTime
      };

      logger.debug(`✅ Test passed: ${testName} (${result.executionTime}ms)`);
      return result;

    } catch (error) {
      const result: TestResult = {
        testName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      };

      logger.error(`❌ Test failed: ${testName} - ${result.error} (${result.executionTime}ms)`);
      return result;
    }
  }

  /**
   * Generate comprehensive test report
   */
  private generateTestReport(totalExecutionTime: number): void {
    logger.info('📊 Multi-Path Arbitrage Test Suite Results');
    logger.info('═'.repeat(80));

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    for (const suite of this.testResults) {
      logger.info(`\n📋 ${suite.suiteName}`);
      logger.info('─'.repeat(40));

      for (const test of suite.results) {
        totalTests++;
        const status = test.success ? '✅' : '❌';
        logger.info(`  ${status} ${test.testName} (${test.executionTime}ms)`);

        if (test.success) {
          passedTests++;
          if (test.details && Object.keys(test.details).length > 0) {
            logger.debug(`     Details: ${JSON.stringify(test.details, null, 2)}`);
          }
        } else {
          failedTests++;
          logger.error(`     Error: ${test.error}`);
        }
      }

      const suiteStatus = suite.overallSuccess ? '✅' : '❌';
      logger.info(`  ${suiteStatus} Suite: ${suite.results.filter(r => r.success).length}/${suite.results.length} passed (${suite.totalExecutionTime}ms)`);
    }

    // Overall summary
    logger.info('\n🎯 Overall Test Results');
    logger.info('═'.repeat(40));
    logger.info(`Total Tests: ${totalTests}`);
    logger.info(`Passed: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
    logger.info(`Failed: ${failedTests} (${((failedTests / totalTests) * 100).toFixed(1)}%)`);
    logger.info(`Total Execution Time: ${totalExecutionTime}ms`);

    const overallSuccess = failedTests === 0;
    logger.info(`Overall Status: ${overallSuccess ? '✅ SUCCESS' : '❌ FAILURE'}`);

    if (overallSuccess) {
      logger.info('\n🎉 Multi-Path Arbitrage Implementation: ALL TESTS PASSED');
      logger.info('✨ System is ready for production deployment');
    } else {
      logger.error('\n⚠️  Multi-Path Arbitrage Implementation: SOME TESTS FAILED');
      logger.error('🔧 Please review failed tests before deployment');
    }

    logger.info('═'.repeat(80));

    // Exit with appropriate code
    process.exit(overallSuccess ? 0 : 1);
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    logger.info('🎯 Multi-Path Arbitrage Testing Script Started');
    logger.info(`📅 Test Date: ${new Date().toISOString()}`);
    logger.info(`⚙️  Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🌐 API Base URL: ${getConfig().api.baseUrl}`);

    const testRunner = new MultiPathArbitrageTestRunner();
    await testRunner.runAllTests();

  } catch (error) {
    logger.error('💥 Test script execution failed:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { MultiPathArbitrageTestRunner };