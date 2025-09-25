#!/usr/bin/env tsx

/**
 * New Trading Strategies Demo
 *
 * Showcase script demonstrating all the new trading strategies:
 * - Triangle Arbitrage (3-hop cycles)
 * - Stablecoin Arbitrage (low-risk, high-frequency)
 * - Cross-Asset Momentum (correlation breakdowns)
 * - Strategy Orchestrator (intelligent coordination)
 *
 * Run with: npm run demo:strategies
 */

import dotenv from 'dotenv';
import { logger } from '../src/utils/logger';
import { validateEnvironment } from '../src/config/environment';
import { GSwap } from '../src/services/gswap-simple';
import { SwapExecutor } from '../src/trading/execution/swap-executor';
import { MarketAnalysis } from '../src/monitoring/market-analysis';
import { SlippageProtection } from '../src/trading/risk/slippage';

// Import new strategies
import { TriangleArbitrageStrategy } from '../src/trading/strategies/triangle-arbitrage';
import { StablecoinArbitrageStrategy } from '../src/trading/strategies/stablecoin-arbitrage';
import { CrossAssetMomentumStrategy } from '../src/trading/strategies/cross-asset-momentum';
import { StrategyOrchestrator } from '../src/trading/strategies/strategy-orchestrator';

// Load environment
dotenv.config();

class NewStrategiesDemo {
  private gswap: GSwap;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private slippageProtection: SlippageProtection;

  constructor() {
    const config = validateEnvironment();

    // Initialize core systems
    this.gswap = new GSwap({
      signer: {} as any, // Mock for demo
      baseUrl: config.api.baseUrl
    });

    this.slippageProtection = new SlippageProtection(config.trading);
    this.swapExecutor = new SwapExecutor(this.gswap, this.slippageProtection);
    this.marketAnalysis = new MarketAnalysis({} as any, this.gswap);
  }

  /**
   * Demo Triangle Arbitrage Strategy
   */
  async demoTriangleArbitrage(): Promise<void> {
    logger.info('🔺 === TRIANGLE ARBITRAGE STRATEGY DEMO ===');

    const strategy = new TriangleArbitrageStrategy(
      this.gswap,
      {} as any,
      this.swapExecutor,
      this.marketAnalysis
    );

    try {
      logger.info('Initializing Triangle Arbitrage Strategy...');
      await strategy.start();

      logger.info('🔍 Scanning for profitable 3-hop cycles...');
      const opportunities = await strategy.scanForOpportunities();

      logger.info(`Found ${opportunities.length} triangle arbitrage opportunities`);

      // Show top opportunities
      const topOpportunities = opportunities.slice(0, 3);
      for (const opp of topOpportunities) {
        logger.info('💎 Triangle Opportunity Found:', {
          path: opp.pathName,
          inputAmount: opp.inputAmount,
          expectedProfit: opp.netProfit.toFixed(6),
          profitPercent: opp.netProfitPercent.toFixed(3) + '%',
          executionPriority: opp.executionPriority,
          liquidityRisk: opp.liquidityRisk,
          isExecutable: opp.isExecutable
        });
      }

      // Show strategy statistics
      const stats = strategy.getStats();
      logger.info('📊 Triangle Arbitrage Stats:', {
        totalOpportunities: stats.totalOpportunities,
        executedTrades: stats.executedTrades,
        successfulTrades: stats.successfulTrades,
        totalProfit: stats.totalProfit.toFixed(6),
        bestPath: stats.bestPath,
        bestProfitPercent: stats.bestProfitPercent.toFixed(3) + '%'
      });

      await strategy.stop();
      logger.info('✅ Triangle Arbitrage demo completed\n');

    } catch (error) {
      logger.error('❌ Triangle Arbitrage demo failed:', error);
    }
  }

