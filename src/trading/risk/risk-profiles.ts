/**
 * Risk Profiles for Different Trading Modes
 * Configures risk management parameters based on trading strategy
 */

import { TradingMode, RiskProfile, TradingModeConfig } from '../../types/trading';
import { logger } from '../../utils/logger';

/**
 * Arbitrage-specific risk profile
 *
 * Arbitrage trading involves quick in/out trades to exploit price differences across markets.
 * This strategy typically requires high concentration in a single asset and rapid execution.
 *
 * Rationale for thresholds:
 * - maxConcentration (85%): Allows high concentration for arbitrage efficiency while maintaining
 *   a 15% safety buffer for sudden market changes or liquidity issues
 * - HIGH_RISK (60): Doubled from default 30 to account for temporary portfolio imbalances
 *   during quick arbitrage cycles
 * - CRITICAL_RISK (80): Higher threshold prevents false alarms during normal arbitrage operations
 * - ignoreChecks: Concentration and position age warnings are expected in arbitrage and would
 *   create noise without adding safety value
 */
export const ARBITRAGE_PROFILE: RiskProfile = {
  maxConcentration: 0.85, // 85% concentration for safer arbitrage operations
  riskThresholds: {
    LOW_RISK: 20,      // More lenient thresholds for arbitrage portfolio fluctuations
    MEDIUM_RISK: 35,   // Allows for temporary imbalances during trade execution
    HIGH_RISK: 60,     // Much higher than default 30 - arbitrage creates expected portfolio swings
    CRITICAL_RISK: 80  // Higher than default 45 - only trigger on genuine emergencies
  },
  ignoreChecks: ['concentration', 'position_age'], // Skip concentration warnings - expected in arbitrage
  description: 'Arbitrage trading - allows high concentration with safety buffer, quick trades'
};

/**
 * Market making risk profile
 *
 * Market making involves providing liquidity by maintaining buy/sell orders around current price.
 * This strategy requires moderate concentration to maintain effective spreads while managing inventory risk.
 *
 * Rationale for thresholds:
 * - maxConcentration (70%): Balances inventory management needs with diversification
 * - Risk thresholds: Moderate levels allow for inventory fluctuations while preventing overexposure
 * - ignoreChecks: None - market making benefits from all risk monitoring
 */
export const MARKET_MAKING_PROFILE: RiskProfile = {
  maxConcentration: 0.70, // 70% max for effective market making while managing inventory risk
  riskThresholds: {
    LOW_RISK: 10,      // Conservative baseline
    MEDIUM_RISK: 20,   // Allows for normal inventory fluctuations
    HIGH_RISK: 40,     // Slightly higher than conservative - inventory management creates variance
    CRITICAL_RISK: 60  // Prevents overexposure while allowing strategy operation
  },
  ignoreChecks: [], // Apply all risk checks - market making benefits from comprehensive monitoring
  description: 'Market making - moderate concentration, balanced risk'
};

/**
 * Portfolio trading risk profile
 *
 * Portfolio trading emphasizes diversification and conservative risk management.
 * This is the most restrictive profile, suitable for traditional investment approaches.
 *
 * Rationale for thresholds:
 * - maxConcentration (30%): Traditional portfolio management best practice
 * - Risk thresholds: Conservative levels prioritize capital preservation
 * - ignoreChecks: None - full risk monitoring for maximum safety
 */
export const PORTFOLIO_PROFILE: RiskProfile = {
  maxConcentration: 0.30, // Traditional 30% limit for diversified portfolio management
  riskThresholds: {
    LOW_RISK: 10,      // Conservative baseline for portfolio risk
    MEDIUM_RISK: 15,   // Early warning for portfolio drift
    HIGH_RISK: 30,     // Standard threshold for portfolio concentration risk
    CRITICAL_RISK: 45  // Emergency threshold requiring immediate action
  },
  ignoreChecks: [], // Apply all risk checks - portfolio management benefits from comprehensive monitoring
  description: 'Portfolio trading - conservative limits, full diversification'
};

