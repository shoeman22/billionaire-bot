/**
 * GalaSwap V3 API Endpoint Definitions
 * Centralized API endpoint configuration for GalaSwap V3
 */

export const ENDPOINTS = {
  // ===========================================
  // TRADING API ENDPOINTS
  // ===========================================

  // Quote & Pricing
  QUOTE: '/v1/trade/quote',
  PRICE: '/v1/trade/price',
  PRICE_MULTIPLE: '/v1/trade/price-multiple',

  // Pool Information
  POOL: '/v1/trade/pool',
  ADD_LIQUIDITY_ESTIMATE: '/v1/trade/add-liq-estimate',
  REMOVE_LIQUIDITY_ESTIMATE: '/v1/trade/remove-liq-estimate',

  // Position Management
  POSITION: '/v1/trade/position',
  POSITIONS: '/v1/trade/positions',

  // Payload Generation (for signing before execution)
  SWAP_PAYLOAD: '/v1/trade/swap',
  LIQUIDITY_PAYLOAD: '/v1/trade/liquidity',
  COLLECT_PAYLOAD: '/v1/trade/collect',
  CREATE_POOL_PAYLOAD: '/v1/trade/create-pool',

  // Bundle Execution
  BUNDLE: '/v1/trade/bundle',
  TRANSACTION_STATUS: '/v1/trade/transaction-status',

  // ===========================================
  // PRICE ORACLE API ENDPOINTS
  // ===========================================

  PRICE_ORACLE_SUBSCRIBE: '/price-oracle/subscribe-token',
  PRICE_ORACLE_FETCH: '/price-oracle/fetch-price',

  // ===========================================
  // BRIDGING API ENDPOINTS
  // ===========================================

  BRIDGE_CONFIGURATIONS: '/v1/connect/bridge-configurations',
  BRIDGE_REQUEST: '/v1/connect/bridge/request',
  BRIDGE_REQUEST_TOKEN_OUT: '/v1/connect/RequestTokenBridgeOut',
  BRIDGE_TOKEN_OUT: '/v1/connect/BridgeTokenOut',
  BRIDGE_STATUS: '/v1/connect/bridge/status',

  // ===========================================
  // SYSTEM ENDPOINTS
  // ===========================================

  HEALTH: '/health',
  STATUS: '/status',
  VERSION: '/version',
} as const;

// WebSocket endpoint paths for real-time data
export const WS_ENDPOINTS = {
  PRICE_UPDATES: '/price-updates',
  TRANSACTION_UPDATES: '/transaction-updates',
  POSITION_UPDATES: '/position-updates',
  POOL_UPDATES: '/pool-updates',
} as const;

// HTTP Methods for each endpoint
export const ENDPOINT_METHODS = {
  // GET endpoints
  [ENDPOINTS.QUOTE]: 'GET',
  [ENDPOINTS.PRICE]: 'GET',
  [ENDPOINTS.POOL]: 'GET',
  [ENDPOINTS.ADD_LIQUIDITY_ESTIMATE]: 'GET',
  [ENDPOINTS.REMOVE_LIQUIDITY_ESTIMATE]: 'GET',
  [ENDPOINTS.POSITION]: 'GET',
  [ENDPOINTS.POSITIONS]: 'GET',
  [ENDPOINTS.TRANSACTION_STATUS]: 'GET',
  [ENDPOINTS.BRIDGE_CONFIGURATIONS]: 'GET',
  [ENDPOINTS.HEALTH]: 'GET',
  [ENDPOINTS.STATUS]: 'GET',
  [ENDPOINTS.VERSION]: 'GET',

  // POST endpoints
  [ENDPOINTS.PRICE_MULTIPLE]: 'POST',
  [ENDPOINTS.SWAP_PAYLOAD]: 'POST',
  [ENDPOINTS.COLLECT_PAYLOAD]: 'POST',
  [ENDPOINTS.CREATE_POOL_PAYLOAD]: 'POST',
  [ENDPOINTS.BUNDLE]: 'POST',
  [ENDPOINTS.PRICE_ORACLE_SUBSCRIBE]: 'POST',
  [ENDPOINTS.PRICE_ORACLE_FETCH]: 'POST', // Can be both GET and POST
  [ENDPOINTS.BRIDGE_REQUEST]: 'POST',
  [ENDPOINTS.BRIDGE_REQUEST_TOKEN_OUT]: 'POST',
  [ENDPOINTS.BRIDGE_TOKEN_OUT]: 'POST',
  [ENDPOINTS.BRIDGE_STATUS]: 'POST',

  // Endpoints that support multiple methods
  [ENDPOINTS.LIQUIDITY_PAYLOAD]: ['POST', 'DELETE'], // POST for add, DELETE for remove
} as const;

