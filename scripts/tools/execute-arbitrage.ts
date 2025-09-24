#!/usr/bin/env tsx

/**
 * ARBITRAGE EXECUTION 🎯
 * Execute the profitable arbitrage opportunity found by hunt-deals.ts
 * Route: GALA → GUSDC → GALA (5.86% profit)
 */

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';
import { SwapExecutor } from '../../src/trading/execution/swap-executor';
import { SlippageProtection } from '../../src/trading/risk/slippage';

config();

interface ArbitrageResult {
  step: number;
  action: string;
  inputAmount: number;
  outputAmount: number;
  tokenIn: string;
  tokenOut: string;
  transactionHash?: string;
  success: boolean;
  error?: string;
}

async function executeArbitrage(): Promise<void> {
  try {
    logger.info('🚀 EXECUTING ARBITRAGE OPPORTUNITY!');
    logger.info('💰 Route: GALA → GUSDC → GALA (Expected: 5.86% profit)');

    const env = validateEnvironment();
    const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '');
    const gSwap = new GSwap({
      signer: signer,
      walletAddress: env.wallet.address
    });

    // Connect to event socket for real-time updates
    try {
      GSwap.events?.connectEventSocket();
      logger.info('📡 Connected to real-time price feeds');
    } catch (error) {
      logger.warn('⚠️ Event socket not available, using polling mode');
    }

    // Initialize trading components with higher slippage tolerance for arbitrage
    const slippageProtection = new SlippageProtection({
      maxSlippagePercent: 5.0, // 5% for arbitrage execution
      emergencySlippagePercent: 10.0, // 10% emergency threshold
      priceImpactThreshold: 3.0, // 3% price impact warning
      liquidityBufferPercent: 20.0 // 20% liquidity buffer for volatility
    });
    const swapExecutor = new SwapExecutor(gSwap, slippageProtection);

    const results: ArbitrageResult[] = [];
    const initialGala = 1; // Starting with 1 GALA for safety
    let currentAmount = initialGala;
    let currentToken = 'GALA|Unit|none|none';

    logger.info(`🎯 Starting arbitrage with ${initialGala} GALA`);

    // Step 1: GALA → GUSDC
    logger.info('\n📈 STEP 1: GALA → GUSDC');
    try {
      // Get fresh quote
      const quote1 = await gSwap.quoting.quoteExactInput(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        currentAmount
      );

      logger.info(`   Quote: ${currentAmount} GALA → ${quote1.outTokenAmount.toNumber().toFixed(6)} GUSDC`);

      // Execute the swap using SwapExecutor
      logger.info(`   🔄 Executing GALA → GUSDC swap...`);
      const result1 = await swapExecutor.executeSwap({
        tokenIn: 'GALA|Unit|none|none',
        tokenOut: 'GUSDC|Unit|none|none',
        amountIn: currentAmount.toString(),
        slippageTolerance: 5.0, // 5% slippage for arbitrage
        userAddress: env.wallet.address,
        urgency: 'high',
        deadlineMinutes: 20
      });

      if (result1.success && result1.hash) {
        logger.info(`   ✅ Step 1 Success! TX: ${result1.hash}`);
        currentAmount = parseFloat(result1.amountOut || '0');
        currentToken = 'GUSDC|Unit|none|none';

        results.push({
          step: 1,
          action: 'GALA → GUSDC',
          inputAmount: initialGala,
          outputAmount: currentAmount,
          tokenIn: 'GALA|Unit|none|none',
          tokenOut: 'GUSDC|Unit|none|none',
          transactionHash: result1.hash,
          success: true
        });
      } else {
        throw new Error(`Step 1 failed: ${result1.error || 'No transaction hash returned'}`);
      }

      // Wait a moment for transaction to settle
      await new Promise(resolve => setTimeout(resolve, 3000));

    } catch (error) {
      logger.error(`   ❌ Step 1 failed:`, error);
      results.push({
        step: 1,
        action: 'GALA → GUSDC',
        inputAmount: initialGala,
        outputAmount: 0,
        tokenIn: 'GALA|Unit|none|none',
        tokenOut: 'GUSDC|Unit|none|none',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return;
    }

    // Step 2: GUSDC → GALA
    logger.info('\n📈 STEP 2: GUSDC → GALA');
    try {
      // Get fresh quote for return trip
      const quote2 = await gSwap.quoting.quoteExactInput(
        'GUSDC|Unit|none|none',
        'GALA|Unit|none|none',
        currentAmount
      );

      logger.info(`   Quote: ${currentAmount.toFixed(6)} GUSDC → ${quote2.outTokenAmount.toNumber().toFixed(6)} GALA`);

      // Execute the return swap using SwapExecutor
      logger.info(`   🔄 Executing GUSDC → GALA swap...`);
      const result2 = await swapExecutor.executeSwap({
        tokenIn: 'GUSDC|Unit|none|none',
        tokenOut: 'GALA|Unit|none|none',
        amountIn: currentAmount.toString(),
        slippageTolerance: 5.0, // 5% slippage for arbitrage
        userAddress: env.wallet.address,
        urgency: 'high',
        deadlineMinutes: 20
      });

      if (result2.success && result2.hash) {
        const finalGala = parseFloat(result2.amountOut || '0');
        logger.info(`   ✅ Step 2 Success! TX: ${result2.hash}`);

        results.push({
          step: 2,
          action: 'GUSDC → GALA',
          inputAmount: currentAmount,
          outputAmount: finalGala,
          tokenIn: 'GUSDC|Unit|none|none',
          tokenOut: 'GALA|Unit|none|none',
          transactionHash: result2.hash,
          success: true
        });

        // Calculate final profit
        const profit = finalGala - initialGala;
        const profitPercent = (profit / initialGala) * 100;

        logger.info('\n🎉 ARBITRAGE EXECUTION COMPLETE!');
        logger.info('==================================');
        logger.info(`💰 PROFIT ANALYSIS:`);
        logger.info(`   • Started with: ${initialGala} GALA`);
        logger.info(`   • Ended with: ${finalGala.toFixed(6)} GALA`);
        logger.info(`   • Gross Profit: ${profit.toFixed(6)} GALA`);
        logger.info(`   • Profit %: ${profitPercent.toFixed(2)}%`);

        if (profit > 0) {
          logger.info(`🎯 SUCCESS: Arbitrage profitable! Made ${profit.toFixed(6)} GALA`);
        } else {
          logger.warn(`⚠️ Loss occurred: ${Math.abs(profit).toFixed(6)} GALA lost`);
        }

      } else {
        throw new Error(`Step 2 failed: ${result2.error || 'No transaction hash returned'}`);
      }

    } catch (error) {
      logger.error(`   ❌ Step 2 failed:`, error);
      results.push({
        step: 2,
        action: 'GUSDC → GALA',
        inputAmount: currentAmount,
        outputAmount: 0,
        tokenIn: 'GUSDC|Unit|none|none',
        tokenOut: 'GALA|Unit|none|none',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Summary of all transactions
    logger.info('\n📊 TRANSACTION SUMMARY:');
    results.forEach((result, index) => {
      logger.info(`${index + 1}. ${result.action}:`);
      logger.info(`   Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
      if (result.success && result.transactionHash) {
        logger.info(`   TX Hash: ${result.transactionHash}`);
        logger.info(`   Input: ${result.inputAmount.toFixed(6)}`);
        logger.info(`   Output: ${result.outputAmount.toFixed(6)}`);
      }
      if (result.error) {
        logger.info(`   Error: ${result.error}`);
      }
    });

    logger.info('\n🚀 Ready for next arbitrage opportunity!');

  } catch (error) {
    logger.error('💥 Arbitrage execution failed:', error);
  }
}

executeArbitrage().catch(console.error);