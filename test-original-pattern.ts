#!/usr/bin/env tsx

/**
 * TEST ORIGINAL PATTERN 🔄
 * Try the exact pattern mentioned in TRANSACTION_LOG.md that was successful:
 * "Native GSwap({ signer }) without URL overrides"
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testOriginalPattern(): Promise<void> {
  try {
    logger.info('🔄 TESTING ORIGINAL SUCCESSFUL PATTERN');
    logger.info('Pattern from TRANSACTION_LOG.md: "Native GSwap({ signer }) without URL overrides"');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;

    // EXACT pattern from successful trade: Native GSwap({ signer })
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer });

    logger.info('✅ Using EXACT native pattern: new GSwap({ signer })');

    // Connect event socket as mentioned in successful trade
    try {
      GSwap.events?.connectEventSocket();
      logger.info('📡 Connected to real-time price feeds');
    } catch (error) {
      logger.warn('⚠️ Event socket not available');
    }

    // Test quote (should work)
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

    // Test swap with the ORIGINAL successful pattern
    logger.info('\\n🔄 Testing swap with ORIGINAL successful pattern...');

    const swapParams = {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      fee: quote.feeTier,
      // Try without recipient first (maybe auto-detected from signer)
      deadline: Math.floor(Date.now() / 1000) + 1200,
      amountIn: 1,
      amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
      sqrtPriceLimitX96: 0
    };

    try {
      const swapPayload = await gSwap.swaps.swap(swapParams);
      logger.info('🎉 SUCCESS! Original pattern works!');
      logger.info('✅ Native SDK approach is working');

    } catch (error) {
      logger.error('❌ Original pattern failed:', (error as Error).message);

      // Maybe the original included walletAddress from environment
      logger.info('\\n🧪 Trying with walletAddress from env...');

      const walletAddress = process.env.WALLET_ADDRESS!;
      const swapParams2 = {
        ...swapParams,
        recipient: walletAddress
      };

      try {
        const swapPayload2 = await gSwap.swaps.swap(swapParams2);
        logger.info('✅ Works with explicit recipient from env!');
      } catch (error2) {
        logger.error('❌ Still failed with explicit recipient:', (error2 as Error).message);
      }
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testOriginalPattern().catch(console.error);