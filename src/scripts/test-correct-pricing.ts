#!/usr/bin/env tsx

/**
 * Test Correct Pricing Fix
 * Verify that switching to 10000 fee tier gives us correct GALA price (~$0.017)
 */

import { config } from 'dotenv';
import { logger } from '../utils/logger';
import { validateEnvironment } from '../config/environment';
import { GSwapWrapper, PrivateKeySigner } from '../services/gswap-wrapper';
import { PriceTracker } from '../monitoring/price-tracker';
import { safeParseFloat } from '../utils/safe-parse';

config();

async function testCorrectPricing(): Promise<void> {
  logger.info('🧪 Testing Correct Pricing Fix - Fee Tier 10000 vs 3000');
  logger.info('=======================================================');

  try {
    const envConfig = validateEnvironment();
    logger.info('✅ Environment configured');

    const gswap = new GSwapWrapper({
      signer: new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '0x'),
      walletAddress: envConfig.wallet.address,
      gatewayBaseUrl: envConfig.api.baseUrl,
      dexBackendBaseUrl: envConfig.api.baseUrl,
      bundlerBaseUrl: envConfig.api.baseUrl.replace('dex-backend', 'bundle-backend')
    });

    logger.info('✅ GSwap Wrapper initialized');

    // Test different fee tiers to show the difference
    const feeTiers = [3000, 10000];
    const results: Array<{ fee: number; price: number; liquidity: string }> = [];

    logger.info('\n🔍 Comparing Fee Tiers for GALA Pricing:');

    for (const fee of feeTiers) {
      try {
        logger.info(`\nTesting fee tier ${fee} (${fee/10000}%)...`);

        const poolData = await gswap.pools.getPoolData('GALA$Unit$none$none', 'GUSDC$Unit$none$none', fee);

        if (poolData?.sqrtPrice) {
          const priceResult = gswap.pools.calculateSpotPrice('GALA$Unit$none$none', 'GUSDC$Unit$none$none', poolData.sqrtPrice);
          const price = priceResult ? safeParseFloat(priceResult.toString(), 0) : 0;

          results.push({
            fee,
            price,
            liquidity: poolData.liquidity.toString()
          });

          logger.info(`✅ Fee ${fee}: GALA = $${price.toFixed(6)} (liquidity: ${poolData.liquidity.toString()})`);

          // Check if price is reasonable
          if (price >= 0.015 && price <= 0.025) {
            logger.info('✅ Price looks reasonable for current GALA market conditions');
          } else if (price > 0.05) {
            logger.warn('⚠️ Price seems too high - likely low liquidity pool');
          } else {
            logger.warn('⚠️ Price seems too low - needs investigation');
          }
        } else {
          logger.warn(`⚠️ No pool data found for fee tier ${fee}`);
        }

      } catch (error) {
        logger.error(`❌ Error with fee tier ${fee}:`, (error as Error).message);
      }
    }

    // Test PriceTracker with the fix
    logger.info('\n🧪 Testing PriceTracker with Corrected Fee Tier (10000):');

    const priceTracker = new PriceTracker(gswap);
    await priceTracker.start();

    // Wait for price updates
    await new Promise(resolve => setTimeout(resolve, 3000));

    const galaPrice = priceTracker.getPrice('GALA');
    if (galaPrice) {
      logger.info(`💰 PriceTracker GALA: $${galaPrice.priceUsd.toFixed(6)}`);

      if (galaPrice.priceUsd >= 0.015 && galaPrice.priceUsd <= 0.025) {
        logger.info('🎉 SUCCESS: PriceTracker now returns correct GALA price!');
        logger.info('✅ Price matches CoinMarketCap expectations (~$0.017)');
      } else {
        logger.error('❌ PriceTracker still showing incorrect price');
      }
    } else {
      logger.warn('⚠️ PriceTracker has no GALA price yet');
    }

    await priceTracker.stop();

    // Summary
    logger.info('\n📊 PRICING FIX SUMMARY:');
    logger.info('======================');

    results.forEach(result => {
      const status = result.price >= 0.015 && result.price <= 0.025 ? '✅ CORRECT' : '❌ INCORRECT';
      logger.info(`Fee ${result.fee}: $${result.price.toFixed(6)} ${status}`);
    });

    const correctResult = results.find(r => r.price >= 0.015 && r.price <= 0.025);
    if (correctResult) {
      logger.info(`\n🎯 RECOMMENDED: Use fee tier ${correctResult.fee} for accurate pricing`);
      logger.info('🚀 READY FOR MONDAY PRESENTATION WITH CORRECT PRICES!');
    }

  } catch (error) {
    logger.error('❌ Pricing test failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testCorrectPricing()
    .then(() => {
      logger.info('\n✨ Pricing Fix Test Completed Successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('\n💥 Pricing Fix Test Failed:', error);
      process.exit(1);
    });
}

export { testCorrectPricing };