/**
 * Centralized Slippage Calculation Utility
 * Ensures consistent slippage handling across all trading operations
 * Now uses ethers.js FixedNumber for precision arithmetic
 */

import { TRADING_CONSTANTS } from '../config/constants';
import { PrecisionMath, TOKEN_DECIMALS } from './precision-math';
import { safeFixedToNumber } from './safe-parse';
import { logger } from './logger';

/**
 * Get the decimal places for a token based on its symbol or key format
 * @param tokenSymbol - Token symbol or key (e.g., "GALA" or "GALA|Unit|none|none")
 * @returns Number of decimal places for the token
 */
export function getTokenDecimals(tokenSymbol: string): number {
  // Handle both simple symbols (GALA) and composite keys (GALA|Unit|none|none)
  const tokenType = tokenSymbol.includes('|') ? tokenSymbol.split('|')[0] : tokenSymbol;

  switch(tokenType.toUpperCase()) {
    case 'GALA': return TOKEN_DECIMALS.GALA;
    case 'GUSDC': return TOKEN_DECIMALS.GUSDC;
    case 'GUSDT': return TOKEN_DECIMALS.GUSDT;
    case 'GWETH': return TOKEN_DECIMALS.GWETH;
    case 'GWBTC': return TOKEN_DECIMALS.GWBTC;
    case 'ETIME': return TOKEN_DECIMALS.ETIME;
    case 'SILK': return TOKEN_DECIMALS.SILK;
    default:
      logger.warn(`Unknown token type ${tokenType}, defaulting to 18 decimals`);
      return 18;
  }
}

/**
 * Calculate minimum output amount with slippage protection using precision math
 * @param expectedAmount - Expected output amount from trade
 * @param slippagePercent - Slippage percentage (e.g., 15 for 15%)
 * @param tokenDecimals - Decimal places for the token (defaults to GALA's 8 decimals)
 * @returns Minimum acceptable output amount after slippage
 */
export function calculateMinOutputAmount(
  expectedAmount: number,
  slippagePercent: number = TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT,
  tokenDecimals: number = TOKEN_DECIMALS.GALA
): number {
  if (expectedAmount <= 0) {
    throw new Error('Expected amount must be positive');
  }

  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new Error('Slippage percent must be between 0 and 100');
  }

  // Use precision math for exact slippage calculations
  const expectedAmountFixed = PrecisionMath.fromNumber(expectedAmount, tokenDecimals);
  const slippagePercentFixed = PrecisionMath.fromNumber(slippagePercent, PrecisionMath.PERCENTAGE_DECIMALS);

  // Apply slippage using precision math
  const minAmountFixed = PrecisionMath.applySlippage(expectedAmountFixed, slippagePercentFixed);

  // Convert back to number and ensure non-negative
  const minAmount = safeFixedToNumber(minAmountFixed);
  return Math.max(0, minAmount);
}

/**
 * Calculate maximum input amount with slippage protection using precision math
 * @param expectedAmount - Expected input amount for trade
 * @param slippagePercent - Slippage percentage (e.g., 15 for 15%)
 * @param tokenDecimals - Decimal places for the token (defaults to GALA's 8 decimals)
 * @returns Maximum acceptable input amount with slippage buffer
 */
export function calculateMaxInputAmount(
  expectedAmount: number,
  slippagePercent: number = TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT,
  tokenDecimals: number = TOKEN_DECIMALS.GALA
): number {
  if (expectedAmount <= 0) {
    throw new Error('Expected amount must be positive');
  }

  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new Error('Slippage percent must be between 0 and 100');
  }

  // Use precision math for exact slippage calculations
  const expectedAmountFixed = PrecisionMath.fromNumber(expectedAmount, tokenDecimals);
  const slippagePercentFixed = PrecisionMath.fromNumber(slippagePercent, PrecisionMath.PERCENTAGE_DECIMALS);

  // Calculate maximum amount with slippage buffer using precision math
  const slippageAmountFixed = PrecisionMath.calculatePercentage(expectedAmountFixed, slippagePercentFixed);
  const maxAmountFixed = PrecisionMath.add(expectedAmountFixed, slippageAmountFixed);

  // Convert back to number
  return safeFixedToNumber(maxAmountFixed);
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
 * Calculate slippage-adjusted amounts for a complete arbitrage cycle using precision math
 * @param amount1 - First leg expected output
 * @param amount2 - Second leg expected output
 * @param slippagePercent - Slippage percentage
 * @param tokenDecimals1 - Decimal places for first token (defaults to GALA)
 * @param tokenDecimals2 - Decimal places for second token (defaults to GALA)
 * @returns Object with min amounts for both legs
 */
