/**
 * Precision Math Utility using ethers.js FixedNumber
 *
 * Provides high-precision arithmetic operations for financial calculations
 * to eliminate floating-point precision errors common in JavaScript.
 *
 * Key Benefits:
 * - No floating point precision errors (0.1 + 0.2 = 0.3 exactly)
 * - Handles large numbers without overflow
 * - Consistent decimal place handling
 * - Throws on invalid operations (division by zero, etc.)
 */

import { FixedNumber } from 'ethers';
import { logger } from './logger';

export class PrecisionMath {
  // Standard decimal places for common operations
  static readonly DEFAULT_DECIMALS = 18;
  static readonly PERCENTAGE_DECIMALS = 4; // For percentage calculations (0.0001 = 0.01%)
  static readonly PRICE_DECIMALS = 8; // For price calculations

  /**
   * Extract decimal places from FixedNumber format string
   * @param value - FixedNumber to extract decimals from
   * @returns Number of decimal places, defaults to DEFAULT_DECIMALS if extraction fails
   */
  private static extractDecimals(value: FixedNumber): number {
    try {
      const format = (value as { format?: string }).format;
      if (!format || typeof format !== 'string') return PrecisionMath.DEFAULT_DECIMALS;

      // Extract decimals from format string (e.g., "fixed128x8" -> 8)
      const match = format.match(/x(\d+)$/);
      const decimals = match ? parseInt(match[1], 10) : PrecisionMath.DEFAULT_DECIMALS;
      return isNaN(decimals) ? PrecisionMath.DEFAULT_DECIMALS : decimals;
    } catch {
      return PrecisionMath.DEFAULT_DECIMALS;
    }
  }

  /**
   * Get the optimal decimal precision for operations between two FixedNumbers
   * @param a - First FixedNumber
   * @param b - Second FixedNumber
   * @returns Maximum decimal places to preserve precision
   */
  private static getOptimalDecimals(a: FixedNumber, b: FixedNumber): number {
    const aDecimals = PrecisionMath.extractDecimals(a);
    const bDecimals = PrecisionMath.extractDecimals(b);
    return Math.max(aDecimals, bDecimals, PrecisionMath.DEFAULT_DECIMALS);
  }

  /**
   * Convert a token amount to FixedNumber with proper decimal scaling
   * @param amount - Amount as string or number
   * @param decimals - Token decimal places (e.g., 8 for GALA, 6 for GUSDC)
   * @returns FixedNumber representation
   */
  static fromToken(amount: string | number, decimals: number = 18): FixedNumber {
    try {
      // Convert to string first to avoid precision issues
      const amountStr = typeof amount === 'number' ? amount.toString() : amount;

      // Parse with specified decimal places
      return FixedNumber.fromString(amountStr, decimals);
    } catch (error) {
      throw new Error(`Failed to convert token amount ${amount} with ${decimals} decimals: ${error}`);
    }
  }

  /**
   * Convert FixedNumber back to token amount string
   * @param value - FixedNumber value
   * @param decimals - Target decimal places
   * @returns String representation suitable for token operations
   */
  static toToken(value: FixedNumber, decimals?: number): string {
    try {
      if (decimals !== undefined) {
        // Format to specific decimal places using round and toString
        const rounded = FixedNumber.fromString(value.toString(), decimals);
        return rounded.toString();
      }

      // Use the FixedNumber's native formatting
      return value.toString();
    } catch (error) {
      throw new Error(`Failed to convert FixedNumber to token: ${error}`);
    }
  }

