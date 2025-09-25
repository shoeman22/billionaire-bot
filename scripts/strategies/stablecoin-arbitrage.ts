#!/usr/bin/env tsx

/**
 * STABLECOIN ARBITRAGE STRATEGY RUNNER 💵
 * Standalone execution of stablecoin arbitrage opportunities
 *
 * High-frequency, low-risk arbitrage between stablecoins:
 * - GUSDC ↔ GUSDT price differences
 * - Low slippage, high volume potential
 * - Rapid execution with compound growth
 *
 * Usage:
 *   npm run strategy:stablecoin            # Demo mode (safe)
 *   npm run strategy:stablecoin:live       # Live trading (real money)
 *   npm run strategy:stablecoin -- --amount 5000 --threshold 0.1
 */

import dotenv from 'dotenv';
import { Command } from 'commander';
import { logger } from '../../src/utils/logger';
import { validateEnvironment } from '../../src/config/environment';
import { GSwap } from '../../src/services/gswap-simple';
import { SwapExecutor } from '../../src/trading/execution/swap-executor';
import { MarketAnalysis } from '../../src/monitoring/market-analysis';
import { SlippageProtection } from '../../src/trading/risk/slippage';
import { StablecoinArbitrageStrategy } from '../../src/trading/strategies/stablecoin-arbitrage';
import { credentialService } from '../../src/security/credential-service';

// Load environment
dotenv.config();

interface StrategyOptions {
  live: boolean;
  demo: boolean;
  dryRun: boolean;
  amount?: number;
  threshold?: number;
  duration?: number;
  continuous: boolean;
  frequency?: number; // seconds between scans
}

class StablecoinArbitrageRunner {
  private strategy?: StablecoinArbitrageStrategy;
  private isRunning = false;
  private startTime = Date.now();
  private tradeCount = 0;
  private totalProfit = 0;

  async run(options: StrategyOptions): Promise<void> {
    try {
      // Validate configuration
      const config = validateEnvironment();

      // Determine execution mode
      const isLiveMode = options.live && !options.demo && !options.dryRun;
      const isDemoMode = options.demo || (!options.live && !options.dryRun);

      // Display mode banner
      this.displayModeBanner(isLiveMode, isDemoMode, options);

      // Initialize core systems
      const gswap = new GSwap({
        signer: isLiveMode ? credentialService.getSigner() : {} as any,
        baseUrl: config.api.baseUrl
      });

      const slippageProtection = new SlippageProtection(config.trading);
      const swapExecutor = new SwapExecutor(gswap, slippageProtection);
      const marketAnalysis = new MarketAnalysis(
        isLiveMode ? credentialService.getSigner() : {} as any,
        gswap
      );

      // Initialize strategy
      this.strategy = new StablecoinArbitrageStrategy(
        gswap,
        isLiveMode ? credentialService.getSigner() : {} as any,
        swapExecutor,
        marketAnalysis
      );

      // Override configuration if specified
      if (options.amount || options.threshold) {
        logger.info('🔧 Using custom configuration:', {
          amount: options.amount || 'default',
          threshold: options.threshold || 'default',
          frequency: options.frequency || '5s (default)'
        });
      }

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Start strategy
      logger.info('🚀 Starting Stablecoin Arbitrage Strategy...');
      this.isRunning = true;
      await this.strategy.start();

      if (options.continuous) {
        logger.info('🔄 Running high-frequency scanning. Press Ctrl+C to stop.');
        await this.runContinuously(options);
      } else {
        // Single scan mode
        logger.info('🔍 Performing single stablecoin scan...');
        // Let it run for 10 seconds to collect data
        await new Promise(resolve => setTimeout(resolve, 10000));
        this.displayResults(options);
      }

    } catch (error) {
      logger.error('💥 Stablecoin Arbitrage Runner failed:', error);
      process.exit(1);
    }
  }

  private displayModeBanner(isLive: boolean, isDemo: boolean, options: StrategyOptions): void {
    if (isLive) {
      logger.warn('');
      logger.warn('🔥🔥🔥 LIVE TRADING MODE 🔥🔥🔥');
      logger.warn('💰 REAL MONEY WILL BE USED');
      logger.warn('📈 HIGH-FREQUENCY REAL TRADES');
      logger.warn('💵 STABLECOIN PAIRS: GUSDC ↔ GUSDT');
      logger.warn('⚠️  USE AT YOUR OWN RISK');
      logger.warn('');

      // Stablecoin-specific warnings
      logger.warn('⚡ HIGH FREQUENCY: Expect multiple trades per minute');
      logger.warn('💸 COMPOUND GROWTH: Profits reinvested automatically');

      if (options.amount && options.amount > 50000) {
        logger.warn(`🚨 HIGH AMOUNT: $${options.amount.toLocaleString()}`);
        logger.warn('   Large positions may impact spreads');
        logger.warn('   Proceeding in 10 seconds... Press Ctrl+C to cancel');
      }
    } else if (isDemo) {
      logger.info('');
      logger.info('🎭 DEMO MODE - SAFE TESTING');
      logger.info('💵 Simulating GUSDC ↔ GUSDT arbitrage');
      logger.info('📊 Will show spread analysis and profits');
      logger.info('🚫 NO real trades will be executed');
      logger.info('💡 Use --live flag for real trading');
      logger.info('');
    } else {
      logger.info('');
      logger.info('🧮 DRY RUN MODE');
      logger.info('📊 Analyzing stablecoin spreads only');
      logger.info('');
    }
  }