export function calculateArbitrageSlippage(
  amount1: number,
  amount2: number,
  slippagePercent: number = TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT,
  tokenDecimals1: number = TOKEN_DECIMALS.GALA,
  tokenDecimals2: number = TOKEN_DECIMALS.GALA
): { minAmount1: number; minAmount2: number } {
  // Use the precision math versions for consistent calculations
  return {
    minAmount1: calculateMinOutputAmount(amount1, slippagePercent, tokenDecimals1),
    minAmount2: calculateMinOutputAmount(amount2, slippagePercent, tokenDecimals2)
  };
}

/**
 * Apply additional safety margin to an amount using precision math
 * @param amount - Original amount
 * @param safetyMarginPercent - Safety margin percentage (e.g., 2 for 2%)
 * @param tokenDecimals - Decimal places for the token
 * @returns Amount after applying safety margin (reduced by the margin)
 */
export function applySafetyMargin(
  amount: number,
  safetyMarginPercent: number,
  tokenDecimals: number = TOKEN_DECIMALS.GALA
): number {
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }

  if (safetyMarginPercent < 0 || safetyMarginPercent > 100) {
    throw new Error('Safety margin percent must be between 0 and 100');
  }

  // Use precision math for exact safety margin calculations
  const amountFixed = PrecisionMath.fromNumber(amount, tokenDecimals);
  const marginFixed = PrecisionMath.fromNumber(safetyMarginPercent, PrecisionMath.PERCENTAGE_DECIMALS);

  // Apply safety margin (reduces the amount by the margin percentage)
  const reducedAmountFixed = PrecisionMath.applySlippage(amountFixed, marginFixed);

  return safeFixedToNumber(reducedAmountFixed);
}

/**
 * Apply safety margin with minimum floor using precision math
 * @param amount - Original amount
 * @param safetyMarginPercent - Safety margin percentage (e.g., 20 for 20%)
 * @param minimumFloor - Absolute minimum value
 * @param tokenDecimals - Decimal places for the token
 * @returns Amount after applying safety margin, but not below the floor
 */
export function applySafetyMarginWithFloor(
  amount: number,
  safetyMarginPercent: number,
  minimumFloor: number,
  tokenDecimals: number = TOKEN_DECIMALS.GALA
): number {
  const reducedAmount = applySafetyMargin(amount, safetyMarginPercent, tokenDecimals);
  return Math.max(reducedAmount, minimumFloor);
}

/**
 * Apply gas buffer multiplier using precision math
 * @param gasEstimate - Original gas estimate
 * @param bufferMultiplier - Buffer multiplier (e.g., 1.1 for 10% buffer)
 * @returns Gas estimate with buffer applied
 */
export function applyGasBuffer(gasEstimate: number, bufferMultiplier: number): number {
  if (gasEstimate <= 0) {
    throw new Error('Gas estimate must be positive');
  }

  if (bufferMultiplier < 1) {
    throw new Error('Buffer multiplier must be at least 1.0');
  }

  // Use precision math for exact buffer calculations
  const gasFixed = PrecisionMath.fromNumber(gasEstimate, PrecisionMath.DEFAULT_DECIMALS);
  const bufferFixed = PrecisionMath.fromNumber(bufferMultiplier, PrecisionMath.DEFAULT_DECIMALS);

  const bufferedGasFixed = PrecisionMath.multiply(gasFixed, bufferFixed);
  return safeFixedToNumber(bufferedGasFixed);
}