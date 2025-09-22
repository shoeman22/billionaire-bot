/**
 * API Response Parser - Comprehensive Error Handling
 *
 * Provides safe parsing of API responses with comprehensive error handling,
 * validation, and structured error reporting.
 */

import { logger } from './logger';

export interface ApiResponseError {
  code: string;
  message: string;
  details?: unknown;
  field?: string;
  path?: string;
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: ApiResponseError;
  warnings?: string[];
}

export interface ParseOptions {
  required?: string[];
  optional?: string[];
  validators?: Record<string, (value: unknown) => boolean>;
  transformers?: Record<string, (value: unknown) => unknown>;
  strict?: boolean; // Fail on unknown properties
  logErrors?: boolean;
}

/**
 * Safe API Response Parser with comprehensive error handling
 */
export class ApiResponseParser {

  /**
   * Parse API response with comprehensive validation
   */
  static parse<T>(
    response: unknown,
    options: ParseOptions = {}
  ): ParseResult<T> {
    const warnings: string[] = [];

    try {
      // Validate response exists
      if (response === null || response === undefined) {
        return this.createError('RESPONSE_NULL', 'API response is null or undefined');
      }

      // Validate response is an object
      if (typeof response !== 'object') {
        return this.createError(
          'RESPONSE_INVALID_TYPE',
          `Expected object, got ${typeof response}`,
          { actualType: typeof response, value: response }
        );
      }

      const data = response as Record<string, unknown>;

      // Check for API error structure
      const errorCheck = this.checkForApiError(data);
      if (errorCheck) {
        return errorCheck;
      }

      // Validate required fields
      if (options.required) {
        const missingFields = this.validateRequiredFields(data, options.required);
        if (missingFields.length > 0) {
          return this.createError(
            'MISSING_REQUIRED_FIELDS',
            `Missing required fields: ${missingFields.join(', ')}`,
            { missingFields }
          );
        }
      }

      // Validate field types with custom validators
      if (options.validators) {
        const validationError = this.validateFields(data, options.validators);
        if (validationError) {
          return validationError;
        }
      }

      // Transform fields if transformers provided
      let processedData = { ...data };
      if (options.transformers) {
        const transformResult = this.transformFields(processedData, options.transformers);
        if (!transformResult.success) {
          return transformResult as ParseResult<T>;
        }
        processedData = transformResult.data!;
      }

      // Check for unknown fields in strict mode
      if (options.strict) {
        const allowedFields = [...(options.required || []), ...(options.optional || [])];
        const unknownFields = Object.keys(processedData).filter(
          field => !allowedFields.includes(field)
        );

        if (unknownFields.length > 0) {
          warnings.push(`Unknown fields in strict mode: ${unknownFields.join(', ')}`);

          if (options.logErrors !== false) {
            logger.warn('API response contains unknown fields:', {
              unknownFields,
              allowedFields
            });
          }
        }
      }

      return {
        success: true,
        data: processedData as T,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';

      if (options.logErrors !== false) {
        logger.error('API response parsing failed:', error);
      }

      return this.createError(
        'PARSE_EXCEPTION',
        `Response parsing failed: ${errorMessage}`,
        { originalError: error }
      );
    }
  }

  /**
   * Parse nested API response data (common pattern: { data: { Data: ... } })
   */
  static parseNested<T>(
    response: unknown,
    path: string[],
    options: ParseOptions = {}
  ): ParseResult<T> {
    try {
      let current = response;

      for (let i = 0; i < path.length; i++) {
        const segment = path[i];

        if (!current || typeof current !== 'object') {
          return this.createError(
            'NESTED_PATH_INVALID',
            `Invalid path at segment "${segment}": expected object, got ${typeof current}`,
            {
              path: path.slice(0, i + 1).join('.'),
              segmentIndex: i,
              actualType: typeof current
            }
          );
        }

        const obj = current as Record<string, unknown>;
        if (!(segment in obj)) {
          return this.createError(
            'NESTED_PATH_MISSING',
            `Missing required path segment: ${path.slice(0, i + 1).join('.')}`,
            {
              path: path.slice(0, i + 1).join('.'),
              availableKeys: Object.keys(obj)
            }
          );
        }

        current = obj[segment];
      }

      return this.parse<T>(current, options);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (options.logErrors !== false) {
        logger.error('Nested API response parsing failed:', error);
      }

      return this.createError(
        'NESTED_PARSE_EXCEPTION',
        `Nested parsing failed at path "${path.join('.')}": ${errorMessage}`,
        { path: path.join('.'), originalError: error }
      );
    }
  }

  /**
   * Parse array response with validation for each item
   */
  static parseArray<T>(
    response: unknown,
    itemOptions: ParseOptions = {},
    arrayOptions: { minLength?: number; maxLength?: number } = {}
  ): ParseResult<T[]> {
    try {
      if (!Array.isArray(response)) {
        return this.createError(
          'RESPONSE_NOT_ARRAY',
          `Expected array, got ${typeof response}`,
          { actualType: typeof response }
        );
      }

      const array = response as unknown[];

      // Check array length constraints
      if (arrayOptions.minLength !== undefined && array.length < arrayOptions.minLength) {
        return this.createError(
          'ARRAY_TOO_SHORT',
          `Array length ${array.length} is below minimum ${arrayOptions.minLength}`,
          { actualLength: array.length, minLength: arrayOptions.minLength }
        );
      }

      if (arrayOptions.maxLength !== undefined && array.length > arrayOptions.maxLength) {
        return this.createError(
          'ARRAY_TOO_LONG',
          `Array length ${array.length} exceeds maximum ${arrayOptions.maxLength}`,
          { actualLength: array.length, maxLength: arrayOptions.maxLength }
        );
      }

      // Parse each array item
      const parsedItems: T[] = [];
      const errors: string[] = [];

      for (let i = 0; i < array.length; i++) {
        const itemResult = this.parse<T>(array[i], itemOptions);

        if (itemResult.success) {
          parsedItems.push(itemResult.data!);
        } else {
          errors.push(`Item ${i}: ${itemResult.error?.message || 'Unknown error'}`);
        }
      }

      if (errors.length > 0) {
        return this.createError(
          'ARRAY_ITEM_VALIDATION_FAILED',
          `Array item validation failed: ${errors.join('; ')}`,
          { itemErrors: errors, validItems: parsedItems.length }
        );
      }

      return {
        success: true,
        data: parsedItems
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (itemOptions.logErrors !== false) {
        logger.error('Array response parsing failed:', error);
      }

      return this.createError(
        'ARRAY_PARSE_EXCEPTION',
        `Array parsing failed: ${errorMessage}`,
        { originalError: error }
      );
    }
  }

  /**
   * Safe field extraction with type checking
   */
  static extractField<T>(
    data: unknown,
    fieldPath: string,
    typeCheck: (value: unknown) => value is T,
    defaultValue?: T
  ): T | undefined {
    try {
      const segments = fieldPath.split('.');
      let current = data;

      for (const segment of segments) {
        if (!current || typeof current !== 'object') {
          return defaultValue;
        }
        current = (current as Record<string, unknown>)[segment];
      }

      if (typeCheck(current)) {
        return current;
      }

      return defaultValue;

    } catch {
      return defaultValue;
    }
  }

  /**
   * Safe numeric extraction with bounds checking
   */
  static extractNumber(
    data: unknown,
    fieldPath: string,
    options: {
      min?: number;
      max?: number;
      defaultValue?: number;
      allowZero?: boolean;
    } = {}
  ): number | undefined {
    const value = this.extractField(data, fieldPath, (v): v is number => typeof v === 'number');

    if (value === undefined) {
      return options.defaultValue;
    }

    // Check if zero is allowed
    if (!options.allowZero && value === 0) {
      return options.defaultValue;
    }

    // Check bounds
    if (options.min !== undefined && value < options.min) {
      return options.defaultValue;
    }

    if (options.max !== undefined && value > options.max) {
      return options.defaultValue;
    }

    return value;
  }

  /**
   * Safe string extraction with validation
   */
  static extractString(
    data: unknown,
    fieldPath: string,
    options: {
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
      defaultValue?: string;
      allowEmpty?: boolean;
    } = {}
  ): string | undefined {
    const value = this.extractField(data, fieldPath, (v): v is string => typeof v === 'string');

    if (value === undefined) {
      return options.defaultValue;
    }

    // Check if empty strings are allowed
    if (!options.allowEmpty && value.length === 0) {
      return options.defaultValue;
    }

    // Check length constraints
    if (options.minLength !== undefined && value.length < options.minLength) {
      return options.defaultValue;
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      return options.defaultValue;
    }

    // Check pattern
    if (options.pattern && !options.pattern.test(value)) {
      return options.defaultValue;
    }

    return value;
  }

  /**
   * Check for standard API error structures
   */
  private static checkForApiError(data: Record<string, unknown>): ParseResult<never> | null {
    // Check for standard error structures
    if (data.error) {
      const errorMsg = typeof data.error === 'string' ? data.error : 'API error occurred';
      return this.createError('API_ERROR', errorMsg, data.error);
    }

    if (data.status === 'error' || data.status === 'failed') {
      const errorMsg = this.extractString(data, 'message', { defaultValue: 'API request failed' })!;
      return this.createError('API_STATUS_ERROR', errorMsg, data);
    }

    // Check for HTTP error status codes in response
    const statusCode = this.extractNumber(data, 'status', { min: 400, max: 599 });
    if (statusCode) {
      const errorMsg = this.extractString(data, 'message', {
        defaultValue: `HTTP error ${statusCode}`
      })!;
      return this.createError('HTTP_ERROR', errorMsg, { statusCode, originalData: data });
    }

    return null;
  }

  /**
   * Validate required fields
   */
  private static validateRequiredFields(
    data: Record<string, unknown>,
    required: string[]
  ): string[] {
    return required.filter(field => {
      const segments = field.split('.');
      let current = data;

      for (const segment of segments) {
        if (!current || typeof current !== 'object' || !(segment in current)) {
          return true; // Field is missing
        }
        const nextValue = (current as Record<string, unknown>)[segment];
        current = nextValue as Record<string, unknown>;
      }

      return false; // Field exists
    });
  }

  /**
   * Validate fields with custom validators
   */
  private static validateFields(
    data: Record<string, unknown>,
    validators: Record<string, (value: unknown) => boolean>
  ): ParseResult<never> | null {
    for (const [field, validator] of Object.entries(validators)) {
      const value = this.extractField(data, field, (v): v is unknown => true);

      try {
        if (!validator(value)) {
          return this.createError(
            'FIELD_VALIDATION_FAILED',
            `Field "${field}" failed validation`,
            { field, value }
          );
        }
      } catch (error) {
        return this.createError(
          'VALIDATOR_EXCEPTION',
          `Validator for field "${field}" threw an exception`,
          { field, value, error }
        );
      }
    }

    return null;
  }

  /**
   * Transform fields with custom transformers
   */
  private static transformFields(
    data: Record<string, unknown>,
    transformers: Record<string, (value: unknown) => unknown>
  ): ParseResult<Record<string, unknown>> {
    const transformed = { ...data };

    for (const [field, transformer] of Object.entries(transformers)) {
      try {
        const segments = field.split('.');
        let current = transformed;

        // Navigate to parent of target field
        for (let i = 0; i < segments.length - 1; i++) {
          const segment = segments[i];
          if (!current[segment] || typeof current[segment] !== 'object') {
            current[segment] = {};
          }
          current = current[segment] as Record<string, unknown>;
        }

        // Transform the field
        const lastSegment = segments[segments.length - 1];
        if (lastSegment in current) {
          current[lastSegment] = transformer(current[lastSegment]);
        }

      } catch (error) {
        return this.createError(
          'TRANSFORMER_EXCEPTION',
          `Transformer for field "${field}" threw an exception`,
          { field, error }
        );
      }
    }

    return {
      success: true,
      data: transformed
    };
  }

  /**
   * Create standardized error result
   */
  private static createError<T>(
    code: string,
    message: string,
    details?: unknown
  ): ParseResult<T> {
    return {
      success: false,
      error: {
        code,
        message,
        details
      }
    };
  }
}

/**
 * Common validators for API responses
 */
export const ResponseValidators = {
  isPositiveNumber: (value: unknown): boolean =>
    typeof value === 'number' && value > 0 && !isNaN(value),

  isNonNegativeNumber: (value: unknown): boolean =>
    typeof value === 'number' && value >= 0 && !isNaN(value),

  isValidString: (value: unknown): boolean =>
    typeof value === 'string' && value.length > 0,

  isTokenClassKey: (value: unknown): boolean => {
    if (typeof value !== 'object' || !value) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.collection === 'string' &&
           typeof obj.category === 'string' &&
           typeof obj.type === 'string' &&
           typeof obj.additionalKey === 'string';
  },

  isValidAddress: (value: unknown): boolean =>
    typeof value === 'string' &&
    (value.startsWith('eth|') || /^0x[a-fA-F0-9]{40}$/.test(value)),

  isValidTransactionId: (value: unknown): boolean =>
    typeof value === 'string' && value.length > 0,

  isBigNumberString: (value: unknown): boolean =>
    typeof value === 'string' && /^\d+$/.test(value),

  isValidTimestamp: (value: unknown): boolean =>
    typeof value === 'number' && value > 0 && value <= Date.now() + 86400000 // Allow 1 day in future
};

/**
 * Common transformers for API responses
 */
export const ResponseTransformers = {
  stringToNumber: (value: unknown): number => {
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
    }
    return typeof value === 'number' ? value : 0;
  },

  ensureString: (value: unknown): string =>
    typeof value === 'string' ? value : String(value || ''),

  normalizeTokenAddress: (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.replace(/\|/g, '$');
  },

  timestampToDate: (value: unknown): Date =>
    new Date(typeof value === 'number' ? value * 1000 : Date.now())
};