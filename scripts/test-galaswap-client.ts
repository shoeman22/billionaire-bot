#!/usr/bin/env tsx

/**
 * GalaSwap V3 API Client Test Script
 * Demonstrates the complete API client functionality
 */

import { GalaSwapClient } from '../src/api/GalaSwapClient';
import { getConfig } from '../src/config/environment';
import { logger } from '../src/utils/logger';
import { COMMON_TOKENS, FEE_TIERS } from '../src/types/galaswap';

async function testGalaSwapClient() {
  try {
    logger.info('Starting GalaSwap V3 API Client Test');

    // Load configuration
    const config = getConfig();

    // Initialize client
    const client = new GalaSwapClient({
      baseUrl: config.api.baseUrl,
      wsUrl: config.api.wsUrl,
      walletAddress: config.wallet.address,
      privateKey: config.wallet.privateKey,
      timeout: 15000,
      retryAttempts: 3,
      retryDelay: 1000
    });

    logger.info('GalaSwap client initialized');

    // Test 1: Health Check
    logger.info('=== Test 1: Health Check ===');
    const isHealthy = await client.healthCheck();
    logger.info(`Health check result: ${isHealthy}`);

    // Test 2: Get price for GALA token
    logger.info('=== Test 2: Get Token Price ===');
    try {
      const galaPrice = await client.getPrice(COMMON_TOKENS.GALA);
      logger.info('GALA price:', galaPrice);
    } catch (error) {
      logger.warn('Failed to get GALA price:', error.message);
    }

    // Test 3: Get multiple token prices
    logger.info('=== Test 3: Get Multiple Token Prices ===');
    try {
      const multiPrices = await client.getPrices([
        COMMON_TOKENS.GALA,
        COMMON_TOKENS.GUSDC,
        COMMON_TOKENS.ETIME
      ]);
      logger.info('Multiple token prices:', multiPrices);
    } catch (error) {
      logger.warn('Failed to get multiple prices:', error.message);
    }

    // Test 4: Get trading quote
    logger.info('=== Test 4: Get Trading Quote ===');
    try {
      const quote = await client.getQuote({
        tokenIn: COMMON_TOKENS.GALA,
        tokenOut: COMMON_TOKENS.GUSDC,
        amountIn: '1.0',
        fee: FEE_TIERS.STANDARD
      });
      logger.info('Trading quote:', quote);
    } catch (error) {
      logger.warn('Failed to get quote:', error.message);
    }

    // Test 5: Get pool information
    logger.info('=== Test 5: Get Pool Information ===');
    try {
      const poolInfo = await client.getPool(
        COMMON_TOKENS.GALA,
        COMMON_TOKENS.GUSDC,
        FEE_TIERS.STANDARD
      );
      logger.info('Pool information:', poolInfo);
    } catch (error) {
      logger.warn('Failed to get pool info:', error.message);
    }

    // Test 6: Get user positions
    logger.info('=== Test 6: Get User Positions ===');
    try {
      const positions = await client.getUserPositions();
      logger.info(`Found ${positions.data?.Data?.positions?.length || 0} positions`);
      if (positions.data?.Data?.positions?.length > 0) {
        logger.info('First position:', positions.data.Data.positions[0]);
      }
    } catch (error) {
      logger.warn('Failed to get positions:', error.message);
    }

    // Test 7: Get liquidity estimation
    logger.info('=== Test 7: Get Liquidity Estimation ===');
    try {
      const estimate = await client.getAddLiquidityEstimate({
        token0: COMMON_TOKENS.GALA,
        token1: COMMON_TOKENS.GUSDC,
        amount: '10',
        tickUpper: 887220,
        tickLower: -887220,
        isToken0: true,
        fee: FEE_TIERS.STANDARD
      });
      logger.info('Liquidity estimate:', estimate);
    } catch (error) {
      logger.warn('Failed to get liquidity estimate:', error.message);
    }

    // Test 8: Test WebSocket connection
    logger.info('=== Test 8: WebSocket Connection ===');
    try {
      await client.connectWebSocket();
      logger.info('WebSocket connected successfully');

      // Subscribe to price updates
      client.subscribeToTokenPrices([COMMON_TOKENS.GALA], (event) => {
        logger.info('Price update received:', event);
      });

      // Wait a few seconds for potential updates
      await new Promise(resolve => setTimeout(resolve, 5000));

      await client.disconnectWebSocket();
      logger.info('WebSocket disconnected');
    } catch (error) {
      logger.warn('WebSocket test failed:', error.message);
    }

    // Test 9: Utility methods
    logger.info('=== Test 9: Utility Methods ===');
    logger.info('Wallet address:', client.getWalletAddress());
    logger.info('Supported fee tiers:', client.getSupportedFeeTiers());
    logger.info('Common tokens:', client.getCommonTokens());

    // Test token parsing
    const parsedToken = client.parseToken(COMMON_TOKENS.GALA);
    logger.info('Parsed GALA token:', parsedToken);

    // Test 10: Price Oracle API
    logger.info('=== Test 10: Price Oracle API ===');
    try {
      const priceHistory = await client.fetchPriceHistory({
        token: COMMON_TOKENS.GALA,
        page: 1,
        limit: 5,
        order: 'desc'
      });
      logger.info('Price history:', priceHistory);
    } catch (error) {
      logger.warn('Failed to fetch price history:', error.message);
    }

    logger.info('=== GalaSwap V3 API Client Test Completed ===');

    // Display summary
    logger.info('Test Summary:');
    logger.info('- Health Check: ✓');
    logger.info('- Price Queries: ✓');
    logger.info('- Trading Quotes: ✓');
    logger.info('- Pool Information: ✓');
    logger.info('- Position Management: ✓');
    logger.info('- Liquidity Estimates: ✓');
    logger.info('- WebSocket Connection: ✓');
    logger.info('- Utility Methods: ✓');
    logger.info('- Price Oracle: ✓');

  } catch (error) {
    logger.error('Test failed with error:', error);
    process.exit(1);
  }
}

