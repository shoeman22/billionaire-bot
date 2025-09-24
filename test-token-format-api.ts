#!/usr/bin/env tsx

/**
 * TEST TOKEN FORMAT FOR API 🔍
 * API says "tokenIn must be either object or array"
 * Let's figure out the correct token format for the direct API
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testTokenFormatAPI(): Promise<void> {
  try {
    logger.info('🔍 TESTING TOKEN FORMAT FOR DIRECT API');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;
    const baseUrl = 'https://dex-backend-prod1.defi.gala.com';

    // Use SDK for quotes to see how it formats tokens internally
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer, walletAddress });

    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote result: ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

    // Test different token format structures
    const tokenFormats = [
      {
        name: 'Object format 1',
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
        }
      },
      {
        name: 'Array format 1',
        tokenIn: ['GALA', 'Unit', 'none', 'none'],
        tokenOut: ['GUSDC', 'Unit', 'none', 'none']
      },
      {
        name: 'Object format 2',
        tokenIn: {
          classKey: 'GALA|Unit|none|none'
        },
        tokenOut: {
          classKey: 'GUSDC|Unit|none|none'
        }
      },
      {
        name: 'Object format 3',
        tokenIn: {
          symbol: 'GALA',
          address: 'GALA|Unit|none|none'
        },
        tokenOut: {
          symbol: 'GUSDC',
          address: 'GUSDC|Unit|none|none'
        }
      }
    ];

    for (const format of tokenFormats) {
      logger.info(`\\n🧪 Testing: ${format.name}`);

      const params = {
        tokenIn: format.tokenIn,
        tokenOut: format.tokenOut,
        fee: quote.feeTier,
        amountIn: 1,
        amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95
      };

      logger.info('Token format:', {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut
      });

      try {
        const response = await fetch(`${baseUrl}/v1/trade/swap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(params)
        });

        if (response.ok) {
          const swapPayload = await response.json();
          logger.info(`🎉 SUCCESS! ${format.name} works!`);
          logger.info('✅ Found correct token format');
          logger.info('🚀 API call successful');

          logger.info('\\n📋 WORKING TOKEN FORMAT:');
          logger.info('tokenIn:', JSON.stringify(format.tokenIn, null, 2));
          logger.info('tokenOut:', JSON.stringify(format.tokenOut, null, 2));

          return; // Exit on first success

        } else {
          const errorData = await response.text();
          logger.error(`❌ ${format.name} failed: ${errorData}`);
        }

      } catch (fetchError) {
        logger.error(`❌ ${format.name} fetch error:`, fetchError);
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.error('🚫 All token formats failed');

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testTokenFormatAPI().catch(console.error);