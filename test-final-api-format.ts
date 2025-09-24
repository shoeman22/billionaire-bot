#!/usr/bin/env tsx

/**
 * TEST FINAL API FORMAT 🏆
 * Adding amountInMaximum to complete the working API format
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { logger } from './src/utils/logger';

config();

async function testFinalAPIFormat(): Promise<void> {
  try {
    logger.info('🏆 TESTING FINAL COMPLETE API FORMAT');

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

    // Complete API format with all required parameters
    const finalParams = {
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
      amountInMaximum: 1.05, // Add some buffer for slippage
      amountOutMinimum: quote.outTokenAmount.toNumber() * 0.95,
      sqrtPriceLimit: 0 // Use number format
    };

    logger.info('\\n🏆 Testing final complete API format...');
    logger.info('All parameters:', finalParams);

    try {
      const response = await fetch(`${baseUrl}/v1/trade/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(finalParams)
      });

      if (response.ok) {
        const swapPayload = await response.json();
        logger.info('🎉🎉🎉 COMPLETE SUCCESS! FINAL API FORMAT WORKS! 🎉🎉🎉');
        logger.info('✅ Swap payload generated successfully');
        logger.info('✅ Direct API completely bypasses SDK validation issues');

        logger.info('\\n🚀 VICTORY! COMPLETE WORKING SOLUTION:');
        logger.info('================================================');
        logger.info('📋 STEP 1: Get quotes via SDK');
        logger.info('   gSwap.quoting.quoteExactInput(tokenIn, tokenOut, amount)');
        logger.info('');
        logger.info('📋 STEP 2: Generate swap via direct API call');
        logger.info('   POST https://dex-backend-prod1.defi.gala.com/v1/trade/swap');
        logger.info('');
        logger.info('📋 REQUIRED PARAMETERS:');
        logger.info('   • tokenIn: { collection, category, type, additionalKey }');
        logger.info('   • tokenOut: { collection, category, type, additionalKey }');
        logger.info('   • fee: (from quote.feeTier)');
        logger.info('   • amountIn: trade amount');
        logger.info('   • amountInMaximum: amountIn + slippage buffer');
        logger.info('   • amountOutMinimum: expected output - slippage');
        logger.info('   • sqrtPriceLimit: 0');
        logger.info('');
        logger.info('📋 REMOVE THESE (they cause errors):');
        logger.info('   ❌ recipient (auto-detected)');
        logger.info('   ❌ deadline (not needed)');
        logger.info('   ❌ sqrtPriceLimitX96 (wrong name)');
        logger.info('');
        logger.info('🎯 READY TO IMPLEMENT IN ALL ARBITRAGE SCRIPTS!');

      } else {
        const errorData = await response.text();
        logger.error(`❌ Final format failed: ${errorData}`);
      }

    } catch (fetchError) {
      logger.error('❌ Fetch error:', fetchError);
    }

  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

testFinalAPIFormat().catch(console.error);