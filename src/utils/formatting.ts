/**
 * Token and Amount Formatting Utilities
 * Handles precision, decimals, and display formatting for trading operations
 */

import BN from 'bn.js';
import { safeParseFloat } from './safe-parse';

export interface TokenInfo {
  symbol: string;
  decimals: number;
  name?: string;
  address?: string;
}

export interface FormattedAmount {
  raw: string;          // Raw amount as string (for calculations)
  display: string;      // Human-readable display format
  wei: string;          // Amount in smallest unit (wei-equivalent)
  scientific: string;   // Scientific notation for very large/small numbers
}

/**
 * Token formatting utilities
 */
export class TokenFormatter {
  private static readonly DEFAULT_DECIMALS = 18;
  private static readonly DISPLAY_DECIMALS = 6;

  /**
   * Format an amount for display
   */
  static formatAmount(
    amount: string | number | BN,
    decimals: number = TokenFormatter.DEFAULT_DECIMALS,
    displayDecimals: number = TokenFormatter.DISPLAY_DECIMALS
  ): FormattedAmount {
    try {
      const amountBN = new BN(amount.toString());
      const divisor = new BN(10).pow(new BN(decimals));

      // Convert to human-readable format
      const wholePart = amountBN.div(divisor);
      const fractionalPart = amountBN.mod(divisor);

      // Create decimal representation
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      const rawValue = wholePart.toString() + '.' + fractionalStr;

      // Trim trailing zeros and format for display
      const displayValue = safeParseFloat(rawValue, 0).toFixed(displayDecimals);
      const trimmedDisplay = safeParseFloat(displayValue, 0).toString();

      // Scientific notation for very large or small numbers
      const scientificValue = safeParseFloat(rawValue, 0).toExponential(displayDecimals);

      return {
        raw: rawValue,
        display: trimmedDisplay,
        wei: amountBN.toString(),
        scientific: scientificValue,
      };

    } catch (_error) {
      throw new Error(`Failed to format amount: ${_error}`);
    }
  }

  /**
   * Parse a human-readable amount to wei (smallest unit)
   */
  static parseAmount(
    amount: string | number,
    decimals: number = TokenFormatter.DEFAULT_DECIMALS
  ): string {
    try {
      const amountStr = amount.toString();
      const multiplier = new BN(10).pow(new BN(decimals));

      // Handle decimal places
      const parts = amountStr.split('.');
      const wholePart = new BN(parts[0] || '0');
      const fractionalPart = parts[1] || '';

      // Pad or truncate fractional part to match decimals
      const paddedFractional = fractionalPart.padEnd(decimals, '0').substring(0, decimals);
      const fractionalBN = new BN(paddedFractional);

      // Calculate final amount
      const result = wholePart.mul(multiplier).add(fractionalBN);

      return result.toString();

    } catch (_error) {
      throw new Error(`Failed to parse amount: ${_error}`);
    }
  }

  /**
   * Format a price with appropriate precision
   */
  static formatPrice(
    price: string | number,
    baseCurrency: string = 'USD',
    quoteCurrency?: string
  ): string {
    try {
      const priceNum = safeParseFloat(price.toString(), 0);

      if (priceNum === 0) return '0';

      // Determine appropriate decimal places based on price magnitude
      let decimals: number;
      if (priceNum >= 1000) {
        decimals = 2;
      } else if (priceNum >= 1) {
        decimals = 4;
      } else if (priceNum >= 0.01) {
        decimals = 6;
      } else {
        decimals = 8;
      }

      const formatted = priceNum.toFixed(decimals);
      const trimmed = safeParseFloat(formatted, 0).toString();

      const suffix = quoteCurrency ? ` ${quoteCurrency}/${baseCurrency}` : ` ${baseCurrency}`;

      return trimmed + suffix;

    } catch (_error) {
      throw new Error(`Failed to format price: ${_error}`);
    }
  }

  /**
   * Format percentage with proper precision
   */
  static formatPercentage(
    value: string | number,
    decimals: number = 2,
    includeSign: boolean = false
  ): string {
    try {
      const percentage = safeParseFloat(value.toString(), 0) * 100;
      const formatted = percentage.toFixed(decimals);
      const sign = includeSign && percentage > 0 ? '+' : '';

      return `${sign}${formatted}%`;

    } catch (_error) {
      throw new Error(`Failed to format percentage: ${_error}`);
    }
  }

  /**
   * Format large numbers with K, M, B suffixes
   */
  static formatLargeNumber(
    value: string | number,
    decimals: number = 2
  ): string {
    try {
      const num = safeParseFloat(value.toString(), 0);

      if (num === 0) return '0';

      const suffixes = ['', 'K', 'M', 'B', 'T'];
      const magnitude = Math.floor(Math.log10(Math.abs(num)) / 3);
      const index = Math.min(magnitude, suffixes.length - 1);

      if (index === 0) {
        return num.toFixed(decimals);
      }

      const scaled = num / Math.pow(1000, index);
      const formatted = scaled.toFixed(decimals);

      return safeParseFloat(formatted, 0).toString() + suffixes[index];

    } catch (_error) {
      throw new Error(`Failed to format large number: ${_error}`);
    }
  }

