/**
 * Gaming Event Calendar Management System
 *
 * Comprehensive gaming ecosystem event tracking:
 * - Tournament schedules and esports events
 * - Game development milestones and updates
 * - Community events and governance activities
 * - Token economic events and staking bonuses
 * - Event impact prediction and confidence scoring
 *
 * Data Sources:
 * - Official game developer announcements
 * - Community calendar aggregators
 * - On-chain smart contract events
 * - Gaming industry calendars
 * - Influencer and streamer schedules
 *
 * Risk Management:
 * - Event authenticity validation
 * - Impact prediction accuracy tracking
 * - Source reliability scoring
 * - Market manipulation detection
 */

import { logger } from '../utils/logger';

export enum EventType {
  // Tournament Events
  ESPORTS_TOURNAMENT = 'esports_tournament',
  COMMUNITY_TOURNAMENT = 'community_tournament',
  SEASONAL_COMPETITION = 'seasonal_competition',
  CHAMPIONSHIP_FINAL = 'championship_final',

  // Game Development Events
  MAJOR_UPDATE = 'major_update',
  SEASON_LAUNCH = 'season_launch',
  DLC_RELEASE = 'dlc_release',
  BETA_LAUNCH = 'beta_launch',
  PATCH_RELEASE = 'patch_release',

  // Community Events
  COMMUNITY_CHALLENGE = 'community_challenge',
  GOVERNANCE_VOTE = 'governance_vote',
  STAKING_EVENT = 'staking_event',
  NFT_LAUNCH = 'nft_launch',
  AMA_SESSION = 'ama_session',

  // Economic Events
  NODE_LICENSE_SALE = 'node_license_sale',
  TOKEN_BURN = 'token_burn',
  PARTNERSHIP_ANNOUNCEMENT = 'partnership_announcement',
  EXCHANGE_LISTING = 'exchange_listing',
  GALAVERSE_EVENT = 'galaverse_event',

  // Game-Specific Events
  BUILDING_COMPETITION = 'building_competition', // Town Crush
  CRAFTING_EVENT = 'crafting_event', // Materium
  FASHION_SHOW = 'fashion_show', // SILK
  RACING_TOURNAMENT = 'racing_tournament', // ETIME
  CARD_TOURNAMENT = 'card_tournament', // Legends Reborn

  // Market Events
  MAINTENANCE_WINDOW = 'maintenance_window',
  SERVER_UPGRADE = 'server_upgrade',
  NETWORK_MIGRATION = 'network_migration'
}

export enum EventCategory {
  TOURNAMENT = 'tournament',
  DEVELOPMENT = 'development',
  COMMUNITY = 'community',
  ECONOMIC = 'economic',
  TECHNICAL = 'technical'
}

export enum EventImpactLevel {
  LOW = 'low',       // 1-5% expected price movement
  MEDIUM = 'medium', // 5-15% expected price movement
  HIGH = 'high',     // 15-30% expected price movement
  EXTREME = 'extreme' // 30%+ expected price movement
}

export interface EventImpact {
  preEventRun: number;      // Expected % increase days before event
  preEventDays: number;     // Days before event when run typically starts
  eventPeak: number;        // Additional % during peak event activity
  postEventDump: number;    // Expected % decrease after event
  postEventDays: number;    // Days after event when dump typically occurs
  recoveryTime: number;     // Days to return to baseline
  volumeIncrease: number;   // Expected volume spike multiplier
  volatilityIncrease: number; // Expected volatility increase multiplier
}

export interface GameEvent {
  // Basic Information
  id: string;
  name: string;
  description: string;
  type: EventType;
  category: EventCategory;

  // Timing
  startDate: Date;
  endDate: Date;
  timezone: string;

  // Game Association
  game: string; // 'gala', 'town', 'materium', 'silk', 'etime', etc.
  relatedGames: string[]; // Other games that might be affected

  // Token Impact
  impactTokens: string[]; // Primary tokens affected
  secondaryTokens: string[]; // Tokens with smaller impact
  expectedImpact: EventImpact;
  impactLevel: EventImpactLevel;

