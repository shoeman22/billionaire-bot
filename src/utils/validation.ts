/**
 * Input Validation Utilities
 * Comprehensive validation for trading parameters and user inputs
 */

import { TokenFormatter } from './formatting';
import { TRADING_CONSTANTS } from '../config/constants';

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

    const trimmedToken = this.sanitizeInput(token);

    // Check if it's a known token symbol
    const knownTokens = Object.values(TRADING_CONSTANTS.TOKENS) as string[];
    if (knownTokens.includes(trimmedToken.toUpperCase())) {
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
      // Assume it's a symbol - validate format with stricter rules
      if (!/^[A-Za-z0-9]{1,10}$/.test(trimmedToken)) {
        errors.push('Token symbol must be alphanumeric, 1-10 characters');
      }

      if (trimmedToken.length > 10) {
        errors.push('Token symbol too long (max 10 characters)');
      }

      // Check for potentially malicious patterns
      const maliciousPatterns = [
        /javascript/i, /script/i, /eval/i, /function/i, /return/i,
        /<|>|"|'|&|\\|\//g, /\.\./, /\/\//, /\*/, /--/
      ];

      for (const pattern of maliciousPatterns) {
        if (pattern.test(trimmedToken)) {
          errors.push('Token contains potentially unsafe characters');
          break;
        }
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Check if token follows GalaChain format
   */
  private static isGalaChainTokenFormat(token: string): boolean {
    return /^[A-Z0-9]+\$[A-Z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/.test(token);
  }

  /**
   * Validate GalaChain token format: Collection$Category$Type$AdditionalKey
   * Enhanced validation to prevent malformed API calls that could waste money
   */
  static validateTokenFormat(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!token || typeof token !== 'string') {
      errors.push('Token must be a non-empty string');
      return { isValid: false, errors, warnings };
    }

    const parts = token.split('$');

    if (parts.length !== 4) {
      errors.push('Token must follow format: Collection$Category$Type$AdditionalKey');
      return { isValid: false, errors, warnings };
    }

    const [collection, category, type, additionalKey] = parts;

    // Validate each component
    if (!this.validateTokenComponent(collection, 'Collection')) {
      errors.push('Invalid Collection component (must be alphanumeric, 1-20 chars)');
    }

    if (!this.validateTokenComponent(category, 'Category')) {
      errors.push('Invalid Category component (must be alphanumeric, 1-20 chars)');
    }

    if (!this.validateTokenComponent(type, 'Type')) {
      errors.push('Invalid Type component (must be alphanumeric, 1-20 chars)');
    }

    if (!this.validateTokenComponent(additionalKey, 'AdditionalKey')) {
      errors.push('Invalid AdditionalKey component (must be alphanumeric, 1-20 chars)');
    }

    // Check for path traversal attempts
    if (token.includes('..') || token.includes('/') || token.includes('\\')) {
      errors.push('Token contains invalid path characters');
    }

    // Check total length
    if (token.length > 100) {
      errors.push('Token identifier too long (max 100 characters)');
    }

    // Additional validation for API safety
    if (errors.length === 0) {
      // Check that token doesn't contain control characters that could break API calls
      if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(token)) {
        errors.push('Token contains control characters that could cause API failures');
      }

      // Ensure token parts don't start/end with special characters
      const parts = token.split('$');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].startsWith('-') || parts[i].endsWith('-') ||
            parts[i].startsWith('_') || parts[i].endsWith('_')) {
          errors.push(`Token component ${i + 1} has invalid start/end characters`);
        }
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate individual token component
   */
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

    const sanitizedAmount = this.sanitizeInput(amount);

    // Check for injection attempts
    if (sanitizedAmount !== amount) {
      errors.push('Amount contains potentially unsafe characters');
      return { isValid: false, errors, warnings };
    }

    // Enhanced number format validation
    if (!/^\d+(\.\d+)?$/.test(sanitizedAmount)) {
      errors.push('Amount must be a positive decimal number');
      return { isValid: false, errors, warnings };
    }

    const numAmount = parseFloat(sanitizedAmount);

    // Check for NaN, Infinity, etc.
    if (!Number.isFinite(numAmount)) {
      errors.push('Amount must be a finite number');
      return { isValid: false, errors, warnings };
    }

    // Enhanced range validation
    if (numAmount <= 0) {
      errors.push('Amount must be positive');
    }

    if (numAmount < TRADING_CONSTANTS.MIN_TRADE_AMOUNT) {
      errors.push(`Amount below minimum: ${TRADING_CONSTANTS.MIN_TRADE_AMOUNT}`);
    }

    if (numAmount > 1000000000) { // 1 billion max
      errors.push('Amount exceeds maximum allowed value');
    }

    // Precision validation (max 18 decimal places)
    const decimalParts = sanitizedAmount.split('.');
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
    // Check for scientific notation which could cause API parsing issues
    if (sanitizedAmount.includes('e') || sanitizedAmount.includes('E')) {
      errors.push('Scientific notation not allowed - use decimal format');
    }

    // Check for leading zeros which could cause parsing issues
    if (sanitizedAmount.match(/^0+\d/)) {
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

    const sanitizedAddress = this.sanitizeInput(address);

    // Check for injection attempts
    if (sanitizedAddress !== address.trim()) {
      errors.push('Address contains potentially unsafe characters');
      return { isValid: false, errors, warnings };
    }

    const trimmedAddress = sanitizedAddress.trim();

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
      const addressValidation = this.validateAddress(process.env.WALLET_ADDRESS);
      errors.push(...addressValidation.errors.map(e => `WALLET_ADDRESS: ${e}`));
    }

    // Check for development environment warnings
    if (process.env.NODE_ENV === 'development') {
      warnings.push('Running in development mode');
    }

    // Validate URLs
    if (process.env.GALASWAP_API_URL && !this.isValidUrl(process.env.GALASWAP_API_URL)) {
      errors.push('Invalid GALASWAP_API_URL format');
    }

    if (process.env.GALASWAP_WS_URL && !this.isValidUrl(process.env.GALASWAP_WS_URL)) {
      errors.push('Invalid GALASWAP_WS_URL format');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Utility to validate URL format
   */
  private static isValidUrl(url: string): boolean {
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

    return input
      .trim()
      // Remove potentially dangerous characters for injection attacks
      .replace(/[<>"'&\\\/#%\|;`\x00-\x1F\x7F-\x9F]/g, '')
      // Remove Unicode control characters
      .replace(/[\u0000-\u001F\u007F-\u009F\u2000-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/g, '')
      // Remove potential script injection patterns
      .replace(/(javascript|data|vbscript|onload|onerror|eval|script):/gi, '')
      // Limit length to prevent buffer overflow attacks
      .substring(0, 1000);
  }

  /**
   * Validate string contains only safe characters
   */
  static isSafeString(input: string): boolean {
    if (typeof input !== 'string') {
      return false;
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /<script/i, /<\/script>/i, /javascript:/i, /data:/i, /vbscript:/i,
      /onload/i, /onerror/i, /onclick/i, /onmouseover/i,
      /eval\s*\(/i, /function\s*\(/i, /return\s+/i,
      /\.\.\//g, /\\\.\.\\/, /\|\|/, /&&/, /;\s*\w+/, /\|\s*\w+/
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

    } catch (error) {
      errors.push('Invalid JSON format');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Basic schema validation (can be extended with a proper JSON schema library)
   */
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