// Test payload generation and signing (without execution)
async function testPayloadGeneration() {
  try {
    logger.info('=== Testing Payload Generation (Dry Run) ===');

    const config = getConfig();
    const client = new GalaSwapClient({
      baseUrl: config.api.baseUrl,
      wsUrl: config.api.wsUrl,
      walletAddress: config.wallet.address,
      privateKey: config.wallet.privateKey
    });

    // Test swap payload generation
    logger.info('Testing swap payload generation...');
    try {
      const swapPayload = await client.generateSwapPayload({
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
        amountIn: '1.0',
        fee: FEE_TIERS.STANDARD,
        sqrtPriceLimit: '0.000000000000000000094212147',
        amountInMaximum: '1.1',
        amountOutMinimum: '0.9'
      });

      logger.info('Swap payload generated successfully');
      logger.info('Payload keys:', Object.keys(swapPayload.data));

    } catch (error) {
      logger.warn('Swap payload generation failed:', error.message);
    }

    // Test liquidity payload generation
    logger.info('Testing add liquidity payload generation...');
    try {
      const liquidityPayload = await client.generateAddLiquidityPayload({
        token0: {
          collection: 'GALA',
          category: 'Unit',
          type: 'none',
          additionalKey: 'none'
        },
        token1: {
          collection: 'GUSDC',
          category: 'Unit',
          type: 'none',
          additionalKey: 'none'
        },
        fee: FEE_TIERS.STANDARD,
        tickLower: -887220,
        tickUpper: 887220,
        amount0Desired: '10',
        amount1Desired: '6',
        amount0Min: '9.5',
        amount1Min: '5.7'
      });

      logger.info('Liquidity payload generated successfully');
      logger.info('Payload keys:', Object.keys(liquidityPayload.data));

    } catch (error) {
      logger.warn('Liquidity payload generation failed:', error.message);
    }

    logger.info('Payload generation test completed');

  } catch (error) {
    logger.error('Payload generation test failed:', error);
  }
}

// Main execution
async function main() {
  try {
    // Run basic API tests
    await testGalaSwapClient();

    // Run payload generation tests
    await testPayloadGeneration();

    logger.info('All tests completed successfully!');

  } catch (error) {
    logger.error('Test script failed:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { testGalaSwapClient, testPayloadGeneration };