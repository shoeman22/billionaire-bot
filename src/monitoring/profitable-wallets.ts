/**
 * Profitable Wallets Monitor
 *
 * Real-time monitoring system for profitable trader activities.
 * Generates copy-trading signals with confidence metrics and provides
 * portfolio allocation recommendations based on smart money analysis.
 */

import { logger } from '../utils/logger';
import { SmartMoneyTracker, SmartMoneyProfile, createSmartMoneyTracker } from '../analytics/smart-money-tracker';
import { WhaleTracker, createWhaleTracker } from '../analytics/whale-tracker';
import { createTransactionHistoryClient, TransactionHistoryClient } from '../api/transaction-history-client';
import { PersistenceService, createPersistenceService } from '../services/persistence-service';
import { TransactionRecord } from '../api/types';

export interface CopyTradingSignal {
  id: string;
  walletAddress: string;
  tier: SmartMoneyProfile['tier'];
  signalType: 'entry' | 'exit' | 'scaling_up' | 'scaling_down';
  
  // Trade details
  poolHash: string;
  token0: string;
  token1: string;
  tradeDirection: 'buy' | 'sell';
  amount0: number;
  amount1: number;
  volume: number;
  
  // Signal confidence and recommendations
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number; // 0-100
  urgency: 'immediate' | 'high' | 'medium' | 'low';
  
  // Copy trading recommendations
  recommendedAction: 'copy' | 'counter' | 'wait' | 'ignore';
  positionSize: 'large' | 'medium' | 'small';
  allocationPercentage: number; // Percentage of risk budget
  
  // Risk management
  stopLoss?: number;
  takeProfit?: number;
  maxHoldTime?: number; // Hours
  
  // Context and reasoning
  reasoning: string[];
  riskFactors: string[];
  
  // Metadata
  timestamp: string;
  expiresAt: string;
  processed: boolean;
}

export interface ProfitableWalletStatus {
  walletAddress: string;
  profile: SmartMoneyProfile;
  
  // Real-time status
  isActive: boolean;
  lastActivity: string;
  currentPositions: number;
  
  // Performance tracking
  recentSignals: number; // Last 24 hours
  signalAccuracy: number; // Historical accuracy
  avgSignalLatency: number; // Minutes from trade to signal
  
  // Copy trading metrics
  followersCount: number;
  totalCopiedVolume: number;
  copyTradingPnL: number; // P&L from following this wallet
  
  // Real-time monitoring
  alertsEnabled: boolean;
  monitoringPriority: 'critical' | 'high' | 'medium' | 'low';
  lastHealthCheck: string;
}

export interface SmartMoneyFlow {
  period: string; // '1h' | '4h' | '1d' | '1w'
  direction: 'inflow' | 'outflow' | 'neutral';
  
  // Flow metrics
  netFlow: number; // Net dollar flow
  institutionalFlow: number;
  professionalFlow: number;
  retailFlow: number;
  
  // Token-specific flows
  tokenFlows: Array<{
    token: string;
    flow: number;
    participantCount: number;
    avgTradeSize: number;
  }>;
  
  // Market implications
  marketSentiment: 'bullish' | 'bearish' | 'neutral';
  priceImpactEstimate: number;
  liquidityImpact: 'high' | 'medium' | 'low';
  
  // Timing analysis
  flowAcceleration: number; // Rate of change
  peakFlowTime?: string; // When flow was highest
  convergenceScore: number; // How aligned different tiers are
}

export interface PortfolioAllocation {
  totalRiskBudget: number; // USD
  allocatedAmount: number;
  availableAmount: number;
  
  // Allocations by confidence
  highConfidenceAllocations: Array<{
    walletAddress: string;
    allocation: number;
    reasoning: string;
  }>;
  
  mediumConfidenceAllocations: Array<{
    walletAddress: string;
    allocation: number;
    reasoning: string;
  }>;
  
  // Portfolio constraints
  maxSingleWalletAllocation: number; // 5% max
  maxTotalCopyTradingAllocation: number; // 15% max
  
  // Rebalancing recommendations
  rebalanceNeeded: boolean;
  rebalanceReasons: string[];
  suggestedChanges: Array<{
    walletAddress: string;
    currentAllocation: number;
    suggestedAllocation: number;
    reason: string;
  }>;
}

/**
 * Profitable Wallets Monitor Service
 *
 * Monitors profitable traders in real-time, generates copy-trading signals,
 * and manages portfolio allocations based on smart money analysis.
 */
export class ProfitableWalletsMonitor {
  private smartMoneyTracker: SmartMoneyTracker;
  private whaleTracker: WhaleTracker;
  private historyClient: TransactionHistoryClient;
  private persistence: PersistenceService | null = null;
  
