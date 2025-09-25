#!/usr/bin/env tsx

/**
 * Quick test to identify which token pairs have active liquidity on GalaSwap V3
 * This helps us understand the current DEX state and create realistic demos
 */

import dotenv from 'dotenv';
import { createQuoteWrapper } from '../src/utils/quote-api';
import { validateEnvironment } from '../src/config/environment';

dotenv.config();

interface PoolTestResult {
  pair: string;
  hasLiquidity: boolean;
  error?: string;
  outputAmount?: string;
}

async function testTokenPairs() {
  console.log('🔍 Testing available token pairs on GalaSwap V3...\n');

  const config = validateEnvironment();
  const quoteWrapper = createQuoteWrapper(config.api.baseUrl);

  const tokens = ['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'GUSDT|Unit|none|none', 'GWETH|Unit|none|none', 'GWBTC|Unit|none|none'];
  const testAmount = '100';
  const results: PoolTestResult[] = [];

  for (let i = 0; i < tokens.length; i++) {
    for (let j = 0; j < tokens.length; j++) {
      if (i === j) continue;

      const tokenIn = tokens[i];
      const tokenOut = tokens[j];
      const pair = `${tokenIn.split('|')[0]} → ${tokenOut.split('|')[0]}`;

      try {
        const result = await quoteWrapper.quoteExactInput(tokenIn, tokenOut, testAmount);

        results.push({
          pair,
          hasLiquidity: true,
          outputAmount: result.amountOut
        });

        console.log(`✅ ${pair}: Output ${result.amountOut}`);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const hasPool = !errorMsg.includes('No pools found');

        results.push({
          pair,
          hasLiquidity: hasPool,
          error: errorMsg
        });

        if (hasPool) {
          console.log(`⚠️  ${pair}: Has pool but error - ${errorMsg}`);
        } else {
          console.log(`❌ ${pair}: No pool available`);
        }
      }

      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Summary
  const workingPairs = results.filter(r => r.hasLiquidity);
  const missingPools = results.filter(r => !r.hasLiquidity);

  console.log(`\n📊 Summary:`);
  console.log(`   Working pairs: ${workingPairs.length}/${results.length} (${Math.round(workingPairs.length/results.length*100)}%)`);
  console.log(`   Missing pools: ${missingPools.length}/${results.length}`);

  if (workingPairs.length > 0) {
    console.log(`\n✅ Available trading pairs:`);
    workingPairs.forEach(pair => {
      console.log(`   • ${pair.pair}`);
    });
  }

  if (missingPools.length > 0) {
    console.log(`\n❌ Pairs without sufficient liquidity:`);
    missingPools.slice(0, 10).forEach(pair => {
      console.log(`   • ${pair.pair}`);
    });
    if (missingPools.length > 10) {
      console.log(`   ... and ${missingPools.length - 10} more`);
    }
  }
}

testTokenPairs().catch(console.error);