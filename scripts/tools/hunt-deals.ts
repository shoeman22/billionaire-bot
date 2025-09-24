#!/usr/bin/env tsx

/**
 * DEAL HUNTER 🎯
 * Live arbitrage opportunity scanner for GalaSwap V3
 * Real money hunting mode - let's find some profit!
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';

config();

interface ArbitrageOpportunity {
  tokenA: string;
  tokenB: string;
  profitPercent: number;
  profitAmount: number;
  route: string;
  confidence: 'high' | 'medium' | 'low';
  estimatedGas: number;
  netProfit: number;
}

async function huntDeals(): Promise<void> {
  let eventSocketConnected = false;
  try {
    logger.info('🎯 DEAL HUNTER ACTIVATED - Scanning for arbitrage opportunities!');
    logger.info('💰 Live trading mode - hunting real profit opportunities');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(env.wallet.privateKey);
    const gSwap = new GSwap({
      signer: signer,
      walletAddress: env.wallet.address
    });

    // Connect to event socket for real-time updates
    try {
      GSwap.events?.connectEventSocket();
      eventSocketConnected = true;
      logger.info('📡 Connected to real-time price feeds');
    } catch (error) {
      logger.warn('⚠️ Event socket not available, using polling mode');
    }

    logger.info('✅ Deal hunter initialized - Let\'s make some money! 💸');

    // Define our hunting universe - tokens we know have liquidity
    const huntingTokens = [
      { symbol: 'GALA', classKey: 'GALA|Unit|none|none', decimals: 18 },
      { symbol: 'GUSDC', classKey: 'GUSDC|Unit|none|none', decimals: 6 },
      { symbol: 'ETIME', classKey: 'ETIME|Unit|none|none', decimals: 8 },
      { symbol: 'SILK', classKey: 'SILK|Unit|none|none', decimals: 8 }
    ];

    // Our war chest - how much we're willing to risk per trade
    const maxTradeSize = 10; // Start conservative with 10 GALA
    const minProfitPercent = 1.0; // Minimum 1% profit to be worth it
    const maxSlippage = 2.0; // Maximum 2% slippage tolerance

    logger.info(`📊 HUNTING PARAMETERS:`);
    logger.info(`   • Max trade size: ${maxTradeSize} GALA`);
    logger.info(`   • Min profit: ${minProfitPercent}%`);
    logger.info(`   • Max slippage: ${maxSlippage}%`);
    logger.info(`   • Hunting tokens: ${huntingTokens.map(t => t.symbol).join(', ')}`);

    const opportunities: ArbitrageOpportunity[] = [];

    // Hunt for triangular arbitrage: GALA → TOKEN → GALA
    logger.info('\n🔍 SCANNING FOR TRIANGULAR ARBITRAGE...');

    for (const token of huntingTokens) {
      if (token.symbol === 'GALA') continue;

      try {
        logger.info(`\n🎯 Hunting: GALA → ${token.symbol} → GALA`);

        // Step 1: GALA → TOKEN
        const quote1 = await getQuote(gSwap, 'GALA|Unit|none|none', token.classKey, maxTradeSize);
        if (!quote1) {
          logger.warn(`   ❌ No liquidity for GALA → ${token.symbol}`);
          continue;
        }

        logger.info(`   📈 GALA → ${token.symbol}: ${maxTradeSize} GALA → ${quote1.outputAmount.toFixed(6)} ${token.symbol}`);

        // Step 2: TOKEN → GALA
        const quote2 = await getQuote(gSwap, token.classKey, 'GALA|Unit|none|none', quote1.outputAmount);
        if (!quote2) {
          logger.warn(`   ❌ No liquidity for ${token.symbol} → GALA`);
          continue;
        }

        logger.info(`   📈 ${token.symbol} → GALA: ${quote1.outputAmount.toFixed(6)} ${token.symbol} → ${quote2.outputAmount.toFixed(6)} GALA`);

        // Calculate profit
        const finalGala = quote2.outputAmount;
        const profitGala = finalGala - maxTradeSize;
        const profitPercent = (profitGala / maxTradeSize) * 100;

        // Estimate gas costs (rough estimate)
        const estimatedGasCost = 0.1; // Assume 0.1 GALA gas cost for 2 swaps
        const netProfit = profitGala - estimatedGasCost;
        const netProfitPercent = (netProfit / maxTradeSize) * 100;

        logger.info(`   💰 PROFIT ANALYSIS:`);
        logger.info(`      • Input: ${maxTradeSize} GALA`);
        logger.info(`      • Output: ${finalGala.toFixed(6)} GALA`);
        logger.info(`      • Gross Profit: ${profitGala.toFixed(6)} GALA (${profitPercent.toFixed(2)}%)`);
        logger.info(`      • Est. Gas: ${estimatedGasCost} GALA`);
        logger.info(`      • Net Profit: ${netProfit.toFixed(6)} GALA (${netProfitPercent.toFixed(2)}%)`);

        if (netProfitPercent >= minProfitPercent) {
          logger.info(`   🎉 OPPORTUNITY FOUND! Net profit: ${netProfitPercent.toFixed(2)}%`);

          opportunities.push({
            tokenA: 'GALA',
            tokenB: token.symbol,
            profitPercent: netProfitPercent,
            profitAmount: netProfit,
            route: `GALA → ${token.symbol} → GALA`,
            confidence: netProfitPercent > 3 ? 'high' : netProfitPercent > 2 ? 'medium' : 'low',
            estimatedGas: estimatedGasCost,
            netProfit: netProfit
          });
        } else {
          logger.info(`   📊 Opportunity exists but below threshold (${netProfitPercent.toFixed(2)}% < ${minProfitPercent}%)`);
        }

        // Add small delay to be respectful to APIs
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error(`   ❌ Error hunting ${token.symbol}: ${error}`);
      }
    }

    // Hunt for cross-pair arbitrage opportunities
    logger.info('\n🔍 SCANNING FOR CROSS-PAIR ARBITRAGE...');

    for (let i = 0; i < huntingTokens.length; i++) {
      for (let j = i + 1; j < huntingTokens.length; j++) {
        const tokenA = huntingTokens[i];
        const tokenB = huntingTokens[j];

        if (tokenA.symbol === 'GALA' || tokenB.symbol === 'GALA') continue; // Already checked triangular

        try {
          logger.info(`\n🎯 Cross-pair: GALA → ${tokenA.symbol} → ${tokenB.symbol} → GALA`);

          // GALA → TokenA
          const quote1 = await getQuote(gSwap, 'GALA|Unit|none|none', tokenA.classKey, maxTradeSize);
          if (!quote1) continue;

          // TokenA → TokenB
          const quote2 = await getQuote(gSwap, tokenA.classKey, tokenB.classKey, quote1.outputAmount);
          if (!quote2) continue;

          // TokenB → GALA
          const quote3 = await getQuote(gSwap, tokenB.classKey, 'GALA|Unit|none|none', quote2.outputAmount);
          if (!quote3) continue;

          const finalGala = quote3.outputAmount;
          const profitGala = finalGala - maxTradeSize;
          const profitPercent = (profitGala / maxTradeSize) * 100;
          const estimatedGasCost = 0.15; // Higher gas for 3 swaps
          const netProfit = profitGala - estimatedGasCost;
          const netProfitPercent = (netProfit / maxTradeSize) * 100;

          logger.info(`   💰 Cross-pair profit: ${netProfitPercent.toFixed(2)}%`);

          if (netProfitPercent >= minProfitPercent) {
            opportunities.push({
              tokenA: tokenA.symbol,
              tokenB: tokenB.symbol,
              profitPercent: netProfitPercent,
              profitAmount: netProfit,
              route: `GALA → ${tokenA.symbol} → ${tokenB.symbol} → GALA`,
              confidence: netProfitPercent > 4 ? 'high' : netProfitPercent > 2.5 ? 'medium' : 'low',
              estimatedGas: estimatedGasCost,
              netProfit: netProfit
            });
          }

          await new Promise(resolve => setTimeout(resolve, 150));

        } catch (error) {
          logger.debug(`Cross-pair ${tokenA.symbol}/${tokenB.symbol} not available`);
        }
      }
    }

    // RESULTS SUMMARY
    logger.info('\n🎯 DEAL HUNTING RESULTS:');
    logger.info('==========================');

    if (opportunities.length === 0) {
      logger.info('📊 No profitable opportunities found at current market conditions');
      logger.info('💡 Recommendations:');
      logger.info('   • Market may be too efficient right now');
      logger.info('   • Consider lowering minimum profit threshold');
      logger.info('   • Wait for more market volatility');
      logger.info('   • Try different token pairs or trading sizes');
    } else {
      logger.info(`🎉 FOUND ${opportunities.length} PROFITABLE OPPORTUNITIES!`);

      // Sort by profitability
      opportunities.sort((a, b) => b.profitPercent - a.profitPercent);

      opportunities.forEach((opp, index) => {
        logger.info(`\n💰 OPPORTUNITY #${index + 1}:`);
        logger.info(`   Route: ${opp.route}`);
        logger.info(`   Net Profit: ${opp.profitAmount.toFixed(6)} GALA (${opp.profitPercent.toFixed(2)}%)`);
        logger.info(`   Confidence: ${opp.confidence.toUpperCase()}`);
        logger.info(`   Est. Gas: ${opp.estimatedGas} GALA`);
      });

      const bestOpportunity = opportunities[0];
      logger.info(`\n🏆 BEST OPPORTUNITY:`);
      logger.info(`   ${bestOpportunity.route}`);
      logger.info(`   Profit: ${bestOpportunity.profitAmount.toFixed(6)} GALA (${bestOpportunity.profitPercent.toFixed(2)}%)`);
      logger.info(`   Confidence: ${bestOpportunity.confidence.toUpperCase()}`);

      if (bestOpportunity.confidence === 'high' && bestOpportunity.profitPercent > 2) {
        logger.info('\n🚀 RECOMMENDED ACTION: Execute this arbitrage!');
        logger.info('💡 This looks like a solid profit opportunity.');
      } else {
        logger.info('\n⚠️ PROCEED WITH CAUTION: Opportunity exists but verify carefully');
      }
    }

    logger.info('\n✅ Deal hunting complete. Ready for action! 🎯');

  } catch (error) {
    logger.error('💥 Deal hunting failed:', error);
  } finally {
    // Clean up event socket to allow process to exit
    if (eventSocketConnected) {
      try {
        GSwap.events?.disconnect?.();
        logger.info('📡 Disconnected from event socket');
      } catch (error) {
        logger.warn('⚠️ Failed to disconnect event socket:', error);
      }
    }
  }
}

// Helper function to get quotes with error handling
async function getQuote(gSwap: GSwap, inputToken: string, outputToken: string, inputAmount: number): Promise<{ outputAmount: number; feeTier: number } | null> {
  try {
    const quote = await gSwap.quoting.quoteExactInput(inputToken, outputToken, inputAmount);
    return {
      outputAmount: quote.outTokenAmount.toNumber(),
      feeTier: quote.feeTier
    };
  } catch (error: any) {
    if (error.code === "NO_POOL_AVAILABLE") {
      return null;
    }
    throw error;
  }
}

huntDeals()
  .then(() => {
    logger.info('🏁 Hunt complete, exiting...');
    // Force exit if event loops are still active
    setTimeout(() => {
      logger.warn('⚠️ Force closing process...');
      process.exit(0);
    }, 1000);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });