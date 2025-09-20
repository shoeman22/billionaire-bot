/**
 * Liquidity Manager
 * Manages liquidity positions for yield farming (market making not supported by SDK v0.0.7)
 */

import { GSwap } from '@gala-chain/gswap-sdk';
import { logger } from '../../utils/logger';
import { safeParseFloat } from '../../utils/safe-parse';
import {
  CollectFeesPayloadRequest,
  createTokenClassKey,
  isSuccessResponse,
  ErrorResponse
} from '../../types/galaswap';

export interface LiquidityPosition {
  id: string;
  poolAddress: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  createdAt: number;
  lastUpdated: number;
}

export interface AddLiquidityParams {
  token0: string;
  token1: string;
  fee: number;
  amount0: string;
  amount1: string;
  tickLower: number;
  tickUpper: number;
  userAddress: string;
}

export interface RemoveLiquidityParams {
  positionId: string;
  liquidity: string; // Amount of liquidity to remove
  userAddress: string;
}

export class LiquidityManager {
  private gswap: GSwap;
  private positions: Map<string, LiquidityPosition> = new Map();

  constructor(gswap: GSwap) {
    this.gswap = gswap;
    this.validateSDKCapabilities();
    logger.info('Liquidity Manager initialized');
  }

  /**
   * Validate SDK capabilities for liquidity operations
   */
  private validateSDKCapabilities(): void {
    logger.warn('SDK v0.0.7 Liquidity Limitations Detected:');
    logger.warn('- Add liquidity operations not available');
    logger.warn('- Remove liquidity operations not available');
    logger.warn('- Fee collection operations not available');
    logger.warn('- Position management limited to read-only');
    logger.info('Available operations: Pool data queries, Position queries');
  }

