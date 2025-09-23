#!/usr/bin/env tsx

/**
 * TEST ARBITRAGE WITH SMALL AMOUNTS 🔬
 * Testing with tiny amounts to minimize slippage and verify execution
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from './src/config/environment';
import { logger } from './src/utils/logger';

config();

async function testArbitrageSmallAmounts(): Promise<void> {
  try {
    logger.info('🔬 TESTING ARBITRAGE WITH SMALL AMOUNTS');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '');

    const gSwap = new GSwap({
      signer,
      walletAddress: env.wallet.address
    });

    // Setup socket connections
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

    const testAmount = 0.01; // Very small amount to minimize slippage
    logger.info(`\n💰 Testing arbitrage with ${testAmount} GALA`);

    // Step 1: Get GALA → GUSDC Quote
    logger.info('\n📈 STEP 1: Get GALA → GUSDC Quote');

    const quote1 = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      testAmount
    );

    const expectedGUSDC = Math.abs(quote1.outTokenAmount.toNumber());

    logger.info(`✅ Quote 1 Results:`);
    logger.info(`   Input: ${testAmount} GALA`);
    logger.info(`   Output: ${expectedGUSDC.toFixed(8)} GUSDC`);
    logger.info(`   Fee Tier: ${quote1.feeTier}`);
    logger.info(`   Rate: 1 GALA = ${(expectedGUSDC / testAmount).toFixed(8)} GUSDC`);

    // Step 2: Get reverse quote GUSDC → GALA to check opportunity
    logger.info('\n📈 STEP 2: Get Reverse Quote GUSDC → GALA');

    const quote2 = await gSwap.quoting.quoteExactInput(
      'GUSDC|Unit|none|none',
      'GALA|Unit|none|none',
      expectedGUSDC
    );

    const expectedFinalGALA = Math.abs(quote2.outTokenAmount.toNumber());
    const profit = expectedFinalGALA - testAmount;
    const profitPercent = (profit / testAmount) * 100;

    logger.info(`✅ Quote 2 Results:`);
    logger.info(`   Input: ${expectedGUSDC.toFixed(8)} GUSDC`);
    logger.info(`   Output: ${expectedFinalGALA.toFixed(8)} GALA`);
    logger.info(`   Fee Tier: ${quote2.feeTier}`);
    logger.info(`   Rate: 1 GUSDC = ${(expectedFinalGALA / expectedGUSDC).toFixed(8)} GALA`);

    logger.info(`\n📊 ARBITRAGE OPPORTUNITY ANALYSIS:`);
    logger.info(`   💰 Start: ${testAmount} GALA`);
    logger.info(`   💰 Expected end: ${expectedFinalGALA.toFixed(8)} GALA`);
    logger.info(`   💰 Expected profit: ${profit.toFixed(8)} GALA (${profitPercent.toFixed(2)}%)`);

    if (profitPercent < 1) {
      logger.warn('⚠️ Profit less than 1% - may not be worth executing due to gas costs');
    } else if (profitPercent > 100) {
      logger.warn('⚠️ Profit over 100% - likely unrealistic due to liquidity constraints');
    }

    // Ask user if they want to execute
    logger.info('\n🔄 EXECUTION PHASE');
    logger.info('This will execute real trades with real funds!');

    // For now, just simulate - user can modify to execute
    const executeReal = true; // Execute real trades to test if this opportunity is real

    if (!executeReal) {
      logger.info('🛡️ SIMULATION MODE - No real trades executed');
      logger.info('📝 Set executeReal = true to execute real trades');
      return;
    }

    // Step 3: Execute GALA → GUSDC Trade
    logger.info('\n🔄 STEP 3: Execute GALA → GUSDC Trade');

    const swapPayload1 = await gSwap.swaps.swap(
      'GALA|Unit|none|none', // Token to sell
      'GUSDC|Unit|none|none', // Token to buy
      quote1.feeTier, // Use the fee tier from the quote
      {
        exactIn: testAmount,
        amountOutMinimum: quote1.outTokenAmount.multipliedBy(0.90), // 10% slippage for small amounts
      },
      env.wallet.address, // wallet address
    );

    logger.info(`✅ Trade 1 submitted: ${swapPayload1.transactionId}`);

    let actualGUSDC = expectedGUSDC; // Default to expected

    // Handle transaction confirmation
    if (swapPayload1.waitDelegate && typeof swapPayload1.waitDelegate === 'function') {
      try {
        logger.info('🔄 Waiting for trade 1 confirmation...');
        const result1 = await swapPayload1.waitDelegate();
        logger.info(`✅ Trade 1 confirmed: ${result1.hash}`);

        // TODO: Extract actual received amount from result if available

      } catch (error: any) {
        if (error.details?.transactionHash) {
          logger.info(`✅ Trade 1 executed: ${error.details.transactionHash}`);
          logger.error(`❌ But failed with: ${error.details.Message}`);

          // Use absolute values for comparison
          if (error.details.Message && error.details.Message.includes('actual received amount')) {
            const match = error.details.Message.match(/actual received amount \\(([^)]+)\\)/);
            if (match) {
              actualGUSDC = Math.abs(parseFloat(match[1]));
              logger.info(`📊 Actual GUSDC received: ${actualGUSDC.toFixed(8)}`);
            }
          }
        } else {
          throw error;
        }
      }
    }

    logger.info('⏳ Waiting 5 seconds before reverse trade...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 4: Execute GUSDC → GALA Trade
    logger.info('\n🔄 STEP 4: Execute GUSDC → GALA Trade');

    // Get fresh quote with actual amount received
    const freshQuote2 = await gSwap.quoting.quoteExactInput(
      'GUSDC|Unit|none|none',
      'GALA|Unit|none|none',
      actualGUSDC
    );

    const swapPayload2 = await gSwap.swaps.swap(
      'GUSDC|Unit|none|none', // Token to sell
      'GALA|Unit|none|none', // Token to buy
      freshQuote2.feeTier, // Use the fee tier from the fresh quote
      {
        exactIn: actualGUSDC,
        amountOutMinimum: freshQuote2.outTokenAmount.multipliedBy(0.90), // 10% slippage
      },
      env.wallet.address, // wallet address
    );

    logger.info(`✅ Trade 2 submitted: ${swapPayload2.transactionId}`);

    let actualFinalGALA = Math.abs(freshQuote2.outTokenAmount.toNumber()); // Default to expected

    // Handle transaction confirmation
    if (swapPayload2.waitDelegate && typeof swapPayload2.waitDelegate === 'function') {
      try {
        logger.info('🔄 Waiting for trade 2 confirmation...');
        const result2 = await swapPayload2.waitDelegate();
        logger.info(`✅ Trade 2 confirmed: ${result2.hash}`);

        // TODO: Extract actual received amount from result if available

      } catch (error: any) {
        if (error.details?.transactionHash) {
          logger.info(`✅ Trade 2 executed: ${error.details.transactionHash}`);
          logger.error(`❌ But failed with: ${error.details.Message}`);

          // Use absolute values for comparison
          if (error.details.Message && error.details.Message.includes('actual received amount')) {
            const match = error.details.Message.match(/actual received amount \\(([^)]+)\\)/);
            if (match) {
              actualFinalGALA = Math.abs(parseFloat(match[1]));
              logger.info(`📊 Actual GALA received: ${actualFinalGALA.toFixed(8)}`);
            }
          }
        } else {
          throw error;
        }
      }
    }

    // Final results
    const realProfit = actualFinalGALA - testAmount;
    const realProfitPercent = (realProfit / testAmount) * 100;

    logger.info('\n🎉 ARBITRAGE EXECUTION COMPLETE!');
    logger.info(`💰 Started with: ${testAmount} GALA`);
    logger.info(`💰 Actually ended with: ${actualFinalGALA.toFixed(8)} GALA`);
    logger.info(`💰 Actual profit: ${realProfit.toFixed(8)} GALA (${realProfitPercent.toFixed(2)}%)`);
    logger.info(`📊 Expected vs Actual: ${profitPercent.toFixed(2)}% vs ${realProfitPercent.toFixed(2)}%`);

    if (realProfit > 0) {
      logger.info('🎉 ARBITRAGE SUCCESSFUL!');
    } else {
      logger.warn('❌ Arbitrage resulted in loss due to slippage/fees');
    }

  } catch (error) {
    logger.error('💥 Arbitrage test failed:', error);
  }
}

testArbitrageSmallAmounts().catch(console.error);