  /**
   * Convert a regular number to FixedNumber for calculations
   * @param value - Number value
   * @param decimals - Decimal precision (default 18)
   * @returns FixedNumber
   */
  static fromNumber(value: number | string, decimals: number = PrecisionMath.DEFAULT_DECIMALS): FixedNumber {
    try {
      let valueStr = typeof value === 'number' ? value.toString() : value;

      // Validate input bounds first
      const MAX_SAFE_DIGITS = 30;
      if (valueStr.length > MAX_SAFE_DIGITS) {
        throw new Error(`Value ${valueStr} exceeds maximum ${MAX_SAFE_DIGITS} digits`);
      }

      // Handle scientific notation with precision preservation
      if (valueStr.includes('e') || valueStr.includes('E')) {
        const numValue = parseFloat(valueStr);

        // Check if value exceeds safe bounds
        if (!isFinite(numValue) || Math.abs(numValue) > Number.MAX_SAFE_INTEGER) {
          throw new Error(`Value ${valueStr} exceeds safe bounds for precision math`);
        }

        // Convert scientific notation to fixed-point without precision loss
        // Use toLocaleString to avoid toFixed precision issues
        valueStr = numValue.toLocaleString('fullwide', {
          useGrouping: false,
          maximumFractionDigits: Math.min(decimals, 20) // Cap at 20 to prevent overflow
        });
      }

      // Additional validation for extreme values
      if (valueStr.startsWith('-') && valueStr.length > MAX_SAFE_DIGITS + 1) {
        throw new Error(`Negative value ${valueStr} exceeds maximum supported precision`);
      }

      // ✅ FIX: Round to correct decimal places before conversion
      // Prevents "too many decimals for format" error
      const parts = valueStr.split('.');
      if (parts.length === 2 && parts[1].length > decimals) {
        // Round to the correct number of decimals
        const numValue = parseFloat(valueStr);
        valueStr = numValue.toFixed(decimals);
      }

      return FixedNumber.fromString(valueStr, decimals);
    } catch (error) {
      throw new Error(`Failed to convert number ${value}: ${error}`);
    }
  }

  /**
   * Safe addition of two FixedNumber values
   * @param a - First value
   * @param b - Second value
   * @returns Sum as FixedNumber
   */
  static add(a: FixedNumber, b: FixedNumber): FixedNumber {
    try {
      const decimals = PrecisionMath.getOptimalDecimals(a, b);
      const aNormalized = FixedNumber.fromString(a.toString(), decimals);
      const bNormalized = FixedNumber.fromString(b.toString(), decimals);
      return aNormalized.add(bNormalized);
    } catch (error) {
      throw new Error(`Addition failed for ${a} + ${b}: ${error}`);
    }
  }

  /**
   * Safe subtraction of two FixedNumber values
   * @param a - Minuend
   * @param b - Subtrahend
   * @returns Difference as FixedNumber
   */
  static subtract(a: FixedNumber, b: FixedNumber): FixedNumber {
    try {
      const decimals = PrecisionMath.getOptimalDecimals(a, b);
      const aNormalized = FixedNumber.fromString(a.toString(), decimals);
      const bNormalized = FixedNumber.fromString(b.toString(), decimals);
      return aNormalized.sub(bNormalized);
    } catch (error) {
      throw new Error(`Subtraction failed for ${a} - ${b}: ${error}`);
    }
  }

  /**
   * Safe multiplication of two FixedNumber values
   * @param a - First value
   * @param b - Second value
   * @returns Product as FixedNumber
   */
  static multiply(a: FixedNumber, b: FixedNumber): FixedNumber {
    try {
      const decimals = PrecisionMath.getOptimalDecimals(a, b);
      const aNormalized = FixedNumber.fromString(a.toString(), decimals);
      const bNormalized = FixedNumber.fromString(b.toString(), decimals);
      return aNormalized.mul(bNormalized);
    } catch (error) {
      throw new Error(`Multiplication failed for ${a} * ${b}: ${error}`);
    }
  }

