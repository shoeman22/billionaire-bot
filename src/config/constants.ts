/**
 * Trading and API Constants
 * Centralized constants for the GalaSwap V3 trading bot
 */

export const TRADING_CONSTANTS = {
  // Trading parameters
  DEFAULT_GAS_LIMIT: 300000,
  MAX_SLIPPAGE_PERCENT: 15, // 15% maximum slippage
  MIN_TRADE_AMOUNT: 0.01, // Minimum trade amount
  DEFAULT_SLIPPAGE_TOLERANCE: 0.01, // 1% default slippage
  DEFAULT_TRADE_SIZE: 10, // Default arbitrage trade size in GALA (optimized for concentrated liquidity)

  // Timing constants
  PRICE_UPDATE_INTERVAL: 1000, // 1 second
  POSITION_CHECK_INTERVAL: 5000, // 5 seconds
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  TRANSACTION_TIMEOUT: 60000, // 60 seconds
  QUOTE_REFRESH_INTERVAL: 10000, // 10 seconds
  ARBITRAGE_SCAN_INTERVAL: 5000, // 5 seconds

  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  BACKOFF_MULTIPLIER: 2,

  // Safety margins (as percentages for FixedNumber operations)
  SAFETY_MARGINS: {
    EXOTIC_ARBITRAGE_EXTRA: 2, // Additional 2% safety margin for exotic arbitrage
    EMERGENCY_LIQUIDITY: 20,   // 20% safety margin for emergency liquidation (80% floor)
    EMERGENCY_MINIMUM_FLOOR: 0.01, // Absolute minimum for emergency operations
  },

  // Gas estimation buffers (as multipliers for FixedNumber operations)
  GAS_BUFFERS: {
    SWAP: 1.0,                  // No buffer for basic swaps
    ADD_LIQUIDITY: 1.1,         // 10% buffer for add liquidity
    REMOVE_LIQUIDITY: 1.05,     // 5% buffer for remove liquidity
    COLLECT_FEES: 1.0,          // No buffer for fee collection
    REBALANCE: 1.2,             // 20% buffer for multi-step operations
  },

  // GalaSwap V3 fee tiers (in basis points)
  FEE_TIERS: {
    STABLE: 500,    // 0.05% for stable pairs (USDC/USDT)
    STANDARD: 3000, // 0.30% for standard pairs (ETH/USDC)
    VOLATILE: 10000 // 1.00% for exotic/volatile pairs
  },

  // Gas cost estimation constants (in GALA)
  // Values aligned with hunt-deals.ts for consistent profit calculations
  GAS_COSTS: {
    TRIANGULAR_ARBITRAGE: 0.1,  // GALA → TOKEN → GALA (2 swaps)
    CROSS_PAIR_ARBITRAGE: 0.15, // GALA → TokenA → TokenB → GALA (3 swaps)
    BASE_GAS: 0.08,             // Base gas cost for any transaction
    PER_HOP_GAS: 0.04           // Additional gas per hop for complex routes
  },

  // Common GalaChain token identifiers (SDK pipe format)
  // ✅ FIX: Use $ separator (GalaChain format), not |
  TOKENS: {
    GALA: 'GALA$Unit$none$none',
    GUSDC: 'GUSDC$Unit$none$none',
    ETIME: 'ETIME$Unit$none$none',
    SILK: 'SILK$Unit$none$none',
    GTON: 'GTON$Unit$none$none',
    // Major wrapped tokens
    GUSDT: 'GUSDT$Unit$none$none',
    GWETH: 'GWETH$Unit$none$none',
    GWBTC: 'GWBTC$Unit$none$none',
  },

  // Fallback token set for arbitrage operations (expanded for aggressive multi-token arbitrage)
  // ✅ FIX: Use $ separator (GalaChain format), not |
  FALLBACK_TOKENS: [
    { symbol: 'GALA', name: 'Gala', decimals: 8, tokenClass: 'GALA$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'GUSDC', name: 'Gala USD Coin', decimals: 6, tokenClass: 'GUSDC$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'GUSDT', name: 'Gala Tether', decimals: 6, tokenClass: 'GUSDT$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'GWETH', name: 'Gala Wrapped Ethereum', decimals: 18, tokenClass: 'GWETH$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'GWBTC', name: 'Gala Wrapped Bitcoin', decimals: 8, tokenClass: 'GWBTC$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'ETIME', name: 'Eternal Time', decimals: 8, tokenClass: 'ETIME$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'SILK', name: 'SILK Token', decimals: 8, tokenClass: 'SILK$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'TOWN', name: 'Town Coin', decimals: 8, tokenClass: 'TOWN$Unit$none$none', price: 0, priceChange24h: 0 },
    { symbol: 'GTON', name: 'Gala TON', decimals: 8, tokenClass: 'GTON$Unit$none$none', price: 0, priceChange24h: 0 }
  ] as const,

  // Position management
  TICK_RANGES: {
    FULL_RANGE_LOWER: -887220,
    FULL_RANGE_UPPER: 887220,
    TIGHT_RANGE: 200,   // +/- 200 ticks for concentrated liquidity
    MEDIUM_RANGE: 1000, // +/- 1000 ticks
    WIDE_RANGE: 5000,   // +/- 5000 ticks
  },

  // Risk management (optimized for arbitrage trading)
  MAX_POSITION_VALUE_USD: 10000000,  // $10M - effectively unlimited for arbitrage bot
  MAX_DAILY_TRADES: 10000,           // Allow high frequency trading
  MIN_LIQUIDITY_USD: 1000, // Minimum pool liquidity for trading
  MAX_PRICE_IMPACT: 0.05,  // 5% maximum price impact
} as const;

export const API_CONSTANTS = {
  // GalaSwap V3 API endpoints
  ENDPOINTS: {
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

    // Payload Generation
    SWAP_PAYLOAD: '/v1/trade/swap',
    LIQUIDITY_PAYLOAD: '/v1/trade/liquidity',
    COLLECT_PAYLOAD: '/v1/trade/collect',
    CREATE_POOL_PAYLOAD: '/v1/trade/create-pool',

    // Bundle Execution
    BUNDLE: '/v1/trade/bundle',
    TRANSACTION_STATUS: '/v1/trade/transaction-status',

    // Price Oracle
    PRICE_ORACLE_SUBSCRIBE: '/price-oracle/subscribe-token',
    PRICE_ORACLE_FETCH: '/price-oracle/fetch-price',

    // Bridging (for completeness)
    BRIDGE_CONFIGURATIONS: '/v1/connect/bridge-configurations',
    BRIDGE_REQUEST: '/v1/connect/bridge/request',
    BRIDGE_STATUS: '/v1/connect/bridge/status',

    // System
    HEALTH: '/health',
    STATUS: '/status',
    VERSION: '/version',
  },

  // Rate limiting per endpoint type
  RATE_LIMITS: {
    HIGH_FREQUENCY: {
      REQUESTS_PER_SECOND: 20,
      BURST_LIMIT: 50,
    },
    MEDIUM_FREQUENCY: {
      REQUESTS_PER_SECOND: 10,
      BURST_LIMIT: 20,
    },
    LOW_FREQUENCY: {
      REQUESTS_PER_SECOND: 2,
      BURST_LIMIT: 5,
    },
    TRANSACTION: {
      REQUESTS_PER_SECOND: 1,
      BURST_LIMIT: 3,
    }
  },

  // WebSocket events
  WS_EVENTS: {
    PRICE_UPDATE: 'price_update',
    TRANSACTION_UPDATE: 'transaction_update',
    POSITION_UPDATE: 'position_update',
    POOL_UPDATE: 'pool_update',
    ERROR: 'error',
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    RECONNECT: 'reconnect',
  },

  // HTTP headers
  HEADERS: {
    CONTENT_TYPE: 'application/json',
    ACCEPT: 'application/json',
    USER_AGENT: 'billionaire-bot/1.0.0',
  },

  // Timeout settings per endpoint type
  TIMEOUTS: {
    FAST: 3000,      // Health, status, version
    STANDARD: 5000,  // Price, quote, pool info
    MEDIUM: 8000,    // Multiple prices, positions
    SLOW: 15000,     // Payload generation
    TRANSACTION: 30000, // Bundle execution
    WEBSOCKET: 30000,   // WebSocket operations
  },

  // Error codes
  ERROR_CODES: {
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
  }
} as const;

export const WEBSOCKET_CONSTANTS = {
  // Connection settings
  CONNECTION: {
    TIMEOUT: 30000,
    RECONNECTION: true,
    RECONNECTION_ATTEMPTS: 5,
    RECONNECTION_DELAY: 1000,
    RECONNECTION_DELAY_MAX: 5000,
  },

  // Subscription channels
  CHANNELS: {
    PRICES: 'prices',
    TRANSACTIONS: 'transactions',
    POSITIONS: 'positions',
    POOLS: 'pools',
  },

  // Message types
  MESSAGE_TYPES: {
    SUBSCRIBE: 'subscribe',
    UNSUBSCRIBE: 'unsubscribe',
    PRICE_UPDATE: 'price_update',
    TRANSACTION_UPDATE: 'transaction_update',
    POSITION_UPDATE: 'position_update',
    POOL_UPDATE: 'pool_update',
    ERROR: 'error',
  },
} as const;

export const SECURITY_CONSTANTS = {
  // Signing and encryption
  SIGNING: {
    ALGORITHM: 'secp256k1',
    HASH_ALGORITHM: 'keccak256',
    PRIVATE_KEY_LENGTH: 64, // 32 bytes as hex
    SIGNATURE_LENGTH: 130,  // 65 bytes as hex (r + s + v)
  },

  // Address formats
  ADDRESS_FORMATS: {
    GALACHAIN_PATTERN: /^eth\|0x[a-fA-F0-9]{40}$/,
    TOKEN_PATTERN: /^[A-Za-z0-9]+\|[A-Za-z0-9]+(?:\|[A-Za-z0-9:$]+){1,2}$/,
  },

  // Validation rules
  VALIDATION: {
    MIN_AMOUNT: 0.000001,
    MAX_AMOUNT: 1000000000,
    MIN_FEE_TIER: 100,
    MAX_FEE_TIER: 100000,
    MIN_TICK: -887272,
    MAX_TICK: 887272,
  }
} as const;

export const MONITORING_CONSTANTS = {
  // Health check intervals
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  API_HEALTH_TIMEOUT: 5000,     // 5 seconds

  // Performance monitoring
  METRICS: {
    REQUEST_DURATION_BUCKETS: [0.1, 0.5, 1, 2, 5, 10], // seconds
    ERROR_RATE_WINDOW: 300000, // 5 minutes
    LATENCY_PERCENTILES: [50, 90, 95, 99],
  },

  // Alert thresholds
  ALERTS: {
    HIGH_ERROR_RATE: 0.1,     // 10% error rate
    HIGH_LATENCY: 5000,       // 5 seconds
    LOW_SUCCESS_RATE: 0.9,    // 90% success rate
    CONNECTION_FAILURES: 5,   // 5 consecutive failures
  },

  // Log levels and retention
  LOGGING: {
    LEVELS: ['error', 'warn', 'info', 'debug'] as const,
    MAX_LOG_SIZE: 100 * 1024 * 1024, // 100MB
    LOG_RETENTION_DAYS: 30,
  }
} as const;

export const STRATEGY_CONSTANTS = {
  // Arbitrage strategy
  ARBITRAGE: {
    MIN_PROFIT_THRESHOLD: 0.001, // 0.1% minimum profit
    MAX_TRADE_SIZE_USD: 10000,
    GAS_COST_BUFFER: 1.5, // 50% gas cost buffer
    PRICE_FRESHNESS: 5000, // 5 seconds max price age
  },

  // Market making strategy
  MARKET_MAKING: {
    DEFAULT_TOKEN0: 'GALA|Unit|none|none',  // Default primary token
    DEFAULT_TOKEN1: 'GUSDC|Unit|none|none', // Default quote token
    DEFAULT_FEE_TIER: 3000,                 // 0.3% fee tier
    DEFAULT_CAPITAL: '1000',                // Default capital allocation
    TARGET_SPREAD: 0.002,                   // 0.2% target spread
    RANGE_WIDTH_PERCENTAGE: 0.1,            // 10% range width
    REBALANCE_THRESHOLD: 0.05,              // 5% price movement triggers rebalance
    MAX_POSITION_USD: 10000000,  // $10M - effectively unlimited for arbitrage bot
    FEE_COLLECTION_THRESHOLD: 0.01,         // Collect fees when > 1%
    AUTO_REBALANCE: true,                   // Enable automatic rebalancing
    UTILIZATION_TARGET: 0.8,                // 80% capital utilization target
  },

  // Risk management
  RISK: {
    MAX_DRAWDOWN: 0.1,          // 10% maximum drawdown
    POSITION_SIZE_LIMIT: 0.2,   // 20% of portfolio per position
    CORRELATION_LIMIT: 0.7,     // Max correlation between positions
    VAR_CONFIDENCE: 0.95,       // 95% VaR confidence level
  }
} as const;

// Export type definitions for constants
export type TradingConstant = typeof TRADING_CONSTANTS;
export type ApiConstant = typeof API_CONSTANTS;
export type WebSocketConstant = typeof WEBSOCKET_CONSTANTS;
export type SecurityConstant = typeof SECURITY_CONSTANTS;
export type MonitoringConstant = typeof MONITORING_CONSTANTS;
export type StrategyConstant = typeof STRATEGY_CONSTANTS;

// Combined constants export
export const CONSTANTS = {
  TRADING: TRADING_CONSTANTS,
  API: API_CONSTANTS,
  WEBSOCKET: WEBSOCKET_CONSTANTS,
  SECURITY: SECURITY_CONSTANTS,
  MONITORING: MONITORING_CONSTANTS,
  STRATEGY: STRATEGY_CONSTANTS,
} as const;