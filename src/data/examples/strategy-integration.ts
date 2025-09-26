/**
 * Strategy Integration Examples
 * Demonstrates how to integrate historical price data with trading strategies
 */

import { priceCollector, timeSeriesDB } from '../index';
import { logger } from '../../utils/logger';

/**
 * Example 1: Volatility-Based Position Sizing
 * Adjusts position size based on historical volatility
 */
export async function volatilityBasedPositionSizing(
  token: string,
  basePositionSize: number,
  targetVolatility: number = 0.2 // 20% target volatility
): Promise<number> {
  try {
    // Calculate 24-hour volatility
    const volatility = await timeSeriesDB.calculateVolatility(token, 24 * 60 * 60 * 1000);

    if (volatility === 0) {
      logger.warn(`No volatility data available for ${token}, using base position size`);
      return basePositionSize;
    }

    // Adjust position size inversely to volatility
    // High volatility = smaller position, Low volatility = larger position
    const volatilityAdjustment = targetVolatility / volatility;
    const adjustedSize = basePositionSize * Math.min(volatilityAdjustment, 2.0); // Cap at 2x

    logger.info(`${token} volatility adjustment: ${volatility.toFixed(4)} -> ${adjustedSize.toFixed(2)} (${((adjustedSize / basePositionSize - 1) * 100).toFixed(1)}%)`);

    return adjustedSize;

  } catch (error) {
    logger.error(`Error calculating volatility-based position size for ${token}:`, error);
    return basePositionSize;
  }
}

/**
 * Example 2: Mean Reversion Strategy
 * Identifies mean reversion opportunities using price history
 */
export async function detectMeanReversionOpportunity(
  token: string,
  lookbackHours: number = 4,
  deviationThreshold: number = 0.02 // 2% deviation threshold
): Promise<{
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  currentPrice: number;
  meanPrice: number;
  deviation: number;
}> {
  try {
    // Get recent price history
    const startTime = Date.now() - (lookbackHours * 60 * 60 * 1000);
    const priceHistory = await timeSeriesDB.getPriceHistory(token, {
      startTime,
      endTime: Date.now(),
      orderBy: 'ASC'
    });

    if (priceHistory.length < 10) {
      logger.warn(`Insufficient price data for ${token} mean reversion analysis`);
      return {
        signal: 'hold',
        confidence: 0,
        currentPrice: 0,
        meanPrice: 0,
        deviation: 0
      };
    }

    // Calculate mean price over the period
    const prices = priceHistory.map(p => p.getPriceUsd());
    const meanPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const currentPrice = prices[prices.length - 1];

    // Calculate deviation from mean
    const deviation = (currentPrice - meanPrice) / meanPrice;

    // Generate signal based on deviation
    let signal: 'buy' | 'sell' | 'hold' = 'hold';
    let confidence = 0;

    if (Math.abs(deviation) > deviationThreshold) {
      if (deviation < -deviationThreshold) {
        // Price below mean - potential buy signal
        signal = 'buy';
        confidence = Math.min(Math.abs(deviation) / deviationThreshold, 1.0);
      } else if (deviation > deviationThreshold) {
        // Price above mean - potential sell signal
        signal = 'sell';
        confidence = Math.min(Math.abs(deviation) / deviationThreshold, 1.0);
      }
    }

    logger.info(`${token} mean reversion: ${signal} (confidence: ${(confidence * 100).toFixed(1)}%, deviation: ${(deviation * 100).toFixed(2)}%)`);

    return {
      signal,
      confidence,
      currentPrice,
      meanPrice,
      deviation
    };

  } catch (error) {
    logger.error(`Error detecting mean reversion for ${token}:`, error);
    return {
      signal: 'hold',
      confidence: 0,
      currentPrice: 0,
      meanPrice: 0,
      deviation: 0
    };
  }
}

/**
 * Example 3: Momentum Strategy Using OHLCV Data
 * Uses candlestick patterns to identify momentum
 */
