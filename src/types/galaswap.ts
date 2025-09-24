/**
 * GalaSwap V3 API Type Definitions
 * Complete TypeScript interfaces for GalaSwap V3 DEX API
 */

// Base token class key used throughout GalaSwap
export interface TokenClassKey {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
}

// Token information for arbitrage operations
export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  tokenClass: string; // Pipe format: Collection|Category|Type|AdditionalKey
  price: number;
  priceChange24h: number;
}

// Base response structure for all API calls
export interface BaseResponse {
  status: number;
  message: string;
  error: boolean;
  timestamp?: number;
}

// Error response structure
export interface ErrorResponse extends BaseResponse {
  error: true;
  errorCode?: string;
  errorKey?: string;
  details?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ===========================================
// QUOTE & PRICING API TYPES
// ===========================================

export interface QuoteRequest {
  tokenIn: string; // Composite key format: Collection$Category$Type$AdditionalKey
  tokenOut: string; // Composite key format: Collection$Category$Type$AdditionalKey
  amountIn?: string;
  amountOut?: string;
  fee?: number; // Fee tier (500, 3000, 10000)
  sqrtPriceLimit?: string;
}

export interface QuoteResponse extends BaseResponse {
  error: false;
  data: {
    currentSqrtPrice: string;
    newSqrtPrice: string;
    fee: number;
    amountIn: string;
    amountOut: string;
    priceImpact?: number;
    route?: TradeRoute[];
  };
}

export interface TradeRoute {
  tokenIn: string;
  tokenOut: string;
  pool: string;
  fee: number;
  amountIn: string;
  amountOut: string;
}

export interface PriceRequest {
  token: string; // Composite key format
}

export interface PriceResponse extends BaseResponse {
  error: false;
  data: {
    token: string;
    price: string;
    priceUsd?: string;
    change24h?: number;
    volume24h?: string;
    timestamp: number;
  };
}

export interface PricesRequest {
  tokens: string[]; // Array of composite keys
}

export interface PricesResponse extends BaseResponse {
  error: false;
  data: string[]; // Array of prices in same order as requested tokens
}

// ===========================================
// POOL & LIQUIDITY API TYPES
// ===========================================

export interface PoolRequest {
  token0: string;
  token1: string;
  fee: number;
}

export interface PoolResponse extends BaseResponse {
  error: false;
  data: {
    Status: number;
    Data: {
      fee: number;
      grossPoolLiquidity: string;
      sqrtPrice: string;
      tickSpacing: number;
      token0: string;
      token1: string;
      tick?: number;
      volume24h?: string;
      tvl?: string;
    };
  };
}

export interface AddLiquidityEstimateRequest {
  token0: string;
  token1: string;
  amount: string;
  tickUpper: number;
  tickLower: number;
  isToken0: boolean;
  fee: number;
}

export interface AddLiquidityEstimateResponse extends BaseResponse {
  error: false;
  data: {
    Status: number;
    Data: {
      amount0: string;
      amount1: string;
      liquidity: string;
    };
  };
}

export interface RemoveLiquidityEstimateRequest {
  token0: string;
  token1: string;
  owner: string;
  tickUpper: number;
  tickLower: number;
  fee: number;
  amount: number;
}

export interface RemoveLiquidityEstimateResponse extends BaseResponse {
  error: false;
  data: {
    Status: number;
    Data: {
      amount0: string;
      amount1: string;
    };
  };
}

// ===========================================
// POSITION MANAGEMENT API TYPES
// ===========================================

export interface PositionRequest {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  owner: string; // Format: eth|0x...
}

export interface Position {
  fee: number;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  token0ClassKey: TokenClassKey;
  token1ClassKey: TokenClassKey;
  tokensOwed0: string;
  tokensOwed1: string;
  token0Symbol?: string;
  token1Symbol?: string;
}

export interface PositionResponse extends BaseResponse {
  error: false;
  data: {
    Status: number;
    Data: Position;
  };
}

export interface PositionsRequest {
  user: string; // Format: eth|0x...
  limit: number;
  bookmark?: string;
}

export interface PositionsResponse extends BaseResponse {
  error: false;
  data: {
    Status: number;
    Data: {
      nextBookMark: string;
      positions: Position[];
    };
  };
}

// ===========================================
// TRADING OPERATIONS API TYPES
// ===========================================

export interface SwapPayloadRequest {
  tokenIn: TokenClassKey;
  tokenOut: TokenClassKey;
  amountIn: string;
  fee: number;
  sqrtPriceLimit: string;
  amountInMaximum: string;
  amountOutMinimum: string;
}

export interface SwapPayload {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  uniqueKey: string;
  zeroForOne?: boolean;
}

export interface SwapPayloadResponse extends BaseResponse {
  error: false;
  data: SwapPayload;
}

// Liquidity payload interfaces removed - SDK v0.0.7 doesn't support liquidity operations

export interface CreatePoolPayloadRequest {
  token0: TokenClassKey;
  token1: TokenClassKey;
  initialSqrtPrice: string;
  fee: number;
}

// LiquidityPayloadResponse removed - SDK v0.0.7 doesn't support liquidity operations

// ===========================================
// BUNDLE & EXECUTION API TYPES
// ===========================================

export interface BundleRequest {
  payload: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  type: BundleType;
  signature: string;
  user: string; // Format: eth|0x...
}

export type BundleType =
  | 'swap'
  | 'createPool';
  // addLiquidity, removeLiquidity, collectFees removed - SDK v0.0.7 doesn't support these operations

export interface BundleResponse extends BaseResponse {
  error: false;
  data: {
    data: string; // Transaction ID
    message: string;
    error: boolean;
  };
}

export interface TransactionStatusRequest {
  id: string; // Transaction ID from bundle response
}

export interface TransactionStatusResponse extends BaseResponse {
  error: false;
  data: {
    id: string;
    method: string;
    status: TransactionStatus;
    blockNumber?: number;
    transactionHash?: string;
    errorCode?: number;
    errorKey?: string;
    errorMessage?: string;
  };
}

export type TransactionStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REJECTED'
  | 'TIMEOUT';

// ===========================================
// WEBSOCKET EVENT TYPES
// ===========================================

export interface WebSocketEvent {
  event: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  timestamp: number;
}

export interface PriceUpdateEvent extends WebSocketEvent {
  event: 'price_update';
  data: {
    token: string;
    price: string;
    change: number;
    volume: string;
  };
}

export interface TransactionUpdateEvent extends WebSocketEvent {
  event: 'transaction_update';
  data: {
    transactionId: string;
    status: TransactionStatus;
    blockNumber?: number;
    hash?: string;
    error?: {
      code: number;
      key: string;
      message: string;
    };
  };
}

export interface PositionUpdateEvent extends WebSocketEvent {
  event: 'position_update';
  data: {
    user: string;
    position: Position;
    action: 'created' | 'updated' | 'closed';
  };
}

// ===========================================
// PRICE ORACLE API TYPES
// ===========================================

export interface PriceOracleSubscribeRequest {
  subscribe: boolean;
  token: TokenClassKey;
}

export interface PriceOracleFetchRequest {
  token: string; // Composite key format
  page?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
}

export interface PriceOracleResponse extends BaseResponse {
  error: false;
  data: {
    prices: Array<{
      token: string;
      price: string;
      timestamp: string;
      volume?: string;
      source?: string;
    }>;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      hasNext: boolean;
    };
  };
}

