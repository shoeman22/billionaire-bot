#!/usr/bin/env tsx

/**
 * API Endpoint Test Script
 * Check what endpoints are actually available
 */

import { config } from 'dotenv';
import { logger } from '../utils/logger';
import { validateEnvironment } from '../config/environment';
// Using built-in fetch instead of axios

// Load environment variables
config();

async function testApiEndpoints(): Promise<void> {
  logger.info('🧪 Testing API Endpoints...');

  try {
    // Initialize configuration
    const envConfig = validateEnvironment();
    const baseUrl = envConfig.api.baseUrl;

    logger.info(`Testing API at: ${baseUrl}`);

    // Test basic health/status endpoints
    const healthEndpoints = [
      '/health',
      '/status',
      '/version',
      '/api/health',
      '/api/status',
      '/api/version'
    ];

    for (const endpoint of healthEndpoints) {
      try {
        logger.info(`Testing ${endpoint}...`);
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        });
        const data = await response.text();
        logger.info(`✅ ${endpoint}: ${response.status} - ${data.slice(0, 200)}`);
      } catch (error) {
        if ((error as Error).name === 'TypeError' && (error as Error).message.includes('fetch')) {
          logger.warn(`❌ ${endpoint}: Network error - ${(error as Error).message}`);
        } else {
          logger.warn(`❌ ${endpoint}: ${(error as Error).message}`);
        }
      }
    }

    // Test documented API endpoints
    const apiEndpoints = [
      '/v1/trade/quote',
      '/v1/trade/price',
      '/v1/trade/price-multiple',
      '/v1/trade/pool',
      '/api/asset/dexv3-contract/GetPoolData',
      '/api/asset/dexv3-contract/GetUserPositions'
    ];

    for (const endpoint of apiEndpoints) {
      try {
        logger.info(`Testing ${endpoint}...`);
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        });
        const _data = await response.text();
        logger.info(`✅ ${endpoint}: ${response.status} - Available`);
      } catch (error) {
        logger.warn(`❌ ${endpoint}: ${(error as Error).message}`);
      }
    }

    // Test with basic parameters
    logger.info('🧪 Testing with basic parameters...');

    // Try a simple quote request
    try {
      const quoteParams = {
        tokenIn: 'GALA',
        tokenOut: 'GUSDC',
        amountIn: '1'
      };

      const response = await fetch(`${baseUrl}/v1/trade/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(quoteParams),
        signal: AbortSignal.timeout(10000)
      });
      const data = await response.json();

      logger.info('✅ Quote endpoint works!', data);
    } catch (error) {
      logger.warn(`❌ Quote test: ${(error as Error).message}`);
    }

    // Try a simple price request
    try {
      const priceResponse = await fetch(`${baseUrl}/v1/trade/price?token=GALA`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
      const priceData = await priceResponse.json();

      logger.info('✅ Price endpoint works!', priceData);
    } catch (error) {
      logger.warn(`❌ Price test: ${(error as Error).message}`);
    }

  } catch (error) {
    logger.error('❌ API Endpoint Test Failed:', error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testApiEndpoints()
    .then(() => {
      logger.info('🎉 API Endpoint Tests Completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 API Endpoint Tests Failed:', error);
      process.exit(1);
    });
}

export { testApiEndpoints };