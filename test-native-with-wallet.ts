#!/usr/bin/env tsx

/**
 * TEST NATIVE SDK WITH WALLET 🎯
 * We discovered the fee validation passes with native SDK!
 * Now testing with proper wallet address inclusion
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testNativeWithWallet(): Promise<void> {
  try {
    logger.info('🎯 TESTING NATIVE SDK WITH WALLET ADDRESS');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;

    // Native approach that passed fee validation
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({
      signer,
      walletAddress // Add wallet address to constructor
    });

    logger.info('✅ Native GSwap initialized with wallet address');

    // Connect to event socket
    try {
      GSwap.events?.connectEventSocket();
      logger.info('📡 Connected to real-time price feeds');
    } catch (error) {
      logger.warn('⚠️ Event socket not available');
    }

    // Get quote
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);
    logger.info(`Fee tier: ${quote.feeTier}`);

    // Test swap with native approach + wallet address
    logger.info('\\n🚀 Testing swap with native SDK + wallet...');

    try {
      const swapPayload = await gSwap.swaps.swap({
        tokenIn: 'GALA|Unit|none|none',
        tokenOut: 'GUSDC|Unit|none|none',
        fee: quote.feeTier, // This should work now
        recipient: walletAddress,
        deadline: Math.floor(Date.now() / 1000) + 1200,
        amountIn: 1,
        amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
        sqrtPriceLimitX96: 0
      });

      logger.info('🎉 BREAKTHROUGH! Native SDK + wallet approach works!');
      logger.info('✅ Swap payload generated successfully');
      logger.info('🔧 This is the correct pattern for arbitrage scripts');

      // Show the working pattern for documentation
      logger.info('\\n📋 WORKING PATTERN DISCOVERED:');
      logger.info('1. Use native GSwap constructor: new GSwap({ signer, walletAddress })');
      logger.info('2. Fee validation passes with this approach');
      logger.info('3. Standard swap object parameters work correctly');

      return; // Success!

    } catch (error) {
      logger.error('❌ Still failed with wallet address:', (error as Error).message);

      // Try one more variation - maybe recipient should be omitted
      logger.info('\\n🧪 Trying without recipient (auto-detect from wallet)...');

      try {
        const swapPayload = await gSwap.swaps.swap({
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: quote.feeTier,
          deadline: Math.floor(Date.now() / 1000) + 1200,
          amountIn: 1,
          amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
          sqrtPriceLimitX96: 0
          // No recipient - let SDK auto-detect from constructor
        });

        logger.info('🎉 SUCCESS! Auto-detected recipient works!');

      } catch (error2) {
        logger.error('❌ Auto-detect also failed:', (error2 as Error).message);
      }
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testNativeWithWallet().catch(console.error);