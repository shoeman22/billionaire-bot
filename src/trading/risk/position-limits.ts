/**
 * Position Limits
 * Risk management for position sizing and exposure limits
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { safeParseFloat } from '../../utils/safe-parse';

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
  private gswap: GSwap;

  constructor(config: TradingConfig, gswap: GSwap) {
    this.config = config;
    this.gswap = gswap;
    this.limitsConfig = {
      maxPositionSize: config.maxPositionSize,
      maxTotalExposure: config.maxPositionSize * 10, // 10x max position size for arbitrage bot
      maxPositionsPerToken: 10, // Allow more positions for active trading
      concentrationLimit: config.concentrationLimit || 1.0, // Use config or default to 100%
    };

    logger.info('Position Limits initialized with config:', this.limitsConfig);
  }

  /**
   * Check if current positions are within limits
   */
  async checkLimits(userAddress: string): Promise<boolean> {
    try {
      // Check if portfolio limits are disabled for arbitrage trading
      if (this.config.disablePortfolioLimits) {
        logger.debug('Portfolio limits disabled - skipping position checks');
        return true;
      }

      // Get current positions from GalaSwap API using real SDK operations
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

      // Return empty array - no mock data allowed in production
      // Risk system must fail safely when position data unavailable
      return [];
    }
  }

  /**
   * Get token balances for user wallet using direct wallet balance API
   */
  private async getTokenBalances(userAddress: string): Promise<{ token: string; amount: number }[]> {
    try {
      logger.debug('Fetching wallet token balances for address:', userAddress);

      // Get user assets directly from wallet (not liquidity positions)
      const assetsResponse = await this.gswap.assets.getUserAssets(userAddress, 1, 20);

      if (!assetsResponse?.tokens) {
        logger.debug('No tokens found in wallet');
        return [];
      }

      // Convert SDK format to our internal format
      const balances = assetsResponse.tokens
        .map(token => ({
          token: token.symbol || token.name,
          amount: safeParseFloat(token.quantity || '0', 0)
        }))
        .filter(balance => balance.amount > 0); // Only include non-zero balances

      logger.debug(`Found ${balances.length} wallet token balances for ${userAddress}:`, balances);
      return balances;

    } catch (error) {
      // Handle API limit errors gracefully
      if (error && typeof error === 'object' && 'message' in error &&
          (error.message as string).includes('400') && (error.message as string).includes('limit')) {
        logger.warn('getUserAssets API limit exceeded, retrying with smaller limit');
        try {
          const assetsResponse = await this.gswap.assets.getUserAssets(userAddress, 1, 10);
          const balances = assetsResponse?.tokens?.map(token => ({
            token: token.symbol || token.name,
            amount: safeParseFloat(token.quantity || '0', 0)
          })).filter(balance => balance.amount > 0) || [];
          return balances;
        } catch (retryError) {
          logger.error('Error fetching token balances on retry:', retryError);
          return [];
        }
      }

      logger.error('Error fetching token balances from GalaSwap API:', error);
      return [];
    }
  }

  /**
   * Get current token prices
   */
  private async getCurrentPrices(tokens: string[]): Promise<{ [token: string]: number }> {
    try {
      const prices: { [token: string]: number } = {};

      // Parallelize price fetching for all tokens
      const pricePromises = tokens.map(async (token) => {
        try {
          // Use direct API call instead of non-existent SDK method
          // Convert token symbol to full dollar format for API
          let dollarFormatToken: string;
          if (token.includes('|') || token.includes('$')) {
            // Already in full format, just convert to dollar format
            dollarFormatToken = token.replace(/\|/g, '$');
          } else {
            // Convert symbol to full token format
            switch (token) {
              case 'GALA':
                dollarFormatToken = 'GALA$Unit$none$none';
                break;
              case 'GUSDC':
              case 'USDC':
                dollarFormatToken = 'GUSDC$Unit$none$none';
                break;
              case 'ETIME':
                dollarFormatToken = 'ETIME$Unit$none$none';
                break;
              case 'SILK':
                dollarFormatToken = 'SILK$Unit$none$none';
                break;
              default:
                // Assume standard format for unknown tokens
                dollarFormatToken = `${token}$Unit$none$none`;
            }
          }
          const baseUrl = process.env.API_BASE_URL || 'https://dex-backend-prod1.defi.gala.com';
          const response = await fetch(`${baseUrl}/v1/trade/price?token=${encodeURIComponent(dollarFormatToken)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(5000)
          });

          if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
          }

          const poolData = await response.json();

          const priceUsd = parseFloat((poolData as any)?.data || '0');
          if (priceUsd > 0) {
            logger.debug(`API price for ${token}: $${priceUsd}`);
            return { token, price: priceUsd };
          } else {
            logger.warn(`Failed to fetch price for ${token}`);
            // Fallback to default prices for known tokens
            let price: number;
            switch (token) {
              case 'GALA':
              case 'GALA|Unit|none|none':
                price = 0.015; // Reasonable GALA price fallback
                break;
              case 'USDC':
              case 'GUSDC':
              case 'GUSDC|Unit|none|none':
              case 'USDT':
                price = 1.0; // Stablecoins default to $1
                break;
              default:
                price = 0.01; // Default minimal price
            }
            return { token, price };
          }
        } catch (tokenError) {
          logger.error(`Error fetching price for ${token}:`, tokenError);
          // Use fallback pricing for known tokens
          let price: number;
          if (token.includes('GALA')) {
            price = 0.015; // GALA fallback
          } else if (token.includes('USDC') || token.includes('USDT')) {
            price = 1.0; // Stablecoin fallback
          } else {
            price = 0.01; // Default fallback
          }
          return { token, price };
        }
      });

      // Wait for all price fetches to complete
      const priceResults = await Promise.allSettled(pricePromises);

      // Process results and populate prices object
      priceResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          prices[result.value.token] = result.value.price;
        }
      });

      logger.debug(`Fetched ${Object.keys(prices).length} token prices:`, prices);
      return prices;

    } catch (error) {
      logger.error('Error fetching current prices from GalaSwap API:', error);
      // Return empty object on complete failure
      return {};
    }
  }

  /**
   * Get token symbol from position handling different formats
   */
  private getTokenSymbol(position: any, index: 0 | 1): string {
    // Handle both formats
    const symbolField = index === 0 ? 'token0Symbol' : 'token1Symbol';
    const tokenField = index === 0 ? 'token0' : 'token1';

    if (position[symbolField]) {
      return position[symbolField];
    } else if (position[tokenField]) {
      return position[tokenField];
    } else {
      logger.warn(`Position missing token${index} field`);
      return 'UNKNOWN';
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
      // Check if portfolio limits are disabled for arbitrage trading
      if (this.config.disablePortfolioLimits) {
        logger.debug('Portfolio limits disabled - allowing position');
        return { allowed: true };
      }

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
    // Check if portfolio limits are disabled for arbitrage trading
    if (this.config.disablePortfolioLimits) {
      logger.debug('Portfolio limits disabled - skipping concentration validation');
      return { valid: true, violations: [] };
    }

    const violations: string[] = [];
    const maxConcentration = this.config.concentrationLimit || this.config.maxPortfolioConcentration || 1.0;

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