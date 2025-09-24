/**
 * Safe parsing utilities for numeric values
 * Prevents NaN crashes and provides validation
 * Includes support for ethers.js FixedNumber for precision math
 */

import { FixedNumber } from 'ethers';
import { PrecisionMath } from './precision-math';
import { logger } from './logger';

/**
 * Safely parse a string to float with validation
 * Returns defaultValue if parsing fails or results in NaN
 */
export function safeParseFloat(value: string | number | undefined, defaultValue: number = 0): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'number') {
    return isNaN(value) ? defaultValue : value;
  }

  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safely parse a string to integer with validation
 * Returns defaultValue if parsing fails or results in NaN
 */
export function safeParseInt(value: string | number | undefined, defaultValue: number = 0): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'number') {
    return isNaN(value) ? defaultValue : Math.floor(value);
  }

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safely parse a value to FixedNumber for precision math
 * Returns defaultValue as FixedNumber if parsing fails
 */
export function safeParseFixedNumber(
  value: string | number | FixedNumber | undefined,
  defaultValue: number = 0,
  decimals: number = PrecisionMath.DEFAULT_DECIMALS
): FixedNumber {
  try {
    if (value === undefined || value === null) {
      return PrecisionMath.fromNumber(defaultValue, decimals);
    }

    // If already a FixedNumber, return as-is
    if (value instanceof FixedNumber) {
      return value;
    }

    // Convert number or string to FixedNumber
    return PrecisionMath.fromNumber(value, decimals);
  } catch (error) {
    // If parsing fails, return default value as FixedNumber
    return PrecisionMath.fromNumber(defaultValue, decimals);
  }
}

/**
 * Safely parse a token amount to FixedNumber with proper decimal scaling
 * Returns defaultValue as FixedNumber if parsing fails
 */
export function safeParseTokenAmount(
  value: string | number | undefined,
  tokenDecimals: number,
  defaultValue: number = 0
): FixedNumber {
  try {
    if (value === undefined || value === null) {
      return PrecisionMath.fromToken(defaultValue, tokenDecimals);
    }

    return PrecisionMath.fromToken(value, tokenDecimals);
  } catch (error) {
    return PrecisionMath.fromToken(defaultValue, tokenDecimals);
  }
}

/**
 * Safely convert FixedNumber back to regular number with optional precision warnings
 * Use sparingly - may lose precision for large numbers
 */
export function safeFixedToNumber(
  value: FixedNumber,
  defaultValue: number = 0,
  warnOnPrecisionLoss: boolean = false
): number {
  try {
    return PrecisionMath.toNumber(value, warnOnPrecisionLoss);
  } catch (error) {
    if (warnOnPrecisionLoss) {
      logger.warn(`Failed to convert FixedNumber ${value?.toString()} to number: ${error}. Using default value ${defaultValue}`);
    }
    return defaultValue;
  }
}

/**
 * Safely parse and validate trading amount with bounds checking
 * @param value - Value to parse
 * @param tokenDecimals - Token decimal places
 * @param operation - Operation context for error messages
 * @param defaultValue - Default value if parsing fails
 * @returns Validated FixedNumber for trading operations
 */
export function safeParseValidatedTradingAmount(
  value: string | number | FixedNumber | undefined,
  tokenDecimals: number,
  operation: string = 'trade',
  defaultValue: number = 0
): FixedNumber {
  try {
    const parsed = safeParseFixedNumber(value, defaultValue, tokenDecimals);

    // Validate the parsed amount for trading operations
    PrecisionMath.validateTradingAmount(parsed, tokenDecimals, operation);

    return parsed;
  } catch (error) {
    logger.warn(`Failed to parse and validate ${operation} amount ${value}: ${error}. Using default value ${defaultValue}`);
    return PrecisionMath.fromNumber(defaultValue, tokenDecimals);
  }
}

/**
 * Safely parse and validate percentage values
 * @param value - Percentage value to parse
 * @param context - Context for error messages
 * @param defaultValue - Default value if parsing fails
 * @param allowZero - Whether zero is allowed
 * @param maxPercent - Maximum allowed percentage
 * @returns Validated FixedNumber percentage
 */
export function safeParseValidatedPercentage(
  value: string | number | FixedNumber | undefined,
  context: string = 'percentage',
  defaultValue: number = 0,
  allowZero: boolean = true,
  maxPercent: number = 100
): FixedNumber {
  try {
    const parsed = safeParseFixedNumber(value, defaultValue, PrecisionMath.PERCENTAGE_DECIMALS);

    // Validate the parsed percentage
    PrecisionMath.validatePercentage(parsed, context, allowZero, maxPercent);

    return parsed;
  } catch (error) {
    logger.warn(`Failed to parse and validate ${context} ${value}: ${error}. Using default value ${defaultValue}%`);
    return PrecisionMath.fromNumber(defaultValue, PrecisionMath.PERCENTAGE_DECIMALS);
  }
}