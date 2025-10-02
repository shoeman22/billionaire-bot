/**
 * Liquidity Filter
 * Prevents quote requests for token pairs that lack sufficient liquidity
 *
 * Based on production data analysis showing consistent "No pools found with sufficient liquidity" errors
 * for specific token combinations on GalaSwap V3.
 */

import { logger } from './logger';

export interface TokenPair {
  tokenIn: string;
  tokenOut: string;
}

export interface LiquidityFilterConfig {
  enableFiltering: boolean;
  logFilteredPairs: boolean;
  updateBlacklistFromErrors: boolean;
}

/**
 * LiquidityFilter - Prevent API requests for illiquid token pairs
 *
 * Maintains a blacklist of token pairs that consistently fail with
 * "No pools found with sufficient liquidity" errors to reduce API noise
 * and improve bot performance.
 */
export class LiquidityFilter {
  private config: LiquidityFilterConfig;

  // Known illiquid pairs based on production data analysis
  private readonly BLACKLISTED_PAIRS = new Set<string>([
    // SILK combinations that consistently fail
    'SILK$Unit$none$none→GWBTC$Unit$none$none',
    'GWBTC$Unit$none$none→SILK$Unit$none$none',
    'SILK$Unit$none$none→GWETH$Unit$none$none',
    'GWETH$Unit$none$none→SILK$Unit$none$none',
    'SILK$Unit$none$none→GUSDC$Unit$none$none',
    'GUSDC$Unit$none$none→SILK$Unit$none$none',
    'SILK$Unit$none$none→GUSDT$Unit$none$none',
    'GUSDT$Unit$none$none→SILK$Unit$none$none',

    // GTON combinations that consistently fail
    'GALA$Unit$none$none→GTON$Unit$none$none',
    'GTON$Unit$none$none→GALA$Unit$none$none',
    'GUSDC$Unit$none$none→GTON$Unit$none$none',
    'GTON$Unit$none$none→GUSDC$Unit$none$none',
    'GUSDT$Unit$none$none→GTON$Unit$none$none',
    'GTON$Unit$none$none→GUSDT$Unit$none$none',

    // ETIME combinations that consistently fail
    'GUSDT$Unit$none$none→ETIME$Unit$none$none',
    'ETIME$Unit$none$none→GUSDT$Unit$none$none',
    'GWBTC$Unit$none$none→ETIME$Unit$none$none',
    'ETIME$Unit$none$none→GWBTC$Unit$none$none',
    'GUSDC$Unit$none$none→ETIME$Unit$none$none',
    'ETIME$Unit$none$none→GUSDC$Unit$none$none',
    'GWETH$Unit$none$none→ETIME$Unit$none$none',
    'ETIME$Unit$none$none→GWETH$Unit$none$none',

    // Additional exotic pairs that typically lack liquidity
    'SILK$Unit$none$none→GTON$Unit$none$none',
    'GTON$Unit$none$none→SILK$Unit$none$none',
    'GWETH$Unit$none$none→GTON$Unit$none$none',
    'GTON$Unit$none$none→GWETH$Unit$none$none',
    'GWBTC$Unit$none$none→GTON$Unit$none$none',
    'GTON$Unit$none$none→GWBTC$Unit$none$none',
    'GWBTC$Unit$none$none→GWETH$Unit$none$none',
    'GWETH$Unit$none$none→GWBTC$Unit$none$none',

    // ✅ FIX: TOWN combinations (consistently no liquidity)
    'GALA$Unit$none$none→TOWN$Unit$none$none',
    'TOWN$Unit$none$none→GALA$Unit$none$none',
    'GUSDC$Unit$none$none→TOWN$Unit$none$none',
    'TOWN$Unit$none$none→GUSDC$Unit$none$none',
    'GUSDT$Unit$none$none→TOWN$Unit$none$none',
    'TOWN$Unit$none$none→GUSDT$Unit$none$none',
    'ETIME$Unit$none$none→TOWN$Unit$none$none',
    'TOWN$Unit$none$none→ETIME$Unit$none$none',
  ]);