  /**
   * Add liquidity to a pool
   */
  async addLiquidity(params: AddLiquidityParams): Promise<{
    success: boolean;
    positionId?: string;
    transactionId?: string;
    error?: string;
  }> {
    try {
      logger.info(`Adding liquidity: ${params.amount0} ${params.token0} + ${params.amount1} ${params.token1}`);

      // Step 1: Validate parameters
      const validation = await this.validateLiquidityParams(params);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Step 2: Get current pool state
      const pool = await this.gswap.pools.getPoolData(params.token0, params.token1, params.fee);
      if (!pool) {
        logger.error(`Pool not found: ${params.token0}/${params.token1}/${params.fee}`);
        return {
          success: false,
          error: `Pool not found for ${params.token0}/${params.token1} with ${params.fee} fee tier`,
        };
      }

      if (!pool.liquidity || pool.liquidity.toString() === '0') {
        logger.error(`Pool has no liquidity: ${params.token0}/${params.token1}/${params.fee}`);
        return {
          success: false,
          error: 'Pool has insufficient liquidity for position creation',
        };
      }

      // Step 3: Calculate optimal amounts
      const optimalAmounts = await this.calculateOptimalAmounts(params, pool);

      // Step 4: Prepare liquidity transaction
      const liquidityPayload = await this.prepareLiquidityPayload({
        ...params,
        amount0: optimalAmounts.amount0,
        amount1: optimalAmounts.amount1,
      });

      // Step 5: Execute transaction
      const result = await this.executeLiquidityTransaction(liquidityPayload, 'add');

      if (result.success && result.positionId) {
        // Store position locally
        const position: LiquidityPosition = {
          id: result.positionId,
          poolAddress: `${params.token0}/${params.token1}/${params.fee}`, // Pool identifier
          token0: params.token0,
          token1: params.token1,
          fee: params.fee,
          tickLower: params.tickLower,
          tickUpper: params.tickUpper,
          liquidity: '0', // Will be updated after transaction confirmation
          amount0: optimalAmounts.amount0,
          amount1: optimalAmounts.amount1,
          createdAt: Date.now(),
          lastUpdated: Date.now(),
        };

        this.positions.set(result.positionId, position);
        logger.info(`Liquidity position created: ${result.positionId}`);
      }

      return result;

    } catch (error) {
      logger.error('Error adding liquidity:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Remove liquidity from a position
   */
  async removeLiquidity(params: RemoveLiquidityParams): Promise<{
    success: boolean;
    transactionId?: string;
    amount0?: string;
    amount1?: string;
    error?: string;
  }> {
    try {
      logger.info(`Removing liquidity from position: ${params.positionId}`);

      // Step 1: Validate position exists
      const position = this.positions.get(params.positionId);
      if (!position) {
        return {
          success: false,
          error: 'Position not found',
        };
      }

      // Step 2: Calculate amounts to be received
      const amounts = await this.calculateRemovalAmounts(position, params.liquidity);

      // Step 3: Prepare removal transaction
      const removalPayload = await this.prepareRemovalPayload(params);

      // Step 4: Execute transaction
      const result = await this.executeLiquidityTransaction(removalPayload, 'remove');

      if (result.success) {
        // Update position or remove if fully closed
        if (params.liquidity === position.liquidity) {
          this.positions.delete(params.positionId);
          logger.info(`Position fully closed: ${params.positionId}`);
        } else {
          // Update remaining liquidity
          position.liquidity = (safeParseFloat(position.liquidity, 0) - safeParseFloat(params.liquidity, 0)).toString();
          position.lastUpdated = Date.now();
          this.positions.set(params.positionId, position);
        }

        return {
          ...result,
          amount0: amounts.amount0,
          amount1: amounts.amount1,
        };
      }

      return result;

    } catch (error) {
      logger.error('Error removing liquidity:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Collect fees from a position
   */
  async collectFees(positionId: string, userAddress: string): Promise<{
    success: boolean;
    transactionId?: string;
    fees0?: string;
    fees1?: string;
    error?: string;
  }> {
    try {
      logger.info(`Collecting fees from position: ${positionId}`);

      const position = this.positions.get(positionId);
      if (!position) {
        return {
          success: false,
          error: 'Position not found',
        };
      }

      // Prepare collect fees payload
      const collectRequest: CollectFeesPayloadRequest = {
        token0: createTokenClassKey(position.token0),
        token1: createTokenClassKey(position.token1),
        fee: position.fee,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        amount0Requested: '340282366920938463463374607431768211455', // Max uint128
        amount1Requested: '340282366920938463463374607431768211455'
      };

      // Generate collection payload
      // SDK doesn't have generateCollectFeesPayload, will use positions.collectFees
      const payloadResponse = {
        error: false,
        status: 200,
        data: {
          payload: collectRequest
        },
        message: 'Success'
      };

      if (!isSuccessResponse(payloadResponse)) {
        return {
          success: false,
          error: `Failed to generate collect payload: ${(payloadResponse as ErrorResponse).message}`,
        };
      }

      // Execute fee collection using SDK positions API
      try {
        // Get actual position data to check for accumulated fees
        const positionData = await this.gswap.positions.getPosition(
          userAddress,
          {
            token0ClassKey: position.token0,
            token1ClassKey: position.token1,
            fee: position.fee,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper
          }
        );

        if (!positionData) {
          return {
            success: false,
            error: 'Position not found on-chain',
          };
        }

        // SDK doesn't currently support direct fee collection
        // This would require removal and re-addition of position
        // For production safety, fail explicitly rather than mock
        return {
          success: false,
          error: 'Fee collection not yet implemented in SDK - requires position management upgrade',
        };
      } catch (error) {
        logger.error('Error during fee collection:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Fee collection failed',
        };
      }

      // This section is unreachable due to early return above
      // Keeping for reference in case SDK upgrade adds fee collection
      return {
        success: false,
        error: 'Fee collection path should not be reached',
      };

    } catch (error) {
      logger.error('Error collecting fees:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all positions for a user
   */
  async getPositions(userAddress: string): Promise<LiquidityPosition[]> {
    try {
      // Sync with on-chain positions
      await this.syncPositions(userAddress);

      return Array.from(this.positions.values());

    } catch (error) {
      logger.error('Error getting positions:', error);
      return [];
    }
  }

  /**
   * Get position details
   */
  async getPosition(positionId: string): Promise<LiquidityPosition | null> {
    try {
      const position = this.positions.get(positionId);
      if (!position) {
        return null;
      }

      // Update position with latest data (will use SDK wallet address)
      await this.updatePosition(position);

      return position;

    } catch (error) {
      logger.error('Error getting position:', error);
      return null;
    }
  }

  /**
   * Validate liquidity parameters
   */
  private async validateLiquidityParams(params: AddLiquidityParams): Promise<{
    valid: boolean;
    error?: string;
  }> {
    // Check token addresses
    if (!params.token0 || !params.token1) {
      return { valid: false, error: 'Token addresses required' };
    }

    // Validate token format (should be collection$category$type$additionalKey)
    const tokenRegex = /^[^$]+\$[^$]+\$[^$]+\$[^$]*$/;
    if (!tokenRegex.test(params.token0)) {
      return { valid: false, error: `Invalid token0 format: ${params.token0}. Expected: collection$category$type$additionalKey` };
    }
    if (!tokenRegex.test(params.token1)) {
      return { valid: false, error: `Invalid token1 format: ${params.token1}. Expected: collection$category$type$additionalKey` };
    }

    // Check that tokens are different
    if (params.token0 === params.token1) {
      return { valid: false, error: 'Token0 and token1 must be different' };
    }

    // Check amounts
    const amount0 = safeParseFloat(params.amount0, 0);
    const amount1 = safeParseFloat(params.amount1, 0);
    if (amount0 <= 0 || amount1 <= 0) {
      return { valid: false, error: 'Amounts must be positive' };
    }

    // Check for reasonable amounts (not too large)
    if (amount0 > 1e18 || amount1 > 1e18) {
      return { valid: false, error: 'Amounts exceed maximum allowed' };
    }

    // Check tick range
    if (params.tickLower >= params.tickUpper) {
      return { valid: false, error: 'Invalid tick range: tickLower must be less than tickUpper' };
    }

    // Check tick boundaries (reasonable range for Uniswap v3 style)
    if (params.tickLower < -887272 || params.tickUpper > 887272) {
      return { valid: false, error: 'Tick range exceeds allowed boundaries' };
    }

    // Check fee tier validity
    const validFeeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
    if (!validFeeTiers.includes(params.fee)) {
      return { valid: false, error: `Invalid fee tier: ${params.fee}. Valid options: ${validFeeTiers.join(', ')}` };
    }

    // Check user address
    if (!params.userAddress || params.userAddress.length === 0) {
      return { valid: false, error: 'User address required' };
    }

    return { valid: true };
  }

  /**
   * Calculate optimal amounts for liquidity provision
   */
  private async calculateOptimalAmounts(
    params: AddLiquidityParams,
    poolData: { sqrtPrice?: { toString(): string }; liquidity?: { toString(): string } }
  ): Promise<{ amount0: string; amount1: string }> {
    try {
      // Calculate optimal amounts using pool ratio
      try {
        const currentPrice = poolData.sqrtPrice?.toString();
        if (!currentPrice) {
          throw new Error('Pool price not available');
        }

        // Calculate price from sqrtPrice (sqrtPrice^2 = price)
        const price = Math.pow(Number(currentPrice), 2) / Math.pow(2, 192); // Adjust for Q64.96 format

        // Calculate optimal ratio based on current pool price
        const amount0Desired = safeParseFloat(params.amount0, 0);
        const amount1Desired = safeParseFloat(params.amount1, 0);

        // Determine which amount is limiting and adjust the other
        const ratio = amount1Desired / amount0Desired;
        const poolRatio = price;

        let optimalAmount0: string, optimalAmount1: string;

        if (ratio > poolRatio) {
          // amount1 is excessive, reduce it
          optimalAmount0 = params.amount0;
          optimalAmount1 = (amount0Desired * poolRatio).toString();
        } else {
          // amount0 is excessive, reduce it
          optimalAmount1 = params.amount1;
          optimalAmount0 = (amount1Desired / poolRatio).toString();
        }

        logger.info(`Calculated optimal amounts: ${optimalAmount0} ${params.token0} + ${optimalAmount1} ${params.token1}`);
        return {
          amount0: optimalAmount0,
          amount1: optimalAmount1
        };
      } catch (error) {
        logger.warn('Error calculating pool-based amounts, using original:', error);
        return {
          amount0: params.amount0,
          amount1: params.amount1
        };
      }

      // This code path is unreachable due to earlier return
      return {
        amount0: params.amount0,
        amount1: params.amount1,
      };
    } catch (error) {
      logger.warn('Error calculating optimal amounts:', error);
      return {
        amount0: params.amount0,
        amount1: params.amount1,
      };
    }
  }

  /**
   * Calculate amounts to be received when removing liquidity
   */
  private async calculateRemovalAmounts(
    position: LiquidityPosition,
    liquidityToRemove: string
  ): Promise<{ amount0: string; amount1: string }> {
    try {
      // Calculate removal amounts using position's liquidity ratio
      try {
        // Get current pool state for accurate calculations
        const poolData = await this.gswap.pools.getPoolData(position.token0, position.token1, position.fee);
        if (!poolData) {
          throw new Error('Pool data not available for removal calculation');
        }

        const positionLiquidity = safeParseFloat(position.liquidity, 0);
        const liquidityToRemoveNum = safeParseFloat(liquidityToRemove, 0);

        if (positionLiquidity <= 0) {
          throw new Error('Position has no liquidity');
        }

        if (liquidityToRemoveNum > positionLiquidity) {
          throw new Error('Cannot remove more liquidity than position contains');
        }

        const proportion = liquidityToRemoveNum / positionLiquidity;

        // Use current pool price to calculate token amounts
        // Calculate estimated amounts based on liquidity proportion
        // This is an approximation - actual amounts depend on tick range and current price
        const estimatedAmount0 = (safeParseFloat(position.amount0, 0) * proportion);
        const estimatedAmount1 = (safeParseFloat(position.amount1, 0) * proportion);

        logger.info(`Calculated removal amounts: ${estimatedAmount0} ${position.token0} + ${estimatedAmount1} ${position.token1}`);
        return {
          amount0: estimatedAmount0.toString(),
          amount1: estimatedAmount1.toString()
        };
      } catch (error) {
        logger.warn('Error calculating pool-based removal, using proportional fallback:', error);
        const positionLiquidity = safeParseFloat(position.liquidity, 0);
        const proportion = positionLiquidity > 0 ? safeParseFloat(liquidityToRemove, 0) / positionLiquidity : 0;
        return {
          amount0: (safeParseFloat(position.amount0, 0) * proportion).toString(),
          amount1: (safeParseFloat(position.amount1, 0) * proportion).toString()
        };
      }

      // This code path is unreachable due to earlier return
      return {
        amount0: '0',
        amount1: '0',
      };
    } catch (error) {
      logger.warn('Error calculating removal amounts:', error);
      const positionLiquidity = safeParseFloat(position.liquidity, 0);
      const proportion = positionLiquidity > 0 ? safeParseFloat(liquidityToRemove, 0) / positionLiquidity : 0;
      return {
        amount0: (safeParseFloat(position.amount0, 0) * proportion).toString(),
        amount1: (safeParseFloat(position.amount1, 0) * proportion).toString(),
      };
    }
  }

  /**
   * Prepare liquidity transaction payload
   */
  private async prepareLiquidityPayload(_params: AddLiquidityParams): Promise<never> {
    try {
      // This method validates parameters but cannot create payloads in SDK v0.0.7
      logger.debug('Liquidity payload preparation requested but not supported');

      // Validate that SDK supports liquidity operations before preparing payload
      // Current SDK v0.0.7 does not have liquidity addition methods
      logger.error('SDK liquidity operations not available - cannot prepare payload');
      throw new Error('Liquidity operations require SDK upgrade from v0.0.7');

      // This code path is unreachable due to error thrown above
      throw new Error('Add liquidity payload generation not implemented');

    } catch (error) {
      logger.error('Error preparing liquidity payload:', error);
      throw error;
    }
  }

  /**
   * Prepare liquidity removal payload
   */
  private async prepareRemovalPayload(params: RemoveLiquidityParams): Promise<never> {
    try {
      const targetPosition = this.positions.get(params.positionId);
      if (!targetPosition) {
        throw new Error('Position not found');
      }
      // This method validates parameters but cannot create payloads in SDK v0.0.7
      logger.debug('Liquidity removal payload preparation requested but not supported');

      // Validate that SDK supports liquidity operations before preparing payload
      // Current SDK v0.0.7 does not have liquidity removal methods
      logger.error('SDK liquidity operations not available - cannot prepare removal payload');
      throw new Error('Liquidity operations require SDK upgrade from v0.0.7');

      // This code path is unreachable due to error thrown above
      throw new Error('Remove liquidity payload generation not implemented');

    } catch (error) {
      logger.error('Error preparing removal payload:', error);
      throw error;
    }
  }

  /**
   * Execute liquidity transaction
   */
  private async executeLiquidityTransaction(
    _payload: unknown,
    action: 'add' | 'remove'
  ): Promise<{
    success: boolean;
    positionId?: string;
    transactionId?: string;
    error?: string;
  }> {
    try {
      logger.info(`Executing ${action} liquidity transaction...`);

      // Execute using SDK
      let bundleResponse;
      if (action === 'add') {
        // SDK does not currently support direct liquidity addition
        // This is a critical missing feature for production DeFi operations
        // Instead of creating fake transactions, fail safely
        return {
          success: false,
          error: 'Add liquidity not implemented in SDK v0.0.7 - upgrade required for production deployment',
        };
      } else {
        // SDK does not currently support direct liquidity removal
        // This is a critical missing feature for production DeFi operations
        // Instead of creating fake transactions, fail safely
        return {
          success: false,
          error: 'Remove liquidity not implemented in SDK v0.0.7 - upgrade required for production deployment',
        };
      }

      if (!bundleResponse || bundleResponse.error) {
        logger.error(`${action} liquidity bundle execution failed:`, bundleResponse?.message || 'Unknown error');
        return {
          success: false,
          error: `Bundle execution failed: ${bundleResponse?.message || 'Unknown error'}`,
        };
      }

      const transactionId = bundleResponse.data.transactionId;

      logger.info(`${action} liquidity transaction submitted successfully`, {
        transactionId,
        bundleData: bundleResponse.data
      });

      return {
        success: true,
        transactionId,
        positionId: action === 'add' ? `position-${Date.now()}` : undefined, // Position ID generated since payload is not accessible
      };

    } catch (error) {
      logger.error(`Error executing ${action} liquidity transaction:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Transaction failed',
      };
    }
  }

  /**
   * Sync positions with on-chain data
   */
  private async syncPositions(userAddress: string): Promise<void> {
    try {
      const response = await this.gswap.positions.getUserPositions(userAddress);

      if (response?.positions) {
        // Clear existing positions and update with fresh data
        this.positions.clear();

        // Update local positions with on-chain data
        for (const position of response.positions) {
          const localPosition: LiquidityPosition = {
            id: `${position.tickLower}-${position.tickUpper}-${position.fee}`, // Generate ID from position data
            poolAddress: `${position.token0ClassKey?.collection || 'unknown'}/${position.token1ClassKey?.collection || 'unknown'}/${position.fee}`,
            token0: position.token0ClassKey ? `${position.token0ClassKey.collection}$${position.token0ClassKey.category}$${position.token0ClassKey.type}$${position.token0ClassKey.additionalKey}` : '',
            token1: position.token1ClassKey ? `${position.token1ClassKey.collection}$${position.token1ClassKey.category}$${position.token1ClassKey.type}$${position.token1ClassKey.additionalKey}` : '',
            fee: position.fee,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            liquidity: position.liquidity?.toString() || '0',
            amount0: '0', // Not available in SDK response
            amount1: '0', // Not available in SDK response
            createdAt: Date.now(),
            lastUpdated: Date.now(),
          };

          this.positions.set(localPosition.id, localPosition);
        }

        logger.debug(`Synced ${response.positions.length} positions for ${userAddress}`);
      } else {
        logger.warn(`Failed to sync positions: ${response ? 'Invalid response format' : 'No response received'}`);
      }
    } catch (error) {
      logger.error('Error syncing positions:', error);
    }
  }

  /**
   * Update a single position with latest data
   */
  private async updatePosition(position: LiquidityPosition, userAddress = 'configured'): Promise<void> {
    try {
      // Get user address from SDK configuration if not provided
      const walletAddress = userAddress;

      // Get fresh position data from GalaSwap API
      const positionResponse = await this.gswap.positions.getPosition(
        walletAddress,
        {
          token0ClassKey: position.token0,
          token1ClassKey: position.token1,
          fee: position.fee,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper
        }
      );

      if (positionResponse) {
        // Update position with fresh data
        position.liquidity = positionResponse.liquidity?.toString() || '0';
        position.amount0 = '0'; // Not available in SDK response
        position.amount1 = '0'; // Not available in SDK response
        position.lastUpdated = Date.now();

        logger.debug(`Updated position ${position.id}`);
      } else {
        logger.warn(`Failed to update position ${position.id}`);
      }

    } catch (error) {
      logger.error('Error updating position:', error);
    }
  }

  /**
   * Get position statistics
   */
  getStatistics(): {
    totalPositions: number;
    totalValueLocked: number;
    activeFeeTiers: number[];
    lastSyncTime: number;
  } {
    const positions = Array.from(this.positions.values());
    const feeTiers = [...new Set(positions.map(p => p.fee))];

    // Calculate approximate TVL (simplified)
    const totalValueLocked = positions.reduce((sum, position) => {
      return sum + safeParseFloat(position.amount0, 0) + safeParseFloat(position.amount1, 0);
    }, 0);

    return {
      totalPositions: positions.length,
      totalValueLocked,
      activeFeeTiers: feeTiers,
      lastSyncTime: Math.max(...positions.map(p => p.lastUpdated), 0)
    };
  }
}