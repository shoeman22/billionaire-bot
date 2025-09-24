#!/usr/bin/env tsx

/**
 * TEST MINIMAL API PARAMETERS 🔧
 * API is rejecting properties one by one. Let's find the minimal working set.
 * So far: NO recipient, NO deadline
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testMinimalAPIParams(): Promise<void> {
  try {
    logger.info('🔧 FINDING MINIMAL API PARAMETER SET');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;
    const baseUrl = 'https://dex-backend-prod1.defi.gala.com';

    // Use SDK for quotes
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer, walletAddress });

    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

    // Test different parameter combinations to find what works
    const paramTests = [
      {
        name: 'Minimal core params',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: quote.feeTier,
          amountIn: 1
        }
      },
      {
        name: 'Core + amountOutMinimum',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: quote.feeTier,
          amountIn: 1,
          amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95
        }
      },
      {
        name: 'Core + sqrtPriceLimitX96',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: quote.feeTier,
          amountIn: 1,
          sqrtPriceLimitX96: 0
        }
      },
      {
        name: 'All except recipient and deadline',
        params: {
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          fee: quote.feeTier,
          amountIn: 1,
          amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
          sqrtPriceLimitX96: 0
        }
      }
    ];

    for (const test of paramTests) {
      logger.info(`\\n🧪 Testing: ${test.name}`);
      logger.info('Parameters:', test.params);

      try {
        const response = await fetch(`${baseUrl}/v1/trade/swap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(test.params)
        });

        if (response.ok) {
          const swapPayload = await response.json();
          logger.info(`🎉 SUCCESS! ${test.name} works!`);
          logger.info('✅ Found working API parameter format');
          logger.info('🚀 Swap payload generated successfully');

          logger.info('\\n📋 FINAL WORKING FORMAT:');
          Object.entries(test.params).forEach(([key, value]) => {
            logger.info(`  • ${key}: ${value}`);
          });

          return; // Exit on first success

        } else {
          const errorData = await response.text();
          logger.error(`❌ ${test.name} failed: ${errorData}`);
        }

      } catch (fetchError) {
        logger.error(`❌ ${test.name} fetch error:`, fetchError);
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.error('🚫 All parameter combinations failed');

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testMinimalAPIParams().catch(console.error);