#!/usr/bin/env tsx

/**
 * SMART ARBITRAGE LOOP CONTROLLER 🔄
 *
 * Controlled looping execution of arbitrage strategies with:
 * - Rate limit detection and exponential backoff
 * - Configurable delays between runs
 * - Clean shutdown handling
 * - Basic profit tracking
 * - Support for both single-pair and multi-pair modes
 */

import { config } from 'dotenv';
import { logger } from '../src/utils/logger';
import { executeArbitrage, ArbitrageResult } from '../src/trading/execution/arbitrage-executor';
import { executeExoticArbitrage, ExoticArbitrageResult, ExoticArbitrageConfig } from '../src/trading/execution/exotic-arbitrage-executor';

config();

interface LoopConfig {
  mode: 'full' | 'multi' | 'triangular' | 'cross-pair' | 'exotic-hunt';
  delayBetweenRuns: number; // seconds
  maxConsecutiveErrors: number;
  exponentialBackoffBase: number; // seconds
  maxBackoffDelay: number; // seconds
  maxRunDuration?: number; // minutes, undefined for infinite
}

interface LoopStats {
  totalRuns: number;
  successfulRuns: number;
  errorRuns: number;
  consecutiveErrors: number;
  totalProfit: number;
  startTime: number;
  lastSuccessTime: number;
}

class ArbitrageLoopController {
  private config: LoopConfig;
  private stats: LoopStats;
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private signalCount: number = 0;

  constructor(config: Partial<LoopConfig> = {}) {
    this.config = {
      mode: 'full',
      delayBetweenRuns: 45, // 45 seconds default
      maxConsecutiveErrors: 5,
      exponentialBackoffBase: 30, // 30 seconds
      maxBackoffDelay: 300, // 5 minutes max
      ...config
    };

    this.stats = {
      totalRuns: 0,
      successfulRuns: 0,
      errorRuns: 0,
      consecutiveErrors: 0,
      totalProfit: 0,
      startTime: Date.now(),
      lastSuccessTime: 0
    };

    this.setupSignalHandlers();
  }

