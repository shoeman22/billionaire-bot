/**
 * Input Validation Utilities
 * Comprehensive validation for trading parameters and user inputs
 */

// import { TokenFormatter } from './formatting'; // Unused - commenting out to fix linting
import { TRADING_CONSTANTS } from '../config/constants';
import { safeParseFloat } from './safe-parse';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface TradeValidationParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageTolerance?: number;
  userAddress?: string;
}

export interface LiquidityValidationParams {
  token0: string;
  token1: string;
  amount0: string;
  amount1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
}

export class InputValidator {
  /**
   * Validate a trading operation
   */
  static validateTrade(params: TradeValidationParams): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate token addresses
    const tokenValidation = this.validateTokens(params.tokenIn, params.tokenOut);
    errors.push(...tokenValidation.errors);
    warnings.push(...tokenValidation.warnings);

    // Validate amount
    const amountValidation = this.validateAmount(params.amountIn);
    errors.push(...amountValidation.errors);
    warnings.push(...amountValidation.warnings);

    // Validate slippage tolerance
    if (params.slippageTolerance !== undefined) {
      const slippageValidation = this.validateSlippageTolerance(params.slippageTolerance);
      errors.push(...slippageValidation.errors);
      warnings.push(...slippageValidation.warnings);
    }

    // Validate user address
    if (params.userAddress) {
      const addressValidation = this.validateAddress(params.userAddress);
      errors.push(...addressValidation.errors);
      warnings.push(...addressValidation.warnings);
    }

