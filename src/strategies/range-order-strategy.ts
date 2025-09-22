/**
 * Range Order Strategy
 * Implements "limit orders" using concentrated liquidity positions
 * Places liquidity in narrow ranges above/below current price for directional trades
 */

import { LiquidityManager, AddLiquidityParams } from '../services/liquidity-manager';
import { Position } from '../entities/Position';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { safeParseFloat } from '../utils/safe-parse';
import BigNumber from 'bignumber.js';

export interface RangeOrderConfig {
  token0: string;
  token1: string;
  fee: number;
  direction: 'buy' | 'sell'; // buy = provide liquidity above current price, sell = below
  amount: string;
  targetPrice: number;
  rangeWidth: number; // Percentage width of the range (e.g., 0.1 = 0.1%)
  autoExecute: boolean; // Auto-remove when target is hit
  slippageTolerance?: number;
  maxPriceAge?: number; // Maximum age of price data in ms
}

export interface RangeOrderStatus {
  orderId: string;
  status: 'active' | 'filled' | 'expired' | 'cancelled';
  config: RangeOrderConfig;
  position?: Position;
  createdAt: number;
  filledAt?: number;
  executionPrice?: number;
  amountFilled?: string;
  fees?: { amount0: string; amount1: string };
}

export interface RangeOrderResult {
  success: boolean;
  orderId?: string;
  positionId?: string;
  error?: string;
  estimatedFillPrice?: number;
  priceRange?: { min: number; max: number };
}

export class RangeOrderStrategy {
  private liquidityManager: LiquidityManager;
  private activeOrders: Map<string, RangeOrderStatus> = new Map();
  private readonly defaultRangeWidth = 0.05; // 0.05% default range
  private readonly maxOrders = 50; // Prevent memory leaks

  constructor(liquidityManager: LiquidityManager) {
    this.liquidityManager = liquidityManager;
    logger.info('RangeOrderStrategy initialized');
  }

