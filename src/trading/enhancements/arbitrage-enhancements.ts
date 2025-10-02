/**
 * Phase 7: Advanced Arbitrage Enhancements
 *
 * Comprehensive enhancements for maximizing arbitrage profitability:
 * 1. Parallel Opportunity Execution - Execute multiple non-conflicting routes
 * 2. Advanced Profit Tracking - Learn from successful trades
 * 3. Volatility-Adaptive Thresholds - Dynamic profit requirements
 * 4. Smart Route Prioritization - Favor historically profitable patterns
 */

import { logger } from '../../utils/logger';
import { ExoticRoute } from '../execution/exotic-arbitrage-executor';
import * as fs from 'fs';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';

// ============================================================================
// STATE TRACKING FOR CIRCUIT BREAKER
// ============================================================================

let consecutiveFailures = 0;
let learningDisabled = false;

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface RoutePerformance {
  routeSignature: string; // Hash of token sequence
  symbols: string[]; // Human-readable route
  attempts: number;
  successes: number;
  totalProfit: number;
  avgProfitPercent: number;
  lastExecutedAt: number;
  successRate: number;
  confidence: number; // 0-1 score based on attempts and success rate
}

export interface ArbitrageLearningData {
  routes: Record<string, RoutePerformance>;
  globalStats: {
    totalSuccessfulTrades: number;
    totalAttemptedTrades: number;
    totalProfit: number;
    lastUpdateTime: number;
    avgVolatility: number; // Moving average of price volatility
    recentProfitability: number; // Recent 10-trade average profit %
  };
  volatilityHistory: number[]; // Last 100 volatility measurements
  profitHistory: number[]; // Last 100 profit percentages
}

export interface ParallelExecutionResult {
  totalRoutes: number;
  executedRoutes: number;
  successfulRoutes: number;
  failedRoutes: number;
  skippedRoutes: number;
  totalProfit: number;
  executionTimeMs: number;
}

export interface AdaptiveThresholds {
  minProfitThreshold: number;
  volatilityAdjustment: number;
  confidenceBonus: number;
  finalThreshold: number;
}

// ============================================================================
// ROUTE SIGNATURE GENERATION
// ============================================================================

/**
 * Generate a consistent signature for a route regardless of token order
 * Uses token symbols for human readability
 */
export function generateRouteSignature(symbols: string[]): string {
  return symbols.join('→');
}

// ============================================================================
// LEARNING DATA PERSISTENCE
// ============================================================================

const LEARNING_DATA_PATH = path.join(process.cwd(), 'data', 'arbitrage-learning.json');

/**
 * Load learning data from disk
 */
