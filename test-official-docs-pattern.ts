#!/usr/bin/env tsx

/**
 * TEST OFFICIAL DOCS PATTERN 📚
 * Using the EXACT pattern from https://galachain.github.io/gswap-sdk/docs/intro/
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testOfficialDocsPattern(): Promise<void> {
  try {
    logger.info('📚 TESTING OFFICIAL DOCS PATTERN');
    logger.info('From: https://galachain.github.io/gswap-sdk/docs/intro/');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;

    // Official docs pattern
    const gSwap = new GSwap({
      signer: new PrivateKeySigner(privateKey),
    });

    logger.info('✅ Using official docs pattern: new GSwap({ signer })');

    const GALA_SELLING_AMOUNT = 1; // Amount of GALA to sell

    // Quote how much GUSDC you can get for 1 GALA
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none', // Token to sell
      'GUSDC|Unit|none|none', // Token to buy
      GALA_SELLING_AMOUNT,
    );

    logger.info(`Quote: ${GALA_SELLING_AMOUNT} GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);
    logger.info(`Fee tier: ${quote.feeTier}`);

    // Execute a swap using the OFFICIAL DOCS SIGNATURE
    logger.info('\n🔄 Testing swap with OFFICIAL DOCS SIGNATURE...');

    const transaction = await gSwap.swaps.swap(
      'GALA|Unit|none|none', // Token to sell
      'GUSDC|Unit|none|none', // Token to buy
      quote.feeTier, // Use the fee tier from the quote
      {
        exactIn: GALA_SELLING_AMOUNT,
        amountOutMinimum: quote.outTokenAmount.multipliedBy(0.95), // 5% slippage
      },
      walletAddress, // your wallet address
    );

    logger.info('🎉 SUCCESS! Official docs pattern works!');
    logger.info('✅ Transaction generated:', typeof transaction);

    // Test bundle execution
    logger.info('\n🔄 Testing bundle execution...');
    logger.info('✅ Would execute with gSwap.bundles.executeBundle(transaction)');
    logger.info('🎯 SOLUTION: Use official docs API signature!');

  } catch (error) {
    logger.error('❌ Official docs pattern failed:', (error as Error).message);
  }
}

testOfficialDocsPattern().catch(console.error);