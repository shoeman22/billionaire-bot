/**
 * API Response Types
 * TypeScript definitions for GalaSwap V3 API responses
 */

// Base response structure
export interface BaseResponse {
  success: boolean;
  message?: string;
  timestamp: number;
}

// Error response
export interface ErrorResponse extends BaseResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

// Quote request and response
export interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageTolerance: number;
  userAddress?: string;
}

export interface QuoteResponse extends BaseResponse {
  success: true;
  data: {
    amountOut: string;
    priceImpact: number;
    fee: string;
    route: TradeRoute[];
    executionPrice: string;
    minimumAmountOut: string;
  };
}

// Trade route information
export interface TradeRoute {
  tokenIn: string;
  tokenOut: string;
  pool: string;
  fee: number;
  amountIn: string;
  amountOut: string;
}

// Price response
export interface PriceResponse extends BaseResponse {
  success: true;
  data: {
    token: string;
    price: string;
    priceUsd: string;
    change24h: number;
    volume24h: string;
    marketCap?: string;
  };
}

// Positions response
export interface PositionsResponse extends BaseResponse {
  success: true;
  data: {
    positions: Position[];
    totalValue: string;
    totalValueUsd: string;
  };
}

export interface Position {
  id: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  amount0: string;
  amount1: string;
  uncollectedFees0: string;
  uncollectedFees1: string;
  positionValue: string;
  positionValueUsd: string;
}

// Pool response
export interface PoolResponse extends BaseResponse {
  success: true;
  data: {
    address: string;
    token0: string;
    token1: string;
    fee: number;
    tickSpacing: number;
    liquidity: string;
    sqrtPriceX96: string;
    tick: number;
    volume24h: string;
    volumeUsd24h: string;
    feesEarned24h: string;
    tvl: string;
    tvlUsd: string;
  };
}

// Bundle transaction response
export interface BundleResponse extends BaseResponse {
  success: true;
  data: {
    transactionId: string;
    hash: string;
    status: 'pending' | 'confirmed' | 'failed';
    blockNumber?: number;
    gasUsed?: string;
    effectiveGasPrice?: string;
  };
}

// Transaction status response
export interface TransactionStatusResponse extends BaseResponse {
  success: true;
  data: {
    transactionId: string;
    hash: string;
    status: 'pending' | 'confirmed' | 'failed';
    blockNumber?: number;
    confirmations: number;
    gasUsed?: string;
    effectiveGasPrice?: string;
    error?: string;
  };
}