  /**
   * Demo Stablecoin Arbitrage Strategy
   */
  async demoStablecoinArbitrage(): Promise<void> {
    logger.info('💵 === STABLECOIN ARBITRAGE STRATEGY DEMO ===');

    const strategy = new StablecoinArbitrageStrategy(
      this.gswap,
      {} as any,
      this.swapExecutor,
      this.marketAnalysis
    );

    try {
      logger.info('Initializing Stablecoin Arbitrage Strategy...');
      await strategy.start();

      // Let it run for a short time to collect data
      logger.info('⏱️ Running high-frequency stablecoin scanning for 10 seconds...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      const stats = strategy.getStats();
      const capitalInfo = strategy.getCapitalInfo();

      logger.info('📈 Stablecoin Arbitrage Performance:', {
        totalTrades: stats.totalTrades,
        successfulTrades: stats.successfulTrades,
        totalVolume: stats.totalVolume.toFixed(2),
        totalProfit: stats.totalProfit.toFixed(6),
        avgSpread: stats.avgSpread.toFixed(4) + '%',
        successRate: stats.successRate.toFixed(1) + '%',
        avgProfitPerTrade: stats.avgProfitPerTrade.toFixed(6),
        compoundGrowth: stats.compoundGrowth.toFixed(3) + '%'
      });

      logger.info('💰 Capital Performance:', {
        initialCapital: capitalInfo.initialCapital,
        currentCapital: capitalInfo.currentCapital.toFixed(2),
        totalReturn: capitalInfo.totalReturn.toFixed(6),
        dailyReturn: capitalInfo.dailyReturn.toFixed(6),
        compoundGrowthRate: capitalInfo.compoundGrowthRate.toFixed(3) + '%'
      });

      await strategy.stop();
      logger.info('✅ Stablecoin Arbitrage demo completed\n');

    } catch (error) {
      logger.error('❌ Stablecoin Arbitrage demo failed:', error);
    }
  }

  /**
   * Demo Cross-Asset Momentum Strategy
   */
  async demoCrossAssetMomentum(): Promise<void> {
    logger.info('📈 === CROSS-ASSET MOMENTUM STRATEGY DEMO ===');

    const strategy = new CrossAssetMomentumStrategy(
      this.gswap,
      {} as any,
      this.swapExecutor,
      this.marketAnalysis
    );

    try {
      logger.info('Initializing Cross-Asset Momentum Strategy...');
      await strategy.start();

      // Let it collect price data and analyze correlations
      logger.info('📊 Collecting price data and analyzing correlations for 15 seconds...');
      await new Promise(resolve => setTimeout(resolve, 15000));

      const stats = strategy.getStats();
      const activePositions = strategy.getActivePositions();

      logger.info('🔄 Correlation Analysis Results:', {
        totalSignals: stats.totalSignals,
        executedTrades: stats.executedTrades,
        profitableTrades: stats.profitableTrades,
        totalProfit: stats.totalProfit.toFixed(6),
        winRate: stats.winRate.toFixed(1) + '%',
        avgCorrelation: stats.avgCorrelation.toFixed(3),
        bestCorrelationBreakdown: stats.bestCorrelationBreakdown.toFixed(3) + '%',
        avgHoldingTime: Math.round(stats.avgHoldingTime / 60000) + ' minutes'
      });

      if (activePositions.size > 0) {
        logger.info('📊 Active Momentum Positions:');
        activePositions.forEach((position, asset) => {
          logger.info(`  ${asset}: ${position.direction} @ ${position.entryPrice}`, {
            size: position.size,
            stopLoss: position.stopLoss,
            takeProfit: position.takeProfit,
            holdingTime: Math.round((Date.now() - position.entryTime) / 60000) + ' minutes'
          });
        });
      } else {
        logger.info('📊 No active momentum positions');
      }

      await strategy.stop();
      logger.info('✅ Cross-Asset Momentum demo completed\n');

    } catch (error) {
      logger.error('❌ Cross-Asset Momentum demo failed:', error);
    }
  }

  /**
   * Demo Strategy Orchestrator
   */
  async demoStrategyOrchestrator(): Promise<void> {
    logger.info('🎯 === STRATEGY ORCHESTRATOR DEMO ===');

    const orchestrator = new StrategyOrchestrator(
      this.gswap,
      {} as any,
      this.swapExecutor,
      this.marketAnalysis
    );

    try {
      logger.info('Initializing Strategy Orchestrator...');
      logger.info('🤖 Loading all strategies and configuring intelligent coordination...');

      await orchestrator.start();

      // Let the orchestrator run and coordinate strategies
      logger.info('⚙️ Running multi-strategy coordination for 20 seconds...');
      await new Promise(resolve => setTimeout(resolve, 20000));

      const stats = orchestrator.getStats();
      const performance = orchestrator.getStrategyPerformance();
      const marketConditions = orchestrator.getMarketConditions();

      logger.info('🎭 Current Market Conditions:', {
        trend: marketConditions.trend,
        volatility: marketConditions.volatility,
        liquidity: marketConditions.liquidity,
        volume: marketConditions.volume,
        sentiment: marketConditions.sentiment,
        riskLevel: marketConditions.riskLevel
      });

      logger.info('💼 Portfolio Overview:', {
        totalCapital: stats.totalCapital,
        allocatedCapital: stats.allocatedCapital.toFixed(0),
        availableCapital: stats.availableCapital.toFixed(0),
        allocationPercentage: ((stats.allocatedCapital / stats.totalCapital) * 100).toFixed(1) + '%',
        totalProfit: stats.totalProfit.toFixed(6),
        totalTrades: stats.totalTrades,
        activeTrades: stats.activeTrades,
        overallWinRate: stats.overallWinRate.toFixed(1) + '%'
      });

      logger.info('🏆 Strategy Performance Rankings:');
      const sortedPerformance = Array.from(performance.entries())
        .sort(([,a], [,b]) => b.performanceScore - a.performanceScore);

      sortedPerformance.forEach(([name, perf], index) => {
        const config = orchestrator.getStrategyConfig(name);
        logger.info(`  ${index + 1}. ${perf.name}`, {
          enabled: config?.enabled,
          priority: config?.priority,
          performanceScore: perf.performanceScore.toFixed(1),
          capitalAllocated: perf.capitalAllocated.toFixed(0),
          totalProfit: perf.totalProfit.toFixed(6),
          winRate: perf.winRate.toFixed(1) + '%',
          riskScore: perf.riskScore.toFixed(2)
        });
      });

      if (stats.bestPerformingStrategy) {
        logger.info('🥇 Best Performing Strategy:', stats.bestPerformingStrategy);
      }

      await orchestrator.stop();
      logger.info('✅ Strategy Orchestrator demo completed\n');

    } catch (error) {
      logger.error('❌ Strategy Orchestrator demo failed:', error);
    }
  }

  /**
   * Run complete demo of all new strategies
   */
  async runCompleteDemo(): Promise<void> {
    logger.info('🚀 === NEW TRADING STRATEGIES SHOWCASE ===');
    logger.info('Demonstrating advanced trading strategies for the Billionaire Bot\n');

    const startTime = Date.now();

    try {
      // Run all strategy demos
      await this.demoTriangleArbitrage();
      await this.demoStablecoinArbitrage();
      await this.demoCrossAssetMomentum();
      await this.demoStrategyOrchestrator();

      const totalTime = Date.now() - startTime;

      logger.info('🎉 === DEMO COMPLETE ===');
      logger.info(`Total execution time: ${Math.round(totalTime / 1000)} seconds`);
      logger.info('\n🔥 New Strategy Capabilities Added:');
      logger.info('  • Triangle Arbitrage: 3-hop cycles for maximum profit');
      logger.info('  • Stablecoin Arbitrage: Low-risk, high-frequency trading');
      logger.info('  • Cross-Asset Momentum: Correlation breakdown exploitation');
      logger.info('  • Strategy Orchestrator: Intelligent multi-strategy coordination');
      logger.info('\n💡 Benefits:');
      logger.info('  • Diversified risk across multiple strategies');
      logger.info('  • Adaptive capital allocation based on performance');
      logger.info('  • Market condition-aware strategy selection');
      logger.info('  • Comprehensive performance tracking and analytics');
      logger.info('  • Production-ready with extensive test coverage');

    } catch (error) {
      logger.error('❌ Demo failed:', error);
      process.exit(1);
    }
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const demo = new NewStrategiesDemo();

  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  switch (command) {
    case 'triangle':
      await demo.demoTriangleArbitrage();
      break;
    case 'stablecoin':
      await demo.demoStablecoinArbitrage();
      break;
    case 'momentum':
      await demo.demoCrossAssetMomentum();
      break;
    case 'orchestrator':
      await demo.demoStrategyOrchestrator();
      break;
    case 'all':
    default:
      await demo.runCompleteDemo();
      break;
  }
}

// Run if this file is executed directly - ES module compatible
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('💥 Demo script failed:', error);
    process.exit(1);
  });
}

export { NewStrategiesDemo };