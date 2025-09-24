#!/usr/bin/env tsx

/**
 * TEST COMPLETE API FORMAT 🎯
 * We found the working token format! Now adding sqrtPriceLimit to complete it.
 * Object format 1 worked but needs sqrtPriceLimit (not sqrtPriceLimitX96)
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testCompleteAPIFormat(): Promise<void> {
  try {
    logger.info('🎯 TESTING COMPLETE API FORMAT WITH SQRTPRICELIMIT');

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

    // Test the working object format with sqrtPriceLimit
    const correctParams = {
      tokenIn: {
        collection: 'GALA',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none'
      },
      tokenOut: {
        collection: 'GUSDC',
        category: 'Unit',
        type: 'none',
        additionalKey: 'none'
      },
      fee: quote.feeTier,
      amountIn: 1,
      amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
      sqrtPriceLimit: '0' // Try as string first
    };

    logger.info('\\n🚀 Testing complete API format...');
    logger.info('Parameters:', {
      tokenIn: correctParams.tokenIn,
      tokenOut: correctParams.tokenOut,
      fee: correctParams.fee,
      amountIn: correctParams.amountIn,
      amountOutMinimum: correctParams.amountOutMinimum,
      sqrtPriceLimit: correctParams.sqrtPriceLimit
    });

    try {
      const response = await fetch(`${baseUrl}/v1/trade/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(correctParams)
      });

      if (response.ok) {
        const swapPayload = await response.json();
        logger.info('🎉 BREAKTHROUGH! COMPLETE API FORMAT WORKS!');
        logger.info('✅ Swap payload generated successfully via direct API');
        logger.info('✅ All validation errors resolved');

        logger.info('\\n🚀 FINAL WORKING API FORMAT DISCOVERED:');
        logger.info('📋 COMPLETE SOLUTION:');
        logger.info('1. ✅ Use SDK for quotes: gSwap.quoting.quoteExactInput()');
        logger.info('2. ✅ Use direct API for swaps: POST /v1/trade/swap');
        logger.info('3. ✅ Token format: { collection, category, type, additionalKey }');
        logger.info('4. ✅ Required parameters: tokenIn, tokenOut, fee, amountIn, amountOutMinimum, sqrtPriceLimit');
        logger.info('5. ✅ Remove: recipient, deadline, sqrtPriceLimitX96');

        logger.info('\\n📋 READY TO IMPLEMENT IN ARBITRAGE SCRIPTS!');

      } else {
        const errorData = await response.text();
        logger.error(`❌ Still failed: ${errorData}`);

        // Try sqrtPriceLimit as number instead of string
        logger.info('\\n🧪 Trying sqrtPriceLimit as number...');

        const numberParams = { ...correctParams, sqrtPriceLimit: 0 };

        const response2 = await fetch(`${baseUrl}/v1/trade/swap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(numberParams)
        });

        if (response2.ok) {
          logger.info('✅ SUCCESS with sqrtPriceLimit as number!');
        } else {
          const errorData2 = await response2.text();
          logger.error(`❌ Number format also failed: ${errorData2}`);
        }
      }

    } catch (fetchError) {
      logger.error('❌ Fetch error:', fetchError);
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testCompleteAPIFormat().catch(console.error);