  // Real-time monitoring
  private monitoredWallets: Map<string, ProfitableWalletStatus> = new Map();
  private recentSignals: CopyTradingSignal[] = [];
  private activeSignals: Map<string, CopyTradingSignal> = new Map();
  
  // Portfolio management
  private currentPortfolioAllocation: PortfolioAllocation;
  private totalRiskBudget: number;
  
  // Configuration
  private readonly MAX_SIGNALS_HISTORY = 1000;
  private readonly SIGNAL_EXPIRY_HOURS = 4;
  private readonly MIN_CONFIDENCE_FOR_COPY = 60;
  private readonly MAX_CONCURRENT_COPIES = 10;
  
  // Real-time monitoring intervals
  private monitoringInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    totalRiskBudget: number = 10000, // $10k default risk budget
    smartMoneyTracker?: SmartMoneyTracker,
    whaleTracker?: WhaleTracker,
    historyClient?: TransactionHistoryClient,
    persistenceService?: PersistenceService
  ) {
    this.totalRiskBudget = totalRiskBudget;
    this.smartMoneyTracker = smartMoneyTracker || createSmartMoneyTracker();
    this.whaleTracker = whaleTracker || createWhaleTracker();
    this.historyClient = historyClient || createTransactionHistoryClient();
    this.persistence = persistenceService || null;
    
    // Initialize portfolio allocation
    this.currentPortfolioAllocation = this.initializePortfolioAllocation();
    
    // Initialize async components
    this.initializeAsync();
    
    logger.info('💼 Profitable Wallets Monitor initialized', {
      riskBudget: this.totalRiskBudget
    });
  }

  /**
   * Initialize async components and start monitoring
   */
  private async initializeAsync(): Promise<void> {
    try {
      if (!this.persistence) {
        this.persistence = await createPersistenceService();
      }
      
      // Load monitored wallets from smart money tracker
      await this.loadMonitoredWallets();
      
      // Start real-time monitoring
      this.startRealTimeMonitoring();
      
      // Start health check scheduler
      this.startHealthCheckScheduler();
      
      logger.info('✅ Profitable Wallets Monitor async initialization complete');
      
    } catch (error) {
      logger.error('❌ Profitable Wallets Monitor initialization failed:', error);
      this.persistence = null;
    }
  }

  /**
   * Add a wallet to profitable monitoring list
   */
  async addWalletToMonitoring(walletAddress: string, priority: 'critical' | 'high' | 'medium' | 'low' = 'medium'): Promise<void> {
    try {
      // Get or analyze smart money profile
      const rankings = this.smartMoneyTracker.getSmartMoneyRankings();
      let profile = rankings.find(p => p.walletAddress === walletAddress);
      
      if (!profile) {
        // Analyze if not already profiled
        profile = await this.smartMoneyTracker.analyzeWallet(walletAddress);
      }
      
      // Only monitor qualified wallets
      if (profile.tier === 'unqualified' || !profile.minimumTrackingPeriod) {
        throw new Error('Wallet does not meet minimum qualifications for monitoring');
      }
      
      const status: ProfitableWalletStatus = {
        walletAddress,
        profile,
        isActive: true,
        lastActivity: new Date().toISOString(),
        currentPositions: 0,
        recentSignals: 0,
        signalAccuracy: 0.75, // Default assumption
        avgSignalLatency: 5, // 5 minutes average
        followersCount: 0,
        totalCopiedVolume: 0,
        copyTradingPnL: 0,
        alertsEnabled: true,
        monitoringPriority: priority,
        lastHealthCheck: new Date().toISOString()
      };
      
      this.monitoredWallets.set(walletAddress, status);
      
      logger.info('📊 Added wallet to profitable monitoring: ' + walletAddress.substring(0, 12), {
        tier: profile.tier,
        smartMoneyIndex: profile.smartMoneyIndex.toFixed(1),
        copyTradingScore: profile.copyTradingScore.toFixed(1),
        priority
      });
      
    } catch (error) {
      logger.error('Failed to add wallet to monitoring ' + walletAddress.substring(0, 12) + ':', error);
      throw error;
    }
  }

  /**
   * Generate copy-trading signal from wallet activity
   */
  async generateCopyTradingSignal(
    walletAddress: string,
    recentTrade: TransactionRecord,
    context: { previousTrades: TransactionRecord[]; profile: SmartMoneyProfile }
  ): Promise<CopyTradingSignal | null> {
    try {
      const { previousTrades, profile } = context;
      
      // Determine signal type based on trade pattern
      const signalType = this.determineSignalType(recentTrade, previousTrades);
      
      // Calculate confidence based on multiple factors
      const confidenceAnalysis = this.calculateSignalConfidence(recentTrade, previousTrades, profile);
      
      // Skip low-confidence signals
      if (confidenceAnalysis.score < this.MIN_CONFIDENCE_FOR_COPY) {
        return null;
      }
      
      // Determine trade direction
      const tradeDirection = this.determineTradeDirection(recentTrade);
      
      // Calculate recommended position size and allocation
      const allocationRecommendation = this.calculateAllocationRecommendation(
        profile,
        confidenceAnalysis.confidence
      );
      
      // Risk management calculations
      const riskManagement = this.calculateRiskManagement(recentTrade, profile);
      
      // Generate reasoning
      const reasoning = this.generateSignalReasoning(recentTrade, previousTrades, profile, confidenceAnalysis);
      
      const signal: CopyTradingSignal = {
        id: this.generateSignalId(),
        walletAddress,
        tier: profile.tier,
        signalType,
        
        // Trade details
        poolHash: recentTrade.poolHash,
        token0: recentTrade.token0,
        token1: recentTrade.token1,
        tradeDirection,
        amount0: recentTrade.amount0,
        amount1: recentTrade.amount1,
        volume: recentTrade.volume,
        
        // Signal confidence
        confidence: confidenceAnalysis.confidence,
        confidenceScore: confidenceAnalysis.score,
        urgency: this.determineUrgency(profile, recentTrade.volume, confidenceAnalysis.score),
        
        // Recommendations
        recommendedAction: confidenceAnalysis.score >= 80 ? 'copy' : 
                          confidenceAnalysis.score >= 60 ? 'copy' : 'wait',
        positionSize: allocationRecommendation.positionSize,
        allocationPercentage: allocationRecommendation.percentage,
        
        // Risk management
        stopLoss: riskManagement.stopLoss,
        takeProfit: riskManagement.takeProfit,
        maxHoldTime: riskManagement.maxHoldTime,
        
        // Context
        reasoning: reasoning.reasons,
        riskFactors: reasoning.risks,
        
        // Metadata
        timestamp: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (this.SIGNAL_EXPIRY_HOURS * 60 * 60 * 1000)).toISOString(),
        processed: false
      };
      
      // Store signal
      this.activeSignals.set(signal.id, signal);
      this.recentSignals.unshift(signal);
      
      // Trim signal history
      if (this.recentSignals.length > this.MAX_SIGNALS_HISTORY) {
        this.recentSignals = this.recentSignals.slice(0, this.MAX_SIGNALS_HISTORY);
      }
      
      logger.info('🚨 Generated copy-trading signal', {
        wallet: walletAddress.substring(0, 12),
        type: signalType,
        confidence: confidenceAnalysis.confidence,
        score: confidenceAnalysis.score,
        volume: recentTrade.volume,
        action: signal.recommendedAction
      });
      
      return signal;
      
    } catch (error) {
      logger.error('Failed to generate copy-trading signal for ' + walletAddress.substring(0, 12) + ':', error);
      return null;
    }
  }

  /**
   * Analyze smart money flow across all monitored wallets
   */
  analyzeSmartMoneyFlow(period: string = '4h'): SmartMoneyFlow {
    const now = Date.now();
    const periodMs = this.parsePeriodToMilliseconds(period);
    const cutoffTime = new Date(now - periodMs);
    
    // Get recent signals within period
    const recentSignals = this.recentSignals.filter(signal => 
      new Date(signal.timestamp) > cutoffTime
    );
    
    // Aggregate flow by tier
    let institutionalFlow = 0;
    let professionalFlow = 0;
    let retailFlow = 0;
    
    const tokenFlowMap = new Map<string, { flow: number; count: number; totalVolume: number }>();
    
    for (const signal of recentSignals) {
      const flowAmount = signal.tradeDirection === 'buy' ? signal.volume : -signal.volume;
      
      // Aggregate by tier
      switch (signal.tier) {
        case 'institutional':
          institutionalFlow += flowAmount;
          break;
        case 'professional':
          professionalFlow += flowAmount;
          break;
        case 'skilled_retail':
          retailFlow += flowAmount;
          break;
      }
      
      // Track token flows
      const token0Key = signal.token0;
      const token1Key = signal.token1;
      
      [token0Key, token1Key].forEach(token => {
        if (!tokenFlowMap.has(token)) {
          tokenFlowMap.set(token, { flow: 0, count: 0, totalVolume: 0 });
        }
        const tokenData = tokenFlowMap.get(token)!;
        tokenData.flow += flowAmount;
        tokenData.count += 1;
        tokenData.totalVolume += signal.volume;
      });
    }
    
    // Calculate net flow and direction
    const netFlow = institutionalFlow + professionalFlow + retailFlow;
    const direction: SmartMoneyFlow['direction'] = 
      netFlow > 1000 ? 'inflow' : 
      netFlow < -1000 ? 'outflow' : 'neutral';
    
    // Token flows
    const tokenFlows = Array.from(tokenFlowMap.entries()).map(([token, data]) => ({
      token,
      flow: data.flow,
      participantCount: data.count,
      avgTradeSize: data.totalVolume / data.count
    })).sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow));
    
    // Market sentiment analysis
    const bullishSignals = recentSignals.filter(s => s.tradeDirection === 'buy').length;
    const bearishSignals = recentSignals.filter(s => s.tradeDirection === 'sell').length;
    const marketSentiment: SmartMoneyFlow['marketSentiment'] = 
      bullishSignals > bearishSignals * 1.2 ? 'bullish' :
      bearishSignals > bullishSignals * 1.2 ? 'bearish' : 'neutral';
    
    // Flow acceleration (rate of change)
    const halfPeriodMs = periodMs / 2;
    const halfPeriodCutoff = new Date(now - halfPeriodMs);
    const recentHalfSignals = recentSignals.filter(s => new Date(s.timestamp) > halfPeriodCutoff);
    const recentHalfFlow = recentHalfSignals.reduce((sum, s) => 
      sum + (s.tradeDirection === 'buy' ? s.volume : -s.volume), 0
    );
    const firstHalfFlow = netFlow - recentHalfFlow;
    const flowAcceleration = recentHalfFlow - firstHalfFlow;
    
    // Convergence score (alignment between tiers)
    const tierFlows = [institutionalFlow, professionalFlow, retailFlow];
    const avgFlow = tierFlows.reduce((sum, flow) => sum + flow, 0) / 3;
    const variance = tierFlows.reduce((sum, flow) => sum + Math.pow(flow - avgFlow, 2), 0) / 3;
    const convergenceScore = Math.max(0, 100 - (Math.sqrt(variance) / Math.abs(avgFlow + 1) * 100));
    
    return {
      period,
      direction,
      netFlow,
      institutionalFlow,
      professionalFlow,
      retailFlow,
      tokenFlows,
      marketSentiment,
      priceImpactEstimate: Math.abs(netFlow) / 100000, // Simplified estimate
      liquidityImpact: Math.abs(netFlow) > 50000 ? 'high' : 
                      Math.abs(netFlow) > 20000 ? 'medium' : 'low',
      flowAcceleration,
      peakFlowTime: this.findPeakFlowTime(recentSignals),
      convergenceScore
    };
  }

  /**
   * Update portfolio allocation recommendations
   */
  updatePortfolioAllocation(): PortfolioAllocation {
    const candidates = this.smartMoneyTracker.getCopyTradingCandidates(this.MIN_CONFIDENCE_FOR_COPY);
    const currentAllocations = this.currentPortfolioAllocation;
    
    // Reset allocations
    const newAllocation: PortfolioAllocation = {
      totalRiskBudget: this.totalRiskBudget,
      allocatedAmount: 0,
      availableAmount: this.totalRiskBudget,
      highConfidenceAllocations: [],
      mediumConfidenceAllocations: [],
      maxSingleWalletAllocation: this.totalRiskBudget * 0.05, // 5%
      maxTotalCopyTradingAllocation: this.totalRiskBudget * 0.15, // 15%
      rebalanceNeeded: false,
      rebalanceReasons: [],
      suggestedChanges: []
    };
    
    // Allocate based on confidence levels
    for (const candidate of candidates.slice(0, this.MAX_CONCURRENT_COPIES)) {
      const allocationAmount = Math.min(
        this.totalRiskBudget * (candidate.recommendedAllocation / 100),
        newAllocation.maxSingleWalletAllocation
      );
      
      const allocation = {
        walletAddress: candidate.profile.walletAddress,
        allocation: allocationAmount,
        reasoning: 'Smart money index: ' + candidate.profile.smartMoneyIndex.toFixed(1) + 
                  ', Copy trading score: ' + candidate.profile.copyTradingScore.toFixed(1) +
                  ', Tier: ' + candidate.profile.tier
      };
      
      if (candidate.confidence === 'high') {
        newAllocation.highConfidenceAllocations.push(allocation);
      } else {
        newAllocation.mediumConfidenceAllocations.push(allocation);
      }
      
      newAllocation.allocatedAmount += allocationAmount;
    }
    
    // Check if we exceed total allocation limit
    if (newAllocation.allocatedAmount > newAllocation.maxTotalCopyTradingAllocation) {
      // Scale down proportionally
      const scaleFactor = newAllocation.maxTotalCopyTradingAllocation / newAllocation.allocatedAmount;
      
      newAllocation.highConfidenceAllocations.forEach(alloc => {
        alloc.allocation *= scaleFactor;
      });
      newAllocation.mediumConfidenceAllocations.forEach(alloc => {
        alloc.allocation *= scaleFactor;
      });
      
      newAllocation.allocatedAmount = newAllocation.maxTotalCopyTradingAllocation;
    }
    
    newAllocation.availableAmount = this.totalRiskBudget - newAllocation.allocatedAmount;
    
    // Check if rebalancing is needed
    this.checkRebalanceNeeded(currentAllocations, newAllocation);
    
    this.currentPortfolioAllocation = newAllocation;
    
    logger.info('📊 Portfolio allocation updated', {
      allocated: newAllocation.allocatedAmount,
      available: newAllocation.availableAmount,
      highConfidence: newAllocation.highConfidenceAllocations.length,
      mediumConfidence: newAllocation.mediumConfidenceAllocations.length
    });
    
    return newAllocation;
  }

  /**
   * Get active copy-trading signals
   */
  getActiveCopyTradingSignals(minConfidence?: 'high' | 'medium' | 'low'): CopyTradingSignal[] {
    const now = new Date();
    let activeSignals = Array.from(this.activeSignals.values())
      .filter(signal => new Date(signal.expiresAt) > now && !signal.processed);
    
    if (minConfidence) {
      const confidenceOrder = ['low', 'medium', 'high'];
      const minIndex = confidenceOrder.indexOf(minConfidence);
      activeSignals = activeSignals.filter(signal => 
        confidenceOrder.indexOf(signal.confidence) >= minIndex
      );
    }
    
    return activeSignals.sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Mark signal as processed
   */
  markSignalProcessed(signalId: string, result?: { executed: boolean; pnl?: number }): void {
    const signal = this.activeSignals.get(signalId);
    if (signal) {
      signal.processed = true;
      
      // Update wallet performance tracking if result provided
      if (result && this.monitoredWallets.has(signal.walletAddress)) {
        const wallet = this.monitoredWallets.get(signal.walletAddress)!;
        if (result.executed && result.pnl !== undefined) {
          wallet.copyTradingPnL += result.pnl;
        }
      }
      
      logger.debug('Signal marked as processed: ' + signalId);
    }
  }

  /**
   * Get monitored wallets status
   */
  getMonitoredWalletsStatus(): ProfitableWalletStatus[] {
    return Array.from(this.monitoredWallets.values())
      .sort((a, b) => b.profile.smartMoneyIndex - a.profile.smartMoneyIndex);
  }

  /**
   * Private helper methods
   */

  private initializePortfolioAllocation(): PortfolioAllocation {
    return {
      totalRiskBudget: this.totalRiskBudget,
      allocatedAmount: 0,
      availableAmount: this.totalRiskBudget,
      highConfidenceAllocations: [],
      mediumConfidenceAllocations: [],
      maxSingleWalletAllocation: this.totalRiskBudget * 0.05,
      maxTotalCopyTradingAllocation: this.totalRiskBudget * 0.15,
      rebalanceNeeded: false,
      rebalanceReasons: [],
      suggestedChanges: []
    };
  }

  private async loadMonitoredWallets(): Promise<void> {
    // Get top candidates from smart money tracker
    const candidates = this.smartMoneyTracker.getCopyTradingCandidates(70);
    
    for (const candidate of candidates.slice(0, 20)) { // Monitor top 20
      try {
        const priority = candidate.confidence === 'high' ? 'high' : 
                        candidate.confidence === 'medium' ? 'medium' : 'low';
        await this.addWalletToMonitoring(candidate.profile.walletAddress, priority as 'high' | 'medium' | 'low');
      } catch (error) {
        logger.debug('Skipped loading wallet: ' + candidate.profile.walletAddress.substring(0, 12));
      }
    }
    
    logger.info('Loaded ' + this.monitoredWallets.size + ' wallets for profitable monitoring');
  }

  private startRealTimeMonitoring(): void {
    // Monitor for new whale alerts every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkForNewSignals();
      } catch (error) {
        logger.error('Error in real-time monitoring:', error);
      }
    }, 30 * 1000);

    logger.info('📡 Real-time profitable wallet monitoring started');
  }

  private startHealthCheckScheduler(): void {
    // Health check every 10 minutes
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        logger.error('Error in health check:', error);
      }
    }, 10 * 60 * 1000);

    logger.info('💊 Health check scheduler started');
  }

  private async checkForNewSignals(): Promise<void> {
    // Get recent whale alerts
    const whaleAlerts = this.whaleTracker.getRecentAlerts(0.5); // Last 30 minutes
    
    for (const alert of whaleAlerts) {
      // Check if wallet is monitored
      const walletStatus = this.monitoredWallets.get(alert.whaleAddress);
      if (!walletStatus || !walletStatus.isActive) continue;
      
      // Get recent trading history for context
      const recentHistory = await this.historyClient.getUserHistory(alert.whaleAddress, {
        limit: 20,
        fromTime: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString() // Last 2 hours
      });
      
      if (recentHistory.length === 0) continue;
      
      // Find the trade that triggered the alert
      const triggeringTrade = recentHistory.find(tx => 
        tx.poolHash === alert.poolHash &&
        Math.abs(new Date(tx.transactionTime).getTime() - new Date(alert.timestamp).getTime()) < 5 * 60 * 1000 // Within 5 minutes
      );
      
      if (!triggeringTrade) continue;
      
      // Generate copy-trading signal
      const signal = await this.generateCopyTradingSignal(
        alert.whaleAddress,
        triggeringTrade,
        {
          previousTrades: recentHistory.slice(1), // Exclude the triggering trade
          profile: walletStatus.profile
        }
      );
      
      if (signal) {
        walletStatus.recentSignals += 1;
        walletStatus.lastActivity = signal.timestamp;
      }
    }
  }

  private async performHealthChecks(): Promise<void> {
    for (const [walletAddress, status] of this.monitoredWallets.entries()) {
      try {
        // Check if wallet is still active (traded in last 24 hours)
        const recentActivity = await this.historyClient.getUserHistory(walletAddress, {
          limit: 10,
          fromTime: new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()
        });
        
        const wasActive = status.isActive;
        status.isActive = recentActivity.length > 0;
        status.lastHealthCheck = new Date().toISOString();
        
        if (wasActive && !status.isActive) {
          logger.info('Wallet became inactive: ' + walletAddress.substring(0, 12));
        } else if (!wasActive && status.isActive) {
          logger.info('Wallet became active again: ' + walletAddress.substring(0, 12));
        }
        
      } catch (error) {
        logger.warn('Health check failed for wallet ' + walletAddress.substring(0, 12) + ':', error);
      }
    }
    
    // Clean up expired signals
    this.cleanupExpiredSignals();
  }

  private cleanupExpiredSignals(): void {
    const now = new Date();
    const expiredSignalIds: string[] = [];
    
    for (const [id, signal] of this.activeSignals.entries()) {
      if (new Date(signal.expiresAt) <= now) {
        expiredSignalIds.push(id);
      }
    }
    
    for (const id of expiredSignalIds) {
      this.activeSignals.delete(id);
    }
    
    if (expiredSignalIds.length > 0) {
      logger.debug('Cleaned up ' + expiredSignalIds.length + ' expired signals');
    }
  }

  private determineSignalType(
    recentTrade: TransactionRecord, 
    previousTrades: TransactionRecord[]
  ): CopyTradingSignal['signalType'] {
    // Simple heuristic based on position changes
    const recentVolume = recentTrade.volume;
    const avgPreviousVolume = previousTrades.length > 0 
      ? previousTrades.reduce((sum, tx) => sum + tx.volume, 0) / previousTrades.length 
      : 0;
    
    if (recentVolume > avgPreviousVolume * 2) {
      return 'scaling_up';
    } else if (recentVolume < avgPreviousVolume * 0.5) {
      return 'scaling_down';
    } else if (Math.abs(recentTrade.amount0) > Math.abs(recentTrade.amount1)) {
      return 'entry';
    } else {
      return 'exit';
    }
  }

  private calculateSignalConfidence(
    recentTrade: TransactionRecord,
    previousTrades: TransactionRecord[],
    profile: SmartMoneyProfile
  ): { confidence: 'high' | 'medium' | 'low'; score: number } {
    let score = 0;
    
    // Base score from profile
    score += profile.smartMoneyIndex * 0.3; // Max 30 points
    score += profile.copyTradingScore * 0.2; // Max 20 points
    
    // Tier bonus
    const tierBonus = {
      'institutional': 25,
      'professional': 20,
      'skilled_retail': 15,
      'unqualified': 0
    };
    score += tierBonus[profile.tier];
    
    // Trade size consistency
    if (previousTrades.length > 0) {
      const avgVolume = previousTrades.reduce((sum, tx) => sum + tx.volume, 0) / previousTrades.length;
      const volumeRatio = recentTrade.volume / avgVolume;
      
      if (volumeRatio >= 0.5 && volumeRatio <= 2) {
        score += 10; // Consistent sizing
      }
    }
    
    // Recent performance bonus
    if (profile.performance.recentPerformance > 0) {
      score += 5;
    }
    
    // Timing bonus (during active hours)
    const hour = new Date(recentTrade.transactionTime).getUTCHours();
    if ((hour >= 6 && hour <= 22)) { // Active market hours
      score += 5;
    }
    
    const confidence: 'high' | 'medium' | 'low' = 
      score >= 80 ? 'high' :
      score >= 60 ? 'medium' : 'low';
    
    return { confidence, score: Math.min(100, Math.max(0, score)) };
  }

  private determineTradeDirection(trade: TransactionRecord): 'buy' | 'sell' {
    // Simplified direction determination
    return trade.amount0 > 0 ? 'buy' : 'sell';
  }

  private calculateAllocationRecommendation(
    profile: SmartMoneyProfile,
    confidence: 'high' | 'medium' | 'low'
  ): { positionSize: 'large' | 'medium' | 'small'; percentage: number } {
    let basePercentage = 0;
    
    // Base allocation by confidence
    switch (confidence) {
      case 'high': basePercentage = 3; break;
      case 'medium': basePercentage = 2; break;
      case 'low': basePercentage = 1; break;
    }
    
    // Tier multiplier
    const tierMultiplier = {
      'institutional': 1.5,
      'professional': 1.2,
      'skilled_retail': 1.0,
      'unqualified': 0.5
    };
    
    const finalPercentage = Math.min(5, basePercentage * tierMultiplier[profile.tier]);
    
    const positionSize: 'large' | 'medium' | 'small' = 
      finalPercentage >= 4 ? 'large' :
      finalPercentage >= 2 ? 'medium' : 'small';
    
    return { positionSize, percentage: finalPercentage };
  }

  private calculateRiskManagement(
    trade: TransactionRecord,
    profile: SmartMoneyProfile
  ): { stopLoss?: number; takeProfit?: number; maxHoldTime: number } {
    // Risk management based on profile characteristics
    const baseStopLoss = profile.riskProfile.maxPositionSize * 0.02; // 2% of max position
    const baseTakeProfit = profile.riskProfile.maxPositionSize * 0.06; // 6% target
    
    // Adjust hold time based on trading style
    let maxHoldTime = 24; // Default 24 hours
    
    switch (profile.tradingStyle) {
      case 'scalper':
      case 'arbitrage':
        maxHoldTime = 4;
        break;
      case 'swing':
        maxHoldTime = 72;
        break;
      default:
        maxHoldTime = 24;
    }
    
    return {
      stopLoss: baseStopLoss,
      takeProfit: baseTakeProfit,
      maxHoldTime
    };
  }

  private generateSignalReasoning(
    recentTrade: TransactionRecord,
    previousTrades: TransactionRecord[],
    profile: SmartMoneyProfile,
    confidenceAnalysis: { confidence: 'high' | 'medium' | 'low'; score: number }
  ): { reasons: string[]; risks: string[] } {
    const reasons: string[] = [];
    const risks: string[] = [];
    
    // Performance reasons
    reasons.push('Smart money index: ' + profile.smartMoneyIndex.toFixed(1) + '/100');
    reasons.push('Copy trading score: ' + profile.copyTradingScore.toFixed(1) + '/100');
    reasons.push('Win rate: ' + (profile.metrics.winRate * 100).toFixed(1) + '%');
    reasons.push('Tier: ' + profile.tier);
    
    // Trade specific reasons
    if (recentTrade.volume > 1000) {
      reasons.push('High volume trade: $' + recentTrade.volume.toLocaleString());
    }
    
    if (profile.tradingStyle === 'arbitrage') {
      reasons.push('Specializes in arbitrage opportunities');
    }
    
    // Risk factors
    if (profile.metrics.maxDrawdown > 0.2) {
      risks.push('High maximum drawdown: ' + (profile.metrics.maxDrawdown * 100).toFixed(1) + '%');
    }
    
    if (profile.performance.recentPerformance < 0) {
      risks.push('Recent underperformance detected');
    }
    
    if (confidenceAnalysis.score < 70) {
      risks.push('Lower confidence signal');
    }
    
    return { reasons, risks };
  }

  private determineUrgency(
    profile: SmartMoneyProfile,
    tradeVolume: number,
    confidenceScore: number
  ): CopyTradingSignal['urgency'] {
    if (profile.tier === 'institutional' && confidenceScore > 85 && tradeVolume > 5000) {
      return 'immediate';
    } else if (confidenceScore > 80 && tradeVolume > 2000) {
      return 'high';
    } else if (confidenceScore > 70) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  private generateSignalId(): string {
    return 'signal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  private parsePeriodToMilliseconds(period: string): number {
    const value = parseInt(period.slice(0, -1));
    const unit = period.slice(-1);
    
    switch (unit) {
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'w': return value * 7 * 24 * 60 * 60 * 1000;
      default: return value * 60 * 60 * 1000; // Default to hours
    }
  }

  private findPeakFlowTime(signals: CopyTradingSignal[]): string | undefined {
    if (signals.length === 0) return undefined;
    
    // Group by hour and find peak
    const hourlyFlow = new Map<string, number>();
    
    for (const signal of signals) {
      const hour = signal.timestamp.substring(0, 13); // YYYY-MM-DDTHH
      const flow = signal.tradeDirection === 'buy' ? signal.volume : -signal.volume;
      hourlyFlow.set(hour, (hourlyFlow.get(hour) || 0) + Math.abs(flow));
    }
    
    let peakHour = '';
    let peakFlow = 0;
    
    for (const [hour, flow] of hourlyFlow.entries()) {
      if (flow > peakFlow) {
        peakFlow = flow;
        peakHour = hour;
      }
    }
    
    return peakHour ? peakHour + ':00:00.000Z' : undefined;
  }

  private checkRebalanceNeeded(
    current: PortfolioAllocation,
    proposed: PortfolioAllocation
  ): void {
    // Check for significant allocation changes
    const allCurrentWallets = new Set([
      ...current.highConfidenceAllocations.map(a => a.walletAddress),
      ...current.mediumConfidenceAllocations.map(a => a.walletAddress)
    ]);
    
    const allProposedWallets = new Set([
      ...proposed.highConfidenceAllocations.map(a => a.walletAddress),
      ...proposed.mediumConfidenceAllocations.map(a => a.walletAddress)
    ]);
    
    // Check for new wallets
    const newWallets = [...allProposedWallets].filter(w => !allCurrentWallets.has(w));
    const removedWallets = [...allCurrentWallets].filter(w => !allProposedWallets.has(w));
    
    if (newWallets.length > 0) {
      proposed.rebalanceNeeded = true;
      proposed.rebalanceReasons.push('New profitable wallets detected: ' + newWallets.length);
    }
    
    if (removedWallets.length > 0) {
      proposed.rebalanceNeeded = true;
      proposed.rebalanceReasons.push('Wallets removed from monitoring: ' + removedWallets.length);
    }
    
    // Check for significant allocation changes (>20% change)
    for (const currentAlloc of [...current.highConfidenceAllocations, ...current.mediumConfidenceAllocations]) {
      const proposedAlloc = [...proposed.highConfidenceAllocations, ...proposed.mediumConfidenceAllocations]
        .find(a => a.walletAddress === currentAlloc.walletAddress);
      
      if (proposedAlloc) {
        const changePercent = Math.abs(proposedAlloc.allocation - currentAlloc.allocation) / currentAlloc.allocation;
        if (changePercent > 0.2) {
          proposed.rebalanceNeeded = true;
          proposed.rebalanceReasons.push('Significant allocation change for ' + currentAlloc.walletAddress.substring(0, 12));
          
          proposed.suggestedChanges.push({
            walletAddress: currentAlloc.walletAddress,
            currentAllocation: currentAlloc.allocation,
            suggestedAllocation: proposedAlloc.allocation,
            reason: 'Performance-based reallocation'
          });
        }
      }
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    monitoredWallets: number;
    activeWallets: number;
    activeSignals: number;
    recentSignals: number;
    totalAllocation: number;
    availableBudget: number;
  } {
    const activeWallets = Array.from(this.monitoredWallets.values()).filter(w => w.isActive).length;
    const activeSignals = this.getActiveCopyTradingSignals().length;
    const recentSignals = this.recentSignals.filter(s => 
      new Date(s.timestamp) > new Date(Date.now() - (24 * 60 * 60 * 1000))
    ).length;

    return {
      monitoredWallets: this.monitoredWallets.size,
      activeWallets,
      activeSignals,
      recentSignals,
      totalAllocation: this.currentPortfolioAllocation.allocatedAmount,
      availableBudget: this.currentPortfolioAllocation.availableAmount
    };
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    logger.info('💼 Profitable Wallets Monitor shutdown complete');
  }
}

/**
 * Create a profitable wallets monitor with default configuration
 */
export function createProfitableWalletsMonitor(totalRiskBudget?: number): ProfitableWalletsMonitor {
  return new ProfitableWalletsMonitor(totalRiskBudget);
}
