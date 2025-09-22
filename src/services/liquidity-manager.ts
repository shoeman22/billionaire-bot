/**
 * Liquidity Manager Service
 * High-level interface for GalaSwap V3 liquidity operations
 * Handles position management, fee collection, and yield optimization
 */

import { GSwapWrapper } from './gswap-wrapper';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { safeParseFloat } from '../utils/safe-parse';
import BigNumber from 'bignumber.js';
import { randomBytes } from 'crypto';
import { promisify } from 'util';
import { InputValidator } from '../utils/validation';
import { RetryHelper } from '../utils/retry-helper';
import { GasEstimator, GasEstimationOptions } from '../utils/gas-estimator';

const randomBytesAsync = promisify(randomBytes);

export interface LiquidityPosition {
  id: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  minPrice: number;
  maxPrice: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  uncollectedFees0: string;
  uncollectedFees1: string;
  inRange: boolean;
  createdAt: number;
  lastUpdate: number;
}

export interface AddLiquidityParams {
  token0: string;
  token1: string;
  fee: number;
  minPrice: number;
  maxPrice: number;
  amount0Desired: string;
  amount1Desired: string;
  slippageTolerance?: number;
}

export interface RemoveLiquidityParams {
  positionId: string;
  liquidity: string;
  slippageTolerance?: number;
}

export interface CollectFeesParams {
  positionId: string;
  amount0Max?: string;
  amount1Max?: string;
}

export interface RebalanceParams {
  positionId: string;
  newMinPrice: number;
  newMaxPrice: number;
  slippageTolerance?: number;
}

export interface PositionAnalytics {
  totalValueUSD: number;
  impermanentLoss: number;
  feesEarnedUSD: number;
  apr: number;
  utilization: number;
  timeInRange: number;
}

export class LiquidityManager {
  private gswap: GSwapWrapper;
  private positions: Map<string, LiquidityPosition> = new Map();
  private readonly walletAddress: string;
  private readonly defaultSlippage: number;
  private instanceCounter: number = 0;

  constructor(gswap: GSwapWrapper, walletAddress: string) {
    this.gswap = gswap;
    this.walletAddress = walletAddress;
    this.defaultSlippage = TRADING_CONSTANTS.DEFAULT_SLIPPAGE_TOLERANCE;
    logger.info('LiquidityManager initialized');
  }

  /**
   * Add liquidity to a price range (easiest method for users)
   */
  async addLiquidityByPrice(params: AddLiquidityParams): Promise<string> {
    try {
      // Validate parameters
      this.validateAddLiquidityParams(params);

      logger.info('Adding liquidity by price range', {
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice
      });

      // Estimate gas cost before proceeding
      const gasEstimate = await this.estimateOperationGas('addLiquidity', 'medium');
      logger.debug('Gas estimate for add liquidity', {
        gasLimit: gasEstimate.gasLimit,
        gasPrice: gasEstimate.gasPrice,
        totalCostUSD: gasEstimate.totalCostUSD,
        confidence: gasEstimate.confidence
      });

      // Check if gas cost is reasonable (configurable threshold)
      const maxGasCostUSD = TRADING_CONSTANTS.MAX_POSITION_VALUE_USD * 0.01; // 1% of max position value
      if (!GasEstimator.isGasCostAcceptable(gasEstimate, maxGasCostUSD)) {
        logger.warn('Gas cost exceeds threshold', {
          estimatedCost: gasEstimate.totalCostUSD,
          maxCost: maxGasCostUSD
        });
        // Continue but log warning - user can decide
      }

      // Generate unique position ID
      const positionId = await this.generatePositionId(params.token0, params.token1, params.fee);

      // Calculate slippage tolerances with BigNumber precision
      const slippage = params.slippageTolerance || this.defaultSlippage;
      const slippageBN = new BigNumber(slippage);
      const oneMinusSlippage = new BigNumber(1).minus(slippageBN);
      const amount0Min = new BigNumber(params.amount0Desired).times(oneMinusSlippage).toString();
      const amount1Min = new BigNumber(params.amount1Desired).times(oneMinusSlippage).toString();

      // Use SDK liquidity service with retry logic
      const result = await RetryHelper.withRetry(
        async () => {
          return await this.gswap.liquidityPositions.addLiquidityByPrice({
            walletAddress: this.walletAddress,
            positionId,
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickSpacing: this.getTickSpacing(params.fee),
            minPrice: params.minPrice,
            maxPrice: params.maxPrice,
            amount0Desired: params.amount0Desired,
            amount1Desired: params.amount1Desired,
            amount0Min,
            amount1Min
          });
        },
        RetryHelper.getApiRetryOptions('slow'),
        'addLiquidityByPrice'
      );

      // Store position locally
      const position: LiquidityPosition = {
        id: positionId,
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
        tickLower: this.priceToTick(params.minPrice),
        tickUpper: this.priceToTick(params.maxPrice),
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        liquidity: result.liquidity || '0',
        amount0: result.amount0 || params.amount0Desired,
        amount1: result.amount1 || params.amount1Desired,
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true, // Will be updated on price changes
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };

      this.positions.set(positionId, position);

      logger.info(`✅ Liquidity added successfully: ${positionId}`, {
        amount0: result.amount0,
        amount1: result.amount1,
        liquidity: result.liquidity
      });

      return positionId;

    } catch (error) {
      logger.error('Failed to add liquidity by price:', error);
      throw error;
    }
  }

