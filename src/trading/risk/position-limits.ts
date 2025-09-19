/**
 * Position Limits
 * Risk management for position sizing and exposure limits
 */

import { GalaSwapClient } from '../../api/GalaSwapClient';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';

export interface PositionLimitsConfig {
  maxPositionSize: number;
  maxTotalExposure: number;
  maxPositionsPerToken: number;
  concentrationLimit: number; // Max % of portfolio in single token
}

export interface PositionExposure {
  token: string;
  totalAmount: number;
  positionCount: number;
  percentOfPortfolio: number;
  isWithinLimits: boolean;
}

export class PositionLimits {
  private config: TradingConfig;
  private limitsConfig: PositionLimitsConfig;

  constructor(config: TradingConfig) {
    this.config = config;
    this.limitsConfig = {
      maxPositionSize: config.maxPositionSize,
      maxTotalExposure: config.maxPositionSize * 5, // 5x max position size
      maxPositionsPerToken: 3,
      concentrationLimit: 0.3, // 30% max concentration
    };

    logger.info('Position Limits initialized with config:', this.limitsConfig);
  }

  /**
   * Check if current positions are within limits
   */
  async checkLimits(userAddress: string): Promise<boolean> {
    try {
      // TODO: Get current positions from GalaSwap API
      const exposures = await this.calculateExposures(userAddress);

      // Check individual token limits
      for (const exposure of exposures) {
        if (!exposure.isWithinLimits) {
          logger.warn(`Position limits exceeded for ${exposure.token}:`, {
            amount: exposure.totalAmount,
            limit: this.limitsConfig.maxPositionSize,
            concentration: exposure.percentOfPortfolio,
            concentrationLimit: this.limitsConfig.concentrationLimit,
          });
          return false;
        }
      }

      // Check total exposure
      const totalExposure = exposures.reduce((sum, exp) => sum + exp.totalAmount, 0);
      if (totalExposure > this.limitsConfig.maxTotalExposure) {
        logger.warn(`Total exposure limit exceeded: ${totalExposure} > ${this.limitsConfig.maxTotalExposure}`);
        return false;
      }

      return true;

    } catch (error) {
      logger.error('Error checking position limits:', error);
      return false; // Fail safe - don't trade if we can't check limits
    }
  }

  /**
   * Calculate current exposures by token
   */
  private async calculateExposures(userAddress: string): Promise<PositionExposure[]> {
    try {
      // Get token balances from wallet
      const balances = await this.getTokenBalances(userAddress);

      // Get current prices for all tokens
      const prices = await this.getCurrentPrices(balances.map(b => b.token));

      // Calculate total portfolio value
      const totalPortfolioValue = balances.reduce((sum, balance) => {
        const price = prices[balance.token] || 0;
        return sum + (balance.amount * price);
      }, 0);

      // Calculate exposures by token
      const exposures: PositionExposure[] = balances
        .filter(balance => balance.amount > 0)
        .map(balance => {
          const price = prices[balance.token] || 0;
          const totalAmount = balance.amount * price;
          const percentOfPortfolio = totalPortfolioValue > 0 ? totalAmount / totalPortfolioValue : 0;

          return {
            token: balance.token,
            totalAmount,
            positionCount: 1, // For now, count each token as one position
            percentOfPortfolio,
            isWithinLimits: true // Will be calculated below
          };
        });

      // Check limits for each exposure
      return exposures.map(exposure => ({
        ...exposure,
        isWithinLimits: this.isExposureWithinLimits(exposure),
      }));

    } catch (error) {
      logger.error('Error calculating exposures:', error);

      // Return empty array instead of mock data on error
      return [];
    }
  }

