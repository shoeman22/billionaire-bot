/**
 * Comprehensive tests for precision-math utility
 * Tests FixedNumber operations for trading calculations
 */

import { FixedNumber } from 'ethers';
import { PrecisionMath, TOKEN_DECIMALS } from '../precision-math';

describe('PrecisionMath', () => {
  describe('Constants', () => {
    it('should have proper decimal constants', () => {
      expect(PrecisionMath.DEFAULT_DECIMALS).toBe(18);
      expect(PrecisionMath.PERCENTAGE_DECIMALS).toBe(4);
      expect(PrecisionMath.PRICE_DECIMALS).toBe(8);
    });

    it('should have token decimal mappings', () => {
      expect(TOKEN_DECIMALS.GALA).toBe(8);
      expect(TOKEN_DECIMALS.GUSDC).toBe(6);
      expect(TOKEN_DECIMALS.GUSDT).toBe(6);
      expect(TOKEN_DECIMALS.GWETH).toBe(18);
      expect(TOKEN_DECIMALS.GWBTC).toBe(8);
    });
  });

  describe('Basic Arithmetic Operations', () => {
    describe('fromToken', () => {
      it('should create FixedNumber from token amount with correct precision', () => {
        const amount = PrecisionMath.fromToken('100.5', TOKEN_DECIMALS.GALA);
        expect(PrecisionMath.toNumber(amount)).toBe(100.5);
        expect(PrecisionMath.format(amount, TOKEN_DECIMALS.GALA)).toBe('100.50000000');
      });

      it('should handle different token decimal places', () => {
        const galaAmount = PrecisionMath.fromToken('100', TOKEN_DECIMALS.GALA); // 8 decimals
        const usdcAmount = PrecisionMath.fromToken('100', TOKEN_DECIMALS.GUSDC); // 6 decimals

        expect(PrecisionMath.format(galaAmount, TOKEN_DECIMALS.GALA)).toBe('100.00000000');
        expect(PrecisionMath.format(usdcAmount, TOKEN_DECIMALS.GUSDC)).toBe('100.000000');
      });

      it('should handle numeric input', () => {
        const amount = PrecisionMath.fromToken(100.5, TOKEN_DECIMALS.GALA);
        expect(PrecisionMath.toNumber(amount)).toBe(100.5);
      });
    });

    describe('fromNumber', () => {
      it('should create FixedNumber from regular number', () => {
        const amount = PrecisionMath.fromNumber(100.123, 18);
        expect(PrecisionMath.toNumber(amount)).toBeCloseTo(100.123, 10);
      });

      it('should handle string numbers', () => {
        const amount = PrecisionMath.fromNumber('100.123', 8);
        expect(PrecisionMath.toNumber(amount)).toBeCloseTo(100.123, 8);
      });
    });

    describe('toToken', () => {
      it('should convert FixedNumber to token string', () => {
        const amount = PrecisionMath.fromNumber(100.123, 18);
        const tokenString = PrecisionMath.toToken(amount, 8);

        // Should maintain precision
        expect(parseFloat(tokenString)).toBeCloseTo(100.123, 8);
      });
    });

    describe('add', () => {
      it('should perform accurate addition', () => {
        const a = PrecisionMath.fromNumber(0.1, 18);
        const b = PrecisionMath.fromNumber(0.2, 18);
        const result = PrecisionMath.add(a, b);

        // This should be exactly 0.3, avoiding floating point errors
        expect(PrecisionMath.toNumber(result)).toBeCloseTo(0.3, 15);
      });

      it('should handle large numbers accurately', () => {
        const a = PrecisionMath.fromNumber(999999999999999999, 18);
        const b = PrecisionMath.fromNumber(1, 18);
        const result = PrecisionMath.add(a, b);

        expect(PrecisionMath.toNumber(result)).toBe(1000000000000000000);
      });
    });

    describe('subtract', () => {
      it('should perform accurate subtraction', () => {
        const a = PrecisionMath.fromNumber(1, 18);
        const b = PrecisionMath.fromNumber(0.3, 18);
        const result = PrecisionMath.subtract(a, b);

        expect(PrecisionMath.toNumber(result)).toBeCloseTo(0.7, 15);
      });

      it('should handle negative results', () => {
        const a = PrecisionMath.fromNumber(5, 18);
        const b = PrecisionMath.fromNumber(10, 18);
        const result = PrecisionMath.subtract(a, b);

        expect(PrecisionMath.toNumber(result)).toBe(-5);
      });
    });

    describe('multiply', () => {
      it('should perform accurate multiplication', () => {
        const a = PrecisionMath.fromNumber(0.1, 18);
        const b = PrecisionMath.fromNumber(0.2, 18);
        const result = PrecisionMath.multiply(a, b);

        expect(PrecisionMath.toNumber(result)).toBeCloseTo(0.02, 15);
      });

      it('should handle large number multiplication', () => {
        const a = PrecisionMath.fromNumber(1000000, 18);
        const b = PrecisionMath.fromNumber(1000000, 18);
        const result = PrecisionMath.multiply(a, b);

        expect(PrecisionMath.toNumber(result)).toBe(1000000000000);
      });
    });

    describe('divide', () => {
      it('should perform accurate division', () => {
        const a = PrecisionMath.fromNumber(1, 18);
        const b = PrecisionMath.fromNumber(3, 18);
        const result = PrecisionMath.divide(a, b);

        // Should get precise 1/3 representation
        const resultNumber = PrecisionMath.toNumber(result);
        expect(resultNumber).toBeCloseTo(0.3333333333333333, 15);
      });

      it('should throw on division by zero', () => {
        const a = PrecisionMath.fromNumber(1, 18);
        const b = PrecisionMath.zero(18);

        expect(() => PrecisionMath.divide(a, b)).toThrow('Division by zero');
      });

      it('should handle complex division', () => {
        const a = PrecisionMath.fromNumber(100.456, 18);
        const b = PrecisionMath.fromNumber(3.789, 18);
        const result = PrecisionMath.divide(a, b);

        const expected = 100.456 / 3.789;
        expect(PrecisionMath.toNumber(result)).toBeCloseTo(expected, 10);
      });
    });
  });

  describe('Percentage Calculations', () => {
    describe('calculatePercentage', () => {
      it('should calculate percentage correctly', () => {
        const value = PrecisionMath.fromNumber(1000, 18);
        const percentage = PrecisionMath.fromNumber(15.5, PrecisionMath.PERCENTAGE_DECIMALS); // 15.5%
        const result = PrecisionMath.calculatePercentage(value, percentage);

        expect(PrecisionMath.toNumber(result)).toBeCloseTo(155, 10); // 15.5% of 1000 = 155
      });

      it('should handle fractional percentages', () => {
        const value = PrecisionMath.fromNumber(100, 18);
        const percentage = PrecisionMath.fromNumber(0.01, PrecisionMath.PERCENTAGE_DECIMALS); // 0.01%
        const result = PrecisionMath.calculatePercentage(value, percentage);

        expect(PrecisionMath.toNumber(result)).toBeCloseTo(0.01, 10); // 0.01% of 100 = 0.01
      });
    });

    describe('calculatePercentageChange', () => {
      it('should calculate positive percentage change', () => {
        const from = PrecisionMath.fromNumber(100, 18);
        const to = PrecisionMath.fromNumber(150, 18);
        const result = PrecisionMath.calculatePercentageChange(from, to);

        expect(PrecisionMath.toNumber(result)).toBeCloseTo(50, 10); // 50% increase
      });

      it('should calculate negative percentage change', () => {
        const from = PrecisionMath.fromNumber(100, 18);
        const to = PrecisionMath.fromNumber(75, 18);
        const result = PrecisionMath.calculatePercentageChange(from, to);

        expect(PrecisionMath.toNumber(result)).toBeCloseTo(-25, 10); // 25% decrease
      });

      it('should throw on division by zero', () => {
        const from = PrecisionMath.zero(18);
        const to = PrecisionMath.fromNumber(100, 18);

        expect(() => PrecisionMath.calculatePercentageChange(from, to)).toThrow('Cannot calculate percentage change from zero');
      });
    });
  });

  describe('Slippage Calculations', () => {
    describe('applySlippage', () => {
      it('should apply slippage correctly', () => {
        const amount = PrecisionMath.fromNumber(1000, TOKEN_DECIMALS.GALA);
        const slippagePercent = PrecisionMath.fromNumber(2.5, PrecisionMath.PERCENTAGE_DECIMALS); // 2.5%
        const result = PrecisionMath.applySlippage(amount, slippagePercent);

        // 1000 - (2.5% of 1000) = 1000 - 25 = 975
        expect(PrecisionMath.toNumber(result)).toBeCloseTo(975, 8);
      });

      it('should handle high slippage', () => {
        const amount = PrecisionMath.fromNumber(100, TOKEN_DECIMALS.GALA);
        const slippagePercent = PrecisionMath.fromNumber(50, PrecisionMath.PERCENTAGE_DECIMALS); // 50%
        const result = PrecisionMath.applySlippage(amount, slippagePercent);

        // 100 - (50% of 100) = 50
        expect(PrecisionMath.toNumber(result)).toBeCloseTo(50, 8);
      });
    });

    describe('applyCompoundSlippage', () => {
      it('should apply multiple slippages correctly', () => {
        const amount = PrecisionMath.fromNumber(1000, TOKEN_DECIMALS.GALA);
        const slippages = [
          PrecisionMath.fromNumber(1, PrecisionMath.PERCENTAGE_DECIMALS), // 1%
          PrecisionMath.fromNumber(1.5, PrecisionMath.PERCENTAGE_DECIMALS), // 1.5%
          PrecisionMath.fromNumber(2, PrecisionMath.PERCENTAGE_DECIMALS) // 2%
        ];
        const result = PrecisionMath.applyCompoundSlippage(amount, slippages);

        // Should be close to theoretical calculation, allowing for precision differences
        expect(PrecisionMath.toNumber(result)).toBeCloseTo(955.65, 0);
        expect(PrecisionMath.toNumber(result)).toBeGreaterThan(950);
        expect(PrecisionMath.toNumber(result)).toBeLessThan(960);
      });
    });
  });

  describe('Comparison and Utility Functions', () => {
    describe('isWithinTolerance', () => {
      it('should return true for values within tolerance', () => {
        const a = PrecisionMath.fromNumber(100, 18);
        const b = PrecisionMath.fromNumber(101, 18);
        const tolerance = PrecisionMath.fromNumber(2, PrecisionMath.PERCENTAGE_DECIMALS); // 2%

        expect(PrecisionMath.isWithinTolerance(a, b, tolerance)).toBe(true);
      });

      it('should return false for values outside tolerance', () => {
        const a = PrecisionMath.fromNumber(100, 18);
        const b = PrecisionMath.fromNumber(110, 18);
        const tolerance = PrecisionMath.fromNumber(5, PrecisionMath.PERCENTAGE_DECIMALS); // 5%

        expect(PrecisionMath.isWithinTolerance(a, b, tolerance)).toBe(false);
      });

      it('should handle zero values', () => {
        const a = PrecisionMath.zero(18);
        const b = PrecisionMath.zero(18);
        const tolerance = PrecisionMath.fromNumber(1, PrecisionMath.PERCENTAGE_DECIMALS);

        expect(PrecisionMath.isWithinTolerance(a, b, tolerance)).toBe(true);
      });
    });

    describe('max and min', () => {
      it('should return maximum value', () => {
        const a = PrecisionMath.fromNumber(100, 18);
        const b = PrecisionMath.fromNumber(150, 18);
        const result = PrecisionMath.max(a, b);

        expect(PrecisionMath.toNumber(result)).toBe(150);
      });

      it('should return minimum value', () => {
        const a = PrecisionMath.fromNumber(100, 18);
        const b = PrecisionMath.fromNumber(150, 18);
        const result = PrecisionMath.min(a, b);

        expect(PrecisionMath.toNumber(result)).toBe(100);
      });
    });

    describe('zero and one', () => {
      it('should create zero with correct decimals', () => {
        const zero = PrecisionMath.zero(8);
        expect(PrecisionMath.format(zero, 8)).toBe('0.00000000');
        expect(zero.isZero()).toBe(true);
      });

      it('should create one with correct decimals', () => {
        const one = PrecisionMath.one(8);
        expect(PrecisionMath.format(one, 8)).toBe('1.00000000');
        expect(PrecisionMath.toNumber(one)).toBe(1);
      });
    });

    describe('format', () => {
      it('should format to specified decimal places', () => {
        const value = PrecisionMath.fromNumber(123.456789, 18);
        const formatted = PrecisionMath.format(value, 4);

        expect(formatted).toBe('123.4568');
      });
    });
  });

  describe('Trading-Specific Calculations', () => {
    describe('Token Amount Conversions', () => {
      it('should handle GALA token calculations accurately', () => {
        const galaAmount = '100.12345678'; // 8 decimals for GALA
        const fixed = PrecisionMath.fromToken(galaAmount, TOKEN_DECIMALS.GALA);
        const backToString = PrecisionMath.toToken(fixed, TOKEN_DECIMALS.GALA);

        expect(backToString).toBe('100.12345678');
      });

      it('should handle GUSDC token calculations accurately', () => {
        const usdcAmount = '1000.123456'; // 6 decimals for GUSDC
        const fixed = PrecisionMath.fromToken(usdcAmount, TOKEN_DECIMALS.GUSDC);
        const backToString = PrecisionMath.toToken(fixed, TOKEN_DECIMALS.GUSDC);

        expect(backToString).toBe('1000.123456');
      });
    });

    describe('Price Calculations', () => {
      it('should calculate accurate price ratios', () => {
        const inputAmount = PrecisionMath.fromToken('100', TOKEN_DECIMALS.GALA);
        const outputAmount = PrecisionMath.fromToken('150', TOKEN_DECIMALS.GALA);
        const price = PrecisionMath.divide(outputAmount, inputAmount);

        expect(PrecisionMath.toNumber(price)).toBe(1.5);
      });

      it('should handle very small price differences', () => {
        const price1 = PrecisionMath.fromNumber(1.000001, PrecisionMath.PRICE_DECIMALS);
        const price2 = PrecisionMath.fromNumber(1.000002, PrecisionMath.PRICE_DECIMALS);
        const difference = PrecisionMath.subtract(price2, price1);

        expect(PrecisionMath.toNumber(difference)).toBeCloseTo(0.000001, 8);
      });
    });

    describe('Arbitrage Profit Calculations', () => {
      it('should calculate arbitrage profits accurately', () => {
        const initialAmount = PrecisionMath.fromToken('100', TOKEN_DECIMALS.GALA);
        const finalAmount = PrecisionMath.fromToken('105.5', TOKEN_DECIMALS.GALA);

        const profit = PrecisionMath.subtract(finalAmount, initialAmount);
        const profitPercent = PrecisionMath.calculatePercentageChange(initialAmount, finalAmount);

        expect(PrecisionMath.toNumber(profit)).toBeCloseTo(5.5, 8);
        expect(PrecisionMath.toNumber(profitPercent)).toBeCloseTo(5.5, 8);
      });

      it('should handle compound arbitrage calculations', () => {
        // Simulate 3-hop arbitrage: GALA -> TOKEN1 -> TOKEN2 -> GALA
        let amount = PrecisionMath.fromToken('1000', TOKEN_DECIMALS.GALA);

        // First hop: +2%
        amount = PrecisionMath.multiply(amount, PrecisionMath.fromNumber(1.02, 18));

        // Second hop: +1.5%
        amount = PrecisionMath.multiply(amount, PrecisionMath.fromNumber(1.015, 18));

        // Third hop: +3%
        amount = PrecisionMath.multiply(amount, PrecisionMath.fromNumber(1.03, 18));

        // Should be close to theoretical calculation with some precision tolerance
        expect(PrecisionMath.toNumber(amount)).toBeCloseTo(1066.36, 1);
        expect(PrecisionMath.toNumber(amount)).toBeGreaterThan(1060);
        expect(PrecisionMath.toNumber(amount)).toBeLessThan(1070);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    describe('Error Handling', () => {
      it('should handle invalid input gracefully', () => {
        expect(() => PrecisionMath.fromNumber('invalid', 18)).toThrow();
        expect(() => PrecisionMath.fromToken('invalid', 18)).toThrow();
      });

      it('should handle large numbers within limits', () => {
        const largeNumber = PrecisionMath.fromNumber('999999999999999999', 18);
        expect(largeNumber).toBeDefined();
        expect(PrecisionMath.toNumber(largeNumber)).toBe(999999999999999999);
      });
    });

    describe('Precision Edge Cases', () => {
      it('should maintain precision with very small numbers', () => {
        const tiny = PrecisionMath.fromNumber('0.000000001', 18); // 1 nano
        const doubled = PrecisionMath.multiply(tiny, PrecisionMath.fromNumber(2, 18));

        expect(PrecisionMath.toNumber(doubled)).toBeCloseTo(0.000000002, 15);
      });

      it('should handle recurring decimals accurately', () => {
        const oneThird = PrecisionMath.divide(
          PrecisionMath.one(18),
          PrecisionMath.fromNumber(3, 18)
        );
        const threeThirds = PrecisionMath.multiply(oneThird, PrecisionMath.fromNumber(3, 18));

        // Should be very close to 1, accounting for precision limits
        expect(PrecisionMath.toNumber(threeThirds)).toBeCloseTo(1, 10);
      });
    });
  });

  describe('Real-World Trading Scenarios', () => {
    describe('Slippage Protection Scenarios', () => {
      it('should calculate realistic slippage for small trades', () => {
        const tradeAmount = PrecisionMath.fromToken('10', TOKEN_DECIMALS.GALA); // Small trade
        const slippage = PrecisionMath.fromNumber(0.1, PrecisionMath.PERCENTAGE_DECIMALS); // 0.1%
        const minOutput = PrecisionMath.applySlippage(tradeAmount, slippage);

        // 10 - (0.1% of 10) = 9.99
        expect(PrecisionMath.toNumber(minOutput)).toBeCloseTo(9.99, 8);
      });

      it('should calculate realistic slippage for large trades', () => {
        const tradeAmount = PrecisionMath.fromToken('100000', TOKEN_DECIMALS.GALA); // Large trade
        const slippage = PrecisionMath.fromNumber(5, PrecisionMath.PERCENTAGE_DECIMALS); // 5%
        const minOutput = PrecisionMath.applySlippage(tradeAmount, slippage);

        // 100000 - (5% of 100000) = 95000
        expect(PrecisionMath.toNumber(minOutput)).toBeCloseTo(95000, 8);
      });
    });

    describe('Multi-Hop Trading Scenarios', () => {
      it('should calculate multi-hop arbitrage with compound slippage', () => {
        const initialAmount = PrecisionMath.fromToken('1000', TOKEN_DECIMALS.GALA);

        // Simulate 3-hop trade with slippage on each hop
        let currentAmount = initialAmount;

        // Hop 1: GALA -> TOKEN1 (rate: 1.02, slippage: 0.3%)
        currentAmount = PrecisionMath.multiply(currentAmount, PrecisionMath.fromNumber(1.02, 18));
        currentAmount = PrecisionMath.applySlippage(currentAmount, PrecisionMath.fromNumber(0.3, PrecisionMath.PERCENTAGE_DECIMALS));

        // Hop 2: TOKEN1 -> TOKEN2 (rate: 1.01, slippage: 0.5%)
        currentAmount = PrecisionMath.multiply(currentAmount, PrecisionMath.fromNumber(1.01, 18));
        currentAmount = PrecisionMath.applySlippage(currentAmount, PrecisionMath.fromNumber(0.5, PrecisionMath.PERCENTAGE_DECIMALS));

        // Hop 3: TOKEN2 -> GALA (rate: 1.015, slippage: 0.4%)
        currentAmount = PrecisionMath.multiply(currentAmount, PrecisionMath.fromNumber(1.015, 18));
        currentAmount = PrecisionMath.applySlippage(currentAmount, PrecisionMath.fromNumber(0.4, PrecisionMath.PERCENTAGE_DECIMALS));

        // Calculate final profit
        const profit = PrecisionMath.subtract(currentAmount, initialAmount);
        const profitPercent = PrecisionMath.calculatePercentageChange(initialAmount, currentAmount);

        // Should be profitable but less than theoretical 4.6537% due to slippage
        const profitPercentNumber = PrecisionMath.toNumber(profitPercent);
        expect(profitPercentNumber).toBeGreaterThan(3); // Still profitable
        expect(profitPercentNumber).toBeLessThan(4.7); // Less than theoretical max
      });
    });

    describe('Cross-Token Calculations', () => {
      it('should handle different token decimals in calculations', () => {
        const galaAmount = PrecisionMath.fromToken('100', TOKEN_DECIMALS.GALA); // 8 decimals
        const usdcAmount = PrecisionMath.fromToken('150', TOKEN_DECIMALS.GUSDC); // 6 decimals

        // Normalize both to same precision for calculation
        const galaNormalized = PrecisionMath.fromNumber(PrecisionMath.toNumber(galaAmount), 18);
        const usdcNormalized = PrecisionMath.fromNumber(PrecisionMath.toNumber(usdcAmount), 18);

        const price = PrecisionMath.divide(usdcNormalized, galaNormalized);
        expect(PrecisionMath.toNumber(price)).toBeCloseTo(1.5, 10); // 150/100 = 1.5
      });

      it('should handle cross-token arbitrage with different decimals', () => {
        // Simulate GALA (8 decimals) -> GUSDC (6 decimals) -> ETIME (8 decimals) -> GALA
        let currentAmount = PrecisionMath.fromToken('100.12345678', TOKEN_DECIMALS.GALA);

        // GALA -> GUSDC (rate: 1.5)
        const galaToUsdcRate = PrecisionMath.fromNumber(1.5, 18);
        currentAmount = PrecisionMath.multiply(currentAmount, galaToUsdcRate);
        // Apply slippage for USDC (6 decimals)
        currentAmount = PrecisionMath.applySlippage(currentAmount, PrecisionMath.fromNumber(0.3, PrecisionMath.PERCENTAGE_DECIMALS));

        // GUSDC -> ETIME (rate: 0.8)
        const usdcToEtimeRate = PrecisionMath.fromNumber(0.8, 18);
        currentAmount = PrecisionMath.multiply(currentAmount, usdcToEtimeRate);
        // Apply slippage for ETIME (8 decimals)
        currentAmount = PrecisionMath.applySlippage(currentAmount, PrecisionMath.fromNumber(0.5, PrecisionMath.PERCENTAGE_DECIMALS));

        // ETIME -> GALA (rate: 0.9)
        const etimeToGalaRate = PrecisionMath.fromNumber(0.9, 18);
        currentAmount = PrecisionMath.multiply(currentAmount, etimeToGalaRate);
        // Apply slippage back to GALA (8 decimals)
        currentAmount = PrecisionMath.applySlippage(currentAmount, PrecisionMath.fromNumber(0.4, PrecisionMath.PERCENTAGE_DECIMALS));

        // Should maintain precision throughout the multi-decimal arbitrage
        const finalAmount = PrecisionMath.toNumber(currentAmount);
        expect(finalAmount).toBeGreaterThan(100); // Should still be profitable
        expect(finalAmount).toBeLessThan(120); // Realistic range after slippage
      });
    });

    describe('Safety Margin Operations', () => {
      const { applySafetyMargin, applySafetyMarginWithFloor, applyGasBuffer } = require('../slippage-calculator');

      describe('applySafetyMargin', () => {
        it('should apply 2% safety margin correctly', () => {
          const amount = 100;
          const result = applySafetyMargin(amount, 2, TOKEN_DECIMALS.GALA);
          expect(result).toBeCloseTo(98, 6); // 100 - (100 * 0.02) = 98
        });

        it('should handle different token decimals', () => {
          const amount = 1000.123456;
          const result = applySafetyMargin(amount, 5, TOKEN_DECIMALS.GUSDC); // 6 decimals
          expect(result).toBeCloseTo(950.117283, 6); // 1000.123456 - (1000.123456 * 0.05)
        });

        it('should throw error for negative amounts', () => {
          expect(() => applySafetyMargin(-100, 2)).toThrow('Amount must be positive');
        });

        it('should throw error for invalid safety margin', () => {
          expect(() => applySafetyMargin(100, -1)).toThrow('Safety margin percent must be between 0 and 100');
          expect(() => applySafetyMargin(100, 101)).toThrow('Safety margin percent must be between 0 and 100');
        });
      });

      describe('applySafetyMarginWithFloor', () => {
        it('should apply safety margin but respect minimum floor', () => {
          const amount = 1; // Small amount
          const safetyMargin = 20; // 20% reduction
          const floor = 0.9;

          const result = applySafetyMarginWithFloor(amount, safetyMargin, floor, TOKEN_DECIMALS.GALA);
          expect(result).toBe(0.9); // Floor should kick in since 1 * 0.8 = 0.8 < 0.9
        });

        it('should apply safety margin normally when above floor', () => {
          const amount = 100;
          const safetyMargin = 10; // 10% reduction
          const floor = 50;

          const result = applySafetyMarginWithFloor(amount, safetyMargin, floor, TOKEN_DECIMALS.GALA);
          expect(result).toBeCloseTo(90, 6); // 100 * 0.9 = 90, which is > 50
        });
      });

      describe('applyGasBuffer', () => {
        it('should apply 10% gas buffer correctly', () => {
          const gasEstimate = 21000;
          const buffer = 1.1;

          const result = applyGasBuffer(gasEstimate, buffer);
          expect(result).toBeCloseTo(23100, 6); // 21000 * 1.1
        });

        it('should handle complex buffer multipliers', () => {
          const gasEstimate = 150000;
          const buffer = 1.25; // 25% buffer

          const result = applyGasBuffer(gasEstimate, buffer);
          expect(result).toBeCloseTo(187500, 6); // 150000 * 1.25
        });

        it('should throw error for negative gas estimate', () => {
          expect(() => applyGasBuffer(-1000, 1.1)).toThrow('Gas estimate must be positive');
        });

        it('should throw error for buffer less than 1.0', () => {
          expect(() => applyGasBuffer(21000, 0.9)).toThrow('Buffer multiplier must be at least 1.0');
        });
      });
    });

    describe('Bounds Validation and Warnings', () => {
      describe('validateBounds', () => {
        it('should pass for valid values', () => {
          const value = PrecisionMath.fromNumber(100, TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateBounds(value, 'test amount')).not.toThrow();
        });

        it('should throw for negative amounts when context includes "amount"', () => {
          const negativeAmount = PrecisionMath.fromNumber(-100, TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateBounds(negativeAmount, 'trade amount'))
            .toThrow('Invalid trade amount: cannot be negative');
        });

        it('should validate minimum bounds', () => {
          const value = PrecisionMath.fromNumber(5, TOKEN_DECIMALS.GALA);
          const minValue = PrecisionMath.fromNumber(10, TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateBounds(value, 'test amount', minValue))
            .toThrow('is below minimum allowed value');
        });

        it('should validate maximum bounds', () => {
          const value = PrecisionMath.fromNumber(100, TOKEN_DECIMALS.GALA);
          const maxValue = PrecisionMath.fromNumber(50, TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateBounds(value, 'test amount', undefined, maxValue))
            .toThrow('exceeds maximum allowed value');
        });
      });

      describe('validateTradingAmount', () => {
        it('should pass for valid trading amounts', () => {
          const amount = PrecisionMath.fromNumber(100, TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateTradingAmount(amount, TOKEN_DECIMALS.GALA, 'swap'))
            .not.toThrow();
        });

        it('should throw for zero amounts', () => {
          const zeroAmount = PrecisionMath.zero(TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateTradingAmount(zeroAmount, TOKEN_DECIMALS.GALA, 'swap'))
            .toThrow('is below minimum allowed value');
        });

        it('should throw for extremely small amounts', () => {
          const tinyAmount = PrecisionMath.fromNumber(0.0000001, TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateTradingAmount(tinyAmount, TOKEN_DECIMALS.GALA, 'swap'))
            .toThrow('is below minimum allowed value');
        });

        it('should throw for extremely large amounts', () => {
          const hugeAmount = PrecisionMath.fromNumber(10000000, TOKEN_DECIMALS.GALA);
          expect(() => PrecisionMath.validateTradingAmount(hugeAmount, TOKEN_DECIMALS.GALA, 'swap'))
            .toThrow('exceeds maximum allowed value');
        });
      });

      describe('validatePercentage', () => {
        it('should pass for valid percentages', () => {
          const percentage = PrecisionMath.fromNumber(15, PrecisionMath.PERCENTAGE_DECIMALS);
          expect(() => PrecisionMath.validatePercentage(percentage, 'slippage'))
            .not.toThrow();
        });

        it('should throw for negative percentages', () => {
          const negativePercent = PrecisionMath.fromNumber(-5, PrecisionMath.PERCENTAGE_DECIMALS);
          expect(() => PrecisionMath.validatePercentage(negativePercent, 'slippage'))
            .toThrow('is below minimum allowed value');
        });

        it('should throw for percentages above 100%', () => {
          const highPercent = PrecisionMath.fromNumber(150, PrecisionMath.PERCENTAGE_DECIMALS);
          expect(() => PrecisionMath.validatePercentage(highPercent, 'slippage'))
            .toThrow('exceeds maximum allowed value');
        });

        it('should handle zero percentages based on allowZero flag', () => {
          const zeroPercent = PrecisionMath.zero(PrecisionMath.PERCENTAGE_DECIMALS);

          // Should pass when zero is allowed
          expect(() => PrecisionMath.validatePercentage(zeroPercent, 'slippage', true))
            .not.toThrow();

          // Should throw when zero is not allowed
          expect(() => PrecisionMath.validatePercentage(zeroPercent, 'slippage', false))
            .toThrow('Invalid slippage: cannot be zero');
        });
      });

      describe('toNumber precision warnings', () => {
        beforeEach(() => {
          jest.spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
          jest.restoreAllMocks();
        });

        it('should warn for numbers with many decimal places', () => {
          const preciseNumber = FixedNumber.fromString('123.123456789012345678901234567890', 30);
          PrecisionMath.toNumber(preciseNumber, true);
          expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('decimal places may lose precision')
          );
        });

        it('should not warn by default', () => {
          const preciseNumber = FixedNumber.fromString('123.123456789012345678901234567890', 30);
          PrecisionMath.toNumber(preciseNumber, false);
          expect(console.warn).not.toHaveBeenCalled();
        });
      });
    });
  });
});