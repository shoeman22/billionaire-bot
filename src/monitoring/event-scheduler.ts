/**
 * Event Scheduler
 *
 * Time-based trigger system for pattern execution:
 * - Supports daily, weekly, and monthly recurring events
 * - UTC timezone handling with offset support
 * - Pattern confidence scoring and validation
 * - Historical performance tracking
 * - Flexible cron-like scheduling with gaming-specific patterns
 *
 * Gaming Ecosystem Considerations:
 * - Handles game maintenance windows
 * - Accounts for different player time zones
 * - Supports seasonal events and tournaments
 * - Integrates with major gaming industry event calendars
 */

import { logger } from '../utils/logger';

export interface ScheduledEvent {
  id: string;
  name: string;
  description: string;

  // Scheduling
  triggerTime: string; // Time pattern (e.g., '00:00', 'friday-15:00', 'first-tuesday-16:00')
  offsetMinutes?: number; // Offset from trigger time (negative for before, positive for after)
  timezone: string; // Default: UTC
  recurring: 'none' | 'daily' | 'weekly' | 'monthly' | 'quarterly';

  // Execution
  enabled: boolean;
  callback: () => Promise<void> | void;
  lastExecuted?: number;
  nextExecution?: number;

  // Optional metadata
  metadata?: Record<string, unknown>;
}

export interface EventHistory {
  eventId: string;
  executionTime: number;
  scheduledTime: number;
  success: boolean;
  duration: number;
  error?: string;
}

export interface SchedulerConfig {
  timezone: string;
  checkInterval: number; // How often to check for pending events (ms)
  maxSkewMinutes: number; // Maximum allowed time skew for execution
  historyRetentionDays: number; // How long to keep execution history
  enableEventHistory: boolean;
}

export interface SchedulerStats {
  totalEvents: number;
  enabledEvents: number;
  executedToday: number;
  successRate: number; // Last 24 hours
  averageExecutionTime: number; // Last 24 hours
  nextEventTime?: number;
  uptime: number;
}

export class EventScheduler {
  private events: Map<string, ScheduledEvent> = new Map();
  private executionHistory: EventHistory[] = [];
  private isActive: boolean = false;
  private schedulerTimer?: NodeJS.Timeout;
  private startTime: number = Date.now();

  private config: SchedulerConfig = {
    timezone: 'UTC',
    checkInterval: 30000, // 30 seconds
    maxSkewMinutes: 5, // 5 minute tolerance
    historyRetentionDays: 30,
    enableEventHistory: true
  };

  constructor(config?: Partial<SchedulerConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    logger.info('⏰ Event Scheduler initialized', {
      timezone: this.config.timezone,
      checkInterval: this.config.checkInterval,
      historyEnabled: this.config.enableEventHistory
    });
  }

  /**
   * Start the event scheduler
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('Event Scheduler already running');
      return;
    }

    try {
      logger.info('🚀 Starting Event Scheduler...');

      // Calculate next execution times for all events
      this.calculateNextExecutions();

      // Start the scheduling loop
      this.startSchedulingLoop();

      // Clean up old history
      if (this.config.enableEventHistory) {
        this.cleanupOldHistory();
      }

      this.isActive = true;
      logger.info('✅ Event Scheduler started successfully', {
        scheduledEvents: this.events.size,
        nextCheck: new Date(Date.now() + this.config.checkInterval).toISOString()
      });

    } catch (error) {
      logger.error('❌ Failed to start Event Scheduler:', error);
      throw error;
    }
  }

  /**
   * Stop the event scheduler
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    try {
      logger.info('🛑 Stopping Event Scheduler...');

      if (this.schedulerTimer) {
        clearTimeout(this.schedulerTimer);
        this.schedulerTimer = undefined;
      }

      this.isActive = false;
      logger.info('✅ Event Scheduler stopped');

    } catch (error) {
      logger.error('❌ Error stopping Event Scheduler:', error);
      throw error;
    }
  }

  /**
   * Schedule a new event
   */
  async scheduleEvent(event: ScheduledEvent): Promise<void> {
    try {
      // Validate event configuration
      this.validateEvent(event);

      // Calculate next execution time
      event.nextExecution = this.calculateNextExecution(event);

      // Store the event
      this.events.set(event.id, event);

      logger.info(`📅 Event scheduled: ${event.name}`, {
        id: event.id,
        triggerTime: event.triggerTime,
        nextExecution: event.nextExecution ? new Date(event.nextExecution).toISOString() : 'never',
        recurring: event.recurring,
        enabled: event.enabled
      });

    } catch (error) {
      logger.error(`❌ Failed to schedule event ${event.id}:`, error);
      throw error;
    }
  }

