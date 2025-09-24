/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by temporarily disabling operations
 * when failure rates exceed thresholds. Essential for production
 * DeFi applications to avoid losing funds during API/network outages.
 */

import { logger } from './logger';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Number of successes to close circuit
  timeout: number;              // Time in ms before attempting reset
  monitoringWindow: number;     // Time window for failure tracking
}

export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation
  OPEN = 'OPEN',           // Blocking all requests
  HALF_OPEN = 'HALF_OPEN'  // Testing if service recovered
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public state: CircuitState) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker for protecting against API failures
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttemptTime: number = 0;
  private lastFailureTime: number = 0;
  private failures: number[] = []; // Timestamps of failures for monitoring window

  constructor(
    private config: CircuitBreakerConfig,
    private name: string = 'CircuitBreaker'
  ) {
    logger.info(`🔧 ${this.name} initialized: ${config.failureThreshold} failures, ${config.timeout}ms timeout`);
  }

  /**
   * Execute an operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new CircuitBreakerError(
          `${this.name} circuit is OPEN. Next attempt allowed in ${this.nextAttemptTime - Date.now()}ms`,
          CircuitState.OPEN
        );
      } else {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info(`🔄 ${this.name} circuit transitioning to HALF_OPEN for testing`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.successCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successCount >= this.config.successThreshold) {
        this.reset();
        logger.info(`✅ ${this.name} circuit CLOSED after ${this.successCount} successful operations`);
      }
    } else {
      // In CLOSED state, reset failure count on success
      this.failureCount = 0;
      this.failures = [];
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    const now = Date.now();
    this.failureCount++;
    this.lastFailureTime = now;
    this.failures.push(now);

    // Clean old failures outside monitoring window
    const windowStart = now - this.config.monitoringWindow;
    this.failures = this.failures.filter(timestamp => timestamp > windowStart);

    logger.warn(`⚠️ ${this.name} failure #${this.failureCount} (${this.failures.length} in window)`);

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in HALF_OPEN state reopens the circuit
      this.openCircuit();
      logger.warn(`🔴 ${this.name} circuit REOPENED due to failure during testing`);
    } else if (this.failures.length >= this.config.failureThreshold) {
      // Too many failures in the monitoring window
      this.openCircuit();
      logger.error(`🚨 ${this.name} circuit OPENED due to ${this.failures.length} failures in ${this.config.monitoringWindow}ms`);
    }
  }

  /**
   * Open the circuit (block all requests)
   */
  private openCircuit(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.config.timeout;
    this.successCount = 0;
  }

  /**
   * Reset circuit to closed state
   */
  private reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
    this.failures = [];
  }

  /**
   * Force circuit to specific state (for testing)
   */
  public forceState(state: CircuitState): void {
    logger.warn(`🔧 ${this.name} circuit forced to ${state} state`);
    this.state = state;
    if (state === CircuitState.OPEN) {
      this.nextAttemptTime = Date.now() + this.config.timeout;
    }
  }

  /**
   * Get current circuit status
   */
  public getStatus() {
    const now = Date.now();
    const failuresInWindow = this.failures.filter(timestamp =>
      timestamp > now - this.config.monitoringWindow
    ).length;

    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failuresInWindow,
      nextAttemptTime: this.nextAttemptTime,
      lastFailureTime: this.lastFailureTime,
      timeUntilNextAttempt: this.state === CircuitState.OPEN
        ? Math.max(0, this.nextAttemptTime - now)
        : 0
    };
  }

  /**
   * Check if circuit allows requests
   */
  public canExecute(): boolean {
    if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      return Date.now() >= this.nextAttemptTime;
    }

    return false;
  }
}

/**
 * Pre-configured circuit breakers for common use cases
 */
export class CircuitBreakerFactory {
  /**
   * Create circuit breaker for GalaSwap API calls
   */
  static createGalaSwapCircuitBreaker(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: 5,        // 5 failures
      successThreshold: 3,        // 3 successes to recover
      timeout: 30000,            // 30 second cooldown
      monitoringWindow: 60000    // 1 minute monitoring window
    }, 'GalaSwap-API');
  }

  /**
   * Create circuit breaker for quote operations (more sensitive)
   */
  static createQuoteCircuitBreaker(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: 3,        // 3 failures
      successThreshold: 2,        // 2 successes to recover
      timeout: 15000,            // 15 second cooldown
      monitoringWindow: 30000    // 30 second monitoring window
    }, 'Quote-API');
  }

  /**
   * Create circuit breaker for swap execution (very sensitive)
   */
  static createSwapCircuitBreaker(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: 2,        // 2 failures
      successThreshold: 3,        // 3 successes to recover
      timeout: 60000,            // 1 minute cooldown
      monitoringWindow: 120000   // 2 minute monitoring window
    }, 'Swap-Execution');
  }

  /**
   * Create circuit breaker for transaction monitoring
   */
  static createTransactionCircuitBreaker(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: 4,        // 4 failures
      successThreshold: 2,        // 2 successes to recover
      timeout: 20000,            // 20 second cooldown
      monitoringWindow: 45000    // 45 second monitoring window
    }, 'Transaction-Monitor');
  }
}

/**
 * Global circuit breaker manager
 */
export class CircuitBreakerManager {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Register a circuit breaker
   */
  static register(name: string, breaker: CircuitBreaker): void {
    this.breakers.set(name, breaker);
    logger.info(`🔧 Circuit breaker '${name}' registered`);
  }

  /**
   * Get circuit breaker by name
   */
  static get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get all circuit breaker statuses
   */
  static getAllStatus() {
    const statuses: Record<string, ReturnType<CircuitBreaker['getStatus']>> = {};

    this.breakers.forEach((breaker, name) => {
      statuses[name] = breaker.getStatus();
    });

    return statuses;
  }

  /**
   * Reset all circuit breakers
   */
  static resetAll(): void {
    this.breakers.forEach((breaker, name) => {
      breaker.forceState(CircuitState.CLOSED);
      logger.info(`🔄 Circuit breaker '${name}' reset`);
    });
  }

  /**
   * Get health summary
   */
  static getHealthSummary() {
    const statuses = this.getAllStatus();
    const total = Object.keys(statuses).length;
    const open = Object.values(statuses).filter(s => s.state === CircuitState.OPEN).length;
    const halfOpen = Object.values(statuses).filter(s => s.state === CircuitState.HALF_OPEN).length;
    const closed = total - open - halfOpen;

    return {
      total,
      closed,
      halfOpen,
      open,
      healthy: open === 0,
      degraded: halfOpen > 0 || open > 0,
      critical: open >= total / 2
    };
  }
}