  /**
   * Add liquidity using tick range (for advanced users)
   */
  async addLiquidityByTicks(
    token0: string,
    token1: string,
    fee: number,
    tickLower: number,
    tickUpper: number,
    amount0Desired: string,
    amount1Desired: string,
    slippageTolerance?: number
  ): Promise<string> {
    try {
      logger.info('Adding liquidity by tick range', {
        token0,
        token1,
        fee,
        tickLower,
        tickUpper
      });

      const positionId = await this.generatePositionId(token0, token1, fee);
      const slippage = slippageTolerance || this.defaultSlippage;
      const slippageBN = new BigNumber(slippage);
      const oneMinusSlippage = new BigNumber(1).minus(slippageBN);
      const amount0Min = new BigNumber(amount0Desired).times(oneMinusSlippage).toString();
      const amount1Min = new BigNumber(amount1Desired).times(oneMinusSlippage).toString();

      const result = await this.gswap.liquidityPositions.addLiquidityByTicks({
        walletAddress: this.walletAddress,
        positionId,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min
      });

      // Convert ticks to prices for display
      const minPrice = this.tickToPrice(tickLower);
      const maxPrice = this.tickToPrice(tickUpper);

      const position: LiquidityPosition = {
        id: positionId,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        minPrice,
        maxPrice,
        liquidity: result.liquidity || '0',
        amount0: result.amount0 || amount0Desired,
        amount1: result.amount1 || amount1Desired,
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };

      this.positions.set(positionId, position);

      logger.info(`✅ Liquidity added by ticks: ${positionId}`, {
        tickLower,
        tickUpper,
        liquidity: result.liquidity
      });

      return positionId;

    } catch (error) {
      logger.error('Failed to add liquidity by ticks:', error);
      throw error;
    }
  }