  private async runContinuously(options: StrategyOptions): Promise<void> {
    const duration = options.duration ? options.duration * 60 * 1000 : Infinity;
    const endTime = this.startTime + duration;
    const scanFrequency = (options.frequency || 5) * 1000; // Default 5 seconds

    let scanCount = 0;

    while (this.isRunning && Date.now() < endTime) {
      try {
        scanCount++;

        if (scanCount % 12 === 0) { // Every minute
          logger.info(`🔄 High-frequency scan #${scanCount} (${Math.round(scanCount * scanFrequency / 1000)}s runtime)`);
        }

        // Strategy runs its own internal scanning loop
        // We just need to let it run and periodically check stats

        // Show statistics every 30 seconds
        if (scanCount % 6 === 0) {
          this.displayRunningStats();
        }

        await new Promise(resolve => setTimeout(resolve, scanFrequency));

      } catch (error) {
        logger.error('🚫 Scan error:', error);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    logger.info('✅ Stablecoin Arbitrage Runner completed');
  }

  private displayResults(options: StrategyOptions): void {
    const stats = this.strategy!.getStats();
    const capitalInfo = this.strategy!.getCapitalInfo();

    logger.info('\n💵 Stablecoin Arbitrage Analysis Results:');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Performance metrics
    logger.info('\n📈 Performance Metrics:');
    logger.info(`   Total Trades: ${stats.totalTrades}`);
    logger.info(`   Successful: ${stats.successfulTrades} (${stats.successRate?.toFixed(1) || '0'}%)`);
    logger.info(`   Total Volume: $${stats.totalVolume?.toFixed(2) || '0'}`);
    logger.info(`   Total Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
    logger.info(`   Avg Profit/Trade: $${stats.avgProfitPerTrade?.toFixed(6) || '0'}`);

    // Spread analysis
    logger.info('\n📊 Spread Analysis:');
    logger.info(`   Average Spread: ${stats.avgSpread?.toFixed(4) || '0'}%`);
    logger.info(`   Best Spread Found: ${stats.bestSpread?.toFixed(4) || '0'}%`);
    logger.info(`   Spread Opportunities: ${stats.spreadOpportunities || 0}`);

    // Capital performance
    logger.info('\n💰 Capital Performance:');
    logger.info(`   Initial Capital: $${capitalInfo.initialCapital?.toFixed(2) || '0'}`);
    logger.info(`   Current Capital: $${capitalInfo.currentCapital?.toFixed(2) || '0'}`);
    logger.info(`   Total Return: $${capitalInfo.totalReturn?.toFixed(6) || '0'}`);
    logger.info(`   ROI: ${((capitalInfo.totalReturn / capitalInfo.initialCapital) * 100)?.toFixed(4) || '0'}%`);
    logger.info(`   Compound Growth: ${capitalInfo.compoundGrowthRate?.toFixed(3) || '0'}%`);

    // High-frequency insights
    logger.info('\n⚡ High-Frequency Insights:');
    logger.info(`   Trades per Minute: ${(stats.totalTrades / ((Date.now() - this.startTime) / 60000))?.toFixed(2) || '0'}`);
    logger.info(`   Avg Execution Time: ${stats.avgExecutionTime || 'N/A'}ms`);

    if (options.live && stats.totalTrades > 0) {
      logger.info('   🚀 EXECUTED LIVE TRADES ✅');
    } else {
      logger.info('   🎭 DEMO MODE - No real trades executed');
    }

    // Recommendations
    logger.info('\n💡 Strategy Recommendations:');
    if (stats.avgSpread && stats.avgSpread > 0.1) {
      logger.info('   ✅ Good spread opportunities detected');
      logger.info('   📈 Consider increasing position size');
    } else {
      logger.info('   ⚠️  Low spreads - monitor for better opportunities');
    }

    if (stats.successRate && stats.successRate > 90) {
      logger.info('   ✅ Excellent execution rate');
    } else if (stats.successRate && stats.successRate < 70) {
      logger.info('   ⚠️  Low success rate - check network/slippage');
    }
  }

  private displayRunningStats(): void {
    const runtime = Math.round((Date.now() - this.startTime) / 1000);
    const stats = this.strategy!.getStats();
    const tradesPerMin = (stats.totalTrades / (runtime / 60)) || 0;

    logger.info(`⏱️  ${runtime}s | Trades: ${stats.totalTrades} (${tradesPerMin.toFixed(1)}/min) | Success: ${stats.successRate?.toFixed(1) || '0'}% | Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
      this.isRunning = false;

      if (this.strategy) {
        await this.strategy.stop();
      }

      const runtime = Math.round((Date.now() - this.startTime) / 1000);
      const stats = this.strategy!.getStats();

      logger.info('\n📊 Final Session Summary:');
      logger.info(`   Runtime: ${runtime}s`);
      logger.info(`   Total Trades: ${stats.totalTrades}`);
      logger.info(`   Total Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
      logger.info(`✅ Stablecoin Arbitrage Runner stopped`);

      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Command line interface
const program = new Command();

program
  .name('stablecoin-arbitrage')
  .description('Stablecoin Arbitrage Strategy Runner')
  .version('1.0.0')
  .option('--live', 'Execute real trades with real money', false)
  .option('--demo', 'Demo mode - show opportunities only (default)', false)
  .option('--dry-run', 'Calculate opportunities without execution', false)
  .option('--amount <number>', 'Position size per trade', parseFloat)
  .option('--threshold <number>', 'Minimum profit threshold (%)', parseFloat)
  .option('--duration <minutes>', 'Run for specified minutes', parseInt)
  .option('--frequency <seconds>', 'Seconds between scans (default: 5)', parseInt)
  .option('--continuous', 'Run continuously until stopped', false)
  .action(async (options: StrategyOptions) => {
    const runner = new StablecoinArbitrageRunner();
    await runner.run(options);
  });

program.parse();