  // Known liquid pairs that should always be allowed
  private readonly WHITELISTED_PAIRS = new Set<string>([
    // Primary GALA pairs (high liquidity)
    'GALA$Unit$none$none→GUSDC$Unit$none$none',
    'GUSDC$Unit$none$none→GALA$Unit$none$none',
    'GALA$Unit$none$none→GUSDT$Unit$none$none',
    'GUSDT$Unit$none$none→GALA$Unit$none$none',

    // Stablecoin pairs (reliable liquidity)
    'GUSDC$Unit$none$none→GUSDT$Unit$none$none',
    'GUSDT$Unit$none$none→GUSDC$Unit$none$none',

    // ETIME with GALA (gaming ecosystem)
    'GALA$Unit$none$none→ETIME$Unit$none$none',
    'ETIME$Unit$none$none→GALA$Unit$none$none',

    // SILK with GALA (gaming ecosystem)
    'GALA$Unit$none$none→SILK$Unit$none$none',
    'SILK$Unit$none$none→GALA$Unit$none$none',
  ]);

  // Dynamic blacklist for newly discovered illiquid pairs
  private dynamicBlacklist = new Set<string>();

  // Statistics tracking
  private stats = {
    totalFiltered: 0,
    blacklistHits: 0,
    dynamicBlacklistHits: 0,
    whitelistOverrides: 0,
    lastReset: Date.now()
  };

  constructor(config?: Partial<LiquidityFilterConfig>) {
    this.config = {
      enableFiltering: true,
      logFilteredPairs: false, // Set to false to reduce log noise
      updateBlacklistFromErrors: true,
      ...config
    };

    logger.info('✅ Liquidity Filter initialized', {
      staticBlacklist: this.BLACKLISTED_PAIRS.size,
      whitelist: this.WHITELISTED_PAIRS.size,
      filteringEnabled: this.config.enableFiltering
    });
  }

  /**
   * Check if a token pair should be filtered (blocked from quotes)
   */
  shouldFilterPair(tokenIn: string, tokenOut: string): boolean {
    if (!this.config.enableFiltering) {
      return false;
    }

    // Convert SDK format to API format for consistent comparison
    const apiTokenIn = this.convertToApiFormat(tokenIn);
    const apiTokenOut = this.convertToApiFormat(tokenOut);
    const pairKey = `${apiTokenIn}→${apiTokenOut}`;

    // Check whitelist first (overrides blacklist)
    if (this.WHITELISTED_PAIRS.has(pairKey)) {
      this.stats.whitelistOverrides++;
      return false;
    }

    // Check static blacklist
    if (this.BLACKLISTED_PAIRS.has(pairKey)) {
      this.stats.blacklistHits++;
      this.stats.totalFiltered++;

      if (this.config.logFilteredPairs) {
        logger.debug(`🚫 Filtered illiquid pair: ${apiTokenIn} → ${apiTokenOut}`);
      }

      return true;
    }

    // Check dynamic blacklist
    if (this.dynamicBlacklist.has(pairKey)) {
      this.stats.dynamicBlacklistHits++;
      this.stats.totalFiltered++;

      if (this.config.logFilteredPairs) {
        logger.debug(`🚫 Filtered dynamically blacklisted pair: ${apiTokenIn} → ${apiTokenOut}`);
      }

      return true;
    }

    return false;
  }

  /**
   * Add a token pair to the dynamic blacklist after liquidity error
   */
  addToBlacklist(tokenIn: string, tokenOut: string, reason: string = 'insufficient_liquidity'): void {
    if (!this.config.updateBlacklistFromErrors) {
      return;
    }

    const apiTokenIn = this.convertToApiFormat(tokenIn);
    const apiTokenOut = this.convertToApiFormat(tokenOut);
    const pairKey = `${apiTokenIn}→${apiTokenOut}`;

    // Don't blacklist whitelisted pairs
    if (this.WHITELISTED_PAIRS.has(pairKey)) {
      return;
    }

    // Add to dynamic blacklist
    if (!this.dynamicBlacklist.has(pairKey)) {
      this.dynamicBlacklist.add(pairKey);
      logger.info(`📝 Added to dynamic blacklist: ${apiTokenIn} → ${apiTokenOut} (${reason})`);
    }
  }

