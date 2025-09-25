/**
 * Shared Arbitrage Execution Library
 * Centralizes arbitrage execution logic for both CLI and loop controller
 */

import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS, STRATEGY_CONSTANTS } from '../../config/constants';
import { calculateMinOutputAmount } from '../../utils/slippage-calculator';
import type { TokenInfo } from '../../types/galaswap';

export interface ArbitrageResult {
  success: boolean;
  profitAmount?: number;
  profitPercent?: number;
  executedTrades: number;
  error?: string;
  transactionIds?: string[];
  route?: string;
}

export interface ArbitrageConfig {
  mode: 'full' | 'multi';
  inputAmount?: number;
  feeTier?: number;
}

/**
 * Initialize GSwap client with validated environment
 */
async function initializeGSwap(): Promise<{ gSwap: GSwap; env: ReturnType<typeof validateEnvironment> }> {
  const env = validateEnvironment();

  // Use environment variable directly for security
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('WALLET_PRIVATE_KEY environment variable is required for arbitrage execution');
  }

  const signer = new PrivateKeySigner(privateKey);

  const gSwap = new GSwap({
    signer,
    walletAddress: env.wallet.address
  });

  // Skip event socket for arbitrage to avoid cleanup issues
  logger.info('📡 Skipping event socket for arbitrage execution (cleaner process lifecycle)');

  return { gSwap, env };
}

/**
 * Execute a single token pair arbitrage
 */
async function executePairArbitrage(
  gSwap: GSwap,
  env: ReturnType<typeof validateEnvironment>,
  tokenA: TokenInfo,
  tokenB: TokenInfo,
  inputAmount: number = TRADING_CONSTANTS.DEFAULT_TRADE_SIZE
): Promise<ArbitrageResult> {
  const route = `${tokenA.symbol} ↔ ${tokenB.symbol}`;
  logger.info(`🔄 Testing arbitrage: ${route}`);

  try {
    // Step 1: Get quotes for both directions - let API auto-discover fee tier (like manual script)
    let quote1;
    let feeTier1: number = TRADING_CONSTANTS.FEE_TIERS.STABLE; // Default fallback

    try {
      logger.info(`🔍 Getting quote for ${tokenA.symbol} → ${tokenB.symbol} (API auto-discovery)...`);
      quote1 = await gSwap.quoting.quoteExactInput(
        tokenA.tokenClass,
        tokenB.tokenClass,
        inputAmount
      );

      if (quote1 && quote1.outTokenAmount.toNumber() > 0) {
        feeTier1 = quote1.feeTier || TRADING_CONSTANTS.FEE_TIERS.STABLE;
        logger.info(`✅ Quote successful with auto-discovered fee tier ${feeTier1}: ${quote1.outTokenAmount.toNumber()} ${tokenB.symbol}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`❌ Quote failed for ${tokenA.symbol} → ${tokenB.symbol}: ${errorMsg}`);
    }

    if (!quote1 || quote1.outTokenAmount.toNumber() <= 0) {
      return { success: false, error: `No valid quote for ${tokenA.symbol} → ${tokenB.symbol}`, executedTrades: 0 };
    }

    const midAmount = quote1.outTokenAmount.toNumber();

    // Step 2: Get return quote using API auto-discovery (like manual script)
    let quote2;
    let feeTier2: number = TRADING_CONSTANTS.FEE_TIERS.STABLE; // Default fallback

    try {
      logger.info(`🔍 Getting return quote for ${tokenB.symbol} → ${tokenA.symbol} (API auto-discovery)...`);
      quote2 = await gSwap.quoting.quoteExactInput(
        tokenB.tokenClass,
        tokenA.tokenClass,
        midAmount
      );

      if (quote2 && quote2.outTokenAmount.toNumber() > 0) {
        feeTier2 = quote2.feeTier || TRADING_CONSTANTS.FEE_TIERS.STABLE;
        logger.info(`✅ Return quote successful with auto-discovered fee tier ${feeTier2}: ${quote2.outTokenAmount.toNumber()} ${tokenA.symbol}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`❌ Return quote failed for ${tokenB.symbol} → ${tokenA.symbol}: ${errorMsg}`);
    }

    if (!quote2 || quote2.outTokenAmount.toNumber() <= 0) {
      return { success: false, error: `No valid quote for ${tokenB.symbol} → ${tokenA.symbol}`, executedTrades: 0 };
    }

    const finalAmount = quote2.outTokenAmount.toNumber();
    const profit = finalAmount - inputAmount;
    const profitPercent = (profit / inputAmount) * 100;

    logger.info(`📊 ${route} Analysis:`);
    logger.info(`   Input: ${inputAmount} ${tokenA.symbol}`);
    logger.info(`   Middle: ${midAmount.toFixed(6)} ${tokenB.symbol}`);
    logger.info(`   Final: ${finalAmount.toFixed(6)} ${tokenA.symbol}`);
    logger.info(`   Profit: ${profit.toFixed(6)} ${tokenA.symbol} (${profitPercent.toFixed(2)}%)`);

    // Check if profitable (including gas costs)
    if (profitPercent < STRATEGY_CONSTANTS.ARBITRAGE.MIN_PROFIT_THRESHOLD) {
      return {
        success: false,
        error: `Insufficient profit: ${profitPercent.toFixed(2)}% < ${(STRATEGY_CONSTANTS.ARBITRAGE.MIN_PROFIT_THRESHOLD * 100).toFixed(1)}%`,
        executedTrades: 0,
        profitPercent
      };
    }

    logger.info(`🎯 PROFITABLE ARBITRAGE FOUND: ${profitPercent.toFixed(2)}% profit!`);
    logger.info(`💰 Executing trades using fee tiers: ${feeTier1}, ${feeTier2}`);

    // Step 3: Execute first trade using discovered fee tier
    const swapPayload1 = await gSwap.swaps.swap(
      tokenA.tokenClass,
      tokenB.tokenClass,
      feeTier1, // Use the fee tier that worked for the quote
      {
        exactIn: inputAmount,
        amountOutMinimum: calculateMinOutputAmount(midAmount),
      },
      env.wallet.address
    );

    const txId1 = await executeSwapPayload(gSwap, swapPayload1, `${tokenA.symbol} → ${tokenB.symbol}`);
    if (!txId1) {
      return { success: false, error: 'First trade execution failed', executedTrades: 0 };
    }

    // Wait for first trade to settle
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Step 4: Execute second trade using discovered fee tier
    const swapPayload2 = await gSwap.swaps.swap(
      tokenB.tokenClass,
      tokenA.tokenClass,
      feeTier2, // Use the fee tier that worked for the quote
      {
        exactIn: midAmount,
        amountOutMinimum: calculateMinOutputAmount(finalAmount),
      },
      env.wallet.address
    );

    const txId2 = await executeSwapPayload(gSwap, swapPayload2, `${tokenB.symbol} → ${tokenA.symbol}`);
    if (!txId2) {
      return {
        success: false,
        error: 'Second trade execution failed (first trade completed)',
        executedTrades: 1,
        transactionIds: [txId1]
      };
    }

    logger.info(`🎉 ARBITRAGE COMPLETE! Profit: ${profitPercent.toFixed(2)}%`);
    return {
      success: true,
      profitAmount: profit,
      profitPercent,
      executedTrades: 2,
      transactionIds: [txId1, txId2],
      route
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`❌ Error in ${route} arbitrage:`, errorMessage);
    return { success: false, error: errorMessage, executedTrades: 0 };
  }
}

/**
 * Execute swap payload and return transaction ID
 */
async function executeSwapPayload(gSwap: GSwap, swapPayload: any, description: string): Promise<string | null> {
  try {
    logger.info(`📝 Executing ${description}...`);

    // Handle different payload response types
    if (swapPayload && typeof swapPayload === 'object') {
      if ('submit' in swapPayload && typeof swapPayload.submit === 'function') {
        // Callable payload
        logger.info(`🔄 Submitting ${description} payload...`);
        const result = await swapPayload.submit();

        // Wait for confirmation if available
        if (swapPayload.waitDelegate && typeof swapPayload.waitDelegate === 'function') {
          logger.info(`🔄 Waiting for ${description} confirmation...`);
          const confirmation = await swapPayload.waitDelegate();
          logger.info(`✅ ${description} confirmed:`, confirmation);
          return confirmation.hash || swapPayload.transactionId || 'confirmed';
        }

        return result?.hash || swapPayload.transactionId || 'submitted';
      } else {
        // Direct payload object
        logger.warn(`⚠️ ${description}: Direct payload submission not implemented in current SDK version`);
        return swapPayload.transactionId || 'payload-generated';
      }
    } else {
      logger.error(`❌ ${description}: Invalid payload received`, swapPayload);
      return null;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`❌ ${description} execution failed:`, errorMessage);
    return null;
  }
}

/**
 * Generate token pairs from fallback tokens
 */
function generateTokenPairs(): Array<{ tokenA: TokenInfo; tokenB: TokenInfo }> {
  const pairs: Array<{ tokenA: TokenInfo; tokenB: TokenInfo }> = [];
  const tokens = TRADING_CONSTANTS.FALLBACK_TOKENS;

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      pairs.push({
        tokenA: tokens[i],
        tokenB: tokens[j]
      });
    }
  }

  return pairs;
}

