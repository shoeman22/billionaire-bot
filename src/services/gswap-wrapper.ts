/**
 * GSwap SDK Wrapper
 *
 * Fixes critical issues in GalaSwap SDK v0.0.7:
 * 1. Wrong API endpoint: /api/asset/dexv3-contract/GetPoolData (404) -> /v1/trade/pool (works)
 * 2. Token format validation: pipe separators vs dollar separators
 *
 * This wrapper maintains full SDK compatibility while fixing the underlying issues.
 */

import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import BigNumber from 'bignumber.js';
import { logger } from '../utils/logger';

interface GalaChainTokenClassKey {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
}

interface GetPoolDataResponse {
  bitmap: Record<string, string>;
  fee: number;
  feeGrowthGlobal0: BigNumber;
  feeGrowthGlobal1: BigNumber;
  grossPoolLiquidity: BigNumber;
  liquidity: BigNumber;
  maxLiquidityPerTick: BigNumber;
  protocolFees: number;
  protocolFeesToken0: BigNumber;
  protocolFeesToken1: BigNumber;
  sqrtPrice: BigNumber;
  tickSpacing: number;
  token0: string;
  token0ClassKey: GalaChainTokenClassKey;
  token1: string;
  token1ClassKey: GalaChainTokenClassKey;
}

interface GSwapOptions {
  signer?: PrivateKeySigner;
  walletAddress?: string;
  gatewayBaseUrl: string;
  dexBackendBaseUrl: string;
  bundlerBaseUrl: string;
}

/**
 * Enhanced Pools Service that fixes the API endpoint issues
 */
