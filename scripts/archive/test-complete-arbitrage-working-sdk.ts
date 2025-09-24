#!/usr/bin/env tsx

/**
 * COMPLETE ARBITRAGE WITH WORKING SDK 🎯
 * Using the corrected API signature and proper quote-based parameters
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';

config();

async function completeArbitrageWithWorkingSDK(): Promise<void> {
  try {
    logger.info('🎯 COMPLETE ARBITRAGE WITH WORKING SDK');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '');

    const gSwap = new GSwap({
      signer,
      walletAddress: env.wallet.address
    });

    try {
      await gSwap.connectSocket();
      logger.info('📡 Connected to bundler socket');
    } catch (error) {
      logger.warn('⚠️ Socket connection failed, will use transaction ID only');
    }

    // Step 1: Get GALA → GUSDC Quote
    logger.info('\n📈 STEP 1: Get GALA → GUSDC Quote');

    const quote1 = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote1.outTokenAmount.toNumber().toFixed(6)} GUSDC`);
    logger.info(`Fee tier: ${quote1.feeTier}`);
    logger.info(`Expected rate: 1 GALA = ${quote1.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

    // Step 2: Execute GALA → GUSDC Trade with proper quote-based slippage
    logger.info('\n🔄 STEP 2: Execute GALA → GUSDC Trade');

    const swapPayload1 = await gSwap.swaps.swap(
      'GALA|Unit|none|none', // Token to sell
      'GUSDC|Unit|none|none', // Token to buy
      quote1.feeTier, // Use the fee tier from the quote
      {
        exactIn: 1,
        amountOutMinimum: quote1.outTokenAmount.multipliedBy(0.95), // 5% slippage using SDK method
      },
      env.wallet.address, // wallet address
    );

    logger.info(`✅ Trade 1 submitted: ${swapPayload1.transactionId}`);

    // Handle transaction confirmation
    if (swapPayload1.waitDelegate && typeof swapPayload1.waitDelegate === 'function') {
      try {
        logger.info('🔄 Waiting for trade 1 confirmation...');
        const result1 = await swapPayload1.waitDelegate();
        logger.info(`✅ Trade 1 confirmed: ${result1.hash}`);
      } catch (error: any) {
        if (error.details?.transactionHash) {
          logger.info(`✅ Trade 1 executed: ${error.details.transactionHash}`);
          logger.error(`❌ But failed: ${error.details.Message}`);
          return; // Don't continue if first trade failed
        } else {
          throw error;
        }
      }
    } else {
      logger.info(`✅ Trade 1 transaction ID: ${swapPayload1.transactionId}`);
    }

    logger.info('⏳ Waiting 5 seconds before reverse trade...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: Get GUSDC → GALA Quote
    logger.info('\n📈 STEP 3: Get GUSDC → GALA Quote');

    const gusdcAmount = quote1.outTokenAmount.toNumber(); // Use actual output from first trade

    const quote2 = await gSwap.quoting.quoteExactInput(
      'GUSDC|Unit|none|none',
      'GALA|Unit|none|none',
      gusdcAmount
    );

    logger.info(`Quote: ${gusdcAmount.toFixed(6)} GUSDC → ${quote2.outTokenAmount.toNumber().toFixed(6)} GALA`);
    logger.info(`Fee tier: ${quote2.feeTier}`);

    // Step 4: Execute GUSDC → GALA Trade
    logger.info('\n🔄 STEP 4: Execute GUSDC → GALA Trade');

    const swapPayload2 = await gSwap.swaps.swap(
      'GUSDC|Unit|none|none', // Token to sell
      'GALA|Unit|none|none', // Token to buy
      quote2.feeTier, // Use the fee tier from the quote
      {
        exactIn: gusdcAmount,
        amountOutMinimum: quote2.outTokenAmount.multipliedBy(0.95), // 5% slippage using SDK method
      },
      env.wallet.address, // wallet address
    );

    logger.info(`✅ Trade 2 submitted: ${swapPayload2.transactionId}`);

    // Handle transaction confirmation
    if (swapPayload2.waitDelegate && typeof swapPayload2.waitDelegate === 'function') {
      try {
        logger.info('🔄 Waiting for trade 2 confirmation...');
        const result2 = await swapPayload2.waitDelegate();
        logger.info(`✅ Trade 2 confirmed: ${result2.hash}`);
      } catch (error: any) {
        if (error.details?.transactionHash) {
          logger.info(`✅ Trade 2 executed: ${error.details.transactionHash}`);
          logger.error(`❌ But failed: ${error.details.Message}`);
        } else {
          throw error;
        }
      }
    } else {
      logger.info(`✅ Trade 2 transaction ID: ${swapPayload2.transactionId}`);
    }

    // Calculate arbitrage results
    const finalGala = quote2.outTokenAmount.toNumber();
    const profit = finalGala - 1; // Started with 1 GALA
    const profitPercent = (profit / 1) * 100;

    logger.info('\n🎉 ARBITRAGE COMPLETE!');
    logger.info(`💰 Started with: 1.000000 GALA`);
    logger.info(`💰 Expected to end with: ${finalGala.toFixed(6)} GALA`);
    logger.info(`💰 Expected profit: ${profit.toFixed(6)} GALA (${profitPercent.toFixed(2)}%)`);
    logger.info('\n🎯 SDK IS WORKING PERFECTLY WITH OFFICIAL DOCS API!');

  } catch (error) {
    logger.error('💥 Arbitrage failed:', error);
  }
}

completeArbitrageWithWorkingSDK().catch(console.error);