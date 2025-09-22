#!/usr/bin/env tsx

/**
 * Token Discovery Script
 * Find the correct token formats for the API
 */

import { config } from 'dotenv';
import { logger } from '../utils/logger';
import { validateEnvironment } from '../config/environment';

// API response interfaces
interface ApiResponse {
  data?: unknown;
  message?: string;
  status?: number;
  [key: string]: unknown;
}

// Load environment variables
config();

async function discoverTokens(): Promise<void> {
  logger.info('🧪 Discovering valid token formats...');

  try {
    // Initialize configuration
    const envConfig = validateEnvironment();
    const baseUrl = envConfig.api.baseUrl;

    logger.info(`Testing API at: ${baseUrl}`);

    // Try different token formats
    const tokenFormats = [
      // Simple names
      'GALA',
      'USDC',
      'ETH',
      'BTC',

      // GalaChain specific
      'GUSDC',
      'ETIME',
      'SILK',
      'GTON',

      // Composite formats
      'GALA$Unit$none$none',
      'GUSDC$Unit$none$none',
      'ETIME$Unit$none$none',

      // Different separators
      'GALA-Unit-none-none',
      'GALA|Unit|none|none',
      'GALA:Unit:none:none',

      // Different cases
      'gala',
      'gusdc',
      'etime',
    ];

    for (const token of tokenFormats) {
      try {
        logger.info(`Testing token format: ${token}`);

        const response = await fetch(`${baseUrl}/v1/trade/price?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        });

        const data = await response.json() as ApiResponse;

        if (response.status === 200) {
          logger.info(`✅ SUCCESS: ${token} returned valid price data!`, data);
        } else if (response.status === 400 && data.message === 'Token Not found') {
          logger.debug(`❌ ${token}: Token not found`);
        } else {
          logger.warn(`⚠️ ${token}: ${response.status} - ${data.message || JSON.stringify(data)}`);
        }

      } catch (error) {
        logger.debug(`❌ ${token}: ${(error as Error).message}`);
      }

      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Try pool endpoint with different formats
    logger.info('🧪 Testing pool endpoint...');

    const poolTests = [
      { token0: 'GALA', token1: 'USDC', fee: 3000 },
      { token0: 'GALA', token1: 'GUSDC', fee: 3000 },
      { token0: 'GALA$Unit$none$none', token1: 'GUSDC$Unit$none$none', fee: 3000 },
    ];

    for (const test of poolTests) {
      try {
        const params = new URLSearchParams({
          token0: test.token0,
          token1: test.token1,
          fee: test.fee.toString()
        });

        logger.info(`Testing pool: ${test.token0}/${test.token1} fee=${test.fee}`);

        const response = await fetch(`${baseUrl}/v1/trade/pool?${params}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        });

        const data = await response.json() as ApiResponse;

        if (response.status === 200) {
          logger.info(`✅ SUCCESS: Pool found for ${test.token0}/${test.token1}!`, data);
        } else {
          logger.warn(`❌ Pool test ${test.token0}/${test.token1}: ${response.status} - ${data.message || JSON.stringify(data).slice(0, 200)}`);
        }

      } catch (error) {
        logger.debug(`❌ Pool test error: ${(error as Error).message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

  } catch (error) {
    logger.error('❌ Token Discovery Failed:', error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  discoverTokens()
    .then(() => {
      logger.info('🎉 Token Discovery Completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Token Discovery Failed:', error);
      process.exit(1);
    });
}

export { discoverTokens };