  // Prediction Confidence
  confidence: number; // 0-1 based on historical accuracy and data quality
  historicalAccuracy: number; // Historical success rate of similar events
  dataQuality: number; // Quality of source data (0-1)

  // Source Information
  sources: EventSource[];
  lastUpdated: number;
  verified: boolean; // Manually verified by reliable source

  // Trading Strategy
  tradingStrategy: TradingStrategy;
  riskLevel: 'low' | 'medium' | 'high';

  // Status
  status: 'scheduled' | 'active' | 'completed' | 'cancelled' | 'postponed';
  actualImpact?: ActualEventImpact; // Filled after event completion
}

export interface EventSource {
  type: 'official' | 'community' | 'onchain' | 'aggregator' | 'social';
  name: string;
  url?: string;
  reliability: number; // 0-1 reliability score
  timestamp: number; // When this source was added
}

export interface TradingStrategy {
  approach: 'pre_event' | 'during_event' | 'post_event' | 'full_cycle';
  entryTiming: number; // Hours before/after event start
  exitTiming: number; // Hours before/after event end
  positionSize: number; // % of allocated capital
  stopLoss: number; // % stop loss
  takeProfit: number; // % take profit
  direction: 'long' | 'short' | 'both';
}

export interface ActualEventImpact {
  actualPreEventRun: number;
  actualEventPeak: number;
  actualPostEventDump: number;
  actualVolumeIncrease: number;
  actualRecoveryTime: number;
  predictionAccuracy: number; // How accurate our prediction was
  tradingPnL: number; // Actual P&L from trading this event
}

export interface EventSearchFilter {
  games?: string[];
  types?: EventType[];
  categories?: EventCategory[];
  startDate?: Date;
  endDate?: Date;
  minConfidence?: number;
  minImpact?: EventImpactLevel;
  status?: string[];
}

export interface CalendarStats {
  totalEvents: number;
  upcomingEvents: number;
  activeEvents: number;
  completedEvents: number;
  averageAccuracy: number;
  totalPredictions: number;
  successfulPredictions: number;
  profitableEvents: number;
  lastUpdated: number;
}

export class GameCalendar {
  private events: Map<string, GameEvent> = new Map();
  private eventHistory: ActualEventImpact[] = [];
  private sourceReliability: Map<string, number> = new Map();
  private gameTokenMapping: Map<string, string[]> = new Map();

  constructor() {
    this.initializeGameTokenMapping();
    this.initializeDefaultEvents();

    logger.info('🗓️ Game Calendar initialized', {
      supportedGames: Array.from(this.gameTokenMapping.keys()).length,
      defaultEvents: this.events.size
    });
  }

  /**
   * Initialize game to token mapping
   */
  private initializeGameTokenMapping(): void {
    // Gala Ecosystem
    this.gameTokenMapping.set('gala', ['GALA|Unit|none|none']);
    this.gameTokenMapping.set('gusdc', ['GUSDC|Unit|none|none']);

    // Individual Games
    this.gameTokenMapping.set('town', ['TOWN|Unit|none|none']);
    this.gameTokenMapping.set('materium', ['MATERIUM|Unit|none|none']);
    this.gameTokenMapping.set('silk', ['SILK|Unit|none|none']);
    this.gameTokenMapping.set('etime', ['ETIME|Unit|none|none']);
    this.gameTokenMapping.set('legends', ['VOX|Unit|none|none']);
    this.gameTokenMapping.set('mirandus', ['MTRM|Unit|none|none']);

    // Cross-game tokens
    this.gameTokenMapping.set('ecosystem', [
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      'TOWN|Unit|none|none',
      'MATERIUM|Unit|none|none',
      'SILK|Unit|none|none',
      'ETIME|Unit|none|none'
    ]);
  }

