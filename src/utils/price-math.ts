/**
 * Price Mathematics Utilities
 * Safe calculations for sqrtPriceX96 and other financial mathematics
 */

import { logger } from './logger';

/**
 * Constants for price calculations
 */
export const Q96 = 2n ** 96n; // BigInt for accurate calculation
export const Q192 = Q96 * Q96; // For squared calculations

/**
 * Safely calculate price from sqrtPriceX96 format
 * @param sqrtPriceX96 - The sqrt price in X96 format (string or BigInt)
 * @param isToken0 - Whether this is for token0 (true) or token1 (false)
 * @param decimals0 - Decimals for token0 (default 18)
 * @param decimals1 - Decimals for token1 (default 18)
 * @returns The price as a number, or 0 if calculation fails
 */
export function calculatePriceFromSqrtPriceX96(
  sqrtPriceX96: string | bigint | number,
  isToken0: boolean = false,
  decimals0: number = 18,
  decimals1: number = 18
): number {
  try {
    // Convert input to BigInt
    let sqrtPrice: bigint;

    if (typeof sqrtPriceX96 === 'string') {
      sqrtPrice = BigInt(sqrtPriceX96);
    } else if (typeof sqrtPriceX96 === 'bigint') {
      sqrtPrice = sqrtPriceX96;
    } else if (typeof sqrtPriceX96 === 'number') {
      sqrtPrice = BigInt(Math.floor(sqrtPriceX96));
    } else {
      logger.error('Invalid sqrtPriceX96 type:', typeof sqrtPriceX96);
      return 0;
    }

    // Validate input
    if (sqrtPrice <= 0n) {
      logger.warn('Invalid sqrtPriceX96 value (zero or negative):', sqrtPrice.toString());
      return 0;
    }

    // Calculate price ratio: (sqrtPrice/Q96)^2
    const priceRatio = (sqrtPrice * sqrtPrice) / Q192;

    // Adjust for token decimals
    const decimalAdjustment = BigInt(10) ** BigInt(decimals1 - decimals0);
    const adjustedPriceRatio = priceRatio * decimalAdjustment;

    // Convert to float with appropriate precision
    const price = Number(adjustedPriceRatio) / Math.pow(10, decimals1);

    // Return appropriate price based on token direction
    const finalPrice = isToken0 ? (1 / price) : price;

    // Validate result
    if (!isFinite(finalPrice) || finalPrice <= 0) {
      logger.warn('Invalid calculated price:', finalPrice);
      return 0;
    }

    return finalPrice;

  } catch (error) {
    logger.error('Error calculating price from sqrtPriceX96:', error);
    return 0;
  }
}

/**
 * Get price from pool data with error handling
 * @param poolData - Pool data containing sqrtPrice
 * @param isToken0 - Whether this is for token0
 * @param decimals0 - Token0 decimals
 * @param decimals1 - Token1 decimals
 * @returns Price or throws error if invalid
 */
export function getPoolPrice(
  poolData: { sqrtPrice: string | bigint | number },
  isToken0: boolean = false,
  decimals0: number = 18,
  decimals1: number = 18
): number {
  if (!poolData || !poolData.sqrtPrice) {
    throw new Error('Pool data missing sqrtPrice');
  }

  const price = calculatePriceFromSqrtPriceX96(
    poolData.sqrtPrice,
    isToken0,
    decimals0,
    decimals1
  );

  if (price <= 0) {
    throw new Error('Failed to calculate valid price from pool data');
  }

  return price;
}

/**
 * Calculate spot price between two tokens using pool data
 * @param tokenASymbol - Symbol of token A
 * @param tokenBSymbol - Symbol of token B
 * @param sqrtPriceX96 - The sqrt price from pool
 * @returns Spot price of tokenA in terms of tokenB
 */
export function calculateSpotPrice(
  tokenASymbol: string,
  tokenBSymbol: string,
  sqrtPriceX96: string | bigint | number
): number {
  try {
    // For most GalaSwap pairs, we can assume 18 decimals
    const decimals = 18;

    // Calculate base price (tokenB per tokenA)
    const price = calculatePriceFromSqrtPriceX96(sqrtPriceX96, false, decimals, decimals);

    // Log for debugging
    logger.debug(`Spot price calculated: 1 ${tokenASymbol} = ${price} ${tokenBSymbol}`);

    return price;

  } catch (error) {
    logger.error(`Error calculating spot price for ${tokenASymbol}/${tokenBSymbol}:`, error);
    throw new Error(`Failed to calculate spot price for ${tokenASymbol}/${tokenBSymbol}`);
  }
}