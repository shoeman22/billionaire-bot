#!/usr/bin/env tsx

/**
 * EXOTIC ARBITRAGE TOOL 🌟
 * Interactive execution of triangular and cross-pair arbitrage opportunities
 * Hunt, discover, and execute exotic profit opportunities
 */

import { config } from 'dotenv';
import { logger } from '../../src/utils/logger';
import { TRADING_CONSTANTS } from '../../src/config/constants';
import {
  executeExoticArbitrage,
  discoverTriangularOpportunities,
  discoverCrossPairOpportunities,
  huntAndExecuteArbitrage,
  ExoticArbitrageConfig,
  ExoticRoute
} from '../../src/trading/execution/exotic-arbitrage-executor';

config();

interface ScriptOptions {
  mode: 'triangular' | 'cross-pair' | 'hunt' | 'hunt-execute' | 'discover' | 'route';
  amount?: number;
  threshold?: number;
  dryRun?: boolean;
  route?: string;
  autoExecute?: boolean;
  helpDisplayed?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    mode: 'discover'
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case 'triangular':
        options.mode = 'triangular';
        break;
      case 'cross-pair':
        options.mode = 'cross-pair';
        break;
      case 'hunt':
        options.mode = 'hunt';
        break;
      case 'hunt-execute':
        options.mode = 'hunt-execute';
        break;
      case 'discover':
        options.mode = 'discover';
        break;
      case '--amount':
        options.amount = parseFloat(args[++i]);
        break;
      case '--threshold':
        options.threshold = parseFloat(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--route':
        options.route = args[++i];
        break;
      case '--auto':
        options.autoExecute = true;
        break;
      case '--help':
        printHelp();
        options.helpDisplayed = true;
        break;
    }
  }

  return options;
}

/**
 * Print help information
 */
function printHelp() {
  console.log(`
🌟 Exotic Arbitrage Tool

MODES:
  discover      Discover all exotic opportunities (default)
  triangular    Execute best triangular arbitrage
  cross-pair    Execute best cross-pair arbitrage
  hunt          Hunt opportunities without execution
  hunt-execute  Hunt and auto-execute high-confidence opportunities

OPTIONS:
  --amount <n>      Input amount in GALA (default: 20)
  --threshold <n>   Minimum profit threshold % (default: varies by mode)
  --dry-run        Simulate execution without real trades
  --auto           Auto-execute best opportunity found
  --help           Show this help

EXAMPLES:
  tsx scripts/tools/exotic-arbitrage.ts discover
  tsx scripts/tools/exotic-arbitrage.ts triangular --amount 50
  tsx scripts/tools/exotic-arbitrage.ts hunt-execute --threshold 3.5
  tsx scripts/tools/exotic-arbitrage.ts cross-pair --dry-run
  tsx scripts/tools/exotic-arbitrage.ts hunt --auto

FEATURES:
  ✅ Triangular arbitrage (GALA → TOKEN → GALA)
  ✅ Cross-pair arbitrage (GALA → A → B → GALA)
  ✅ Real-time profit calculation
  ✅ Gas cost estimation
  ✅ Confidence scoring
  ✅ Multi-hop route execution
`);
}

/**
 * Display opportunities in a formatted table
 */
function displayOpportunities(opportunities: ExoticRoute[], title: string) {
  if (opportunities.length === 0) {
    logger.info(`📊 ${title}: No opportunities found`);
    return;
  }

  logger.info(`\n📊 ${title.toUpperCase()}:`);
  logger.info('=' + '='.repeat(title.length + 1));

  opportunities.forEach((opp, index) => {
    logger.info(`\n💰 OPPORTUNITY #${index + 1}:`);
    logger.info(`   Route: ${opp.symbols.join(' → ')}`);
    logger.info(`   Input: ${opp.inputAmount} GALA`);
    logger.info(`   Output: ${opp.expectedOutput.toFixed(6)} GALA`);
    logger.info(`   Gross Profit: ${((opp.expectedOutput - opp.inputAmount) / opp.inputAmount * 100).toFixed(2)}%`);
    logger.info(`   Net Profit: ${opp.profitPercent.toFixed(2)}% (${opp.profitAmount.toFixed(6)} GALA)`);
    logger.info(`   Confidence: ${opp.confidence.toUpperCase()}`);
    logger.info(`   Est. Gas: ${opp.estimatedGas} GALA`);
    logger.info(`   Fee Tiers: [${opp.feeTiers.join(', ')}]`);

    // Add visual indicators for quality
    if (opp.confidence === 'high' && opp.profitPercent > 3) {
      logger.info(`   🚀 EXCELLENT OPPORTUNITY - READY FOR EXECUTION!`);
    } else if (opp.confidence === 'medium' && opp.profitPercent > 2) {
      logger.info(`   ✅ GOOD OPPORTUNITY - Consider execution`);
    } else {
      logger.info(`   ⚠️ MARGINAL OPPORTUNITY - Proceed with caution`);
    }
  });

  if (opportunities.length > 0) {
    const best = opportunities[0];
    logger.info(`\n🏆 BEST OPPORTUNITY: ${best.symbols.join(' → ')}`);
    logger.info(`   Profit: ${best.profitPercent.toFixed(2)}% | Confidence: ${best.confidence.toUpperCase()}`);
  }
}

