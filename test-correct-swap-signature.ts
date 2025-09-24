#!/usr/bin/env tsx

/**
 * TEST CORRECT SWAP SIGNATURE 🔧
 * The SDK inspection revealed the swap method expects positional parameters,
 * not an object. Let's test the correct signature.
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from './src/config/environment';
import { logger } from './src/utils/logger';

config();

async function testCorrectSwapSignature(): Promise<void> {
  try {
    logger.info('🔧 TESTING CORRECT SWAP METHOD SIGNATURE');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '');
    const gSwap = new GSwap({
      signer: signer,
      walletAddress: env.wallet.address
    });

    // First get a quote to see what parameters we should use
    logger.info('📈 Getting quote first...');
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote result:`, {
      outTokenAmount: quote.outTokenAmount.toNumber(),
      feeTier: quote.feeTier,
      feeTierType: typeof quote.feeTier
    });

    // SDK inspection showed: async swap(tokenIn, tokenOut, fee, amount, walletAddress)
    logger.info('\\n🧪 Testing positional parameters (SDK signature)...');

    try {
      // Try the positional parameter approach
      const swapResult = await gSwap.swaps.swap(
        'GALA|Unit|none|none',    // tokenIn
        'GUSDC|Unit|none|none',   // tokenOut
        quote.feeTier,            // fee (use fee from quote)
        1,                        // amount
        env.wallet.address        // walletAddress
      );

      logger.info('✅ Positional parameters work!');
      logger.info('Swap payload generated successfully:', typeof swapResult);
      // Don't execute, just test payload generation

    } catch (error) {
      logger.error('❌ Positional parameters failed:', (error as Error).message);
    }

    // Let's also try with different fee values to see what works
    logger.info('\\n🧪 Testing different fee values...');

    const feeTests = [
      { name: 'quote.feeTier', value: quote.feeTier },
      { name: 'parseInt(quote.feeTier)', value: parseInt(quote.feeTier.toString()) },
      { name: 'Number(quote.feeTier)', value: Number(quote.feeTier) },
      { name: 'hardcoded 500', value: 500 },
      { name: 'hardcoded 3000', value: 3000 }
    ];

    for (const test of feeTests) {
      try {
        logger.info(`Testing fee: ${test.name} = ${test.value} (${typeof test.value})`);

        const swapResult = await gSwap.swaps.swap(
          'GALA|Unit|none|none',
          'GUSDC|Unit|none|none',
          test.value,
          1,
          env.wallet.address
        );

        logger.info(`✅ Fee ${test.name} works!`);
        break; // Exit on first success

      } catch (error) {
        logger.error(`❌ Fee ${test.name} failed: ${(error as Error).message}`);
      }
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testCorrectSwapSignature().catch(console.error);