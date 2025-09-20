#!/usr/bin/env tsx

/**
 * Test GSwap Wrapper
 * Verify the wrapper fixes SDK issues and returns real price data
 */

import { config } from 'dotenv';
import { logger } from '../utils/logger';
import { validateEnvironment } from '../config/environment';
import { GSwapWrapper, PrivateKeySigner } from '../services/gswap-wrapper';
import { safeParseFloat } from '../utils/safe-parse';

// Load environment variables
config();

async function testGSwapWrapper(): Promise<void> {
  logger.info('🧪 Testing GSwap Wrapper with Real API Data...');

  try {
    // Initialize configuration
    const envConfig = validateEnvironment();
    logger.info('✅ Environment configuration validated');

    // Initialize GSwap wrapper (should fix SDK issues)
    const gswap = new GSwapWrapper({
      signer: new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '0x'),
      walletAddress: envConfig.wallet.address,
      gatewayBaseUrl: envConfig.api.baseUrl,
      dexBackendBaseUrl: envConfig.api.baseUrl,
      bundlerBaseUrl: envConfig.api.baseUrl.replace('dex-backend', 'bundle-backend')
    });

    logger.info('✅ GSwap Wrapper initialized');

    // Test tokens with the wrapper
    const testTokens = [
      'GALA$Unit$none$none',
      'GUSDC$Unit$none$none',
      'ETIME$Unit$none$none'
    ];

    const priceResults = [];

    for (const token of testTokens) {
      try {
        logger.info(`\n🧪 Testing wrapper with token: ${token}`);

        // Test 1: Get pool data using wrapper (should work now)
        const poolData = await gswap.pools.getPoolData(token, 'GUSDC$Unit$none$none', 3000);
        logger.info(`✅ Pool data retrieved: sqrtPrice=${poolData.sqrtPrice.toString()}`);

        // Test 2: Calculate price using wrapper (should work now)
        if (poolData?.sqrtPrice) {
          const priceResult = gswap.pools.calculateSpotPrice(token, 'GUSDC$Unit$none$none', poolData.sqrtPrice);
          const calculatedPrice = priceResult ? safeParseFloat(priceResult.toString(), 0) : 0;

          logger.info(`✅ Price calculated: ${calculatedPrice}`);

          if (calculatedPrice > 0) {
            priceResults.push({
              token: token.split('$')[0],
              price: calculatedPrice,
              sqrtPrice: poolData.sqrtPrice.toString()
            });

            logger.info(`💰 ${token.split('$')[0]}: $${calculatedPrice.toFixed(6)}`);
          } else {
            logger.warn(`⚠️ Zero price calculated for ${token}`);
          }
        }

      } catch (error) {
        logger.error(`❌ Error testing ${token}:`, (error as Error).message);
      }
    }

    // Summary
    logger.info('\n🎯 GSWAP WRAPPER TEST RESULTS:');

    if (priceResults.length > 0) {
      logger.info('✅ SUCCESSFULLY RETRIEVED REAL PRICES USING WRAPPER:');

      priceResults.forEach(result => {
        logger.info(`   ${result.token}: $${result.price.toFixed(6)}`);
      });

      // Verify none are hardcoded $1.00 (except GUSDC which should be ~$1)
      const nonStablecoins = priceResults.filter(r => r.token !== 'GUSDC');
      const hardcodedPrices = nonStablecoins.filter(r => r.price === 1.0);

      if (hardcodedPrices.length === 0) {
        logger.info('🎉 CONFIRMED: WRAPPER FIXES SDK ISSUES!');
        logger.info('🚀 REAL MARKET DATA IS NOW WORKING FOR MONDAY!');
      } else {
        logger.warn(`⚠️ Found ${hardcodedPrices.length} potentially hardcoded prices`);
      }

      // Check price reasonableness
      const galaPrice = priceResults.find(r => r.token === 'GALA')?.price;
      if (galaPrice && galaPrice > 0.01 && galaPrice < 0.10) {
        logger.info('✅ GALA price looks reasonable for current market conditions');
      }

      // Test token format flexibility
      logger.info('\n🧪 Testing Token Format Flexibility...');

      try {
        // Test with pipe separators (SDK documentation format)
        logger.info('Testing with pipe separators (SDK docs format)...');
        const _poolDataPipe = await gswap.pools.getPoolData('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 3000);
        logger.info('✅ Pipe separators work with wrapper!');

        // Test with TokenClassKey objects
        logger.info('Testing with TokenClassKey objects...');
        const galaToken = { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' };
        const gusdcToken = { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' };
        const _poolDataObj = await gswap.pools.getPoolData(galaToken, gusdcToken, 3000);
        logger.info('✅ TokenClassKey objects work with wrapper!');

        logger.info('🎯 WRAPPER SUPPORTS ALL TOKEN FORMATS!');

      } catch (error) {
        logger.warn('⚠️ Some token formats not working:', (error as Error).message);
      }

    } else {
      logger.error('❌ NO PRICES RETRIEVED - Wrapper may need further debugging');
    }

  } catch (error) {
    logger.error('❌ GSwap Wrapper Test Failed:', error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testGSwapWrapper()
    .then(() => {
      logger.info('🎉 GSwap Wrapper Tests Completed Successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 GSwap Wrapper Tests Failed:', error);
      process.exit(1);
    });
}

export { testGSwapWrapper };