/**
 * Token Format Normalizer
 * Transparently converts between different token composite key formats
 */

/**
 * Normalize token composite key to GalaChain format
 * Handles both $ and | separators, always returns $ format
 *
 * @param token - Token composite key in any format
 * @returns Token composite key in GalaChain format ($ separator)
 *
 * @example
 * normalizeTokenFormat('GALA|Unit|none|none') // 'GALA$Unit$none$none'
 * normalizeTokenFormat('GALA$Unit$none$none') // 'GALA$Unit$none$none'
 */
export function normalizeTokenFormat(token: string): string {
  if (!token || typeof token !== 'string') {
    throw new Error(`Invalid token format: ${token}`);
  }

  // Already in correct format (uses $ separator)
  if (token.includes('$')) {
    return token;
  }

  // Convert from | separator to $ separator
  if (token.includes('|')) {
    return token.replace(/\|/g, '$');
  }

  // If no separator, assume it's just a symbol and add defaults
  // This handles cases like 'GALA' -> 'GALA$Unit$none$none'
  if (!token.includes('$') && !token.includes('|')) {
    return `${token}$Unit$none$none`;
  }

  return token;
}

/**
 * Normalize an array of token formats
 *
 * @param tokens - Array of token composite keys
 * @returns Array of normalized token composite keys
 */
export function normalizeTokenFormats(tokens: string[]): string[] {
  return tokens.map(normalizeTokenFormat);
}

/**
 * Check if a token is in valid GalaChain format
 *
 * @param token - Token composite key to validate
 * @returns True if token uses $ separator
 */
export function isGalaChainFormat(token: string): boolean {
  return token.includes('$') && token.split('$').length === 4;
}

/**
 * Parse token composite key into components
 * Works with both $ and | separators
 *
 * @param token - Token composite key
 * @returns Object with token components
 */
export function parseTokenComponents(token: string): {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
} {
  const normalized = normalizeTokenFormat(token);
  const parts = normalized.split('$');

  if (parts.length !== 4) {
    throw new Error(`Invalid token format after normalization: ${token} -> ${normalized}`);
  }

  return {
    collection: parts[0],
    category: parts[1],
    type: parts[2],
    additionalKey: parts[3]
  };
}
