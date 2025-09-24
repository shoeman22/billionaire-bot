#!/usr/bin/env tsx

/**
 * SIMPLE ARBITRAGE EXECUTION 🎯
 * Execute arbitrage using the proven simple pattern from successful trades
 * Route: GALA → GUSDC → GALA
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';
import { calculateMinOutputAmount } from '../../src/utils/slippage-calculator';

config();

async function executeSimpleArbitrage(): Promise<void> {
  try {
    logger.info('🚀 SIMPLE ARBITRAGE EXECUTION STARTED!');
    logger.info('💰 Route: GALA → GUSDC → GALA');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(env.wallet.privateKey);
    const gSwap = new GSwap({
      signer: signer,
      walletAddress: env.wallet.address
    });

    // Connect to event socket
    try {
      GSwap.events?.connectEventSocket();
      logger.info('📡 Connected to real-time price feeds');
    } catch (error) {
      logger.warn('⚠️ Event socket not available, using polling mode');
    }

    const startAmount = 1; // Start with 1 GALA
    logger.info(`🎯 Starting with ${startAmount} GALA`);

    // Step 1: GALA → GUSDC
    logger.info('\n📈 STEP 1: GALA → GUSDC');

    try {
      // Get quote
      const quote1 = await gSwap.quoting.quoteExactInput(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        startAmount
      );

      const expectedGusdc = quote1.outTokenAmount.toNumber();
      logger.info(`   Quote: ${startAmount} GALA → ${expectedGusdc.toFixed(6)} GUSDC`);

      // Execute trade using the proven pattern
      const swap1 = await gSwap.swaps.swap({
        tokenIn: 'GALA|Unit|none|none',
        tokenOut: 'GUSDC|Unit|none|none',
        fee: parseInt(quote1.feeTier.toString(), 10), // Ensure fee is integer
        recipient: env.wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 1200, // 20 minutes
        amountIn: parseFloat(startAmount.toString()), // Ensure number
        amountOutMinimum: parseFloat(calculateMinOutputAmount(expectedGusdc).toString()), // Centralized slippage protection
        sqrtPriceLimitX96: 0
      });

      logger.info(`   🔄 Executing GALA → GUSDC trade...`);

      // Sign and execute
      const result1 = await gSwap.bundles.executeBundle(swap1);

      if (result1.hash) {
        logger.info(`   ✅ Step 1 Success! TX: ${result1.hash}`);
        logger.info(`   💰 Expected output: ${expectedGusdc.toFixed(6)} GUSDC`);

        // Wait for transaction to settle
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Step 2: GUSDC → GALA
        logger.info('\n📈 STEP 2: GUSDC → GALA');

        try {
          // Get quote for return trip
          const quote2 = await gSwap.quoting.quoteExactInput(
            'GUSDC|Unit|none|none',
            'GALA|Unit|none|none',
            expectedGusdc
          );

          const expectedGalaReturn = quote2.outTokenAmount.toNumber();
          logger.info(`   Quote: ${expectedGusdc.toFixed(6)} GUSDC → ${expectedGalaReturn.toFixed(6)} GALA`);

          // Execute return trade
          const swap2 = await gSwap.swaps.swap({
            tokenIn: 'GUSDC|Unit|none|none',
            tokenOut: 'GALA|Unit|none|none',
            fee: parseInt(quote2.feeTier.toString(), 10), // Ensure fee is integer
            recipient: env.wallet.address,
            deadline: Math.floor(Date.now() / 1000) + 1200, // 20 minutes
            amountIn: parseFloat(expectedGusdc.toString()), // Ensure number
            amountOutMinimum: parseFloat(calculateMinOutputAmount(expectedGalaReturn).toString()), // Centralized slippage protection
            sqrtPriceLimitX96: 0
          });

          logger.info(`   🔄 Executing GUSDC → GALA trade...`);

          // Sign and execute
          const result2 = await gSwap.bundles.executeBundle(swap2);

          if (result2.hash) {
            logger.info(`   ✅ Step 2 Success! TX: ${result2.hash}`);

            // Calculate profit
            const profit = expectedGalaReturn - startAmount;
            const profitPercent = (profit / startAmount) * 100;

            logger.info('\n🎉 ARBITRAGE EXECUTION COMPLETE!');
            logger.info('==================================');
            logger.info(`💰 PROFIT ANALYSIS:`);
            logger.info(`   • Started with: ${startAmount} GALA`);
            logger.info(`   • Expected return: ${expectedGalaReturn.toFixed(6)} GALA`);
            logger.info(`   • Expected profit: ${profit.toFixed(6)} GALA`);
            logger.info(`   • Expected profit %: ${profitPercent.toFixed(2)}%`);

            if (profit > 0) {
              logger.info(`🎯 SUCCESS: Arbitrage should be profitable! Expected ${profit.toFixed(6)} GALA profit`);
            } else {
              logger.warn(`⚠️ Expected loss: ${Math.abs(profit).toFixed(6)} GALA`);
            }

            logger.info('\n📊 TRANSACTION SUMMARY:');
            logger.info(`1. GALA → GUSDC: ${result1.hash}`);
            logger.info(`2. GUSDC → GALA: ${result2.hash}`);
            logger.info('\n🔍 View on GalaScan:');
            logger.info(`   TX 1: https://galascan.io/tx/${result1.hash}`);
            logger.info(`   TX 2: https://galascan.io/tx/${result2.hash}`);

          } else {
            logger.error(`❌ Step 2 failed: No transaction hash returned`);
          }

        } catch (error) {
          logger.error(`❌ Step 2 failed:`, error);
        }

      } else {
        logger.error(`❌ Step 1 failed: No transaction hash returned`);
      }

    } catch (error) {
      logger.error(`❌ Step 1 failed:`, error);
    }

  } catch (error) {
    logger.error('💥 Simple arbitrage execution failed:', error);
  }
}

executeSimpleArbitrage().catch(console.error);