  /**
   * Place a range order (limit order using liquidity)
   */
  async placeRangeOrder(config: RangeOrderConfig): Promise<RangeOrderResult> {
    try {
      logger.info('Placing range order', {
        direction: config.direction,
        targetPrice: config.targetPrice,
        amount: config.amount,
        token0: config.token0,
        token1: config.token1
      });

      // Validate configuration
      const validation = this.validateConfig(config);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Get current price for range calculation
      const currentPrice = await this.getCurrentPrice(config.token0, config.token1, config.fee);
      if (!currentPrice) {
        return { success: false, error: 'Unable to get current price' };
      }

      // Calculate optimal range for the order
      const priceRange = this.calculateOrderRange(currentPrice, config);

      // Validate that the range makes sense for the direction
      if (!this.validatePriceRange(currentPrice, priceRange, config.direction)) {
        return {
          success: false,
          error: `Invalid range for ${config.direction} order: price must be ${config.direction === 'buy' ? 'above' : 'below'} current price`
        };
      }

      // Calculate amounts based on direction
      const liquidityParams = this.calculateLiquidityAmounts(config, priceRange);

      // Generate unique order ID
      const orderId = this.generateOrderId(config);

      // Create the liquidity position
      const positionId = await this.liquidityManager.addLiquidityByPrice(liquidityParams);

      // Get the created position
      const position = await this.liquidityManager.getPosition(positionId);
      if (!position) {
        return { success: false, error: 'Failed to retrieve created position' };
      }

      // Store order status
      const orderStatus: RangeOrderStatus = {
        orderId,
        status: 'active',
        config,
        position,
        createdAt: Date.now()
      };

      this.activeOrders.set(orderId, orderStatus);

      // Start monitoring if auto-execute is enabled
      if (config.autoExecute) {
        this.startOrderMonitoring(orderId);
      }

      logger.info(`✅ Range order placed: ${orderId}`, {
        positionId,
        priceRange: `${priceRange.min.toFixed(6)} - ${priceRange.max.toFixed(6)}`,
        currentPrice: currentPrice.toFixed(6)
      });

      return {
        success: true,
        orderId,
        positionId,
        estimatedFillPrice: config.targetPrice,
        priceRange
      };

    } catch (error) {
      logger.error('Failed to place range order:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Cancel a range order
   */
  async cancelRangeOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const order = this.activeOrders.get(orderId);
      if (!order) {
        return { success: false, error: 'Order not found' };
      }

      if (order.status !== 'active') {
        return { success: false, error: `Cannot cancel order with status: ${order.status}` };
      }

      logger.info(`Cancelling range order: ${orderId}`);

      // Remove the liquidity position
      if (order.position) {
        await this.liquidityManager.removeLiquidity({
          positionId: order.position.id,
          liquidity: order.position.liquidity,
          slippageTolerance: order.config.slippageTolerance
        });
      }

      // Update order status
      order.status = 'cancelled';
      this.activeOrders.set(orderId, order);

      logger.info(`✅ Range order cancelled: ${orderId}`);

      return { success: true };

    } catch (error) {
      logger.error(`Failed to cancel range order ${orderId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get order status
   */
  getOrderStatus(orderId: string): RangeOrderStatus | null {
    return this.activeOrders.get(orderId) || null;
  }

  /**
   * Get all orders
   */
  getAllOrders(): RangeOrderStatus[] {
    return Array.from(this.activeOrders.values());
  }

  /**
   * Get orders by status
   */
  getOrdersByStatus(status: RangeOrderStatus['status']): RangeOrderStatus[] {
    return Array.from(this.activeOrders.values()).filter(order => order.status === status);
  }

  /**
   * Check and update order statuses
   */
  async updateOrderStatuses(): Promise<void> {
    const activeOrders = this.getOrdersByStatus('active');

    for (const order of activeOrders) {
      try {
        await this.checkOrderExecution(order);
      } catch (error) {
        logger.error(`Error checking order ${order.orderId}:`, error);
      }
    }
  }

  /**
   * Get range order statistics
   */
  getStatistics(): {
    totalOrders: number;
    activeOrders: number;
    filledOrders: number;
    cancelledOrders: number;
    totalVolume: number;
    successRate: number;
  } {
    const orders = this.getAllOrders();
    const filled = orders.filter(o => o.status === 'filled');
    const cancelled = orders.filter(o => o.status === 'cancelled');

    const totalVolume = orders.reduce((sum, order) => {
      return sum + parseFloat(order.config.amount);
    }, 0);

    const successRate = orders.length > 0 ? (filled.length / orders.length) * 100 : 0;

    return {
      totalOrders: orders.length,
      activeOrders: orders.filter(o => o.status === 'active').length,
      filledOrders: filled.length,
      cancelledOrders: cancelled.length,
      totalVolume,
      successRate
    };
  }

  /**
   * Validate order configuration
   */
  private validateConfig(config: RangeOrderConfig): { valid: boolean; error?: string } {
    if (!config.token0 || !config.token1) {
      return { valid: false, error: 'Token0 and token1 are required' };
    }

    if (config.token0 === config.token1) {
      return { valid: false, error: 'Token0 and token1 must be different' };
    }

    if (!['buy', 'sell'].includes(config.direction)) {
      return { valid: false, error: 'Direction must be "buy" or "sell"' };
    }

    if (config.targetPrice <= 0) {
      return { valid: false, error: 'Target price must be positive' };
    }

    if (parseFloat(config.amount) <= 0) {
      return { valid: false, error: 'Amount must be positive' };
    }

    if (config.rangeWidth <= 0 || config.rangeWidth > 10) {
      return { valid: false, error: 'Range width must be between 0 and 10%' };
    }

    const validFeeTiers = [TRADING_CONSTANTS.FEE_TIERS.STABLE, TRADING_CONSTANTS.FEE_TIERS.STANDARD, TRADING_CONSTANTS.FEE_TIERS.VOLATILE];
    if (!validFeeTiers.includes(config.fee)) {
      return { valid: false, error: 'Invalid fee tier' };
    }

    return { valid: true };
  }

  /**
   * Get current price for token pair
   */
  private async getCurrentPrice(token0: string, token1: string, fee: number): Promise<number | null> {
    try {
      const poolData = await this.liquidityManager['gswap'].pools.getPoolData(token0, token1, fee);
      if (!poolData) return null;

      const price = this.liquidityManager['gswap'].pools.calculateSpotPrice(
        token0,
        token1,
        poolData.sqrtPrice
      );

      return safeParseFloat(price.toString(), 0);

    } catch (error) {
      logger.error('Failed to get current price:', error);
      return null;
    }
  }

  /**
   * Calculate price range for the order
   */
  private calculateOrderRange(currentPrice: number, config: RangeOrderConfig): { min: number; max: number } {
    const rangeWidth = config.rangeWidth / 100; // Convert percentage to decimal
    const targetPrice = config.targetPrice;

    if (config.direction === 'buy') {
      // Buy order: provide liquidity above current price, centered on target
      const halfRange = targetPrice * rangeWidth / 2;
      return {
        min: Math.max(targetPrice - halfRange, currentPrice * 1.001), // Ensure above current
        max: targetPrice + halfRange
      };
    } else {
      // Sell order: provide liquidity below current price, centered on target
      const halfRange = targetPrice * rangeWidth / 2;
      return {
        min: targetPrice - halfRange,
        max: Math.min(targetPrice + halfRange, currentPrice * 0.999) // Ensure below current
      };
    }
  }

  /**
   * Validate that price range makes sense for order direction
   */
  private validatePriceRange(currentPrice: number, range: { min: number; max: number }, direction: string): boolean {
    if (direction === 'buy') {
      // Buy orders should be above current price
      return range.min > currentPrice;
    } else {
      // Sell orders should be below current price
      return range.max < currentPrice;
    }
  }

  /**
   * Calculate liquidity amounts for the order
   */
  private calculateLiquidityAmounts(config: RangeOrderConfig, priceRange: { min: number; max: number }): AddLiquidityParams {
    // For range orders, we typically provide 100% of one token
    // Buy orders: provide token1 (quote token) to buy token0
    // Sell orders: provide token0 (base token) to sell for token1

    const amount = config.amount;
    const slippage = config.slippageTolerance || TRADING_CONSTANTS.DEFAULT_SLIPPAGE_TOLERANCE;

    if (config.direction === 'buy') {
      // Buying token0 with token1, so provide mostly token1
      return {
        token0: config.token0,
        token1: config.token1,
        fee: config.fee,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        amount0Desired: '0', // Minimal token0
        amount1Desired: amount, // Full amount in token1
        slippageTolerance: slippage
      };
    } else {
      // Selling token0 for token1, so provide mostly token0
      return {
        token0: config.token0,
        token1: config.token1,
        fee: config.fee,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        amount0Desired: amount, // Full amount in token0
        amount1Desired: '0', // Minimal token1
        slippageTolerance: slippage
      };
    }
  }

  /**
   * Generate unique order ID
   */
  private generateOrderId(config: RangeOrderConfig): string {
    const timestamp = Date.now();
    const direction = config.direction;
    const tokens = `${config.token0.split('$')[0]}-${config.token1.split('$')[0]}`;
    const hash = Buffer.from(`${tokens}-${direction}-${timestamp}`).toString('base64').slice(0, 8);
    return `ro_${hash}`;
  }

  /**
   * Start monitoring an order for auto-execution
   */
  private startOrderMonitoring(orderId: string): void {
    // Note: In a full implementation, this would set up a monitoring system
    // For now, we rely on the updateOrderStatuses() method being called periodically
    logger.debug(`Started monitoring for order: ${orderId}`);
  }

  /**
   * Check if an order should be executed (filled)
   */
  private async checkOrderExecution(order: RangeOrderStatus): Promise<void> {
    if (!order.position || order.status !== 'active') return;

    try {
      // Get current price
      const currentPrice = await this.getCurrentPrice(
        order.config.token0,
        order.config.token1,
        order.config.fee
      );

      if (!currentPrice) return;

      // Check if price has moved into our range (indicating execution)
      const priceInRange = currentPrice >= order.position.minPrice && currentPrice <= order.position.maxPrice;

      if (priceInRange && order.config.autoExecute) {
        // Price is in range - check if we should close the position
        const shouldExecute = this.shouldExecuteOrder(order, currentPrice);

        if (shouldExecute) {
          await this.executeOrder(order, currentPrice);
        }
      }

    } catch (error) {
      logger.error(`Error checking order execution for ${order.orderId}:`, error);
    }
  }

  /**
   * Determine if order should be executed
   */
  private shouldExecuteOrder(order: RangeOrderStatus, currentPrice: number): boolean {
    // For range orders, we typically execute when:
    // 1. Price reaches the target price
    // 2. We've collected significant fees
    // 3. The position has been partially filled

    const targetReached = Math.abs(currentPrice - order.config.targetPrice) / order.config.targetPrice < 0.001; // Within 0.1%
    return targetReached;
  }

  /**
   * Execute (close) an order
   */
  private async executeOrder(order: RangeOrderStatus, executionPrice: number): Promise<void> {
    try {
      logger.info(`Executing range order: ${order.orderId} at price ${executionPrice}`);

      if (!order.position) {
        throw new Error('No position found for order');
      }

      // Collect any fees first
      const fees = await this.liquidityManager.collectFees({
        positionId: order.position.id
      });

      // Remove all liquidity
      const removal = await this.liquidityManager.removeLiquidity({
        positionId: order.position.id,
        liquidity: order.position.liquidity,
        slippageTolerance: order.config.slippageTolerance
      });

      // Update order status
      order.status = 'filled';
      order.filledAt = Date.now();
      order.executionPrice = executionPrice;
      order.amountFilled = order.config.direction === 'buy' ? removal.amount0 : removal.amount1;
      order.fees = fees;

      this.activeOrders.set(order.orderId, order);

      logger.info(`✅ Range order executed: ${order.orderId}`, {
        executionPrice,
        amountFilled: order.amountFilled,
        fees
      });

    } catch (error) {
      logger.error(`Failed to execute order ${order.orderId}:`, error);
      // Mark as expired if execution fails
      order.status = 'expired';
      this.activeOrders.set(order.orderId, order);
    }
  }

  /**
   * Clean up old orders to prevent memory leaks
   */
  cleanup(): void {
    const orders = Array.from(this.activeOrders.entries());
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

    let cleaned = 0;
    for (const [orderId, order] of orders) {
      const age = now - order.createdAt;
      if ((order.status !== 'active' && age > maxAge) || orders.length > this.maxOrders) {
        this.activeOrders.delete(orderId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old range orders`);
    }
  }
}