  private setupSignalHandlers(): void {
    // Handle Ctrl+C gracefully with debouncing
    process.on('SIGINT', () => {
      this.signalCount++;

      if (this.signalCount === 1) {
        logger.info('🛑 Received shutdown signal, stopping loop gracefully...');
        logger.info('💡 Press Ctrl+C again within 3 seconds to force exit');
        this.shouldStop = true;

        // Reset signal count after 3 seconds
        setTimeout(() => {
          this.signalCount = 0;
        }, 3000);

      } else if (this.signalCount >= 2) {
        logger.info('🚨 Force exit requested, stopping immediately...');
        process.exit(0);
      }
    });

    // Handle other termination signals
    process.on('SIGTERM', () => {
      logger.info('🛑 Received SIGTERM, stopping loop...');
      this.shouldStop = true;

      // Force exit after 5 seconds if process doesn't stop gracefully
      setTimeout(() => {
        logger.info('🚨 Force exit after timeout...');
        process.exit(0);
      }, 5000);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('⚠️ Arbitrage loop is already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 Starting Smart Arbitrage Loop Controller');
    logger.info(`⚙️ Configuration:`);
    logger.info(`   Mode: ${this.config.mode}`);
    logger.info(`   Delay between runs: ${this.config.delayBetweenRuns}s`);
    logger.info(`   Max consecutive errors: ${this.config.maxConsecutiveErrors}`);
    logger.info(`   Max run duration: ${this.config.maxRunDuration ? this.config.maxRunDuration + 'm' : 'infinite'}`);

    // Start stats reporting
    const statsInterval = setInterval(() => {
      this.logStats();
    }, 60000); // Every minute

    // Main loop
    try {
      while (this.isRunning && !this.shouldStop) {
        // Check duration limit
        if (this.config.maxRunDuration) {
          const elapsed = (Date.now() - this.stats.startTime) / (1000 * 60);
          if (elapsed >= this.config.maxRunDuration) {
            logger.info(`⏰ Maximum run duration (${this.config.maxRunDuration}m) reached, stopping...`);
            break;
          }
        }

        // Check if we should stop before executing
        if (this.shouldStop) {
          logger.info('🛑 Stopping before arbitrage execution...');
          break;
        }

        await this.executeArbitrageRun();

        // Check if we should stop after execution
        if (this.shouldStop) {
          logger.info('🛑 Stopping after arbitrage execution...');
          break;
        }

        // Apply delay with potential exponential backoff
        const delay = this.calculateDelay();
        if (delay > 0 && !this.shouldStop) {
          // Only show initial message for long delays (countdown will handle the rest)
          if (delay > 5) {
            logger.info(`⏳ Waiting ${delay}s before next run...`);
          }
          await this.sleep(delay * 1000);
        }
      }
    } finally {
      clearInterval(statsInterval);
      this.isRunning = false;
      this.logFinalStats();
      logger.info('✅ Arbitrage loop stopped');
    }
  }

  private async executeArbitrageRun(): Promise<void> {
    this.stats.totalRuns++;
    logger.info(`\n🔄 Arbitrage Run #${this.stats.totalRuns} (${this.config.mode} mode)`);

    try {
      // Execute based on mode type
      if (this.config.mode === 'triangular' || this.config.mode === 'cross-pair' || this.config.mode === 'exotic-hunt') {
        // Execute exotic arbitrage
        logger.info(`🌟 Executing ${this.config.mode} exotic arbitrage...`);

        const exoticConfig: ExoticArbitrageConfig = {
          mode: this.config.mode === 'exotic-hunt' ? 'hunt-execute' : this.config.mode as 'triangular' | 'cross-pair',
          inputAmount: 20,
          minProfitThreshold: this.config.mode === 'triangular' ? 1.0 : this.config.mode === 'cross-pair' ? 1.5 : 3.0
        };

        const result: ExoticArbitrageResult = await executeExoticArbitrage(exoticConfig);

        if (result.success) {
          this.stats.successfulRuns++;
          this.stats.consecutiveErrors = 0;
          this.stats.lastSuccessTime = Date.now();

          // Track profit
          if (result.profitAmount) {
            this.stats.totalProfit += result.profitAmount;
          }

          logger.info(`✅ Run #${this.stats.totalRuns} completed successfully`);
          if (result.profitPercent) {
            logger.info(`💰 Profit: ${result.profitPercent.toFixed(2)}%`);
          }
          if (result.route) {
            logger.info(`🔄 Route: ${result.route.symbols.join(' → ')}`);
          }
        } else {
          this.stats.errorRuns++;
          this.stats.consecutiveErrors++;
          logger.info(`📭 Run #${this.stats.totalRuns} found no profitable exotic opportunities`);
          if (result.error) {
            logger.debug(`Details: ${result.error}`);
          }
        }

      } else {
        // Execute standard arbitrage
        logger.info(`📋 Executing ${this.config.mode} arbitrage...`);

        const result: ArbitrageResult = await executeArbitrage({
          mode: this.config.mode as 'full' | 'multi'
        });

        if (result.success) {
          this.stats.successfulRuns++;
          this.stats.consecutiveErrors = 0;
          this.stats.lastSuccessTime = Date.now();

          // Track profit
          if (result.profitAmount) {
            this.stats.totalProfit += result.profitAmount;
          }

          logger.info(`✅ Run #${this.stats.totalRuns} completed successfully`);
          if (result.profitPercent) {
            logger.info(`💰 Profit: ${result.profitPercent.toFixed(2)}%`);
          }
          if (result.route) {
            logger.info(`🔄 Route: ${result.route}`);
          }
        } else {
          this.stats.errorRuns++;
          this.stats.consecutiveErrors++;
          logger.info(`📭 Run #${this.stats.totalRuns} found no profitable opportunities`);
          if (result.error) {
            logger.debug(`Details: ${result.error}`);
          }
        }
      }

    } catch (error) {
      this.stats.errorRuns++;
      this.stats.consecutiveErrors++;

      // Check if it's a rate limiting error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.isRateLimitError(errorMessage)) {
        logger.warn(`🚫 Rate limiting detected in run #${this.stats.totalRuns}`);
      } else {
        logger.error(`❌ Error in run #${this.stats.totalRuns}:`, error);
      }

      // Stop if too many consecutive errors
      if (this.stats.consecutiveErrors >= this.config.maxConsecutiveErrors) {
        logger.error(`💥 Too many consecutive errors (${this.stats.consecutiveErrors}), stopping loop`);
        this.shouldStop = true;
      }
    }
  }

  // parseArbitrageOutput method removed - now using typed result objects instead of string parsing

  private isRateLimitError(errorMessage: string): boolean {
    const rateLimitIndicators = [
      '429',
      'rate limit',
      'too many requests',
      'API rate limit exceeded'
    ];

    return rateLimitIndicators.some(indicator =>
      errorMessage.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  private calculateDelay(): number {
    // Base delay
    let delay = this.config.delayBetweenRuns;

    // Apply exponential backoff for consecutive errors
    if (this.stats.consecutiveErrors > 0) {
      const backoffMultiplier = Math.pow(2, this.stats.consecutiveErrors - 1);
      const backoffDelay = this.config.exponentialBackoffBase * backoffMultiplier;
      delay = Math.min(backoffDelay, this.config.maxBackoffDelay);

      logger.info(`⚠️ Applying exponential backoff: ${delay}s (${this.stats.consecutiveErrors} consecutive errors)`);
    }

    return delay;
  }

  private logStats(): void {
    const elapsed = (Date.now() - this.stats.startTime) / (1000 * 60);
    const successRate = this.stats.totalRuns > 0 ? (this.stats.successfulRuns / this.stats.totalRuns * 100) : 0;

    logger.info(`\n📊 Loop Statistics (${elapsed.toFixed(1)}m elapsed):`);
    logger.info(`   Total runs: ${this.stats.totalRuns}`);
    logger.info(`   Successful: ${this.stats.successfulRuns} (${successRate.toFixed(1)}%)`);
    logger.info(`   Errors: ${this.stats.errorRuns}`);
    logger.info(`   Consecutive errors: ${this.stats.consecutiveErrors}`);

    if (this.stats.lastSuccessTime > 0) {
      const timeSinceSuccess = (Date.now() - this.stats.lastSuccessTime) / (1000 * 60);
      logger.info(`   Last success: ${timeSinceSuccess.toFixed(1)}m ago`);
    }
  }

  private logFinalStats(): void {
    const totalTime = (Date.now() - this.stats.startTime) / (1000 * 60);
    const successRate = this.stats.totalRuns > 0 ? (this.stats.successfulRuns / this.stats.totalRuns * 100) : 0;

    logger.info(`\n📋 Final Statistics:`);
    logger.info(`   Total runtime: ${totalTime.toFixed(1)} minutes`);
    logger.info(`   Total runs: ${this.stats.totalRuns}`);
    logger.info(`   Successful runs: ${this.stats.successfulRuns}`);
    logger.info(`   Success rate: ${successRate.toFixed(1)}%`);
    logger.info(`   Total errors: ${this.stats.errorRuns}`);
  }

  private async sleep(ms: number): Promise<void> {
    const seconds = Math.floor(ms / 1000);

    // Show countdown for delays longer than 5 seconds
    if (seconds > 5) {
      for (let i = seconds; i > 0; i--) {
        // Format countdown display with minutes if needed
        let timeDisplay;
        if (i >= 60) {
          const mins = Math.floor(i / 60);
          const secs = i % 60;
          timeDisplay = `${mins}m ${secs}s`;
        } else {
          timeDisplay = `${i}s`;
        }

        // Use process.stdout.write to update same line
        process.stdout.write(`\r⏳ Next run in: ${timeDisplay}... `);

        // Check if we should stop during countdown
        if (this.shouldStop) {
          process.stdout.write('\r🛑 Stopping countdown...\n');
          return;
        }

        // Check shouldStop more frequently during the 1-second wait
        for (let j = 0; j < 10; j++) {
          if (this.shouldStop) {
            process.stdout.write('\r🛑 Stopping countdown...\n');
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms checks
        }
      }

      // Clear the countdown line and add newline
      process.stdout.write('\r⏳ Starting next run...     \n');
    } else {
      // For short delays, just use regular sleep
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  stop(): void {
    logger.info('🛑 Stopping arbitrage loop...');
    this.shouldStop = true;
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const config: Partial<LoopConfig> = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mode':
        config.mode = args[++i] as 'full' | 'multi' | 'triangular' | 'cross-pair' | 'exotic-hunt';
        break;
      case '--delay':
        config.delayBetweenRuns = parseInt(args[++i]);
        break;
      case '--duration':
        config.maxRunDuration = parseInt(args[++i]);
        break;
      case '--max-errors':
        config.maxConsecutiveErrors = parseInt(args[++i]);
        break;
      case '--help':
        printHelp();
        return;
    }
  }

  const controller = new ArbitrageLoopController(config);
  await controller.start();
}

function printHelp() {
  console.log(`
🔄 Smart Arbitrage Loop Controller

Usage: tsx scripts/arbitrage-loop.ts [options]

Options:
  --mode <mode>           Arbitrage mode (default: full)

                         STANDARD MODES:
                         full: GALA ↔ GUSDC only
                         multi: All fallback token pairs

                         EXOTIC MODES:
                         triangular: GALA → TOKEN → GALA loops
                         cross-pair: GALA → A → B → GALA routes
                         exotic-hunt: Auto-hunt & execute best exotic opportunities

  --delay <seconds>       Delay between runs (default: 45)
  --duration <minutes>    Max run duration (default: infinite)
  --max-errors <number>   Max consecutive errors before stop (default: 5)
  --help                  Show this help

Examples:
  # Standard arbitrage
  tsx scripts/arbitrage-loop.ts                              # Default GALA/GUSDC
  tsx scripts/arbitrage-loop.ts --mode multi                 # Multi-pair scan

  # Exotic arbitrage
  tsx scripts/arbitrage-loop.ts --mode triangular            # Triangular loops
  tsx scripts/arbitrage-loop.ts --mode cross-pair            # Cross-pair routes
  tsx scripts/arbitrage-loop.ts --mode exotic-hunt           # Hunt best opportunities

  # Configuration
  tsx scripts/arbitrage-loop.ts --delay 30 --duration 60     # 30s delay, 60m duration
  tsx scripts/arbitrage-loop.ts --mode triangular --delay 60 # Triangular with 1m delay

Features:
  ✅ Standard & exotic arbitrage modes
  ✅ Triangular & cross-pair route discovery
  ✅ Auto-execution of high-confidence opportunities
  ✅ Rate limit detection and exponential backoff
  ✅ Clean shutdown handling (Ctrl+C)
  ✅ Progress statistics and monitoring
  ✅ Configurable delays and timeouts
`);
}

// Run if this file is executed directly - Jest compatible
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Loop controller failed:', error);
    process.exit(1);
  });
}

export { ArbitrageLoopController };