// Rate limiting configuration per endpoint
export const ENDPOINT_RATE_LIMITS = {
  // High frequency endpoints (price data, quotes)
  [ENDPOINTS.QUOTE]: { requestsPerSecond: 10, burstLimit: 20 },
  [ENDPOINTS.PRICE]: { requestsPerSecond: 20, burstLimit: 50 },
  [ENDPOINTS.PRICE_MULTIPLE]: { requestsPerSecond: 5, burstLimit: 10 },
  [ENDPOINTS.POOL]: { requestsPerSecond: 10, burstLimit: 20 },

  // Medium frequency endpoints (positions, estimates)
  [ENDPOINTS.POSITION]: { requestsPerSecond: 5, burstLimit: 10 },
  [ENDPOINTS.POSITIONS]: { requestsPerSecond: 3, burstLimit: 5 },
  [ENDPOINTS.ADD_LIQUIDITY_ESTIMATE]: { requestsPerSecond: 5, burstLimit: 10 },
  [ENDPOINTS.REMOVE_LIQUIDITY_ESTIMATE]: { requestsPerSecond: 5, burstLimit: 10 },

  // Low frequency endpoints (transactions, payloads)
  [ENDPOINTS.SWAP_PAYLOAD]: { requestsPerSecond: 2, burstLimit: 5 },
  [ENDPOINTS.LIQUIDITY_PAYLOAD]: { requestsPerSecond: 2, burstLimit: 5 },
  [ENDPOINTS.COLLECT_PAYLOAD]: { requestsPerSecond: 1, burstLimit: 3 },
  [ENDPOINTS.CREATE_POOL_PAYLOAD]: { requestsPerSecond: 1, burstLimit: 2 },
  [ENDPOINTS.BUNDLE]: { requestsPerSecond: 1, burstLimit: 3 },
  [ENDPOINTS.TRANSACTION_STATUS]: { requestsPerSecond: 5, burstLimit: 10 },

  // Oracle endpoints
  [ENDPOINTS.PRICE_ORACLE_SUBSCRIBE]: { requestsPerSecond: 1, burstLimit: 2 },
  [ENDPOINTS.PRICE_ORACLE_FETCH]: { requestsPerSecond: 5, burstLimit: 10 },

  // Bridge endpoints
  [ENDPOINTS.BRIDGE_CONFIGURATIONS]: { requestsPerSecond: 2, burstLimit: 5 },
  [ENDPOINTS.BRIDGE_REQUEST]: { requestsPerSecond: 1, burstLimit: 2 },
  [ENDPOINTS.BRIDGE_REQUEST_TOKEN_OUT]: { requestsPerSecond: 1, burstLimit: 2 },
  [ENDPOINTS.BRIDGE_TOKEN_OUT]: { requestsPerSecond: 1, burstLimit: 2 },
  [ENDPOINTS.BRIDGE_STATUS]: { requestsPerSecond: 2, burstLimit: 5 },

  // System endpoints
  [ENDPOINTS.HEALTH]: { requestsPerSecond: 1, burstLimit: 2 },
  [ENDPOINTS.STATUS]: { requestsPerSecond: 1, burstLimit: 2 },
  [ENDPOINTS.VERSION]: { requestsPerSecond: 1, burstLimit: 2 },
} as const;

