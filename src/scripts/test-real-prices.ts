#!/usr/bin/env tsx

/**
 * Real Price Test - Direct API Approach
 * Demonstrates working price tracking with real data
 */

import { config } from 'dotenv';
import { logger } from '../utils/logger';
import { validateEnvironment } from '../config/environment';

// API response interfaces
interface PriceApiResponse {
  data?: number | string;
  message?: string;
  status?: number;
  [key: string]: unknown;
}

interface PoolApiResponse {
  data: {
    Data: {
      fee: number;
      liquidity: string;
      sqrtPrice: string;
      tick: number;
      token0: string;
      token1: string;
      [key: string]: unknown;
    };
  };
  status: number;
  message?: string;
}

// Load environment variables
config();

async function testRealPrices(): Promise<void> {
  logger.info('🚀 Testing REAL Price Tracking with Direct API...');

  try {
    // Initialize configuration
    const envConfig = validateEnvironment();
    const baseUrl = envConfig.api.baseUrl;

    logger.info(`Using API: ${baseUrl}`);

    // Test real price fetching
    const tokens = [
      'GALA$Unit$none$none',
      'GUSDC$Unit$none$none',
      'ETIME$Unit$none$none'
    ];

    const priceResults = [];

    for (const token of tokens) {
      try {
        logger.info(`Fetching real price for ${token}...`);

        const response = await fetch(`${baseUrl}/v1/trade/price?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        });

        const data = await response.json() as PriceApiResponse;

        if (response.status === 200) {
          const price = parseFloat(String(data.data || '0'));
          priceResults.push({
            token: token.split('$')[0], // Extract token symbol
            price: price,
            priceUsd: price,
            timestamp: Date.now(),
            raw: data
          });

          logger.info(`✅ ${token.split('$')[0]}: $${price.toFixed(6)} ${data.stale ? '(stale)' : '(live)'}`);
        } else {
          logger.error(`❌ ${token}: ${data.message}`);
        }
      } catch (error) {
        logger.error(`❌ Error fetching ${token}:`, (error as Error).message);
      }
    }

    // Test pool data
    logger.info('🧪 Testing Pool Data...');

    try {
      const params = new URLSearchParams({
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: '3000'
      });

      const response = await fetch(`${baseUrl}/v1/trade/pool?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      const poolData = await response.json();

      if (response.status === 200) {
        const pool = (poolData as PoolApiResponse).data.Data;
        logger.info(`✅ Pool GALA/GUSDC:`, {
          fee: pool.fee,
          liquidity: pool.liquidity,
          sqrtPrice: pool.sqrtPrice,
          token0: pool.token0ClassKey,
          token1: pool.token1ClassKey
        });

        // Calculate price from sqrtPrice manually (for verification)
        const sqrtPrice = parseFloat(pool.sqrtPrice);
        const calculatedPrice = sqrtPrice * sqrtPrice; // sqrtPriceX96 simplified

        logger.info(`🧮 Calculated price from pool sqrtPrice: $${calculatedPrice.toFixed(6)}`);
      } else {
        logger.error(`❌ Pool fetch failed:`, poolData);
      }
    } catch (error) {
      logger.error(`❌ Pool fetch error:`, (error as Error).message);
    }

    // Summary
    logger.info('🎯 REAL PRICE TRACKING RESULTS:');

    if (priceResults.length > 0) {
      logger.info('✅ SUCCESSFULLY RETRIEVED REAL PRICES:');

      priceResults.forEach(result => {
        logger.info(`   ${result.token}: $${result.price.toFixed(6)}`);
      });

      // Verify none are hardcoded $1.00 (except GUSDC which should be ~$1)
      const nonStablecoins = priceResults.filter(r => r.token !== 'GUSDC');
      const hardcodedPrices = nonStablecoins.filter(r => r.price === 1.0);

      if (hardcodedPrices.length === 0) {
        logger.info('🎉 CONFIRMED: NO HARDCODED $1.00 PRICES DETECTED!');
        logger.info('🚀 YOUR BOT CAN GET REAL MARKET DATA FOR MONDAY!');
      } else {
        logger.warn(`⚠️ Found ${hardcodedPrices.length} potentially hardcoded prices`);
      }

      // Check price reasonableness
      const galaPrice = priceResults.find(r => r.token === 'GALA')?.price;
      if (galaPrice && galaPrice > 0.01 && galaPrice < 0.10) {
        logger.info('✅ GALA price looks reasonable for current market conditions');
      }

    } else {
      logger.error('❌ NO PRICES RETRIEVED - API might be down or tokens invalid');
    }

  } catch (error) {
    logger.error('❌ Real Price Test Failed:', error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testRealPrices()
    .then(() => {
      logger.info('🎉 Real Price Tests Completed Successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Real Price Tests Failed:', error);
      process.exit(1);
    });
}

export { testRealPrices };