// ===========================================
// BRIDGING API TYPES (for completeness)
// ===========================================

export interface BridgeConfiguration {
  name: string;
  symbol: string;
  network: string;
  decimals: number;
  verified: boolean;
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
  channel: string;
  canBridgeTo: Array<{
    network: string;
    symbol: string;
    destinationChainIds: string[];
  }>;
  otherNetworks?: Array<{
    network: string;
    contract: string;
    symbol: string;
  }>;
}

export interface BridgeConfigurationsResponse extends BaseResponse {
  error: false;
  data: {
    tokens: BridgeConfiguration[];
  };
}

export interface BridgeRequest {
  destinationChainId: number;
  recipient: string;
  walletAddress: string;
  quantity: string;
  token: TokenClassKey;
}

export interface BridgeRequestResponse extends BaseResponse {
  error: false;
  data: {
    fee: string;
    feeToken: string;
    dto: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

export interface BridgeStatusRequest {
  hash: string; // Bridge transaction hash
}

export interface BridgeStatusResponse extends BaseResponse {
  error: false;
  data: {
    fromChain: string;
    toChain: string;
    quantity: string;
    status: number; // 5 = success, 6/7 = failed, <5 = pending
    statusDescription: string;
    emitterTransactionHash: string;
    deliveryTransactionHash?: string;
  };
}

// ===========================================
// CLIENT CONFIGURATION TYPES
// ===========================================


export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  fee: number;
  slippageTolerance: number;
  recipient?: string;
}

export interface LiquidityParams {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0: string;
  amount1: string;
  slippageTolerance: number;
}

// ===========================================
// UTILITY TYPES
// ===========================================

export interface ApiRequestOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  validateResponse?: boolean;
}