    // Check for same token swap
    if (params.tokenIn.toLowerCase() === params.tokenOut.toLowerCase()) {
      errors.push('Cannot swap same token');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate liquidity operation
   */
  static validateLiquidity(params: LiquidityValidationParams): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate tokens
    const tokenValidation = this.validateTokens(params.token0, params.token1);
    errors.push(...tokenValidation.errors);
    warnings.push(...tokenValidation.warnings);

    // Validate amounts
    const amount0Validation = this.validateAmount(params.amount0);
    errors.push(...amount0Validation.errors.map(e => `Amount0: ${e}`));
    warnings.push(...amount0Validation.warnings.map(w => `Amount0: ${w}`));

    const amount1Validation = this.validateAmount(params.amount1);
    errors.push(...amount1Validation.errors.map(e => `Amount1: ${e}`));
    warnings.push(...amount1Validation.warnings.map(w => `Amount1: ${w}`));

    // Validate fee tier
    const feeValidation = this.validateFeeTier(params.fee);
    errors.push(...feeValidation.errors);
    warnings.push(...feeValidation.warnings);

    // Validate tick range
    const tickValidation = this.validateTickRange(params.tickLower, params.tickUpper);
    errors.push(...tickValidation.errors);
    warnings.push(...tickValidation.warnings);

    // Check for same token
    if (params.token0.toLowerCase() === params.token1.toLowerCase()) {
      errors.push('Cannot provide liquidity for same token pair');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate token symbols/addresses
   */
  static validateTokens(tokenA: string, tokenB: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate individual tokens
    const tokenAValidation = this.validateToken(tokenA);
    errors.push(...tokenAValidation.errors.map(e => `TokenA: ${e}`));
    warnings.push(...tokenAValidation.warnings.map(w => `TokenA: ${w}`));

    const tokenBValidation = this.validateToken(tokenB);
    errors.push(...tokenBValidation.errors.map(e => `TokenB: ${e}`));
    warnings.push(...tokenBValidation.warnings.map(w => `TokenB: ${w}`));

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate a single token - Enhanced with GalaChain format validation
   */
  static validateToken(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!token || token.trim() === '') {
      errors.push('Token cannot be empty');
      return { isValid: false, errors, warnings };
    }

    const trimmedToken = token.trim();

    // Check for injection patterns first
    const injectionPatterns = [
      /javascript:/i, /<script/i, /<\/script>/i, /eval\s*\(/i, /function\s*\(/i,
      /\.\.\//g, /\\\.\.\\/, /rm\s+-rf/i, /onload/i, /onerror/i
    ];

    if (injectionPatterns.some(pattern => pattern.test(trimmedToken))) {
      errors.push('Token contains potentially unsafe characters');
      return { isValid: false, errors, warnings };
    }

    // Check if it's a known token symbol (exact match)
    const knownTokens = Object.values(TRADING_CONSTANTS.TOKENS) as string[];
    if (knownTokens.includes(trimmedToken)) {
      return { isValid: true, errors, warnings };
    }

    // Check GalaChain token format: Collection$Category$Type$AdditionalKey
    if (this.isGalaChainTokenFormat(trimmedToken)) {
      const tokenValidation = this.validateTokenFormat(trimmedToken);
      errors.push(...tokenValidation.errors);
      warnings.push(...tokenValidation.warnings);
    }
    // Check if it looks like an Ethereum address (starts with 0x and 42 chars)
    else if (trimmedToken.startsWith('0x')) {
      if (trimmedToken.length !== 42) {
        errors.push('Invalid address length (must be 42 characters)');
      } else if (!/^0x[a-fA-F0-9]{40}$/.test(trimmedToken)) {
        errors.push('Invalid address format (must be hex)');
      }
    } else {
      // For any other format, it's considered invalid for GalaChain
      // We only accept: known tokens, proper GalaChain format, or ETH addresses
      errors.push('Invalid token format. Must be a known token symbol, proper GalaChain format (Collection$Category$Type$AdditionalKey), or valid Ethereum address');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Check if token follows GalaChain format
   */
  private static isGalaChainTokenFormat(token: string): boolean {
    return /^[A-Za-z0-9]+\|[A-Za-z0-9]+(?:\|[A-Za-z0-9:$]+){1,2}$/.test(token);
  }

  /**
   * Validate GalaChain token format: Collection|Category|Type|AdditionalKey
   * HIGH PRIORITY FIX: Enhanced validation to prevent edge cases and malformed API calls
   */
  static validateTokenFormat(token: string): ValidationResult {
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

    // CRITICAL: Check for dangerous characters before parsing (note: | is allowed as delimiter)
    if (/[<>"'`&;\n\r\t]/.test(trimmedToken)) {
      errors.push('Token contains unsafe characters that could cause injection attacks');
      return { isValid: false, errors, warnings };
    }

    // CRITICAL: Split validation
    const parts = trimmedToken.split('|');
    if (parts.length < 3 || parts.length > 4) {
      errors.push(`Invalid format: expected 3-4 parts separated by '|', got ${parts.length} parts. Format: Collection|Category|Type|AdditionalKey`);
      return { isValid: false, errors, warnings };
    }

    const [collection, category, type, additionalKey] = parts;

    // CRITICAL: Check for empty components
    const componentNames = ['Collection', 'Category', 'Type', 'AdditionalKey'];
    const components = [collection, category, type, additionalKey];

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

    // CRITICAL: Case sensitivity check - GalaChain tokens should follow PascalCase pattern
    // Collection should be uppercase (GALA, GUSDC, etc.)
    // Category should be PascalCase (Unit, etc.)
    // Type and AdditionalKey should follow proper case (none, etc.)
    if (collection !== collection.toUpperCase()) {
      errors.push('Collection component must be uppercase (e.g., GALA, GUSDC)');
    }
    if (category !== 'Unit') {
      warnings.push('Category component should typically be "Unit" for standard tokens');
    }

    // CRITICAL: Security checks for injection attacks
    const securityChecks = [
      { pattern: /\.\./, message: 'invalid path traversal attempt detected (..)' },
      { pattern: /[/\\]/, message: 'unsafe file system path characters detected' },
      { pattern: /javascript:/i, message: 'invalid JavaScript protocol detected' },
      { pattern: /data:/i, message: 'invalid data protocol detected' },
      { pattern: /vbscript:/i, message: 'unsafe VBScript protocol detected' },
      { pattern: /<script/i, message: 'unsafe script tag detected' },
      { pattern: /eval\s*\(/i, message: 'unsafe eval function detected' },
      { pattern: /function\s*\(/i, message: 'invalid function declaration detected' },
      { pattern: /\${/, message: 'unsafe template literal injection detected' },
      { pattern: /\[\[|\]\]/, message: 'invalid double bracket injection detected' },
      { pattern: /\x00|\x08|\x0B|\x0C|\x0E|\x1F|\x7F/, message: 'invalid control characters detected' },
      { pattern: /\\[nrtbfav]/, message: 'invalid escape sequence detected' }
    ];

    for (const check of securityChecks) {
      if (check.pattern.test(trimmedToken)) {
        errors.push(`Security violation: ${check.message}`);
      }
    }

    // CRITICAL: Length validation (prevent DoS)
    if (trimmedToken.length > 80) {
      errors.push(`Token too long: ${trimmedToken.length} characters (max 80)`);
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
      if (components[i] && reservedWords.includes(components[i].toLowerCase())) {
        errors.push(`${componentNames[i]} cannot be a reserved word: ${components[i]}`);
      }
    }

    // CRITICAL: API safety validation
    if (errors.length === 0) {
      // Check for URL encoding that could bypass validation
      if (/%[0-9A-Fa-f]{2}/.test(trimmedToken)) {
        errors.push('URL-encoded characters detected - potential bypass attempt');
      }

      // Check for Unicode normalization issues
      if (trimmedToken !== trimmedToken.normalize('NFC')) {
        warnings.push('Token contains non-normalized Unicode characters');
      }

      // Validate character set for each component
      for (let i = 0; i < components.length; i++) {
        const component = components[i];
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(component)) {
          errors.push(`${componentNames[i]} has invalid format: must start and end with alphanumeric, can contain '_' and '-' in middle`);
        }
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate individual token component
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static validateTokenComponent(component: string, componentName: string): boolean {
    if (!component || component.length === 0) {
      return false;
    }

    if (component.length > 20) {
      return false;
    }

    // Allow alphanumeric and specific safe characters for GalaChain
    if (!/^[A-Za-z0-9-_]+$/.test(component)) {
      return false;
    }

    // Prevent common injection patterns
    const dangerousPatterns = [
      /\.\./, /\//, /\\/, /</, />/, /"/, /'/, /&/, /;/, /\|/, /`/,
      /javascript/i, /script/i, /eval/i, /function/i, /return/i
    ];

    return !dangerousPatterns.some(pattern => pattern.test(component));
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

  /**
   * Validate trading amount with enhanced security checks
   * Prevents malformed amounts that could cause expensive API failures
   */
  static validateTradingAmount(amount: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!amount || typeof amount !== 'string') {
      errors.push('Amount must be a non-empty string');
      return { isValid: false, errors, warnings };
    }

    const sanitizedAmount = InputValidator.sanitizeInput(amount);

    // Check for injection attempts
    if (sanitizedAmount !== amount) {
      errors.push('Amount contains potentially unsafe characters');
      return { isValid: false, errors, warnings };
    }

    // Convert scientific notation to decimal format before validation
    let processedAmount = sanitizedAmount;
    if (sanitizedAmount.includes('e') || sanitizedAmount.includes('E')) {
      try {
        const numValue = parseFloat(sanitizedAmount);
        if (Number.isFinite(numValue) && numValue > 0) {
          processedAmount = numValue.toString();
        } else {
          errors.push('Invalid scientific notation format');
          return { isValid: false, errors, warnings };
        }
      } catch {
        errors.push('Invalid scientific notation format');
        return { isValid: false, errors, warnings };
      }
    }

    // Enhanced number format validation
    if (!/^\d+(\.\d+)?$/.test(processedAmount)) {
      errors.push('Invalid amount format');
      return { isValid: false, errors, warnings };
    }

    const numAmount = safeParseFloat(processedAmount, 0);

    // Check for NaN, Infinity, etc.
    if (!Number.isFinite(numAmount)) {
      errors.push('Amount must be a finite number');
      return { isValid: false, errors, warnings };
    }

    // Enhanced range validation
    if (numAmount <= 0) {
      errors.push('Amount must be greater than zero');
    }

    if (numAmount < TRADING_CONSTANTS.MIN_TRADE_AMOUNT) {
      warnings.push(`Amount below recommended minimum: ${TRADING_CONSTANTS.MIN_TRADE_AMOUNT}`);
    }

    if (numAmount > 1000000000) { // 1 billion max
      errors.push('Amount exceeds maximum allowed value');
    }

    // Precision validation (max 18 decimal places)
    const decimalParts = processedAmount.split('.');
    if (decimalParts.length > 1 && decimalParts[1].length > 18) {
      errors.push('Amount has too many decimal places (max 18)');
    }

    // Warn about very small amounts
    if (numAmount < 0.000001) {
      warnings.push('Amount is very small and may result in dust');
    }

    // Warn about very large amounts
    if (numAmount > 1000000) {
      warnings.push('Amount is very large - ensure sufficient liquidity');
    }

    // Enhanced bounds checking for API safety

    // Check for leading zeros which could cause parsing issues
    if (processedAmount.match(/^0+\d/)) {
      errors.push('Remove leading zeros - use format like "0.123" not "00.123"');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Legacy amount validation (backwards compatibility)
   */
  static validateAmount(amount: string): ValidationResult {
    return this.validateTradingAmount(amount);
  }

  /**
   * Validate slippage tolerance with enhanced bounds checking
   * Prevents crazy slippage that would lose money
   */
  static validateSlippage(slippage: number): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Type validation
    if (typeof slippage !== 'number') {
      errors.push('Slippage must be a number');
      return { isValid: false, errors, warnings };
    }

    // Check for NaN, Infinity
    if (!Number.isFinite(slippage)) {
      errors.push('Slippage must be a finite number');
      return { isValid: false, errors, warnings };
    }

    // Range validation (0-100%)
    if (slippage < 0) {
      errors.push('Slippage tolerance cannot be negative');
    }

    if (slippage > 1.0) { // 100%
      errors.push('Slippage tolerance cannot exceed 100%');
    }

    if (slippage > TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT / 100) {
      errors.push(`Slippage tolerance too high (max ${TRADING_CONSTANTS.MAX_SLIPPAGE_PERCENT}%)`);
    }

    // Precision check
    const precision = slippage.toString().split('.')[1];
    if (precision && precision.length > 6) {
      warnings.push('Slippage precision beyond 6 decimal places may be ignored');
    }

    // Warning thresholds
    if (slippage < 0.0001) { // 0.01%
      warnings.push('Very low slippage tolerance may cause transaction failures');
    }

    if (slippage > 0.05) { // 5%
      warnings.push('High slippage tolerance increases MEV risk');
    }

    if (slippage > 0.1) { // 10%
      warnings.push('Extremely high slippage - consider if this is intentional');
    }

    // Additional safety checks for expensive mistakes
    if (slippage > 0.5) { // 50%
      errors.push('Slippage above 50% is dangerous and could result in significant loss');
    }

    if (slippage === 1.0) { // 100%
      errors.push('100% slippage means you accept any price - this is extremely dangerous');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Legacy slippage validation (backwards compatibility)
   */
  static validateSlippageTolerance(slippage: number): ValidationResult {
    return this.validateSlippage(slippage);
  }

  /**
   * Validate wallet address with enhanced security
   */
  static validateAddress(address: string): ValidationResult {
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

    // Check GalaChain address format (eth|address)
    if (trimmedAddress.startsWith('eth|')) {
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
    } else {
      errors.push('Address must start with "eth|" for GalaChain');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate fee tier with type checking
   * Ensures only valid GalaSwap fee tiers (500, 3000, 10000) to prevent API failures
   */
  static validateFee(fee: number): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Type validation
    if (typeof fee !== 'number') {
      errors.push('Fee tier must be a number');
      return { isValid: false, errors, warnings };
    }

    // Check for NaN, Infinity
    if (!Number.isFinite(fee)) {
      errors.push('Fee tier must be a finite number');
      return { isValid: false, errors, warnings };
    }

    // Must be a positive integer
    if (!Number.isInteger(fee) || fee <= 0) {
      errors.push('Fee tier must be a positive integer');
    }

    // CRITICAL: Only allow exact GalaSwap fee tiers
    const validFees = [500, 3000, 10000]; // These are the ONLY valid GalaSwap fee tiers

    if (!validFees.includes(fee)) {
      errors.push(`Invalid fee tier. Must be exactly 500, 3000, or 10000 (not ${fee}). These are the only valid GalaSwap fee tiers.`);
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Legacy method for backwards compatibility
   */
  static validateFeeTier(fee: number): ValidationResult {
    return this.validateFee(fee);
  }

  /**
   * Validate tick range for liquidity positions
   */
  static validateTickRange(tickLower: number, tickUpper: number): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (tickLower >= tickUpper) {
      errors.push('Lower tick must be less than upper tick');
    }

    if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
      errors.push('Ticks must be integers');
    }

    // Check for reasonable tick range
    const tickSpacing = tickUpper - tickLower;
    if (tickSpacing < 10) {
      warnings.push('Very narrow tick range may result in frequent rebalancing');
    }

    if (tickSpacing > 10000) {
      warnings.push('Very wide tick range may result in low fee collection');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate environment configuration
   */
  static validateEnvironment(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required environment variables
    const required = [
      'WALLET_ADDRESS',
      'WALLET_PRIVATE_KEY',
      'GALASWAP_API_URL',
      'GALASWAP_WS_URL',
    ];

    for (const envVar of required) {
      if (!process.env[envVar]) {
        errors.push(`Missing environment variable: ${envVar}`);
      }
    }

    // Validate wallet address format
    if (process.env.WALLET_ADDRESS) {
      const addressValidation = InputValidator.validateAddress(process.env.WALLET_ADDRESS);
      errors.push(...addressValidation.errors.map(e => `WALLET_ADDRESS: ${e}`));
    }

    // Check for development environment warnings
    if (process.env.NODE_ENV === 'development') {
      warnings.push('Running in development mode');
    }

    // Validate URLs
    if (process.env.GALASWAP_API_URL && !InputValidator.isValidUrl(process.env.GALASWAP_API_URL)) {
      errors.push('Invalid GALASWAP_API_URL format');
    }

    if (process.env.GALASWAP_WS_URL && !InputValidator.isValidUrl(process.env.GALASWAP_WS_URL)) {
      errors.push('Invalid GALASWAP_WS_URL format');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Utility to validate URL format
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Enhanced input sanitization for security
   */
  static sanitizeInput(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    let sanitized = input.trim();

    // Remove command injection patterns more aggressively
    sanitized = sanitized
      .replace(/\$\([^)]*\)/g, '')  // Remove $() command substitution
      .replace(/\$\{[^}]*\}/g, '')  // Remove ${} variable substitution
      .replace(/\$\(\([^)]*\)\)/g, '')  // Remove $(()) arithmetic expansion
      .replace(/`[^`]*`/g, '')  // Remove backtick command substitution

      // Remove SQL injection patterns more thoroughly
      .replace(/\b(DROP|DELETE|INSERT|UPDATE|SELECT|UNION|ALTER|CREATE|EXEC|EXECUTE|TRUNCATE|MERGE)\b/gi, '')
      .replace(/\b(TABLE|FROM|INTO|WHERE|OR|AND|ORDER|BY|GROUP|HAVING|LIMIT)\b/gi, '')
      .replace(/('.*?'|\b\d+\b)\s*(=|!=|<>|<|>|<=|>=)\s*('.*?'|\b\d+\b)/gi, '')
      .replace(/'(\s*OR\s*'1'\s*=\s*'1|--|\s*UNION\s*)/gi, '')
      .replace(/--[\s\S]*$/gm, '')  // Remove SQL comments more thoroughly
      .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove SQL block comments
      .replace(/;\s*(DROP|DELETE|INSERT|UPDATE)/gi, '')
      .replace(/\bUSERS\b/gi, '')  // Remove potentially dangerous table names

      // Remove NoSQL injection patterns completely
      .replace(/\$\w+/g, '')  // Remove ALL MongoDB operators
      .replace(/\{\s*\$\w+:/g, '{')  // Remove object patterns with $ operators
      .replace(/\$ne|\$regex|\$where|\$gt|\$lt|\$gte|\$lte|\$in|\$nin|\$exists|\$type/gi, '')

      // Remove XSS patterns more completely
      .replace(/<\s*(script|iframe|object|embed|applet|form|svg|style|link|meta)[^>]*>/gi, '')
      .replace(/<\/\s*(script|iframe|object|embed|applet|form|svg|style|link|meta)[^>]*>/gi, '')
      .replace(/\b(on\w+|javascript:|data:|vbscript:|file:|ftp:)/gi, '')
      .replace(/(onerror|onload|onclick|onmouseover|onfocus|onblur|onchange|onsubmit)\s*=/gi, '')
      .replace(/(alert|confirm|prompt|eval|Function|setTimeout|setInterval)\s*\(/gi, '')
      .replace(/alert\s*\(\s*\d+\s*\)/gi, '')  // Remove alert(1) patterns specifically

      // Remove command injection words and patterns
      .replace(/\b(rm\s+-rf|\/etc\/passwd|\/bin\/sh|cmd\.exe|powershell|bash|sh|zsh)\b/gi, '')
      .replace(/\b(sudo|su|chmod|chown|kill|killall|ps|top|netstat|ifconfig)\b/gi, '')
      .replace(/\b(system32|windows|config|sam)\b/gi, '')  // Remove Windows system paths

      // Remove potentially dangerous characters for injection attacks
       
      .replace(/[<>"'&\\\/#%\|;`\x00-\x1F\x7F-\x9F]/g, '')

      // Remove Unicode control characters and full-width characters
       
      .replace(/[\u0000-\u001F\u007F-\u009F\u2000-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/g, '')
      .replace(/[\uFF00-\uFFEF]/g, '')  // Remove full-width characters (used in Unicode attacks)

      // Additional XSS removal after Unicode normalization
      .replace(/script/gi, '')  // Remove any remaining script keywords
      .replace(/alert/gi, '')   // Remove any remaining alert keywords

      // Remove HTTP headers for request smuggling prevention more thoroughly
      .replace(/\b(HTTP\/\d\.\d|Transfer-Encoding|Content-Length|Host|Connection|Cache-Control|Content-Type)[\s:]/gi, '')
      .replace(/Transfer-Encoding/gi, '')  // More aggressive Transfer-Encoding removal
      .replace(/Content-Length/gi, '')  // More aggressive Content-Length removal
      .replace(/HTTP\d?\.\d?/gi, '')

      // Remove sensitive data patterns (private keys, passwords, etc.)
      .replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED]')  // 64-char hex strings (private keys)
      .replace(/password[^:]*:[^,}]*/gi, 'password:[REDACTED]')
      .replace(/apikey[^:]*:[^,}]*/gi, 'apikey:[REDACTED]')
      .replace(/privatekey[^:]*:[^,}]*/gi, 'privatekey:[REDACTED]')

      // Remove file paths that could leak system information - more aggressive
      .replace(/\/home\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/C:\\Users\\[^\s,})")"]*/g, 'C:\\[REDACTED]')
      .replace(/\/usr\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/\/var\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/\/opt\/[^\s,})")"]*/g, '/[REDACTED]')
      .replace(/\/tmp\/[^\s,})")"]*/g, '/[REDACTED]');

    // Additional sanitization for stack traces
    sanitized = InputValidator.sanitizeStackTrace(sanitized);

    // Limit length to prevent buffer overflow attacks
    return sanitized.substring(0, 1000);
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
   * Validate string contains only safe characters
   */
  static isSafeString(input: string): boolean {
    if (typeof input !== 'string') {
      return false;
    }

    // Check for dangerous patterns - allow $ and | for GalaChain formats
    const dangerousPatterns = [
      /<script/i, /<\/script>/i, /javascript:/i, /data:/i, /vbscript:/i,
      /onload/i, /onerror/i, /onclick/i, /onmouseover/i,
      /eval\s*\(/i, /function\s*\(/i, /return\s+/i,
      /\.\.\//g, /\\\.\.\\/, /&&/, /;\s*\w+/, /rm\s+-rf/i
      // Removed /\|\|/ and /\|\s*\w+/ to allow single | characters in addresses
    ];

    return !dangerousPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Validate numeric string format
   */
  static isValidNumericString(input: string): boolean {
    if (typeof input !== 'string' || input.trim() === '') {
      return false;
    }

    // Must be a positive decimal number
    const numericPattern = /^\d+(\.\d+)?$/;
    return numericPattern.test(input.trim());
  }

  /**
   * Validate JSON structure
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static validateJson(jsonString: string, expectedSchema?: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const parsed = JSON.parse(jsonString);

      if (expectedSchema) {
        // Basic schema validation (can be extended)
        const schemaValidation = this.validateAgainstSchema(parsed, expectedSchema);
        errors.push(...schemaValidation.errors);
        warnings.push(...schemaValidation.warnings);
      }

    } catch (_error) {
      errors.push('Invalid JSON format');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Basic schema validation (can be extended with a proper JSON schema library)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static validateAgainstSchema(data: any, schema: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // This is a basic implementation - could be replaced with ajv or similar
    for (const [key, expectedType] of Object.entries(schema)) {
      if (!(key in data)) {
        errors.push(`Missing required field: ${key}`);
      } else if (typeof data[key] !== expectedType) {
        errors.push(`Field ${key} has incorrect type: expected ${expectedType}, got ${typeof data[key]}`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

}

/**
 * Sanitize error messages to remove sensitive information
 * Prevents private keys, mnemonics, and other sensitive data from appearing in logs
 */
export const sanitizeErrorMessage = (errorMessage: string): string => {
  if (typeof errorMessage !== 'string') {
    return '[INVALID_ERROR_MESSAGE]';
  }

  let sanitized = errorMessage;

  // Remove private keys (64-character hex strings)
  sanitized = sanitized.replace(/\b[0-9a-fA-F]{64}\b/g, '[PRIVATE_KEY_REDACTED]');

  // Remove potential private keys with 0x prefix
  sanitized = sanitized.replace(/\b0x[0-9a-fA-F]{64}\b/g, '[PRIVATE_KEY_REDACTED]');

  // Remove mnemonic phrases (12 or 24 words)
  sanitized = sanitized.replace(/\b(?:\w+\s+){11}\w+\b/g, '[MNEMONIC_REDACTED]');
  sanitized = sanitized.replace(/\b(?:\w+\s+){23}\w+\b/g, '[MNEMONIC_REDACTED]');

  // Remove potential API keys and secrets
  sanitized = sanitized.replace(/(["`'](?:api[_-]?key|secret|token|password)["`']?\s*[:=]\s*["`'][^"`']+["`'])/gi, '$1[REDACTED]');
  sanitized = sanitized.replace(/(\b(?:api[_-]?key|secret|token|password)\b[^:\s]*[:=]\s*)([^\s,}\])"']+)/gi, '$1[REDACTED]');

  // Remove file paths that might contain usernames
  sanitized = sanitized.replace(/\/home\/[^\s,}\])"']+/g, '/home/[REDACTED]');
  sanitized = sanitized.replace(/C:\\Users\\[^\s,}\])"']+/g, 'C:\\Users\\[REDACTED]');

  // Remove potential wallet addresses
  sanitized = sanitized.replace(/\beth\|0x[0-9a-fA-F]{40}\b/g, 'eth|[WALLET_REDACTED]');

  // Remove any Base64-encoded data that might be sensitive
  sanitized = sanitized.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[BASE64_DATA_REDACTED]');

  return sanitized;
};

// Export static methods as standalone functions for test compatibility
export const sanitizeInput = InputValidator.sanitizeInput;
export const validateEnvironmentVariables = InputValidator.validateEnvironment;
export const validatePrivateKey = (key: string | null | undefined): boolean => {
  if (!key) return false;
  const keyStr = key.startsWith('0x') ? key.substring(2) : key;
  return /^[0-9a-fA-F]{64}$/.test(keyStr);
};