export async function detectMomentumSignal(
  token: string,
  lookbackCandles: number = 10
): Promise<{
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: number;
  pattern: string;
}> {
  try {
    // Get recent hourly candles
    const ohlcvData = await timeSeriesDB.getOHLCV(token, {
      intervalType: '1h',
      orderBy: 'DESC',
      limit: lookbackCandles
    });

    if (ohlcvData.length < lookbackCandles) {
      logger.warn(`Insufficient OHLCV data for ${token} momentum analysis`);
      return {
        signal: 'neutral',
        strength: 0,
        pattern: 'insufficient_data'
      };
    }

    // Analyze recent candles
    const recentCandles = ohlcvData.reverse(); // Chronological order
    const bullishCandles = recentCandles.filter(c => c.isBullish()).length;
    const bearishCandles = recentCandles.length - bullishCandles;

    // Calculate momentum strength
    const momentumRatio = bullishCandles / recentCandles.length;
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let strength = 0;
    let pattern = 'mixed';

    if (momentumRatio >= 0.7) {
      signal = 'bullish';
      strength = momentumRatio;
      pattern = 'strong_uptrend';
    } else if (momentumRatio <= 0.3) {
      signal = 'bearish';
      strength = 1 - momentumRatio;
      pattern = 'strong_downtrend';
    } else if (momentumRatio >= 0.6) {
      signal = 'bullish';
      strength = momentumRatio;
      pattern = 'weak_uptrend';
    } else if (momentumRatio <= 0.4) {
      signal = 'bearish';
      strength = 1 - momentumRatio;
      pattern = 'weak_downtrend';
    }

    // Check for specific patterns
    const latestCandle = recentCandles[recentCandles.length - 1];
    const previousCandle = recentCandles[recentCandles.length - 2];

    if (latestCandle && previousCandle) {
      const bodySize = latestCandle.getBodySize();
      const wickSize = latestCandle.getWickSize();

      // Doji pattern (small body, large wicks)
      if (bodySize < wickSize * 0.1) {
        pattern = 'doji_indecision';
        signal = 'neutral';
        strength = 0.1;
      }

      // Hammer/Shooting star patterns
      if (bodySize > wickSize * 0.5) {
        if (latestCandle.isBullish() && latestCandle.getClosePrice() > previousCandle.getClosePrice()) {
          pattern = 'bullish_hammer';
          signal = 'bullish';
          strength = Math.min(strength + 0.2, 1.0);
        } else if (!latestCandle.isBullish() && latestCandle.getClosePrice() < previousCandle.getClosePrice()) {
          pattern = 'bearish_shooting_star';
          signal = 'bearish';
          strength = Math.min(strength + 0.2, 1.0);
        }
      }
    }

    logger.info(`${token} momentum: ${signal} (strength: ${(strength * 100).toFixed(1)}%, pattern: ${pattern})`);

    return {
      signal,
      strength,
      pattern
    };

  } catch (error) {
    logger.error(`Error detecting momentum for ${token}:`, error);
    return {
      signal: 'neutral',
      strength: 0,
      pattern: 'error'
    };
  }
}

/**
 * Example 4: Arbitrage Timing Optimization
 * Uses price volatility to optimize arbitrage timing
 */
export async function optimizeArbitrageTimingting(
  tokenA: string,
  tokenB: string,
  minProfitThreshold: number = 0.005 // 0.5% minimum profit
): Promise<{
  shouldExecute: boolean;
  confidence: number;
  reason: string;
  volatilityA: number;
  volatilityB: number;
}> {
  try {
    // Calculate short-term volatility for both tokens
    const volatilityPeriod = 2 * 60 * 60 * 1000; // 2 hours

    const [volatilityA, volatilityB] = await Promise.all([
      timeSeriesDB.calculateVolatility(tokenA, volatilityPeriod),
      timeSeriesDB.calculateVolatility(tokenB, volatilityPeriod)
    ]);

    // Get recent prices to check for trends
    const [pricesA, pricesB] = await Promise.all([
      timeSeriesDB.getPriceHistory(tokenA, {
        startTime: Date.now() - (30 * 60 * 1000), // Last 30 minutes
        orderBy: 'ASC'
      }),
      timeSeriesDB.getPriceHistory(tokenB, {
        startTime: Date.now() - (30 * 60 * 1000), // Last 30 minutes
        orderBy: 'ASC'
      })
    ]);

    if (pricesA.length < 3 || pricesB.length < 3) {
      return {
        shouldExecute: false,
        confidence: 0,
        reason: 'insufficient_price_data',
        volatilityA,
        volatilityB
      };
    }

    // Calculate price momentum
    const momentumA = (pricesA[pricesA.length - 1].getPriceUsd() - pricesA[0].getPriceUsd()) / pricesA[0].getPriceUsd();
    const momentumB = (pricesB[pricesB.length - 1].getPriceUsd() - pricesB[0].getPriceUsd()) / pricesB[0].getPriceUsd();

    let shouldExecute = false;
    let confidence = 0;
    let reason = 'conditions_not_met';

    // Optimal conditions for arbitrage:
    // 1. Low to moderate volatility (reduces execution risk)
    // 2. Stable or converging prices (reduces price impact)
    // 3. Recent price movement suggests continued opportunity

    const optimalVolatility = 0.15; // 15% annualized volatility
    const maxVolatility = 0.30; // 30% max volatility

    if (volatilityA <= maxVolatility && volatilityB <= maxVolatility) {
      // Volatility is manageable
      const avgVolatility = (volatilityA + volatilityB) / 2;
      const volatilityScore = Math.max(0, 1 - (avgVolatility / optimalVolatility));

      // Check momentum alignment
      const momentumDivergence = Math.abs(momentumA - momentumB);
      const momentumScore = Math.max(0, 1 - (momentumDivergence * 10)); // Penalize divergent momentum

      // Overall confidence
      confidence = (volatilityScore * 0.6) + (momentumScore * 0.4);

      if (confidence >= 0.6) {
        shouldExecute = true;
        reason = 'optimal_conditions';
      } else if (confidence >= 0.4) {
        shouldExecute = false;
        reason = 'marginal_conditions';
      } else {
        shouldExecute = false;
        reason = 'suboptimal_conditions';
      }
    } else {
      reason = 'high_volatility_risk';
    }

    logger.info(`Arbitrage timing ${tokenA}/${tokenB}: ${shouldExecute ? 'EXECUTE' : 'WAIT'} (confidence: ${(confidence * 100).toFixed(1)}%, reason: ${reason})`);

    return {
      shouldExecute,
      confidence,
      reason,
      volatilityA,
      volatilityB
    };

  } catch (error) {
    logger.error(`Error optimizing arbitrage timing for ${tokenA}/${tokenB}:`, error);
    return {
      shouldExecute: false,
      confidence: 0,
      reason: 'analysis_error',
      volatilityA: 0,
      volatilityB: 0
    };
  }
}

