import { logger } from '../utils/logger';
import { validateEnvironment } from '../config/environment';

export interface PoolData {
  poolPair: string;
  poolHash: string;
  token0: string;
  token0Image: string;
  token1: string;
  token1Image: string;
  token0Price: string;
  token1Price: string;
  poolName: string;
  fee: string;
  fee24h: number;
  token0Tvl: number;
  token0TvlUsd: number;
  token1Tvl: number;
  token1TvlUsd: number;
  tvl: number;
  volume1d: number;
  volume30d: number;
  dayPerTvl: number;
  apr1d: number;
}

export interface PoolsResponse {
  status: number;
  error: boolean;
  message: string;
  data: {
    pools: PoolData[];
    count: number;
  };
}

export interface TriangularPath {
  tokens: [string, string, string];
  pools: [PoolData, PoolData, PoolData];
  estimatedGas: number;
  totalTvl: number;
  avgFee: number;
}

export class PoolDiscoveryService {
  private pools: PoolData[] = [];
  private lastUpdate: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly baseUrl: string;

  constructor() {
    try {
      const config = validateEnvironment();
      this.baseUrl = config.api.baseUrl;
    } catch (error) {
      // Use default API URL if environment validation fails (for demo mode)
      logger.warn('⚠️  Environment validation failed, using default API URL for demo mode');
      this.baseUrl = 'https://dex-backend-prod1.defi.gala.com';
    }
  }

  /**
   * Fetch all pools from GalaSwap explore API with pagination
   */
  async fetchAllPools(forceRefresh = false): Promise<PoolData[]> {
    const now = Date.now();

    if (!forceRefresh && this.pools.length > 0 && (now - this.lastUpdate) < this.CACHE_TTL) {
      logger.info(`📊 Using cached pools data (${this.pools.length} pools)`);
      return this.pools;
    }

    logger.info('🔍 Fetching all pools from GalaSwap explore API...');

    const allPools: PoolData[] = [];
    let page = 1;
    const limit = 20; // Max limit from API
    let hasMore = true;

    try {
      while (hasMore) {
        const url = `${this.baseUrl}/explore/pools?limit=${limit}&page=${page}&sortBy=tvl&sortOrder=desc`;

        logger.debug(`📄 Fetching page ${page}...`);

        const response = await fetch(url, {
          headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'priority': 'u=1, i',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'Referer': 'https://swap.gala.com/'
          }
        });

        if (response.status === 400) {
          // API returns 400 when out of pools
          logger.info(`✅ Reached end of pools at page ${page}`);
          hasMore = false;
          break;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as PoolsResponse;

        if (data.error || !data.data?.pools) {
          logger.warn(`⚠️  No pools returned for page ${page}`);
          hasMore = false;
          break;
        }

        const pools = data.data.pools;
        allPools.push(...pools);

        logger.info(`📊 Page ${page}: ${pools.length} pools (Total: ${allPools.length})`);

        // If we got fewer pools than limit, we're at the end
        if (pools.length < limit) {
          hasMore = false;
        }

        page++;

        // Small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      this.pools = allPools;
      this.lastUpdate = now;

      logger.info(`✅ Successfully fetched ${allPools.length} total pools`);
      this.logPoolSummary();

      return allPools;

    } catch (error) {
      logger.error('❌ Failed to fetch pools:', error);

      // Return cached data if available
      if (this.pools.length > 0) {
        logger.warn(`⚠️  Using stale cached data (${this.pools.length} pools)`);
        return this.pools;
      }

      throw error;
    }
  }

  /**
   * Get all unique tokens available for trading
   */
  getAvailableTokens(): string[] {
    const tokens = new Set<string>();

    this.pools.forEach(pool => {
      // Convert token symbols to full format
      tokens.add(`${pool.token0}|Unit|none|none`);
      tokens.add(`${pool.token1}|Unit|none|none`);
    });

    return Array.from(tokens).sort();
  }

  /**
   * Get all trading pairs (token0/token1 combinations)
   */
  getTradingPairs(): Array<{ token0: string, token1: string, pools: PoolData[] }> {
    const pairMap = new Map<string, PoolData[]>();

    this.pools.forEach(pool => {
      // Create bidirectional pairs
      const pair1 = `${pool.token0}/${pool.token1}`;
      const pair2 = `${pool.token1}/${pool.token0}`;

      if (!pairMap.has(pair1)) pairMap.set(pair1, []);
      if (!pairMap.has(pair2)) pairMap.set(pair2, []);

      pairMap.get(pair1)!.push(pool);
      pairMap.get(pair2)!.push(pool);
    });

    const pairs: Array<{ token0: string, token1: string, pools: PoolData[] }> = [];
    const processed = new Set<string>();

    for (const [pairKey, pools] of pairMap.entries()) {
      const [token0, token1] = pairKey.split('/');
      const reversePair = `${token1}/${token0}`;

      if (!processed.has(pairKey) && !processed.has(reversePair)) {
        pairs.push({ token0: `${token0}|Unit|none|none`, token1: `${token1}|Unit|none|none`, pools });
        processed.add(pairKey);
        processed.add(reversePair);
      }
    }

    return pairs.sort((a, b) => b.pools[0].tvl - a.pools[0].tvl);
  }

  /**
   * Find triangular arbitrage paths
   */
  findTriangularPaths(): TriangularPath[] {
    const paths: TriangularPath[] = [];
    const tokens = this.getAvailableTokens().map(t => t.split('|')[0]);

    // Find all possible triangular paths
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        for (let k = j + 1; k < tokens.length; k++) {
          const tokenA = tokens[i];
          const tokenB = tokens[j];
          const tokenC = tokens[k];

          // Check if we have pools for A→B, B→C, C→A
          const poolAB = this.findBestPool(tokenA, tokenB);
          const poolBC = this.findBestPool(tokenB, tokenC);
          const poolCA = this.findBestPool(tokenC, tokenA);

          if (poolAB && poolBC && poolCA) {
            const totalTvl = poolAB.tvl + poolBC.tvl + poolCA.tvl;
            const avgFee = (parseFloat(poolAB.fee) + parseFloat(poolBC.fee) + parseFloat(poolCA.fee)) / 3;

            paths.push({
              tokens: [
                `${tokenA}|Unit|none|none`,
                `${tokenB}|Unit|none|none`,
                `${tokenC}|Unit|none|none`
              ],
              pools: [poolAB, poolBC, poolCA],
              estimatedGas: this.estimateGasCost(3),
              totalTvl,
              avgFee
            });
          }
        }
      }
    }

