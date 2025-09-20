/**
 * Alert System
 * Comprehensive alerting and notification system for trading events
 */

import { logger } from '../utils/logger';

export type AlertType =
  | 'price_movement'
  | 'volume_spike'
  | 'arbitrage_opportunity'
  | 'position_risk'
  | 'trade_execution'
  | 'system_error'
  | 'api_error'
  | 'slippage_high'
  | 'liquidity_low'
  | 'strategy_performance';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export type AlertChannel = 'console' | 'email' | 'webhook' | 'file' | 'database';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  timestamp: number;
  acknowledged: boolean;
  source?: string;
  tags?: string[];
  metadata?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  enabled: boolean;
  conditions: AlertCondition[];
  severity: AlertSeverity;
  channels: AlertChannel[];
  throttle?: ThrottleConfig;
  template?: AlertTemplate;
}

export interface AlertCondition {
  field: string;
  operator: 'gt' | 'lt' | 'eq' | 'ne' | 'contains' | 'matches';
  value: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  aggregation?: 'avg' | 'max' | 'min' | 'sum' | 'count';
  timeWindow?: number; // milliseconds
}

export interface ThrottleConfig {
  maxPerHour: number;
  maxPerDay: number;
  cooldownPeriod: number; // milliseconds
}

export interface AlertTemplate {
  title: string;
  message: string;
  variables: string[];
}

export interface NotificationChannel {
  type: AlertChannel;
  config: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  enabled: boolean;
  severityFilter: AlertSeverity[];
  typeFilter: AlertType[];
}

export interface AlertStats {
  total: number;
  byType: Record<AlertType, number>;
  bySeverity: Record<AlertSeverity, number>;
  acknowledged: number;
  unacknowledged: number;
  lastHour: number;
  lastDay: number;
}

export class AlertSystem {
  private alerts: Map<string, Alert> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private channels: Map<AlertChannel, NotificationChannel> = new Map();
  private throttleState: Map<string, { count: number; lastReset: number }> = new Map();

  private readonly MAX_ALERT_HISTORY = 10000;
  private readonly CLEANUP_INTERVAL = 3600000; // 1 hour
  private cleanupTimer?: NodeJS.Timeout;

  constructor(startCleanupTimer: boolean = true) {
    this.initializeDefaultRules();
    this.initializeDefaultChannels();
    if (startCleanupTimer) {
      this.startCleanupTimer();
    }
    logger.info('Alert System initialized');
  }

