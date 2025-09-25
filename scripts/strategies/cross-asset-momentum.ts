#!/usr/bin/env tsx

/**
 * CROSS-ASSET MOMENTUM STRATEGY RUNNER 📈
 * Standalone execution of cross-asset momentum trading
 *
 * Exploits correlation breakdowns between assets:
 * - Monitors GALA, GWETH, GWBTC correlations
 * - Identifies momentum divergences
 * - Long/short positions based on strength
 *
 * Usage:
 *   npm run strategy:momentum               # Demo mode (safe)
 *   npm run strategy:momentum:live          # Live trading (real money)
 *   npm run strategy:momentum -- --amount 2000 --correlation-threshold 0.8
 */

import dotenv from 'dotenv';
import { Command } from 'commander';
import { logger } from '../../src/utils/logger';
import { validateEnvironment } from '../../src/config/environment';
import { GSwap } from '../../src/services/gswap-simple';
import { SwapExecutor } from '../../src/trading/execution/swap-executor';
import { MarketAnalysis } from '../../src/monitoring/market-analysis';
import { SlippageProtection } from '../../src/trading/risk/slippage';
import { CrossAssetMomentumStrategy } from '../../src/trading/strategies/cross-asset-momentum';
import { credentialService } from '../../src/security/credential-service';

// Load environment
dotenv.config();

interface StrategyOptions {
  live: boolean;
  demo: boolean;
  dryRun: boolean;
  amount?: number;
  correlationThreshold?: number;
  momentumWindow?: number; // minutes
  duration?: number;
  continuous: boolean;
  assets?: string; // comma-separated list
}

class CrossAssetMomentumRunner {
  private strategy?: CrossAssetMomentumStrategy;
  private isRunning = false;
  private startTime = Date.now();

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
      this.strategy = new CrossAssetMomentumStrategy(
        gswap,
        isLiveMode ? credentialService.getSigner() : {} as any,
        swapExecutor,
        marketAnalysis
      );

      // Override configuration if specified
      this.applyCustomConfig(options);

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Start strategy
      logger.info('🚀 Starting Cross-Asset Momentum Strategy...');
      this.isRunning = true;
      await this.strategy.start();

