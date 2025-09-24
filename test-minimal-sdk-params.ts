#!/usr/bin/env tsx

/**
 * TEST MINIMAL SDK PARAMETERS 🔬
 * Since even hardcoded values fail, let's test with absolutely minimal parameters
 * to isolate which parameter is causing the validation error
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from './src/config/environment';
import { logger } from './src/utils/logger';

config();

async function testMinimalSDKParams(): Promise<void> {
  try {
    logger.info('🔬 TESTING MINIMAL SDK PARAMETERS');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY!);
    const gSwap = new GSwap({
      signer,
      walletAddress: env.wallet.address
    });

    // Get quote first
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote works: ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

    // Test progressively simpler parameter sets to isolate the problem
    const parameterTests = [
      {
        name: 'Absolutely minimal',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: 500,
          amountIn: 1
        }
      },
      {
        name: 'With amountOutMinimum',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: 500,
          amountIn: 1,
          amountOutMinimum: 0.01
        }
      },
      {
        name: 'With recipient only',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: 500,
          amountIn: 1,
          recipient: env.wallet.address
        }
      },
      {
        name: 'With deadline only',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: 500,
          amountIn: 1,
          deadline: Math.floor(Date.now() / 1000) + 1200
        }
      },
      {
        name: 'With sqrtPriceLimitX96 only',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: 500,
          amountIn: 1,
          sqrtPriceLimitX96: 0
        }
      }
    ];

    for (const test of parameterTests) {
      logger.info(`\\n🧪 Testing: ${test.name}`);
      logger.info('Parameters:', test.params);

      try {
        const swapPayload = await gSwap.swaps.swap(test.params);
        logger.info(`✅ SUCCESS! ${test.name} works!`);
        logger.info('Found working parameter set');
        return; // Exit on first success

      } catch (error) {
        logger.error(`❌ ${test.name} failed: ${(error as Error).message}`);
      }
    }

    // If all fail, there might be a deeper issue. Let's check the SDK method signature
    logger.info('\\n🔍 Checking if swaps service exists...');
    logger.info('gSwap.swaps exists:', !!gSwap.swaps);
    logger.info('gSwap.swaps.swap exists:', !!(gSwap.swaps && gSwap.swaps.swap));
    logger.info('typeof gSwap.swaps.swap:', typeof (gSwap.swaps && gSwap.swaps.swap));

    // Check if there are other methods we should be using
    if (gSwap.swaps) {
      logger.info('\\nAvailable methods on swaps service:');
      Object.getOwnPropertyNames(gSwap.swaps).forEach(prop => {
        logger.info(`  ${prop}: ${typeof (gSwap.swaps as any)[prop]}`);
      });

      // Check prototype methods
      const prototype = Object.getPrototypeOf(gSwap.swaps);
      if (prototype) {
        logger.info('\\nPrototype methods:');
        Object.getOwnPropertyNames(prototype).forEach(prop => {
          if (typeof prototype[prop] === 'function' && prop !== 'constructor') {
            logger.info(`  ${prop}: function`);
          }
        });
      }
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testMinimalSDKParams().catch(console.error);