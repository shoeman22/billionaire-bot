#!/usr/bin/env tsx

/**
 * STRATEGY ORCHESTRATOR RUNNER 🎭
 * Intelligent coordination of multiple trading strategies
 *
 * Manages multiple strategies simultaneously:
 * - Triangle Arbitrage (3-hop cycles)
 * - Stablecoin Arbitrage (GUSDC ↔ GUSDT)
 * - Cross-Asset Momentum (correlation breakdowns)
 * - Resource allocation and conflict resolution
 *
 * Usage:
 *   npm run strategy:orchestrator           # Demo mode (safe)
 *   npm run strategy:orchestrator:live      # Live trading (real money)
 *   npm run strategy:all                    # All strategies with intelligent coordination
 */

import dotenv from 'dotenv';
import { Command } from 'commander';
import { logger } from '../../src/utils/logger';
import { validateEnvironment } from '../../src/config/environment';
import { GSwap } from '../../src/services/gswap-simple';
import { SwapExecutor } from '../../src/trading/execution/swap-executor';
import { MarketAnalysis } from '../../src/monitoring/market-analysis';
import { SlippageProtection } from '../../src/trading/risk/slippage';
import { StrategyOrchestrator } from '../../src/trading/strategies/strategy-orchestrator';
import { credentialService } from '../../src/security/credential-service';
import { PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { PriceTracker } from '../../src/monitoring/price-tracker';

// Load environment
dotenv.config();

interface OrchestratorOptions {
  live: boolean;
  demo: boolean;
  dryRun: boolean;
  strategies?: string; // comma-separated list
  amount?: number;
  allocation?: string; // percentage allocation per strategy
  duration?: number;
  continuous: boolean;
  rebalance?: number; // minutes between rebalancing
  all: boolean; // run all available strategies
  help: boolean;
}

class StrategyOrchestratorRunner {
  private orchestrator?: StrategyOrchestrator;
  private isRunning = false;
  private startTime = Date.now();

  async run(options: OrchestratorOptions): Promise<void> {
    try {
      // Show help if requested
      if (options.help) {
        this.showHelp();
        return;
      }

      // Validate configuration
      const config = validateEnvironment();

      // Determine execution mode
      const isLiveMode = options.live && !options.demo && !options.dryRun;
      const isDemoMode = options.demo || (!options.live && !options.dryRun);

      // Display mode banner
      this.displayModeBanner(isLiveMode, isDemoMode, options);

      // Parse strategy selection
      const strategiesToUse = options.all ? 'all' : options.strategies;
      const enabledStrategies = this.parseStrategies(strategiesToUse);

      // Initialize core systems
      const signer = isLiveMode ? new PrivateKeySigner(config.wallet.privateKey) : {} as any;
      const gswap = new GSwap({
        signer,
        baseUrl: config.api.baseUrl
      });

      const slippageProtection = new SlippageProtection(config.trading);
      const swapExecutor = new SwapExecutor(gswap, slippageProtection);
      const priceTracker = new PriceTracker();
      const marketAnalysis = new MarketAnalysis(priceTracker, gswap);

      // Initialize orchestrator with correct parameters (it manages its own strategies internally)
      this.orchestrator = new StrategyOrchestrator(gswap, config.trading, swapExecutor, marketAnalysis);

      // Apply custom configuration
      this.applyCustomConfig(options);

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Start orchestrator
      logger.info('🚀 Starting Strategy Orchestrator...');
      this.isRunning = true;
      await this.orchestrator.start();

      if (options.continuous) {
        logger.info('🔄 Running multi-strategy orchestration. Press Ctrl+C to stop.');
        await this.runContinuously(options);
      } else {
        // Analysis mode
        const analysisTime = options.duration ? options.duration * 60 * 1000 : 60000; // Default 1 minute
        logger.info(`📊 Running orchestrated analysis for ${analysisTime / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, analysisTime));
        this.displayResults(options);
      }

    } catch (error) {
      logger.error('💥 Strategy Orchestrator Runner failed:', error);
      process.exit(1);
    }
  }

  private showHelp(): void {
    logger.info(`
🎭 STRATEGY ORCHESTRATOR - Multi-Strategy Trading Coordinator

AVAILABLE STRATEGIES:
  triangle     - Triangle Arbitrage (3-hop cycles)
  stablecoin   - Stablecoin Arbitrage (GUSDC ↔ GUSDT)
  momentum     - Cross-Asset Momentum (correlation breakdowns)

USAGE EXAMPLES:
  npm run strategy:orchestrator                    # Demo all strategies
  npm run strategy:orchestrator:live               # Live all strategies
  npm run strategy:all                             # All strategies (demo)

  # Custom configurations
  npm run strategy:orchestrator -- --strategies triangle,stablecoin
  npm run strategy:orchestrator -- --allocation 40,30,30 --amount 10000
  npm run strategy:orchestrator -- --rebalance 30 --duration 120

PARAMETERS:
  --strategies <list>     Comma-separated strategy list (default: all)
  --allocation <percent>  Capital allocation per strategy (e.g., 40,30,30)
  --amount <number>       Total capital to allocate across strategies
  --rebalance <minutes>   Minutes between portfolio rebalancing (default: 15)
  --duration <minutes>    Run for specified time
  --continuous           Run until manually stopped

MODES:
  --demo         Safe demo mode - no real trades (default)
  --live         Live trading mode - real money
  --dry-run      Analysis only mode

EXAMPLES:
  # Conservative setup with focus on arbitrage
  npm run strategy:orchestrator -- --strategies triangle,stablecoin --allocation 60,40

  # Aggressive momentum with frequent rebalancing
  npm run strategy:orchestrator -- --strategies momentum --rebalance 5 --amount 50000

  # Balanced multi-strategy approach
  npm run strategy:orchestrator -- --allocation 35,35,30 --rebalance 20
`);
  }

  private parseStrategies(strategiesStr?: string): string[] {
    if (!strategiesStr) {
      return ['triangle', 'stablecoin', 'momentum']; // Default: all strategies
    }

    // Handle special case for "all"
    if (strategiesStr.toLowerCase().trim() === 'all') {
      return ['triangle', 'stablecoin', 'momentum'];
    }

    const strategies = strategiesStr.split(',').map(s => s.trim().toLowerCase());
    const valid = ['triangle', 'stablecoin', 'momentum'];

    const invalid = strategies.filter(s => !valid.includes(s));
    if (invalid.length > 0) {
      logger.warn(`⚠️  Invalid strategies ignored: ${invalid.join(', ')}`);
    }

    const validStrategies = strategies.filter(s => valid.includes(s));
    return validStrategies.length > 0 ? validStrategies : ['triangle', 'stablecoin', 'momentum'];
  }

  private parseAllocation(allocationStr?: string, strategyCount: number): number[] {
    if (!allocationStr) {
      // Equal allocation by default
      const equal = Math.floor(100 / strategyCount);
      return new Array(strategyCount).fill(equal);
    }

    const allocations = allocationStr.split(',').map(a => parseInt(a.trim()));

    if (allocations.length !== strategyCount) {
      logger.warn(`⚠️  Allocation count mismatch. Using equal allocation.`);
      const equal = Math.floor(100 / strategyCount);
      return new Array(strategyCount).fill(equal);
    }

    const total = allocations.reduce((sum, alloc) => sum + alloc, 0);
    if (total !== 100) {
      logger.warn(`⚠️  Allocations sum to ${total}%, not 100%. Normalizing...`);
      return allocations.map(alloc => Math.round((alloc / total) * 100));
    }

    return allocations;
  }


  private displayModeBanner(isLive: boolean, isDemo: boolean, options: OrchestratorOptions): void {
    if (isLive) {
      logger.warn('');
      logger.warn('🔥🔥🔥 LIVE ORCHESTRATED TRADING 🔥🔥🔥');
      logger.warn('💰 REAL MONEY ACROSS MULTIPLE STRATEGIES');
      logger.warn('🎭 INTELLIGENT STRATEGY COORDINATION');
      logger.warn('⚡ AUTOMATIC CAPITAL REBALANCING');
      logger.warn('⚠️  MAXIMUM COMPLEXITY & RISK');
      logger.warn('');

      logger.warn('🎯 ACTIVE STRATEGIES:');
      const strategiesToUse = options.all ? 'all' : options.strategies;
      const strategies = this.parseStrategies(strategiesToUse);
      strategies.forEach(strategy => {
        logger.warn(`   • ${strategy.toUpperCase()}: Real execution enabled`);
      });

      if (options.amount && options.amount > 50000) {
        logger.warn(`🚨 HIGH CAPITAL: $${options.amount.toLocaleString()}`);
        logger.warn('   Distributed across multiple strategies');
        logger.warn('   Proceeding in 15 seconds... Press Ctrl+C to cancel');
      }
    } else if (isDemo) {
      logger.info('');
      logger.info('🎭 DEMO MODE - ORCHESTRATED ANALYSIS');
      logger.info('📊 Simulating multi-strategy coordination');
      logger.info('⚡ Shows capital allocation and rebalancing');
      logger.info('🚫 NO real trades across any strategy');
      logger.info('💡 Use --live flag for real orchestrated trading');

      const strategiesToUse = options.all ? 'all' : options.strategies;
      const strategies = this.parseStrategies(strategiesToUse);
      logger.info('\n🎯 DEMO STRATEGIES:');
      strategies.forEach((strategy, index) => {
        logger.info(`   ${index + 1}. ${strategy.toUpperCase()}: Analysis mode`);
      });
      logger.info('');
    } else {
      logger.info('');
      logger.info('🧮 DRY RUN MODE - STRATEGY ANALYSIS');
      logger.info('📊 Multi-strategy opportunity analysis');
      logger.info('');
    }
  }

  private applyCustomConfig(options: OrchestratorOptions): void {
    const configs = [];

    if (options.amount) configs.push(`Total Capital: $${options.amount.toLocaleString()}`);
    if (options.allocation) configs.push(`Custom Allocation: ${options.allocation}`);
    if (options.rebalance) configs.push(`Rebalance Frequency: ${options.rebalance}min`);

    if (configs.length > 0) {
      logger.info('🔧 Orchestrator Configuration:');
      configs.forEach(config => logger.info(`   • ${config}`));
    }
  }

  private async runContinuously(options: OrchestratorOptions): Promise<void> {
    const duration = options.duration ? options.duration * 60 * 1000 : Infinity;
    const endTime = this.startTime + duration;

    let cycleCount = 0;

    while (this.isRunning && Date.now() < endTime) {
      try {
        cycleCount++;

        // Show orchestration status every 2 minutes
        if (cycleCount % 12 === 0) {
          logger.info(`🎭 Orchestration Cycle #${cycleCount} (${Math.round((Date.now() - this.startTime) / 1000)}s runtime)`);
          this.displayRunningStats();
        }

        // Show detailed analysis every 5 minutes
        if (cycleCount % 30 === 0) {
          this.displayPortfolioAllocation();
        }

        // 10-second monitoring intervals
        await new Promise(resolve => setTimeout(resolve, 10000));

      } catch (error) {
        logger.error('🚫 Orchestration error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    logger.info('✅ Strategy Orchestrator completed');
  }

  private displayResults(options: OrchestratorOptions): void {
    const stats = this.orchestrator!.getStats();
    const allocation = this.orchestrator!.getCurrentAllocation();

    logger.info('\n🎭 Strategy Orchestrator Analysis Results:');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Overall performance
    logger.info('\n📊 Orchestrated Performance:');
    logger.info(`   Total Strategies: ${stats.activeStrategies}`);
    logger.info(`   Combined Trades: ${stats.totalTrades}`);
    logger.info(`   Overall Success Rate: ${stats.overallSuccessRate?.toFixed(1) || '0'}%`);
    logger.info(`   Combined Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
    logger.info(`   Best Performing Strategy: ${stats.bestStrategy || 'N/A'}`);

    // Capital allocation
    logger.info('\n💰 Capital Allocation:');
    Object.entries(allocation).forEach(([strategy, amount]) => {
      const percentage = ((amount / Object.values(allocation).reduce((sum, val) => sum + val, 0)) * 100).toFixed(1);
      logger.info(`   ${strategy}: $${amount.toFixed(2)} (${percentage}%)`);
    });

    // Strategy-specific performance
    logger.info('\n🎯 Individual Strategy Performance:');
    if (stats.strategyBreakdown) {
      Object.entries(stats.strategyBreakdown).forEach(([strategy, strategyStats]: [string, any]) => {
        logger.info(`   \n📈 ${strategy.toUpperCase()}:`);
        logger.info(`      Trades: ${strategyStats.trades || 0}`);
        logger.info(`      Success: ${strategyStats.successRate?.toFixed(1) || '0'}%`);
        logger.info(`      Profit: $${strategyStats.profit?.toFixed(6) || '0'}`);
        logger.info(`      Status: ${strategyStats.status || 'Unknown'}`);
      });
    }

    // Rebalancing activity
    logger.info('\n⚖️  Rebalancing Activity:');
    logger.info(`   Rebalance Events: ${stats.rebalanceCount || 0}`);
    logger.info(`   Last Rebalance: ${stats.lastRebalance || 'Never'}`);
    logger.info(`   Portfolio Drift: ${stats.portfolioDrift?.toFixed(2) || '0'}%`);

    if (options.live && stats.totalTrades > 0) {
      logger.info('\n   🚀 EXECUTED LIVE ORCHESTRATED TRADES ✅');
    } else {
      logger.info('\n   🎭 DEMO MODE - No real trades executed');
    }

    // Orchestration insights
    logger.info('\n💡 Orchestration Insights:');
    if (stats.bestStrategy) {
      logger.info(`   ✅ ${stats.bestStrategy} is currently outperforming`);
      logger.info('   📈 Consider increasing allocation to this strategy');
    }

    if (stats.overallSuccessRate && stats.overallSuccessRate > 70) {
      logger.info('   ✅ Strong combined performance across strategies');
    } else if (stats.overallSuccessRate && stats.overallSuccessRate < 50) {
      logger.info('   ⚠️  Overall performance below expectations');
      logger.info('   🔍 Consider strategy parameter adjustments');
    }

    if (stats.rebalanceCount && stats.rebalanceCount > 5) {
      logger.info('   ⚡ High rebalancing activity - volatile market conditions');
    }
  }

  private displayRunningStats(): void {
    const runtime = Math.round((Date.now() - this.startTime) / 1000);
    const stats = this.orchestrator!.getStats();

    logger.info(`⏱️  ${runtime}s | Strategies: ${stats.activeStrategies} | Combined Trades: ${stats.totalTrades} | Success: ${stats.overallSuccessRate?.toFixed(1) || '0'}% | Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
  }

  private displayPortfolioAllocation(): void {
    const allocation = this.orchestrator!.getCurrentAllocation();
    const stats = this.orchestrator!.getStats();

    logger.info('\n📊 Portfolio Allocation Status:');
    Object.entries(allocation).forEach(([strategy, amount]) => {
      const performance = stats.strategyBreakdown?.[strategy];
      const status = performance?.status || 'Unknown';
      const profit = performance?.profit?.toFixed(6) || '0';

      logger.info(`   ${strategy}: $${amount.toFixed(2)} | Status: ${status} | P&L: $${profit}`);
    });

    if (stats.portfolioDrift && stats.portfolioDrift > 10) {
      logger.info(`   ⚠️  High portfolio drift: ${stats.portfolioDrift.toFixed(2)}%`);
      logger.info(`   🔄 Rebalancing recommended`);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`\n🛑 Received ${signal}, shutting down orchestrator gracefully...`);
      this.isRunning = false;

      if (this.orchestrator) {
        logger.info('🎭 Stopping all orchestrated strategies...');
        await this.orchestrator.stop();

        const stats = this.orchestrator.getStats();
        logger.info('\n📊 Final Orchestration Summary:');
        logger.info(`   Runtime: ${Math.floor((Date.now() - this.startTime) / 60000)}min`);
        logger.info(`   Active Strategies: ${stats.activeStrategies}`);
        logger.info(`   Total Trades: ${stats.totalTrades}`);
        logger.info(`   Combined Success Rate: ${stats.overallSuccessRate?.toFixed(1) || '0'}%`);
        logger.info(`   Total Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
        logger.info(`   Best Strategy: ${stats.bestStrategy || 'N/A'}`);
      }

      logger.info('✅ Strategy Orchestrator stopped');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Command line interface
const program = new Command();

program
  .name('strategy-orchestrator')
  .description('Multi-Strategy Orchestration Runner')
  .version('1.0.0')
  .option('--live', 'Execute real trades with real money', false)
  .option('--demo', 'Demo mode - show analysis only (default)', false)
  .option('--dry-run', 'Analysis only without execution', false)
  .option('--strategies <list>', 'Comma-separated strategy list (triangle,stablecoin,momentum)')
  .option('--amount <number>', 'Total capital to allocate', parseFloat)
  .option('--allocation <percentages>', 'Capital allocation per strategy (e.g., 40,30,30)')
  .option('--rebalance <minutes>', 'Minutes between rebalancing (default: 15)', parseInt)
  .option('--duration <minutes>', 'Run for specified minutes', parseInt)
  .option('--continuous', 'Run continuously until stopped', false)
  .option('--all', 'Run all available strategies with optimal allocation', false)
  .option('--help', 'Show detailed help information', false)
  .action(async (options: OrchestratorOptions) => {
    const runner = new StrategyOrchestratorRunner();
    await runner.run(options);
  });

program.parse();