  /**
   * Safe division of two FixedNumber values
   * @param a - Dividend
   * @param b - Divisor
   * @returns Quotient as FixedNumber
   */
  static divide(a: FixedNumber, b: FixedNumber): FixedNumber {
    try {
      // Check for division by zero
      if (b.isZero()) {
        throw new Error('Division by zero');
      }

      const decimals = PrecisionMath.getOptimalDecimals(a, b);
      const aNormalized = FixedNumber.fromString(a.toString(), decimals);
      const bNormalized = FixedNumber.fromString(b.toString(), decimals);
      return aNormalized.div(bNormalized);
    } catch (error) {
      throw new Error(`Division failed for ${a} / ${b}: ${error}`);
    }
  }

  /**
   * Calculate percentage of a value
   * @param value - Base value
   * @param percentage - Percentage (e.g., 15.5 for 15.5%)
   * @returns Percentage amount as FixedNumber
   */
  static calculatePercentage(value: FixedNumber, percentage: FixedNumber): FixedNumber {
    try {
      // Use default decimals for consistency
      const decimals = PrecisionMath.DEFAULT_DECIMALS;
      const valueNormalized = FixedNumber.fromString(value.toString(), decimals);
      const percentageNormalized = FixedNumber.fromString(percentage.toString(), decimals);
      const hundred = FixedNumber.fromString('100', decimals);

      const percentageDecimal = percentageNormalized.div(hundred);
      return valueNormalized.mul(percentageDecimal);
    } catch (error) {
      throw new Error(`Percentage calculation failed for ${value} * ${percentage}%: ${error}`);
    }
  }

  /**
   * Calculate percentage change between two values
   * @param from - Original value
   * @param to - New value
   * @returns Percentage change as FixedNumber
   */
  static calculatePercentageChange(from: FixedNumber, to: FixedNumber): FixedNumber {
    try {
      if (from.isZero()) {
        throw new Error('Cannot calculate percentage change from zero');
      }

      // Use default decimals for consistency
      const decimals = PrecisionMath.DEFAULT_DECIMALS;
      const fromNormalized = FixedNumber.fromString(from.toString(), decimals);
      const toNormalized = FixedNumber.fromString(to.toString(), decimals);
      const hundred = FixedNumber.fromString('100', decimals);

      const difference = toNormalized.sub(fromNormalized);
      const ratio = difference.div(fromNormalized);
      return ratio.mul(hundred);
    } catch (error) {
      throw new Error(`Percentage change calculation failed from ${from} to ${to}: ${error}`);
    }
  }

  /**
   * Apply slippage to an amount (subtract percentage)
   * @param amount - Original amount
   * @param slippagePercent - Slippage percentage (e.g., 1.5 for 1.5%)
   * @returns Amount after slippage as FixedNumber
   */
  static applySlippage(amount: FixedNumber, slippagePercent: FixedNumber): FixedNumber {
    try {
      const slippageAmount = PrecisionMath.calculatePercentage(amount, slippagePercent);
      return PrecisionMath.subtract(amount, slippageAmount);
    } catch (error) {
      throw new Error(`Slippage calculation failed for ${amount} with ${slippagePercent}% slippage: ${error}`);
    }
  }

  /**
   * Calculate compound slippage for multi-hop trades
   * @param amount - Initial amount
   * @param slippagePercents - Array of slippage percentages for each hop
   * @returns Final amount after all slippages
   */
  static applyCompoundSlippage(amount: FixedNumber, slippagePercents: FixedNumber[]): FixedNumber {
    try {
      let currentAmount = amount;

      for (const slippage of slippagePercents) {
        currentAmount = PrecisionMath.applySlippage(currentAmount, slippage);
      }

      return currentAmount;
    } catch (error) {
      throw new Error(`Compound slippage calculation failed: ${error}`);
    }
  }

