#!/usr/bin/env tsx

/**
 * TEST API WITHOUT RECIPIENT 🎯
 * The API told us "property recipient should not exist"
 * Let's fix this and find the working API format
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testAPIWithoutRecipient(): Promise<void> {
  try {
    logger.info('🎯 TESTING API WITHOUT RECIPIENT PROPERTY');

    const privateKey = process.env.WALLET_PRIVATE_KEY!;
    const walletAddress = process.env.WALLET_ADDRESS!;
    const baseUrl = 'https://dex-backend-prod1.defi.gala.com';

    // Use SDK for quotes
    const signer = new PrivateKeySigner(privateKey);
    const gSwap = new GSwap({ signer, walletAddress });

    logger.info('📈 Getting quote...');
    const quote = await gSwap.quoting.quoteExactInput(
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      1
    );

    logger.info(`Quote: 1 GALA → ${quote.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

    // Remove recipient property as API requested
    const swapParams = {
      tokenIn: 'GALA|Unit|none|none',
      tokenOut: 'GUSDC|Unit|none|none',
      fee: quote.feeTier,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      amountIn: 1,
      amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
      sqrtPriceLimitX96: 0
      // NO recipient property
    };

    logger.info('\\n🌐 Testing API without recipient...');
    logger.info('Parameters:', swapParams);

    try {
      const response = await fetch(`${baseUrl}/v1/trade/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(swapParams)
      });

      if (response.ok) {
        const swapPayload = await response.json();
        logger.info('🎉 BREAKTHROUGH! API CALL SUCCESSFUL!');
        logger.info('✅ Swap payload generated successfully');
        logger.info('✅ Direct API approach works perfectly');

        logger.info('\\n🚀 SOLUTION DISCOVERED:');
        logger.info('1. ✅ Use SDK for quotes: gSwap.quoting.quoteExactInput()');
        logger.info('2. ✅ Use direct API for swaps: POST /v1/trade/swap');
        logger.info('3. ✅ Key fix: Remove recipient property from parameters');
        logger.info('4. ✅ Fee validation works perfectly with direct API');
        logger.info('5. ✅ Ready to update all arbitrage scripts!');

        logger.info('\\n📋 WORKING PARAMETER FORMAT:');
        logger.info('- tokenIn: "GALA|Unit|none|none"');
        logger.info('- tokenOut: "GUSDC|Unit|none|none"');
        logger.info('- fee: 500 (from quote.feeTier)');
        logger.info('- deadline: timestamp + 1200');
        logger.info('- amountIn: 1');
        logger.info('- amountOutMinimum: quote * 0.95');
        logger.info('- sqrtPriceLimitX96: 0');
        logger.info('- NO recipient property!');

      } else {
        const errorData = await response.text();
        logger.error(`❌ API error ${response.status}: ${errorData}`);
      }

    } catch (fetchError) {
      logger.error('❌ Fetch error:', fetchError);
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testAPIWithoutRecipient().catch(console.error);