  /**
   * Get token balances for user wallet
   */
  private async getTokenBalances(userAddress: string): Promise<{ token: string; amount: number }[]> {
    try {
      // TODO: Implement actual balance fetching from GalaSwap API
      // For now, return placeholder data
      logger.debug('Fetching token balances for address:', userAddress);

      // This would typically call:
      // const balances = await this.galaSwapClient.getTokenBalances(userAddress);

      // Placeholder implementation
      return [
        { token: 'GALA', amount: 1000 },
        { token: 'USDC', amount: 500 }
      ];

    } catch (error) {
      logger.error('Error fetching token balances:', error);
      return [];
    }
  }

  /**
   * Get current token prices
   */
  private async getCurrentPrices(tokens: string[]): Promise<{ [token: string]: number }> {
    try {
      const prices: { [token: string]: number } = {};

      // TODO: Implement actual price fetching
      // For now, return placeholder prices
      for (const token of tokens) {
        switch (token) {
          case 'GALA':
            prices[token] = 0.05; // $0.05 per GALA
            break;
          case 'USDC':
            prices[token] = 1.0; // $1.00 per USDC
            break;
          default:
            prices[token] = 0.01; // Default price
        }
      }

      return prices;

    } catch (error) {
      logger.error('Error fetching current prices:', error);
      return {};
    }
  }

  /**
   * Check if a specific exposure is within limits
   */
  private isExposureWithinLimits(exposure: PositionExposure): boolean {
    // Check position size limit
    if (exposure.totalAmount > this.limitsConfig.maxPositionSize) {
      return false;
    }

    // Check position count limit
    if (exposure.positionCount > this.limitsConfig.maxPositionsPerToken) {
      return false;
    }

    // Check concentration limit
    if (exposure.percentOfPortfolio > this.limitsConfig.concentrationLimit) {
      return false;
    }

    return true;
  }

  /**
   * Check if a new trade would exceed limits
   */
  async canOpenPosition(
    token: string,
    amount: number,
    userAddress: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      this.resetDailyLimitsIfNeeded();

      const exposures = await this.calculateExposures(userAddress);
      const currentExposure = exposures.find(exp => exp.token === token);

      // Check daily volume limit FIRST (higher priority than position size)
      const currentDailyVolume = this.dailyVolume.get(token) || 0;
      const maxDailyVolume = this.config.maxDailyVolume || 10000;
      if (currentDailyVolume + amount > maxDailyVolume) {
        return {
          allowed: false,
          reason: `daily volume would exceed limit: ${currentDailyVolume + amount} > ${maxDailyVolume}`,
        };
      }

      // Calculate new position size
      const newAmount = (currentExposure?.totalAmount || 0) + amount;

      // Check position size limit
      if (newAmount > this.limitsConfig.maxPositionSize) {
        return {
          allowed: false,
          reason: `position size would exceed limit: ${newAmount} > ${this.limitsConfig.maxPositionSize}`,
        };
      }

      // Check position count limit
      const newCount = (currentExposure?.positionCount || 0) + 1;
      if (newCount > this.limitsConfig.maxPositionsPerToken) {
        return {
          allowed: false,
          reason: `Position count would exceed limit: ${newCount} > ${this.limitsConfig.maxPositionsPerToken}`,
        };
      }

      // Calculate new total exposure
      const totalExposure = exposures.reduce((sum, exp) => sum + exp.totalAmount, 0) + amount;
      if (totalExposure > this.limitsConfig.maxTotalExposure) {
        return {
          allowed: false,
          reason: `Total exposure would exceed limit: ${totalExposure} > ${this.limitsConfig.maxTotalExposure}`,
        };
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Error checking position allowance:', error);
      return {
        allowed: false,
        reason: 'Error checking position limits',
      };
    }
  }

  /**
   * Get current limits configuration
   */
  getLimitsConfig(): PositionLimitsConfig {
    return { ...this.limitsConfig };
  }

