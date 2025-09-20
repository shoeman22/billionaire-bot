/**
 * Trading-Specific Type Definitions
 * Types for trading strategies, risk management, and execution
 */

// Strategy types
export type StrategyType = 'arbitrage' | 'market_making' | 'trend_following' | 'mean_reversion';

export interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  isActive: boolean;
  config: StrategyConfig;
  performance: StrategyPerformance;
  lastExecution?: number;
}

export interface StrategyConfig {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ArbitrageConfig extends StrategyConfig {
  minProfitThreshold: number;
  maxTradeSize: number;
  slippageTolerance: number;
  gasCostThreshold: number;
  excludedPools?: string[];
  maxPriceImpact: number;
}

export interface MarketMakingConfig extends StrategyConfig {
  targetSpread: number;
  rangeWidth: number;
  rebalanceThreshold: number;
  maxPosition: number;
  feeCollectionThreshold: number;
  impermanentLossThreshold: number;
}

export interface StrategyPerformance {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalProfitUsd: number;
  averageProfit: number;
  winRate: number;
  sharpeRatio?: number;
  maxDrawdown: number;
  startTime: number;
  lastUpdateTime: number;
}

// Risk management types
export interface RiskLimits {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  maxConcentration: number;
  maxSlippage: number;
  maxPriceImpact: number;
}

export interface RiskMetrics {
  currentExposure: number;
  dailyPnL: number;
  drawdown: number;
  concentration: Record<string, number>;
  var95: number; // Value at Risk 95%
  expectedShortfall: number;
}

export interface PositionRisk {
  symbol: string;
  size: number;
  value: number;
  percentage: number;
  leverage: number;
  unrealizedPnL: number;
  duration: number;
  volatility: number;
}

// Trading execution types
export interface TradeOrder {
  id: string;
  type: OrderType;
  symbol: string;
  side: TradeSide;
  amount: string;
  price?: string;
  slippage: number;
  timeInForce: TimeInForce;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  executedAt?: number;
  fills: OrderFill[];
}

export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type TradeSide = 'buy' | 'sell';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTT';
export type OrderStatus = 'pending' | 'open' | 'partial' | 'filled' | 'cancelled' | 'rejected';

export interface OrderFill {
  id: string;
  orderId: string;
  amount: string;
  price: string;
  fee: string;
  timestamp: number;
  transactionHash?: string;
}

export interface TradeExecution {
  orderId: string;
  executionId: string;
  symbol: string;
  side: TradeSide;
  amount: string;
  price: string;
  value: string;
  fee: string;
  slippage: number;
  priceImpact: number;
  gasUsed: string;
  gasPrice: string;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
}

// Market data types
export interface MarketCondition {
  trend: TrendDirection;
  volatility: VolatilityLevel;
  liquidity: LiquidityLevel;
  sentiment: MarketSentiment;
  timestamp: number;
}

export type TrendDirection = 'bullish' | 'bearish' | 'sideways';
export type VolatilityLevel = 'low' | 'medium' | 'high' | 'extreme';
export type LiquidityLevel = 'low' | 'medium' | 'high';
export type MarketSentiment = 'fear' | 'neutral' | 'greed';

export interface PriceCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
  trades: number;
}

export interface TechnicalIndicators {
  sma20: number;
  sma50: number;
  ema12: number;
  ema26: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  rsi: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  atr: number;
  obv: number;
}

// Portfolio and position tracking
export interface Portfolio {
  totalValue: number;
  totalValueUsd: number;
  cash: number;
  cashUsd: number;
  unrealizedPnL: number;
  realizedPnL: number;
  positions: Position[];
  dayTradingBuyingPower: number;
  maintenanceMargin: number;
  lastUpdated: number;
}

export interface Position {
  symbol: string;
  size: number;
  averagePrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  dayChange: number;
  dayChangePercent: number;
  openDate: number;
  duration: number;
}

export interface Trade {
  id: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  value: number;
  fee: number;
  timestamp: number;
  orderId: string;
  strategyId?: string;
  pnl?: number;
  tags?: string[];
}

