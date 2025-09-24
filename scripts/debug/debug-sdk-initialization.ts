#!/usr/bin/env tsx

/**
 * DEBUG SDK INITIALIZATION 🔍
 * Since the API accepts our parameters, the issue must be in SDK initialization
 * Let's test different SDK initialization patterns to find what works
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from './src/config/environment';
import { logger } from './src/utils/logger';

config();

async function debugSDKInitialization(): Promise<void> {
  try {
    logger.info('🔍 DEBUGGING SDK INITIALIZATION PATTERNS');

    const env = validateEnvironment();
    const privateKey = process.env.WALLET_PRIVATE_KEY!;

    // Test different initialization patterns
    const initPatterns = [
      {
        name: 'Current pattern (with walletAddress)',
        init: () => {
          const signer = new PrivateKeySigner(privateKey);
          return new GSwap({
            signer,
            walletAddress: env.wallet.address
          });
        }
      },
      {
        name: 'Minimal pattern (signer only)',
        init: () => {
          const signer = new PrivateKeySigner(privateKey);
          return new GSwap({ signer });
        }
      },
      {
        name: 'With all URL overrides',
        init: () => {
          const signer = new PrivateKeySigner(privateKey);
          return new GSwap({
            signer,
            walletAddress: env.wallet.address,
            gatewayBaseUrl: 'https://dex-backend-prod1.defi.gala.com',
            dexBackendBaseUrl: 'https://dex-backend-prod1.defi.gala.com',
            bundlerBaseUrl: 'https://bundle-backend-prod1.defi.gala.com'
          });
        }
      },
      {
        name: 'Transaction log success pattern',
        init: () => {
          const signer = new PrivateKeySigner(privateKey);
          // Pattern from TRANSACTION_LOG.md: "Native GSwap({ signer }) without URL overrides"
          return new GSwap({ signer });
        }
      }
    ];

    for (const pattern of initPatterns) {
      logger.info(`\\n🧪 Testing: ${pattern.name}`);

      try {
        const gSwap = pattern.init();

        // Test quote (this should work)
        const quote = await gSwap.quoting.quoteExactInput(
          'GALA|Unit|none|none',
          'GUSDC|Unit|none|none',
          1
        );

        logger.info(`   ✅ Quote works: ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

        // Test swap with the exact parameters that worked via API
        const swapParams = {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: quote.feeTier,
          recipient: env.wallet.address,
          deadline: Math.floor(Date.now() / 1000) + 1200,
          amountIn: 1,
          amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
          sqrtPriceLimitX96: 0
        };

        logger.info(`   🔄 Testing swap with ${pattern.name}...`);

        try {
          const swapPayload = await gSwap.swaps.swap(swapParams);
          logger.info(`   🎉 SUCCESS! ${pattern.name} works for swaps!`);
          logger.info(`   ✅ This is the correct initialization pattern`);

          // Show the working pattern
          logger.info('\\n📋 WORKING SDK PATTERN FOUND:');
          logger.info(`   Pattern: ${pattern.name}`);
          logger.info('   Ready to update all arbitrage scripts');

          return; // Exit on first success

        } catch (swapError) {
          logger.error(`   ❌ Swap failed: ${(swapError as Error).message}`);
        }

      } catch (initError) {
        logger.error(`   ❌ Initialization failed: ${(initError as Error).message}`);
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.error('🚫 All SDK initialization patterns failed');

  } catch (error) {
    logger.error('💥 Debug failed:', error);
  }
}

debugSDKInitialization().catch(console.error);