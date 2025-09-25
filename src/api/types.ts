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

// Pool Detail response (from /explore/pool endpoint)
export interface PoolDetailResponse {
  status: number;
  error: boolean;
  message: string;
  data: {
    poolPair: string;
    poolHash: string;
    token0: string;
    token0Image: string;
    token1: string;
    token1Image: string;
    token0Price: string;
    token1Price: string;
    poolName: string;
    fee: number;
    fee24h: number;
    token0Tvl: number;
    token0TvlUsd: number;
    token1Tvl: number;
    token1TvlUsd: number;
    tvl: number;
    volume1d: number;
    volume30d: number;
    dayPerTvl: number;
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

// ===========================================
// TRANSACTION HISTORY & ANALYTICS TYPES
// ===========================================

// Individual transaction record
export interface TransactionRecord {
  id: number;
  blockNumber: number;
  poolHash: string;
  userAddress: string;
  transactionTime: string; // ISO timestamp format
  token0: string;
  token1: string;
  amount0: number;
  amount1: number;
  volume: number;
  createdAt: string | null;
  updatedAt: string | null;
}

// Pool transactions response
export interface PoolTransactionsResponse extends BaseResponse {
  success: true;
  data: {
    transactions: TransactionRecord[];
    totalCount: number;
    poolHash: string;
    token0: string;
    token1: string;
    timeRange: {
      from: string;
      to: string;
    };
  };
}

// User trading history response
export interface UserHistoryResponse extends BaseResponse {
  success: true;
  data: {
    userAddress: string;
    transactions: TransactionRecord[];
    totalVolume: number;
    totalTrades: number;
    averageTradeSize: number;
    mostTradedPairs: Array<{
      token0: string;
      token1: string;
      volume: number;
      tradeCount: number;
    }>;
  };
}

// Pool analytics response
export interface PoolAnalyticsResponse extends BaseResponse {
  success: true;
  data: {
    poolHash: string;
    token0: string;
    token1: string;
    analytics: {
      totalVolume: number;
      totalTrades: number;
      uniqueTraders: number;
      averageTradeSize: number;
      volumeByHour: Array<{
        hour: string;
        volume: number;
        tradeCount: number;
      }>;
      topTraders: Array<{
        userAddress: string;
        volume: number;
        tradeCount: number;
        lastTradeTime: string;
      }>;
      priceHistory: Array<{
        timestamp: string;
        token0Price: number;
        token1Price: number;
        volume: number;
      }>;
    };
  };
}

// ===========================================
// WHALE TRACKING TYPES
// ===========================================

// Whale trader definition
export interface WhaleTrader {
  userAddress: string;
  totalVolume: number;
  tradeCount: number;
  averageTradeSize: number;
  firstTradeTime: string;
  lastTradeTime: string;
  isBot: boolean;
  tradingFrequency: number; // trades per hour
  profitability: number; // estimated profit percentage
  riskScore: number; // 1-10 scale
}

// Whale activity summary
export interface WhaleActivity {
  trader: WhaleTrader;
  recentTrades: TransactionRecord[];
  tradingPattern: {
    averageInterval: number; // seconds between trades
    preferredTimeRanges: string[]; // hour ranges like "09-12"
    volumeTrend: 'increasing' | 'decreasing' | 'stable';
  };
  followWorthiness: number; // 1-10 scale
}

// ===========================================
// VOLUME GRAPH DATA TYPES
// ===========================================

// Volume resolution types
export type VolumeResolution = '5m' | '1h' | '24h';

// Individual volume data point
export interface VolumeDataPoint {
  startTime: number;
  endTime: number;
  midTime: number;
  volume: number;
}

// Volume graph data response
export interface VolumeGraphResponse {
  status: number;
  error: boolean;
  message: string;
  data: VolumeDataPoint[];
}

// ===========================================
// VOLUME ANALYSIS TYPES
// ===========================================

// Volume prediction data
export interface VolumeAnalysis {
  poolHash: string;
  currentVolume: number;
  historicalAverage: number;
  volumeSpike: boolean;
  spikePercentage: number;
  prediction: {
    nextHourVolume: number;
    confidence: number; // 0-1 scale
    trend: 'bullish' | 'bearish' | 'neutral';
  };
  triggers: {
    whaleActivity: boolean;
    priceMovement: boolean;
    timePattern: boolean;
  };
}

// Trading pattern analysis
export interface TradingPattern {
  patternType: 'accumulation' | 'distribution' | 'scalping' | 'arbitrage';
  confidence: number;
  duration: number; // minutes
  volumeProfile: number[];
  priceImpact: number;
  participants: string[]; // user addresses
}