class FixedPoolsService {
  private gatewayBaseUrl: string;
  private dexContractBasePath: string;
  private httpClient: any;
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.gatewayBaseUrl = baseUrl;
    this.dexContractBasePath = '/v1/trade';
    this.httpClient = null; // Not used in our implementation
  }

  /**
   * Convert token to the format the API expects
   */
  private formatTokenForAPI(token: GalaChainTokenClassKey | string): string {
    if (typeof token === 'string') {
      // If it's already a string, convert pipe separators to dollar separators
      return token.replace(/\|/g, '$');
    } else {
      // If it's an object, format it with dollar separators
      return `${token.collection}$${token.category}$${token.type}$${token.additionalKey}`;
    }
  }

  /**
   * Convert string token to TokenClassKey object or pass through if already an object
   */
  private parseTokenString(tokenStr: string | GalaChainTokenClassKey): GalaChainTokenClassKey {
    // If it's already an object, return it
    if (typeof tokenStr === 'object' && tokenStr !== null) {
      return tokenStr;
    }

    // If it's a string, parse it
    if (typeof tokenStr === 'string') {
      // Handle both $ and | separators
      const parts = tokenStr.includes('$') ? tokenStr.split('$') : tokenStr.split('|');

      if (parts.length !== 4) {
        throw new Error(`Invalid token format: ${tokenStr}`);
      }

      return {
        collection: parts[0],
        category: parts[1],
        type: parts[2],
        additionalKey: parts[3]
      };
    }

    throw new Error(`Invalid token type: ${typeof tokenStr}`);
  }

  /**
   * Ensure token ordering (token0 should sort before token1)
   */
  private orderTokens(token0: string, token1: string): { token0: string; token1: string; reversed: boolean } {
    const comparison = token0.localeCompare(token1);
    if (comparison <= 0) {
      return { token0, token1, reversed: false };
    } else {
      return { token0: token1, token1: token0, reversed: true };
    }
  }

  /**
   * Get pool data using the correct API endpoint
   */
  async getPoolData(
    token0: GalaChainTokenClassKey | string,
    token1: GalaChainTokenClassKey | string,
    fee: number
  ): Promise<GetPoolDataResponse> {
    try {
      // Format tokens for API
      const token0Str = this.formatTokenForAPI(token0);
      const token1Str = this.formatTokenForAPI(token1);

      // Ensure proper token ordering
      const { token0: orderedToken0, token1: orderedToken1 } = this.orderTokens(token0Str, token1Str);

      logger.debug(`Getting pool data for ${orderedToken0}/${orderedToken1} fee=${fee}`);

      // Build API request
      const params = new URLSearchParams({
        token0: orderedToken0,
        token1: orderedToken1,
        fee: fee.toString()
      });

      const response = await fetch(`${this.baseUrl}/v1/trade/pool?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`Pool API error ${response.status}: ${errorData.message || 'Unknown error'}`);
      }

      const data = await response.json() as any;

      // API response has nested structure: { data: { Data: { ... } } }
      if (!data.data || !data.data.Data) {
        throw new Error('Invalid pool response: missing data.Data field');
      }

      const poolData = data.data.Data;

      // Convert to SDK-compatible format
      const result: GetPoolDataResponse = {
        bitmap: poolData.bitmap || {},
        fee: poolData.fee,
        feeGrowthGlobal0: new BigNumber(poolData.feeGrowthGlobal0 || '0'),
        feeGrowthGlobal1: new BigNumber(poolData.feeGrowthGlobal1 || '0'),
        grossPoolLiquidity: new BigNumber(poolData.grossPoolLiquidity || '0'),
        liquidity: new BigNumber(poolData.liquidity || '0'),
        maxLiquidityPerTick: new BigNumber(poolData.maxLiquidityPerTick || '0'),
        protocolFees: poolData.protocolFees || 0,
        protocolFeesToken0: new BigNumber(poolData.protocolFeesToken0 || '0'),
        protocolFeesToken1: new BigNumber(poolData.protocolFeesToken1 || '0'),
        sqrtPrice: new BigNumber(poolData.sqrtPrice || '0'),
        tickSpacing: poolData.tickSpacing || 60,
        token0: poolData.token0ClassKey,
        token0ClassKey: this.parseTokenString(poolData.token0ClassKey),
        token1: poolData.token1ClassKey,
        token1ClassKey: this.parseTokenString(poolData.token1ClassKey)
      };

      logger.debug(`Pool data retrieved successfully: sqrtPrice=${result.sqrtPrice.toString()}`);
      return result;

    } catch (error) {
      logger.error('Error in FixedPoolsService.getPoolData:', error);
      throw error;
    }
  }

  /**
   * Calculate spot price from sqrt price - matches SDK behavior
   */
  calculateSpotPrice(
    token0: GalaChainTokenClassKey | string,
    token1: GalaChainTokenClassKey | string,
    sqrtPrice: BigNumber | string | number
  ): BigNumber {
    try {
      const sqrtPriceBN = new BigNumber(sqrtPrice);

      if (!sqrtPriceBN.isFinite() || sqrtPriceBN.isZero()) {
        throw new Error('Invalid sqrtPrice: must be finite and non-zero');
      }

      // Format tokens for comparison
      const token0Str = this.formatTokenForAPI(token0);
      const token1Str = this.formatTokenForAPI(token1);

      // Check token ordering to determine if we need to invert
      const { reversed } = this.orderTokens(token0Str, token1Str);

      // Calculate price = (sqrtPrice)^2
      const price = sqrtPriceBN.pow(2);

      // If tokens were reversed, return the inverse price
      return reversed ? new BigNumber(1).div(price) : price;

    } catch (error) {
      logger.error('Error in calculateSpotPrice:', error);
      throw error;
    }
  }

  /**
   * Calculate ticks for price - delegate to original SDK if available
   */
  calculateTicksForPrice(price: BigNumber | string | number, tickSpacing: number): number {
    const priceBN = new BigNumber(price);

    if (priceBN.isZero()) return -886800;
    if (!priceBN.isFinite()) return 886800;

    const tick = Math.round(Math.log(priceBN.toNumber()) / Math.log(1.0001));
    const alignedTick = Math.floor(tick / tickSpacing) * tickSpacing;

    return Math.min(Math.max(alignedTick, -886800), 886800);
  }

  /**
   * Calculate price for ticks - delegate to original SDK if available
   */
  calculatePriceForTicks(tick: number): BigNumber {
    if (tick === -886800) return new BigNumber('0');
    if (tick === 886800) return new BigNumber('Infinity');

    const price = Math.pow(1.0001, tick);
    return new BigNumber(price);
  }
}

/**
 * GSwap SDK Wrapper that fixes endpoint and token format issues
 */
export class GSwapWrapper extends GSwap {
  // @ts-ignore TS2416: Enhanced pools service replaces base implementation
  public pools: FixedPoolsService;

  constructor(options: GSwapOptions) {
    super(options);

    // Replace the pools service with our fixed version
    this.pools = new FixedPoolsService(options.dexBackendBaseUrl);

    logger.info('GSwapWrapper initialized with fixed pools service');
  }
}

// Export the wrapper as the default GSwap replacement
export { GSwapWrapper as GSwap };
export { PrivateKeySigner } from '@gala-chain/gswap-sdk';