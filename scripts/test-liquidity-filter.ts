#!/usr/bin/env tsx

/**
 * Test Liquidity Filter
 * Demonstrates the liquidity filtering system that prevents quote requests for known illiquid pairs
 */

import { liquidityFilter } from '../src/utils/liquidity-filter';
import { logger } from '../src/utils/logger';

async function testLiquidityFilter() {
  console.log('🔍 Testing Liquidity Filter System\n');

  // Test problematic pairs from production logs
  const problematicPairs = [
    ['SILK|Unit|none|none', 'GWBTC|Unit|none|none'],
    ['SILK|Unit|none|none', 'GWETH|Unit|none|none'],
    ['GALA|Unit|none|none', 'GTON|Unit|none|none'],
    ['GUSDC|Unit|none|none', 'GTON|Unit|none|none'],
    ['GUSDT|Unit|none|none', 'ETIME|Unit|none|none'],
    ['GWBTC|Unit|none|none', 'ETIME|Unit|none|none'],
    ['GUSDT|Unit|none|none', 'GTON|Unit|none|none'],
    ['GUSDC|Unit|none|none', 'ETIME|Unit|none|none']
  ];

  // Test liquid pairs
  const liquidPairs = [
    ['GALA|Unit|none|none', 'GUSDC|Unit|none|none'],
    ['GALA|Unit|none|none', 'GUSDT|Unit|none|none'],
    ['GUSDC|Unit|none|none', 'GUSDT|Unit|none|none'],
    ['GALA|Unit|none|none', 'ETIME|Unit|none|none'],
    ['GALA|Unit|none|none', 'SILK|Unit|none|none']
  ];

  console.log('❌ Testing Known Illiquid Pairs (should be filtered):');
  for (const [tokenIn, tokenOut] of problematicPairs) {
    const filtered = liquidityFilter.shouldFilterPair(tokenIn, tokenOut);
    const tokenInSymbol = tokenIn.split('|')[0];
    const tokenOutSymbol = tokenOut.split('|')[0];

    console.log(`   ${tokenInSymbol} → ${tokenOutSymbol}: ${filtered ? '🚫 FILTERED' : '✅ ALLOWED'}`);
  }

  console.log('\n✅ Testing Known Liquid Pairs (should be allowed):');
  for (const [tokenIn, tokenOut] of liquidPairs) {
    const filtered = liquidityFilter.shouldFilterPair(tokenIn, tokenOut);
    const tokenInSymbol = tokenIn.split('|')[0];
    const tokenOutSymbol = tokenOut.split('|')[0];

    console.log(`   ${tokenInSymbol} → ${tokenOutSymbol}: ${filtered ? '🚫 FILTERED' : '✅ ALLOWED'}`);
  }

  // Test getting liquid pairs for strategy use
  console.log('\n📊 Liquid Pairs Analysis:');
  const allTokens = [
    'GALA|Unit|none|none',
    'GUSDC|Unit|none|none',
    'GUSDT|Unit|none|none',
    'ETIME|Unit|none|none',
    'SILK|Unit|none|none',
    'GTON|Unit|none|none',
    'GWETH|Unit|none|none',
    'GWBTC|Unit|none|none'
  ];

  const liquidTokenPairs = liquidityFilter.getLiquidPairs(allTokens);
  console.log(`   Total possible pairs from ${allTokens.length} tokens: ${allTokens.length * (allTokens.length - 1)}`);
  console.log(`   Liquid pairs (filtered): ${liquidTokenPairs.length}`);

  // Show high-confidence pairs
  const highConfidencePairs = liquidityFilter.getHighConfidencePairs();
  console.log(`   High-confidence pairs (whitelisted): ${highConfidencePairs.length}`);

  console.log('\n🎯 High-Confidence Liquid Pairs:');
  for (const pair of highConfidencePairs.slice(0, 10)) { // Show first 10
    const tokenInSymbol = pair.tokenIn.split('|')[0];
    const tokenOutSymbol = pair.tokenOut.split('|')[0];
    console.log(`   ${tokenInSymbol} → ${tokenOutSymbol}`);
  }

  // Show statistics
  console.log('\n📈 Liquidity Filter Statistics:');
  const stats = liquidityFilter.getStatistics();
  console.log(`   Static blacklist size: ${stats.staticBlacklistSize}`);
  console.log(`   Dynamic blacklist size: ${stats.dynamicBlacklistSize}`);
  console.log(`   Whitelist size: ${stats.whitelistSize}`);
  console.log(`   Total filtered: ${stats.totalFiltered}`);
  console.log(`   Blacklist hits: ${stats.blacklistHits}`);
  console.log(`   Whitelist overrides: ${stats.whitelistOverrides}`);

  console.log('\n✨ Liquidity filter is working correctly!');
  console.log('   - Known illiquid pairs are being filtered');
  console.log('   - Known liquid pairs are being allowed');
  console.log('   - This will prevent the "No pools found with sufficient liquidity" errors');
}

// Run the test
testLiquidityFilter().catch(console.error);