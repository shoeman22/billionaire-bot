/**
 * Gas Estimation Utility
 * Dynamic gas estimation for GalaSwap V3 operations
 */

import { logger } from './logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { applyGasBuffer } from './slippage-calculator';
import BigNumber from 'bignumber.js';

export interface GasEstimate {
  gasLimit: number;
  gasPrice: number;
  totalCostUSD: number;
  confidence: 'high' | 'medium' | 'low';
  estimatedAt: number;
}

export interface GasEstimationOptions {
  operation: 'swap' | 'addLiquidity' | 'removeLiquidity' | 'collectFees' | 'rebalance';
  complexity: 'simple' | 'medium' | 'complex';
  urgency: 'low' | 'normal' | 'high';
  networkConditions?: {
    congestion: 'low' | 'medium' | 'high';
    avgGasPrice?: number;
    avgBlockTime?: number;
  };
}

export class GasEstimator {
  private static readonly BASE_GAS_COSTS = {
    swap: {
      simple: 150000,   // Single hop swap
      medium: 250000,   // Multi-hop or complex tokens
      complex: 350000   // Complex routing with multiple hops
    },
    addLiquidity: {
      simple: 200000,   // Basic liquidity addition
      medium: 300000,   // With permit or complex tokens
      complex: 400000   // Full range with multiple tokens
    },
    removeLiquidity: {
      simple: 180000,   // Basic liquidity removal
      medium: 280000,   // Partial removal with complex calculations
      complex: 380000   // Full removal with fee collection
    },
    collectFees: {
      simple: 120000,   // Simple fee collection
      medium: 180000,   // Multiple positions
      complex: 250000   // Complex multi-position collection
    },
    rebalance: {
      simple: 400000,   // Remove + add liquidity
      medium: 600000,   // With complex price calculations
      complex: 800000   // Multi-step rebalancing with optimization
    }
  };

  private static readonly GAS_PRICE_MULTIPLIERS = {
    urgency: {
      low: 0.9,     // 10% below standard
      normal: 1.0,  // Standard gas price
      high: 1.3     // 30% above standard for fast confirmation
    },
    congestion: {
      low: 0.8,     // 20% below during low congestion
      medium: 1.0,  // Standard during normal congestion
      high: 1.5     // 50% above during high congestion
    }
  };

  private static gasPriceCache: {
    price: number;
    timestamp: number;
    confidence: 'high' | 'medium' | 'low';
  } | null = null;

  private static readonly GAS_PRICE_CACHE_TTL = 30000; // 30 seconds

  // CRITICAL FIX: Circuit breaker for graceful degradation
  private static circuitBreaker = {
    failures: 0,
    lastFailureTime: 0,
    maxFailures: 3,
    timeout: 300000, // 5 minutes
    isOpen: false
  };

  // CRITICAL FIX: Conservative fallback for circuit breaker (emergency only)
  private static readonly EMERGENCY_GAS_ESTIMATES = {
    network: 'gala', // GalaChain network
    baseGasPrice: 20, // Conservative estimate in gwei for GalaChain
    lastUpdated: Date.now(),
    source: 'emergency_fallback'
  };

