/**
 * Wallet Balance Utility
 *
 * Provides functions to check wallet balances for trading safety.
 * Prevents trades that exceed available wallet funds.
 */

import { GSwap } from '../services/gswap-simple';
import { logger } from './logger';
import { getTokenDecimals } from './slippage-calculator';
import { safeParseFloat } from './safe-parse';
import { ENV } from '../config/environment';

// Create GSwap client for balance fetching (lazy initialization)
let gswapClient: GSwap | null = null;

function getGSwapClient(): GSwap {
  if (!gswapClient) {
    gswapClient = new GSwap({
      baseUrl: ENV.api.baseUrl,
      walletAddress: ENV.wallet.address
    });
  }
  return gswapClient;
}

/**
 * Get wallet balance for a specific token
 * @param walletAddress - The wallet address to check
 * @param tokenSymbol - Token symbol (e.g., 'GALA', 'GUSDC')
 * @returns Balance in human-readable format (not wei)
 */
export async function getWalletBalance(
  walletAddress: string,
  tokenSymbol: string
): Promise<number> {
  try {
    logger.debug(`🔍 Fetching balance for ${tokenSymbol} at ${walletAddress.substring(0, 20)}...`);

    // ✅ USE SDK METHOD - Same as portfolio command (working 100%)
    const gswap = getGSwapClient();
    const assetsResponse = await gswap.assets.getUserAssets(walletAddress, 1, 20);

    if (!assetsResponse?.tokens || assetsResponse.tokens.length === 0) {
      logger.debug(`No tokens found in wallet for ${tokenSymbol}`);
      return 0;
    }

    // Find the specific token balance
    const token = assetsResponse.tokens.find(t =>
      (t.symbol === tokenSymbol) ||
      (t.name === tokenSymbol)
    );

    if (!token) {
      logger.debug(`Token ${tokenSymbol} not found in wallet (${assetsResponse.tokens.length} tokens total)`);
      return 0;
    }

    // Parse balance from token quantity
    const balance = safeParseFloat(token.quantity || '0', 0);

    logger.debug(`💰 Wallet balance for ${tokenSymbol}: ${balance.toFixed(6)}`);
    return balance;

  } catch (error) {
    // Handle API limit errors gracefully
    if (error && typeof error === 'object' && 'message' in error &&
        (error.message as string).includes('400') && (error.message as string).includes('limit')) {
      logger.warn(`getUserAssets API limit exceeded for ${tokenSymbol}, retrying with smaller limit`);
      try {
        const gswap = getGSwapClient();
        const assetsResponse = await gswap.assets.getUserAssets(walletAddress, 1, 10);
        const token = assetsResponse?.tokens?.find(t =>
          (t.symbol === tokenSymbol) || (t.name === tokenSymbol)
        );
        const balance = token ? safeParseFloat(token.quantity || '0', 0) : 0;
        logger.debug(`💰 Wallet balance for ${tokenSymbol}: ${balance.toFixed(6)} (retry)`);
        return balance;
      } catch (retryError) {
        logger.error(`Failed to get balance for ${tokenSymbol} on retry:`, retryError);
        return 0;
      }
    }

    logger.error(`Failed to get balance for ${tokenSymbol}:`, error);
    return 0; // Return 0 on error to prevent trades
  }
}

/**
 * Check if wallet has sufficient balance for a trade
 * @param walletAddress - The wallet address to check
 * @param tokenSymbol - Token symbol
 * @param requiredAmount - Amount needed for trade
 * @param safetyMargin - Percentage to keep as safety margin (default 10%)
 * @returns true if sufficient balance, false otherwise
 */
export async function hasSufficientBalance(
  walletAddress: string,
  tokenSymbol: string,
  requiredAmount: number,
  safetyMargin: number = 0.10
): Promise<boolean> {
  const balance = await getWalletBalance(walletAddress, tokenSymbol);
  const requiredWithMargin = requiredAmount * (1 + safetyMargin);

  if (balance < requiredWithMargin) {
    logger.warn(
      `⚠️  Insufficient balance for ${tokenSymbol}: ` +
      `have ${balance.toFixed(6)}, need ${requiredWithMargin.toFixed(6)} ` +
      `(${requiredAmount.toFixed(6)} + ${(safetyMargin * 100).toFixed(0)}% margin)`
    );
    return false;
  }

  return true;
}

/**
 * Get maximum safe trade size based on wallet balance
 * @param walletAddress - The wallet address to check
 * @param tokenSymbol - Token symbol
 * @param maxPercentage - Maximum percentage of balance to use (default 50%)
 * @returns Maximum safe trade size
 */
export async function getMaxSafeTradeSize(
  walletAddress: string,
  tokenSymbol: string,
  maxPercentage: number = 0.50
): Promise<number> {
  const balance = await getWalletBalance(walletAddress, tokenSymbol);
  const maxSize = balance * maxPercentage;

  logger.debug(`📊 Max safe trade size for ${tokenSymbol}: ${maxSize.toFixed(6)} (${(maxPercentage * 100).toFixed(0)}% of ${balance.toFixed(6)})`);
  return maxSize;
}
