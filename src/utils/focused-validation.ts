/**
 * Focused Validation Functions
 * Split large validation methods into smaller, focused functions
 * This improves maintainability and testing
 */

import { ValidationResult } from './validation';
import { normalizeTokenFormat, parseTokenComponents } from './token-format';

/**
 * Token Format Validation - Split into focused functions
 */
export class TokenValidation {
  /**
   * Basic token validation - checks for null, empty, dangerous characters
   */
  static validateTokenBasics(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // CRITICAL: Null/undefined/empty checks
    if (!token || typeof token !== 'string') {
      errors.push('Token must be a non-empty string');
      return { isValid: false, errors, warnings };
    }

    const trimmedToken = token.trim();
    if (trimmedToken.length === 0) {
      errors.push('Token cannot be empty or whitespace only');
      return { isValid: false, errors, warnings };
    }

    // CRITICAL: Check for dangerous characters before parsing ($ is allowed as delimiter)
    if (/[<>"'`&|;\n\r\t]/.test(trimmedToken)) {
      errors.push('Token contains dangerous characters that could cause injection attacks');
      return { isValid: false, errors, warnings };
    }

    // Use normalizer to handle both | and $ formats
    try {
      const normalized = normalizeTokenFormat(trimmedToken);
      const parts = parseTokenComponents(normalized);
      // If we got here, the token is valid (4 parts)
    } catch (error) {
      errors.push(`Invalid token format: ${error instanceof Error ? error.message : String(error)}`);
      return { isValid: false, errors, warnings };
    }

    return { isValid: true, errors, warnings };
  }

  /**
   * Security validation for token format - checks for injection patterns
   */
  static validateTokenSecurity(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // CRITICAL: Security checks for injection attacks
    const securityChecks = [
      { pattern: /\.\./, message: 'Path traversal attempt detected (..)' },
      { pattern: /[/\\]/, message: 'File system path characters detected' },
      { pattern: /javascript:/i, message: 'JavaScript protocol detected' },
      { pattern: /data:/i, message: 'Data protocol detected' },
      { pattern: /vbscript:/i, message: 'VBScript protocol detected' },
      { pattern: /<script/i, message: 'Script tag detected' },
      { pattern: /eval\s*\(/i, message: 'Eval function detected' },
      { pattern: /function\s*\(/i, message: 'Function declaration detected' },
      { pattern: /\${/, message: 'Template literal injection detected' },
      { pattern: /\[\[|\]\]/, message: 'Double bracket injection detected' },
      { pattern: /\x00|\x08|\x0B|\x0C|\x0E|\x1F|\x7F/, message: 'Control characters detected' },
      { pattern: /\\[nrtbfav]/, message: 'Escape sequence detected' }
    ];

    for (const check of securityChecks) {
      if (check.pattern.test(token)) {
        errors.push(`Security violation: ${check.message}`);
      }
    }

    // CRITICAL: Length validation (prevent DoS)
    if (token.length > 80) {
      errors.push(`Token too long: ${token.length} characters (max 80)`);
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Component validation for token format - validates each token part
   */
  static validateTokenComponents(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Use normalizer to handle both | and $ formats
    let parts: ReturnType<typeof parseTokenComponents>;
    try {
      const normalized = normalizeTokenFormat(token);
      parts = parseTokenComponents(normalized);
    } catch (error) {
      errors.push(`Invalid token format: ${error instanceof Error ? error.message : String(error)}`);
      return { isValid: false, errors, warnings };
    }

    const { collection, category, type, additionalKey } = parts;
    const componentNames = ['Collection', 'Category', 'Type', 'AdditionalKey'];
    const components = [collection, category, type, additionalKey];

    // CRITICAL: Check for empty components
    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      const componentName = componentNames[i];

      if (!component || component.trim().length === 0) {
        errors.push(`${componentName} component cannot be empty`);
        continue;
      }

      const validation = this.validateTokenComponentDetailed(component.trim(), componentName);
      if (!validation.isValid) {
        errors.push(...validation.errors);
      }
    }

    // CRITICAL: Component length validation
    for (let i = 0; i < components.length; i++) {
      if (components[i] && components[i].length > 20) {
        errors.push(`${componentNames[i]} component too long: ${components[i].length} characters (max 20)`);
      }
    }

    // CRITICAL: Reserved word validation
    const reservedWords = ['null', 'undefined', 'NaN', 'Infinity', 'constructor', 'prototype', '__proto__', 'toString', 'valueOf'];
    for (let i = 0; i < components.length; i++) {
      if (reservedWords.includes(components[i].toLowerCase())) {
        errors.push(`${componentNames[i]} cannot be a reserved word: ${components[i]}`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * API safety validation for token format - final checks for API compatibility
   */
  static validateTokenApiSafety(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for URL encoding that could bypass validation
    if (/%[0-9A-Fa-f]{2}/.test(token)) {
      errors.push('URL-encoded characters detected - potential bypass attempt');
    }

    // Check for Unicode normalization issues
    if (token !== token.normalize('NFC')) {
      warnings.push('Token contains non-normalized Unicode characters');
    }

    // Validate character set for each component
    let parts: ReturnType<typeof parseTokenComponents>;
    try {
      const normalized = normalizeTokenFormat(token);
      parts = parseTokenComponents(normalized);
    } catch (error) {
      errors.push(`Invalid token format: ${error instanceof Error ? error.message : String(error)}`);
      return { isValid: false, errors, warnings };
    }

    const { collection, category, type, additionalKey } = parts;
    const componentNames = ['Collection', 'Category', 'Type', 'AdditionalKey'];
    const components = [collection, category, type, additionalKey];

    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(component)) {
        errors.push(`${componentNames[i]} has invalid format: must start and end with alphanumeric, can contain '_' and '-' in middle`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate individual token component with detailed error messages
   */
  private static validateTokenComponentDetailed(component: string, componentName: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!component || component.length === 0) {
      errors.push(`${componentName} component cannot be empty`);
      return { isValid: false, errors, warnings };
    }

    if (component.length > 20) {
      errors.push(`${componentName} component too long (max 20 characters)`);
      return { isValid: false, errors, warnings };
    }

    // Check for dangerous injection patterns first
    const injectionPatterns = [
      { pattern: /javascript/i, message: 'unsafe JavaScript code detected' },
      { pattern: /script/i, message: 'unsafe script tag detected' },
      { pattern: /eval/i, message: 'unsafe eval function detected' },
      { pattern: /function/i, message: 'unsafe function declaration detected' },
      { pattern: /return/i, message: 'unsafe return statement detected' },
      { pattern: /\.\./i, message: 'invalid path traversal detected' },
      { pattern: /\//, message: 'invalid path separator detected' },
      { pattern: /\\/, message: 'invalid path separator detected' },
      { pattern: /</, message: 'unsafe HTML tag detected' },
      { pattern: />/, message: 'unsafe HTML tag detected' },
      { pattern: /"/, message: 'unsafe quote character detected' },
      { pattern: /'/, message: 'unsafe quote character detected' },
      { pattern: /&/, message: 'unsafe ampersand character detected' },
      { pattern: /;/, message: 'unsafe semicolon character detected' },
      { pattern: /\|/, message: 'unsafe pipe character detected' },
      { pattern: /`/, message: 'unsafe backtick character detected' },
      { pattern: /rm\s+-rf/i, message: 'unsafe system command detected' }
    ];

    for (const { pattern, message } of injectionPatterns) {
      if (pattern.test(component)) {
        errors.push(`${componentName} component contains ${message}`);
        return { isValid: false, errors, warnings };
      }
    }

    // Allow alphanumeric and specific safe characters for GalaChain
    if (!/^[A-Za-z0-9-_]+$/.test(component)) {
      errors.push(`Invalid ${componentName} component (must be alphanumeric with hyphens/underscores only)`);
      return { isValid: false, errors, warnings };
    }

    return { isValid: true, errors, warnings };
  }
}

/**
 * Input Sanitization - Split into focused functions
 */
export class InputSanitization {
  /**
   * Sanitize command injection patterns
   */
  static sanitizeCommandInjection(input: string): string {
    return input
      .replace(/\$\([^)]*\)/g, '')  // Remove $() command substitution
      .replace(/\$\{[^}]*\}/g, '')  // Remove ${} variable substitution
      .replace(/\$\(\([^)]*\)\)/g, '')  // Remove $(()) arithmetic expansion
      .replace(/`[^`]*`/g, '')  // Remove backtick command substitution
      .replace(/\b(rm\s+-rf|\/etc\/passwd|\/bin\/sh|cmd\.exe|powershell|bash|sh|zsh)\b/gi, '')
      .replace(/\b(sudo|su|chmod|chown|kill|killall|ps|top|netstat|ifconfig)\b/gi, '')
      .replace(/\b(system32|windows|config|sam)\b/gi, '');  // Remove Windows system paths
  }

  /**
   * Sanitize SQL injection patterns
   */
  static sanitizeSqlInjection(input: string): string {
    return input
      .replace(/\b(DROP|DELETE|INSERT|UPDATE|SELECT|UNION|ALTER|CREATE|EXEC|EXECUTE|TRUNCATE|MERGE)\b/gi, '')
      .replace(/\b(TABLE|FROM|INTO|WHERE|OR|AND|ORDER|BY|GROUP|HAVING|LIMIT)\b/gi, '')
      .replace(/('.*?'|\b\d+\b)\s*(=|!=|<>|<|>|<=|>=)\s*('.*?'|\b\d+\b)/gi, '')
      .replace(/'(\s*OR\s*'1'\s*=\s*'1|--|\s*UNION\s*)/gi, '')
      .replace(/--[\s\S]*$/gm, '')  // Remove SQL comments more thoroughly
      .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove SQL block comments
      .replace(/;\s*(DROP|DELETE|INSERT|UPDATE)/gi, '')
      .replace(/\bUSERS\b/gi, '');  // Remove potentially dangerous table names
  }

  /**
   * Sanitize NoSQL injection patterns
   */
  static sanitizeNoSqlInjection(input: string): string {
    return input
      .replace(/\$\w+/g, '')  // Remove ALL MongoDB operators
      .replace(/\{\s*\$\w+:/g, '{')  // Remove object patterns with $ operators
      .replace(/\$ne|\$regex|\$where|\$gt|\$lt|\$gte|\$lte|\$in|\$nin|\$exists|\$type/gi, '');
  }

  /**
   * Sanitize XSS patterns
   */
  static sanitizeXssPatterns(input: string): string {
    return input
      .replace(/<\s*(script|iframe|object|embed|applet|form|svg|style|link|meta)[^>]*>/gi, '')
      .replace(/<\/\s*(script|iframe|object|embed|applet|form|svg|style|link|meta)[^>]*>/gi, '')
      .replace(/\b(on\w+|javascript:|data:|vbscript:|file:|ftp:)/gi, '')
      .replace(/(onerror|onload|onclick|onmouseover|onfocus|onblur|onchange|onsubmit)\s*=/gi, '')
      .replace(/(alert|confirm|prompt|eval|Function|setTimeout|setInterval)\s*\(/gi, '')
      .replace(/alert\s*\(\s*\d+\s*\)/gi, '')  // Remove alert(1) patterns specifically
      .replace(/[<>"'&\\/#%|;`\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/[\u0000-\u001F\u007F-\u009F\u2000-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/g, '')
      .replace(/[\uFF00-\uFFEF]/g, '')  // Remove full-width characters (used in Unicode attacks)
      .replace(/script/gi, '')  // Remove any remaining script keywords
      .replace(/alert/gi, '');   // Remove any remaining alert keywords
  }

  /**
   * Sanitize system and HTTP patterns
   */
  static sanitizeSystemPatterns(input: string): string {
    return input
      .replace(/\b(HTTP\/\d\.\d|Transfer-Encoding|Content-Length|Host|Connection|Cache-Control|Content-Type)[\s:]/gi, '')
      .replace(/Transfer-Encoding/gi, '')  // More aggressive Transfer-Encoding removal
      .replace(/Content-Length/gi, '')  // More aggressive Content-Length removal
      .replace(/HTTP\d?\.\d?/gi, '');
  }

  /**
   * Sanitize sensitive data patterns
   */
  static sanitizeSensitiveData(input: string): string {
    return input
      .replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED]')  // 64-char hex strings (private keys)
      .replace(/password[^:]*:[^,}]*/gi, 'password:[REDACTED]')
      .replace(/apikey[^:]*:[^,}]*/gi, 'apikey:[REDACTED]')
      .replace(/privatekey[^:]*:[^,}]*/gi, 'privatekey:[REDACTED]')
      .replace(/\/home\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/C:\\Users\\[^\s,})")"]*/g, 'C:\\[REDACTED]')
      .replace(/\/usr\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/\/var\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/\/opt\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/\/tmp\/[^\s,})")"]*/g, '/[REDACTED]');
  }

  /**
   * Sanitize stack traces to remove sensitive paths
   */
  static sanitizeStackTrace(input: string): string {
    return input
      .replace(/at\s+[^\s]+\s+\([^:)]+:[^:)]+:\d+:\d+\)/g, 'at [FUNCTION] ([REDACTED]:line:col)')
      .replace(/\s+at\s+[^(]+\([^)]+\)/g, ' at [FUNCTION]([REDACTED])')
      .replace(/\/[^:\s)]+\.ts:\d+:\d+/g, '/[REDACTED].ts:line:col')
      .replace(/\/[^:\s)]+\.js:\d+:\d+/g, '/[REDACTED].js:line:col')
      .replace(/\([^)]*\/[^)]+\)/g, '([REDACTED])')  // Remove any remaining paths in parentheses
      .replace(/\/home\/[^\s)]+/g, '/[REDACTED]')
      .replace(/C:\\[^\s)]+/g, 'C:\\[REDACTED]');
  }

  /**
   * Enhanced input sanitization - uses all focused functions
   */
  static sanitizeInputFocused(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    let sanitized = input.trim();

    // Apply different sanitization stages
    sanitized = this.sanitizeCommandInjection(sanitized);
    sanitized = this.sanitizeSqlInjection(sanitized);
    sanitized = this.sanitizeNoSqlInjection(sanitized);
    sanitized = this.sanitizeXssPatterns(sanitized);
    sanitized = this.sanitizeSystemPatterns(sanitized);
    sanitized = this.sanitizeSensitiveData(sanitized);
    sanitized = this.sanitizeStackTrace(sanitized);

    // Limit length to prevent buffer overflow attacks
    return sanitized.substring(0, 1000);
  }
}

/**
 * Amount Validation - Split into focused functions
 */
export class AmountValidation {
  /**
   * Validate basic amount format
   */
  static validateAmountFormat(amount: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!amount || typeof amount !== 'string') {
      errors.push('Amount must be a non-empty string');
      return { isValid: false, errors, warnings };
    }

    // Enhanced number format validation
    if (!/^\d+(\.\d+)?$/.test(amount.trim())) {
      errors.push('Amount must be a positive decimal number');
      return { isValid: false, errors, warnings };
    }

    return { isValid: true, errors, warnings };
  }

  /**
   * Validate amount ranges and limits
   */
  static validateAmountRange(amount: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const numAmount = parseFloat(amount);

    // Check for NaN, Infinity, etc.
    if (!Number.isFinite(numAmount)) {
      errors.push('Amount must be a finite number');
      return { isValid: false, errors, warnings };
    }

    // Enhanced range validation
    if (numAmount <= 0) {
      errors.push('Amount must be positive');
    }

    if (numAmount > 1000000000) { // 1 billion max
      errors.push('Amount exceeds maximum allowed value');
    }

    // Warn about very small amounts
    if (numAmount < 0.000001) {
      warnings.push('Amount is very small and may result in dust');
    }

    // Warn about very large amounts
    if (numAmount > 1000000) {
      warnings.push('Amount is very large - ensure sufficient liquidity');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate amount precision
   */
  static validateAmountPrecision(amount: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Precision validation (max 18 decimal places)
    const decimalParts = amount.split('.');
    if (decimalParts.length > 1 && decimalParts[1].length > 18) {
      errors.push('Amount has too many decimal places (max 18)');
    }

    // Check for scientific notation which could cause API parsing issues
    if (amount.includes('e') || amount.includes('E')) {
      errors.push('Scientific notation not allowed - use decimal format');
    }

    // Check for leading zeros which could cause parsing issues
    if (amount.match(/^0+\d/)) {
      errors.push('Remove leading zeros - use format like "0.123" not "00.123"');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }
}

/**
 * Address Validation - Split into focused functions
 */
export class AddressValidation {
  /**
   * Validate basic address format
   */
  static validateAddressFormat(address: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!address || typeof address !== 'string') {
      errors.push('Address must be a non-empty string');
      return { isValid: false, errors, warnings };
    }

    const trimmedAddress = address.trim();

    // Check for dangerous patterns while allowing valid address characters
    const dangerousPatterns = [
      /<script/i, /<\/script>/i, /javascript:/i, /data:/i, /vbscript:/i,
      /onload/i, /onerror/i, /onclick/i, /eval\s*\(/i, /function\s*\(/i,
      /\.\.\//g, /\\\.\.\\/, /&&/, /;\s*\w+/
    ];

    if (dangerousPatterns.some(pattern => pattern.test(trimmedAddress))) {
      errors.push('Address contains potentially unsafe characters');
      return { isValid: false, errors, warnings };
    }

    // Check length constraints
    if (trimmedAddress.length > 100) {
      errors.push('Address too long (max 100 characters)');
    }

    return { isValid: true, errors, warnings };
  }

  /**
   * Validate GalaChain address specifics
   */
  static validateGalaChainAddress(address: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const trimmedAddress = address.trim();

    // Check GalaChain address format (eth|address)
    if (!trimmedAddress.startsWith('eth|')) {
      errors.push('Address must start with "eth|" for GalaChain');
      return { isValid: false, errors, warnings };
    }

    const ethAddress = trimmedAddress.substring(4);

    if (ethAddress.length !== 42) {
      errors.push('Invalid Ethereum address length (must be 42 characters)');
    } else if (!ethAddress.startsWith('0x')) {
      errors.push('Ethereum address must start with 0x');
    } else if (!/^0x[a-fA-F0-9]{40}$/.test(ethAddress)) {
      errors.push('Invalid Ethereum address format (must be hex)');
    } else {
      // Additional Ethereum address validation
      const hexPart = ethAddress.substring(2);
      if (hexPart === '0'.repeat(40)) {
        errors.push('Cannot use zero address');
      }

      // Check for obvious patterns that might indicate test/invalid addresses
      if (/^(1{40}|f{40}|a{40}|b{40}|c{40}|d{40}|e{40})$/i.test(hexPart)) {
        warnings.push('Address appears to be a test or placeholder address');
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }
}