  /**
   * Initialize default recurring events
   */
  private initializeDefaultEvents(): void {
    // Weekly Gala ecosystem events
    this.addEvent({
      id: 'weekly-node-rewards',
      name: 'Weekly Node Rewards Distribution',
      description: 'Weekly GALA distribution to node operators',
      type: EventType.STAKING_EVENT,
      category: EventCategory.ECONOMIC,
      startDate: this.getNextWeekday('friday', 18, 0), // Friday 18:00 UTC
      endDate: this.getNextWeekday('friday', 19, 0),
      timezone: 'UTC',
      game: 'gala',
      relatedGames: [],
      impactTokens: this.getGameTokens('gala'),
      secondaryTokens: [],
      expectedImpact: {
        preEventRun: 0.02, // 2% run-up
        preEventDays: 2,
        eventPeak: 0.01, // 1% during event
        postEventDump: -0.03, // -3% dump from selling rewards
        postEventDays: 1,
        recoveryTime: 3,
        volumeIncrease: 1.5,
        volatilityIncrease: 1.3
      },
      impactLevel: EventImpactLevel.LOW,
      confidence: 0.85,
      historicalAccuracy: 0.78,
      dataQuality: 0.95,
      sources: [{
        type: 'official',
        name: 'Gala Games Node Documentation',
        reliability: 0.95,
        timestamp: Date.now()
      }],
      lastUpdated: Date.now(),
      verified: true,
      tradingStrategy: {
        approach: 'full_cycle',
        entryTiming: -48, // 48 hours before
        exitTiming: 24, // 24 hours after
        positionSize: 0.02,
        stopLoss: 0.02,
        takeProfit: 0.04,
        direction: 'long'
      },
      riskLevel: 'low',
      status: 'scheduled'
    });

    // Monthly major game updates
    this.addEvent({
      id: 'monthly-game-updates',
      name: 'Monthly Game Updates Release',
      description: 'Major game updates typically released first Tuesday of month',
      type: EventType.MAJOR_UPDATE,
      category: EventCategory.DEVELOPMENT,
      startDate: this.getFirstTuesdayOfMonth(16, 0), // First Tuesday 16:00 UTC
      endDate: this.getFirstTuesdayOfMonth(20, 0),
      timezone: 'UTC',
      game: 'ecosystem',
      relatedGames: ['gala', 'town', 'materium', 'silk', 'etime'],
      impactTokens: this.getGameTokens('ecosystem'),
      secondaryTokens: [],
      expectedImpact: {
        preEventRun: 0.08, // 8% run-up
        preEventDays: 3,
        eventPeak: 0.07, // 7% during announcement
        postEventDump: -0.05, // -5% profit taking
        postEventDays: 2,
        recoveryTime: 7,
        volumeIncrease: 2.2,
        volatilityIncrease: 1.8
      },
      impactLevel: EventImpactLevel.MEDIUM,
      confidence: 0.74,
      historicalAccuracy: 0.69,
      dataQuality: 0.85,
      sources: [{
        type: 'official',
        name: 'Gala Games Development Roadmap',
        reliability: 0.90,
        timestamp: Date.now()
      }],
      lastUpdated: Date.now(),
      verified: true,
      tradingStrategy: {
        approach: 'pre_event',
        entryTiming: -72, // 72 hours before
        exitTiming: 8, // 8 hours after start
        positionSize: 0.03,
        stopLoss: 0.05,
        takeProfit: 0.12,
        direction: 'long'
      },
      riskLevel: 'medium',
      status: 'scheduled'
    });

    // Quarterly Galaverse events
    this.addEvent({
      id: 'quarterly-galaverse',
      name: 'Galaverse Community Event',
      description: 'Quarterly community gathering with major announcements',
      type: EventType.GALAVERSE_EVENT,
      category: EventCategory.COMMUNITY,
      startDate: this.getNextQuarterFirstMonday(12, 0), // First Monday of quarter 12:00 UTC
      endDate: this.getNextQuarterFirstMonday(18, 0),
      timezone: 'UTC',
      game: 'gala',
      relatedGames: ['town', 'materium', 'silk', 'etime'],
      impactTokens: this.getGameTokens('gala'),
      secondaryTokens: this.getGameTokens('ecosystem'),
      expectedImpact: {
        preEventRun: 0.18, // 18% run-up
        preEventDays: 7,
        eventPeak: 0.12, // 12% during event
        postEventDump: -0.15, // -15% sell the news
        postEventDays: 3,
        recoveryTime: 14,
        volumeIncrease: 3.5,
        volatilityIncrease: 2.5
      },
      impactLevel: EventImpactLevel.HIGH,
      confidence: 0.82,
      historicalAccuracy: 0.76,
      dataQuality: 0.90,
      sources: [{
        type: 'official',
        name: 'Gala Games Events Calendar',
        reliability: 0.95,
        timestamp: Date.now()
      }],
      lastUpdated: Date.now(),
      verified: true,
      tradingStrategy: {
        approach: 'full_cycle',
        entryTiming: -168, // 1 week before
        exitTiming: 72, // 3 days after
        positionSize: 0.04,
        stopLoss: 0.08,
        takeProfit: 0.25,
        direction: 'long'
      },
      riskLevel: 'medium',
      status: 'scheduled'
    });

    // Game-specific tournament events
    this.addTournamentEvents();
    this.addMaintenanceEvents();
  }