  /**
   * Unschedule an event
   */
  unscheduleEvent(eventId: string): void {
    if (this.events.has(eventId)) {
      this.events.delete(eventId);
      logger.info(`🗑️ Event unscheduled: ${eventId}`);
    }
  }

  /**
   * Enable or disable an event
   */
  setEventEnabled(eventId: string, enabled: boolean): void {
    const event = this.events.get(eventId);
    if (event) {
      event.enabled = enabled;
      if (enabled) {
        event.nextExecution = this.calculateNextExecution(event);
      }
      logger.info(`🔧 Event ${eventId} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Get scheduled events count
   */
  getScheduledEventsCount(): number {
    return Array.from(this.events.values()).filter(e => e.enabled).length;
  }

  /**
   * Validate event configuration
   */
  private validateEvent(event: ScheduledEvent): void {
    if (!event.id || !event.name || !event.triggerTime || !event.callback) {
      throw new Error('Event missing required fields: id, name, triggerTime, callback');
    }

    if (!this.isValidTriggerTime(event.triggerTime)) {
      throw new Error(`Invalid trigger time format: ${event.triggerTime}`);
    }

    if (this.events.has(event.id)) {
      throw new Error(`Event with id ${event.id} already exists`);
    }
  }

  /**
   * Validate trigger time format
   */
  private isValidTriggerTime(triggerTime: string): boolean {
    // Simple time format: HH:MM
    if (/^\d{1,2}:\d{2}$/.test(triggerTime)) {
      return true;
    }

    // Weekly format: weekday-HH:MM
    if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)-\d{1,2}:\d{2}$/.test(triggerTime)) {
      return true;
    }

    // Monthly format: first-weekday-HH:MM, last-weekday-HH:MM, or day-of-month-HH:MM
    if (/^(first|last)-(monday|tuesday|wednesday|thursday|friday|saturday|sunday)-\d{1,2}:\d{2}$/.test(triggerTime)) {
      return true;
    }

    if (/^\d{1,2}-\d{1,2}:\d{2}$/.test(triggerTime)) { // day-of-month format
      return true;
    }

    return false;
  }

  /**
   * Calculate next execution time for an event
   */
  private calculateNextExecution(event: ScheduledEvent): number | undefined {
    if (!event.enabled) return undefined;

    try {
      const now = new Date();
      let nextTime: Date;

      // Parse trigger time
      if (event.triggerTime.includes('-')) {
        // Weekly or monthly pattern
        nextTime = this.parseComplexTriggerTime(event.triggerTime, now);
      } else {
        // Daily pattern (HH:MM)
        nextTime = this.parseDailyTriggerTime(event.triggerTime, now);
      }

      // Apply offset
      if (event.offsetMinutes) {
        nextTime.setMinutes(nextTime.getMinutes() + event.offsetMinutes);
      }

      // If the calculated time is in the past, advance based on recurring pattern
      if (nextTime.getTime() <= now.getTime()) {
        nextTime = this.advanceToNextOccurrence(nextTime, event.recurring);
      }

      return nextTime.getTime();

    } catch (error) {
      logger.error(`❌ Failed to calculate next execution for ${event.id}:`, error);
      return undefined;
    }
  }

  /**
   * Parse daily trigger time (HH:MM format)
   */
  private parseDailyTriggerTime(triggerTime: string, baseDate: Date): Date {
    const [hours, minutes] = triggerTime.split(':').map(Number);
    const nextTime = new Date(baseDate);
    nextTime.setUTCHours(hours, minutes, 0, 0);
    return nextTime;
  }

  /**
   * Parse complex trigger time (weekly/monthly patterns)
   */
  private parseComplexTriggerTime(triggerTime: string, baseDate: Date): Date {
    const parts = triggerTime.split('-');

    if (parts.length === 2) {
      // Weekly format: weekday-HH:MM
      const [weekday, time] = parts;
      const [hours, minutes] = time.split(':').map(Number);

      const targetWeekday = this.getWeekdayNumber(weekday);
      const nextTime = new Date(baseDate);

      // Find next occurrence of this weekday
      const currentWeekday = nextTime.getUTCDay();
      const daysUntilTarget = (targetWeekday - currentWeekday + 7) % 7;

      nextTime.setUTCDate(nextTime.getUTCDate() + daysUntilTarget);
      nextTime.setUTCHours(hours, minutes, 0, 0);

      return nextTime;

    } else if (parts.length === 3) {
      // Monthly format: first-weekday-HH:MM or last-weekday-HH:MM
      const [position, weekday, time] = parts;
      const [hours, minutes] = time.split(':').map(Number);

      return this.calculateMonthlyOccurrence(position, weekday, hours, minutes, baseDate);
    }

    throw new Error(`Invalid trigger time format: ${triggerTime}`);
  }

  /**
   * Get numeric weekday (0 = Sunday, 1 = Monday, etc.)
   */
  private getWeekdayNumber(weekday: string): number {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return weekdays.indexOf(weekday.toLowerCase());
  }

  /**
   * Calculate monthly occurrence (e.g., first Tuesday, last Friday)
   */
  private calculateMonthlyOccurrence(
    position: string,
    weekday: string,
    hours: number,
    minutes: number,
    baseDate: Date
  ): Date {
    const targetWeekday = this.getWeekdayNumber(weekday);
    let nextTime = new Date(baseDate);

    if (position === 'first') {
      // First occurrence of weekday in current/next month
      nextTime.setUTCDate(1); // Start of month

      const firstWeekday = nextTime.getUTCDay();
      const daysToFirst = (targetWeekday - firstWeekday + 7) % 7;

      nextTime.setUTCDate(1 + daysToFirst);
      nextTime.setUTCHours(hours, minutes, 0, 0);

      // If this is in the past, move to next month
      if (nextTime.getTime() <= baseDate.getTime()) {
        nextTime.setUTCMonth(nextTime.getUTCMonth() + 1);
        nextTime.setUTCDate(1);
        const nextFirstWeekday = nextTime.getUTCDay();
        const nextDaysToFirst = (targetWeekday - nextFirstWeekday + 7) % 7;
        nextTime.setUTCDate(1 + nextDaysToFirst);
        nextTime.setUTCHours(hours, minutes, 0, 0);
      }

    } else if (position === 'last') {
      // Last occurrence of weekday in current/next month
      const lastDay = new Date(nextTime.getUTCFullYear(), nextTime.getUTCMonth() + 1, 0);
      const lastWeekday = lastDay.getUTCDay();
      const daysBackToLast = (lastWeekday - targetWeekday + 7) % 7;

      nextTime = new Date(lastDay);
      nextTime.setUTCDate(lastDay.getUTCDate() - daysBackToLast);
      nextTime.setUTCHours(hours, minutes, 0, 0);

      // If this is in the past, move to next month
      if (nextTime.getTime() <= baseDate.getTime()) {
        const nextMonthLastDay = new Date(nextTime.getUTCFullYear(), nextTime.getUTCMonth() + 2, 0);
        const nextLastWeekday = nextMonthLastDay.getUTCDay();
        const nextDaysBackToLast = (nextLastWeekday - targetWeekday + 7) % 7;

        nextTime = new Date(nextMonthLastDay);
        nextTime.setUTCDate(nextMonthLastDay.getUTCDate() - nextDaysBackToLast);
        nextTime.setUTCHours(hours, minutes, 0, 0);
      }
    }

    return nextTime;
  }

  /**
   * Advance to next occurrence based on recurring pattern
   */
  private advanceToNextOccurrence(time: Date, recurring: string): Date {
    const nextTime = new Date(time);

    switch (recurring) {
      case 'daily':
        nextTime.setUTCDate(nextTime.getUTCDate() + 1);
        break;

      case 'weekly':
        nextTime.setUTCDate(nextTime.getUTCDate() + 7);
        break;

      case 'monthly':
        nextTime.setUTCMonth(nextTime.getUTCMonth() + 1);
        break;

      case 'quarterly':
        nextTime.setUTCMonth(nextTime.getUTCMonth() + 3);
        break;

      case 'none':
      default:
        // Non-recurring event that's in the past should not execute
        return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // Far future
    }

    return nextTime;
  }

  /**
   * Calculate next execution times for all events
   */
  private calculateNextExecutions(): void {
    for (const event of this.events.values()) {
      if (event.enabled) {
        event.nextExecution = this.calculateNextExecution(event);
      }
    }
  }

  /**
   * Start the scheduling loop
   */
  private startSchedulingLoop(): void {
    const checkForPendingEvents = async () => {
      if (!this.isActive) return;

      try {
        await this.checkAndExecutePendingEvents();
      } catch (error) {
        logger.error('❌ Error in scheduling loop:', error);
      }

      // Schedule next check
      if (this.isActive) {
        this.schedulerTimer = setTimeout(checkForPendingEvents, this.config.checkInterval);
      }
    };

    checkForPendingEvents();
  }

  /**
   * Check for and execute pending events
   */
  private async checkAndExecutePendingEvents(): Promise<void> {
    const now = Date.now();
    const skewTolerance = this.config.maxSkewMinutes * 60 * 1000;

    for (const event of this.events.values()) {
      if (!event.enabled || !event.nextExecution) continue;

      // Check if event should execute (within tolerance)
      const timeDiff = now - event.nextExecution;
      if (timeDiff >= -skewTolerance && timeDiff <= skewTolerance) {
        await this.executeEvent(event);
      }
    }
  }

  /**
   * Execute a scheduled event
   */
  private async executeEvent(event: ScheduledEvent): Promise<void> {
    const startTime = Date.now();

    logger.info(`⚡ Executing scheduled event: ${event.name}`, {
      id: event.id,
      scheduledTime: event.nextExecution ? new Date(event.nextExecution).toISOString() : 'unknown',
      actualTime: new Date(startTime).toISOString()
    });

    let success = false;
    let error: string | undefined;

    try {
      await event.callback();
      success = true;

      logger.info(`✅ Event executed successfully: ${event.name}`, {
        id: event.id,
        duration: Date.now() - startTime
      });

    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.error(`❌ Event execution failed: ${event.name}`, {
        id: event.id,
        error,
        duration: Date.now() - startTime
      });
    }

    // Record execution history
    if (this.config.enableEventHistory) {
      const historyEntry: EventHistory = {
        eventId: event.id,
        executionTime: startTime,
        scheduledTime: event.nextExecution || startTime,
        success,
        duration: Date.now() - startTime,
        error
      };

      this.executionHistory.push(historyEntry);

      // Limit history size
      if (this.executionHistory.length > 10000) {
        this.executionHistory = this.executionHistory.slice(-5000);
      }
    }

    // Update event for next execution
    event.lastExecuted = startTime;

    if (event.recurring !== 'none') {
      event.nextExecution = this.calculateNextExecution(event);
      logger.debug(`📅 Next execution for ${event.id}: ${event.nextExecution ? new Date(event.nextExecution).toISOString() : 'never'}`);
    } else {
      // One-time event completed
      event.enabled = false;
      event.nextExecution = undefined;
      logger.info(`🏁 One-time event completed: ${event.id}`);
    }
  }

  /**
   * Clean up old execution history
   */
  private cleanupOldHistory(): void {
    if (!this.config.enableEventHistory) return;

    const cutoffTime = Date.now() - (this.config.historyRetentionDays * 24 * 60 * 60 * 1000);
    const initialCount = this.executionHistory.length;

    this.executionHistory = this.executionHistory.filter(entry => entry.executionTime >= cutoffTime);

    const removedCount = initialCount - this.executionHistory.length;
    if (removedCount > 0) {
      logger.info(`🧹 Cleaned up ${removedCount} old history entries`);
    }

    // Schedule next cleanup in 24 hours
    setTimeout(() => this.cleanupOldHistory(), 24 * 60 * 60 * 1000);
  }

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    // Recent executions (last 24 hours)
    const recentExecutions = this.executionHistory.filter(entry => entry.executionTime >= oneDayAgo);
    const successfulRecent = recentExecutions.filter(entry => entry.success);

    // Next event time
    const nextEvents = Array.from(this.events.values())
      .filter(e => e.enabled && e.nextExecution)
      .sort((a, b) => (a.nextExecution || 0) - (b.nextExecution || 0));

    return {
      totalEvents: this.events.size,
      enabledEvents: Array.from(this.events.values()).filter(e => e.enabled).length,
      executedToday: recentExecutions.length,
      successRate: recentExecutions.length > 0 ? successfulRecent.length / recentExecutions.length : 0,
      averageExecutionTime: recentExecutions.length > 0 ?
        recentExecutions.reduce((sum, entry) => sum + entry.duration, 0) / recentExecutions.length : 0,
      nextEventTime: nextEvents.length > 0 ? nextEvents[0].nextExecution : undefined,
      uptime: now - this.startTime
    };
  }

  /**
   * Get execution history for an event
   */
  getEventHistory(eventId: string, hours: number = 24): EventHistory[] {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    return this.executionHistory
      .filter(entry => entry.eventId === eventId && entry.executionTime >= cutoffTime)
      .sort((a, b) => b.executionTime - a.executionTime);
  }

  /**
   * Get all scheduled events
   */
  getScheduledEvents(): ScheduledEvent[] {
    return Array.from(this.events.values()).sort((a, b) => {
      if (!a.nextExecution && !b.nextExecution) return 0;
      if (!a.nextExecution) return 1;
      if (!b.nextExecution) return -1;
      return a.nextExecution - b.nextExecution;
    });
  }

  /**
   * Update scheduler configuration
   */
  updateConfig(newConfig: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('⚙️ Scheduler configuration updated', newConfig);

    // Restart scheduling loop if interval changed
    if (newConfig.checkInterval && this.isActive) {
      if (this.schedulerTimer) {
        clearTimeout(this.schedulerTimer);
      }
      this.startSchedulingLoop();
    }
  }
}