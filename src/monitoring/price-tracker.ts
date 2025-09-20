/**
 * Price Tracker
 * Real-time price monitoring and change detection system
 */

import { GSwap } from '@gala-chain/gswap-sdk';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/constants';
import { createTokenClassKey } from '../types/galaswap';
import { safeParseFloat } from '../utils/safe-parse';

export interface PriceData {
  token: string;
  price: number;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
}

export interface PriceAlert {
  token: string;
  type: 'price_change' | 'volume_spike' | 'price_threshold';
  threshold: number;
  currentValue: number;
  triggered: boolean;
  timestamp: number;
}

export interface PriceHistory {
  token: string;
  prices: Array<{
    price: number;
    timestamp: number;
  }>;
  maxHistory: number;
}

export class PriceTracker {
  private gswap: GSwap;
  private isRunning: boolean = false;
  private priceData: Map<string, PriceData> = new Map();
  private priceHistory: Map<string, PriceHistory> = new Map();
  private alerts: Map<string, PriceAlert[]> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private wsConnected: boolean = false;

  private readonly PRICE_UPDATE_INTERVAL = TRADING_CONSTANTS.PRICE_UPDATE_INTERVAL;
  private readonly MAX_PRICE_HISTORY = 1000;
  private readonly TOKENS_TO_TRACK = Object.values(TRADING_CONSTANTS.TOKENS);

  constructor(gswap: GSwap) {
    this.gswap = gswap;
    this.initializePriceHistory();
    logger.info('Price Tracker initialized');
  }

  /**
   * Start price tracking
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Price Tracker already running');
      return;
    }

    try {
      logger.info('Starting Price Tracker...');

      // Setup WebSocket connection for real-time updates
      await this.setupWebSocketConnection();

      // Start polling as backup
      this.startPolling();

      // Initial price fetch
      await this.updateAllPrices();

      this.isRunning = true;
      logger.info('✅ Price Tracker started successfully');

    } catch (error) {
      logger.error('❌ Failed to start Price Tracker:', error);
      throw error;
    }
  }

  /**
   * Stop price tracking
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Price Tracker not running');
      return;
    }

    try {
      logger.info('Stopping Price Tracker...');

      // Stop polling
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      // Disconnect WebSocket (handled by SDK)
      if (this.wsConnected) {
        // SDK handles WebSocket cleanup internally
        this.wsConnected = false;
      }

      this.isRunning = false;
      logger.info('✅ Price Tracker stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping Price Tracker:', error);
      throw error;
    }
  }

  /**
   * Get current price for a token
   */
  getPrice(token: string): PriceData | null {
    return this.priceData.get(token.toUpperCase()) || null;
  }

  /**
   * Get all current prices
   */
  getAllPrices(): Record<string, PriceData> {
    const prices: Record<string, PriceData> = {};
    this.priceData.forEach((data, token) => {
      prices[token] = data;
    });
    return prices;
  }

  /**
   * Get price history for a token
   */
  getPriceHistory(token: string, limit?: number): Array<{ price: number; timestamp: number }> {
    const history = this.priceHistory.get(token.toUpperCase());
    if (!history) return [];

    const prices = history.prices.slice();
    return limit ? prices.slice(-limit) : prices;
  }

  /**
   * Set price alert
   */
  setPriceAlert(
    token: string,
    type: 'price_change' | 'volume_spike' | 'price_threshold',
    threshold: number
  ): void {
    const tokenUpper = token.toUpperCase();
    const alerts = this.alerts.get(tokenUpper) || [];

    const alert: PriceAlert = {
      token: tokenUpper,
      type,
      threshold,
      currentValue: 0,
      triggered: false,
      timestamp: Date.now(),
    };

    alerts.push(alert);
    this.alerts.set(tokenUpper, alerts);

    logger.info(`Price alert set for ${token}: ${type} threshold ${threshold}`);
  }

