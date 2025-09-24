#!/usr/bin/env tsx

/**
 * TEST NATIVE SDK APPROACH 🚀
 * Based on TRANSACTION_LOG.md success: "Native GSwap({ signer }) without URL overrides"
 * Let's try the exact approach that worked for the successful trade
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testNativeSDKApproach(): Promise<void> {
  try {
    logger.info('🚀 TESTING NATIVE SDK APPROACH (from successful trade log)');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;

    // EXACT pattern from TRANSACTION_LOG.md successful trade:
    // "Native GSwap({ signer }) without URL overrides"
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer });

    logger.info('✅ Native GSwap initialized (no URL overrides, no walletAddress)');

    // Connect to event socket as mentioned in successful trade
    try {
      GSwap.events?.connectEventSocket();
      logger.info('📡 Connected to real-time price feeds');
    } catch (error) {
      logger.warn('⚠️ Event socket not available, using polling mode');
    }

    // Test the exact working pattern from transaction log
    logger.info('\\n📈 Testing with native SDK approach...');

    // First get quote
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);
    logger.info(`Fee tier: ${quote.feeTier} (${typeof quote.feeTier})`);

    // Test swap with native approach - maybe the fee validation is different
    logger.info('\\n🧪 Testing swap with native SDK initialization...');

    try {
      // Try the swap with the native SDK setup
      const swapPayload = await gSwap.swaps.swap({
        tokenIn: 'GALA|Unit|none|none',
        tokenOut: 'GUSDC|Unit|none|none',
        fee: quote.feeTier, // Use fee directly from quote
        recipient: walletAddress,
        deadline: Math.floor(Date.now() / 1000) + 1200,
        amountIn: 1,
        amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
        sqrtPriceLimitX96: 0
      });

      logger.info('✅ SUCCESS! Native SDK approach works!');
      logger.info('Swap payload generated successfully');
      // Don't execute, just test payload generation

    } catch (error) {
      logger.error('❌ Native SDK approach also failed:', (error as Error).message);

      // Let's try without specifying recipient (maybe it's auto-detected)
      logger.info('\\n🧪 Trying without explicit recipient...');

      try {
        const swapPayload = await gSwap.swaps.swap({
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: quote.feeTier,
          deadline: Math.floor(Date.now() / 1000) + 1200,
          amountIn: 1,
          amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
          sqrtPriceLimitX96: 0
        });

        logger.info('✅ SUCCESS! Works without explicit recipient!');

      } catch (error2) {
        logger.error('❌ Still failed without recipient:', (error2 as Error).message);
      }
    }

  } catch (error) {
    logger.error('💥 Native SDK test failed:', error);
  }
}

testNativeSDKApproach().catch(console.error);