/**
 * Mixed strategy risk profile
 *
 * Mixed strategy mode balances requirements of multiple trading approaches.
 * This profile provides moderate risk management suitable for diverse strategy combinations.
 *
 * Rationale for thresholds:
 * - maxConcentration (50%): Balance between strategy effectiveness and diversification
 * - Risk thresholds: Moderate levels accommodate different strategy risk profiles
 * - ignoreChecks: None - comprehensive monitoring for strategy interactions
 */
export const MIXED_PROFILE: RiskProfile = {
  maxConcentration: 0.50, // 50% max balances strategy effectiveness with diversification
  riskThresholds: {
    LOW_RISK: 10,      // Conservative baseline
    MEDIUM_RISK: 20,   // Allows for moderate strategy-driven fluctuations
    HIGH_RISK: 35,     // Moderate threshold balancing different strategy needs
    CRITICAL_RISK: 55  // Emergency threshold for mixed strategy operations
  },
  ignoreChecks: [], // Apply all risk checks - mixed strategies benefit from comprehensive monitoring
  description: 'Mixed strategies - balanced risk management'
};

/**
 * Get risk profile for a trading mode
 */
export function getRiskProfile(mode: TradingMode): RiskProfile {
  switch (mode) {
    case TradingMode.ARBITRAGE:
      return ARBITRAGE_PROFILE;
    case TradingMode.MARKET_MAKING:
      return MARKET_MAKING_PROFILE;
    case TradingMode.PORTFOLIO:
      return PORTFOLIO_PROFILE;
    case TradingMode.MIXED:
      return MIXED_PROFILE;
    default:
      // Default to portfolio (most conservative)
      return PORTFOLIO_PROFILE;
  }
}

/**
 * Get trading mode configuration
 */
export function getTradingModeConfig(mode: TradingMode): TradingModeConfig {
  const profile = getRiskProfile(mode);

  return {
    mode,
    profile,
    description: profile.description
  };
}

/**
 * Detect trading mode from enabled strategies
 *
 * Decision matrix:
 * - No strategies: MIXED (default for initialization)
 * - Single arbitrage: ARBITRAGE (high concentration allowed)
 * - Single market making: MARKET_MAKING (moderate concentration)
 * - Single portfolio strategy: PORTFOLIO (conservative limits)
 * - Multiple strategies: MIXED (balanced approach)
 * - Unknown single strategy: PORTFOLIO (conservative fallback)
 */
export function detectTradingMode(enabledStrategies: string[]): TradingMode {
  if (enabledStrategies.length === 0) {
    return TradingMode.MIXED;
  }

  if (enabledStrategies.length === 1) {
    const strategy = enabledStrategies[0].toLowerCase();
    switch (strategy) {
      case 'arbitrage':
        return TradingMode.ARBITRAGE;
      case 'market_making':
      case 'market-making':
      case 'liquidity':
        return TradingMode.MARKET_MAKING;
      case 'portfolio':
      case 'rebalance':
      case 'buy_and_hold':
      case 'buy-and-hold':
      case 'conservative':
        return TradingMode.PORTFOLIO;
      default:
        // Unknown strategy defaults to conservative portfolio mode for safety
        logger.warn(`Unknown strategy '${strategy}' detected, defaulting to PORTFOLIO mode for safety`);
        return TradingMode.PORTFOLIO;
    }
  }

  // Multiple strategies = mixed mode
  return TradingMode.MIXED;
}

/**
 * Get all available risk profiles
 */
export function getAllRiskProfiles(): Record<TradingMode, RiskProfile> {
  return {
    [TradingMode.ARBITRAGE]: ARBITRAGE_PROFILE,
    [TradingMode.MARKET_MAKING]: MARKET_MAKING_PROFILE,
    [TradingMode.PORTFOLIO]: PORTFOLIO_PROFILE,
    [TradingMode.MIXED]: MIXED_PROFILE
  };
}