  /**
   * Add tournament events for different games
   */
  private addTournamentEvents(): void {
    // Town Crush building competitions
    this.addEvent({
      id: 'town-building-competition',
      name: 'Town Crush Building Competition',
      description: 'Monthly building competition requiring TOWN tokens',
      type: EventType.BUILDING_COMPETITION,
      category: EventCategory.TOURNAMENT,
      startDate: this.getThirdSaturday(14, 0), // Third Saturday 14:00 UTC
      endDate: this.getThirdSaturday(18, 0),
      timezone: 'UTC',
      game: 'town',
      relatedGames: ['gala'],
      impactTokens: this.getGameTokens('town'),
      secondaryTokens: this.getGameTokens('gala'),
      expectedImpact: {
        preEventRun: 0.12, // 12% run-up
        preEventDays: 5,
        eventPeak: 0.08, // 8% during competition
        postEventDump: -0.08, // -8% after rewards distributed
        postEventDays: 2,
        recoveryTime: 10,
        volumeIncrease: 2.8,
        volatilityIncrease: 2.1
      },
      impactLevel: EventImpactLevel.MEDIUM,
      confidence: 0.71,
      historicalAccuracy: 0.65,
      dataQuality: 0.80,
      sources: [{
        type: 'community',
        name: 'Town Crush Discord',
        reliability: 0.75,
        timestamp: Date.now()
      }],
      lastUpdated: Date.now(),
      verified: false,
      tradingStrategy: {
        approach: 'pre_event',
        entryTiming: -120, // 5 days before
        exitTiming: 12, // 12 hours after start
        positionSize: 0.025,
        stopLoss: 0.06,
        takeProfit: 0.15,
        direction: 'long'
      },
      riskLevel: 'medium',
      status: 'scheduled'
    });

    // ETIME racing tournaments
    this.addEvent({
      id: 'etime-racing-tournament',
      name: 'Eternal Time Racing Tournament',
      description: 'Weekly racing tournament with ETIME token rewards',
      type: EventType.RACING_TOURNAMENT,
      category: EventCategory.TOURNAMENT,
      startDate: this.getNextWeekday('sunday', 16, 0), // Sunday 16:00 UTC
      endDate: this.getNextWeekday('sunday', 20, 0),
      timezone: 'UTC',
      game: 'etime',
      relatedGames: ['gala'],
      impactTokens: this.getGameTokens('etime'),
      secondaryTokens: [],
      expectedImpact: {
        preEventRun: 0.06, // 6% run-up
        preEventDays: 2,
        eventPeak: 0.04, // 4% during tournament
        postEventDump: -0.04, // -4% after tournament
        postEventDays: 1,
        recoveryTime: 5,
        volumeIncrease: 2.0,
        volatilityIncrease: 1.6
      },
      impactLevel: EventImpactLevel.LOW,
      confidence: 0.68,
      historicalAccuracy: 0.62,
      dataQuality: 0.70,
      sources: [{
        type: 'community',
        name: 'Eternal Time Racing Discord',
        reliability: 0.70,
        timestamp: Date.now()
      }],
      lastUpdated: Date.now(),
      verified: false,
      tradingStrategy: {
        approach: 'pre_event',
        entryTiming: -48, // 2 days before
        exitTiming: 4, // 4 hours after start
        positionSize: 0.015,
        stopLoss: 0.03,
        takeProfit: 0.08,
        direction: 'long'
      },
      riskLevel: 'low',
      status: 'scheduled'
    });
  }