  /**
   * Create and process a new alert
   */
  async createAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    data?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    source?: string
  ): Promise<string> {
    const alertId = this.generateAlertId();

    const alert: Alert = {
      id: alertId,
      type,
      severity,
      title,
      message,
      data,
      timestamp: Date.now(),
      acknowledged: false,
      source,
      tags: this.generateTags(type, severity),
      metadata: {
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0', // Could be loaded from package.json
      },
    };

    // Store alert
    this.alerts.set(alertId, alert);

    // Log alert
    this.logAlert(alert);

    // Check if we should send notifications
    if (this.shouldSendNotification(alert)) {
      await this.sendNotifications(alert);
    }

    // Cleanup old alerts if needed
    this.cleanupOldAlerts();

    return alertId;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    alert.metadata = {
      ...alert.metadata,
      acknowledgedBy,
      acknowledgedAt: Date.now(),
    };

    this.alerts.set(alertId, alert);
    logger.info(`Alert acknowledged: ${alertId}`, { acknowledgedBy });

    return true;
  }

  /**
   * Get alert by ID
   */
  getAlert(alertId: string): Alert | null {
    return this.alerts.get(alertId) || null;
  }

  /**
   * Get alerts with filtering
   */
  getAlerts(filter?: {
    type?: AlertType;
    severity?: AlertSeverity;
    acknowledged?: boolean;
    since?: number;
    limit?: number;
  }): Alert[] {
    let alerts = Array.from(this.alerts.values());

    // Apply filters
    if (filter) {
      if (filter.type) {
        alerts = alerts.filter(a => a.type === filter.type);
      }
      if (filter.severity) {
        alerts = alerts.filter(a => a.severity === filter.severity);
      }
      if (filter.acknowledged !== undefined) {
        alerts = alerts.filter(a => a.acknowledged === filter.acknowledged);
      }
      if (filter.since) {
        alerts = alerts.filter(a => a.timestamp >= filter.since!);
      }
    }

    // Sort by timestamp (newest first)
    alerts.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    if (filter?.limit) {
      alerts = alerts.slice(0, filter.limit);
    }

    return alerts;
  }

  /**
   * Get alert statistics
   */
  getStats(): AlertStats {
    const alerts = Array.from(this.alerts.values());
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    const stats: AlertStats = {
      total: alerts.length,
      byType: {} as Record<AlertType, number>,
      bySeverity: {} as Record<AlertSeverity, number>,
      acknowledged: alerts.filter(a => a.acknowledged).length,
      unacknowledged: alerts.filter(a => !a.acknowledged).length,
      lastHour: alerts.filter(a => a.timestamp >= oneHourAgo).length,
      lastDay: alerts.filter(a => a.timestamp >= oneDayAgo).length,
    };

    // Count by type
    alerts.forEach(alert => {
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
    });

    return stats;
  }

  /**
   * Add or update alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logger.info(`Alert rule added: ${rule.name}`, { type: rule.type, severity: rule.severity });
  }

  /**
   * Remove alert rule
   */
  removeRule(ruleId: string): boolean {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      logger.info(`Alert rule removed: ${ruleId}`);
    }
    return deleted;
  }

  /**
   * Configure notification channel
   */
  configureChannel(channel: NotificationChannel): void {
    this.channels.set(channel.type, channel);
    logger.info(`Notification channel configured: ${channel.type}`, { enabled: channel.enabled });
  }

  /**
   * Quick alert methods for common scenarios
   */
  async priceAlert(token: string, currentPrice: number, change: number): Promise<string> {
    const severity: AlertSeverity = Math.abs(change) > 10 ? 'critical' :
                                   Math.abs(change) > 5 ? 'error' :
                                   Math.abs(change) > 2 ? 'warning' : 'info';

    return this.createAlert(
      'price_movement',
      severity,
      `Price Alert: ${token}`,
      `${token} price moved ${change > 0 ? '+' : ''}${change.toFixed(2)}% to $${currentPrice.toFixed(4)}`,
      { token, currentPrice, change },
      'price_tracker'
    );
  }

  async arbitrageAlert(opportunity: any): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.createAlert(
      'arbitrage_opportunity',
      'info',
      'Arbitrage Opportunity Detected',
      `Profitable arbitrage found: ${opportunity.profitPercent.toFixed(2)}% profit potential`,
      opportunity,
      'arbitrage_strategy'
    );
  }

  async riskAlert(riskType: string, details: any): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.createAlert(
      'position_risk',
      'warning',
      `Risk Alert: ${riskType}`,
      `Risk management trigger activated: ${riskType}`,
      details,
      'risk_manager'
    );
  }

  async tradeAlert(trade: any, success: boolean): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.createAlert(
      'trade_execution',
      success ? 'info' : 'error',
      `Trade ${success ? 'Executed' : 'Failed'}`,
      success ?
        `Successfully executed trade: ${trade.amount} ${trade.tokenIn} → ${trade.tokenOut}` :
        `Trade execution failed: ${trade.error}`,
      trade,
      'trading_engine'
    );
  }

  async systemAlert(component: string, error: any): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.createAlert(
      'system_error',
      'error',
      `System Error: ${component}`,
      `Error in ${component}: ${error.message || error}`,
      { error: error.stack || error.toString(), component },
      component
    );
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_price_movement',
        name: 'High Price Movement',
        type: 'price_movement',
        enabled: true,
        conditions: [
          { field: 'change', operator: 'gt', value: 5 }
        ],
        severity: 'warning',
        channels: ['console', 'file'],
        throttle: { maxPerHour: 10, maxPerDay: 50, cooldownPeriod: 300000 }
      },
      {
        id: 'critical_system_error',
        name: 'Critical System Error',
        type: 'system_error',
        enabled: true,
        conditions: [
          { field: 'severity', operator: 'eq', value: 'critical' }
        ],
        severity: 'critical',
        channels: ['console', 'file'],
        throttle: { maxPerHour: 5, maxPerDay: 20, cooldownPeriod: 600000 }
      }
    ];

    defaultRules.forEach(rule => this.addRule(rule));
  }

  /**
   * Initialize default notification channels
   */
  private initializeDefaultChannels(): void {
    // Console channel
    this.configureChannel({
      type: 'console',
      config: {},
      enabled: true,
      severityFilter: ['info', 'warning', 'error', 'critical'],
      typeFilter: [],
    });

    // File channel
    this.configureChannel({
      type: 'file',
      config: { path: './logs/alerts.log' },
      enabled: true,
      severityFilter: ['warning', 'error', 'critical'],
      typeFilter: [],
    });
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate tags for an alert
   */
  private generateTags(type: AlertType, severity: AlertSeverity): string[] {
    const tags: string[] = [type, severity];

    // Add contextual tags
    if (type.includes('trade')) tags.push('trading');
    if (type.includes('price')) tags.push('market');
    if (type.includes('system')) tags.push('infrastructure');
    if (severity === 'critical' || severity === 'error') tags.push('urgent');

    return tags;
  }

  /**
   * Log alert to logger
   */
  private logAlert(alert: Alert): void {
    const logLevel = this.severityToLogLevel(alert.severity);
    const message = `[${alert.type.toUpperCase()}] ${alert.title}: ${alert.message}`;

    switch (logLevel) {
      case 'info':
        logger.info(message, { alertId: alert.id, data: alert.data });
        break;
      case 'warn':
        logger.warn(message, { alertId: alert.id, data: alert.data });
        break;
      case 'error':
        logger.error(message, { alertId: alert.id, data: alert.data });
        break;
    }
  }

  /**
   * Convert alert severity to log level
   */
  private severityToLogLevel(severity: AlertSeverity): 'info' | 'warn' | 'error' {
    switch (severity) {
      case 'info': return 'info';
      case 'warning': return 'warn';
      case 'error':
      case 'critical': return 'error';
    }
  }

  /**
   * Check if notification should be sent based on throttling
   */
  private shouldSendNotification(alert: Alert): boolean {
    const rule = Array.from(this.rules.values()).find(r =>
      r.type === alert.type && r.enabled
    );

    if (!rule || !rule.throttle) return true;

    const throttleKey = `${alert.type}_${alert.severity}`;
    const now = Date.now();
    const state = this.throttleState.get(throttleKey) || { count: 0, lastReset: now };

    // Reset counters if needed
    if (now - state.lastReset > 3600000) { // 1 hour
      state.count = 0;
      state.lastReset = now;
    }

    // Check throttle limits
    if (state.count >= rule.throttle.maxPerHour) {
      return false;
    }

    // Update state
    state.count++;
    this.throttleState.set(throttleKey, state);

    return true;
  }

  /**
   * Send notifications through configured channels
   */
  private async sendNotifications(alert: Alert): Promise<void> {
    const channels = Array.from(this.channels.values()).filter(channel =>
      channel.enabled &&
      (channel.severityFilter.length === 0 || channel.severityFilter.includes(alert.severity)) &&
      (channel.typeFilter.length === 0 || channel.typeFilter.includes(alert.type))
    );

    const notifications = channels.map(channel =>
      this.sendNotification(channel, alert).catch(error =>
        logger.error(`Failed to send notification via ${channel.type}:`, error)
      )
    );

    await Promise.allSettled(notifications);
  }

  /**
   * Send notification through a specific channel
   */
  private async sendNotification(channel: NotificationChannel, alert: Alert): Promise<void> {
    switch (channel.type) {
      case 'console':
        await this.sendConsoleNotification(alert);
        break;
      case 'file':
        await this.sendFileNotification(alert, channel.config);
        break;
      case 'email':
        await this.sendEmailNotification(alert, channel.config);
        break;
      case 'webhook':
        await this.sendWebhookNotification(alert, channel.config);
        break;
      case 'database':
        await this.sendDatabaseNotification(alert, channel.config);
        break;
    }
  }

  /**
   * Send console notification
   */
  private async sendConsoleNotification(alert: Alert): Promise<void> {
    const emoji = this.getSeverityEmoji(alert.severity);
    console.log(`${emoji} ${alert.title}: ${alert.message}`); // eslint-disable-line no-console
  }

  /**
   * Send file notification
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendFileNotification(alert: Alert, config: any): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    // This would write to a file in a real implementation
    logger.info(`File notification: ${alert.title}`, alert);
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(alert: Alert, config: any): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    // This would send an email in a real implementation
    logger.info(`Email notification: ${alert.title}`, { to: config.to });
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(alert: Alert, config: any): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    // This would send a webhook in a real implementation
    logger.info(`Webhook notification: ${alert.title}`, { url: config.url });
  }

  /**
   * Send database notification
   */
  private async sendDatabaseNotification(alert: Alert, config: any): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    // This would insert into database in a real implementation
    logger.info(`Database notification: ${alert.title}`, { table: config.table });
  }

  /**
   * Get emoji for severity level
   */
  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case 'info': return 'ℹ️';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      case 'critical': return '🚨';
    }
  }

  /**
   * Clean up old alerts
   */
  private cleanupOldAlerts(): void {
    if (this.alerts.size <= this.MAX_ALERT_HISTORY) return;

    const alerts = Array.from(this.alerts.entries())
      .sort(([, a], [, b]) => b.timestamp - a.timestamp);

    // Keep only the most recent alerts
    const toKeep = alerts.slice(0, this.MAX_ALERT_HISTORY);
    this.alerts.clear();

    toKeep.forEach(([id, alert]) => {
      this.alerts.set(id, alert);
    });

    logger.debug(`Cleaned up old alerts, kept ${toKeep.length} most recent`);
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldAlerts();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Stop cleanup timer and cleanup resources
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}