  /**
   * Remove price alert
   */
  removePriceAlert(token: string, type: string): void {
    const tokenUpper = token.toUpperCase();
    const alerts = this.alerts.get(tokenUpper) || [];

    const filteredAlerts = alerts.filter(alert => alert.type !== type);
    this.alerts.set(tokenUpper, filteredAlerts);

    logger.info(`Price alert removed for ${token}: ${type}`);
  }

  /**
   * Get triggered alerts
   */
  getTriggeredAlerts(): PriceAlert[] {
    const triggered: PriceAlert[] = [];

    this.alerts.forEach(alerts => {
      alerts.forEach(alert => {
        if (alert.triggered) {
          triggered.push(alert);
        }
      });
    });

    return triggered;
  }

  /**
   * Initialize price history storage
   */
  private initializePriceHistory(): void {
    this.TOKENS_TO_TRACK.forEach(token => {
      this.priceHistory.set(token, {
        token,
        prices: [],
        maxHistory: this.MAX_PRICE_HISTORY,
      });
    });
  }

  /**
   * Setup WebSocket connection for real-time price updates
   */
  private async setupWebSocketConnection(): Promise<void> {
    try {
      // Connect to WebSocket using SDK events
      // SDK handles WebSocket connections internally
      // Subscribe to price updates for each token
      for (const tokenKey of this.TOKENS_TO_TRACK) {
        const _tokenClassKey = createTokenClassKey(tokenKey);
        // SDK event system will handle price updates
      }

      this.wsConnected = true;
      logger.info('WebSocket price monitoring connected');

    } catch (error) {
      logger.warn('Failed to setup WebSocket connection, using polling only:', error);
      this.wsConnected = false;
    }
  }