export function loadLearningData(): ArbitrageLearningData {
  try {
    if (fs.existsSync(LEARNING_DATA_PATH)) {
      const data = fs.readFileSync(LEARNING_DATA_PATH, 'utf-8');
      const parsed = JSON.parse(data);

      // 🔧 MIGRATION: Convert old "pairs" to new "routes"
      if (!parsed.routes && (parsed as { pairs?: Record<string, RoutePerformance> }).pairs) {
        logger.warn('⚠️  Migrating old learning data from "pairs" to "routes" format');
        parsed.routes = (parsed as { pairs: Record<string, RoutePerformance> }).pairs;
        delete (parsed as { pairs?: Record<string, RoutePerformance> }).pairs;

        // Auto-save migrated data
        try {
          const dataDir = path.dirname(LEARNING_DATA_PATH);
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
          fs.writeFileSync(LEARNING_DATA_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
          logger.info('✅ Learning data migrated and saved');
        } catch (saveError) {
          logger.error('Failed to save migrated data:', saveError);
        }
      }

      // Add missing fields
      if (!parsed.volatilityHistory) parsed.volatilityHistory = [];
      if (!parsed.profitHistory) parsed.profitHistory = [];
      if (!parsed.globalStats) parsed.globalStats = {};
      if (!parsed.globalStats.avgVolatility) parsed.globalStats.avgVolatility = 0;
      if (!parsed.globalStats.recentProfitability) parsed.globalStats.recentProfitability = 0;

      // Ensure all required fields exist
      return {
        routes: parsed.routes || {},
        globalStats: {
          totalSuccessfulTrades: parsed.globalStats?.totalSuccessfulTrades || 0,
          totalAttemptedTrades: parsed.globalStats?.totalAttemptedTrades || 0,
          totalProfit: parsed.globalStats?.totalProfit || 0,
          lastUpdateTime: parsed.globalStats?.lastUpdateTime || Date.now(),
          avgVolatility: parsed.globalStats?.avgVolatility || 0,
          recentProfitability: parsed.globalStats?.recentProfitability || 0
        },
        volatilityHistory: parsed.volatilityHistory || [],
        profitHistory: parsed.profitHistory || []
      };
    }
  } catch (error) {
    logger.error('Failed to load learning data:', error);
  }

  // Return default empty structure
  return {
    routes: {},
    globalStats: {
      totalSuccessfulTrades: 0,
      totalAttemptedTrades: 0,
      totalProfit: 0,
      lastUpdateTime: Date.now(),
      avgVolatility: 0,
      recentProfitability: 0
    },
    volatilityHistory: [],
    profitHistory: []
  };
}

/**
 * Save learning data to disk with file locking to prevent race conditions
 * Includes circuit breaker pattern to disable learning on persistent failures
 */
export async function saveLearningData(data: ArbitrageLearningData): Promise<void> {
  // Circuit breaker: Skip if learning disabled due to persistent failures
  if (learningDisabled) {
    logger.warn('⚠️  Learning system disabled due to persistent save failures');
    return;
  }

  let release: (() => Promise<void>) | undefined;

  try {
    // Ensure data directory exists
    const dataDir = path.dirname(LEARNING_DATA_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Acquire file lock with retry mechanism
    release = await lockfile.lock(LEARNING_DATA_PATH, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 500
      },
      stale: 10000 // Consider lock stale after 10 seconds
    });

    // Write data while holding lock
    fs.writeFileSync(LEARNING_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');

    // Reset failure counter on success
    consecutiveFailures = 0;
    logger.debug('✅ Learning data saved');

  } catch (error) {
    consecutiveFailures++;
    logger.error(`Failed to save learning data (attempt ${consecutiveFailures}):`, error);

    // Circuit breaker: Disable learning after too many failures
    if (consecutiveFailures > 5) {
      logger.error('🚨 Too many save failures - disabling learning system');
      learningDisabled = true;
    }
  } finally {
    // Always release lock
    if (release) {
      try {
        await release();
      } catch (error) {
        logger.error('Failed to release file lock:', error);
      }
    }
  }
}

// ============================================================================
// PROFIT TRACKING AND LEARNING
// ============================================================================

/**
 * Record a trade attempt and outcome for learning
 */
export async function recordTradeOutcome(
  route: ExoticRoute,
  success: boolean,
  actualProfit?: number
): Promise<void> {
  const learningData = loadLearningData();
  const routeSignature = generateRouteSignature(route.symbols);

  // Update or create route performance
  if (!learningData.routes[routeSignature]) {
    learningData.routes[routeSignature] = {
      routeSignature,
      symbols: route.symbols,
      attempts: 0,
      successes: 0,
      totalProfit: 0,
      avgProfitPercent: 0,
      lastExecutedAt: Date.now(),
      successRate: 0,
      confidence: 0
    };
  }

  const routePerf = learningData.routes[routeSignature];
  routePerf.attempts++;
  routePerf.lastExecutedAt = Date.now();

  if (success && actualProfit !== undefined) {
    routePerf.successes++;
    routePerf.totalProfit += actualProfit;
    routePerf.avgProfitPercent = (routePerf.totalProfit / routePerf.successes);

    // Update global profit history (last 100 trades)
    learningData.profitHistory.push(actualProfit);
    if (learningData.profitHistory.length > 100) {
      learningData.profitHistory.shift();
    }
  }

  // Calculate success rate and confidence
  routePerf.successRate = routePerf.successes / routePerf.attempts;

  // ✅ FIX: Confidence increases exponentially with more attempts
  // Formula: successRate * (1 - e^(-attempts/20))
  // Requires ~50 attempts for 90% confidence, ~100 for 95%
  const attemptConfidence = 1 - Math.exp(-routePerf.attempts / 20);
  routePerf.confidence = routePerf.successRate * attemptConfidence;

  // Update global stats
  learningData.globalStats.totalAttemptedTrades++;
  if (success) {
    learningData.globalStats.totalSuccessfulTrades++;
    if (actualProfit !== undefined) {
      learningData.globalStats.totalProfit += actualProfit;
    }
  }

  // Calculate recent profitability (last 10 trades)
  const recentProfits = learningData.profitHistory.slice(-10);
  learningData.globalStats.recentProfitability = recentProfits.length > 0
    ? recentProfits.reduce((sum, p) => sum + p, 0) / recentProfits.length
    : 0;

  learningData.globalStats.lastUpdateTime = Date.now();

  await saveLearningData(learningData);

  logger.info(`📊 Recorded trade: ${routeSignature} (${success ? 'SUCCESS' : 'FAILED'}) - Confidence: ${(routePerf.confidence * 100).toFixed(1)}%`);
}

// ============================================================================
// VOLATILITY TRACKING
// ============================================================================

/**
 * Record market volatility measurement
 * Volatility = average absolute price change across all routes
 */
export async function recordVolatility(volatility: number): Promise<void> {
  const learningData = loadLearningData();

  learningData.volatilityHistory.push(volatility);
  if (learningData.volatilityHistory.length > 100) {
    learningData.volatilityHistory.shift();
  }

  // Update moving average
  const recentVolatility = learningData.volatilityHistory.slice(-20);
  learningData.globalStats.avgVolatility = recentVolatility.reduce((sum, v) => sum + v, 0) / recentVolatility.length;

  await saveLearningData(learningData);
}

/**
 * Calculate current market volatility from a set of opportunities
 */
export function calculateMarketVolatility(opportunities: ExoticRoute[]): number {
  if (opportunities.length === 0) return 0;

  // Volatility = average absolute profit percentage across all opportunities
  const avgProfitChange = opportunities.reduce((sum, opp) => sum + Math.abs(opp.profitPercent), 0) / opportunities.length;

  return avgProfitChange;
}

// ============================================================================
// ADAPTIVE THRESHOLD CALCULATION
// ============================================================================

/**
 * Calculate adaptive profit threshold based on market conditions
 */
export function calculateAdaptiveThreshold(
  baseThreshold: number,
  route?: ExoticRoute
): AdaptiveThresholds {
  const learningData = loadLearningData();

  let volatilityAdjustment = 0;
  let confidenceBonus = 0;

  // ✅ FIX: Volatility adjustment with conservative limits
  // Lower threshold in volatile markets (more opportunities), but cap max reduction
  if (learningData.globalStats.avgVolatility > 0) {
    // High volatility (>3%) → reduce threshold by up to 0.3% (was 0.5%, too aggressive)
    // Medium volatility (>2%) → reduce threshold by 0.2%
    // Low volatility (<1%) → increase threshold by up to 0.3%
    if (learningData.globalStats.avgVolatility > 3.0) {
      volatilityAdjustment = -0.3;
    } else if (learningData.globalStats.avgVolatility > 2.0) {
      volatilityAdjustment = -0.2;
    } else if (learningData.globalStats.avgVolatility < 1.0) {
      volatilityAdjustment = 0.3;
    }
  }

  // Confidence bonus: Lower threshold for high-confidence routes
  if (route) {
    const routeSignature = generateRouteSignature(route.symbols);
    const routePerf = learningData.routes[routeSignature];

    if (routePerf && routePerf.confidence > 0.7) {
      // High-confidence routes (>70%) get up to 0.5% threshold reduction
      confidenceBonus = -(routePerf.confidence - 0.7) * 1.67; // Scale 0.7-1.0 to 0-0.5
    }
  }

  const finalThreshold = baseThreshold + volatilityAdjustment + confidenceBonus;

  return {
    minProfitThreshold: baseThreshold,
    volatilityAdjustment,
    confidenceBonus,
    finalThreshold: Math.max(0.1, finalThreshold) // Never below 0.1%
  };
}

// ============================================================================
// SMART ROUTE PRIORITIZATION
// ============================================================================

/**
 * Sort routes by priority based on historical performance
 */
export function prioritizeRoutes(routes: ExoticRoute[]): ExoticRoute[] {
  const learningData = loadLearningData();

  return routes.sort((a, b) => {
    const sigA = generateRouteSignature(a.symbols);
    const sigB = generateRouteSignature(b.symbols);

    const perfA = learningData.routes[sigA];
    const perfB = learningData.routes[sigB];

    // Primary: Profit percent (highest first)
    const profitDiff = b.profitPercent - a.profitPercent;
    if (Math.abs(profitDiff) > 0.5) { // Significant difference
      return profitDiff > 0 ? 1 : -1;
    }

    // Secondary: Historical confidence (if available)
    const confA = perfA?.confidence || 0;
    const confB = perfB?.confidence || 0;

    if (Math.abs(confA - confB) > 0.1) {
      return confB - confA;
    }

    // Tertiary: Success rate
    const rateA = perfA?.successRate || 0;
    const rateB = perfB?.successRate || 0;

    return rateB - rateA;
  });
}

/**
 * Get top performing routes from history
 */
export function getTopPerformingRoutes(limit: number = 10): RoutePerformance[] {
  const learningData = loadLearningData();

  return Object.values(learningData.routes)
    .filter(r => r.attempts >= 3) // Minimum 3 attempts for reliability
    .sort((a, b) => {
      // Sort by confidence * avgProfitPercent
      const scoreA = a.confidence * a.avgProfitPercent;
      const scoreB = b.confidence * b.avgProfitPercent;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

// ============================================================================
// PARALLEL EXECUTION LOGIC
// ============================================================================

/**
 * Identify non-conflicting routes that can be executed in parallel
 * Routes conflict if they share any common tokens INCLUDING the starting token
 *
 * CRITICAL: All arbitrage routes start/end with same token (usually GALA),
 * so they ALL need wallet balance. Only one route per batch allowed!
 */
export function identifyParallelRoutes(routes: ExoticRoute[]): ExoticRoute[][] {
  const batches: ExoticRoute[][] = [];
  const remaining = [...routes];

  while (remaining.length > 0) {
    const batch: ExoticRoute[] = [];
    const usedTokens = new Set<string>();

    for (let i = remaining.length - 1; i >= 0; i--) {
      const route = remaining[i];

      // ✅ FIX: Include starting token + intermediate tokens
      // All tokens that need to be available for this route
      const allTokens = new Set([
        route.symbols[0],  // Starting token (critical - all routes need this!)
        ...route.symbols.slice(1, -1)  // Intermediate tokens
      ]);

      // Check if any token is already used
      const hasConflict = Array.from(allTokens).some(token => usedTokens.has(token));

      if (!hasConflict) {
        batch.push(route);
        // Mark ALL tokens as used
        allTokens.forEach(token => usedTokens.add(token));
        remaining.splice(i, 1);
      }
    }

    if (batch.length > 0) {
      batches.push(batch);
    } else {
      // Prevent infinite loop if conflict detection fails
      break;
    }
  }

  return batches;
}

/**
 * Get parallel execution statistics
 */
export function getParallelExecutionStats(batches: ExoticRoute[][]): {
  totalBatches: number;
  parallelRoutes: number;
  maxParallelism: number;
  avgParallelism: number;
} {
  const totalBatches = batches.length;
  const parallelRoutes = batches.reduce((sum, batch) => sum + batch.length, 0);
  const maxParallelism = Math.max(...batches.map(b => b.length), 0);
  const avgParallelism = totalBatches > 0 ? parallelRoutes / totalBatches : 0;

  return {
    totalBatches,
    parallelRoutes,
    maxParallelism,
    avgParallelism
  };
}

// ============================================================================
// STATISTICS AND REPORTING
// ============================================================================

/**
 * Get comprehensive learning statistics
 */
export function getLearningStatistics(): {
  globalStats: ArbitrageLearningData['globalStats'];
  totalRoutes: number;
  topRoutes: RoutePerformance[];
  avgSuccessRate: number;
  recentVolatility: number;
} {
  const learningData = loadLearningData();
  const routes = Object.values(learningData.routes);

  const avgSuccessRate = routes.length > 0
    ? routes.reduce((sum, r) => sum + r.successRate, 0) / routes.length
    : 0;

  return {
    globalStats: learningData.globalStats,
    totalRoutes: routes.length,
    topRoutes: getTopPerformingRoutes(5),
    avgSuccessRate,
    recentVolatility: learningData.globalStats.avgVolatility
  };
}

/**
 * Log learning statistics summary
 */
export function logLearningStats(): void {
  const stats = getLearningStatistics();

  logger.info('📚 LEARNING STATISTICS:');
  logger.info(`   Total Trades: ${stats.globalStats.totalAttemptedTrades} (${stats.globalStats.totalSuccessfulTrades} successful)`);
  logger.info(`   Total Profit: ${stats.globalStats.totalProfit.toFixed(2)} GALA`);
  logger.info(`   Avg Success Rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%`);
  logger.info(`   Recent Profitability: ${stats.globalStats.recentProfitability.toFixed(2)}% avg`);
  logger.info(`   Market Volatility: ${stats.globalStats.avgVolatility.toFixed(2)}% avg`);
  logger.info(`   Known Routes: ${stats.totalRoutes}`);

  if (stats.topRoutes.length > 0) {
    logger.info('   Top 3 Routes:');
    stats.topRoutes.slice(0, 3).forEach((route, idx) => {
      logger.info(`     ${idx + 1}. ${route.symbols.join(' → ')} - ${route.avgProfitPercent.toFixed(2)}% avg (${route.attempts} attempts, ${(route.successRate * 100).toFixed(0)}% success)`);
    });
  }
}