/**
 * Example 5: Strategy Performance Backtesting
 * Backtests a strategy against historical data
 */
export async function backtestStrategy(
  token: string,
  strategyFunc: (candle: any, history: any[]) => 'buy' | 'sell' | 'hold',
  backtestPeriodDays: number = 7,
  initialCapital: number = 1000
): Promise<{
  totalReturn: number;
  totalTrades: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
}> {
  try {
    logger.info(`Starting backtest for ${token} over ${backtestPeriodDays} days`);

    // Get historical OHLCV data
    const startTime = Date.now() - (backtestPeriodDays * 24 * 60 * 60 * 1000);
    const ohlcvData = await timeSeriesDB.getOHLCV(token, {
      intervalType: '1h',
      startTime,
      endTime: Date.now(),
      orderBy: 'ASC'
    });

    if (ohlcvData.length < 24) {
      throw new Error(`Insufficient data for backtest: ${ohlcvData.length} candles`);
    }

    let capital = initialCapital;
    let position = 0; // 0 = no position, 1 = long, -1 = short
    let entryPrice = 0;
    const trades: any[] = [];
    let maxCapital = initialCapital;
    let maxDrawdown = 0;
    const returns: number[] = [];

    // Run backtest
    for (let i = 20; i < ohlcvData.length; i++) { // Start at 20 to have history
      const currentCandle = ohlcvData[i];
      const history = ohlcvData.slice(Math.max(0, i - 20), i);

      const signal = strategyFunc(currentCandle, history);
      const currentPrice = currentCandle.getClosePrice();

      if (signal === 'buy' && position === 0) {
        // Enter long position
        position = 1;
        entryPrice = currentPrice;
        logger.debug(`ENTER LONG at ${entryPrice} on ${new Date(currentCandle.interval_start).toISOString()}`);

      } else if (signal === 'sell' && position === 1) {
        // Exit long position
        const returnPct = (currentPrice - entryPrice) / entryPrice;
        capital *= (1 + returnPct);
        returns.push(returnPct);

        trades.push({
          entry: entryPrice,
          exit: currentPrice,
          return: returnPct,
          timestamp: currentCandle.interval_start
        });

        logger.debug(`EXIT LONG at ${currentPrice}, return: ${(returnPct * 100).toFixed(2)}%`);
        position = 0;

        // Update drawdown
        if (capital > maxCapital) {
          maxCapital = capital;
        }
        const drawdown = (maxCapital - capital) / maxCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    // Calculate metrics
    const totalReturn = (capital - initialCapital) / initialCapital;
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.return > 0).length;
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

    // Calculate Sharpe ratio (simplified)
    const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const returnStd = returns.length > 1 ?
      Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)) : 0;
    const sharpeRatio = returnStd > 0 ? avgReturn / returnStd : 0;

    const results = {
      totalReturn,
      totalTrades,
      winRate,
      maxDrawdown,
      sharpeRatio
    };

    logger.info(`Backtest results for ${token}:`, results);
    return results;

  } catch (error) {
    logger.error(`Backtest failed for ${token}:`, error);
    return {
      totalReturn: 0,
      totalTrades: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0
    };
  }
}

// Example strategy function for backtesting
export function simpleMeanReversionStrategy(candle: any, history: any[]): 'buy' | 'sell' | 'hold' {
  if (history.length < 10) return 'hold';

  const prices = history.map((c: any) => c.getClosePrice());
  const sma = prices.reduce((sum: number, p: number) => sum + p, 0) / prices.length;
  const currentPrice = candle.getClosePrice();

  const deviation = (currentPrice - sma) / sma;

  if (deviation < -0.02) return 'buy';  // 2% below SMA
  if (deviation > 0.02) return 'sell';  // 2% above SMA
  return 'hold';
}