  /**
   * Convert token format from SDK (|) to API ($) format
   */
  private convertToApiFormat(token: string): string {
    return token.replace(/\|/g, '$');
  }

  /**
   * Get liquid token pairs from a list of tokens
   */
  getLiquidPairs(tokens: string[]): TokenPair[] {
    const liquidPairs: TokenPair[] = [];

    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = tokens[i];
        const tokenB = tokens[j];

        // Test both directions
        if (!this.shouldFilterPair(tokenA, tokenB)) {
          liquidPairs.push({ tokenIn: tokenA, tokenOut: tokenB });
        }

        if (!this.shouldFilterPair(tokenB, tokenA)) {
          liquidPairs.push({ tokenIn: tokenB, tokenOut: tokenA });
        }
      }
    }

    return liquidPairs;
  }

  /**
   * Get high-confidence liquid pairs (whitelisted only)
   */
  getHighConfidencePairs(): TokenPair[] {
    const pairs: TokenPair[] = [];

    for (const pairKey of this.WHITELISTED_PAIRS) {
      const [apiTokenIn, apiTokenOut] = pairKey.split('→');
      const tokenIn = apiTokenIn.replace(/\$/g, '|');
      const tokenOut = apiTokenOut.replace(/\$/g, '|');

      pairs.push({ tokenIn, tokenOut });
    }

    return pairs;
  }

  /**
   * Reset dynamic blacklist (useful for testing market conditions)
   */
  resetDynamicBlacklist(): void {
    const previousSize = this.dynamicBlacklist.size;
    this.dynamicBlacklist.clear();
    this.stats.lastReset = Date.now();

    logger.info(`🔄 Reset dynamic blacklist (removed ${previousSize} pairs)`);
  }

  /**
   * Get filter statistics
   */
  getStatistics(): {
    totalFiltered: number;
    blacklistHits: number;
    dynamicBlacklistHits: number;
    whitelistOverrides: number;
    staticBlacklistSize: number;
    dynamicBlacklistSize: number;
    whitelistSize: number;
    lastReset: number;
    filteringEnabled: boolean;
  } {
    return {
      ...this.stats,
      staticBlacklistSize: this.BLACKLISTED_PAIRS.size,
      dynamicBlacklistSize: this.dynamicBlacklist.size,
      whitelistSize: this.WHITELISTED_PAIRS.size,
      filteringEnabled: this.config.enableFiltering
    };
  }

  /**
   * Enable or disable liquidity filtering
   */
  setFilteringEnabled(enabled: boolean): void {
    this.config.enableFiltering = enabled;
    logger.info(`📊 Liquidity filtering ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get list of all blacklisted pairs (for debugging)
   */
  getBlacklistedPairs(): string[] {
    return [
      ...Array.from(this.BLACKLISTED_PAIRS),
      ...Array.from(this.dynamicBlacklist)
    ];
  }

  /**
   * Check if a specific pair is blacklisted
   */
  isPairBlacklisted(tokenIn: string, tokenOut: string): boolean {
    const apiTokenIn = this.convertToApiFormat(tokenIn);
    const apiTokenOut = this.convertToApiFormat(tokenOut);
    const pairKey = `${apiTokenIn}→${apiTokenOut}`;

    return this.BLACKLISTED_PAIRS.has(pairKey) || this.dynamicBlacklist.has(pairKey);
  }

  /**
   * Check if a specific pair is whitelisted
   */
  isPairWhitelisted(tokenIn: string, tokenOut: string): boolean {
    const apiTokenIn = this.convertToApiFormat(tokenIn);
    const apiTokenOut = this.convertToApiFormat(tokenOut);
    const pairKey = `${apiTokenIn}→${apiTokenOut}`;

    return this.WHITELISTED_PAIRS.has(pairKey);
  }
}

/**
 * Global liquidity filter instance
 */
export const liquidityFilter = new LiquidityFilter();