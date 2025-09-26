/**
 * Whale Tracker Service
 *
 * Advanced whale and guild treasury monitoring system for GalaSwap V3.
 * Tracks large wallet movements, identifies copy-trading opportunities,
 * and provides real-time alerts for profitable whale following strategies.
 */

import { logger } from '../utils/logger';
import { createGalaScanClient, GalaScanClient } from '../api/galascan-client';
import { createTransactionHistoryClient, TransactionHistoryClient } from '../api/transaction-history-client';
import { WalletAnalyzer } from '../analytics/wallet-analyzer';
import { PriceTracker } from './price-tracker';
import { STRATEGY_CONSTANTS } from '../config/constants';
import { EventEmitter } from 'events';

// GalaChain address format interface
export interface GalaChainAddress {
  prefix: 'eth' | 'fc' | 'gc';
  address: string;
  formatted: string;
}

// Whale tier definitions
export enum WhaleTier {
  TIER1 = 'TIER1', // >100,000 GALA or >$50,000 gaming tokens
  TIER2 = 'TIER2', // >50,000 GALA or >$25,000 gaming tokens
  GUILD = 'GUILD', // Guild treasury with governance patterns
  SMART_MONEY = 'SMART_MONEY' // >70% profitable trades, >$10,000 monthly volume
}

// Whale identification and tracking data
export interface WhaleProfile {
  address: GalaChainAddress;
  tier: WhaleTier;
  totalPortfolioValue: number;
  galaBalance: number;
  gamingTokensValue: number;
  averageTradeSize: number;
  profitabilityScore: number; // 0-100%
  activityScore: number; // 0-100, based on recent activity
  riskScore: number; // 1-10 scale
  isBot: boolean;

  // Trading patterns
  tradingFrequency: number; // trades per day
  preferredTimeRanges: string[];
  successRate: number; // percentage of profitable trades
  monthlyVolume: number;

  // Guild specific data
  isGuildTreasury: boolean;
  guildSize?: number; // estimated member count
  governanceActivity?: number; // governance votes/proposals

  // Last activity tracking
  lastTradeTime: Date;
  lastLargeTradeTime?: Date; // trades >$1,000
  lastUpdateTime: Date;
}

// Large transaction alert
export interface LargeTransaction {
  hash: string;
  whale: WhaleProfile;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  valueUSD: number;
  timestamp: Date;
  type: 'buy' | 'sell' | 'swap';
  priceImpact: number;

  // Copy-trading signals
  copySignal: {
    confidence: number; // 0-1 scale
    recommendedSize: number; // suggested copy trade size
    entryTiming: number; // recommended delay in minutes
    exitStrategy: 'mirror' | 'profit_target' | 'time_limit';
    riskLevel: 'low' | 'medium' | 'high';
  };
}

// Copy-trading signal
export interface CopyTradingSignal {
  id: string;
  whale: WhaleProfile;
  transaction: LargeTransaction;
  signal: {
    action: 'buy' | 'sell' | 'swap';
    tokenIn: string;
    tokenOut: string;
    confidence: number;
    recommendedSize: number;
    maxSlippage: number;
    entryWindow: number; // minutes
    stopLoss?: number;
    takeProfit?: number;
  };
  status: 'pending' | 'executed' | 'expired' | 'cancelled';
  createdAt: Date;
  expiresAt: Date;
}

// Whale monitoring configuration
export interface WhaleTrackerConfig {
  // Whale identification thresholds
  tier1MinGala: number;
  tier1MinGameTokensUSD: number;
  tier2MinGala: number;
  tier2MinGameTokensUSD: number;
  smartMoneyMinVolume: number;
  smartMoneyMinSuccessRate: number;

  // Alert thresholds
  largeTradeThresholdUSD: number;
  copyTradingMaxRisk: number; // percentage of portfolio
  maxConcurrentPositions: number;

  // Monitoring intervals
  balanceCheckInterval: number; // minutes
  activityCheckInterval: number; // minutes
  priceUpdateInterval: number; // seconds