// Performance analytics
export interface PerformanceMetrics {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  calmarRatio: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

export interface DrawdownPeriod {
  start: number;
  end?: number;
  duration: number;
  peak: number;
  trough: number;
  drawdown: number;
  recovery?: number;
}

export interface PerformanceReport {
  period: {
    start: number;
    end: number;
  };
  returns: {
    total: number;
    annualized: number;
    monthly: number[];
    daily: number[];
  };
  risk: {
    volatility: number;
    maxDrawdown: number;
    var95: number;
    expectedShortfall: number;
  };
  ratios: {
    sharpe: number;
    sortino: number;
    calmar: number;
    omega: number;
  };
  trades: {
    total: number;
    winning: number;
    losing: number;
    winRate: number;
    profitFactor: number;
  };
  drawdowns: DrawdownPeriod[];
}

// Alert and notification types
export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  timestamp: number;
  acknowledged: boolean;
  strategy?: string;
  symbol?: string;
}

export type AlertType =
  | 'price_movement'
  | 'position_limit'
  | 'risk_breach'
  | 'strategy_error'
  | 'execution_error'
  | 'slippage_high'
  | 'liquidity_low'
  | 'system_error';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface NotificationSettings {
  enabled: boolean;
  channels: NotificationChannel[];
  alertTypes: AlertType[];
  minimumSeverity: AlertSeverity;
  rateLimits: {
    maxPerHour: number;
    maxPerDay: number;
  };
}

export type NotificationChannel = 'email' | 'webhook' | 'console' | 'file';

// Market analysis types
export interface MarketAnalysis {
  symbol: string;
  timeframe: string;
  trend: {
    direction: TrendDirection;
    strength: number;
    duration: number;
  };
  support: number[];
  resistance: number[];
  volatility: {
    current: number;
    percentile: number;
    regime: VolatilityLevel;
  };
  momentum: {
    rsi: number;
    macd: number;
    stochastic: number;
  };
  volume: {
    current: number;
    average: number;
    profile: VolumeProfile[];
  };
  sentiment: {
    score: number;
    label: MarketSentiment;
    factors: string[];
  };
  recommendation: TradingRecommendation;
  confidence: number;
  timestamp: number;
}

export interface VolumeProfile {
  price: number;
  volume: number;
  type: 'support' | 'resistance' | 'neutral';
}

export interface TradingRecommendation {
  action: 'buy' | 'sell' | 'hold';
  strength: number;
  targetPrice?: number;
  stopLoss?: number;
  timeHorizon: 'short' | 'medium' | 'long';
  reasoning: string[];
}

// Bot configuration types
export interface BotConfiguration {
  strategies: StrategyConfig[];
  risk: RiskLimits;
  execution: ExecutionConfig;
  monitoring: MonitoringConfig;
  notifications: NotificationSettings;
}

export interface ExecutionConfig {
  defaultSlippage: number;
  maxRetries: number;
  retryDelay: number;
  executionTimeout: number;
  batchSize: number;
  rateLimit: {
    requestsPerSecond: number;
    burstLimit: number;
  };
}

export interface MonitoringConfig {
  priceUpdateInterval: number;
  positionCheckInterval: number;
  riskCheckInterval: number;
  performanceUpdateInterval: number;
  healthCheckInterval: number;
  metricsRetention: number;
}

// Event types for logging and analysis
export interface TradingEvent {
  id: string;
  type: TradingEventType;
  timestamp: number;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type TradingEventType =
  | 'trade_executed'
  | 'order_placed'
  | 'order_cancelled'
  | 'position_opened'
  | 'position_closed'
  | 'risk_limit_hit'
  | 'strategy_started'
  | 'strategy_stopped'
  | 'market_condition_change'
  | 'alert_triggered'
  | 'error_occurred';

export interface BacktestConfig {
  strategy: StrategyConfig;
  timeframe: {
    start: number;
    end: number;
  };
  initialCapital: number;
  commission: number;
  slippage: number;
  marketData: {
    symbols: string[];
    resolution: string;
    source: string;
  };
}

export interface BacktestResult {
  config: BacktestConfig;
  performance: PerformanceMetrics;
  trades: Trade[];
  equity: Array<{
    timestamp: number;
    value: number;
    drawdown: number;
  }>;
  statistics: {
    totalDays: number;
    tradingDays: number;
    averageTradesPerDay: number;
    bestDay: number;
    worstDay: number;
    consecutiveWins: number;
    consecutiveLosses: number;
  };
}