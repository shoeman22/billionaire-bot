/**
 * Enhanced Input Validation Tests
 * Comprehensive test suite for security-focused validation improvements
 */

import { InputValidator } from '../validation';

describe('Enhanced Input Validation', () => {
  describe('Token Format Validation', () => {
    test('should validate proper GalaChain token format', () => {
      const validTokens = [
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        'TEST|Category|Type|Key'
      ];

      validTokens.forEach(token => {
        const result = InputValidator.validateTokenFormat(token);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    test('should reject invalid token formats', () => {
      const invalidTokens = [
        'INVALID',
        'GALA|Unit|none', // Too few parts
        'GALA|Unit|none|none|extra', // Too many parts
        'GALA||none|none', // Empty component
        'GALA|Unit|none|', // Empty last component
        'GALA|Unit/Type|none|none', // Invalid character
        'GALA|Unit|<script>|none', // Script injection
        'GALA|Unit|../path|none', // Path traversal
      ];

      invalidTokens.forEach(token => {
        const result = InputValidator.validateTokenFormat(token);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    test('should prevent injection attacks in token format', () => {
      const maliciousTokens = [
        'GALA|Unit|javascript:alert(1)|none',
        'GALA|Unit|<script>alert(1)</script>|none',
        'GALA|Unit|eval(malicious)|none',
        'GALA|Unit|..\\..\\path|none',
        'GALA|Unit|$rm -rf /|none'
      ];

      maliciousTokens.forEach(token => {
        const result = InputValidator.validateTokenFormat(token);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e =>
          e.includes('invalid') ||
          e.includes('unsafe') ||
          e.includes('path')
        )).toBe(true);
      });
    });

    test('should enforce length limits', () => {
      const longToken = 'A'.repeat(30) + '|' + 'B'.repeat(30) + '|' + 'C'.repeat(30) + '|' + 'D'.repeat(30);
      const result = InputValidator.validateTokenFormat(longToken);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('too long'))).toBe(true);
    });
  });

  describe('Trading Amount Validation', () => {
    test('should validate proper decimal amounts', () => {
      const validAmounts = ['1.0', '0.1', '1000', '0.000001', '123.456789'];

      validAmounts.forEach(amount => {
        const result = InputValidator.validateTradingAmount(amount);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    test('should reject invalid amount formats', () => {
      const invalidAmounts = [
        '',
        '0',
        '-1',
        'abc',
        '1.2.3',
        '1,000',
        '1e10',
        'Infinity',
        'NaN'
      ];

      invalidAmounts.forEach(amount => {
        const result = InputValidator.validateTradingAmount(amount);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    test('should enforce precision limits', () => {
      const highPrecision = '1.' + '1'.repeat(20); // 20 decimal places
      const result = InputValidator.validateTradingAmount(highPrecision);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('decimal places'))).toBe(true);
    });

    test('should prevent injection attacks in amounts', () => {
      const maliciousAmounts = [
        '1<script>',
        '1"onload="',
        "1'alert('xss')",
        '1;DROP TABLE;',
        '1|rm -rf /'
      ];

      maliciousAmounts.forEach(amount => {
        const result = InputValidator.validateTradingAmount(amount);
        expect(result.isValid).toBe(false);
      });
    });

    test('should handle boundary values correctly', () => {
      // Very small amount
      const verySmall = '0.000000001';
      const smallResult = InputValidator.validateTradingAmount(verySmall);
      expect(smallResult.warnings.some(w => w.includes('small'))).toBe(true);

      // Very large amount
      const veryLarge = '999999999';
      const largeResult = InputValidator.validateTradingAmount(veryLarge);
      expect(largeResult.warnings.some(w => w.includes('large'))).toBe(true);

      // Too large amount
      const tooLarge = '1000000001';
      const tooLargeResult = InputValidator.validateTradingAmount(tooLarge);
      expect(tooLargeResult.isValid).toBe(false);
    });
  });

  describe('Slippage Validation', () => {
    test('should validate proper slippage values', () => {
      const validSlippages = [0.01, 0.05, 0.1, 0.005];

      validSlippages.forEach(slippage => {
        const result = InputValidator.validateSlippage(slippage);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    test('should reject invalid slippage values', () => {
      const invalidSlippages = [-1, 1.1, NaN, Infinity, -Infinity];

      invalidSlippages.forEach(slippage => {
        const result = InputValidator.validateSlippage(slippage);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    test('should warn about extreme slippage values', () => {
      // Very low slippage
      const veryLow = 0.00001;
      const lowResult = InputValidator.validateSlippage(veryLow);
      expect(lowResult.warnings.some(w => w.includes('low'))).toBe(true);

      // High slippage
      const high = 0.15;
      const highResult = InputValidator.validateSlippage(high);
      expect(highResult.warnings.some(w => w.includes('high'))).toBe(true);
    });

    test('should handle non-number inputs', () => {
      const invalidTypes = ['0.01', null, undefined, {}, []];

      invalidTypes.forEach(value => {
        const result = InputValidator.validateSlippage(value as any);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('number'))).toBe(true);
      });
    });
  });

  describe('Address Validation', () => {
    test('should validate proper GalaChain addresses', () => {
      const validAddresses = [
        'eth|0x1234567890123456789012345678901234567890',
        'eth|0xabcdefABCDEF1234567890123456789012345678'
      ];

      validAddresses.forEach(address => {
        const result = InputValidator.validateAddress(address);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    test('should reject invalid address formats', () => {
      const invalidAddresses = [
        '',
        '0x1234567890123456789012345678901234567890', // Missing eth| prefix
        'eth|0x123', // Too short
        'eth|0x123456789012345678901234567890123456789012345', // Too long
        'eth|0xZZZZ567890123456789012345678901234567890', // Invalid hex
        'eth|1234567890123456789012345678901234567890', // Missing 0x
        'btc|0x1234567890123456789012345678901234567890' // Wrong prefix
      ];

      invalidAddresses.forEach(address => {
        const result = InputValidator.validateAddress(address);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    test('should prevent injection attacks in addresses', () => {
      const maliciousAddresses = [
        'eth|0x1234567890123456789012345678901234567890<script>',
        'eth|0x1234567890123456789012345678901234567890"onload="',
        "eth|0x1234567890123456789012345678901234567890';alert('xss')//",
        'eth|../../../etc/passwd',
        'eth|javascript:alert(1)'
      ];

      maliciousAddresses.forEach(address => {
        const result = InputValidator.validateAddress(address);
        expect(result.isValid).toBe(false);
      });
    });

    test('should detect zero address', () => {
      const zeroAddress = 'eth|0x0000000000000000000000000000000000000000';
      const result = InputValidator.validateAddress(zeroAddress);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('zero'))).toBe(true);
    });

    test('should warn about suspicious addresses', () => {
      const suspiciousAddresses = [
        'eth|0x1111111111111111111111111111111111111111',
        'eth|0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'eth|0xffffffffffffffffffffffffffffffffffffffff'
      ];

      suspiciousAddresses.forEach(address => {
        const result = InputValidator.validateAddress(address);
        if (result.isValid) {
          expect(result.warnings.some(w => w.includes('test') || w.includes('placeholder'))).toBe(true);
        }
      });
    });
  });

  describe('Fee Tier Validation', () => {
    test('should validate proper fee tiers', () => {
      const validFees = [500, 3000, 10000];

      validFees.forEach(fee => {
        const result = InputValidator.validateFeeTier(fee);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    test('should reject invalid fee tiers', () => {
      const invalidFees = [0, -1, 1500, 50000, 1.5, NaN, Infinity];

      invalidFees.forEach(fee => {
        const result = InputValidator.validateFeeTier(fee);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    test('should handle non-number fee inputs', () => {
      const invalidTypes = ['500', null, undefined, {}, []];

      invalidTypes.forEach(value => {
        const result = InputValidator.validateFeeTier(value as any);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('number'))).toBe(true);
      });
    });
  });

  describe('Input Sanitization', () => {
    test('should remove dangerous characters', () => {
      const dangerousInputs = [
        '<script>alert("xss")</script>',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        '"><script>alert(1)</script>',
        "'onload='alert(1)'"
      ];

      dangerousInputs.forEach(input => {
        const sanitized = InputValidator.sanitizeInput(input);
        expect(sanitized).not.toContain('<');
        expect(sanitized).not.toContain('>');
        expect(sanitized).not.toContain('"');
        expect(sanitized).not.toContain("'");
        expect(sanitized).not.toContain('&');
        expect(sanitized).not.toContain('javascript:');
        expect(sanitized).not.toContain('data:');
      });
    });

    test('should remove control characters', () => {
      const controlChars = 'test\x00\x01\x1F\x7F\x9F\u2028\u2029\uFEFF';
      const sanitized = InputValidator.sanitizeInput(controlChars);
      expect(sanitized).toBe('test');
    });

    test('should limit string length', () => {
      const longString = 'a'.repeat(2000);
      const sanitized = InputValidator.sanitizeInput(longString);
      expect(sanitized.length).toBeLessThanOrEqual(1000);
    });

    test('should handle non-string inputs', () => {
      const nonStrings = [null, undefined, 123, {}, []];

      nonStrings.forEach(value => {
        const sanitized = InputValidator.sanitizeInput(value as any);
        expect(sanitized).toBe('');
      });
    });
  });

  describe('Safe String Validation', () => {
    test('should identify safe strings', () => {
      const safeStrings = [
        'validtoken123',
        'GALA|Unit|none|none',
        '123.456',
        'eth|0x1234567890123456789012345678901234567890'
      ];

      safeStrings.forEach(str => {
        const isSafe = InputValidator.isSafeString(str);
        expect(isSafe).toBe(true);
      });
    });

    test('should identify dangerous strings', () => {
      const dangerousStrings = [
        '<script>alert(1)</script>',
        'javascript:alert(1)',
        'eval(malicious_code)',
        'function() { return evil; }',
        '../../../etc/passwd',
        'rm -rf /',
        'onload="evil()"',
        'data:text/html,evil'
      ];

      dangerousStrings.forEach(str => {
        const isSafe = InputValidator.isSafeString(str);
        expect(isSafe).toBe(false);
      });
    });
  });

  describe('Numeric String Validation', () => {
    test('should validate proper numeric strings', () => {
      const validNumbers = ['123', '123.456', '0.001', '1000000'];

      validNumbers.forEach(num => {
        const isValid = InputValidator.isValidNumericString(num);
        expect(isValid).toBe(true);
      });
    });

    test('should reject invalid numeric strings', () => {
      const invalidNumbers = [
        '',
        'abc',
        '12.34.56',
        '1,000',
        '1e10',
        '-123',
        '+123',
        '123.',
        '.123'
      ];

      invalidNumbers.forEach(num => {
        const isValid = InputValidator.isValidNumericString(num);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Integration Tests', () => {
    test('should validate complete trade request', () => {
      const validTradeRequest = {
        tokenIn: 'GALA|Unit|none|none',
        tokenOut: 'GUSDC|Unit|none|none',
        amountIn: '100.5',
        slippageTolerance: 0.01,
        userAddress: 'eth|0x1234567890123456789012345678901234567890'
      };

      const result = InputValidator.validateTrade(validTradeRequest);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject trade request with injection attempts', () => {
      const maliciousTradeRequest = {
        tokenIn: 'GALA|Unit|<script>alert(1)</script>|none',
        tokenOut: 'GUSDC|Unit|none|none',
        amountIn: '100<script>',
        slippageTolerance: 0.01,
        userAddress: 'eth|0x1234567890123456789012345678901234567890<script>'
      };

      const result = InputValidator.validateTrade(maliciousTradeRequest);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should validate complete liquidity request', () => {
      const validLiquidityRequest = {
        token0: 'GALA|Unit|none|none',
        token1: 'GUSDC|Unit|none|none',
        amount0: '100',
        amount1: '200',
        fee: 3000,
        tickLower: -1000,
        tickUpper: 1000
      };

      const result = InputValidator.validateLiquidity(validLiquidityRequest);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});