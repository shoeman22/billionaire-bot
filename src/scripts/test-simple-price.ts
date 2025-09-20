#!/usr/bin/env tsx

/**
 * Simple Price Test Script
 * Test the SDK token format directly
 */

import { config } from 'dotenv';
import { logger } from '../utils/logger';
import { validateEnvironment } from '../config/environment';

// Load environment variables
config();
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

async function testSimplePrice(): Promise<void> {
  logger.info('🧪 Testing Simple Price API Calls...');

  try {
    // Initialize configuration
    const envConfig = validateEnvironment();
    logger.info('✅ Environment configuration validated');

    // Initialize GSwap SDK
    const gswap = new GSwap({
      signer: new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '0x'),
      walletAddress: envConfig.wallet.address,
      gatewayBaseUrl: envConfig.api.baseUrl,
      dexBackendBaseUrl: envConfig.api.baseUrl,
      bundlerBaseUrl: envConfig.api.baseUrl.replace('dex-backend', 'bundle-backend')
    });

    logger.info('✅ GSwap SDK initialized');

    // Test 1: Try using TokenClassKey objects instead of strings
    logger.info('🧪 Test 1: Using TokenClassKey objects');

    const galaToken = {
      collection: 'GALA',
      category: 'Unit',
      type: 'none',
      additionalKey: 'none'
    };

    const gusdcToken = {
      collection: 'GUSDC',
      category: 'Unit',
      type: 'none',
      additionalKey: 'none'
    };

    try {
      logger.info('Testing with TokenClassKey objects...');
      const poolData = await gswap.pools.getPoolData(galaToken, gusdcToken, 3000);
      logger.info('✅ SUCCESS: Pool data retrieved with TokenClassKey objects!', poolData);

      if (poolData?.sqrtPrice) {
        const priceResult = gswap.pools.calculateSpotPrice(galaToken, gusdcToken, poolData.sqrtPrice);
        logger.info('✅ Price calculated:', priceResult?.toString());
      }
    } catch (error) {
      logger.error('❌ Error with TokenClassKey objects:', error);
    }

    // Test 2: Try different string formats
    logger.info('🧪 Test 2: Testing Different String Formats');

    const formats = [
      'GALA',
      'GALA$Unit$none$none',
      'gala',
      'gala$unit$none$none',
      'GALA|Unit|none|none',
      'GALA:Unit:none:none'
    ];

    for (const format of formats) {
      try {
        logger.info(`Testing format: ${format}`);
        const poolData = await gswap.pools.getPoolData(format, 'GUSDC', 3000);
        logger.info(`✅ SUCCESS with format ${format}:`, poolData);
      } catch (error) {
        logger.warn(`❌ Failed with format ${format}:`, (error as Error).message);
      }
    }

    // Test 3: Check SDK version and methods
    logger.info('🧪 Test 3: SDK Method Inspection');

    logger.info('Available pool methods:', Object.getOwnPropertyNames(gswap.pools.constructor.prototype));
    logger.info('SDK version info available via inspection...');

  } catch (error) {
    logger.error('❌ Simple Price Test Failed:', error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testSimplePrice()
    .then(() => {
      logger.info('🎉 Simple Price Tests Completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Simple Price Tests Failed:', error);
      process.exit(1);
    });
}

export { testSimplePrice };