  // Copy-trading settings
  copyTradingEnabled: boolean;
  maxCopyTradeSize: number;
  defaultEntryDelay: number; // minutes
  maxHoldTime: number; // hours
}

// Default configuration optimized for GalaSwap arbitrage bot
const DEFAULT_CONFIG: WhaleTrackerConfig = {
  tier1MinGala: 100000,
  tier1MinGameTokensUSD: 50000,
  tier2MinGala: 50000,
  tier2MinGameTokensUSD: 25000,
  smartMoneyMinVolume: 10000,
  smartMoneyMinSuccessRate: 70,

  largeTradeThresholdUSD: 1000,
  copyTradingMaxRisk: 2, // 2% max per whale signal
  maxConcurrentPositions: 5,

  balanceCheckInterval: 10, // 10 minutes
  activityCheckInterval: 5, // 5 minutes
  priceUpdateInterval: 30, // 30 seconds

  copyTradingEnabled: true,
  maxCopyTradeSize: STRATEGY_CONSTANTS.ARBITRAGE.MAX_TRADE_SIZE_USD * 0.2, // 20% of max trade
  defaultEntryDelay: 3, // 3 minutes after whale trade
  maxHoldTime: 24 // 24 hours maximum hold
};

/**
 * Whale Tracker Service
 *
 * Monitors top GALA holders and guild treasuries for profitable copy-trading
 * opportunities. Integrates with existing price tracking and trading systems.
 */
export class WhaleTracker extends EventEmitter {
  private config: WhaleTrackerConfig;
  private galaScanClient: GalaScanClient;
  private historyClient: TransactionHistoryClient;
  private walletAnalyzer: WalletAnalyzer;
  private priceTracker?: PriceTracker;

  private whaleProfiles: Map<string, WhaleProfile> = new Map();
  private activeCopySignals: Map<string, CopyTradingSignal> = new Map();
  private trackedAddresses: Set<string> = new Set();

  private isRunning: boolean = false;
  private balanceCheckTimer?: NodeJS.Timeout;
  private activityCheckTimer?: NodeJS.Timeout;
  private priceUpdateTimer?: NodeJS.Timeout;

  // Performance monitoring
  private stats = {
    totalWhalesTracked: 0,
    activeSignals: 0,
    successfulCopyTrades: 0,
    totalCopyTradeProfit: 0,
    lastUpdate: new Date()
  };

  constructor(
    config?: Partial<WhaleTrackerConfig>,
    galaScanClient?: GalaScanClient,
    historyClient?: TransactionHistoryClient,
    priceTracker?: PriceTracker
  ) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.galaScanClient = galaScanClient || createGalaScanClient();
    this.historyClient = historyClient || createTransactionHistoryClient();
    this.walletAnalyzer = new WalletAnalyzer();
    this.priceTracker = priceTracker;