export interface RateLimitConfig {
  requestsPerSecond: number;
  burstLimit: number;
  windowMs: number;
}

export interface WebSocketConfig {
  reconnectAttempts: number;
  reconnectDelay: number;
  heartbeatInterval: number;
  maxMessageSize: number;
}

// Common fee tiers used in GalaSwap V3
export const FEE_TIERS = {
  STABLE: 500,    // 0.05% - for stable pairs
  STANDARD: 3000, // 0.30% - for standard pairs
  VOLATILE: 10000 // 1.00% - for volatile pairs
} as const;

// Common token identifiers on GalaChain
export const COMMON_TOKENS = {
  GALA: 'GALA$Unit$none$none',
  GUSDC: 'GUSDC$Unit$none$none',
  ETIME: 'ETIME$Unit$none$none',
  SILK: 'SILK$Unit$none$none',
  GTON: 'GTON$Unit$none$none',
} as const;

// Helper type for token parsing
export interface ParsedToken {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
  compositeKey: string;
}

// Response validation helpers
export function isSuccessResponse<T>(response: any): response is T & { error: false } { // eslint-disable-line @typescript-eslint/no-explicit-any
  return response && response.error === false && response.status >= 200 && response.status < 300;
}

export function isErrorResponse(response: any): response is ErrorResponse { // eslint-disable-line @typescript-eslint/no-explicit-any
  return response && (response.error === true || response.status >= 400);
}

// CRITICAL FIX: Proper interfaces replacing any types
export interface BlockchainPosition {
  id?: string;
  positionId?: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0?: string;
  amount1?: string;
  fees0?: string;
  fees1?: string;
  token0Symbol?: string;
  token1Symbol?: string;
  lastUpdated?: number;
  inRange?: boolean;

  // Legacy compatibility properties for existing code
  token?: string;
  symbol?: string;
  amount?: number;
  balance?: number;
  valueUsd?: number;
  value?: number;
  valueUSD?: number;
  percentOfPortfolio?: number;
  unrealizedPnL?: number;
  openTime?: number;
  age?: number;
}

export interface PortfolioBalance {
  token: string;
  amount: number;
  valueUSD: number;
}

export interface PositionPerformance {
  positionId: string;
  token0: string;
  token1: string;
  feesEarned: number;
  apr: number;
  inRange: boolean;
  timeInRange: number;
}

export interface LiquidityAnalytics {
  totalPositions: number;
  totalLiquidity: number;
  totalFeesEarned: number;
  averageAPR: number;
  positionPerformance: PositionPerformance[];
  rangeOrderStats: RangeOrderStats;
  marketMakingStats: MarketMakingStats;
}

export interface RangeOrderStats {
  totalOrders: number;
  activeOrders: number;
  filledOrders: number;
  averageFillTime: number;
}

export interface MarketMakingStats {
  activePositions: number;
  totalVolume: number;
  feesCollected: number;
  impermanentLoss: number;
}

export interface MarketCondition {
  overall: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  volatility: 'low' | 'medium' | 'high' | 'extreme';
  liquidity: 'poor' | 'fair' | 'good' | 'excellent';
  trend?: string;
}

export interface RiskValidationResult {
  approved: boolean;
  reason?: string;
  adjustedAmount?: number;
  riskScore?: number;
  warnings?: string[];
}

export interface RangeOrder {
  id: string;
  token0: string;
  token1: string;
  fee: number;
  direction: 'buy' | 'sell';
  amount: string;
  targetPrice: number;
  rangeWidth: number;
  status: 'pending' | 'active' | 'filled' | 'cancelled';
  createdAt: number;
  autoExecute: boolean;
}

