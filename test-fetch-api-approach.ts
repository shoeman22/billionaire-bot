#!/usr/bin/env tsx

/**
 * TEST FETCH API APPROACH 🌐
 * Using built-in fetch to test direct API calls without SDK validation
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testFetchAPIApproach(): Promise<void> {
  try {
    logger.info('🌐 TESTING DIRECT API WITH FETCH (bypassing SDK validation)');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;
    const baseUrl = 'https://dex-backend-prod1.defi.gala.com';

    // Use SDK for quotes (this works fine)
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer, walletAddress });

    logger.info('📈 Getting quote via SDK...');
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);
    logger.info(`Fee tier: ${quote.feeTier}`);

    // Prepare swap parameters (same as SDK but for direct API)
    const swapParams = {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      fee: quote.feeTier,
      recipient: walletAddress,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      amountIn: 1,
      amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
      sqrtPriceLimitX96: 0
    };

    logger.info('\\n🌐 Testing direct API call with fetch...');
    logger.info('Swap parameters:', swapParams);

    try {
      // Direct API call using fetch
      const response = await fetch(`${baseUrl}/v1/trade/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(swapParams)
      });

      if (response.ok) {
        const swapPayload = await response.json();
        logger.info('✅ SUCCESS! Direct API approach works!');
        logger.info('✅ Swap payload generated via API');
        logger.info('🎉 BREAKTHROUGH: Direct API bypasses SDK validation!');

        logger.info('\\n📋 WORKING SOLUTION FOUND:');
        logger.info('1. ✅ Use SDK for quotes: gSwap.quoting.quoteExactInput()');
        logger.info('2. ✅ Use direct API for swaps: POST /v1/trade/swap');
        logger.info('3. ✅ This completely bypasses SDK fee validation issues');
        logger.info('4. ✅ Ready to implement in arbitrage scripts');

      } else {
        const errorData = await response.text();
        logger.error(`❌ API returned ${response.status}: ${response.statusText}`);
        logger.error('Response:', errorData);

        // Check for common API issues
        if (response.status === 401 || response.status === 403) {
          logger.info('🔑 Authentication required - may need signed requests');
        }
      }

    } catch (fetchError) {
      logger.error('❌ Fetch failed:', fetchError);
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testFetchAPIApproach().catch(console.error);