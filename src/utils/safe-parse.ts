/**
 * Safe parsing utilities for numeric values
 * Prevents NaN crashes and provides validation
 */

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