  /**
   * Update limits configuration
   */
  updateLimits(newLimits: any): void {
    // Update the limits config with any provided values
    if (newLimits.maxPositionSize !== undefined) {
      this.limitsConfig.maxPositionSize = newLimits.maxPositionSize;
    }
    if (newLimits.maxDailyVolume !== undefined && this.config) {
      this.config.maxDailyVolume = newLimits.maxDailyVolume;
    }
    if (newLimits.maxPortfolioConcentration !== undefined && this.config) {
      this.config.maxPortfolioConcentration = newLimits.maxPortfolioConcentration;
    }
    // Handle other PositionLimitsConfig properties
    Object.keys(newLimits).forEach(key => {
      if (key in this.limitsConfig) {
        (this.limitsConfig as any)[key] = newLimits[key];
      }
    });

    logger.info('Position limits updated:', { ...this.limitsConfig, ...newLimits });
  }

  /**
   * Get emergency exit conditions
   */
  shouldEmergencyExit(exposures: PositionExposure[]): boolean {
    // Check for extreme concentration
    const maxConcentration = Math.max(...exposures.map(exp => exp.percentOfPortfolio));
    if (maxConcentration > 0.8) { // 80% concentration is emergency
      logger.error(`Emergency exit triggered: ${maxConcentration * 100}% concentration`);
      return true;
    }

    // Check for total exposure exceeding emergency limit
    const totalExposure = exposures.reduce((sum, exp) => sum + exp.totalAmount, 0);
    const emergencyLimit = this.limitsConfig.maxTotalExposure * 1.5; // 50% buffer
    if (totalExposure > emergencyLimit) {
      logger.error(`Emergency exit triggered: total exposure ${totalExposure} > ${emergencyLimit}`);
      return true;
    }

    return false;
  }

  /**
   * Daily volume tracking
   */
  private dailyVolume: Map<string, number> = new Map();
  private lastResetDate: string = new Date().toDateString();

  /**
   * Get current limits for reporting
   */
  getCurrentLimits(): PositionLimitsConfig & {
    maxDailyVolume: number;
    maxPortfolioConcentration: number;
  } {
    return {
      ...this.limitsConfig,
      maxDailyVolume: this.config.maxDailyVolume || 10000,
      maxPortfolioConcentration: this.config.maxPortfolioConcentration || 0.5
    };
  }

  /**
   * Record a trade for daily volume tracking
   */
  async recordTrade(token: string, amount: number): Promise<void> {
    this.resetDailyLimitsIfNeeded();

    const currentVolume = this.dailyVolume.get(token) || 0;
    this.dailyVolume.set(token, currentVolume + amount);

    logger.debug(`Recorded trade: ${token} ${amount}, daily total: ${currentVolume + amount}`);
  }

  /**
   * Validate portfolio concentration
   */
  async validatePortfolioConcentration(portfolio: {
    totalValue: number;
    positions: Array<{ token: string; value: number }>;
  }): Promise<{ valid: boolean; violations: string[] }> {
    const violations: string[] = [];
    const maxConcentration = this.config.maxPortfolioConcentration || 0.5;

    for (const position of portfolio.positions) {
      const concentration = position.value / portfolio.totalValue;
      if (concentration > maxConcentration) {
        violations.push(`concentration: ${position.token} at ${(concentration * 100).toFixed(1)}% exceeds ${(maxConcentration * 100)}% limit`);
      }
    }

    return {
      valid: violations.length === 0,
      violations
    };
  }

  /**
   * Reset daily limits if needed
   */
  private resetDailyLimitsIfNeeded(): void {
    const currentDate = new Date().toDateString();
    if (this.lastResetDate !== currentDate) {
      this.dailyVolume.clear();
      this.lastResetDate = currentDate;
      logger.info('Daily volume limits reset');
    }
  }