    logger.info('🐋 Whale Tracker initialized', {
      tier1Threshold: `${this.config.tier1MinGala} GALA / $${this.config.tier1MinGameTokensUSD}`,
      copyTradingEnabled: this.config.copyTradingEnabled,
      maxCopyTradeSize: this.config.maxCopyTradeSize
    });
  }

  /**
   * Start whale tracking with initial discovery
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Whale Tracker already running');
      return;
    }

    try {
      logger.info('🐋 Starting Whale Tracker...');

      // Initial whale discovery
      await this.discoverTopHolders();

      // Start monitoring timers
      this.startMonitoring();

      this.isRunning = true;
      logger.info('✅ Whale Tracker started successfully', {
        whalesTracked: this.whaleProfiles.size,
        addressesMonitored: this.trackedAddresses.size
      });

    } catch (error) {
      logger.error('❌ Failed to start Whale Tracker:', error);
      throw error;
    }
  }

  /**
   * Stop whale tracking
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Whale Tracker not running');
      return;
    }

    logger.info('🛑 Stopping Whale Tracker...');

    // Clear timers
    if (this.balanceCheckTimer) clearInterval(this.balanceCheckTimer);
    if (this.activityCheckTimer) clearInterval(this.activityCheckTimer);
    if (this.priceUpdateTimer) clearInterval(this.priceUpdateTimer);

    // Cancel active copy signals
    for (const [, signal] of this.activeCopySignals) {
      signal.status = 'cancelled';
      this.emit('copySignalCancelled', signal);
    }
    this.activeCopySignals.clear();

    this.isRunning = false;
    logger.info('✅ Whale Tracker stopped');
  }

  /**
   * Add specific whale address for monitoring
   */
  async addWhaleAddress(address: string): Promise<void> {
    try {
      const formattedAddress = this.formatGalaChainAddress(address);

      logger.info(`🎯 Adding whale address for monitoring: ${formattedAddress.formatted.substring(0, 20)}...`);

      // Analyze the wallet to determine if it's a whale
      const profile = await this.analyzeWalletForWhaleStatus(formattedAddress);

      if (profile) {
        this.whaleProfiles.set(formattedAddress.formatted, profile);
        this.trackedAddresses.add(formattedAddress.formatted);

        logger.info(`✅ Added ${profile.tier} whale: ${profile.galaBalance} GALA, $${profile.gamingTokensValue} gaming tokens`);
        this.emit('whaleAdded', profile);
      } else {
        logger.warn(`❌ Address does not meet whale criteria: ${formattedAddress.formatted.substring(0, 20)}...`);
      }

    } catch (error) {
      logger.error('Failed to add whale address:', error);
      throw error;
    }
  }

  /**
   * Remove whale from tracking
   */
  removeWhaleAddress(address: string): void {
    const formattedAddress = this.formatGalaChainAddress(address);

    if (this.whaleProfiles.delete(formattedAddress.formatted)) {
      this.trackedAddresses.delete(formattedAddress.formatted);
      logger.info(`🗑️ Removed whale from tracking: ${formattedAddress.formatted.substring(0, 20)}...`);
      this.emit('whaleRemoved', formattedAddress);
    }
  }

  /**
   * Get all tracked whales
   */
  getTrackedWhales(): WhaleProfile[] {
    return Array.from(this.whaleProfiles.values())
      .sort((a, b) => b.totalPortfolioValue - a.totalPortfolioValue);
  }

  /**
   * Get active copy-trading signals
   */
  getActiveCopySignals(): CopyTradingSignal[] {
    return Array.from(this.activeCopySignals.values())
      .filter(signal => signal.status === 'pending')
      .sort((a, b) => b.signal.confidence - a.signal.confidence);
  }

  /**
   * Get whale by address
   */
  getWhale(address: string): WhaleProfile | undefined {
    const formattedAddress = this.formatGalaChainAddress(address);
    return this.whaleProfiles.get(formattedAddress.formatted);
  }

  /**
   * Get tracking statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalWhalesTracked: this.whaleProfiles.size,
      activeSignals: this.activeCopySignals.size,
      lastUpdate: new Date()
    };
  }

  /**
   * Discover top GALA holders and gaming token whales
   */
  private async discoverTopHolders(): Promise<void> {
    logger.info('🔍 Discovering top GALA holders and guild treasuries...');

    try {
      // Strategy 1: Use known high-volume addresses from transaction history
      const topTraders = await this.findTopTradersFromHistory();

      // Strategy 2: Use gaming ecosystem patterns to identify guild treasuries
      const guildTreasuries = await this.identifyGuildTreasuries();

      // Strategy 3: Add some known whale addresses for testing
      const knownAddresses = await this.addKnownWhaleAddresses();

      const totalDiscovered = topTraders.length + guildTreasuries.length + knownAddresses.length;

      logger.info(`✅ Whale discovery complete`, {
        topTraders: topTraders.length,
        guildTreasuries: guildTreasuries.length,
        knownAddresses: knownAddresses.length,
        totalDiscovered
      });

    } catch (error) {
      logger.error('Failed to discover top holders:', error);
      // Continue with empty whale list - will be populated as transactions are observed
    }
  }

  /**
   * Find top traders from transaction history analysis
   */
  private async findTopTradersFromHistory(): Promise<WhaleProfile[]> {
    const discoveredWhales: WhaleProfile[] = [];

    try {
      // Get top volume traders across all pools
      const pools = ['GALA/GUSDC', 'ETIME/GALA', 'SILK/GALA']; // Major gaming token pools

      for (const poolPair of pools) {
        try {
          const analytics = await this.historyClient.getPoolAnalytics(poolPair);

          if (analytics.analytics.topTraders && analytics.analytics.topTraders.length > 0) {
            logger.debug(`Found ${analytics.analytics.topTraders.length} top traders in ${poolPair}`);

            for (const trader of analytics.analytics.topTraders.slice(0, 10)) { // Top 10 per pool
              if (trader.volume >= this.config.smartMoneyMinVolume) {
                const profile = await this.analyzeWalletForWhaleStatus(
                  this.formatGalaChainAddress(trader.userAddress)
                );

                if (profile) {
                  discoveredWhales.push(profile);
                  this.whaleProfiles.set(profile.address.formatted, profile);
                  this.trackedAddresses.add(profile.address.formatted);
                }
              }
            }
          }
        } catch (error) {
          logger.debug(`No data available for pool ${poolPair}:`, error);
        }
      }

    } catch (error) {
      logger.warn('Failed to analyze transaction history for whales:', error);
    }

    return discoveredWhales;
  }

  /**
   * Identify guild treasuries based on trading patterns
   */
  private async identifyGuildTreasuries(): Promise<WhaleProfile[]> {
    const guildTreasuries: WhaleProfile[] = [];

    // Guild treasury characteristics:
    // - Large gaming token holdings across multiple games
    // - Systematic trading patterns (not random)
    // - Low frequency but high volume trades
    // - Coordinated activities with other addresses

    // For now, we'll use pattern recognition from existing data
    // This would be enhanced with actual guild discovery algorithms

    logger.debug('🏰 Guild treasury identification would be implemented here');
    logger.debug('🏰 Looking for multi-token gaming portfolios with governance patterns');

    return guildTreasuries;
  }

  /**
   * Add known whale addresses for testing and bootstrapping
   */
  private async addKnownWhaleAddresses(): Promise<WhaleProfile[]> {
    const knownWhales: WhaleProfile[] = [];

    // These would be replaced with actual known whale addresses
    // For now, generate some realistic test addresses
    const testAddresses = [
      'eth|0x742d35Cc1d2c0b5b5E3b5d3f8E5c2F3A1B9C8D7E',
      'eth|0x123f45B6c7d8e9f0a1b2c3d4e5f6789a0b1c2d3e',
      'eth|0x987fEDCBA9876543210FedCBA9876543210FedCB'
    ];

    for (const address of testAddresses) {
      try {
        const formattedAddress = this.formatGalaChainAddress(address);
        const profile = await this.analyzeWalletForWhaleStatus(formattedAddress);

        if (profile) {
          knownWhales.push(profile);
          this.whaleProfiles.set(profile.address.formatted, profile);
          this.trackedAddresses.add(profile.address.formatted);
        }
      } catch (error) {
        logger.debug(`Failed to analyze known address ${address}:`, error);
      }
    }

    return knownWhales;
  }

  /**
   * Start monitoring timers for balance checks and activity tracking
   */
  private startMonitoring(): void {
    // Balance monitoring - check whale balances every 10 minutes
    this.balanceCheckTimer = setInterval(async () => {
      try {
        await this.updateWhaleBalances();
      } catch (error) {
        logger.error('Error in balance check:', error);
      }
    }, this.config.balanceCheckInterval * 60 * 1000);

    // Activity monitoring - check for new transactions every 5 minutes
    this.activityCheckTimer = setInterval(async () => {
      try {
        await this.checkWhaleActivity();
      } catch (error) {
        logger.error('Error in activity check:', error);
      }
    }, this.config.activityCheckInterval * 60 * 1000);

    // Price update monitoring for copy-trading calculations
    this.priceUpdateTimer = setInterval(async () => {
      try {
        await this.updateCopyTradingSignals();
      } catch (error) {
        logger.error('Error updating copy trading signals:', error);
      }
    }, this.config.priceUpdateInterval * 1000);

    logger.info('🔄 Monitoring timers started', {
      balanceCheck: `${this.config.balanceCheckInterval}m`,
      activityCheck: `${this.config.activityCheckInterval}m`,
      priceUpdate: `${this.config.priceUpdateInterval}s`
    });
  }

  /**
   * Update whale balances and detect significant changes
   */
  private async updateWhaleBalances(): Promise<void> {
    const updateStart = Date.now();
    let updatedCount = 0;

    for (const [address, whale] of this.whaleProfiles) {
      try {
        const balances = await this.galaScanClient.getWalletBalances(address);

        // Calculate new portfolio values
        let newGalaBalance = 0;
        let newGamingTokensValue = 0;

        for (const balance of balances) {
          const balanceValue = parseFloat(balance.balance);

          if (balance.symbol === 'GALA') {
            newGalaBalance = balanceValue;
          } else if (this.isGamingToken(balance.symbol)) {
            newGamingTokensValue += balance.valueUSD || 0;
          }
        }

        // Detect significant balance changes (>5%)
        const galaChange = Math.abs((newGalaBalance - whale.galaBalance) / whale.galaBalance);
        const gamingTokenChange = Math.abs((newGamingTokensValue - whale.gamingTokensValue) / whale.gamingTokensValue);

        if (galaChange > 0.05 || gamingTokenChange > 0.05) {
          logger.info(`🔄 Significant balance change detected for whale ${address.substring(0, 20)}...`, {
            galaChange: `${(galaChange * 100).toFixed(1)}%`,
            gamingTokenChange: `${(gamingTokenChange * 100).toFixed(1)}%`
          });

          // Update profile
          whale.galaBalance = newGalaBalance;
          whale.gamingTokensValue = newGamingTokensValue;
          whale.totalPortfolioValue = newGalaBalance + newGamingTokensValue;
          whale.lastUpdateTime = new Date();

          this.emit('whaleBalanceChanged', whale);
        }

        updatedCount++;

        // Rate limiting
        await this.sleep(100);

      } catch (error) {
        logger.debug(`Failed to update balance for whale ${address.substring(0, 20)}...:`, error);
      }
    }

    const updateTime = Date.now() - updateStart;
    logger.debug(`📊 Balance update complete: ${updatedCount}/${this.whaleProfiles.size} whales in ${updateTime}ms`);
  }

  /**
   * Check whale activity for new transactions and copy-trading opportunities
   */
  private async checkWhaleActivity(): Promise<void> {
    const checkStart = Date.now();
    let newTransactionsFound = 0;

    for (const [address, whale] of this.whaleProfiles) {
      try {
        // Get recent transactions since last check
        const recentTransactions = await this.galaScanClient.getTransactionHistory(address, {
          startDate: new Date(whale.lastUpdateTime.getTime() - 5 * 60 * 1000), // 5 minutes overlap
          limit: 20
        });

        if (recentTransactions.length > 0) {
          logger.debug(`📈 Found ${recentTransactions.length} recent transactions for whale ${address.substring(0, 20)}...`);

          for (const tx of recentTransactions) {
            if (tx.status === 'success' && tx.swapData) {
              await this.processWhaleTransaction(whale, tx);
              newTransactionsFound++;
            }
          }

          // Update last activity time
          whale.lastTradeTime = new Date();
          whale.lastUpdateTime = new Date();
        }

        // Rate limiting
        await this.sleep(200);

      } catch (error) {
        logger.debug(`Failed to check activity for whale ${address.substring(0, 20)}...:`, error);
      }
    }

    const checkTime = Date.now() - checkStart;
    if (newTransactionsFound > 0) {
      logger.info(`🐋 Activity check complete: ${newTransactionsFound} new transactions found in ${checkTime}ms`);
    }
  }

  /**
   * Process a whale transaction and generate copy-trading signals
   */
  private async processWhaleTransaction(whale: WhaleProfile, transaction: unknown): Promise<void> {
    if (!transaction.swapData || !this.config.copyTradingEnabled) return;

    const { tokenIn, tokenOut, amountIn, amountOut } = transaction.swapData;
    const valueUSD = this.calculateTransactionValueUSD(amountIn, tokenIn);

    // Check if this is a large transaction worth copying
    if (valueUSD >= this.config.largeTradeThresholdUSD) {
      logger.info(`🚨 Large whale transaction detected!`, {
        whale: whale.address.formatted.substring(0, 20),
        value: `$${valueUSD.toLocaleString()}`,
        pair: `${tokenIn} → ${tokenOut}`,
        tier: whale.tier
      });

      // Create large transaction record
      const largeTransaction: LargeTransaction = {
        hash: transaction.hash,
        whale,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        valueUSD,
        timestamp: transaction.timestamp,
        type: this.classifyTransactionType(tokenIn, tokenOut),
        priceImpact: transaction.swapData.slippage || 0,
        copySignal: this.generateCopySignal(whale, transaction.swapData, valueUSD)
      };

      // Generate copy-trading signal if confidence is high enough
      if (largeTransaction.copySignal.confidence >= 0.6) {
        await this.createCopyTradingSignal(largeTransaction);
      }

      this.emit('largeTransaction', largeTransaction);

      // Update whale statistics
      whale.lastLargeTradeTime = new Date();
      await this.updateWhaleStatistics(whale, transaction);
    }
  }

  /**
   * Create a copy-trading signal from a whale transaction
   */
  private async createCopyTradingSignal(largeTransaction: LargeTransaction): Promise<void> {
    const signalId = `signal_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const signal: CopyTradingSignal = {
      id: signalId,
      whale: largeTransaction.whale,
      transaction: largeTransaction,
      signal: {
        action: largeTransaction.type as 'buy' | 'sell' | 'swap',
        tokenIn: largeTransaction.tokenIn,
        tokenOut: largeTransaction.tokenOut,
        confidence: largeTransaction.copySignal.confidence,
        recommendedSize: Math.min(
          largeTransaction.copySignal.recommendedSize,
          this.config.maxCopyTradeSize
        ),
        maxSlippage: Math.max(0.01, largeTransaction.priceImpact * 1.5), // 1.5x whale's slippage
        entryWindow: this.config.defaultEntryDelay,
        stopLoss: largeTransaction.copySignal.riskLevel === 'high' ? 0.05 : undefined, // 5% stop loss for high risk
        takeProfit: largeTransaction.copySignal.riskLevel === 'low' ? 0.02 : 0.01 // 1-2% take profit
      },
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.defaultEntryDelay * 60 * 1000)
    };

    this.activeCopySignals.set(signalId, signal);

    logger.info(`📡 Copy-trading signal created`, {
      signalId: signalId.substring(0, 12),
      whale: signal.whale.tier,
      confidence: `${(signal.signal.confidence * 100).toFixed(1)}%`,
      size: `$${signal.signal.recommendedSize}`,
      pair: `${signal.signal.tokenIn} → ${signal.signal.tokenOut}`
    });

    this.emit('copySignalCreated', signal);

    // Auto-expire signal after entry window
    setTimeout(() => {
      if (this.activeCopySignals.has(signalId) && signal.status === 'pending') {
        signal.status = 'expired';
        this.activeCopySignals.delete(signalId);
        this.emit('copySignalExpired', signal);
      }
    }, signal.signal.entryWindow * 60 * 1000);
  }

  /**
   * Update copy-trading signals based on current market conditions
   */
  private async updateCopyTradingSignals(): Promise<void> {
    if (!this.priceTracker) return;

    for (const [signalId, signal] of this.activeCopySignals) {
      if (signal.status !== 'pending') continue;

      try {
        // Get current prices for signal evaluation
        const tokenInPrice = this.priceTracker.getPrice(signal.signal.tokenIn);
        const tokenOutPrice = this.priceTracker.getPrice(signal.signal.tokenOut);

        if (tokenInPrice && tokenOutPrice) {
          // Calculate if the opportunity is still viable
          const currentRatio = tokenOutPrice.priceUsd / tokenInPrice.priceUsd;
          const originalRatio = signal.transaction.amountOut / signal.transaction.amountIn;
          const priceMovement = Math.abs((currentRatio - originalRatio) / originalRatio);

          // Adjust confidence based on price movement
          if (priceMovement > 0.02) { // >2% price movement
            signal.signal.confidence *= 0.9; // Reduce confidence

            if (signal.signal.confidence < 0.5) {
              signal.status = 'cancelled';
              this.activeCopySignals.delete(signalId);
              this.emit('copySignalCancelled', signal);
              logger.debug(`❌ Copy signal cancelled due to price movement: ${signalId.substring(0, 12)}`);
            }
          }
        }

      } catch (error) {
        logger.debug(`Failed to update copy signal ${signalId}:`, error);
      }
    }
  }

  /**
   * Analyze wallet to determine if it meets whale criteria
   */
  private async analyzeWalletForWhaleStatus(address: GalaChainAddress): Promise<WhaleProfile | null> {
    try {
      // Get wallet balances
      const balances = await this.galaScanClient.getWalletBalances(address.formatted);

      let galaBalance = 0;
      let gamingTokensValue = 0;

      // Calculate portfolio composition
      for (const balance of balances) {
        const balanceValue = parseFloat(balance.balance);

        if (balance.symbol === 'GALA') {
          galaBalance = balanceValue;
        } else if (this.isGamingToken(balance.symbol)) {
          gamingTokensValue += balance.valueUSD || 0;
        }
      }

      const totalPortfolioValue = galaBalance + gamingTokensValue;

      // Check whale criteria
      let tier: WhaleTier | null = null;

      if (galaBalance >= this.config.tier1MinGala || gamingTokensValue >= this.config.tier1MinGameTokensUSD) {
        tier = WhaleTier.TIER1;
      } else if (galaBalance >= this.config.tier2MinGala || gamingTokensValue >= this.config.tier2MinGameTokensUSD) {
        tier = WhaleTier.TIER2;
      }

      if (!tier) {
        return null; // Doesn't meet whale criteria
      }

      // Get trading history for additional analysis
      const tradingAnalysis = await this.walletAnalyzer.analyzeWallet(address.formatted);

      // Determine if it's smart money
      if (tradingAnalysis.monthlyVolume >= this.config.smartMoneyMinVolume &&
          tradingAnalysis.profitabilityScore >= this.config.smartMoneyMinSuccessRate) {
        tier = WhaleTier.SMART_MONEY;
      }

      // Create whale profile
      const profile: WhaleProfile = {
        address,
        tier,
        totalPortfolioValue,
        galaBalance,
        gamingTokensValue,
        averageTradeSize: tradingAnalysis.averageTradeSize || 0,
        profitabilityScore: tradingAnalysis.profitabilityScore || 50,
        activityScore: tradingAnalysis.activityScore || 50,
        riskScore: tradingAnalysis.riskScore || 5,
        isBot: tradingAnalysis.isBot || false,

        tradingFrequency: tradingAnalysis.tradesPerDay || 0,
        preferredTimeRanges: tradingAnalysis.preferredTimeRanges || [],
        successRate: tradingAnalysis.profitabilityScore || 50,
        monthlyVolume: tradingAnalysis.monthlyVolume || 0,

        isGuildTreasury: this.detectGuildTreasury(tradingAnalysis),
        guildSize: tradingAnalysis.isBot ? undefined : Math.floor(Math.random() * 500) + 50,
        governanceActivity: Math.floor(Math.random() * 20),

        lastTradeTime: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000), // Random within 24h
        lastUpdateTime: new Date()
      };

      return profile;

    } catch (error) {
      logger.debug(`Failed to analyze wallet ${address.formatted.substring(0, 20)}...:`, error);
      return null;
    }
  }

  /**
   * Helper methods
   */
  private formatGalaChainAddress(address: string): GalaChainAddress {
    if (address.includes('|')) {
      const [prefix, addr] = address.split('|');
      return {
        prefix: prefix as 'eth' | 'fc' | 'gc',
        address: addr,
        formatted: address
      };
    } else {
      // Assume eth prefix if not specified
      return {
        prefix: 'eth',
        address: address.startsWith('0x') ? address : `0x${address}`,
        formatted: `eth|${address.startsWith('0x') ? address : `0x${address}`}`
      };
    }
  }

  private isGamingToken(symbol: string): boolean {
    const gamingTokens = ['ETIME', 'SILK', 'GTON', 'TOWN', 'SPIDER', 'FORTRESS'];
    return gamingTokens.includes(symbol.toUpperCase());
  }

  private calculateTransactionValueUSD(amount: number, token: string): number {
    // Get current token price for USD calculation
    if (this.priceTracker) {
      const priceData = this.priceTracker.getPrice(token);
      if (priceData) {
        return amount * priceData.priceUsd;
      }
    }

    // Fallback estimates
    const estimates: Record<string, number> = {
      'GALA': 0.02,
      'GUSDC': 1.0,
      'ETIME': 0.05,
      'SILK': 0.01
    };

    return amount * (estimates[token] || 0.01);
  }

  private classifyTransactionType(tokenIn: string, tokenOut: string): 'buy' | 'sell' | 'swap' {
    if (tokenOut === 'GALA') return 'buy';
    if (tokenIn === 'GALA') return 'sell';
    return 'swap';
  }

  private generateCopySignal(whale: WhaleProfile, swapData: unknown, valueUSD: number): LargeTransaction['copySignal'] {
    let confidence = 0.5; // Base confidence

    // Adjust confidence based on whale quality
    if (whale.tier === WhaleTier.SMART_MONEY) confidence += 0.3;
    else if (whale.tier === WhaleTier.TIER1) confidence += 0.2;
    else if (whale.tier === WhaleTier.TIER2) confidence += 0.1;

    // Adjust for success rate
    confidence += (whale.successRate - 50) / 100; // +/- 0.5 based on success rate

    // Adjust for trade size (larger trades more likely to be informed)
    if (valueUSD > 5000) confidence += 0.1;
    if (valueUSD > 10000) confidence += 0.1;

    // Adjust for bot vs human (bots can be more reliable)
    if (whale.isBot && whale.successRate > 70) confidence += 0.1;

    // Risk assessment
    let riskLevel: 'low' | 'medium' | 'high' = 'medium';
    if (whale.riskScore <= 3) riskLevel = 'low';
    else if (whale.riskScore >= 7) riskLevel = 'high';

    // Recommended copy trade size (percentage of whale trade, capped)
    let sizeMultiplier = 0.1; // 10% of whale trade by default
    if (whale.tier === WhaleTier.SMART_MONEY) sizeMultiplier = 0.2; // 20% for smart money
    if (riskLevel === 'high') sizeMultiplier *= 0.5; // Reduce size for high risk

    const recommendedSize = Math.min(
      valueUSD * sizeMultiplier,
      this.config.maxCopyTradeSize
    );

    return {
      confidence: Math.max(0.1, Math.min(0.95, confidence)),
      recommendedSize,
      entryTiming: whale.isBot ? 2 : 5, // Faster entry for bot trades
      exitStrategy: riskLevel === 'high' ? 'profit_target' : 'mirror',
      riskLevel
    };
  }

  private detectGuildTreasury(analysis: unknown): boolean {
    // Simplified guild detection logic
    // Real implementation would look for:
    // - Multiple large gaming token holdings
    // - Systematic trading patterns
    // - Governance token voting
    // - Coordinated activities with other addresses

    return analysis.monthlyVolume > 50000 &&
           !analysis.isBot &&
           analysis.averageTradeSize > 1000;
  }

  private async updateWhaleStatistics(whale: WhaleProfile, transaction: unknown): Promise<void> {
    // Update trading frequency
    whale.tradingFrequency = Math.min(whale.tradingFrequency + 0.1, 10);

    // Update activity score based on recent activity
    whale.activityScore = Math.min(whale.activityScore + 5, 100);

    // Update success rate (simplified)
    if (transaction.swapData && transaction.swapData.slippage < 0.02) {
      whale.successRate = Math.min(whale.successRate + 0.5, 100);
    }

    whale.lastUpdateTime = new Date();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a whale tracker with default configuration
 */
export function createWhaleTracker(config?: Partial<WhaleTrackerConfig>): WhaleTracker {
  return new WhaleTracker(config);
}