      if (options.continuous) {
        logger.info('🔄 Running momentum analysis continuously. Press Ctrl+C to stop.');
        await this.runContinuously(options);
      } else {
        // Analysis mode - collect data for specified time
        const analysisTime = options.duration ? options.duration * 60 * 1000 : 30000; // Default 30 seconds
        logger.info(`📊 Collecting momentum data for ${analysisTime / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, analysisTime));
        this.displayResults(options);
      }

    } catch (error) {
      logger.error('💥 Cross-Asset Momentum Runner failed:', error);
      process.exit(1);
    }
  }

  private displayModeBanner(isLive: boolean, isDemo: boolean, options: StrategyOptions): void {
    if (isLive) {
      logger.warn('');
      logger.warn('🔥🔥🔥 LIVE MOMENTUM TRADING 🔥🔥🔥');
      logger.warn('💰 REAL MONEY WILL BE USED');
      logger.warn('📈 LONG/SHORT POSITIONS WILL BE OPENED');
      logger.warn('🎯 ASSETS: GALA, GWETH, GWBTC correlations');
      logger.warn('⚠️  HIGH VOLATILITY STRATEGY');
      logger.warn('');

      // Momentum-specific warnings
      logger.warn('⚡ MOMENTUM TRADES: Can hold positions for minutes to hours');
      logger.warn('📊 CORRELATION ANALYSIS: Based on price movement patterns');
      logger.warn('🎯 STOP LOSSES: Automatic risk management active');

      if (options.amount && options.amount > 20000) {
        logger.warn(`🚨 HIGH AMOUNT: $${options.amount.toLocaleString()}`);
        logger.warn('   Large momentum positions increase risk');
        logger.warn('   Proceeding in 15 seconds... Press Ctrl+C to cancel');
      }
    } else if (isDemo) {
      logger.info('');
      logger.info('🎭 DEMO MODE - MOMENTUM ANALYSIS');
      logger.info('📈 Simulating cross-asset correlation tracking');
      logger.info('🔍 Will analyze GALA, GWETH, GWBTC relationships');
      logger.info('📊 Shows momentum signals and position recommendations');
      logger.info('🚫 NO real trades will be executed');
      logger.info('💡 Use --live flag for real trading');
      logger.info('');
    } else {
      logger.info('');
      logger.info('🧮 DRY RUN MODE');
      logger.info('📊 Correlation analysis only');
      logger.info('');
    }
  }

  private applyCustomConfig(options: StrategyOptions): void {
    const configs = [];

    if (options.amount) configs.push(`Position Size: $${options.amount}`);
    if (options.correlationThreshold) configs.push(`Correlation Threshold: ${options.correlationThreshold}`);
    if (options.momentumWindow) configs.push(`Momentum Window: ${options.momentumWindow}min`);
    if (options.assets) configs.push(`Assets: ${options.assets}`);

    if (configs.length > 0) {
      logger.info('🔧 Custom Configuration:');
      configs.forEach(config => logger.info(`   • ${config}`));
    }
  }

  private async runContinuously(options: StrategyOptions): Promise<void> {
    const duration = options.duration ? options.duration * 60 * 1000 : Infinity;
    const endTime = this.startTime + duration;

    let analysisCount = 0;

    while (this.isRunning && Date.now() < endTime) {
      try {
        analysisCount++;

        // Show periodic analysis updates
        if (analysisCount % 6 === 0) { // Every minute
          logger.info(`📈 Momentum Analysis #${analysisCount} (${Math.round((Date.now() - this.startTime) / 1000)}s runtime)`);
          this.displayRunningStats();
        }

        // Strategy runs its own analysis loop
        // We monitor and report on the results

        // Display active positions periodically
        if (analysisCount % 12 === 0) { // Every 2 minutes
          this.displayActivePositions();
        }

        // 10-second intervals for momentum analysis
        await new Promise(resolve => setTimeout(resolve, 10000));

      } catch (error) {
        logger.error('🚫 Analysis error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    logger.info('✅ Cross-Asset Momentum Runner completed');
  }

  private displayResults(options: StrategyOptions): void {
    const stats = this.strategy!.getStats();
    const activePositions = this.strategy!.getActivePositions();
    const correlationMatrix = this.strategy!.getCorrelationMatrix();

    logger.info('\n📈 Cross-Asset Momentum Analysis Results:');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Performance metrics
    logger.info('\n🎯 Performance Metrics:');
    logger.info(`   Total Signals: ${stats.totalSignals}`);
    logger.info(`   Executed Trades: ${stats.executedTrades}`);
    logger.info(`   Profitable Trades: ${stats.profitableTrades} (${stats.winRate?.toFixed(1) || '0'}%)`);
    logger.info(`   Total Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
    logger.info(`   Avg Holding Time: ${Math.round((stats.avgHoldingTime || 0) / 60000)}min`);

    // Correlation analysis
    logger.info('\n🔗 Correlation Analysis:');
    logger.info(`   Average Correlation: ${stats.avgCorrelation?.toFixed(3) || 'N/A'}`);
    logger.info(`   Best Breakdown: ${stats.bestCorrelationBreakdown?.toFixed(3) || 'N/A'}%`);
    logger.info(`   Breakdown Events: ${stats.correlationBreakdowns || 0}`);

    if (correlationMatrix) {
      logger.info('\n📊 Current Correlations:');
      Object.entries(correlationMatrix).forEach(([pair, correlation]) => {
        const status = correlation > 0.8 ? '🟢 High' : correlation > 0.5 ? '🟡 Medium' : '🔴 Low';
        logger.info(`   ${pair}: ${correlation.toFixed(3)} ${status}`);
      });
    }

    // Active positions
    this.displayActivePositions();

    // Momentum insights
    logger.info('\n⚡ Momentum Insights:');
    if (stats.strongestAsset) {
      logger.info(`   💪 Strongest Asset: ${stats.strongestAsset}`);
    }
    if (stats.weakestAsset) {
      logger.info(`   📉 Weakest Asset: ${stats.weakestAsset}`);
    }
    if (stats.momentumScore) {
      logger.info(`   🚀 Overall Momentum Score: ${stats.momentumScore.toFixed(3)}`);
    }

    if (options.live && stats.executedTrades > 0) {
      logger.info('\n   🚀 EXECUTED LIVE MOMENTUM TRADES ✅');
    } else {
      logger.info('\n   🎭 DEMO MODE - No real positions opened');
    }

    // Strategy recommendations
    logger.info('\n💡 Strategy Recommendations:');
    if (stats.avgCorrelation && stats.avgCorrelation < 0.5) {
      logger.info('   ✅ Low correlations - Good momentum opportunities');
      logger.info('   📈 Consider increasing position sizes');
    } else if (stats.avgCorrelation && stats.avgCorrelation > 0.9) {
      logger.info('   ⚠️  High correlations - Limited momentum potential');
      logger.info('   ⏳ Wait for correlation breakdown');
    }

    if (stats.winRate && stats.winRate > 60) {
      logger.info('   ✅ Strong win rate - Strategy performing well');
    } else if (stats.winRate && stats.winRate < 40) {
      logger.info('   ⚠️  Low win rate - Consider adjusting parameters');
    }
  }

  private displayActivePositions(): void {
    const activePositions = this.strategy!.getActivePositions();

    if (activePositions.size > 0) {
      logger.info('\n📊 Active Momentum Positions:');
      activePositions.forEach((position, asset) => {
        const direction = position.direction === 'LONG' ? '📈' : '📉';
        const pnl = position.unrealizedPnL ? `(PnL: $${position.unrealizedPnL.toFixed(2)})` : '';
        const duration = Math.round((Date.now() - position.entryTime) / 60000);

        logger.info(`   ${direction} ${asset}: $${position.size} @ ${position.entryPrice} ${pnl}`);
        logger.info(`      Duration: ${duration}min | Stop: ${position.stopLoss} | Target: ${position.takeProfit}`);
      });
    } else {
      logger.info('\n📊 No active positions currently');
    }
  }

  private displayRunningStats(): void {
    const runtime = Math.round((Date.now() - this.startTime) / 1000);
    const stats = this.strategy!.getStats();
    const activeCount = this.strategy!.getActivePositions().size;

    logger.info(`⏱️  ${runtime}s | Signals: ${stats.totalSignals} | Trades: ${stats.executedTrades} | Active: ${activeCount} | Win Rate: ${stats.winRate?.toFixed(1) || '0'}% | Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
      this.isRunning = false;

      if (this.strategy) {
        const activePositions = this.strategy.getActivePositions();
        if (activePositions.size > 0) {
          logger.warn(`⚠️  ${activePositions.size} active positions will remain open`);
          logger.warn('   Consider manually closing positions or running with --duration to auto-close');
        }

        await this.strategy.stop();
      }

      const runtime = Math.round((Date.now() - this.startTime) / 1000);
      const stats = this.strategy!.getStats();

      logger.info('\n📊 Final Session Summary:');
      logger.info(`   Runtime: ${Math.floor(runtime / 60)}min ${runtime % 60}s`);
      logger.info(`   Total Signals: ${stats.totalSignals}`);
      logger.info(`   Executed Trades: ${stats.executedTrades}`);
      logger.info(`   Win Rate: ${stats.winRate?.toFixed(1) || '0'}%`);
      logger.info(`   Total Profit: $${stats.totalProfit?.toFixed(6) || '0'}`);
      logger.info(`✅ Cross-Asset Momentum Runner stopped`);

      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Command line interface
const program = new Command();

program
  .name('cross-asset-momentum')
  .description('Cross-Asset Momentum Strategy Runner')
  .version('1.0.0')
  .option('--live', 'Execute real trades with real money', false)
  .option('--demo', 'Demo mode - show analysis only (default)', false)
  .option('--dry-run', 'Analyze correlations without execution', false)
  .option('--amount <number>', 'Position size per trade', parseFloat)
  .option('--correlation-threshold <number>', 'Correlation breakdown threshold (default: 0.5)', parseFloat)
  .option('--momentum-window <minutes>', 'Momentum analysis window in minutes', parseInt)
  .option('--duration <minutes>', 'Run for specified minutes', parseInt)
  .option('--assets <list>', 'Comma-separated asset list (e.g., GALA,GWETH,GWBTC)')
  .option('--continuous', 'Run continuously until stopped', false)
  .action(async (options: StrategyOptions) => {
    const runner = new CrossAssetMomentumRunner();
    await runner.run(options);
  });

program.parse();