/**
 * Execute discovery mode
 */
async function executeDiscovery(options: ScriptOptions) {
  logger.info('🔍 DISCOVERY MODE - Scanning all exotic opportunities');

  const amount = options.amount || TRADING_CONSTANTS.DEFAULT_TRADE_SIZE;
  const minTriangularThreshold = options.threshold || 1.0;
  const minCrossPairThreshold = options.threshold || 1.5;

  logger.info(`⚙️ Parameters: ${amount} GALA input, ${minTriangularThreshold}%+ triangular, ${minCrossPairThreshold}%+ cross-pair`);

  try {
    // Discover both types in parallel
    logger.info('\n🔄 Scanning for opportunities...');
    const [triangular, crossPair] = await Promise.all([
      discoverTriangularOpportunities(amount, minTriangularThreshold),
      discoverCrossPairOpportunities(amount, minCrossPairThreshold)
    ]);

    // Display results
    displayOpportunities(triangular, 'Triangular Arbitrage Opportunities');
    displayOpportunities(crossPair, 'Cross-Pair Arbitrage Opportunities');

    // Combined analysis
    const allOpportunities = [...triangular, ...crossPair].sort((a, b) => b.profitPercent - a.profitPercent);

    if (allOpportunities.length === 0) {
      logger.info('\n📊 SUMMARY: No profitable exotic opportunities found');
      logger.info('💡 Suggestions:');
      logger.info('   • Lower profit thresholds with --threshold');
      logger.info('   • Try different input amounts with --amount');
      logger.info('   • Wait for more market volatility');
    } else {
      const highConfidence = allOpportunities.filter(opp => opp.confidence === 'high');
      const mediumConfidence = allOpportunities.filter(opp => opp.confidence === 'medium');

      logger.info(`\n🎯 DISCOVERY SUMMARY:`);
      logger.info(`   Total opportunities: ${allOpportunities.length}`);
      logger.info(`   High confidence: ${highConfidence.length}`);
      logger.info(`   Medium confidence: ${mediumConfidence.length}`);
      logger.info(`   Best profit: ${allOpportunities[0].profitPercent.toFixed(2)}%`);

      if (options.autoExecute && highConfidence.length > 0) {
        const best = highConfidence[0];
        if (best.profitPercent >= 3.0) {
          logger.info('\n🚀 AUTO-EXECUTION TRIGGERED!');
          logger.info(`   Executing: ${best.symbols.join(' → ')}`);

          const config: ExoticArbitrageConfig = {
            mode: best.tokens.length === 3 ? 'triangular' : 'cross-pair',
            inputAmount: amount
          };

          const result = await executeExoticArbitrage(config);

          if (result.success) {
            logger.info(`✅ AUTO-EXECUTION SUCCESSFUL!`);
            logger.info(`   Profit: ${result.profitPercent?.toFixed(2)}%`);
          } else {
            logger.error(`❌ AUTO-EXECUTION FAILED: ${result.error}`);
          }
        }
      }
    }

  } catch (error) {
    logger.error('❌ Discovery failed:', error);
    throw error; // Let main() handle the exit
  }
}

/**
 * Execute specific arbitrage mode
 */
async function executeArbitrageMode(options: ScriptOptions) {
  const amount = options.amount || TRADING_CONSTANTS.DEFAULT_TRADE_SIZE;
  let threshold: number;

  // Set default thresholds based on mode
  switch (options.mode) {
    case 'triangular':
      threshold = options.threshold || 1.0;
      break;
    case 'cross-pair':
      threshold = options.threshold || 1.5;
      break;
    case 'hunt-execute':
      threshold = options.threshold || 3.0;
      break;
    default:
      threshold = options.threshold || 2.0;
  }

  logger.info(`🚀 ${options.mode.toUpperCase()} MODE`);
  logger.info(`⚙️ Amount: ${amount} GALA | Threshold: ${threshold}%`);

  if (options.dryRun) {
    logger.info('🧪 DRY-RUN MODE - Simulation only, no real trades');
  }

  const config: ExoticArbitrageConfig = {
    mode: options.mode as any,
    inputAmount: amount,
    minProfitThreshold: threshold
  };

  try {
    const result = await executeExoticArbitrage(config);

    if (result.success) {
      logger.info(`\n🎉 ${options.mode.toUpperCase()} EXECUTION SUCCESSFUL!`);
      if (result.route) {
        logger.info(`   Route: ${result.route.symbols.join(' → ')}`);
      }
      logger.info(`   Executed trades: ${result.executedTrades}`);
      logger.info(`   Profit: ${result.profitPercent?.toFixed(2)}% (${result.profitAmount?.toFixed(6)} GALA)`);
      if (result.transactionIds?.length) {
        logger.info(`   Transaction IDs: ${result.transactionIds.slice(0, 2).join(', ')}${result.transactionIds.length > 2 ? '...' : ''}`);
      }
    } else {
      logger.info(`\n📊 ${options.mode.toUpperCase()} RESULT:`);
      logger.info(`   ${result.error}`);

      if (result.route) {
        logger.info(`   Best route found: ${result.route.symbols.join(' → ')}`);
        logger.info(`   Profit: ${result.route.profitPercent.toFixed(2)}%`);
        logger.info(`   Confidence: ${result.route.confidence}`);
      }

      if (result.executedTrades > 0) {
        logger.info(`   Partial execution: ${result.executedTrades} trades completed`);
      }
    }

  } catch (error) {
    logger.error(`❌ ${options.mode} execution failed:`, error);
    throw error; // Let main() handle the exit
  }
}