  /**
   * Remove liquidity from a position
   */
  async removeLiquidity(params: RemoveLiquidityParams): Promise<{ amount0: string; amount1: string }> {
    try {
      const position = this.positions.get(params.positionId);
      if (!position) {
        throw new Error(`Position not found: ${params.positionId}`);
      }

      logger.info('Removing liquidity', {
        positionId: params.positionId,
        liquidity: params.liquidity
      });

      const slippage = params.slippageTolerance || this.defaultSlippage;

      // Estimate gas cost for removal
      const gasEstimate = await this.estimateOperationGas('removeLiquidity', 'medium');
      logger.debug('Gas estimate for remove liquidity', {
        gasLimit: gasEstimate.gasLimit,
        totalCostUSD: gasEstimate.totalCostUSD
      });

      const result = await RetryHelper.withRetry(
        async () => {
          return await this.gswap.liquidityPositions.removeLiquidity({
            walletAddress: this.walletAddress,
            positionId: params.positionId,
            token0: position.token0,
            token1: position.token1,
            fee: position.fee,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            amount: params.liquidity,
            amount0Min: new BigNumber(position.amount0).times(new BigNumber(1).minus(new BigNumber(slippage))).toString(),
            amount1Min: new BigNumber(position.amount1).times(new BigNumber(1).minus(new BigNumber(slippage))).toString()
          });
        },
        RetryHelper.getApiRetryOptions('standard'),
        'removeLiquidity'
      );

      // Update position liquidity
      const newLiquidity = new BigNumber(position.liquidity).minus(params.liquidity).toString();
      position.liquidity = newLiquidity;
      position.lastUpdate = Date.now();

      // Remove position if fully withdrawn
      if (new BigNumber(newLiquidity).isZero()) {
        this.positions.delete(params.positionId);
        logger.info(`Position fully withdrawn and removed: ${params.positionId}`);
      } else {
        this.positions.set(params.positionId, position);
      }

      logger.info(`✅ Liquidity removed: ${params.positionId}`, {
        amount0: result.amount0,
        amount1: result.amount1,
        remainingLiquidity: newLiquidity
      });

      return {
        amount0: result.amount0 || '0',
        amount1: result.amount1 || '0'
      };

    } catch (error) {
      logger.error('Failed to remove liquidity:', error);
      throw error;
    }
  }

  /**
   * Collect accumulated fees from a position
   */
  async collectFees(params: CollectFeesParams): Promise<{ amount0: string; amount1: string }> {
    try {
      const position = this.positions.get(params.positionId);
      if (!position) {
        throw new Error(`Position not found: ${params.positionId}`);
      }

      logger.info('Collecting fees', {
        positionId: params.positionId,
        uncollectedFees0: position.uncollectedFees0,
        uncollectedFees1: position.uncollectedFees1
      });

      // Estimate gas cost for fee collection
      const gasEstimate = await this.estimateOperationGas('collectFees', 'simple');
      logger.debug('Gas estimate for collect fees', {
        gasLimit: gasEstimate.gasLimit,
        totalCostUSD: gasEstimate.totalCostUSD
      });

      const result = await RetryHelper.withRetry(
        async () => {
          return await this.gswap.liquidityPositions.collectPositionFees({
            walletAddress: this.walletAddress,
            positionId: params.positionId,
            token0: position.token0,
            token1: position.token1,
            fee: position.fee,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            amount0Requested: params.amount0Max || position.uncollectedFees0,
            amount1Requested: params.amount1Max || position.uncollectedFees1
          });
        },
        RetryHelper.getApiRetryOptions('fast'),
        'collectPositionFees'
      );

      // Reset collected fees
      position.uncollectedFees0 = '0';
      position.uncollectedFees1 = '0';
      position.lastUpdate = Date.now();
      this.positions.set(params.positionId, position);

      logger.info(`✅ Fees collected: ${params.positionId}`, {
        amount0: result.amount0,
        amount1: result.amount1
      });

      return {
        amount0: result.amount0 || '0',
        amount1: result.amount1 || '0'
      };

    } catch (error) {
      logger.error('Failed to collect fees:', error);
      throw error;
    }
  }