  /**
   * Calculate maximum safe position size for a token
   */
  calculateMaxSafePositionSize(
    token: string,
    currentExposures: PositionExposure[],
    portfolioValue: number
  ): number {
    const currentExposure = currentExposures.find(exp => exp.token === token);
    const currentAmount = currentExposure?.totalAmount || 0;

    // Calculate remaining capacity based on concentration limit
    const maxConcentrationAmount = portfolioValue * this.limitsConfig.concentrationLimit;
    const concentrationCapacity = maxConcentrationAmount - currentAmount;

    // Calculate remaining capacity based on position size limit
    const positionSizeCapacity = this.limitsConfig.maxPositionSize - currentAmount;

    // Calculate remaining capacity based on total exposure limit
    const totalCurrentExposure = currentExposures.reduce((sum, exp) => sum + exp.totalAmount, 0);
    const totalExposureCapacity = this.limitsConfig.maxTotalExposure - totalCurrentExposure;

    // Return the most restrictive limit
    return Math.max(0, Math.min(
      concentrationCapacity,
      positionSizeCapacity,
      totalExposureCapacity
    ));
  }

  /**
   * Get position limits violations
   */
  async getViolations(userAddress: string): Promise<Array<{
    type: string;
    description: string;
    severity?: 'warning' | 'critical';
  }>> {
    try {
      const exposures = await this.calculateExposures(userAddress);
      const violations: Array<{
        type: string;
        description: string;
        severity?: 'warning' | 'critical';
      }> = [];

      for (const exposure of exposures) {
        // Check position size violations
        if (exposure.totalAmount > this.limitsConfig.maxPositionSize) {
          violations.push({
            type: 'position_size',
            description: `Position size ${exposure.totalAmount} exceeds limit ${this.limitsConfig.maxPositionSize} for ${exposure.token}`,
            severity: exposure.totalAmount > this.limitsConfig.maxPositionSize * 1.2 ? 'critical' : 'warning'
          });
        }

        // Check concentration violations
        if (exposure.percentOfPortfolio > this.limitsConfig.concentrationLimit) {
          violations.push({
            type: 'concentration',
            description: `Portfolio concentration ${(exposure.percentOfPortfolio * 100).toFixed(1)}% exceeds limit ${(this.limitsConfig.concentrationLimit * 100)}% for ${exposure.token}`,
            severity: exposure.percentOfPortfolio > this.limitsConfig.concentrationLimit * 1.3 ? 'critical' : 'warning'
          });
        }

        // Check position count violations
        if (exposure.positionCount > this.limitsConfig.maxPositionsPerToken) {
          violations.push({
            type: 'position_count',
            description: `Position count ${exposure.positionCount} exceeds limit ${this.limitsConfig.maxPositionsPerToken} for ${exposure.token}`,
            severity: 'warning'
          });
        }
      }

      // Check total exposure violation
      const totalExposure = exposures.reduce((sum, exp) => sum + exp.totalAmount, 0);
      if (totalExposure > this.limitsConfig.maxTotalExposure) {
        violations.push({
          type: 'total_exposure',
          description: `Total exposure ${totalExposure} exceeds limit ${this.limitsConfig.maxTotalExposure}`,
          severity: totalExposure > this.limitsConfig.maxTotalExposure * 1.5 ? 'critical' : 'warning'
        });
      }

      return violations;

    } catch (error) {
      logger.error('Error getting position violations:', error);
      return [{
        type: 'error',
        description: 'Error fetching position violations',
        severity: 'critical'
      }];
    }
  }

  /**
   * Auto-adjust position size to comply with limits
   */
  autoAdjustPositionSize(
    requestedAmount: number,
    token: string,
    currentExposures: PositionExposure[],
    portfolioValue: number
  ): {
    adjustedAmount: number;
    wasAdjusted: boolean;
    reason?: string;
  } {
    const maxSafeAmount = this.calculateMaxSafePositionSize(token, currentExposures, portfolioValue);

    if (requestedAmount <= maxSafeAmount) {
      return {
        adjustedAmount: requestedAmount,
        wasAdjusted: false
      };
    }

    // Use 90% of max safe amount to provide buffer
    const adjustedAmount = maxSafeAmount * 0.9;

    return {
      adjustedAmount,
      wasAdjusted: true,
      reason: `Position size reduced from ${requestedAmount} to ${adjustedAmount} to comply with risk limits`
    };
  }
}