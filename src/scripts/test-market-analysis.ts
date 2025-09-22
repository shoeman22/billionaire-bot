#!/usr/bin/env tsx

/**
 * Test Script: Market Analysis & Pool Discovery
 *
 * SAFETY LEVEL: ZERO RISK
 * - Only reads market data
 * - No transactions or wallet operations
 * - Safe to run anytime
 */

import { config } from 'dotenv';
import { validateEnvironment } from '../config/environment';
import { GSwapWrapper } from '../services/gswap-wrapper';
import { MarketAnalysis } from '../monitoring/market-analysis';
import { Logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { PrivateKeySigner } from '@gala-chain/gswap-sdk';

config();

const logger = new Logger('TestMarketAnalysis');

async function testMarketAnalysis() {
  try {
    logger.info('🧪 Testing Market Analysis & Pool Discovery...');

    // Validate environment
    const env = validateEnvironment();
    logger.info('✅ Environment configuration validated');

    // Initialize components
    const gswap = new GSwapWrapper({
      signer: new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '0x'),
      walletAddress: env.wallet.address,
      gatewayBaseUrl: env.api.baseUrl,
      dexBackendBaseUrl: env.api.baseUrl,
      bundlerBaseUrl: env.api.baseUrl.replace('dex-backend', 'bundle-backend')
    });
    logger.info('✅ GSwap SDK initialized');

    const marketAnalysis = new MarketAnalysis(gswap);
    logger.info('✅ Market Analysis initialized');

    // Test 1: Discover available pools
    logger.info('🔍 Test 1: Discovering available pools...');

    const commonTokens = [
      TRADING_CONSTANTS.TOKENS.GALA,
      TRADING_CONSTANTS.TOKENS.GUSDC,
      'GALA$Unit$none$none',
      'GUSDC$Unit$none$none',
      'ETIME$Unit$none$none',
      'SILK$Unit$none$none'
    ];

    const availablePools = [];

    for (const token0 of commonTokens) {
      for (const token1 of commonTokens) {
        if (token0 === token1) continue;

        try {
          const poolData = await gswap.pools.getPoolData(token0, token1, TRADING_CONSTANTS.FEE_TIERS.STANDARD);
          if (poolData) {
            availablePools.push({
              token0,
              token1,
              fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
              liquidity: poolData.liquidity,
              sqrtPrice: poolData.sqrtPrice
            });
            logger.info(`✅ Found pool: ${token0} / ${token1}`);
          }
        } catch (error) {
          // Pool doesn't exist, continue
        }
      }
    }

    logger.info('📊 Available Pools:', { count: availablePools.length, pools: availablePools });

    if (availablePools.length === 0) {
      logger.warn('⚠️ No pools found - trying different fee tiers...');

      // Try different fee tiers
      const feeTiers = [500, 3000, 10000]; // 0.05%, 0.30%, 1.00%

      for (const feeTier of feeTiers) {
        try {
          const poolData = await gswap.pools.getPoolData(
            'GALA$Unit$none$none',
            'GUSDC$Unit$none$none',
            feeTier
          );
          if (poolData) {
            logger.info(`✅ Found GALA/GUSDC pool with ${feeTier/10000}% fee`);
            availablePools.push({
              token0: 'GALA$Unit$none$none',
              token1: 'GUSDC$Unit$none$none',
              fee: feeTier,
              liquidity: poolData.liquidity,
              sqrtPrice: poolData.sqrtPrice
            });
            break;
          }
        } catch (error) {
          logger.debug(`No pool for fee tier ${feeTier}`);
        }
      }
    }

    // Test 2: Analyze market conditions (if we have pools)
    if (availablePools.length > 0) {
      logger.info('📈 Test 2: Analyzing market conditions...');

      const marketConditions = await marketAnalysis.analyzeMarket();
      logger.info('Market Analysis Results:', {
        overall: marketConditions.overall,
        confidence: `${marketConditions.confidence}%`,
        volatility: marketConditions.volatility,
        liquidity: marketConditions.liquidity,
        sentiment: marketConditions.sentiment
      });

      const isFavorable = marketAnalysis.isFavorableForTrading();
      logger.info(`Trading Conditions: ${isFavorable ? '✅ Favorable' : '❌ Unfavorable'}`);
    }

    // Test 3: Price calculations (if we have pools)
    if (availablePools.length > 0) {
      logger.info('💰 Test 3: Testing price calculations...');

      const testPool = availablePools[0];
      try {
        const spotPrice = gswap.pools.calculateSpotPrice(testPool.sqrtPrice);
        logger.info('Price Calculation:', {
          pool: `${testPool.token0} / ${testPool.token1}`,
          sqrtPrice: testPool.sqrtPrice,
          spotPrice: spotPrice,
          liquidity: testPool.liquidity
        });
      } catch (error) {
        logger.error('Price calculation failed:', error);
      }
    }

    // Test 4: Trading suitability assessment
    logger.info('🎯 Test 4: Assessing trading suitability...');

    if (availablePools.length === 0) {
      logger.warn('❌ No pools available - trading not possible');
      logger.info('💡 Suggestions:', {
        checkTokenFormats: 'Ensure tokens use correct GalaChain format: TOKEN$Unit$none$none',
        verifyNetwork: 'Confirm connected to correct GalaChain network',
        checkLiquidity: 'Some pools may exist but have zero liquidity'
      });
    } else {
      logger.info('✅ Pools available for trading');
      logger.info('📊 Trading Readiness Report:', {
        availablePools: availablePools.length,
        recommendedPools: availablePools.filter(p => parseFloat(p.liquidity) > 0).length,
        totalLiquidity: availablePools.reduce((sum, pool) => sum + parseFloat(pool.liquidity || '0'), 0)
      });
    }

    logger.info('🎉 Market Analysis Tests Completed');

    return {
      success: true,
      availablePools,
      poolCount: availablePools.length,
      readyForTrading: availablePools.length > 0
    };

  } catch (error) {
    logger.error('❌ Market analysis test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testMarketAnalysis()
    .then(result => {
      if (result.success) {
        console.log('\n🎉 Market Analysis Test: PASSED');
        console.log(`📊 Found ${result.poolCount} available pools`);
        console.log(`🚀 Ready for trading: ${result.readyForTrading ? 'YES' : 'NO'}`);
        process.exit(0);
      } else {
        console.log('\n❌ Market Analysis Test: FAILED');
        console.log(`Error: ${result.error}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { testMarketAnalysis };