  /**
   * Rebalance a position to a new price range
   */
  async rebalancePosition(params: RebalanceParams): Promise<string> {
    try {
      const position = this.positions.get(params.positionId);
      if (!position) {
        throw new Error(`Position not found: ${params.positionId}`);
      }

      logger.info('Rebalancing position', {
        positionId: params.positionId,
        currentRange: `${position.minPrice} - ${position.maxPrice}`,
        newRange: `${params.newMinPrice} - ${params.newMaxPrice}`
      });

      // Step 1: Collect any uncollected fees
      if (new BigNumber(position.uncollectedFees0).gt(0) || new BigNumber(position.uncollectedFees1).gt(0)) {
        await this.collectFees({ positionId: params.positionId });
      }

      // Step 2: Remove all liquidity
      const removal = await this.removeLiquidity({
        positionId: params.positionId,
        liquidity: position.liquidity,
        slippageTolerance: params.slippageTolerance
      });

      // Step 3: Add liquidity at new price range
      const newPositionId = await this.addLiquidityByPrice({
        token0: position.token0,
        token1: position.token1,
        fee: position.fee,
        minPrice: params.newMinPrice,
        maxPrice: params.newMaxPrice,
        amount0Desired: removal.amount0,
        amount1Desired: removal.amount1,
        slippageTolerance: params.slippageTolerance
      });

      logger.info(`✅ Position rebalanced: ${params.positionId} → ${newPositionId}`);

      return newPositionId;

    } catch (error) {
      logger.error('Failed to rebalance position:', error);
      throw error;
    }
  }

  /**
   * Get all positions for the wallet
   */
  async refreshPositions(): Promise<LiquidityPosition[]> {
    try {
      logger.debug('Refreshing positions from blockchain...');

      const result = await RetryHelper.withRetry(
        async () => {
          return await this.gswap.liquidityPositions.getUserPositions(this.walletAddress, 1, 100);
        },
        RetryHelper.getApiRetryOptions('standard'),
        'getUserPositions'
      );

      if (result?.positions) {
        // Update local position cache with blockchain data
        for (const blockchainPosition of result.positions) {
          // CRITICAL FIX: Use blockchain position ID, not generate new one
          const positionId = blockchainPosition.id || blockchainPosition.positionId ||
            `${blockchainPosition.token0}-${blockchainPosition.token1}-${blockchainPosition.fee}-${blockchainPosition.tickLower}-${blockchainPosition.tickUpper}`;

          // Look for existing position by blockchain ID or create mapping
          let localPosition = this.positions.get(positionId);

          // If not found by ID, try to find by token pair and range
          if (!localPosition) {
            for (const [localId, position] of this.positions.entries()) {
              if (position.token0 === blockchainPosition.token0 &&
                  position.token1 === blockchainPosition.token1 &&
                  position.fee === blockchainPosition.fee &&
                  position.tickLower === blockchainPosition.tickLower &&
                  position.tickUpper === blockchainPosition.tickUpper) {
                localPosition = position;
                // Update the position with correct blockchain ID
                this.positions.delete(localId);
                localPosition.id = positionId;
                break;
              }
            }
          }

          if (localPosition) {
            // Update with fresh blockchain data
            localPosition.liquidity = blockchainPosition.liquidity;
            localPosition.uncollectedFees0 = blockchainPosition.tokensOwed0 || '0';
            localPosition.uncollectedFees1 = blockchainPosition.tokensOwed1 || '0';
            localPosition.lastUpdate = Date.now();
            this.positions.set(positionId, localPosition);
          } else {
            // Create new position from blockchain data
            const newPosition: LiquidityPosition = {
              id: positionId,
              token0: blockchainPosition.token0,
              token1: blockchainPosition.token1,
              fee: blockchainPosition.fee,
              tickLower: blockchainPosition.tickLower,
              tickUpper: blockchainPosition.tickUpper,
              minPrice: this.tickToPrice(blockchainPosition.tickLower),
              maxPrice: this.tickToPrice(blockchainPosition.tickUpper),
              liquidity: blockchainPosition.liquidity,
              amount0: '0', // Will be calculated when needed
              amount1: '0', // Will be calculated when needed
              uncollectedFees0: blockchainPosition.tokensOwed0 || '0',
              uncollectedFees1: blockchainPosition.tokensOwed1 || '0',
              inRange: true, // Will be updated based on current price
              createdAt: Date.now(),
              lastUpdate: Date.now()
            };
            this.positions.set(positionId, newPosition);
          }
        }
      }

      const positions = Array.from(this.positions.values());
      logger.debug(`Refreshed ${positions.length} positions`);

      return positions;

    } catch (error) {
      logger.error('Failed to refresh positions:', error);
      return Array.from(this.positions.values());
    }
  }