    // Sort by TVL (higher liquidity = better arbitrage opportunities)
    return paths.sort((a, b) => b.totalTvl - a.totalTvl);
  }

  /**
   * Find the best pool for a token pair (highest TVL)
   */
  findBestPool(token0Symbol: string, token1Symbol: string): PoolData | null {
    const candidates = this.pools.filter(pool =>
      (pool.token0 === token0Symbol && pool.token1 === token1Symbol) ||
      (pool.token0 === token1Symbol && pool.token1 === token0Symbol)
    );

    if (candidates.length === 0) return null;

    // Return pool with highest TVL
    return candidates.reduce((best, current) =>
      current.tvl > best.tvl ? current : best
    );
  }

  /**
   * Get pools with minimum TVL threshold
   */
  getHighLiquidityPools(minTvlUsd = 100000): PoolData[] {
    return this.pools.filter(pool => pool.tvl >= minTvlUsd);
  }

  /**
   * Get stablecoin pools (for stablecoin arbitrage)
   */
  getStablecoinPools(): PoolData[] {
    const stablecoins = ['GUSDC', 'GUSDT', 'GUSD'];

    return this.pools.filter(pool =>
      stablecoins.includes(pool.token0) && stablecoins.includes(pool.token1)
    );
  }

  /**
   * Get pools for cross-asset momentum (major assets)
   */
  getMomentumAssetPools(): PoolData[] {
    const majorAssets = ['GALA', 'GWETH', 'GWBTC', 'GSOL'];

    return this.pools.filter(pool =>
      majorAssets.includes(pool.token0) || majorAssets.includes(pool.token1)
    );
  }

  /**
   * Estimate gas cost for number of hops
   */
  private estimateGasCost(hops: number): number {
    const baseGas = 150000; // Base gas for transaction
    const hopGas = 100000;  // Additional gas per hop
    return baseGas + (hops * hopGas);
  }

  /**
   * Log summary of discovered pools
   */
  private logPoolSummary(): void {
    if (this.pools.length === 0) return;

    const tokens = this.getAvailableTokens();
    const pairs = this.getTradingPairs();
    const triangularPaths = this.findTriangularPaths();

    const totalTvl = this.pools.reduce((sum, pool) => sum + pool.tvl, 0);
    const avgTvl = totalTvl / this.pools.length;

    const feeTiers = new Map<string, number>();
    this.pools.forEach(pool => {
      const fee = pool.fee;
      feeTiers.set(fee, (feeTiers.get(fee) || 0) + 1);
    });

    logger.info('\n📊 Pool Discovery Summary:');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`   Total Pools: ${this.pools.length}`);
    logger.info(`   Unique Tokens: ${tokens.length}`);
    logger.info(`   Trading Pairs: ${pairs.length}`);
    logger.info(`   Triangular Paths: ${triangularPaths.length}`);
    logger.info(`   Total TVL: $${totalTvl.toLocaleString()}`);
    logger.info(`   Average TVL: $${avgTvl.toLocaleString()}`);

    logger.info('\n💰 Fee Tiers:');
    Array.from(feeTiers.entries())
      .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
      .forEach(([fee, count]) => {
        const percentage = parseFloat(fee);
        logger.info(`   ${percentage}%: ${count} pools`);
      });

    logger.info('\n🔝 Top 5 Pools by TVL:');
    this.pools
      .slice(0, 5)
      .forEach((pool, i) => {
        logger.info(`   ${i + 1}. ${pool.poolName}: $${pool.tvl.toLocaleString()} (${pool.fee}% fee)`);
      });

    if (triangularPaths.length > 0) {
      logger.info('\n🔺 Top 3 Triangular Paths:');
      triangularPaths
        .slice(0, 3)
        .forEach((path, i) => {
          const tokens = path.tokens.map(t => t.split('|')[0]).join(' → ');
          logger.info(`   ${i + 1}. ${tokens}: $${path.totalTvl.toLocaleString()} TVL, ${path.avgFee.toFixed(2)}% avg fee`);
        });
    }
  }

  /**
   * Get cached pools (for fast access)
   */
  getCachedPools(): PoolData[] {
    return this.pools;
  }

  /**
   * Check if pool data is stale
   */
  isDataStale(): boolean {
    return Date.now() - this.lastUpdate > this.CACHE_TTL;
  }
}

// Export singleton instance
export const poolDiscovery = new PoolDiscoveryService();