  /**
   * Estimate gas for a specific operation
   */
  static async estimateGas(options: GasEstimationOptions): Promise<GasEstimate> {
    try {
      logger.debug('Estimating gas for operation', {
        operation: options.operation,
        complexity: options.complexity,
        urgency: options.urgency
      });

      // Get base gas limit for operation
      const baseGasLimit = GasEstimator.getBaseGasLimit(options.operation, options.complexity);

      // Apply safety buffer
      const safetyBuffer = GasEstimator.getSafetyBuffer(options.operation, options.complexity);
      const gasLimit = Math.round(baseGasLimit * safetyBuffer);

      // Get current gas price
      const gasPrice = await GasEstimator.getCurrentGasPrice(options);

      // Calculate total cost in USD
      const totalCostUSD = GasEstimator.calculateGasCostUSD(gasLimit, gasPrice);

      // CRITICAL FIX: Determine confidence based on data freshness and circuit breaker state
      const confidence = GasEstimator.getEstimateConfidence(options);

      const estimate: GasEstimate = {
        gasLimit,
        gasPrice,
        totalCostUSD,
        confidence,
        estimatedAt: Date.now()
      };

      logger.debug('Gas estimation completed', {
        operation: options.operation,
        gasLimit,
        gasPrice,
        totalCostUSD: totalCostUSD.toFixed(4),
        confidence
      });

      return estimate;

    } catch (error) {
      logger.error('Failed to estimate gas:', error);

      // CRITICAL FIX: Provide fallback estimate when gas price fetching fails
      logger.warn('Using fallback gas estimate due to pricing failure');

      // Get base gas limit for operation
      const baseGasLimit = GasEstimator.getBaseGasLimit(options.operation, options.complexity);

      // Apply safety buffer
      const safetyBuffer = GasEstimator.getSafetyBuffer(options.operation, options.complexity);
      const gasLimit = Math.round(baseGasLimit * safetyBuffer);

      // Use emergency gas price as fallback
      const gasPrice = GasEstimator.getEmergencyGasPrice(options);

      // Calculate total cost in USD
      const totalCostUSD = GasEstimator.calculateGasCostUSD(gasLimit, gasPrice);

      return {
        gasLimit,
        gasPrice,
        totalCostUSD,
        confidence: 'low', // Low confidence for fallback estimates
        estimatedAt: Date.now()
      };
    }
  }

  /**
   * Get base gas limit for operation type and complexity
   */
  private static getBaseGasLimit(operation: GasEstimationOptions['operation'], complexity: GasEstimationOptions['complexity']): number {
    return GasEstimator.BASE_GAS_COSTS[operation][complexity];
  }

  /**
   * Get safety buffer multiplier based on operation risk
   */
  private static getSafetyBuffer(operation: GasEstimationOptions['operation'], complexity: GasEstimationOptions['complexity']): number {
    const baseBuffer = 1.2; // 20% base safety buffer

    // Additional buffer for complex operations
    const complexityBuffers = {
      simple: 1.0,
      medium: 1.1,
      complex: 1.2
    };

    // Use configured gas buffers with FixedNumber precision
    const operationBuffer = TRADING_CONSTANTS.GAS_BUFFERS[operation.toUpperCase() as keyof typeof TRADING_CONSTANTS.GAS_BUFFERS] || TRADING_CONSTANTS.GAS_BUFFERS.SWAP;

    const totalBuffer = baseBuffer * complexityBuffers[complexity];
    return applyGasBuffer(totalBuffer, operationBuffer);
  }

  /**
   * Get current gas price with network condition adjustments
   * CRITICAL FIX: Implements circuit breaker with graceful degradation
   */
  private static async getCurrentGasPrice(options: GasEstimationOptions): Promise<number> {
    try {
      // Check cache first
      const cachedPrice = GasEstimator.getCachedGasPrice();
      if (cachedPrice) {
        return GasEstimator.adjustGasPrice(cachedPrice, options);
      }

      // CRITICAL FIX: Check circuit breaker state
      if (GasEstimator.isCircuitBreakerOpen()) {
        logger.warn('⚡ Gas price circuit breaker is OPEN - using emergency fallback');
        return GasEstimator.getEmergencyGasPrice(options);
      }

      try {
        // Attempt to fetch real gas price with circuit breaker protection
        const baseGasPrice = await GasEstimator.fetchCurrentGasPrice();

        // CRITICAL FIX: Reset circuit breaker on success
        GasEstimator.resetCircuitBreaker();

        // Cache the result
        GasEstimator.gasPriceCache = {
          price: baseGasPrice,
          timestamp: Date.now(),
          confidence: 'high' // Real data = high confidence
        };

        return GasEstimator.adjustGasPrice(baseGasPrice, options);

      } catch (fetchError) {
        // CRITICAL FIX: Increment circuit breaker failures
        GasEstimator.recordCircuitBreakerFailure();

        // If circuit breaker is now open, use emergency fallback
        if (GasEstimator.isCircuitBreakerOpen()) {
          logger.error('🔥 Gas price circuit breaker ACTIVATED - switching to emergency mode');
          return GasEstimator.getEmergencyGasPrice(options);
        }

        // Still have failures left, throw error for retry
        throw fetchError;
      }

    } catch (error) {
      logger.error('Critical error in gas price fetching:', error);

      // CRITICAL FIX: Last resort emergency pricing to prevent complete system halt
      logger.warn('🚨 EMERGENCY: Using last-resort gas pricing to prevent system halt');
      return GasEstimator.getEmergencyGasPrice(options);
    }
  }

