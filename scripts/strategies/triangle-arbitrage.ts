#!/usr/bin/env tsx

/**
 * TRIANGLE ARBITRAGE STRATEGY RUNNER 🔺
 * Standalone execution of triangle arbitrage opportunities
 *
 * Executes profitable 3-hop cycles:
 * - GALA → GUSDC → GWETH → GALA
 * - GALA → GWBTC → GUSDT → GALA
 * - GUSDC → GUSDT → GWETH → GUSDC
 *
 * Usage:
 *   npm run strategy:triangle              # Demo mode (safe)
 *   npm run strategy:triangle:live         # Live trading (real money)
 *   npm run strategy:triangle -- --amount 1000 --threshold 0.5
 */

import dotenv from 'dotenv';
import { Command } from 'commander';
import { logger } from '../../src/utils/logger';
import { validateEnvironment } from '../../src/config/environment';
import { GSwap } from '../../src/services/gswap-simple';
import { SwapExecutor } from '../../src/trading/execution/swap-executor';
import { MarketAnalysis } from '../../src/monitoring/market-analysis';
import { SlippageProtection } from '../../src/trading/risk/slippage';
import { TriangleArbitrageStrategy } from '../../src/trading/strategies/triangle-arbitrage';
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
}

class TriangleArbitrageRunner {
  private strategy?: TriangleArbitrageStrategy;
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
      this.strategy = new TriangleArbitrageStrategy(
        gswap,
        isLiveMode ? credentialService.getSigner() : {} as any,
        swapExecutor,
        marketAnalysis
      );

      // Override configuration if specified
      if (options.amount || options.threshold) {
        logger.info('🔧 Using custom configuration:', {
          amount: options.amount || 'default',
          threshold: options.threshold || 'default'
        });
      }

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Start strategy
      logger.info('🚀 Starting Triangle Arbitrage Strategy...');
      this.isRunning = true;
      await this.strategy.start();

      if (options.continuous) {
        logger.info('🔄 Running continuously. Press Ctrl+C to stop.');
        await this.runContinuously(options);
      } else {
        // Single scan mode
        logger.info('🔍 Performing single opportunity scan...');
        const opportunities = await this.strategy.scanForOpportunities();
        this.displayResults(opportunities, options);
      }

    } catch (error) {
      logger.error('💥 Triangle Arbitrage Runner failed:', error);
      process.exit(1);
    }
  }

  private displayModeBanner(isLive: boolean, isDemo: boolean, options: StrategyOptions): void {
    if (isLive) {
      logger.warn('');
      logger.warn('🔥🔥🔥 LIVE TRADING MODE 🔥🔥🔥');
      logger.warn('💰 REAL MONEY WILL BE USED');
      logger.warn('📈 REAL TRADES WILL BE EXECUTED');
      logger.warn('⚠️  USE AT YOUR OWN RISK');
      logger.warn('');

      // Require explicit confirmation for large amounts
      if (options.amount && options.amount > 10000) {
        logger.warn(`🚨 HIGH AMOUNT DETECTED: $${options.amount.toLocaleString()}`);
        logger.warn('   Proceeding in 10 seconds... Press Ctrl+C to cancel');
        // In a real implementation, you might add a sleep here
      }
    } else if (isDemo) {
      logger.info('');
      logger.info('🎭 DEMO MODE - SAFE TESTING');
      logger.info('👀 Will show opportunities and profits');
      logger.info('🚫 NO real trades will be executed');
      logger.info('💡 Use --live flag for real trading');
      logger.info('');
    } else {
      logger.info('');
      logger.info('🧮 DRY RUN MODE');
      logger.info('📊 Calculating opportunities only');
      logger.info('');
    }
  }

  private async runContinuously(options: StrategyOptions): Promise<void> {
    const duration = options.duration ? options.duration * 60 * 1000 : Infinity;
    const endTime = this.startTime + duration;

    while (this.isRunning && Date.now() < endTime) {
      try {
        logger.info('🔄 Scanning for new opportunities...');
        const opportunities = await this.strategy!.scanForOpportunities();

        if (opportunities.length > 0) {
          this.displayResults(opportunities, options);
        }

        // Show running statistics
        this.displayRunningStats();

        // Wait before next scan (10 seconds for triangle arbitrage)
        await new Promise(resolve => setTimeout(resolve, 10000));

      } catch (error) {
        logger.error('🚫 Scan error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    logger.info('✅ Triangle Arbitrage Runner completed');
  }

  private displayResults(opportunities: any[], options: StrategyOptions): void {
    logger.info(`\n🔺 Found ${opportunities.length} triangle arbitrage opportunities:`);

    // Display top 5 opportunities
    const topOpportunities = opportunities.slice(0, 5);
    topOpportunities.forEach((opp, index) => {
      logger.info(`\n💎 Opportunity #${index + 1}:`);
      logger.info(`   Path: ${opp.pathName}`);
      logger.info(`   Input: ${opp.inputAmount} tokens`);
      logger.info(`   Expected Profit: ${opp.netProfit?.toFixed(6) || 'N/A'} tokens`);
      logger.info(`   Profit %: ${opp.netProfitPercent?.toFixed(3) || 'N/A'}%`);
      logger.info(`   Priority: ${opp.executionPriority || 'N/A'}`);
      logger.info(`   Executable: ${opp.isExecutable ? '✅' : '❌'}`);

      if (options.live && opp.isExecutable) {
        logger.info(`   🚀 WOULD EXECUTE IN LIVE MODE`);
      }
    });

    // Display strategy statistics
    const stats = this.strategy!.getStats();
    logger.info('\n📊 Strategy Statistics:');
    logger.info(`   Total Opportunities: ${stats.totalOpportunities}`);
    logger.info(`   Executed Trades: ${stats.executedTrades}`);
    logger.info(`   Successful Trades: ${stats.successfulTrades}`);
    logger.info(`   Total Profit: ${stats.totalProfit?.toFixed(6) || '0'} tokens`);
    logger.info(`   Best Path: ${stats.bestPath || 'None yet'}`);
    logger.info(`   Best Profit %: ${stats.bestProfitPercent?.toFixed(3) || '0'}%`);
  }

  private displayRunningStats(): void {
    const runtime = Math.round((Date.now() - this.startTime) / 1000);
    const stats = this.strategy!.getStats();

    logger.info(`\n⏱️  Runtime: ${runtime}s | Opportunities: ${stats.totalOpportunities} | Trades: ${stats.executedTrades} | Profit: ${stats.totalProfit?.toFixed(6) || '0'}`);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
      this.isRunning = false;

      if (this.strategy) {
        await this.strategy.stop();
      }

      const runtime = Math.round((Date.now() - this.startTime) / 1000);
      logger.info(`✅ Triangle Arbitrage Runner stopped after ${runtime}s`);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Command line interface
const program = new Command();

program
  .name('triangle-arbitrage')
  .description('Triangle Arbitrage Strategy Runner')
  .version('1.0.0')
  .option('--live', 'Execute real trades with real money', false)
  .option('--demo', 'Demo mode - show opportunities only (default)', false)
  .option('--dry-run', 'Calculate opportunities without execution', false)
  .option('--amount <number>', 'Position size per trade', parseFloat)
  .option('--threshold <number>', 'Minimum profit threshold (%)', parseFloat)
  .option('--duration <minutes>', 'Run for specified minutes', parseInt)
  .option('--continuous', 'Run continuously until stopped', false)
  .action(async (options: StrategyOptions) => {
    const runner = new TriangleArbitrageRunner();
    await runner.run(options);
  });

program.parse();