// Timeout configuration per endpoint
export const ENDPOINT_TIMEOUTS = {
  // Fast endpoints
  [ENDPOINTS.HEALTH]: 3000,
  [ENDPOINTS.STATUS]: 3000,
  [ENDPOINTS.VERSION]: 3000,

  // Standard endpoints
  [ENDPOINTS.QUOTE]: 5000,
  [ENDPOINTS.PRICE]: 5000,
  [ENDPOINTS.PRICE_MULTIPLE]: 8000,
  [ENDPOINTS.POOL]: 5000,
  [ENDPOINTS.POSITION]: 5000,
  [ENDPOINTS.POSITIONS]: 8000,
  [ENDPOINTS.ADD_LIQUIDITY_ESTIMATE]: 5000,
  [ENDPOINTS.REMOVE_LIQUIDITY_ESTIMATE]: 5000,
  [ENDPOINTS.TRANSACTION_STATUS]: 5000,
  [ENDPOINTS.PRICE_ORACLE_FETCH]: 8000,
  [ENDPOINTS.BRIDGE_CONFIGURATIONS]: 8000,
  [ENDPOINTS.BRIDGE_STATUS]: 5000,

  // Slow endpoints (payload generation and execution)
  [ENDPOINTS.SWAP_PAYLOAD]: 15000,
  [ENDPOINTS.LIQUIDITY_PAYLOAD]: 15000,
  [ENDPOINTS.COLLECT_PAYLOAD]: 15000,
  [ENDPOINTS.CREATE_POOL_PAYLOAD]: 15000,
  [ENDPOINTS.BUNDLE]: 30000, // Transaction execution can take longer
  [ENDPOINTS.PRICE_ORACLE_SUBSCRIBE]: 10000,
  [ENDPOINTS.BRIDGE_REQUEST]: 15000,
  [ENDPOINTS.BRIDGE_REQUEST_TOKEN_OUT]: 15000,
  [ENDPOINTS.BRIDGE_TOKEN_OUT]: 15000,
} as const;

// Required parameters for each endpoint
export const ENDPOINT_REQUIRED_PARAMS = {
  [ENDPOINTS.QUOTE]: ['tokenIn', 'tokenOut'],
  [ENDPOINTS.PRICE]: ['token'],
  [ENDPOINTS.PRICE_MULTIPLE]: ['tokens'],
  [ENDPOINTS.POOL]: ['token0', 'token1', 'fee'],
  [ENDPOINTS.ADD_LIQUIDITY_ESTIMATE]: ['token0', 'token1', 'amount', 'tickUpper', 'tickLower', 'isToken0', 'fee'],
  [ENDPOINTS.REMOVE_LIQUIDITY_ESTIMATE]: ['token0', 'token1', 'owner', 'tickUpper', 'tickLower', 'fee', 'amount'],
  [ENDPOINTS.POSITION]: ['token0', 'token1', 'fee', 'tickLower', 'tickUpper', 'owner'],
  [ENDPOINTS.POSITIONS]: ['user', 'limit'],
  [ENDPOINTS.SWAP_PAYLOAD]: ['tokenIn', 'tokenOut', 'amountIn', 'fee', 'sqrtPriceLimit', 'amountInMaximum', 'amountOutMinimum'],
  [ENDPOINTS.LIQUIDITY_PAYLOAD]: ['token0', 'token1', 'fee', 'tickLower', 'tickUpper'],
  [ENDPOINTS.COLLECT_PAYLOAD]: ['token0', 'token1', 'amount0Requested', 'amount1Requested', 'fee', 'tickLower', 'tickUpper'],
  [ENDPOINTS.CREATE_POOL_PAYLOAD]: ['token0', 'token1', 'initialSqrtPrice', 'fee'],
  [ENDPOINTS.BUNDLE]: ['payload', 'type', 'signature', 'user'],
  [ENDPOINTS.TRANSACTION_STATUS]: ['id'],
  [ENDPOINTS.PRICE_ORACLE_SUBSCRIBE]: ['subscribe', 'token'],
  [ENDPOINTS.PRICE_ORACLE_FETCH]: ['token'],
  [ENDPOINTS.BRIDGE_REQUEST]: ['destinationChainId', 'recipient', 'walletAddress', 'quantity', 'token'],
  [ENDPOINTS.BRIDGE_REQUEST_TOKEN_OUT]: ['uniqueKey', 'signature'],
  [ENDPOINTS.BRIDGE_TOKEN_OUT]: ['bridgeFromChannel', 'bridgeRequestId', 'signature'],
  [ENDPOINTS.BRIDGE_STATUS]: ['hash'],
} as const;

