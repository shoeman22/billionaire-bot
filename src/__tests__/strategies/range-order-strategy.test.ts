/**
 * RangeOrderStrategy Tests
 * Testing limit order functionality using concentrated liquidity
 */

import { RangeOrderStrategy, RangeOrderConfig } from '../../strategies/range-order-strategy';
import { LiquidityManager, LiquidityPosition } from '../../services/liquidity-manager';
import { TRADING_CONSTANTS } from '../../config/constants';

// Mock the LiquidityManager
jest.mock('../../services/liquidity-manager');
const MockLiquidityManager = LiquidityManager as jest.MockedClass<typeof LiquidityManager>;

// Mock the quote wrapper
const mockQuoteExactInput = jest.fn().mockResolvedValue({
  outTokenAmount: '0.05',
  currentPoolSqrtPrice: '1000000000000000000'
});

jest.mock('../../utils/quote-api', () => ({
  createQuoteWrapper: jest.fn(() => ({
    quoteExactInput: mockQuoteExactInput
  }))
}));

describe('RangeOrderStrategy', () => {
  let rangeOrderStrategy: RangeOrderStrategy;
  let mockLiquidityManager: jest.Mocked<LiquidityManager>;

  beforeEach(() => {
    mockLiquidityManager = new MockLiquidityManager({} as any, 'eth|test-wallet-address') as jest.Mocked<LiquidityManager>;

    // Mock the gswap pools service
    (mockLiquidityManager as any).gswap = {
      pools: {
        getPoolData: jest.fn(),
        calculateSpotPrice: jest.fn()
      }
    };

    mockLiquidityManager.addLiquidityByPrice = jest.fn().mockResolvedValue('test-position-id');
    mockLiquidityManager.removeLiquidity = jest.fn().mockResolvedValue({ amount0: '100', amount1: '5' });
    mockLiquidityManager.getPosition = jest.fn().mockReturnValue(null);
    mockLiquidityManager.collectFees = jest.fn().mockResolvedValue({ amount0: '1', amount1: '0.05' });
    mockLiquidityManager.calculateSpotPrice = jest.fn().mockReturnValue(0.05);

    rangeOrderStrategy = new RangeOrderStrategy(mockLiquidityManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('placeRangeOrder', () => {
    const mockBuyOrder: RangeOrderConfig = {
      token0: TRADING_CONSTANTS.TOKENS.GALA,
      token1: TRADING_CONSTANTS.TOKENS.GUSDC,
      fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
      direction: 'buy',
      amount: '1000',
      targetPrice: 0.055,
      rangeWidth: 0.1,
      autoExecute: true,
      slippageTolerance: 0.005
    };

    const mockSellOrder: RangeOrderConfig = {
      ...mockBuyOrder,
      direction: 'sell',
      targetPrice: 0.045
    };

    beforeEach(() => {
      // Mock current price
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000' // Mock sqrt price
      });
      (mockLiquidityManager as any).gswap.pools.calculateSpotPrice.mockReturnValue('0.05');
    });

    it('should place buy order above current price', async () => {
      mockLiquidityManager.addLiquidityByPrice.mockResolvedValue('lp_test123');
      const mockPosition: LiquidityPosition = {
        id: 'lp_test123',
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 10000,
        tickLower: 100,
        tickUpper: 200,
        minPrice: 0.054,
        maxPrice: 0.056,
        liquidity: '1000000',
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };
      mockLiquidityManager.getPosition.mockReturnValue(mockPosition);

      const result = await rangeOrderStrategy.placeRangeOrder(mockBuyOrder);

      expect(result.success).toBe(true);
      expect(result.orderId).toMatch(/^ro_[a-zA-Z0-9_]+$/);
      expect(result.estimatedFillPrice).toBe(0.055);
      expect(result.priceRange).toBeDefined();
      expect(result.priceRange!.min).toBeGreaterThan(0.05); // Above current price
    });

    it('should place sell order below current price', async () => {
      mockLiquidityManager.addLiquidityByPrice.mockResolvedValue('lp_test456');
      const mockPosition: LiquidityPosition = {
        id: 'lp_test456',
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 10000,
        tickLower: 100,
        tickUpper: 200,
        minPrice: 0.044,
        maxPrice: 0.046,
        liquidity: '1000000',
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };
      mockLiquidityManager.getPosition.mockReturnValue(mockPosition);

      const result = await rangeOrderStrategy.placeRangeOrder(mockSellOrder);

      expect(result.success).toBe(true);
      expect(result.priceRange!.max).toBeLessThan(0.05); // Below current price
    });

    it('should reject buy order below current price', async () => {
      const invalidBuyOrder = { ...mockBuyOrder, targetPrice: 0.04 };

      const result = await rangeOrderStrategy.placeRangeOrder(invalidBuyOrder);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid range for buy order');
    });

    it('should reject sell order above current price', async () => {
      const invalidSellOrder = { ...mockSellOrder, targetPrice: 0.06 };

      const result = await rangeOrderStrategy.placeRangeOrder(invalidSellOrder);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid range for sell order');
    });

    it('should validate order configuration', async () => {
      const invalidConfig = { ...mockBuyOrder, token0: '', token1: '' };

      const result = await rangeOrderStrategy.placeRangeOrder(invalidConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token0 and token1 are required');
    });

    it('should handle same token error', async () => {
      const sameTokenConfig = { ...mockBuyOrder, token1: mockBuyOrder.token0 };

      const result = await rangeOrderStrategy.placeRangeOrder(sameTokenConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token0 and token1 must be different');
    });

    it('should validate fee tiers', async () => {
      const invalidFeeConfig = { ...mockBuyOrder, fee: 99999 };

      const result = await rangeOrderStrategy.placeRangeOrder(invalidFeeConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid fee tier');
    });

    it('should handle liquidity manager errors', async () => {
      mockLiquidityManager.addLiquidityByPrice.mockRejectedValue(new Error('Insufficient balance'));

      const result = await rangeOrderStrategy.placeRangeOrder(mockBuyOrder);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient balance');
    });
  });

  describe('cancelRangeOrder', () => {
    beforeEach(async () => {
      // Place an order first
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000'
      });
      (mockLiquidityManager as any).gswap.pools.calculateSpotPrice.mockReturnValue('0.05');

      mockLiquidityManager.addLiquidityByPrice.mockResolvedValue('lp_test123');
      const mockPosition: LiquidityPosition = {
        id: 'lp_test123',
        minPrice: 0.054,
        maxPrice: 0.056,
        liquidity: '1000000',
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 10000,
        tickLower: 100,
        tickUpper: 200,
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };
      mockLiquidityManager.getPosition.mockReturnValue(mockPosition);

      const config: RangeOrderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      };

      await rangeOrderStrategy.placeRangeOrder(config);
    });

    it('should successfully cancel active order', async () => {
      mockLiquidityManager.removeLiquidity.mockResolvedValue({
        amount0: '995',
        amount1: '49.5'
      });

      const orders = rangeOrderStrategy.getAllOrders();
      const orderId = orders[0].orderId;

      const result = await rangeOrderStrategy.cancelRangeOrder(orderId);

      expect(result.success).toBe(true);
      expect(mockLiquidityManager.removeLiquidity).toHaveBeenCalled();

      // Check order status updated
      const order = rangeOrderStrategy.getOrderStatus(orderId);
      expect(order?.status).toBe('cancelled');
    });

    it('should handle non-existent order', async () => {
      const result = await rangeOrderStrategy.cancelRangeOrder('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    it('should handle already filled order', async () => {
      const orders = rangeOrderStrategy.getAllOrders();
      const orderId = orders[0].orderId;

      // Manually set order as filled
      const order = rangeOrderStrategy.getOrderStatus(orderId);
      if (order) {
        order.status = 'filled';
      }

      const result = await rangeOrderStrategy.cancelRangeOrder(orderId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot cancel order with status: filled');
    });
  });

  describe('Order Monitoring and Execution', () => {
    let orderId: string;

    beforeEach(async () => {
      // Set up mocks
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000'
      });
      (mockLiquidityManager as any).gswap.pools.calculateSpotPrice.mockReturnValue('0.05');

      mockLiquidityManager.addLiquidityByPrice.mockResolvedValue('lp_test123');
      const mockPosition: LiquidityPosition = {
        id: 'lp_test123',
        minPrice: 0.054,
        maxPrice: 0.056,
        liquidity: '1000000',
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 10000,
        tickLower: 100,
        tickUpper: 200,
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };
      mockLiquidityManager.getPosition.mockReturnValue(mockPosition);

      const config: RangeOrderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      };

      const result = await rangeOrderStrategy.placeRangeOrder(config);
      orderId = result.orderId!;
    });

    it('should update order statuses', async () => {
      // Mock getCurrentPrice to return target price
      mockQuoteExactInput.mockResolvedValue({
        outTokenAmount: '0.055',
        currentPoolSqrtPrice: '1000000000000000000'
      });
      mockLiquidityManager.calculateSpotPrice.mockReturnValue(0.055);

      mockLiquidityManager.collectFees.mockResolvedValue({
        amount0: '5',
        amount1: '0.25'
      });

      mockLiquidityManager.removeLiquidity.mockResolvedValue({
        amount0: '1000',
        amount1: '0'
      });

      await rangeOrderStrategy.updateOrderStatuses();

      const order = rangeOrderStrategy.getOrderStatus(orderId);
      expect(order?.status).toBe('filled');
      expect(order?.executionPrice).toBe(0.055);
      expect(order?.amountFilled).toBe('1000');
    });

    it('should handle execution errors gracefully', async () => {
      // Mock getCurrentPrice to return target price
      mockQuoteExactInput.mockResolvedValue({
        outTokenAmount: '0.055',
        currentPoolSqrtPrice: '1000000000000000000'
      });
      mockLiquidityManager.calculateSpotPrice.mockReturnValue(0.055);

      // Mock execution failing
      mockLiquidityManager.collectFees.mockRejectedValue(new Error('Network error'));

      await rangeOrderStrategy.updateOrderStatuses();

      const order = rangeOrderStrategy.getOrderStatus(orderId);
      expect(order?.status).toBe('expired');
    });
  });

  describe('Statistics and Analytics', () => {
    // Helper function to set up test orders
    const setupTestOrders = async () => {
      // Place multiple orders for testing
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000'
      });
      (mockLiquidityManager as any).gswap.pools.calculateSpotPrice.mockReturnValue('0.05');

      // Reset and setup fresh mocks for each call
      mockLiquidityManager.addLiquidityByPrice.mockReset();
      mockLiquidityManager.addLiquidityByPrice.mockResolvedValueOnce('lp_1');
      mockLiquidityManager.addLiquidityByPrice.mockResolvedValueOnce('lp_2');
      const mockPosition: LiquidityPosition = {
        id: 'lp_test',
        minPrice: 0.054,
        maxPrice: 0.056,
        liquidity: '1000000',
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 10000,
        tickLower: 100,
        tickUpper: 200,
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };
      mockLiquidityManager.getPosition.mockReturnValue(mockPosition);

      const config1: RangeOrderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      };

      const config2: RangeOrderConfig = {
        ...config1,
        direction: 'sell',
        targetPrice: 0.045
      };

      await rangeOrderStrategy.placeRangeOrder(config1);
      await rangeOrderStrategy.placeRangeOrder(config2);
    };

    it('should provide comprehensive statistics', async () => {
      await setupTestOrders();
      const stats = rangeOrderStrategy.getStatistics();

      expect(stats.totalOrders).toBe(2);
      expect(stats.activeOrders).toBe(2);
      expect(stats.filledOrders).toBe(0);
      expect(stats.cancelledOrders).toBe(0);
      expect(stats.totalVolume).toBe(2000);
      expect(stats.successRate).toBe(0);
    });

    it('should filter orders by status', async () => {
      await setupTestOrders();
      const activeOrders = rangeOrderStrategy.getOrdersByStatus('active');
      expect(activeOrders).toHaveLength(2);

      const filledOrders = rangeOrderStrategy.getOrdersByStatus('filled');
      expect(filledOrders).toHaveLength(0);
    });

    it('should get all orders', async () => {
      await setupTestOrders();
      const allOrders = rangeOrderStrategy.getAllOrders();
      expect(allOrders).toHaveLength(2);

      allOrders.forEach(order => {
        expect(order.orderId).toMatch(/^ro_[a-zA-Z0-9_]+$/);
        expect(order.status).toBe('active');
        expect(order.config).toBeDefined();
        expect(order.position).toBeDefined();
      });
    });
  });

  describe('Price Range Calculations', () => {
    it('should calculate buy order ranges correctly', () => {
      const currentPrice = 0.05;
      const config: RangeOrderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1, // 0.1%
        autoExecute: true
      };

      const range = rangeOrderStrategy['calculateOrderRange'](currentPrice, config);

      expect(range.min).toBeGreaterThan(currentPrice); // Above current price
      expect(range.max).toBeGreaterThan(range.min);
      expect(range.max - range.min).toBeCloseTo(0.055 * 0.001, 6); // 0.1% range
    });

    it('should calculate sell order ranges correctly', () => {
      const currentPrice = 0.05;
      const config: RangeOrderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'sell',
        amount: '1000',
        targetPrice: 0.045,
        rangeWidth: 0.1,
        autoExecute: true
      };

      const range = rangeOrderStrategy['calculateOrderRange'](currentPrice, config);

      expect(range.max).toBeLessThan(currentPrice); // Below current price
      expect(range.min).toBeLessThan(range.max);
    });
  });

  describe('Cleanup Operations', () => {
    it('should clean up old orders', async () => {
      // Place orders and manipulate timestamps
      (mockLiquidityManager as any).gswap.pools.getPoolData.mockResolvedValue({
        sqrtPrice: '1000000000000000000'
      });
      (mockLiquidityManager as any).gswap.pools.calculateSpotPrice.mockReturnValue('0.05');

      mockLiquidityManager.addLiquidityByPrice.mockResolvedValue('lp_test');
      const mockPosition: LiquidityPosition = {
        id: 'lp_test',
        token0: 'GALA$Unit$none$none',
        token1: 'GUSDC$Unit$none$none',
        fee: 10000,
        tickLower: 100,
        tickUpper: 200,
        minPrice: 0.054,
        maxPrice: 0.056,
        liquidity: '1000000',
        amount0: '1000',
        amount1: '50',
        uncollectedFees0: '0',
        uncollectedFees1: '0',
        inRange: true,
        createdAt: Date.now(),
        lastUpdate: Date.now()
      };
      mockLiquidityManager.getPosition.mockReturnValue(mockPosition);

      const config: RangeOrderConfig = {
        token0: TRADING_CONSTANTS.TOKENS.GALA,
        token1: TRADING_CONSTANTS.TOKENS.GUSDC,
        fee: TRADING_CONSTANTS.FEE_TIERS.STANDARD,
        direction: 'buy',
        amount: '1000',
        targetPrice: 0.055,
        rangeWidth: 0.1,
        autoExecute: true
      };

      const result = await rangeOrderStrategy.placeRangeOrder(config);
      const orderId = result.orderId!;

      // Manually set order as old and completed
      const order = rangeOrderStrategy.getOrderStatus(orderId);
      if (order) {
        order.status = 'filled';
        order.createdAt = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      }

      const initialCount = rangeOrderStrategy.getAllOrders().length;
      rangeOrderStrategy.cleanup();
      const finalCount = rangeOrderStrategy.getAllOrders().length;

      expect(finalCount).toBeLessThan(initialCount);
    });
  });
});