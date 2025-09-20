/**
 * Logging Utilities
 * Centralized logging system with multiple levels and security considerations
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
  source?: string;
}

class Logger {
  private logLevel: LogLevel;
  private logHistory: LogEntry[] = [];
  private readonly maxHistorySize = 1000;

  constructor() {
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  /**
   * Set the logging level
   */
  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Get current logging level
   */
  getLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    return levels[level] >= levels[this.logLevel];
  }

  /**
   * Sanitize sensitive data for logging
   */
  private sanitizeData(data: any): any {
    if (!data) return data;

    // Handle different data types
    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }

    if (typeof data === 'object') {
      const sanitized: any = {};

      for (const [key, value] of Object.entries(data)) {
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitizeData(value);
        }
      }

      return sanitized;
    }

    return data;
  }

  /**
   * Check if a key contains sensitive information
   */
  private isSensitiveKey(key: string): boolean {
    const sensitivePatterns = [
      'password',
      'secret',
      'private',
      'key',
      'token',
      'auth',
      'credential',
      'wallet',
      'mnemonic',
      'seed',
    ];

    const lowerKey = key.toLowerCase();
    return sensitivePatterns.some(pattern => lowerKey.includes(pattern));
  }

  /**
   * Sanitize sensitive information from strings
   */
  private sanitizeString(str: string): string {
    // Redact private keys (base64 pattern)
    str = str.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[REDACTED_KEY]');

    // Redact wallet addresses (starts with 0x)
    str = str.replace(/0x[a-fA-F0-9]{40}/g, '0x[REDACTED_ADDRESS]');

    // Redact other potential sensitive data
    str = str.replace(/\b[A-Za-z0-9]{32,}\b/g, '[REDACTED_TOKEN]');

    return str;
  }

  /**
   * Create a log entry
   */
  private createLogEntry(level: LogLevel, message: string, data?: any): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: this.sanitizeString(message),
      source: this.getCallerInfo(),
    };

    if (data !== undefined) {
      entry.data = this.sanitizeData(data);
    }

    return entry;
  }

  /**
   * Get caller information for debugging
   */
  private getCallerInfo(): string {
    try {
      const stack = new Error().stack;
      if (!stack) return 'unknown';

      const stackLines = stack.split('\n');
      // Skip Error, createLogEntry, and the actual log method
      const callerLine = stackLines[4];

      if (callerLine) {
        const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
        if (match) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const [, functionName, filePath, line] = match;
          const fileName = filePath.split('/').pop() || filePath;
          return `${fileName}:${line}`;
        }
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Add log entry to history
   */
  private addToHistory(entry: LogEntry): void {
    this.logHistory.push(entry);

    // Maintain history size limit
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory = this.logHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Format log entry for console output
   */
  private formatLogEntry(entry: LogEntry): string {
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    };

    const reset = '\x1b[0m';
    const color = levelColors[entry.level];

    let output = `${color}[${entry.timestamp}] ${entry.level.toUpperCase()}${reset}: ${entry.message}`;

    if (entry.source) {
      output += ` (${entry.source})`;
    }

    if (entry.data !== undefined) {
      output += '\n' + JSON.stringify(entry.data, null, 2);
    }

    return output;
  }

  /**
   * Output log entry
   */
  private output(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    // Add to history
    this.addToHistory(entry);

    // Console output
    const formatted = this.formatLogEntry(entry);

    switch (entry.level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'debug':
        console.debug(formatted);
        break;
    }
  }

  /**
   * Debug level logging
   */
  debug(message: string, data?: any): void {
    const entry = this.createLogEntry('debug', message, data);
    this.output(entry);
  }

  /**
   * Info level logging
   */
  info(message: string, data?: any): void {
    const entry = this.createLogEntry('info', message, data);
    this.output(entry);
  }

  /**
   * Warning level logging
   */
  warn(message: string, data?: any): void {
    const entry = this.createLogEntry('warn', message, data);
    this.output(entry);
  }

  /**
   * Error level logging
   */
  error(message: string, error?: any): void {
    let errorData = error;

    // Format Error objects
    if (error instanceof Error) {
      errorData = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    const entry = this.createLogEntry('error', message, errorData);
    this.output(entry);
  }

  /**
   * Get recent log history
   */
  getHistory(count?: number): LogEntry[] {
    const entries = this.logHistory.slice();
    return count ? entries.slice(-count) : entries;
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Log trading activity (special method with extra context)
   */
  trade(message: string, data?: any): void {
    const tradeEntry = this.createLogEntry('info', `[TRADE] ${message}`, {
      ...data,
      timestamp: Date.now(),
      type: 'trading_activity',
    });

    this.output(tradeEntry);
  }

  /**
   * Log security events (high priority)
   */
  security(message: string, data?: any): void {
    const securityEntry = this.createLogEntry('warn', `[SECURITY] ${message}`, {
      ...data,
      timestamp: Date.now(),
      type: 'security_event',
    });

    this.output(securityEntry);
  }

  /**
   * Log performance metrics
   */
  performance(message: string, metrics?: any): void {
    const perfEntry = this.createLogEntry('info', `[PERF] ${message}`, {
      ...metrics,
      timestamp: Date.now(),
      type: 'performance',
    });

    this.output(perfEntry);
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, any>): Logger {
    const childLogger = new Logger();
    childLogger.setLevel(this.logLevel);

    // Override output to include context
    const originalOutput = childLogger.output.bind(childLogger);
    childLogger.output = (entry: LogEntry) => {
      entry.data = {
        ...context,
        ...entry.data,
      };
      originalOutput(entry);
    };

    return childLogger;
  }
}

// Export singleton logger instance
export const logger = new Logger();

// Export logger class for creating specialized instances
export { Logger };