// Validation schemas for request parameters
export const ENDPOINT_VALIDATION = {
  [ENDPOINTS.QUOTE]: {
    tokenIn: { type: 'string', pattern: /^[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
    tokenOut: { type: 'string', pattern: /^[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
    amountIn: { type: 'string', pattern: /^\d+(\.\d+)?$/, optional: true },
    amountOut: { type: 'string', pattern: /^\d+(\.\d+)?$/, optional: true },
    fee: { type: 'number', values: [500, 3000, 10000], optional: true },
  },
  [ENDPOINTS.PRICE]: {
    token: { type: 'string', pattern: /^[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
  },
  [ENDPOINTS.POOL]: {
    token0: { type: 'string', pattern: /^[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
    token1: { type: 'string', pattern: /^[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
    fee: { type: 'number', values: [500, 3000, 10000] },
  },
  [ENDPOINTS.POSITIONS]: {
    user: { type: 'string', pattern: /^(eth|client)\|0x[a-fA-F0-9]{40}$/ },
    limit: { type: 'number', min: 1, max: 100 },
    bookmark: { type: 'string', optional: true },
  },
} as const;

// Error codes specific to each endpoint
export const ENDPOINT_ERROR_CODES = {
  INVALID_TOKEN_FORMAT: 'INVALID_TOKEN_FORMAT',
  POOL_NOT_FOUND: 'POOL_NOT_FOUND',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  SLIPPAGE_TOLERANCE_EXCEEDED: 'SLIPPAGE_TOLERANCE_EXCEEDED',
  POSITION_NOT_FOUND: 'POSITION_NOT_FOUND',
  INVALID_TICK_RANGE: 'INVALID_TICK_RANGE',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

export type EndpointPath = typeof ENDPOINTS[keyof typeof ENDPOINTS];
export type WSEndpointPath = typeof WS_ENDPOINTS[keyof typeof WS_ENDPOINTS];
export type EndpointErrorCode = typeof ENDPOINT_ERROR_CODES[keyof typeof ENDPOINT_ERROR_CODES];

/**
 * Build URL with query parameters for GET requests
 */
export function buildQueryUrl(endpoint: string, params: Record<string, any>): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const url = new URL(endpoint, 'https://dex-backend-prod1.defi.gala.com');

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  return url.pathname + url.search;
}

/**
 * Validate endpoint parameters
 */
export function validateEndpointParams(endpoint: EndpointPath, params: Record<string, any>): { // eslint-disable-line @typescript-eslint/no-explicit-any
  isValid: boolean;
  errors: string[];
} {
  const validation = ENDPOINT_VALIDATION[endpoint as keyof typeof ENDPOINT_VALIDATION];
  const required = ENDPOINT_REQUIRED_PARAMS[endpoint as keyof typeof ENDPOINT_REQUIRED_PARAMS];
  const errors: string[] = [];

  // Check required parameters
  if (required) {
    required.forEach(param => {
      if (params[param] === undefined || params[param] === null) {
        errors.push(`Missing required parameter: ${param}`);
      }
    });
  }

  // Validate parameter formats
  if (validation) {
    Object.entries(validation).forEach(([param, rules]) => {
      const value = params[param];

      if (value !== undefined && value !== null) {
        if (rules.type === 'string' && typeof value !== 'string') {
          errors.push(`Parameter ${param} must be a string`);
        } else if (rules.type === 'number' && typeof value !== 'number') {
          errors.push(`Parameter ${param} must be a number`);
        } else if (rules.pattern && !rules.pattern.test(String(value))) {
          errors.push(`Parameter ${param} has invalid format`);
        } else if (rules.values && !rules.values.includes(value)) {
          errors.push(`Parameter ${param} must be one of: ${rules.values.join(', ')}`);
        } else if (rules.min !== undefined && value < rules.min) {
          errors.push(`Parameter ${param} must be at least ${rules.min}`);
        } else if (rules.max !== undefined && value > rules.max) {
          errors.push(`Parameter ${param} must be at most ${rules.max}`);
        }
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Get endpoint configuration
 */
export function getEndpointConfig(endpoint: EndpointPath) {
  return {
    method: ENDPOINT_METHODS[endpoint as keyof typeof ENDPOINT_METHODS],
    timeout: ENDPOINT_TIMEOUTS[endpoint as keyof typeof ENDPOINT_TIMEOUTS] || 10000,
    rateLimit: ENDPOINT_RATE_LIMITS[endpoint as keyof typeof ENDPOINT_RATE_LIMITS],
    requiredParams: ENDPOINT_REQUIRED_PARAMS[endpoint as keyof typeof ENDPOINT_REQUIRED_PARAMS] || [],
    validation: ENDPOINT_VALIDATION[endpoint as keyof typeof ENDPOINT_VALIDATION]
  };
}