  /**
   * Check if a FixedNumber is within a tolerance of another
   * @param a - First value
   * @param b - Second value
   * @param tolerance - Tolerance percentage (e.g., 0.01 for 0.01%)
   * @returns True if values are within tolerance
   */
  static isWithinTolerance(a: FixedNumber, b: FixedNumber, tolerance: FixedNumber): boolean {
    try {
      if (a.isZero() && b.isZero()) {
        return true;
      }

      const larger = a.gt(b) ? a : b;
      const difference = a.gt(b) ? PrecisionMath.subtract(a, b) : PrecisionMath.subtract(b, a);
      const percentageDiff = PrecisionMath.divide(difference, larger);
      const toleranceDecimal = PrecisionMath.divide(tolerance, PrecisionMath.fromNumber(100));

      return percentageDiff.lte(toleranceDecimal);
    } catch (error) {
      throw new Error(`Tolerance check failed for ${a} vs ${b} with ${tolerance}% tolerance: ${error}`);
    }
  }

  /**
   * Get the maximum of two FixedNumber values
   * @param a - First value
   * @param b - Second value
   * @returns Maximum value
   */
  static max(a: FixedNumber, b: FixedNumber): FixedNumber {
    return a.gt(b) ? a : b;
  }

  /**
   * Get the minimum of two FixedNumber values
   * @param a - First value
   * @param b - Second value
   * @returns Minimum value
   */
  static min(a: FixedNumber, b: FixedNumber): FixedNumber {
    return a.lt(b) ? a : b;
  }

  /**
   * Convert FixedNumber to JavaScript number (with precision warning)
   * @param value - FixedNumber value
   * @param warnOnPrecisionLoss - Whether to log warning for potential precision loss
   * @returns JavaScript number (may lose precision)
   */
  static toNumber(value: FixedNumber, warnOnPrecisionLoss: boolean = false): number {
    const stringValue = value.toString();
    const numberValue = parseFloat(stringValue);

    if (warnOnPrecisionLoss) {
      // Check for potential precision loss
      if (Math.abs(numberValue) > Number.MAX_SAFE_INTEGER) {
        logger.warn(`PrecisionMath: Converting large number ${stringValue} to JavaScript number may lose precision`);
      }

      // Check for very small numbers that might become zero
      if (numberValue !== 0 && Math.abs(numberValue) < Number.MIN_VALUE) {
        logger.warn(`PrecisionMath: Converting very small number ${stringValue} to JavaScript number may lose precision`);
      }

      // Check for numbers with many decimal places
      const decimalPlaces = stringValue.includes('.') ? stringValue.split('.')[1]?.length || 0 : 0;
      if (decimalPlaces > 15) { // JavaScript safe decimal precision
        logger.warn(`PrecisionMath: Converting number ${stringValue} with ${decimalPlaces} decimal places may lose precision (JavaScript safe: 15)`);
      }
    }

    return numberValue;
  }

  /**
   * Format FixedNumber for display with specified decimal places
   * @param value - FixedNumber value
   * @param decimals - Display decimal places
   * @returns Formatted string
   */
  static format(value: FixedNumber, decimals: number = 6): string {
    try {
      // Convert to number then use toFixed for consistent formatting
      const num = PrecisionMath.toNumber(value);
      return num.toFixed(decimals);
    } catch (error) {
      throw new Error(`Formatting failed for ${value} with ${decimals} decimals: ${error}`);
    }
  }

  /**
   * Create a FixedNumber representing zero with specified decimals
   * @param decimals - Decimal places
   * @returns Zero FixedNumber
   */
  static zero(decimals: number = PrecisionMath.DEFAULT_DECIMALS): FixedNumber {
    return FixedNumber.fromString('0', decimals);
  }

  /**
   * Create a FixedNumber representing one with specified decimals
   * @param decimals - Decimal places
   * @returns One FixedNumber
   */
  static one(decimals: number = PrecisionMath.DEFAULT_DECIMALS): FixedNumber {
    return FixedNumber.fromString('1', decimals);
  }