export interface MarketMakingPosition {
  id: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  strategy: string;
  status: 'active' | 'paused' | 'closed';
  performance: {
    feesEarned: number;
    impermanentLoss: number;
    netReturn: number;
  };
}

export interface ArbitrageStatus {
  isActive: boolean;
  opportunities: {
    total: number;
    executed: number;
    successful: number;
    successRate: string;
  };
  performance: {
    totalProfit: string;
    avgProfitPerTrade: string;
    profitMargin: string;
  };
  monitoring: {
    lastUpdate: string;
    activePairs: number;
    avgOpportunitySize: string;
  };
  risk: {
    riskLevel: 'low' | 'medium' | 'high';
    riskFactors: string[];
    lastRiskAssessment: string;
  };
}

export interface FeeAnalysis {
  totalFeesUSD: number;
  estimatedAPR: number;
  token0Fees: string;
  token1Fees: string;
  lastCollected: number;
}

export interface RebalanceRecommendation {
  positionId: string;
  strategy: string;
  urgency: 'low' | 'medium' | 'high';
  reason: string;
  estimatedCost: number;
  estimatedBenefit: number;
}

// Token validation helpers
export function isTokenClassKey(obj: any): obj is TokenClassKey { // eslint-disable-line @typescript-eslint/no-explicit-any
  return typeof obj === 'object' &&
         obj !== null &&
         'collection' in obj &&
         'category' in obj &&
         'type' in obj &&
         'additionalKey' in obj &&
         typeof obj.collection === 'string' &&
         typeof obj.category === 'string' &&
         typeof obj.type === 'string' &&
         typeof obj.additionalKey === 'string';
}

export function isTokenString(value: any): value is string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof value !== 'string') {
    return false;
  }

  // Check for valid token format with $ or | separators
  const parts = value.includes('$') ? value.split('$') : value.split('|');
  return parts.length === 4 && parts.every(part => part.length > 0);
}

export function isValidToken(token: any): token is TokenClassKey | string { // eslint-disable-line @typescript-eslint/no-explicit-any
  return isTokenClassKey(token) || isTokenString(token);
}

// Token helper functions
export function parseTokenKey(compositeKey: string): ParsedToken {
  const parts = compositeKey.split('$');
  if (parts.length !== 4) {
    throw new Error(`Invalid token composite key format: ${compositeKey}`);
  }

  return {
    collection: parts[0],
    category: parts[1],
    type: parts[2],
    additionalKey: parts[3],
    compositeKey
  };
}

export function createTokenKey(token: TokenClassKey): string {
  return `${token.collection}$${token.category}$${token.type}$${token.additionalKey}`;
}

export function createTokenClassKey(compositeKey: string): TokenClassKey {
  const parsed = parseTokenKey(compositeKey);
  return {
    collection: parsed.collection,
    category: parsed.category,
    type: parsed.type,
    additionalKey: parsed.additionalKey
  };
}

// Legacy compatibility exports (for existing code)
export interface LiquidityPosition {
  id: string;
  owner?: string;
  pool?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  token0: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  token1: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  fee: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  tickLower: number;
  tickUpper: number;
  minPrice: number;
  maxPrice: number;
  liquidity: string;
  amount0: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  amount1: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  uncollectedFees0: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  uncollectedFees1: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  depositedToken0?: string;
  depositedToken1?: string;
  withdrawnToken0?: string;
  withdrawnToken1?: string;
  collectedFeesToken0?: string;
  collectedFeesToken1?: string;
  uncollectedFeesToken0?: string;
  uncollectedFeesToken1?: string;
  inRange: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastUpdate: number;
  timeInRangePercentage?: number;
  liquidityValue?: number;
  incrementRebalance?: () => void;
}

export interface GalaSwapToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoUrl?: string;
  verified: boolean;
  tags?: string[];
}

export interface PoolInfo {
  address: string;
  token0: GalaSwapToken;
  token1: GalaSwapToken;
  fee: number;
  tickSpacing: number;
  currentTick: number;
  liquidity: string;
  sqrtPriceX96: string;
  feeGrowthGlobal0X128: string;
  feeGrowthGlobal1X128: string;
  protocolFees: {
    token0: string;
    token1: string;
  };
  volume24h: string;
  volumeUsd24h: string;
  feesEarned24h: string;
  tvl: string;
  tvlUsd: string;
  apr?: number;
}