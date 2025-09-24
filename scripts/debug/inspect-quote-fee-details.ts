#!/usr/bin/env tsx

/**
 * INSPECT QUOTE FEE DETAILS 🔬
 * Let's examine exactly what the quote returns for fee and try different ways to use it
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from './src/config/environment';
import { logger } from './src/utils/logger';

config();

async function inspectQuoteFeeDetails(): Promise<void> {
  try {
    logger.info('🔬 INSPECTING QUOTE FEE DETAILS');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY!);
    const gSwap = new GSwap({
      signer,
      walletAddress: env.wallet.address
    });

    // Get quote and inspect fee in detail
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info('🔍 DETAILED FEE ANALYSIS:');
    logger.info('quote.feeTier:', quote.feeTier);
    logger.info('typeof quote.feeTier:', typeof quote.feeTier);
    logger.info('quote.feeTier.toString():', quote.feeTier.toString());
    logger.info('JSON.stringify(quote.feeTier):', JSON.stringify(quote.feeTier));
    logger.info('quote.feeTier.constructor.name:', quote.feeTier.constructor.name);
    logger.info('Object.prototype.toString.call(quote.feeTier):', Object.prototype.toString.call(quote.feeTier));

    // Check if it's a BigNumber or special object
    if (quote.feeTier && typeof quote.feeTier === 'object') {
      logger.info('Fee tier object properties:');
      Object.getOwnPropertyNames(quote.feeTier).forEach(prop => {
        logger.info(`  ${prop}: ${(quote.feeTier as any)[prop]}`);
      });
    }

    // Try different ways to convert the fee
    const feeConversions = [
      { name: 'Direct use', value: quote.feeTier },
      { name: 'toString()', value: quote.feeTier.toString() },
      { name: 'parseInt(toString())', value: parseInt(quote.feeTier.toString()) },
      { name: 'Number()', value: Number(quote.feeTier) },
      { name: 'Explicit 500', value: 500 },
      { name: 'String "500"', value: "500" },
      { name: '+feeTier', value: +quote.feeTier },
      { name: 'Math.floor(Number())', value: Math.floor(Number(quote.feeTier)) }
    ];

    // Test each conversion with the swap method
    for (const conversion of feeConversions) {
      logger.info(`\\n🧪 Testing fee conversion: ${conversion.name}`);
      logger.info(`Value: ${conversion.value} (${typeof conversion.value})`);

      const swapParams = {
        tokenIn: 'GALA|Unit|none|none',
        tokenOut: 'GUSDC|Unit|none|none',
        fee: conversion.value,
        recipient: env.wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 1200,
        amountIn: 1,
        amountOutMinimum: 0.015,
        sqrtPriceLimitX96: 0
      };

      try {
        const swapPayload = await gSwap.swaps.swap(swapParams);
        logger.info(`✅ SUCCESS! ${conversion.name} works!`);
        logger.info(`Working fee value: ${conversion.value} (${typeof conversion.value})`);
        return; // Exit on first success

      } catch (error) {
        logger.error(`❌ ${conversion.name} failed: ${(error as Error).message}`);
      }
    }

    logger.error('🚫 All fee conversions failed');

  } catch (error) {
    logger.error('💥 Inspection failed:', error);
  }
}

inspectQuoteFeeDetails().catch(console.error);