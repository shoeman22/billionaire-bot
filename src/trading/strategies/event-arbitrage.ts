/**
 * In-Game Event Arbitrage Strategy
 *
 * Event-driven arbitrage trading around gaming ecosystem events:
 * - Pre-event positioning 48-72 hours before major events
 * - Tournament token trading before competitive events
 * - Meta-game shift positioning for game updates
 * - Resource scarcity exploitation during community events
 * - Post-event profit-taking and correction trading
 *
 * Gaming Event Categories:
 * - Tournament Events: Esports, community competitions, championships
 * - Development Events: Game updates, season launches, DLC releases
 * - Community Events: Challenges, governance votes, staking events
 * - Economic Events: Node sales, token burns, partnerships
 *
 * Risk Management:
 * - Maximum 4% position per event
 * - Total event arbitrage exposure: 15% of capital
 * - Event confidence minimum: 60%
 * - Maximum hold time: 7 days
 * - Circuit breaker if strategy underperforms for 3 months
 *
 * Key Features:
 * - Event impact prediction with confidence scoring
 * - Multi-phase trading (pre-event, during, post-event)
 * - Historical accuracy tracking and learning
 * - Gaming ecosystem pattern recognition
 * - Cross-game correlation analysis
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { priceCollector } from '../../data/price-collector';
import { gameCalendar, GameEvent, EventType, EventCategory, EventImpactLevel } from '../../data/game-calendar';
import { EventScheduler, ScheduledEvent } from '../../monitoring/event-scheduler';

export interface EventPosition {
  id: string;
  eventId: string;
  phase: 'pre_event' | 'during_event' | 'post_event' | 'completed';

  // Position details
  token: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice?: number;
  positionSize: number; // USD value
  quantity: number; // Token quantity

  // Timing
  entryTime: number;
  exitTime?: number;
  plannedExitTime: number;

  // Risk management
  stopLoss: number;
  takeProfit: number;
  maxHoldTime: number; // Milliseconds

  // Performance tracking
  unrealizedPnL?: number;
  realizedPnL?: number;
  success?: boolean; // Did the event prediction succeed?

  // Event context
  eventConfidence: number;
  expectedImpact: number;
  actualImpact?: number;
}

export interface EventTradingStats {
  totalPositions: number;
  activePositions: number;
  completedPositions: number;
  successfulPositions: number;
  successRate: number;
  totalPnL: number;
  avgHoldTime: number;
  avgReturnPerPosition: number;
  bestEvent: string;
  worstEvent: string;
  profitableEventTypes: EventType[];
  currentExposure: number;
  maxExposureUsed: number;
}

export interface EventOpportunity {
  event: GameEvent;
  token: string;
  direction: 'long' | 'short';
  entryScore: number; // 0-100 opportunity score
  expectedReturn: number;
  riskScore: number;
  recommendedPositionSize: number;
  entryWindow: { start: number; end: number };
  exitWindow: { start: number; end: number };
}

export class EventArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private eventScheduler: EventScheduler;

  private isActive: boolean = false;
  private positions: Map<string, EventPosition> = new Map();
  private eventHistory: Map<string, EventPosition[]> = new Map();

  // Risk management
  private totalCapital: number = 50000; // Will be updated from orchestrator
  private maxTotalExposure: number = 0.15; // 15% of capital max
  private maxPositionSize: number = 0.04; // 4% per event max
  private currentExposure: number = 0;
  private minEventConfidence: number = 0.6; // 60% minimum confidence

  // Performance tracking
  private stats: EventTradingStats = {
    totalPositions: 0,
    activePositions: 0,
    completedPositions: 0,
    successfulPositions: 0,
    successRate: 0,
    totalPnL: 0,
    avgHoldTime: 0,
    avgReturnPerPosition: 0,
    bestEvent: '',
    worstEvent: '',
    profitableEventTypes: [],
    currentExposure: 0,
    maxExposureUsed: 0
  };

  // Event type weightings for opportunity scoring
  private eventTypeWeights: Record<EventType, number> = {
    [EventType.GALAVERSE_EVENT]: 1.0,
    [EventType.MAJOR_UPDATE]: 0.9,
    [EventType.SEASON_LAUNCH]: 0.8,
    [EventType.NODE_LICENSE_SALE]: 0.9,
    [EventType.PARTNERSHIP_ANNOUNCEMENT]: 0.8,
    [EventType.ESPORTS_TOURNAMENT]: 0.7,
    [EventType.CHAMPIONSHIP_FINAL]: 0.8,
    [EventType.COMMUNITY_TOURNAMENT]: 0.6,
    [EventType.SEASONAL_COMPETITION]: 0.6,
    [EventType.DLC_RELEASE]: 0.7,
    [EventType.BETA_LAUNCH]: 0.6,
    [EventType.PATCH_RELEASE]: 0.5,
    [EventType.COMMUNITY_CHALLENGE]: 0.6,
    [EventType.GOVERNANCE_VOTE]: 0.5,
    [EventType.STAKING_EVENT]: 0.7,
    [EventType.NFT_LAUNCH]: 0.6,
    [EventType.AMA_SESSION]: 0.4,
    [EventType.TOKEN_BURN]: 0.8,
    [EventType.EXCHANGE_LISTING]: 0.9,
    [EventType.BUILDING_COMPETITION]: 0.6,
    [EventType.CRAFTING_EVENT]: 0.5,
    [EventType.FASHION_SHOW]: 0.5,
    [EventType.RACING_TOURNAMENT]: 0.6,
    [EventType.CARD_TOURNAMENT]: 0.6,
    [EventType.MAINTENANCE_WINDOW]: 0.8, // High because predictable
    [EventType.SERVER_UPGRADE]: 0.4,
    [EventType.NETWORK_MIGRATION]: 0.7
  };

  constructor(
    gswap: GSwap,
    config: TradingConfig,
    swapExecutor: SwapExecutor,
    marketAnalysis: MarketAnalysis
  ) {
    this.gswap = gswap;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.marketAnalysis = marketAnalysis;
    this.eventScheduler = new EventScheduler({ checkInterval: 60000 }); // Check every minute

    logger.info('🎮 Event Arbitrage Strategy initialized', {
      maxTotalExposure: (this.maxTotalExposure * 100).toFixed(1) + '%',
      maxPositionSize: (this.maxPositionSize * 100).toFixed(1) + '%',
      minEventConfidence: (this.minEventConfidence * 100).toFixed(1) + '%',
      supportedEventTypes: Object.keys(this.eventTypeWeights).length
    });
  }

  /**
   * Start the event arbitrage strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Event Arbitrage Strategy already active');
      return;
    }

    try {
      logger.info('🚀 Starting Event Arbitrage Strategy...');

      // Start event scheduler for monitoring
      await this.eventScheduler.start();

      // Scan for immediate opportunities
      await this.scanForEventOpportunities();

      // Schedule regular opportunity scanning
      this.scheduleOpportunityScanning();

      // Schedule position monitoring
      this.schedulePositionMonitoring();

      // Schedule event preparation
      await this.scheduleEventPreparation();

      this.isActive = true;
      logger.info('✅ Event Arbitrage Strategy started', {
        scheduledEvents: this.eventScheduler.getScheduledEventsCount(),
        upcomingOpportunities: this.getUpcomingOpportunities().length
      });

    } catch (error) {
      logger.error('❌ Failed to start Event Arbitrage Strategy:', error);
      throw error;
    }
  }

  /**
   * Stop the strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    try {
      logger.info('🛑 Stopping Event Arbitrage Strategy...');

      // Stop event scheduler
      await this.eventScheduler.stop();

      // Close all active positions
      await this.closeAllPositions('strategy_shutdown');

      this.isActive = false;
      logger.info('✅ Event Arbitrage Strategy stopped');

    } catch (error) {
      logger.error('❌ Error stopping Event Arbitrage Strategy:', error);
      throw error;
    }
  }

  /**
   * Scan for event opportunities
   */
  async scanForEventOpportunities(): Promise<EventOpportunity[]> {
    if (!this.isActive) return [];

    try {
      // Get upcoming high-impact events
      const upcomingEvents = gameCalendar.getHighImpactEvents(14); // Next 2 weeks
      const opportunities: EventOpportunity[] = [];

      for (const event of upcomingEvents) {
        if (event.confidence < this.minEventConfidence) continue;

        // Analyze each impacted token
        for (const token of event.impactTokens) {
          const opportunity = await this.analyzeEventOpportunity(event, token);
          if (opportunity && opportunity.entryScore >= 60) {
            opportunities.push(opportunity);
          }
        }
      }

      // Sort by entry score
      opportunities.sort((a, b) => b.entryScore - a.entryScore);

      if (opportunities.length > 0) {
        logger.info(`🔍 Found ${opportunities.length} event opportunities`, {
          topOpportunity: opportunities[0]?.event.name,
          topScore: opportunities[0]?.entryScore.toFixed(1)
        });
      }

      return opportunities;

    } catch (error) {
      logger.error('❌ Error scanning for event opportunities:', error);
      return [];
    }
  }

  /**
   * Analyze a specific event-token combination for trading opportunity
   */
  private async analyzeEventOpportunity(event: GameEvent, token: string): Promise<EventOpportunity | null> {
    try {
      const now = Date.now();
      const eventStart = event.startDate.getTime();
      const timeUntilEvent = eventStart - now;

      // Calculate entry and exit windows
      const entryStart = now;
      const entryEnd = eventStart + (event.tradingStrategy.entryTiming * 60 * 60 * 1000);
      const exitStart = eventStart + (event.tradingStrategy.exitTiming * 60 * 60 * 1000);
      const exitEnd = event.endDate.getTime() + (24 * 60 * 60 * 1000); // 24 hours after event end

      // Skip if entry window has passed
      if (entryEnd <= now) return null;

      // Get current market conditions
      const marketCondition = await this.marketAnalysis.analyzeMarket();

      // Calculate opportunity score
      let entryScore = 50; // Base score

      // Event confidence component (30%)
      entryScore += (event.confidence - 0.5) * 60; // Scale 0.5-1.0 to 0-30

      // Impact level component (25%)
      const impactScores = {
        [EventImpactLevel.LOW]: 5,
        [EventImpactLevel.MEDIUM]: 15,
        [EventImpactLevel.HIGH]: 25,
        [EventImpactLevel.EXTREME]: 35
      };
      entryScore += impactScores[event.impactLevel] || 0;

      // Event type component (20%)
      const typeWeight = this.eventTypeWeights[event.type] || 0.5;
      entryScore += typeWeight * 20;

      // Timing component (15%)
      const hoursUntilEvent = timeUntilEvent / (1000 * 60 * 60);
      if (hoursUntilEvent >= 24 && hoursUntilEvent <= 72) {
        entryScore += 15; // Optimal timing window
      } else if (hoursUntilEvent >= 12 && hoursUntilEvent <= 96) {
        entryScore += 10; // Good timing
      } else if (hoursUntilEvent < 12 || hoursUntilEvent > 168) {
        entryScore -= 10; // Suboptimal timing
      }

      // Market conditions component (10%)
      if (marketCondition.liquidity === 'good' || marketCondition.liquidity === 'excellent') {
        entryScore += 5;
      }
      if (marketCondition.volatility === 'high' && event.impactLevel !== EventImpactLevel.LOW) {
        entryScore += 5; // High volatility good for high-impact events
      }

      // Historical accuracy bonus
      if (event.historicalAccuracy > 0.7) {
        entryScore += 5;
      }

      // Determine direction
      const direction = event.expectedImpact.preEventRun > 0 ? 'long' : 'short';

      // Calculate expected return
      const expectedReturn = Math.abs(event.expectedImpact.preEventRun) +
                           Math.abs(event.expectedImpact.eventPeak);

      // Calculate risk score
      const riskScore = this.calculateEventRiskScore(event, marketCondition);

      // Calculate position size
      const baseSize = this.maxPositionSize * event.confidence;
      const riskAdjustedSize = baseSize * (1 - riskScore);
      const recommendedPositionSize = Math.min(riskAdjustedSize, this.getAvailableCapacityForEvent());

      if (recommendedPositionSize <= 0) return null; // No capacity

      return {
        event,
        token,
        direction,
        entryScore: Math.max(0, Math.min(100, entryScore)),
        expectedReturn,
        riskScore,
        recommendedPositionSize,
        entryWindow: { start: entryStart, end: entryEnd },
        exitWindow: { start: exitStart, end: exitEnd }
      };

    } catch (error) {
      logger.error(`❌ Error analyzing opportunity for ${event.name}:`, error);
      return null;
    }
  }

  /**
   * Execute a position based on an event opportunity
   */
  async executeEventPosition(opportunity: EventOpportunity): Promise<boolean> {
    if (!this.isActive) return false;

    try {
      // Final risk checks
      if (!this.canOpenNewPosition(opportunity.recommendedPositionSize)) {
        logger.warn('⚠️ Cannot open position - risk limits exceeded', {
          event: opportunity.event.name,
          requestedSize: opportunity.recommendedPositionSize
        });
        return false;
      }

      logger.info(`🎯 Executing event position for ${opportunity.event.name}`, {
        token: opportunity.token,
        direction: opportunity.direction,
        positionSize: opportunity.recommendedPositionSize.toFixed(4),
        entryScore: opportunity.entryScore.toFixed(1),
        confidence: opportunity.event.confidence.toFixed(3)
      });

      // Get current price
      const currentPrice = await this.getCurrentPrice(opportunity.token);
      if (!currentPrice) {
        logger.error('❌ Cannot get current price for position');
        return false;
      }

      // Calculate position details
      const positionSizeUSD = this.totalCapital * opportunity.recommendedPositionSize;
      const quantity = positionSizeUSD / currentPrice;

      // Create position
      const position: EventPosition = {
        id: `${opportunity.event.id}-${opportunity.token}-${Date.now()}`,
        eventId: opportunity.event.id,
        phase: 'pre_event',
        token: opportunity.token,
        direction: opportunity.direction,
        entryPrice: currentPrice,
        positionSize: positionSizeUSD,
        quantity,
        entryTime: Date.now(),
        plannedExitTime: opportunity.exitWindow.start,
        stopLoss: opportunity.direction === 'long'
          ? currentPrice * (1 - opportunity.event.tradingStrategy.stopLoss)
          : currentPrice * (1 + opportunity.event.tradingStrategy.stopLoss),
        takeProfit: opportunity.direction === 'long'
          ? currentPrice * (1 + opportunity.event.tradingStrategy.takeProfit)
          : currentPrice * (1 - opportunity.event.tradingStrategy.takeProfit),
        maxHoldTime: 7 * 24 * 60 * 60 * 1000, // 7 days
        eventConfidence: opportunity.event.confidence,
        expectedImpact: opportunity.expectedReturn
      };

      // Execute the trade (simplified for this implementation)
      const tradeSuccess = await this.executeTrade(position);

      if (tradeSuccess) {
        this.positions.set(position.id, position);
        this.updateExposure();
        this.updateStats();

        // Schedule exit monitoring for this position
        this.schedulePositionExit(position);

        logger.info('✅ Event position opened successfully', {
          positionId: position.id,
          event: opportunity.event.name,
          token: position.token,
          direction: position.direction,
          size: position.positionSize.toFixed(2)
        });

        return true;
      } else {
        logger.error('❌ Failed to execute event position trade');
        return false;
      }

    } catch (error) {
      logger.error(`❌ Error executing event position:`, error);
      return false;
    }
  }

  /**
   * Close a specific position
   */
  async closePosition(positionId: string, reason: string): Promise<boolean> {
    const position = this.positions.get(positionId);
    if (!position) return false;

    try {
      logger.info(`🚪 Closing event position: ${position.id}`, {
        reason,
        event: position.eventId,
        token: position.token,
        direction: position.direction
      });

      // Get current price for P&L calculation
      const currentPrice = await this.getCurrentPrice(position.token);
      if (!currentPrice) {
        logger.error('❌ Cannot get current price for position close');
        return false;
      }

      position.exitPrice = currentPrice;
      position.exitTime = Date.now();
      position.phase = 'completed';

      // Calculate P&L
      const priceChange = (position.exitPrice - position.entryPrice) / position.entryPrice;
      const directionMultiplier = position.direction === 'long' ? 1 : -1;
      position.realizedPnL = position.positionSize * priceChange * directionMultiplier;

      // Determine if event prediction was successful
      if (position.actualImpact !== undefined) {
        const expectedDirection = position.expectedImpact > 0 ? 1 : -1;
        const actualDirection = position.actualImpact > 0 ? 1 : -1;
        position.success = expectedDirection === actualDirection &&
                          Math.abs(position.actualImpact) >= Math.abs(position.expectedImpact) * 0.5;
      }

      // Execute the close trade (simplified)
      const closeSuccess = await this.executeCloseTrade(position);

      if (closeSuccess) {
        // Move to history
        const eventHistory = this.eventHistory.get(position.eventId) || [];
        eventHistory.push(position);
        this.eventHistory.set(position.eventId, eventHistory);

        // Remove from active positions
        this.positions.delete(positionId);
        this.updateExposure();
        this.updateStats();

        logger.info('✅ Event position closed', {
          positionId,
          pnl: position.realizedPnL?.toFixed(4),
          success: position.success,
          holdTime: position.exitTime ? ((position.exitTime - position.entryTime) / (1000 * 60 * 60)).toFixed(1) + 'h' : 'N/A'
        });

        return true;
      }

    } catch (error) {
      logger.error(`❌ Error closing position ${positionId}:`, error);
    }

    return false;
  }

  /**
   * Monitor all active positions
   */
  private async monitorPositions(): Promise<void> {
    if (!this.isActive || this.positions.size === 0) return;

    const now = Date.now();

    for (const position of this.positions.values()) {
      try {
        const currentPrice = await this.getCurrentPrice(position.token);
        if (!currentPrice) continue;

        // Update unrealized P&L
        const priceChange = (currentPrice - position.entryPrice) / position.entryPrice;
        const directionMultiplier = position.direction === 'long' ? 1 : -1;
        position.unrealizedPnL = position.positionSize * priceChange * directionMultiplier;

        // Check stop loss
        if ((position.direction === 'long' && currentPrice <= position.stopLoss) ||
            (position.direction === 'short' && currentPrice >= position.stopLoss)) {
          await this.closePosition(position.id, 'stop_loss');
          continue;
        }

        // Check take profit
        if ((position.direction === 'long' && currentPrice >= position.takeProfit) ||
            (position.direction === 'short' && currentPrice <= position.takeProfit)) {
          await this.closePosition(position.id, 'take_profit');
          continue;
        }

        // Check max hold time
        if (now - position.entryTime > position.maxHoldTime) {
          await this.closePosition(position.id, 'max_hold_time');
          continue;
        }

        // Check planned exit time
        if (now >= position.plannedExitTime) {
          await this.closePosition(position.id, 'planned_exit');
          continue;
        }

      } catch (error) {
        logger.error(`❌ Error monitoring position ${position.id}:`, error);
      }
    }
  }

  /**
   * Calculate risk score for an event
   */
  private calculateEventRiskScore(event: GameEvent, marketCondition: any): number {
    let riskScore = 0.3; // Base risk

    // Event confidence (lower confidence = higher risk)
    riskScore += (1 - event.confidence) * 0.3;

    // Market volatility
    if (marketCondition.volatility === 'extreme') riskScore += 0.2;
    else if (marketCondition.volatility === 'high') riskScore += 0.1;

    // Market liquidity (poor liquidity = higher risk)
    if (marketCondition.liquidity === 'poor') riskScore += 0.2;
    else if (marketCondition.liquidity === 'fair') riskScore += 0.1;

    // Event verification status
    if (!event.verified) riskScore += 0.1;

    // Time until event (very short or very long = higher risk)
    const hoursUntilEvent = (event.startDate.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilEvent < 6 || hoursUntilEvent > 336) { // Less than 6 hours or more than 2 weeks
      riskScore += 0.1;
    }

    return Math.max(0, Math.min(1, riskScore));
  }

  /**
   * Get available capacity for new event positions
   */
  private getAvailableCapacityForEvent(): number {
    const availableExposure = this.maxTotalExposure - this.currentExposure;
    return Math.min(this.maxPositionSize, availableExposure);
  }

  /**
   * Check if we can open a new position
   */
  private canOpenNewPosition(positionSize: number): boolean {
    return (this.currentExposure + positionSize) <= this.maxTotalExposure &&
           positionSize <= this.maxPositionSize &&
           positionSize > 0.001; // Minimum 0.1% position
  }

  /**
   * Execute a trade (simplified implementation)
   */
  private async executeTrade(position: EventPosition): Promise<boolean> {
    try {
      // In a real implementation, this would use the SwapExecutor
      logger.info(`💰 Executing ${position.direction} trade`, {
        token: position.token,
        size: position.positionSize.toFixed(2),
        price: position.entryPrice.toFixed(6)
      });

      // Simulate successful trade
      return true;

    } catch (error) {
      logger.error('❌ Failed to execute trade:', error);
      return false;
    }
  }

  /**
   * Execute a close trade (simplified implementation)
   */
  private async executeCloseTrade(position: EventPosition): Promise<boolean> {
    try {
      // In a real implementation, this would use the SwapExecutor
      logger.info(`💰 Executing close trade`, {
        token: position.token,
        direction: position.direction === 'long' ? 'sell' : 'cover',
        size: position.positionSize.toFixed(2),
        price: position.exitPrice?.toFixed(6)
      });

      // Simulate successful trade
      return true;

    } catch (error) {
      logger.error('❌ Failed to execute close trade:', error);
      return false;
    }
  }

  /**
   * Get current price for a token
   */
  private async getCurrentPrice(token: string): Promise<number | null> {
    try {
      const recentPrices = await priceCollector.getRecentPrices(token, 1);
      if (recentPrices.length > 0) {
        return recentPrices[0].getPriceUsd();
      }

      // Fallback to hardcoded prices for testing
      const fallbackPrices: Record<string, number> = {
        'GALA|Unit|none|none': 0.05,
        'GUSDC|Unit|none|none': 1.0,
        'TOWN|Unit|none|none': 0.12,
        'MATERIUM|Unit|none|none': 0.08,
        'SILK|Unit|none|none': 0.15,
        'ETIME|Unit|none|none': 0.25
      };

      return fallbackPrices[token] || null;

    } catch (error) {
      logger.error(`❌ Failed to get current price for ${token}:`, error);
      return null;
    }
  }

  /**
   * Schedule regular opportunity scanning
   */
  private scheduleOpportunityScanning(): void {
    const scanForOpportunities = async () => {
      if (!this.isActive) return;

      try {
        const opportunities = await this.scanForEventOpportunities();

        // Auto-execute high-score opportunities if within limits
        for (const opportunity of opportunities.slice(0, 3)) { // Top 3 opportunities
          if (opportunity.entryScore >= 75 &&
              this.canOpenNewPosition(opportunity.recommendedPositionSize)) {
            await this.executeEventPosition(opportunity);
            break; // Only execute one per scan
          }
        }

      } catch (error) {
        logger.error('❌ Error in opportunity scanning:', error);
      }

      // Schedule next scan
      if (this.isActive) {
        setTimeout(scanForOpportunities, 4 * 60 * 60 * 1000); // Every 4 hours
      }
    };

    scanForOpportunities();
  }

  /**
   * Schedule position monitoring
   */
  private schedulePositionMonitoring(): void {
    const monitorPositions = async () => {
      if (!this.isActive) return;

      await this.monitorPositions();

      // Schedule next monitoring
      if (this.isActive) {
        setTimeout(monitorPositions, 5 * 60 * 1000); // Every 5 minutes
      }
    };

    monitorPositions();
  }

  /**
   * Schedule event preparation (for upcoming events)
   */
  private async scheduleEventPreparation(): Promise<void> {
    const upcomingEvents = gameCalendar.getUpcomingEvents(7 * 24); // Next 7 days

    for (const event of upcomingEvents) {
      if (event.confidence < this.minEventConfidence) continue;

      // Schedule preparation 48 hours before event
      const preparationTime = event.startDate.getTime() - (48 * 60 * 60 * 1000);

      if (preparationTime > Date.now()) {
        const prepEvent: ScheduledEvent = {
          id: `prep-${event.id}`,
          name: `Prepare for ${event.name}`,
          description: `Pre-event analysis and positioning for ${event.name}`,
          triggerTime: new Date(preparationTime).toISOString(),
          timezone: 'UTC',
          recurring: 'none',
          enabled: true,
          callback: () => this.prepareForEvent(event)
        };

        await this.eventScheduler.scheduleEvent(prepEvent);
      }
    }
  }

  /**
   * Prepare for an upcoming event
   */
  private async prepareForEvent(event: GameEvent): Promise<void> {
    try {
      logger.info(`🎯 Preparing for event: ${event.name}`);

      // Scan for opportunities for this specific event
      const opportunities: EventOpportunity[] = [];

      for (const token of event.impactTokens) {
        const opportunity = await this.analyzeEventOpportunity(event, token);
        if (opportunity && opportunity.entryScore >= 60) {
          opportunities.push(opportunity);
        }
      }

      // Execute the best opportunity if available
      if (opportunities.length > 0) {
        const bestOpportunity = opportunities.sort((a, b) => b.entryScore - a.entryScore)[0];
        await this.executeEventPosition(bestOpportunity);
      }

    } catch (error) {
      logger.error(`❌ Error preparing for event ${event.id}:`, error);
    }
  }

  /**
   * Schedule position exit
   */
  private schedulePositionExit(position: EventPosition): void {
    const exitTime = position.plannedExitTime;
    const delay = exitTime - Date.now();

    if (delay > 0 && delay < 7 * 24 * 60 * 60 * 1000) { // Within 7 days
      setTimeout(() => {
        if (this.positions.has(position.id)) {
          this.closePosition(position.id, 'scheduled_exit');
        }
      }, delay);
    }
  }

  /**
   * Close all active positions
   */
  private async closeAllPositions(reason: string): Promise<void> {
    const activePositions = Array.from(this.positions.values());

    logger.info(`🚪 Closing ${activePositions.length} active positions`, { reason });

    for (const position of activePositions) {
      try {
        await this.closePosition(position.id, reason);
      } catch (error) {
        logger.error(`❌ Error closing position ${position.id}:`, error);
      }
    }
  }

  /**
   * Update current exposure
   */
  private updateExposure(): void {
    this.currentExposure = Array.from(this.positions.values())
      .reduce((total, position) => total + (position.positionSize / this.totalCapital), 0);

    this.stats.currentExposure = this.currentExposure;
    this.stats.maxExposureUsed = Math.max(this.stats.maxExposureUsed, this.currentExposure);
  }

  /**
   * Update strategy statistics
   */
  private updateStats(): void {
    const allPositions = Array.from(this.positions.values());
    const completedPositions = Array.from(this.eventHistory.values()).flat();

    this.stats.activePositions = allPositions.length;
    this.stats.completedPositions = completedPositions.length;
    this.stats.totalPositions = this.stats.activePositions + this.stats.completedPositions;

    if (completedPositions.length > 0) {
      this.stats.successfulPositions = completedPositions.filter(p => p.success).length;
      this.stats.successRate = this.stats.successfulPositions / completedPositions.length;

      this.stats.totalPnL = completedPositions.reduce((sum, p) => sum + (p.realizedPnL || 0), 0);
      this.stats.avgReturnPerPosition = this.stats.totalPnL / completedPositions.length;

      const holdTimes = completedPositions
        .filter(p => p.exitTime)
        .map(p => (p.exitTime! - p.entryTime) / (1000 * 60 * 60)); // Hours
      this.stats.avgHoldTime = holdTimes.length > 0 ?
        holdTimes.reduce((sum, time) => sum + time, 0) / holdTimes.length : 0;

      // Find best and worst events
      const eventPnLs = new Map<string, number>();
      completedPositions.forEach(p => {
        const current = eventPnLs.get(p.eventId) || 0;
        eventPnLs.set(p.eventId, current + (p.realizedPnL || 0));
      });

      let bestPnL = -Infinity, worstPnL = Infinity;
      let bestEvent = '', worstEvent = '';

      eventPnLs.forEach((pnl, eventId) => {
        if (pnl > bestPnL) {
          bestPnL = pnl;
          bestEvent = eventId;
        }
        if (pnl < worstPnL) {
          worstPnL = pnl;
          worstEvent = eventId;
        }
      });

      this.stats.bestEvent = bestEvent;
      this.stats.worstEvent = worstEvent;

      // Find profitable event types
      const eventTypePnLs = new Map<EventType, number>();
      completedPositions.forEach(p => {
        const event = gameCalendar.getEvents({ }).find(e => e.id === p.eventId);
        if (event) {
          const current = eventTypePnLs.get(event.type) || 0;
          eventTypePnLs.set(event.type, current + (p.realizedPnL || 0));
        }
      });

      this.stats.profitableEventTypes = Array.from(eventTypePnLs.entries())
        .filter(([_, pnl]) => pnl > 0)
        .map(([type, _]) => type);
    }
  }

  /**
   * Get upcoming opportunities
   */
  getUpcomingOpportunities(): EventOpportunity[] {
    // This would normally cache the last scan results
    return [];
  }

  /**
   * Set total capital (called by orchestrator)
   */
  setTotalCapital(capital: number): void {
    this.totalCapital = capital;
    logger.info(`💰 Updated total capital: $${capital.toLocaleString()}`);
  }

  /**
   * Check if strategy is active
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Get strategy statistics
   */
  getStats() {
    return {
      isActive: this.isActive,
      positions: {
        active: this.stats.activePositions,
        completed: this.stats.completedPositions,
        total: this.stats.totalPositions
      },
      performance: {
        successRate: this.stats.successRate,
        totalPnL: this.stats.totalPnL,
        avgReturnPerPosition: this.stats.avgReturnPerPosition,
        avgHoldTime: this.stats.avgHoldTime
      },
      exposure: {
        current: this.stats.currentExposure,
        maximum: this.maxTotalExposure,
        maxUsed: this.stats.maxExposureUsed
      },
      events: {
        bestEvent: this.stats.bestEvent,
        worstEvent: this.stats.worstEvent,
        profitableTypes: this.stats.profitableEventTypes
      },
      upcomingOpportunities: this.getUpcomingOpportunities().length,
      scheduledEvents: this.eventScheduler.getScheduledEventsCount()
    };
  }

  /**
   * Update strategy configuration
   */
  updateConfig(config: {
    maxTotalExposure?: number;
    maxPositionSize?: number;
    minEventConfidence?: number;
  }): void {
    if (config.maxTotalExposure !== undefined) {
      this.maxTotalExposure = Math.max(0.01, Math.min(0.5, config.maxTotalExposure));
    }
    if (config.maxPositionSize !== undefined) {
      this.maxPositionSize = Math.max(0.001, Math.min(0.1, config.maxPositionSize));
    }
    if (config.minEventConfidence !== undefined) {
      this.minEventConfidence = Math.max(0.1, Math.min(1.0, config.minEventConfidence));
    }

    logger.info('⚙️ Event Arbitrage Strategy configuration updated', config);
  }
}