  /**
   * Validate that a value is within safe bounds for trading operations
   * @param value - FixedNumber to validate
   * @param context - Context for error messages (e.g., 'trade amount', 'slippage')
   * @param minValue - Minimum allowed value (optional)
   * @param maxValue - Maximum allowed value (optional)
   * @throws Error if value is outside safe bounds
   */
  static validateBounds(
    value: FixedNumber,
    context: string = 'value',
    minValue?: FixedNumber,
    maxValue?: FixedNumber
  ): void {
    // Check for NaN or invalid values
    if (!value || value.toString() === 'NaN') {
      throw new Error(`Invalid ${context}: value is NaN or undefined`);
    }

    // Check if value is negative when it shouldn't be
    if (value.isNegative() && context.includes('amount')) {
      throw new Error(`Invalid ${context}: cannot be negative (${value.toString()})`);
    }

    // Check minimum bounds
    if (minValue && value.lt(minValue)) {
      throw new Error(`Invalid ${context}: ${value.toString()} is below minimum allowed value ${minValue.toString()}`);
    }

    // Check maximum bounds
    if (maxValue && value.gt(maxValue)) {
      throw new Error(`Invalid ${context}: ${value.toString()} exceeds maximum allowed value ${maxValue.toString()}`);
    }

    // Check for extremely large values that might cause issues
    const valueAsNumber = PrecisionMath.toNumber(value);
    if (Math.abs(valueAsNumber) > 1e15) { // 1 quadrillion
      logger.warn(`PrecisionMath: Very large ${context} detected (${value.toString()}). This might cause precision issues.`);
    }

    // Check for extremely small non-zero values
    if (!value.isZero() && Math.abs(valueAsNumber) < 1e-12) { // Below 1 picounit
      logger.warn(`PrecisionMath: Very small ${context} detected (${value.toString()}). This might cause rounding issues.`);
    }
  }

  /**
   * Validate trading amounts with specific bounds for DeFi operations
   * @param amount - Amount to validate
   * @param tokenDecimals - Token decimal places for context
   * @param operation - Operation type for better error messages
   * @throws Error if amount is invalid for trading
   */
  static validateTradingAmount(
    amount: FixedNumber,
    tokenDecimals: number,
    operation: string = 'trade'
  ): void {
    // Minimum trading amounts (adjusted for token decimals)
    const minTradeAmount = PrecisionMath.fromNumber(0.000001, tokenDecimals); // 1 microunit
    const maxTradeAmount = PrecisionMath.fromNumber(1000000, tokenDecimals); // 1 million units

    PrecisionMath.validateBounds(
      amount,
      `${operation} amount`,
      minTradeAmount,
      maxTradeAmount
    );

    // Additional validation for trading operations
    if (amount.isZero()) {
      throw new Error(`Invalid ${operation} amount: cannot be zero`);
    }
  }

  /**
   * Validate percentage values (0-100 range)
   * @param percentage - Percentage value to validate
   * @param context - Context for error messages
   * @param allowZero - Whether zero is allowed (default: true)
   * @param maxPercent - Maximum allowed percentage (default: 100)
   * @throws Error if percentage is out of valid range
   */
  static validatePercentage(
    percentage: FixedNumber,
    context: string = 'percentage',
    allowZero: boolean = true,
    maxPercent: number = 100
  ): void {
    const zero = PrecisionMath.zero(PrecisionMath.PERCENTAGE_DECIMALS);
    const max = PrecisionMath.fromNumber(maxPercent, PrecisionMath.PERCENTAGE_DECIMALS);

    if (!allowZero && percentage.isZero()) {
      throw new Error(`Invalid ${context}: cannot be zero`);
    }

    PrecisionMath.validateBounds(percentage, context, allowZero ? zero : undefined, max);

    if (percentage.isNegative()) {
      throw new Error(`Invalid ${context}: cannot be negative (${percentage.toString()}%)`);
    }
  }
}

// Export commonly used token decimals for convenience
export const TOKEN_DECIMALS = {
  GALA: 8,
  GUSDC: 6,
  GUSDT: 6,
  GWETH: 18,
  GWBTC: 8,
  ETIME: 8,
  SILK: 8,
} as const;

// Export FixedNumber type for convenience
export { FixedNumber };