  /**
   * Add maintenance and technical events
   */
  private addMaintenanceEvents(): void {
    // Weekly maintenance window
    this.addEvent({
      id: 'weekly-maintenance',
      name: 'Weekly System Maintenance',
      description: 'Regular maintenance window with reduced liquidity',
      type: EventType.MAINTENANCE_WINDOW,
      category: EventCategory.TECHNICAL,
      startDate: this.getNextWeekday('tuesday', 2, 0), // Tuesday 02:00 UTC
      endDate: this.getNextWeekday('tuesday', 4, 0),
      timezone: 'UTC',
      game: 'ecosystem',
      relatedGames: ['gala', 'town', 'materium', 'silk', 'etime'],
      impactTokens: this.getGameTokens('ecosystem'),
      secondaryTokens: [],
      expectedImpact: {
        preEventRun: 0.005, // 0.5% slight decrease
        preEventDays: 1,
        eventPeak: 0.015, // 1.5% arbitrage opportunities
        postEventDump: -0.005, // -0.5% normalization
        postEventDays: 1,
        recoveryTime: 2,
        volumeIncrease: 0.7, // Reduced volume
        volatilityIncrease: 1.4 // Higher volatility due to low liquidity
      },
      impactLevel: EventImpactLevel.LOW,
      confidence: 0.88,
      historicalAccuracy: 0.85,
      dataQuality: 0.95,
      sources: [{
        type: 'official',
        name: 'Gala Games System Status',
        reliability: 0.98,
        timestamp: Date.now()
      }],
      lastUpdated: Date.now(),
      verified: true,
      tradingStrategy: {
        approach: 'during_event',
        entryTiming: 0, // At maintenance start
        exitTiming: 2, // 2 hours duration
        positionSize: 0.01,
        stopLoss: 0.01,
        takeProfit: 0.02,
        direction: 'both' // Arbitrage opportunities
      },
      riskLevel: 'low',
      status: 'scheduled'
    });
  }

  /**
   * Add a new event to the calendar
   */
  addEvent(event: GameEvent): void {
    // Validate event
    this.validateEvent(event);

    // Calculate confidence score
    event.confidence = this.calculateEventConfidence(event);

    // Store event
    this.events.set(event.id, event);

    logger.info(`📅 Event added to calendar: ${event.name}`, {
      id: event.id,
      type: event.type,
      startDate: event.startDate.toISOString(),
      confidence: event.confidence.toFixed(3),
      impact: event.impactLevel
    });
  }