  /**
   * Get position analytics
   */
  async getPositionAnalytics(positionId: string): Promise<PositionAnalytics> {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error(`Position not found: ${positionId}`);
    }

    try {
      // Get current pool price
      const poolData = await this.gswap.pools.getPoolData(position.token0, position.token1, position.fee);
      const currentPrice = poolData ? this.gswap.pools.calculateSpotPrice(
        position.token0,
        position.token1,
        poolData.sqrtPrice
      ) : new BigNumber(0);

      // Check if position is in range
      const inRange = currentPrice.gte(position.minPrice) && currentPrice.lte(position.maxPrice);

      // Calculate basic analytics (simplified for MVP)
      const analytics: PositionAnalytics = {
        totalValueUSD: 0, // Would need USD prices
        impermanentLoss: 0, // Would need historical price data
        feesEarnedUSD: 0, // Would need to convert fees to USD
        apr: 0, // Would need time-weighted calculations
        utilization: inRange ? 1 : 0, // Simplified: 100% if in range, 0% if not
        timeInRange: inRange ? 1 : 0 // Would need historical tracking
      };

      return analytics;

    } catch (error) {
      logger.error('Failed to calculate position analytics:', error);
      return {
        totalValueUSD: 0,
        impermanentLoss: 0,
        feesEarnedUSD: 0,
        apr: 0,
        utilization: 0,
        timeInRange: 0
      };
    }
  }

  /**
   * Get all managed positions
   */
  async getAllPositions(): Promise<LiquidityPosition[]> {
    return Array.from(this.positions.values());
  }

  /**
   * Get specific position by ID
   */
  getPosition(positionId: string): LiquidityPosition | null {
    return this.positions.get(positionId) || null;
  }

  /**
   * Calculate optimal position size for capital efficiency
   */
  calculateOptimalPositionSize(
    tokenAmount: string,
    spotPrice: number,
    lowerPrice: number,
    upperPrice: number,
    tokenDecimals: number = 18,
    otherTokenDecimals: number = 18
  ): { amount0: string; amount1: string; liquidity: string } {
    try {
      const result = this.gswap.liquidityPositions.calculateOptimalPositionSize(
        tokenAmount,
        spotPrice,
        lowerPrice,
        upperPrice,
        tokenDecimals,
        otherTokenDecimals
      );

      return {
        amount0: result.amount0 || '0',
        amount1: result.amount1 || '0',
        liquidity: result.liquidity || '0'
      };

    } catch (error) {
      logger.error('Failed to calculate optimal position size:', error);
      return { amount0: '0', amount1: '0', liquidity: '0' };
    }
  }

  /**
   * Validate add liquidity parameters
   */
  private validateAddLiquidityParams(params: AddLiquidityParams): void {
    // Enhanced token validation using InputValidator
    const token0Validation = InputValidator.validateToken(params.token0);
    if (!token0Validation.isValid) {
      throw new Error(`Invalid token0: ${token0Validation.errors.join(', ')}`);
    }

    const token1Validation = InputValidator.validateToken(params.token1);
    if (!token1Validation.isValid) {
      throw new Error(`Invalid token1: ${token1Validation.errors.join(', ')}`);
    }

    // Check for same tokens (case-insensitive)
    if (params.token0.toLowerCase() === params.token1.toLowerCase()) {
      throw new Error('Token0 and token1 must be different');
    }

    // Validate price range
    if (params.minPrice < 0 || params.maxPrice < 0) {
      throw new Error('Invalid price range: prices must be positive');
    }

    if (params.minPrice >= params.maxPrice) {
      throw new Error('Invalid price range: minPrice must be less than maxPrice');
    }

    // Enhanced amount validation using InputValidator
    const amount0Validation = InputValidator.validateTradingAmount(params.amount0Desired);
    if (!amount0Validation.isValid) {
      throw new Error(`Invalid amount0Desired: ${amount0Validation.errors.join(', ')}`);
    }

    const amount1Validation = InputValidator.validateTradingAmount(params.amount1Desired);
    if (!amount1Validation.isValid) {
      throw new Error(`Invalid amount1Desired: ${amount1Validation.errors.join(', ')}`);
    }

    // At least one amount must be greater than zero
    const amount0 = new BigNumber(params.amount0Desired);
    const amount1 = new BigNumber(params.amount1Desired);

    if (amount0.lte(0) && amount1.lte(0)) {
      throw new Error('At least one amount must be greater than zero');
    }

    // Enhanced fee tier validation using InputValidator
    const feeValidation = InputValidator.validateFee(params.fee);
    if (!feeValidation.isValid) {
      throw new Error(`Invalid fee tier: ${feeValidation.errors.join(', ')}`);
    }

    // Enhanced slippage validation if provided
    if (params.slippageTolerance !== undefined) {
      const slippageValidation = InputValidator.validateSlippage(params.slippageTolerance);
      if (!slippageValidation.isValid) {
        throw new Error(`Invalid slippage tolerance: ${slippageValidation.errors.join(', ')}`);
      }

      // Log warnings for high slippage
      if (slippageValidation.warnings.length > 0) {
        logger.warn('Slippage validation warnings:', slippageValidation.warnings);
      }
    }

    // Log any token validation warnings
    if (token0Validation.warnings.length > 0) {
      logger.warn('Token0 validation warnings:', token0Validation.warnings);
    }
    if (token1Validation.warnings.length > 0) {
      logger.warn('Token1 validation warnings:', token1Validation.warnings);
    }
  }

  /**
   * Generate unique position ID
   */
  private async generatePositionId(token0: string, token1: string, fee: number): Promise<string> {
    this.instanceCounter++;
    // Use async crypto for non-blocking randomness
    const randomBytesBuffer = await randomBytesAsync(4);
    const randomHex = randomBytesBuffer.toString('hex');
    const timestamp = Date.now().toString(36);
    const counter = this.instanceCounter.toString(36);
    return `lp_${randomHex}${timestamp}${counter}`.substring(0, 16);
  }

  /**
   * Get tick spacing for fee tier
   */
  private getTickSpacing(fee: number): number {
    switch (fee) {
      case 500: return 10;   // 0.05%
      case 3000: return 60;  // 0.30%
      case 10000: return 200; // 1.00%
      default: return 60;    // Default to 0.30% spacing
    }
  }

  /**
   * Estimate gas for liquidity operations
   */
  private async estimateOperationGas(
    operation: 'addLiquidity' | 'removeLiquidity' | 'collectFees' | 'rebalance',
    complexity: 'simple' | 'medium' | 'complex' = 'medium'
  ) {
    const gasOptions: GasEstimationOptions = {
      operation,
      complexity,
      urgency: 'normal',
      networkConditions: {
        congestion: 'medium'
      }
    };

    return await GasEstimator.estimateGas(gasOptions);
  }

  /**
   * Convert tick to price (simplified calculation)
   */
  private tickToPrice(tick: number): number {
    return Math.pow(1.0001, tick);
  }

  /**
   * Convert price to tick (simplified calculation)
   */
  private priceToTick(price: number): number {
    // CRITICAL FIX: Add zero/negative price validation
    if (price <= 0) {
      throw new Error(`Price must be positive, got: ${price}`);
    }
    if (!isFinite(price)) {
      throw new Error(`Price must be finite, got: ${price}`);
    }
    return Math.round(Math.log(price) / Math.log(1.0001));
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalPositions: number;
    activePositions: number;
    totalLiquidityUSD: number;
    totalFeesCollected: number;
    avgAPR: number;
  } {
    const positions = Array.from(this.positions.values());
    const activePositions = positions.filter(p => new BigNumber(p.liquidity).gt(0));

    return {
      totalPositions: positions.length,
      activePositions: activePositions.length,
      totalLiquidityUSD: 0, // Would need USD conversion
      totalFeesCollected: 0, // Would need to track historically
      avgAPR: 0 // Would need time-weighted calculations
    };
  }
}