/**
 * Execute hunt mode (discovery without execution)
 */
async function executeHuntMode(options: ScriptOptions) {
  logger.info('🎯 HUNT MODE - Finding best opportunities');

  const amount = options.amount || TRADING_CONSTANTS.DEFAULT_TRADE_SIZE;
  const threshold = options.threshold || 3.0;

  try {
    const result = await huntAndExecuteArbitrage(amount, threshold);

    if (result.route) {
      logger.info(`\n🏆 BEST OPPORTUNITY DISCOVERED:`);
      logger.info(`   Route: ${result.route.symbols.join(' → ')}`);
      logger.info(`   Profit: ${result.route.profitPercent.toFixed(2)}%`);
      logger.info(`   Confidence: ${result.route.confidence.toUpperCase()}`);
      logger.info(`   Est. Gas: ${result.route.estimatedGas} GALA`);

      if (result.success) {
        logger.info(`✅ OPPORTUNITY EXECUTED AUTOMATICALLY!`);
        logger.info(`   Actual profit: ${result.profitPercent?.toFixed(2)}%`);
      } else {
        logger.info(`📊 Opportunity found but not executed:`);
        logger.info(`   ${result.error}`);

        if (options.autoExecute && result.route.confidence === 'high') {
          logger.info('\n🚀 FORCING EXECUTION due to --auto flag...');

          const config: ExoticArbitrageConfig = {
            mode: result.route.tokens.length === 3 ? 'triangular' : 'cross-pair',
            inputAmount: amount,
            minProfitThreshold: 0.5 // Lower threshold for forced execution
          };

          const forceResult = await executeExoticArbitrage(config);

          if (forceResult.success) {
            logger.info(`✅ FORCED EXECUTION SUCCESSFUL!`);
            logger.info(`   Profit: ${forceResult.profitPercent?.toFixed(2)}%`);
          } else {
            logger.error(`❌ FORCED EXECUTION FAILED: ${forceResult.error}`);
          }
        }
      }
    } else {
      logger.info(`\n📊 HUNT RESULT: ${result.error}`);
      logger.info('💡 No high-profit opportunities found at current market conditions');
    }

  } catch (error) {
    logger.error('❌ Hunt failed:', error);
    throw error; // Let main() handle the exit
  }
}

/**
 * Main execution function
 */
async function main() {
  logger.info('🌟 EXOTIC ARBITRAGE TOOL ACTIVATED');

  const options = parseArgs();

  // Handle help display case
  if (options.helpDisplayed) {
    return; // Exit gracefully after help display
  }

  // Print configuration
  logger.info('\n⚙️ CONFIGURATION:');
  logger.info(`   Mode: ${options.mode}`);
  if (options.amount) logger.info(`   Amount: ${options.amount} GALA`);
  if (options.threshold) logger.info(`   Threshold: ${options.threshold}%`);
  if (options.dryRun) logger.info(`   Dry run: enabled`);
  if (options.autoExecute) logger.info(`   Auto execute: enabled`);

  try {
    switch (options.mode) {
      case 'discover':
        await executeDiscovery(options);
        break;
      case 'hunt':
        await executeHuntMode(options);
        break;
      case 'triangular':
      case 'cross-pair':
      case 'hunt-execute':
        await executeArbitrageMode(options);
        break;
      default:
        logger.error(`❌ Unknown mode: ${options.mode}`);
        printHelp();
        throw new Error(`Unknown mode: ${options.mode}`);
    }

    logger.info('\n✅ Exotic arbitrage tool completed successfully');

  } catch (error) {
    logger.error('💥 Exotic arbitrage tool failed:', error);
    throw error; // Let the top-level handler deal with exit
  }
}

// Handle command line execution
// Check if this script is run directly
const isMainModule = process.argv[1]?.includes('exotic-arbitrage.ts') || process.argv[1]?.endsWith('exotic-arbitrage.js');
if (isMainModule) {
  main().catch((error) => {
    console.error('💥 Script execution failed:', error);
    // Error propagated to CLI - let process exit naturally
    process.exitCode = 1;
  });
}

export { main as runExoticArbitrageTool };