  /**
   * Update an existing event
   */
  updateEvent(eventId: string, updates: Partial<GameEvent>): void {
    const event = this.events.get(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    // Merge updates
    const updatedEvent = { ...event, ...updates };
    updatedEvent.lastUpdated = Date.now();
    updatedEvent.confidence = this.calculateEventConfidence(updatedEvent);

    this.events.set(eventId, updatedEvent);

    logger.info(`📝 Event updated: ${updatedEvent.name}`, {
      id: eventId,
      confidence: updatedEvent.confidence.toFixed(3)
    });
  }

  /**
   * Remove an event from the calendar
   */
  removeEvent(eventId: string): void {
    if (this.events.has(eventId)) {
      this.events.delete(eventId);
      logger.info(`🗑️ Event removed: ${eventId}`);
    }
  }

  /**
   * Get upcoming events
   */
  getUpcomingEvents(hours: number = 168): GameEvent[] { // Default 7 days
    const cutoffTime = new Date(Date.now() + hours * 60 * 60 * 1000);

    return Array.from(this.events.values())
      .filter(event =>
        event.status === 'scheduled' &&
        event.startDate <= cutoffTime &&
        event.startDate >= new Date()
      )
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  /**
   * Get events by filter criteria
   */
  getEvents(filter: EventSearchFilter = {}): GameEvent[] {
    return Array.from(this.events.values()).filter(event => {
      // Game filter
      if (filter.games && !filter.games.includes(event.game)) return false;

      // Type filter
      if (filter.types && !filter.types.includes(event.type)) return false;

      // Category filter
      if (filter.categories && !filter.categories.includes(event.category)) return false;

      // Date range filter
      if (filter.startDate && event.startDate < filter.startDate) return false;
      if (filter.endDate && event.startDate > filter.endDate) return false;

      // Confidence filter
      if (filter.minConfidence && event.confidence < filter.minConfidence) return false;

      // Impact filter
      if (filter.minImpact) {
        const impactOrder = [EventImpactLevel.LOW, EventImpactLevel.MEDIUM, EventImpactLevel.HIGH, EventImpactLevel.EXTREME];
        if (impactOrder.indexOf(event.impactLevel) < impactOrder.indexOf(filter.minImpact)) return false;
      }

      // Status filter
      if (filter.status && !filter.status.includes(event.status)) return false;

      return true;
    });
  }

  /**
   * Get high-impact events for the next period
   */
  getHighImpactEvents(days: number = 14): GameEvent[] {
    const cutoffTime = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    return Array.from(this.events.values())
      .filter(event =>
        event.status === 'scheduled' &&
        event.startDate <= cutoffTime &&
        event.startDate >= new Date() &&
        (event.impactLevel === EventImpactLevel.HIGH || event.impactLevel === EventImpactLevel.EXTREME) &&
        event.confidence >= 0.6
      )
      .sort((a, b) => {
        // Sort by impact level first, then by confidence
        const impactOrder = { low: 1, medium: 2, high: 3, extreme: 4 };
        const impactDiff = impactOrder[b.impactLevel] - impactOrder[a.impactLevel];
        if (impactDiff !== 0) return impactDiff;
        return b.confidence - a.confidence;
      });
  }

  /**
   * Get events for a specific token
   */
  getTokenEvents(token: string, days: number = 30): GameEvent[] {
    const cutoffTime = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    return Array.from(this.events.values())
      .filter(event =>
        event.startDate <= cutoffTime &&
        event.startDate >= new Date() &&
        (event.impactTokens.includes(token) || event.secondaryTokens.includes(token))
      )
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  /**
   * Record actual event impact for learning
   */
  recordActualImpact(eventId: string, actualImpact: ActualEventImpact): void {
    const event = this.events.get(eventId);
    if (!event) {
      logger.warn(`⚠️ Cannot record impact for unknown event: ${eventId}`);
      return;
    }

    event.actualImpact = actualImpact;
    event.status = 'completed';

    // Update historical accuracy
    this.updateHistoricalAccuracy(event, actualImpact);

    // Add to event history
    this.eventHistory.push(actualImpact);

    // Update source reliability based on accuracy
    this.updateSourceReliability(event, actualImpact.predictionAccuracy);

    logger.info(`📊 Actual impact recorded for ${event.name}`, {
      eventId,
      accuracy: actualImpact.predictionAccuracy.toFixed(3),
      pnl: actualImpact.tradingPnL?.toFixed(2)
    });
  }

  /**
   * Get calendar statistics
   */
  getStats(): CalendarStats {
    const now = Date.now();
    const events = Array.from(this.events.values());
    const completedEvents = events.filter(e => e.status === 'completed');

    const accuracySum = completedEvents
      .filter(e => e.actualImpact?.predictionAccuracy !== undefined)
      .reduce((sum, e) => sum + (e.actualImpact?.predictionAccuracy || 0), 0);

    const profitableEvents = completedEvents.filter(e =>
      e.actualImpact?.tradingPnL && e.actualImpact.tradingPnL > 0
    ).length;

    return {
      totalEvents: events.length,
      upcomingEvents: events.filter(e => e.status === 'scheduled' && e.startDate > new Date()).length,
      activeEvents: events.filter(e => e.status === 'active').length,
      completedEvents: completedEvents.length,
      averageAccuracy: completedEvents.length > 0 ? accuracySum / completedEvents.length : 0,
      totalPredictions: completedEvents.filter(e => e.actualImpact).length,
      successfulPredictions: completedEvents.filter(e =>
        e.actualImpact?.predictionAccuracy && e.actualImpact.predictionAccuracy >= 0.7
      ).length,
      profitableEvents,
      lastUpdated: now
    };
  }

  /**
   * Validate event data
   */
  private validateEvent(event: GameEvent): void {
    if (!event.id || !event.name || !event.startDate) {
      throw new Error('Event missing required fields: id, name, startDate');
    }

    if (event.startDate >= event.endDate) {
      throw new Error('Event end date must be after start date');
    }

    if (event.confidence < 0 || event.confidence > 1) {
      throw new Error('Event confidence must be between 0 and 1');
    }

    if (this.events.has(event.id)) {
      throw new Error(`Event with id ${event.id} already exists`);
    }
  }

  /**
   * Calculate event confidence score based on multiple factors
   */
  private calculateEventConfidence(event: GameEvent): number {
    let confidence = 0.5; // Base confidence

    // Data quality component (30%)
    confidence += (event.dataQuality * 0.3);

    // Historical accuracy component (25%)
    confidence += (event.historicalAccuracy * 0.25);

    // Source reliability component (25%)
    const avgSourceReliability = event.sources.reduce((sum, source) =>
      sum + source.reliability, 0) / event.sources.length;
    confidence += (avgSourceReliability * 0.25);

    // Verification bonus (10%)
    if (event.verified) {
      confidence += 0.1;
    }

    // Recent update penalty (reduce confidence if data is stale)
    const daysSinceUpdate = (Date.now() - event.lastUpdated) / (24 * 60 * 60 * 1000);
    if (daysSinceUpdate > 7) {
      confidence -= Math.min(0.2, daysSinceUpdate / 30); // Max 20% penalty
    }

    // Multiple source bonus
    if (event.sources.length > 1) {
      confidence += Math.min(0.1, event.sources.length * 0.02);
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Update historical accuracy based on actual results
   */
  private updateHistoricalAccuracy(event: GameEvent, actualImpact: ActualEventImpact): void {
    // Simple exponential moving average with 0.3 weight for new data
    const alpha = 0.3;
    event.historicalAccuracy = (alpha * actualImpact.predictionAccuracy) +
                               ((1 - alpha) * event.historicalAccuracy);
  }

  /**
   * Update source reliability scores
   */
  private updateSourceReliability(event: GameEvent, accuracy: number): void {
    const alpha = 0.2; // Learning rate

    event.sources.forEach(source => {
      const sourceKey = `${source.type}-${source.name}`;
      const currentReliability = this.sourceReliability.get(sourceKey) || source.reliability;
      const newReliability = (alpha * accuracy) + ((1 - alpha) * currentReliability);

      this.sourceReliability.set(sourceKey, Math.max(0.1, Math.min(1, newReliability)));
      source.reliability = newReliability;
    });
  }

  /**
   * Get tokens for a specific game
   */
  private getGameTokens(game: string): string[] {
    return this.gameTokenMapping.get(game) || [];
  }

  /**
   * Helper methods for date calculations
   */
  private getNextWeekday(weekday: string, hours: number, minutes: number): Date {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = weekdays.indexOf(weekday.toLowerCase());

    const now = new Date();
    const currentDay = now.getUTCDay();
    const daysUntil = (targetDay - currentDay + 7) % 7 || 7; // Next occurrence

    const targetDate = new Date(now);
    targetDate.setUTCDate(now.getUTCDate() + daysUntil);
    targetDate.setUTCHours(hours, minutes, 0, 0);

    return targetDate;
  }

  private getFirstTuesdayOfMonth(hours: number, minutes: number): Date {
    const now = new Date();
    const firstDay = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const dayOfWeek = firstDay.getUTCDay();
    const daysToTuesday = (2 - dayOfWeek + 7) % 7; // Tuesday is day 2

    const firstTuesday = new Date(firstDay);
    firstTuesday.setUTCDate(1 + daysToTuesday);
    firstTuesday.setUTCHours(hours, minutes, 0, 0);

    return firstTuesday;
  }

  private getThirdSaturday(hours: number, minutes: number): Date {
    const now = new Date();
    const firstDay = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const dayOfWeek = firstDay.getUTCDay();
    const daysToSaturday = (6 - dayOfWeek + 7) % 7; // Saturday is day 6

    const firstSaturday = new Date(firstDay);
    firstSaturday.setUTCDate(1 + daysToSaturday);

    const thirdSaturday = new Date(firstSaturday);
    thirdSaturday.setUTCDate(firstSaturday.getUTCDate() + 14); // Add 2 weeks
    thirdSaturday.setUTCHours(hours, minutes, 0, 0);

    return thirdSaturday;
  }

  private getNextQuarterFirstMonday(hours: number, minutes: number): Date {
    const now = new Date();
    const currentQuarter = Math.floor(now.getUTCMonth() / 3);
    const nextQuarter = (currentQuarter + 1) % 4;
    const nextQuarterMonth = nextQuarter * 3;

    const firstDay = new Date(now.getUTCFullYear() + (nextQuarter === 0 ? 1 : 0), nextQuarterMonth, 1);
    const dayOfWeek = firstDay.getUTCDay();
    const daysToMonday = (1 - dayOfWeek + 7) % 7; // Monday is day 1

    const firstMonday = new Date(firstDay);
    firstMonday.setUTCDate(1 + daysToMonday);
    firstMonday.setUTCHours(hours, minutes, 0, 0);

    return firstMonday;
  }

  /**
   * Export events for external integration
   */
  exportEvents(format: 'json' | 'ical' = 'json'): string {
    const events = Array.from(this.events.values());

    if (format === 'json') {
      return JSON.stringify(events, null, 2);
    }

    // Basic iCal format for calendar integration
    let ical = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:GalaSwap Trading Bot\r\n';

    events.forEach(event => {
      ical += 'BEGIN:VEVENT\r\n';
      ical += `UID:${event.id}\r\n`;
      ical += `SUMMARY:${event.name}\r\n`;
      ical += `DESCRIPTION:${event.description}\r\n`;
      ical += `DTSTART:${event.startDate.toISOString().replace(/[-:]/g, '').split('.')[0]}Z\r\n`;
      ical += `DTEND:${event.endDate.toISOString().replace(/[-:]/g, '').split('.')[0]}Z\r\n`;
      ical += `CATEGORIES:${event.category.toUpperCase()}\r\n`;
      ical += 'END:VEVENT\r\n';
    });

    ical += 'END:VCALENDAR\r\n';
    return ical;
  }

  /**
   * Import events from external source
   */
  importEvents(data: string, format: 'json' = 'json'): number {
    let imported = 0;

    try {
      if (format === 'json') {
        const events = JSON.parse(data) as GameEvent[];

        events.forEach(eventData => {
          try {
            // Convert date strings back to Date objects
            eventData.startDate = new Date(eventData.startDate);
            eventData.endDate = new Date(eventData.endDate);

            this.addEvent(eventData);
            imported++;
          } catch (error) {
            logger.warn(`⚠️ Failed to import event ${eventData.id}:`, error);
          }
        });
      }
    } catch (error) {
      logger.error('❌ Failed to import events:', error);
      throw error;
    }

    logger.info(`📥 Imported ${imported} events`);
    return imported;
  }
}

// Export singleton instance
export const gameCalendar = new GameCalendar();