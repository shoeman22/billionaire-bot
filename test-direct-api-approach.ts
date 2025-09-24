#!/usr/bin/env tsx

/**
 * TEST DIRECT API APPROACH 🌐
 * Since SDK validation is failing, let's try using the API endpoints directly
 * as documented in CLAUDE.md: POST /v1/trade/swap + POST /v1/trade/bundle
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';
import axios from 'axios';

config();

async function testDirectAPIApproach(): Promise<void> {
  try {
    logger.info('🌐 TESTING DIRECT API APPROACH (bypassing SDK validation)');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;
    const baseUrl = 'https://dex-backend-prod1.defi.gala.com';

    // Still use SDK for quotes (this works)
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer, walletAddress });

    // Get quote using SDK (this works)
    logger.info('📈 Getting quote via SDK...');
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);
    logger.info(`Fee tier: ${quote.feeTier}`);

    // Now try direct API call for swap (bypass SDK validation)
    logger.info('\\n🌐 Generating swap payload via direct API...');

    const swapParams = {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      fee: quote.feeTier, // Use fee from working quote
      recipient: walletAddress,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      amountIn: 1,
      amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
      sqrtPriceLimitX96: 0
    };

    logger.info('Swap parameters:', swapParams);

    try {
      // Direct API call to /v1/trade/swap
      const swapResponse = await axios.post(`${baseUrl}/v1/trade/swap`, swapParams, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      logger.info('✅ SUCCESS! Direct API approach works!');
      logger.info('Swap payload generated via API:', typeof swapResponse.data);

      // Show that we can get the payload without SDK validation issues
      logger.info('🎉 BREAKTHROUGH: API approach bypasses SDK validation completely!');
      logger.info('📋 WORKING PATTERN:');
      logger.info('1. Use SDK for quotes: gSwap.quoting.quoteExactInput()');
      logger.info('2. Use direct API for swaps: POST /v1/trade/swap');
      logger.info('3. This bypasses the problematic SDK fee validation');

      // We won't execute the trade, just confirm payload generation works

    } catch (apiError: any) {
      logger.error('❌ Direct API failed:', {
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: apiError.response?.data,
        message: apiError.message
      });

      // Try to see if we need authentication
      if (apiError.response?.status === 401 || apiError.response?.status === 403) {
        logger.info('🔑 API might require authentication. Let me check...');
      }
    }

  } catch (error) {
    logger.error('💥 Direct API test failed:', error);
  }
}

testDirectAPIApproach().catch(console.error);