  /**
   * Fetch current gas price from real network data
   * HIGH PRIORITY FIX: Use real gas oracle instead of hardcoded values
   */
  private static async fetchCurrentGasPrice(): Promise<number> {
    try {
      // Try multiple gas price sources for reliability
      const gasPriceSources = [
        () => GasEstimator.fetchFromEthGasStation(),
        () => GasEstimator.fetchFromEtherscan(),
        () => GasEstimator.fetchFromWeb3Provider()
      ];

      // Try each source with timeout
      for (const fetchSource of gasPriceSources) {
        try {
          const gasPrice = await Promise.race([
            fetchSource(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Gas price fetch timeout')), 5000)
            )
          ]);

          if (gasPrice && gasPrice > 0 && gasPrice < 1000) { // Sanity check (< 1000 gwei)
            logger.debug(`Real gas price fetched: ${gasPrice} gwei`);
            return gasPrice;
          }
        } catch (error) {
          logger.debug(`Gas price source failed:`, error);
          continue;
        }
      }

      // CRITICAL FIX: If all sources fail, throw specific error for circuit breaker handling
      throw new Error('All gas price sources exhausted - triggering circuit breaker');

    } catch (error) {
      logger.error('Error fetching real gas price:', error);
      throw new Error(`Gas price sources failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch gas price from ETH Gas Station API
   */
  private static async fetchFromEthGasStation(): Promise<number> {
    try {
      // Note: This would need actual API key and network for production
      // For now, using a simulated response structure
      const response = await fetch('https://ethgasstation.info/api/ethgasAPI.json');
      const data = await response.json() as { fast: number };

      // ETH Gas Station returns in 10ths of gwei
      return Math.round(data.fast / 10);
    } catch (error) {
      throw new Error(`ETH Gas Station fetch failed: ${error}`);
    }
  }

  /**
   * Fetch gas price from Etherscan API
   */
  private static async fetchFromEtherscan(): Promise<number> {
    try {
      // Note: Would need real API key for production
      const apiKey = process.env.ETHERSCAN_API_KEY || 'demo';
      const response = await fetch(
        `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey}`
      );
      const data = await response.json() as { status: string; result?: { ProposeGasPrice: string } };

      if (data.status === '1' && data.result?.ProposeGasPrice) {
        return parseInt(data.result.ProposeGasPrice);
      }

      throw new Error('Invalid Etherscan response');
    } catch (error) {
      throw new Error(`Etherscan fetch failed: ${error}`);
    }
  }

  /**
   * Fetch gas price from Web3 provider (if available)
   */
  private static async fetchFromWeb3Provider(): Promise<number> {
    try {
      // CRITICAL FIX: Use actual Web3 provider, not simulation
      const web3Provider = process.env.WEB3_PROVIDER_URL;
      if (!web3Provider) {
        throw new Error('Web3 provider URL not configured - cannot fetch real gas prices');
      }

      // This would use ethers.js or web3.js to get real gas price
      // For now, throwing error since we don't have real provider setup
      throw new Error('Web3 provider not yet implemented - need real RPC connection for gas prices');
    } catch (error) {
      throw new Error(`Web3 provider fetch failed: ${error}`);
    }
  }

  /**
   * Assess current network conditions - KEPT for potential future use
   * Note: This method is retained but fallback pricing has been removed
   */
  private static assessNetworkConditions(): { congestion: 'low' | 'medium' | 'high' } {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Weekend = lower congestion
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { congestion: 'low' };
    }

    // Business hours = higher congestion
    if (hour >= 9 && hour <= 17) {
      return { congestion: 'high' };
    }

    // Evening in US/Europe = medium congestion
    if (hour >= 18 && hour <= 23) {
      return { congestion: 'medium' };
    }

    return { congestion: 'low' };
  }

  /**
   * Get cached gas price if still valid
   */
  private static getCachedGasPrice(): number | null {
    if (!GasEstimator.gasPriceCache) {
      return null;
    }

    const age = Date.now() - GasEstimator.gasPriceCache.timestamp;
    if (age > GasEstimator.GAS_PRICE_CACHE_TTL) {
      return null;
    }

    return GasEstimator.gasPriceCache.price;
  }

  /**
   * Adjust gas price based on urgency and network conditions
   */
  private static adjustGasPrice(basePrice: number, options: GasEstimationOptions): number {
    let adjustedPrice = basePrice;

    // Apply urgency multiplier
    adjustedPrice *= GasEstimator.GAS_PRICE_MULTIPLIERS.urgency[options.urgency];

    // Apply network congestion multiplier
    if (options.networkConditions?.congestion) {
      adjustedPrice *= GasEstimator.GAS_PRICE_MULTIPLIERS.congestion[options.networkConditions.congestion];
    }

    return Math.round(adjustedPrice);
  }

  /**
   * Calculate gas cost in USD
   */
  private static calculateGasCostUSD(gasLimit: number, gasPriceGwei: number): number {
    // This would use real ETH/USD price in production
    const ethPriceUSD = 3000; // Simulated ETH price
    const gasInEth = new BigNumber(gasLimit).times(gasPriceGwei).div(1e9); // Convert gwei to ETH
    return gasInEth.times(ethPriceUSD).toNumber();
  }

  /**
   * Get confidence level for estimate
   * CRITICAL FIX: Account for circuit breaker state in confidence calculation
   */
  private static getEstimateConfidence(options: GasEstimationOptions): 'high' | 'medium' | 'low' {
    // CRITICAL FIX: Low confidence if circuit breaker is open (using emergency pricing)
    if (GasEstimator.circuitBreaker.isOpen) {
      return 'low';
    }

    // CRITICAL FIX: Low confidence if cache is from emergency fallback
    if (GasEstimator.gasPriceCache?.confidence === 'low') {
      return 'low';
    }

    // High confidence for simple operations with current real data
    if (options.complexity === 'simple' && GasEstimator.gasPriceCache) {
      const cacheAge = Date.now() - GasEstimator.gasPriceCache.timestamp;
      if (cacheAge < 10000 && GasEstimator.gasPriceCache.confidence === 'high') { // Less than 10 seconds old with real data
        return 'high';
      }
    }

    // Medium confidence for most cases with real data
    if (options.complexity !== 'complex' && !GasEstimator.circuitBreaker.isOpen) {
      return 'medium';
    }

    // Low confidence for complex operations, stale data, or degraded conditions
    return 'low';
  }

  /**
   * CRITICAL FIX: Circuit breaker management methods
   */
  private static isCircuitBreakerOpen(): boolean {
    const now = Date.now();

    // Check if timeout has passed and we should try again
    if (GasEstimator.circuitBreaker.isOpen &&
        (now - GasEstimator.circuitBreaker.lastFailureTime) > GasEstimator.circuitBreaker.timeout) {
      logger.info('🔄 Gas price circuit breaker timeout expired - attempting reset');
      GasEstimator.circuitBreaker.isOpen = false;
      GasEstimator.circuitBreaker.failures = 0;
      return false;
    }

    return GasEstimator.circuitBreaker.isOpen;
  }

  private static recordCircuitBreakerFailure(): void {
    GasEstimator.circuitBreaker.failures++;
    GasEstimator.circuitBreaker.lastFailureTime = Date.now();

    if (GasEstimator.circuitBreaker.failures >= GasEstimator.circuitBreaker.maxFailures) {
      GasEstimator.circuitBreaker.isOpen = true;
      logger.error(`⚡ Gas price circuit breaker OPENED after ${GasEstimator.circuitBreaker.failures} failures`);
    }
  }

  private static resetCircuitBreaker(): void {
    if (GasEstimator.circuitBreaker.failures > 0 || GasEstimator.circuitBreaker.isOpen) {
      logger.info('✅ Gas price circuit breaker RESET - real data source restored');
    }
    GasEstimator.circuitBreaker.failures = 0;
    GasEstimator.circuitBreaker.isOpen = false;
    GasEstimator.circuitBreaker.lastFailureTime = 0;
  }

  /**
   * CRITICAL FIX: Emergency gas pricing for circuit breaker fallback
   * Conservative estimates to prevent system halt while marking low confidence
   */
  private static getEmergencyGasPrice(options: GasEstimationOptions): number {
    logger.warn('🚨 Using EMERGENCY gas pricing - estimates may be inaccurate');

    // Use conservative base price adjusted for network conditions
    let emergencyPrice = GasEstimator.EMERGENCY_GAS_ESTIMATES.baseGasPrice;

    // Apply urgency and congestion multipliers (conservative approach)
    emergencyPrice *= GasEstimator.GAS_PRICE_MULTIPLIERS.urgency[options.urgency];

    // Use higher multiplier for emergency conditions to ensure execution
    if (options.networkConditions?.congestion) {
      emergencyPrice *= GasEstimator.GAS_PRICE_MULTIPLIERS.congestion[options.networkConditions.congestion];
    }

    // Add 20% buffer for emergency conditions
    emergencyPrice *= 1.2;

    return Math.round(emergencyPrice);
  }

  /**
   * Estimate gas for multiple operations in batch
   */
  static async estimateGasBatch(operations: GasEstimationOptions[]): Promise<GasEstimate[]> {
    logger.debug(`Estimating gas for ${operations.length} operations`);

    const estimates = await Promise.all(
      operations.map(op => GasEstimator.estimateGas(op))
    );

    const totalCost = estimates.reduce((sum, est) => sum + est.totalCostUSD, 0);
    logger.debug(`Total estimated gas cost: $${totalCost.toFixed(4)}`);

    return estimates;
  }

  /**
   * Check if gas cost is within acceptable limits
   */
  static isGasCostAcceptable(estimate: GasEstimate, maxCostUSD: number): boolean {
    return estimate.totalCostUSD <= maxCostUSD;
  }

  /**
   * Get optimal gas settings for operation
   */
  static getOptimalGasSettings(
    operation: GasEstimationOptions['operation'],
    maxCostUSD: number,
    targetConfirmationTime: 'fast' | 'normal' | 'slow' = 'normal'
  ): GasEstimationOptions {
    const urgencyMap = {
      fast: 'high' as const,
      normal: 'normal' as const,
      slow: 'low' as const
    };

    // Start with simple complexity and adjust if needed
    let complexity: GasEstimationOptions['complexity'] = 'simple';

    // Increase complexity for operations that typically require it
    if (operation === 'rebalance') {
      complexity = 'complex';
    } else if (operation === 'addLiquidity' || operation === 'removeLiquidity') {
      complexity = 'medium';
    }

    return {
      operation,
      complexity,
      urgency: urgencyMap[targetConfirmationTime],
      networkConditions: {
        congestion: 'medium' // Default to medium congestion
      }
    };
  }

  /**
   * Monitor gas prices and update cache
   */
  static startGasPriceMonitoring(intervalMs: number = 30000): void {
    logger.info('Starting gas price monitoring', { intervalMs });

    const monitor = async () => {
      try {
        const price = await GasEstimator.fetchCurrentGasPrice();
        GasEstimator.gasPriceCache = {
          price,
          timestamp: Date.now(),
          confidence: 'high'
        };
        logger.debug('Gas price updated', { price });
      } catch (error) {
        logger.warn('Failed to update gas price cache', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    // Initial update
    monitor();

    // Set up periodic updates
    setInterval(monitor, intervalMs);
  }

  /**
   * Get current gas price cache status
   */
  static getGasPriceStatus(): { price: number | null; age: number; isStale: boolean } {
    if (!GasEstimator.gasPriceCache) {
      return { price: null, age: -1, isStale: true };
    }

    const age = Date.now() - GasEstimator.gasPriceCache.timestamp;
    const isStale = age > GasEstimator.GAS_PRICE_CACHE_TTL;

    return {
      price: GasEstimator.gasPriceCache.price,
      age,
      isStale
    };
  }
}