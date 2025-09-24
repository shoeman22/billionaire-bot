/**
 * Centralized Slippage Calculation Utility
 * Ensures consistent slippage handling across all trading operations
 */

import { TRADING_CONSTANTS } from '../config/constants';

/**
 * Calculate minimum output amount with slippage protection
 * @param expectedAmount - Expected output amount from trade
 * @param slippagePercent - Slippage percentage (e.g., 15 for 15%)
 * @returns Minimum acceptable output amount after slippage
 */
export function calculateMinOutputAmount(
  expectedAmount: number,
  slippagePercent: number = TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT
): number {
  if (expectedAmount <= 0) {
    throw new Error('Expected amount must be positive');
  }

  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new Error('Slippage percent must be between 0 and 100');
  }

  const slippageDecimal = slippagePercent / 100;
  const minAmount = expectedAmount * (1 - slippageDecimal);

  return Math.max(0, minAmount); // Ensure non-negative result
}

/**
 * Calculate maximum input amount with slippage protection
 * @param expectedAmount - Expected input amount for trade
 * @param slippagePercent - Slippage percentage (e.g., 15 for 15%)
 * @returns Maximum acceptable input amount with slippage buffer
 */
export function calculateMaxInputAmount(
  expectedAmount: number,
  slippagePercent: number = TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT
): number {
  if (expectedAmount <= 0) {
    throw new Error('Expected amount must be positive');
  }

  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new Error('Slippage percent must be between 0 and 100');
  }

  const slippageDecimal = slippagePercent / 100;
  const maxAmount = expectedAmount * (1 + slippageDecimal);

  return maxAmount;
}

/**
 * Get the default slippage percentage from configuration
 * @returns Default slippage percentage from TRADING_CONSTANTS
 */
export function getDefaultSlippagePercent(): number {
  return TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT;
}

/**
 * Validate slippage percentage is within acceptable bounds
 * @param slippagePercent - Slippage percentage to validate
 * @throws Error if slippage is invalid
 */
export function validateSlippagePercent(slippagePercent: number): void {
  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new Error(`Invalid slippage percentage: ${slippagePercent}%. Must be between 0 and 100.`);
  }

  if (slippagePercent > TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT) {
    throw new Error(
      `Slippage percentage ${slippagePercent}% exceeds maximum allowed ${TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT}%`
    );
  }
}

/**
 * Calculate slippage-adjusted amounts for a complete arbitrage cycle
 * @param amount1 - First leg expected output
 * @param amount2 - Second leg expected output
 * @param slippagePercent - Slippage percentage
 * @returns Object with min amounts for both legs
 */
export function calculateArbitrageSlippage(
  amount1: number,
  amount2: number,
  slippagePercent: number = TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT
): { minAmount1: number; minAmount2: number } {
  return {
    minAmount1: calculateMinOutputAmount(amount1, slippagePercent),
    minAmount2: calculateMinOutputAmount(amount2, slippagePercent)
  };
}