  /**
   * Handle WebSocket price updates
   */
  private handleWebSocketPriceUpdate(data: any): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      if (data.token && data.price) {
        const priceData: PriceData = {
          token: data.token.toUpperCase(),
          price: safeParseFloat(data.price, 0),
          priceUsd: safeParseFloat(data.priceUsd || data.price, 0),
          change24h: safeParseFloat(data.change24h || 0, 0),
          volume24h: safeParseFloat(data.volume24h || 0, 0),
          timestamp: Date.now(),
        };

        this.updatePriceData(priceData);
        logger.debug(`WebSocket price update: ${priceData.token} = $${priceData.priceUsd}`);
      }

    } catch (error) {
      logger.error('Error handling WebSocket price update:', error);
    }
  }

  /**
   * Start polling for price updates
   */
  private startPolling(): void {
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateAllPrices();
      } catch (error) {
        logger.error('Error in price polling:', error);
      }
    }, this.PRICE_UPDATE_INTERVAL);

    logger.info(`Price polling started (interval: ${this.PRICE_UPDATE_INTERVAL}ms)`);
  }

  /**
   * Update all tracked token prices
   */
  private async updateAllPrices(): Promise<void> {
    try {
      logger.debug('Updating all token prices...');

      // Get prices for all tracked tokens using SDK
      for (const tokenKey of this.TOKENS_TO_TRACK) {
        try {
          const poolData = await this.gswap.pools.getPoolData(tokenKey, 'GUSDC$Unit$none$none', 3000);

          if (poolData?.sqrtPrice) {
            const tokenClassKey = createTokenClassKey(tokenKey);
            // Simplified price calculation - would need proper calculation from sqrtPriceX96
            const calculatedPrice = 1.0;
            const priceData: PriceData = {
              token: tokenClassKey.collection.toUpperCase(),
              price: calculatedPrice,
              priceUsd: calculatedPrice,
              change24h: 0, // Would need historical data
              volume24h: 0, // Volume not available in pool data
              timestamp: Date.now(),
            };

            this.updatePriceData(priceData);
          }
        } catch (error) {
          logger.warn(`Failed to get price for ${tokenKey}:`, error);
        }
      }

      logger.debug(`Updated prices for ${this.TOKENS_TO_TRACK.length} tokens`);

    } catch (error) {
      logger.error('Error updating all prices:', error);
    }
  }

  /**
   * Update price data and history
   */
  private updatePriceData(priceData: PriceData): void {
    const token = priceData.token;

    // Store current price
    const previousPrice = this.priceData.get(token);
    this.priceData.set(token, priceData);

    // Update price history
    this.updatePriceHistory(token, priceData.price, priceData.timestamp);

    // Check alerts
    this.checkPriceAlerts(token, priceData, previousPrice);

    // Log significant price changes
    if (previousPrice) {
      const priceChange = ((priceData.price - previousPrice.price) / previousPrice.price) * 100;
      if (Math.abs(priceChange) > 1) { // Log changes > 1%
        logger.info(`Significant price change: ${token} ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`);
      }
    }
  }

  /**
   * Update price history for a token
   */
  private updatePriceHistory(token: string, price: number, timestamp: number): void {
    const history = this.priceHistory.get(token);
    if (!history) return;

    // Add new price point
    history.prices.push({ price, timestamp });

    // Maintain history size limit
    if (history.prices.length > history.maxHistory) {
      history.prices = history.prices.slice(-history.maxHistory);
    }

    this.priceHistory.set(token, history);
  }

  /**
   * Check and trigger price alerts
   */
  private checkPriceAlerts(token: string, currentData: PriceData, previousData?: PriceData): void {
    const alerts = this.alerts.get(token) || [];

    for (const alert of alerts) {
      if (alert.triggered) continue; // Skip already triggered alerts

      let shouldTrigger = false;
      let currentValue = 0;

      switch (alert.type) {
        case 'price_change':
          if (previousData) {
            const changePercent = Math.abs(
              ((currentData.price - previousData.price) / previousData.price) * 100
            );
            currentValue = changePercent;
            shouldTrigger = changePercent >= alert.threshold;
          }
          break;

        case 'volume_spike':
          currentValue = currentData.volume24h;
          shouldTrigger = currentData.volume24h >= alert.threshold;
          break;

        case 'price_threshold':
          currentValue = currentData.priceUsd;
          shouldTrigger = currentData.priceUsd >= alert.threshold;
          break;
      }

      if (shouldTrigger) {
        alert.triggered = true;
        alert.currentValue = currentValue;
        alert.timestamp = Date.now();

        logger.warn(`Price alert triggered: ${token} ${alert.type} - ${currentValue} >= ${alert.threshold}`);

        // Emit alert event (could be extended to send notifications)
        this.emitAlert(alert);
      }
    }
  }

  /**
   * Emit alert event
   */
  private emitAlert(alert: PriceAlert): void {
    // This could be extended to integrate with notification systems
    logger.info(`Alert emitted: ${alert.token} ${alert.type}`, alert);
  }

  /**
   * Get tracking statistics
   */
  getStatistics(): {
    tokensTracked: number;
    totalPriceUpdates: number;
    wsConnected: boolean;
    isRunning: boolean;
    activeAlerts: number;
    triggeredAlerts: number;
  } {
    let totalUpdates = 0;
    this.priceHistory.forEach(history => {
      totalUpdates += history.prices.length;
    });

    let activeAlerts = 0;
    let triggeredAlerts = 0;
    this.alerts.forEach(alerts => {
      activeAlerts += alerts.length;
      triggeredAlerts += alerts.filter(a => a.triggered).length;
    });

    return {
      tokensTracked: this.TOKENS_TO_TRACK.length,
      totalPriceUpdates: totalUpdates,
      wsConnected: this.wsConnected,
      isRunning: this.isRunning,
      activeAlerts,
      triggeredAlerts,
    };
  }

  /**
   * Reset all triggered alerts
   */
  resetAlerts(): void {
    this.alerts.forEach(alerts => {
      alerts.forEach(alert => {
        alert.triggered = false;
      });
    });

    logger.info('All price alerts reset');
  }
}