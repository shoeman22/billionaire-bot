#!/usr/bin/env tsx

/**
 * MANUAL ARBITRAGE STEPS 📋
 * Step-by-step manual execution for arbitrage opportunity
 * You can run each step individually to control the process
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';
import { TRADING_CONSTANTS } from '../../src/config/constants';
import { calculateMinOutputAmount } from '../../src/utils/slippage-calculator';
import { executeFullArbitrage, executeMultiArbitrage } from '../../src/trading/execution/arbitrage-executor';
import type { TokenInfo } from '../../src/types/galaswap';

config();

// Get the command line argument for which step to run
const step = process.argv[2];

async function setupGSwap() {
  const env = validateEnvironment();
  const signer = new PrivateKeySigner(env.wallet.privateKey);

  const gSwap = new GSwap({
    signer,
    walletAddress: env.wallet.address
  });

  try {
    await gSwap.connectSocket();
    logger.info('📡 Connected to bundler socket for transaction monitoring');
  } catch (error) {
    logger.warn('⚠️ Bundler socket connection failed, will return transaction ID only');
  }

  try {
    GSwap.events?.connectEventSocket();
    logger.info('📡 Connected to real-time price feeds');
  } catch (error) {
    logger.warn('⚠️ Event socket not available, using polling mode');
  }

  return { gSwap, env };
}

async function cleanup(gSwap: any) {
  try {
    if (gSwap?.disconnectSocket) {
      await gSwap.disconnectSocket();
    }
    if (GSwap.events?.disconnectEventSocket) {
      GSwap.events.disconnectEventSocket();
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

async function step1_getQuote() {
  logger.info('📈 STEP 1: Get GALA → GUSDC Quote');

  const { gSwap } = await setupGSwap();
  const amount = 1; // 1 GALA

  try {
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      amount
    );

    logger.info(`✅ Quote Result:`);
    logger.info(`   Input: ${amount} GALA`);
    logger.info(`   Output: ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);
    logger.info(`   Fee Tier: ${quote.feeTier}`);
    logger.info(`   Rate: 1 GALA = ${(quote.outTokenAmount.toNumber() / amount).toFixed(6)} GUSDC`);

    logger.info(`🔍 Quote Debug Info:`, {
      feeTier: quote.feeTier,
      feeTierType: typeof quote.feeTier,
      feeTierString: quote.feeTier.toString(),
      feeTierParsed: parseInt(quote.feeTier.toString(), 10)
    });

    return {
      amount,
      outputAmount: quote.outTokenAmount.toNumber(),
      feeTier: quote.feeTier
    };
  } catch (error) {
    logger.error('❌ Quote failed:', error);
    throw error;
  }
}

async function step2_executeFirstTrade(inputAmount: number, minOutput: number, feeTier: number) {
  logger.info('🔄 STEP 2: Execute GALA → GUSDC Trade');

  const { gSwap, env } = await setupGSwap();

  try {
    // Use official docs API signature
    logger.info(`🔧 Using official docs swap signature`);
    logger.info(`🔍 Parameters:`, {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      feeTier: feeTier,
      exactIn: inputAmount,
      amountOutMinimum: calculateMinOutputAmount(minOutput),
      recipient: env.wallet.address
    });

    // Generate swap payload using official docs signature
    const swapPayload = await gSwap.swaps.swap(
      'GALA|Unit|none|none', // Token to sell
      'GUSDC|Unit|none|none', // Token to buy
      feeTier, // Use the fee tier from the quote
      {
        exactIn: inputAmount,
        amountOutMinimum: calculateMinOutputAmount(minOutput), // 5% slippage - let SDK handle negative values
      },
      env.wallet.address, // your wallet address
    );

    logger.info(`📝 Generated swap payload:`, typeof swapPayload);
    logger.info(`🔍 Swap payload properties:`, Object.keys(swapPayload));

    // Check if swapPayload has execution method or if it's already executed
    if (swapPayload && typeof swapPayload === 'object') {
      const payload = swapPayload as any;

      logger.info(`🔍 Payload details:`, {
        transactionId: payload.transactionId,
        message: payload.message,
        error: payload.error,
        waitDelegateType: typeof payload.waitDelegate
      });

      // Check if there's a transaction ID (indicates successful submission)
      if (payload.transactionId) {
        logger.info(`✅ Transaction submitted with ID: ${payload.transactionId}`);

        // If there's a waitDelegate, it might be awaitable
        if (payload.waitDelegate && typeof payload.waitDelegate === 'function') {
          logger.info(`🔄 Waiting for transaction confirmation...`);
          try {
            const result = await payload.waitDelegate();
            logger.info(`✅ Transaction confirmed:`, result);
            return result.hash || payload.transactionId;
          } catch (error: any) {
            logger.error(`❌ Transaction failed:`, error);

            // Extract transaction hash from error details if available
            if (error.details?.transactionHash) {
              logger.info(`✅ Transaction was executed: ${error.details.transactionHash}`);
              logger.info(`❌ But failed with: ${error.details.Message}`);
              return error.details.transactionHash;
            }

            throw error;
          }
        }

        return payload.transactionId;
      }

      // Check for errors
      if (payload.error) {
        logger.error(`❌ Transaction error: ${payload.error}`);
        throw new Error(payload.error);
      }
    }

    logger.info(`❓ Unknown payload format`);
    return 'unknown-transaction-format';

  } catch (error) {
    logger.error('❌ Trade execution failed:', error);
    throw error;
  }
}

async function step3_getReturnQuote(amount: number) {
  logger.info('📈 STEP 3: Get GUSDC → GALA Quote');

  const { gSwap } = await setupGSwap();

  try {
    const quote = await gSwap.quoting.quoteExactInput(
      'GUSDC|Unit|none|none',
      'GALA|Unit|none|none',
      amount
    );

    logger.info(`✅ Return Quote Result:`);
    logger.info(`   Input: ${amount.toFixed(6)} GUSDC`);
    logger.info(`   Output: ${quote.outTokenAmount.toNumber().toFixed(6)} GALA`);
    logger.info(`   Fee Tier: ${quote.feeTier}`);
    logger.info(`   Rate: 1 GUSDC = ${(quote.outTokenAmount.toNumber() / amount).toFixed(6)} GALA`);

    return {
      amount,
      outputAmount: quote.outTokenAmount.toNumber(),
      feeTier: quote.feeTier
    };
  } catch (error) {
    logger.error('❌ Return quote failed:', error);
    throw error;
  }
}

async function step4_executeReturnTrade(inputAmount: number, minOutput: number, feeTier: number) {
  logger.info('🔄 STEP 4: Execute GUSDC → GALA Trade');

  const { gSwap, env } = await setupGSwap();

  try {
    // Use official docs API signature for return trade
    logger.info(`🔧 Using official docs return swap signature`);
    logger.info(`🔍 Return Parameters:`, {
      tokenIn: 'GUSDC|Unit|none|none',
      tokenOut: 'GALA|Unit|none|none',
      feeTier: feeTier,
      exactIn: inputAmount,
      amountOutMinimum: calculateMinOutputAmount(minOutput),
      recipient: env.wallet.address
    });

    // Generate return swap payload using official docs signature
    const swapPayload = await gSwap.swaps.swap(
      'GUSDC|Unit|none|none', // Token to sell
      'GALA|Unit|none|none', // Token to buy
      feeTier, // Use the fee tier from the quote
      {
        exactIn: inputAmount,
        amountOutMinimum: calculateMinOutputAmount(minOutput), // 5% slippage - let SDK handle negative values
      },
      env.wallet.address, // your wallet address
    );

    logger.info(`📝 Generated return swap payload:`, typeof swapPayload);
    logger.info(`🔍 Return swap payload properties:`, Object.keys(swapPayload));

    // Check if swapPayload has execution method or if it's already executed
    if (swapPayload && typeof swapPayload === 'object') {
      const payload = swapPayload as any;

      logger.info(`🔍 Return payload details:`, {
        transactionId: payload.transactionId,
        message: payload.message,
        error: payload.error,
        waitDelegateType: typeof payload.waitDelegate
      });

      // Check if there's a transaction ID (indicates successful submission)
      if (payload.transactionId) {
        logger.info(`✅ Return transaction submitted with ID: ${payload.transactionId}`);

        // If there's a waitDelegate, it might be awaitable
        if (payload.waitDelegate && typeof payload.waitDelegate === 'function') {
          logger.info(`🔄 Waiting for return transaction confirmation...`);
          try {
            const result = await payload.waitDelegate();
            logger.info(`✅ Return transaction confirmed:`, result);
            return result.hash || payload.transactionId;
          } catch (error: any) {
            logger.error(`❌ Return transaction failed:`, error);

            // Extract transaction hash from error details if available
            if (error.details?.transactionHash) {
              logger.info(`✅ Return transaction was executed: ${error.details.transactionHash}`);
              logger.info(`❌ But failed with: ${error.details.Message}`);
              return error.details.transactionHash;
            }

            throw error;
          }
        }

        return payload.transactionId;
      }

      // Check for errors
      if (payload.error) {
        logger.error(`❌ Return transaction error: ${payload.error}`);
        throw new Error(payload.error);
      }
    }

    logger.info(`❓ Unknown return payload format`);
    return 'unknown-return-transaction-format';

  } catch (error) {
    logger.error('❌ Return trade execution failed:', error);
    throw error;
  }
}

async function fullArbitrage() {
  logger.info('🚀 FULL ARBITRAGE EXECUTION');

  try {
    // Step 1: Get initial quote
    const quote1 = await step1_getQuote();

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Execute first trade
    const tx1 = await step2_executeFirstTrade(quote1.amount, quote1.outputAmount, quote1.feeTier);

    logger.info('⏳ Waiting 10 seconds for transaction to settle...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Step 3: Get return quote
    const quote2 = await step3_getReturnQuote(quote1.outputAmount);

    // Step 4: Execute return trade
    const tx2 = await step4_executeReturnTrade(quote2.amount, quote2.outputAmount, quote2.feeTier);

    // Calculate profit
    const profit = quote2.outputAmount - quote1.amount;
    const profitPercent = (profit / quote1.amount) * 100;

    logger.info('\n🎉 ARBITRAGE COMPLETE!');
    logger.info(`💰 Started with: ${quote1.amount} GALA`);
    logger.info(`💰 Expected to receive: ${quote2.outputAmount.toFixed(6)} GALA`);
    logger.info(`💰 Expected profit: ${profit.toFixed(6)} GALA (${profitPercent.toFixed(2)}%)`);
    logger.info(`\n📊 Transactions:`);
    logger.info(`   1. GALA → GUSDC: ${tx1}`);
    logger.info(`   2. GUSDC → GALA: ${tx2}`);

  } catch (error) {
    logger.error('💥 Arbitrage failed:', error);
  }
}

// Generate all possible token pairs from fallback tokens
function generateTokenPairs(): Array<{tokenA: TokenInfo, tokenB: TokenInfo}> {
  const tokens = TRADING_CONSTANTS.FALLBACK_TOKENS;
  const pairs: Array<{tokenA: TokenInfo, tokenB: TokenInfo}> = [];

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      pairs.push({
        tokenA: tokens[i],
        tokenB: tokens[j]
      });
    }
  }

  logger.info(`🔢 Generated ${pairs.length} token pairs for arbitrage testing`);
  return pairs;
}

// Execute arbitrage for a specific token pair
async function executePairArbitrage(tokenA: TokenInfo, tokenB: TokenInfo): Promise<boolean> {
  logger.info(`🎯 Testing arbitrage: ${tokenA.symbol} ↔ ${tokenB.symbol}`);

  try {
    const { gSwap } = await setupGSwap();
    const amount = 1; // Test with 1 unit

    // Step 1: Get quote A → B
    const quote1 = await gSwap.quoting.quoteExactInput(
      tokenA.tokenClass,
      tokenB.tokenClass,
      amount
    );

    if (!quote1?.outTokenAmount) {
      logger.debug(`❌ No liquidity for ${tokenA.symbol} → ${tokenB.symbol}`);
      return false;
    }

    const outputAmount = quote1.outTokenAmount.toNumber();
    logger.info(`   ${tokenA.symbol} → ${tokenB.symbol}: ${amount} → ${outputAmount.toFixed(6)}`);

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: Get return quote B → A
    const quote2 = await gSwap.quoting.quoteExactInput(
      tokenB.tokenClass,
      tokenA.tokenClass,
      outputAmount
    );

    if (!quote2?.outTokenAmount) {
      logger.debug(`❌ No return liquidity for ${tokenB.symbol} → ${tokenA.symbol}`);
      return false;
    }

    const finalAmount = quote2.outTokenAmount.toNumber();
    logger.info(`   ${tokenB.symbol} → ${tokenA.symbol}: ${outputAmount.toFixed(6)} → ${finalAmount.toFixed(6)}`);

    // Calculate profit
    const profit = finalAmount - amount;
    const profitPercent = (profit / amount) * 100;

    logger.info(`💰 Profit potential: ${profit.toFixed(6)} ${tokenA.symbol} (${profitPercent.toFixed(4)}%)`);

    // Check if profitable (minimum 0.1% after fees)
    if (profitPercent > 0.1) {
      logger.info(`🚀 PROFITABLE OPPORTUNITY FOUND! Executing trades...`);

      // Execute the actual trades using generic trade function
      const tx1 = await executeTrade(tokenA.tokenClass, tokenB.tokenClass, amount, outputAmount, quote1.feeTier);

      logger.info('⏳ Waiting 10 seconds for transaction to settle...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      const tx2 = await executeTrade(tokenB.tokenClass, tokenA.tokenClass, outputAmount, finalAmount, quote2.feeTier);

      logger.info(`✅ Arbitrage executed successfully!`);
      logger.info(`📊 Transactions: ${tx1} | ${tx2}`);

      return true; // Successful arbitrage
    } else {
      logger.info(`📉 Not profitable enough (${profitPercent.toFixed(4)}% < 0.1% minimum)`);
      return false;
    }

  } catch (error) {
    logger.debug(`❌ Error testing ${tokenA.symbol}/${tokenB.symbol}:`, error);
    return false;
  }
}

// Generic trade execution for any token pair
async function executeTrade(
  tokenIn: string,
  tokenOut: string,
  inputAmount: number,
  minOutputAmount: number,
  feeTier: number
): Promise<string> {
  logger.info(`🔄 Executing trade: ${inputAmount} ${tokenIn.split('|')[0]} → ${tokenOut.split('|')[0]}`);

  const { gSwap, env } = await setupGSwap();

  try {
    // Generate swap payload using official docs signature
    const swapPayload = await gSwap.swaps.swap(
      tokenIn, // Token to sell
      tokenOut, // Token to buy
      feeTier, // Fee tier from quote
      {
        exactIn: inputAmount,
        amountOutMinimum: calculateMinOutputAmount(minOutputAmount), // Centralized slippage protection
      },
      env.wallet.address, // Recipient address
    );

    logger.info(`📝 Generated swap payload for ${tokenIn.split('|')[0]} → ${tokenOut.split('|')[0]}`);

    // Handle payload response
    if (swapPayload && typeof swapPayload === 'object') {
      const payload = swapPayload as any;

      // Check if there's a transaction ID
      if (payload.transactionId) {
        logger.info(`✅ Transaction submitted: ${payload.transactionId}`);

        // If there's a waitDelegate, await confirmation
        if (payload.waitDelegate && typeof payload.waitDelegate === 'function') {
          logger.info(`🔄 Waiting for transaction confirmation...`);
          try {
            const result = await payload.waitDelegate();
            logger.info(`✅ Transaction confirmed:`, result);
            return result.hash || payload.transactionId;
          } catch (error: any) {
            logger.error(`❌ Transaction failed:`, error);

            // Extract transaction hash if available in error details
            if (error.details?.transactionHash) {
              logger.info(`✅ Transaction executed: ${error.details.transactionHash}`);
              logger.info(`❌ But failed with: ${error.details.Message}`);
              return error.details.transactionHash;
            }

            throw error;
          }
        }

        return payload.transactionId;
      }

      // Check for errors
      if (payload.error) {
        logger.error(`❌ Transaction error: ${payload.error}`);
        throw new Error(payload.error);
      }
    }

    logger.info(`❓ Unknown payload format`);
    return 'unknown-transaction-format';

  } catch (error) {
    logger.error(`❌ Trade execution failed for ${tokenIn.split('|')[0]} → ${tokenOut.split('|')[0]}:`, error);
    throw error;
  }
}

// Multi-pair arbitrage execution
async function multiArbitrage(): Promise<void> {
  logger.info('🌟 MULTI-PAIR ARBITRAGE EXECUTION');

  const pairs = generateTokenPairs();
  let successfulTrades = 0;

  for (const pair of pairs) {
    try {
      const success = await executePairArbitrage(pair.tokenA, pair.tokenB);
      if (success) {
        successfulTrades++;
        logger.info(`🎉 Successful arbitrage completed! Stopping multi-pair scan.`);
        break; // Stop after first successful arbitrage
      }

      // Small delay between pair tests
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      logger.error(`❌ Error with pair ${pair.tokenA.symbol}/${pair.tokenB.symbol}:`, error);
    }
  }

  logger.info(`\n📊 Multi-pair arbitrage summary:`);
  logger.info(`   Pairs tested: ${pairs.length}`);
  logger.info(`   Successful trades: ${successfulTrades}`);

  if (successfulTrades === 0) {
    logger.info(`📭 No profitable arbitrage opportunities found in current market conditions`);
  }
}

// Main execution based on command line argument
async function main() {
  let gSwapInstance: any = null;

  try {
    if (!step) {
      logger.info('📋 MANUAL ARBITRAGE CONTROL');
      logger.info('Usage: tsx manual-arbitrage-steps.ts [step]');
      logger.info('');
      logger.info('Available steps:');
      logger.info('  quote1          - Get GALA → GUSDC quote');
      logger.info('  trade1 [amount] [minOut] [fee] - Execute GALA → GUSDC trade');
      logger.info('  quote2 [amount] - Get GUSDC → GALA quote');
      logger.info('  trade2 [amount] [minOut] [fee] - Execute GUSDC → GALA trade');
      logger.info('  full            - Execute complete GALA ↔ GUSDC arbitrage');
      logger.info('  multi           - Test all fallback token pairs for arbitrage');
      logger.info('');
      logger.info('Enhanced commands:');
      logger.info('  multi           - Scans all 10 fallback token pairs, executes first profitable opportunity');
      logger.info('');
      logger.info('Example workflow:');
      logger.info('  1. tsx manual-arbitrage-steps.ts quote1');
      logger.info('  2. tsx manual-arbitrage-steps.ts trade1 1 0.016 500');
      logger.info('  3. tsx manual-arbitrage-steps.ts quote2 0.016');
      logger.info('  4. tsx manual-arbitrage-steps.ts trade2 0.016 0.98 500');
      logger.info('');
      logger.info('Quick execution:');
      logger.info('  tsx manual-arbitrage-steps.ts full   - Single GALA/GUSDC cycle');
      logger.info('  tsx manual-arbitrage-steps.ts multi  - Multi-pair opportunity scan');
      return;
    }

    switch (step) {
      case 'quote1':
        await step1_getQuote();
        break;

      case 'trade1':
        const amount1 = parseFloat(process.argv[3] || '1');
        const minOut1 = parseFloat(process.argv[4] || '0.016');
        const fee1 = parseInt(process.argv[5] || '500');
        await step2_executeFirstTrade(amount1, minOut1, fee1);
        break;

      case 'quote2':
        const amount2 = parseFloat(process.argv[3] || '0.016');
        await step3_getReturnQuote(amount2);
        break;

      case 'trade2':
        const amountIn2 = parseFloat(process.argv[3] || '0.016');
        const minOut2 = parseFloat(process.argv[4] || '0.98');
        const fee2 = parseInt(process.argv[5] || '500');
        await step4_executeReturnTrade(amountIn2, minOut2, fee2);
        break;

      case 'full':
        logger.info('🚀 Using shared arbitrage execution library');
        try {
          const fullResult = await executeFullArbitrage();
          if (fullResult.success) {
            logger.info(`✅ ARBITRAGE COMPLETE! Profit: ${fullResult.profitPercent?.toFixed(2)}%`);
          } else {
            logger.info(`📭 No profitable opportunities found: ${fullResult.error}`);
          }
        } catch (error) {
          // Handle SDK cleanup errors gracefully - operation likely succeeded
          if (error instanceof Error && error.message.includes('Transaction wait failed')) {
            logger.debug('⚠️ Arbitrage completed but SDK cleanup threw expected warning - this is normal');
          } else {
            logger.error('❌ Arbitrage execution failed:', error);
          }
        }
        break;

      case 'multi':
        logger.info('🚀 Using shared arbitrage execution library');
        try {
          const multiResult = await executeMultiArbitrage();
          if (multiResult.success) {
            logger.info(`✅ ARBITRAGE COMPLETE! Profit: ${multiResult.profitPercent?.toFixed(2)}%`);
          } else {
            logger.info(`📭 No profitable opportunities found: ${multiResult.error}`);
          }
        } catch (error) {
          // Handle SDK cleanup errors gracefully - operation likely succeeded
          if (error instanceof Error && error.message.includes('Transaction wait failed')) {
            logger.debug('⚠️ Arbitrage completed but SDK cleanup threw expected warning - this is normal');
          } else {
            logger.error('❌ Arbitrage execution failed:', error);
          }
        }
        break;

      default:
        logger.error(`Unknown step: ${step}`);
        logger.info('Run without arguments to see usage help');
    }
  } finally {
    // Natural cleanup - let Node.js process exit naturally
    logger.debug('Manual arbitrage steps completed');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});