  /**
   * Calculate and format slippage
   */
  static formatSlippage(
    expectedAmount: string,
    actualAmount: string,
    decimals?: number
  ): {
    slippagePercent: string;
    slippageAmount: string;
    isPositive: boolean;
  } {
    try {
      const expected = new BN(expectedAmount);
      const actual = new BN(actualAmount);

      const difference = actual.sub(expected);
      const slippagePercent = difference.abs().mul(new BN(10000)).div(expected);

      // Convert to percentage (basis points to percent)
      const percentValue = slippagePercent.toNumber() / 100;

      return {
        slippagePercent: TokenFormatter.formatPercentage(percentValue / 100, 2),
        slippageAmount: TokenFormatter.formatAmount(difference.abs().toString(), decimals).display,
        isPositive: difference.gte(new BN(0)),
      };

    } catch (_error) {
      throw new Error(`Failed to calculate slippage: ${_error}`);
    }
  }

  /**
   * Validate amount format
   */
  static validateAmount(amount: string): {
    isValid: boolean;
    error?: string;
  } {
    try {
      // Check for empty or invalid input
      if (!amount || amount.trim() === '') {
        return { isValid: false, error: 'Amount cannot be empty' };
      }

      // Check for valid number format using safe parsing
      const num = safeParseFloat(amount, NaN);
      if (isNaN(num)) {
        return { isValid: false, error: 'Invalid number format' };
      }

      // Check for negative amounts
      if (num < 0) {
        return { isValid: false, error: 'Amount cannot be negative' };
      }

      // Check for zero amounts
      if (num === 0) {
        return { isValid: false, error: 'Amount cannot be zero' };
      }

      // Check for excessive decimal places
      const decimalPlaces = (amount.split('.')[1] || '').length;
      if (decimalPlaces > 18) {
        return { isValid: false, error: 'Too many decimal places (max 18)' };
      }

      return { isValid: true };

    } catch (_error) {
      return { isValid: false, error: 'Validation error' };
    }
  }

  /**
   * Compare two amounts
   */
  static compareAmounts(
    amount1: string,
    amount2: string,
    decimals: number = TokenFormatter.DEFAULT_DECIMALS
  ): number {
    try {
      const bn1 = new BN(TokenFormatter.parseAmount(amount1, decimals));
      const bn2 = new BN(TokenFormatter.parseAmount(amount2, decimals));

      if (bn1.gt(bn2)) return 1;
      if (bn1.lt(bn2)) return -1;
      return 0;

    } catch (_error) {
      throw new Error(`Failed to compare amounts: ${_error}`);
    }
  }

  /**
   * Add two amounts
   */
  static addAmounts(
    amount1: string,
    amount2: string,
    decimals: number = TokenFormatter.DEFAULT_DECIMALS
  ): string {
    try {
      const bn1 = new BN(TokenFormatter.parseAmount(amount1, decimals));
      const bn2 = new BN(TokenFormatter.parseAmount(amount2, decimals));

      const result = bn1.add(bn2);

      return TokenFormatter.formatAmount(result.toString(), decimals).raw;

    } catch (_error) {
      throw new Error(`Failed to add amounts: ${_error}`);
    }
  }

  /**
   * Subtract two amounts
   */
  static subtractAmounts(
    amount1: string,
    amount2: string,
    decimals: number = TokenFormatter.DEFAULT_DECIMALS
  ): string {
    try {
      const bn1 = new BN(TokenFormatter.parseAmount(amount1, decimals));
      const bn2 = new BN(TokenFormatter.parseAmount(amount2, decimals));

      if (bn1.lt(bn2)) {
        throw new Error('Cannot subtract larger amount from smaller amount');
      }

      const result = bn1.sub(bn2);

      return TokenFormatter.formatAmount(result.toString(), decimals).raw;

    } catch (_error) {
      throw new Error(`Failed to subtract amounts: ${_error}`);
    }
  }

  /**
   * Calculate percentage of an amount
   */
  static calculatePercentage(
    amount: string,
    percentage: number,
    decimals: number = TokenFormatter.DEFAULT_DECIMALS
  ): string {
    try {
      const amountBN = new BN(TokenFormatter.parseAmount(amount, decimals));
      const percentageBN = new BN(Math.floor(percentage * 10000)); // Convert to basis points

      const result = amountBN.mul(percentageBN).div(new BN(1000000)); // Divide by 1M for basis points

      return TokenFormatter.formatAmount(result.toString(), decimals).raw;

    } catch (_error) {
      throw new Error(`Failed to calculate percentage: ${_error}`);
    }
  }
}

/**
 * Common token information
 */
export const COMMON_TOKENS: Record<string, TokenInfo> = {
  GALA: {
    symbol: 'GALA',
    decimals: 8,
    name: 'Gala',
  },
  USDC: {
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin',
  },
  ETH: {
    symbol: 'ETH',
    decimals: 18,
    name: 'Ethereum',
  },
  // Add more tokens as they become available
};

/**
 * Get token info by symbol
 */
export function getTokenInfo(symbol: string): TokenInfo | null {
  return COMMON_TOKENS[symbol.toUpperCase()] || null;
}