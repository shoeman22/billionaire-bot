#!/usr/bin/env tsx

/**
 * DEBUG FEE ISSUE 🔍
 * Test fee validation with known good values
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';

config();

async function debugFeeIssue(): Promise<void> {
  try {
    logger.info('🔍 DEBUGGING FEE VALIDATION ISSUE');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '');
    const gSwap = new GSwap({
      signer: signer,
      walletAddress: env.wallet.address
    });

    // Test with hardcoded known good values - try different parameter names
    const testParams1 = {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      fee: 500, // Known good fee tier
      recipient: env.wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      amountIn: 1,
      amountOutMinimum: 0.015,
      sqrtPriceLimitX96: 0
    };

    const testParams2 = {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      feeTier: 500, // Try feeTier instead of fee
      recipient: env.wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      amountIn: 1,
      amountOutMinimum: 0.015,
      sqrtPriceLimitX96: 0
    };

    const testParams3 = {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      poolFee: 500, // Try poolFee
      recipient: env.wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      amountIn: 1,
      amountOutMinimum: 0.015,
      sqrtPriceLimitX96: 0
    };

    // Test different parameter structures
    const paramTests = [
      { name: 'fee', params: testParams1 },
      { name: 'feeTier', params: testParams2 },
      { name: 'poolFee', params: testParams3 }
    ];

    for (const test of paramTests) {
      logger.info(`\n🧪 Testing parameter structure: ${test.name}`);
      logger.info('Parameters:', test.params);

      try {
        // Try to generate swap payload with this parameter structure
        const swapPayload = await gSwap.swaps.swap(test.params);
        logger.info(`✅ Parameter structure ${test.name} works!`);
        // Don't execute, just test payload generation
        return; // Exit on first success
      } catch (error) {
        logger.error(`❌ Parameter structure ${test.name} failed:`, (error as Error).message);
      }
    }

    logger.error('🚫 All fee formats failed!');

  } catch (error) {
    logger.error('💥 Debug failed:', error);
  }
}

debugFeeIssue().catch(console.error);