/**
 * Execute full arbitrage (GALA ↔ GUSDC only)
 */
export async function executeFullArbitrage(): Promise<ArbitrageResult> {
  logger.info('🚀 FULL ARBITRAGE EXECUTION (GALA ↔ GUSDC)');

  const { gSwap, env } = await initializeGSwap();

  const gala = TRADING_CONSTANTS.FALLBACK_TOKENS.find(t => t.symbol === 'GALA')!;
  const gusdc = TRADING_CONSTANTS.FALLBACK_TOKENS.find(t => t.symbol === 'GUSDC')!;

  return await executePairArbitrage(gSwap, env, gala, gusdc);
}

/**
 * Execute multi-pair arbitrage (all combinations)
 */
export async function executeMultiArbitrage(): Promise<ArbitrageResult> {
  logger.info('🌟 MULTI-PAIR ARBITRAGE EXECUTION');

  const { gSwap, env } = await initializeGSwap();

  const pairs = generateTokenPairs();

  logger.info(`🔍 Scanning ${pairs.length} token pairs for arbitrage opportunities...`);

  for (const pair of pairs) {
    const result = await executePairArbitrage(gSwap, env, pair.tokenA, pair.tokenB);

    if (result.success) {
      logger.info(`🎉 Successful arbitrage completed! Stopping multi-pair scan.`);
      return result;
    }

    // Brief delay between pair tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return {
    success: false,
    error: 'No profitable arbitrage opportunities found across all token pairs',
    executedTrades: 0
  };
}

/**
 * Execute arbitrage based on configuration
 */
export async function executeArbitrage(config: ArbitrageConfig): Promise<ArbitrageResult> {
  try {
    switch (config.mode) {
      case 'full':
        return await executeFullArbitrage();
      case 'multi':
        return await executeMultiArbitrage();
      default:
        throw new Error(`Unknown arbitrage mode: ${config.mode}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Arbitrage execution failed:', errorMessage);
    return {
      success: false,
      error: errorMessage,
      executedTrades: 0
    };
  }
}