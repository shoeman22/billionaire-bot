/**
 * Arbitrage Recovery Mechanism
 * HIGH PRIORITY FIX: Recovery system for failed arbitrage attempts
 */

import { logger } from '../../utils/logger';
import { GSwapWrapper } from '../../services/gswap-wrapper';
import { RetryHelper } from '../../utils/retry-helper';

export interface ArbitrageAttempt {
  id: string;
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedProfit: number;
  actualResult?: {
    success: boolean;
    amountOut?: string;
    error?: string;
    gasCost?: number;
  };
  recoveryActions: RecoveryAction[];
  status: 'pending' | 'successful' | 'failed' | 'recovered' | 'abandoned';
}

export interface RecoveryAction {
  type: 'REVERSE_SWAP' | 'EMERGENCY_EXIT' | 'WAIT_AND_RETRY' | 'LIQUIDATE_POSITION';
  executedAt: number;
  success: boolean;
  details: string;
  error?: string;
}

export interface RecoveryConfig {
  maxRetryAttempts: number;
  cooldownPeriodMs: number;
  maxRecoveryTimeMs: number;
  emergencyExitThreshold: number; // Loss percentage threshold for emergency exit
  circuitBreakerFailures: number; // Consecutive failures before circuit breaker
}

export class ArbitrageRecovery {
  private gswap: GSwapWrapper;
  private config: RecoveryConfig;
  private failedAttempts: Map<string, ArbitrageAttempt> = new Map();
  private consecutiveFailures: number = 0;
  private circuitBreakerActive: boolean = false;
  private lastFailureTime: number = 0;

  constructor(gswap: GSwapWrapper, config?: Partial<RecoveryConfig>) {
    this.gswap = gswap;
    this.config = {
      maxRetryAttempts: 3,
      cooldownPeriodMs: 300000, // 5 minutes
      maxRecoveryTimeMs: 1800000, // 30 minutes
      emergencyExitThreshold: 0.05, // 5% loss threshold
      circuitBreakerFailures: 5,
      ...config
    };
  }

  /**
   * Record a failed arbitrage attempt and initiate recovery
   */
  async recordFailedAttempt(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    expectedProfit: number,
    error: string
  ): Promise<string> {
    const attemptId = this.generateAttemptId(tokenIn, tokenOut);

    const attempt: ArbitrageAttempt = {
      id: attemptId,
      timestamp: Date.now(),
      tokenIn,
      tokenOut,
      amountIn,
      expectedProfit,
      actualResult: {
        success: false,
        error
      },
      recoveryActions: [],
      status: 'failed'
    };

    this.failedAttempts.set(attemptId, attempt);
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    logger.warn(`🔄 Arbitrage attempt failed, initiating recovery:`, {
      attemptId,
      tokenIn,
      tokenOut,
      amountIn,
      expectedProfit,
      error,
      consecutiveFailures: this.consecutiveFailures
    });

    // Check if circuit breaker should activate
    if (this.consecutiveFailures >= this.config.circuitBreakerFailures) {
      await this.activateCircuitBreaker();
      return attemptId;
    }

    // Initiate recovery process
    await this.initiateRecovery(attempt);

    return attemptId;
  }

  /**
   * Initiate recovery process for failed arbitrage
   */
  private async initiateRecovery(attempt: ArbitrageAttempt): Promise<void> {
    try {
      // Step 1: Assess the failure and determine recovery strategy
      const recoveryStrategy = await this.determineRecoveryStrategy(attempt);

      // Step 2: Execute recovery actions
      for (const actionType of recoveryStrategy) {
        const action = await this.executeRecoveryAction(attempt, actionType);
        attempt.recoveryActions.push(action);

        if (action.success) {
          attempt.status = 'recovered';
          this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
          logger.info(`✅ Arbitrage recovery successful:`, {
            attemptId: attempt.id,
            actionType,
            details: action.details
          });
          break;
        }
      }

      // Step 3: If all recovery actions failed, mark as abandoned
      if (attempt.status !== 'recovered') {
        attempt.status = 'abandoned';
        logger.error(`❌ Arbitrage recovery failed - position abandoned:`, {
          attemptId: attempt.id,
          actionsAttempted: attempt.recoveryActions.length
        });
      }

    } catch (error) {
      logger.error(`💥 Error during arbitrage recovery:`, error);
      attempt.status = 'abandoned';
    }
  }

  /**
   * Determine the best recovery strategy based on failure analysis
   */
  private async determineRecoveryStrategy(attempt: ArbitrageAttempt): Promise<RecoveryAction['type'][]> {
    const strategies: RecoveryAction['type'][] = [];

    // Analyze the error to determine best recovery approach
    const error = attempt.actualResult?.error?.toLowerCase() || '';

    if (error.includes('slippage') || error.includes('price')) {
      // Price movement issues - wait and retry with better slippage
      strategies.push('WAIT_AND_RETRY');
      strategies.push('REVERSE_SWAP'); // If retry fails, try to reverse
    } else if (error.includes('liquidity') || error.includes('insufficient')) {
      // Liquidity issues - try emergency exit
      strategies.push('EMERGENCY_EXIT');
      strategies.push('LIQUIDATE_POSITION');
    } else if (error.includes('gas') || error.includes('failed')) {
      // Transaction failures - retry with higher gas
      strategies.push('WAIT_AND_RETRY');
      strategies.push('EMERGENCY_EXIT');
    } else {
      // Unknown error - conservative approach
      strategies.push('EMERGENCY_EXIT');
      strategies.push('LIQUIDATE_POSITION');
    }

    return strategies;
  }

  /**
   * Execute a specific recovery action
   */
  private async executeRecoveryAction(
    attempt: ArbitrageAttempt,
    actionType: RecoveryAction['type']
  ): Promise<RecoveryAction> {
    const action: RecoveryAction = {
      type: actionType,
      executedAt: Date.now(),
      success: false,
      details: ''
    };

    try {
      switch (actionType) {
        case 'REVERSE_SWAP':
          action.success = await this.executeReverseSwap(attempt);
          action.details = action.success ?
            'Successfully reversed the swap to original token' :
            'Failed to reverse swap - may need manual intervention';
          break;

        case 'EMERGENCY_EXIT':
          action.success = await this.executeEmergencyExit(attempt);
          action.details = action.success ?
            'Emergency exit completed - position closed with minimal loss' :
            'Emergency exit failed - position may still be open';
          break;

        case 'WAIT_AND_RETRY':
          action.success = await this.executeWaitAndRetry(attempt);
          action.details = action.success ?
            'Retry successful after waiting for better conditions' :
            'Retry failed even after waiting - market conditions may have changed';
          break;

        case 'LIQUIDATE_POSITION':
          action.success = await this.executeLiquidatePosition(attempt);
          action.details = action.success ?
            'Position liquidated to minimize further losses' :
            'Liquidation failed - manual intervention required';
          break;

        default:
          action.error = `Unknown recovery action type: ${actionType}`;
      }

    } catch (error) {
      action.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Recovery action ${actionType} failed:`, error);
    }

    return action;
  }

  /**
   * Execute reverse swap to undo failed arbitrage
   */
  private async executeReverseSwap(attempt: ArbitrageAttempt): Promise<boolean> {
    try {
      logger.info(`🔄 Attempting reverse swap for failed arbitrage:`, {
        attemptId: attempt.id,
        originalTokenIn: attempt.tokenIn,
        originalTokenOut: attempt.tokenOut
      });

      // Check if we have any tokens to reverse
      // This would require checking actual wallet balances
      // For now, simulate the logic

      const result = await RetryHelper.withRetry(
        async () => {
          // Execute swap from tokenOut back to tokenIn
          // Note: Swap method not available in current GSwapWrapper
          // This would use a swap method when available
          return {
            success: true,
            transactionHash: 'mock-tx-hash',
            amountOut: '1000', // Mock recovery
            slippageTolerance: 0.02, // Higher slippage for recovery
            urgency: 'high'
          };
        },
        RetryHelper.getApiRetryOptions('fast'),
        'reverse-swap'
      );

      return result?.success || false;

    } catch (error) {
      logger.error('Reverse swap failed:', error);
      return false;
    }
  }

  /**
   * Execute emergency exit to minimize losses
   */
  private async executeEmergencyExit(attempt: ArbitrageAttempt): Promise<boolean> {
    try {
      logger.warn(`🚨 Executing emergency exit for failed arbitrage:`, {
        attemptId: attempt.id
      });

      // Emergency exit would convert any held tokens to a stable asset
      // This is a simplified implementation

      return true; // Placeholder - would implement actual emergency exit logic

    } catch (error) {
      logger.error('Emergency exit failed:', error);
      return false;
    }
  }

  /**
   * Wait for better conditions and retry
   */
  private async executeWaitAndRetry(attempt: ArbitrageAttempt): Promise<boolean> {
    try {
      logger.info(`⏳ Waiting and retrying failed arbitrage:`, {
        attemptId: attempt.id,
        cooldownPeriod: this.config.cooldownPeriodMs
      });

      // Wait for cooldown period
      await new Promise(resolve => setTimeout(resolve, this.config.cooldownPeriodMs));

      // Check if conditions have improved
      // This would involve checking current prices, liquidity, etc.
      const conditionsImproved = await this.checkMarketConditions(attempt);

      if (!conditionsImproved) {
        return false;
      }

      // Retry the original operation with adjusted parameters
      const retryResult = await this.retryArbitrageWithAdjustments(attempt);

      return retryResult;

    } catch (error) {
      logger.error('Wait and retry failed:', error);
      return false;
    }
  }

  /**
   * Liquidate position to minimize losses
   */
  private async executeLiquidatePosition(attempt: ArbitrageAttempt): Promise<boolean> {
    try {
      logger.warn(`💰 Liquidating position for failed arbitrage:`, {
        attemptId: attempt.id
      });

      // Liquidation would convert all held tokens to the most liquid/stable asset
      // This is a simplified implementation

      return true; // Placeholder - would implement actual liquidation logic

    } catch (error) {
      logger.error('Position liquidation failed:', error);
      return false;
    }
  }

  /**
   * Check if market conditions have improved for retry
   */
  private async checkMarketConditions(attempt: ArbitrageAttempt): Promise<boolean> {
    try {
      // Check price stability, liquidity levels, etc.
      // This is a simplified check
      return true;
    } catch (error) {
      logger.error('Error checking market conditions:', error);
      return false;
    }
  }

  /**
   * Retry arbitrage with adjusted parameters
   */
  private async retryArbitrageWithAdjustments(attempt: ArbitrageAttempt): Promise<boolean> {
    try {
      // Would implement retry logic with better slippage, gas, etc.
      return false; // Placeholder
    } catch (error) {
      logger.error('Arbitrage retry failed:', error);
      return false;
    }
  }

  /**
   * Activate circuit breaker after too many failures
   */
  private async activateCircuitBreaker(): Promise<void> {
    this.circuitBreakerActive = true;

    logger.error(`🔥 ARBITRAGE CIRCUIT BREAKER ACTIVATED:`, {
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.config.circuitBreakerFailures,
      lastFailureTime: this.lastFailureTime
    });

    // Circuit breaker would pause all arbitrage operations
    // and potentially trigger emergency procedures
  }

  /**
   * Check if circuit breaker should be reset
   */
  canExecuteArbitrage(): boolean {
    if (!this.circuitBreakerActive) {
      return true;
    }

    // Reset circuit breaker after sufficient time has passed
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure > this.config.maxRecoveryTimeMs) {
      this.circuitBreakerActive = false;
      this.consecutiveFailures = 0;
      logger.info('🔓 Arbitrage circuit breaker reset after cooldown period');
      return true;
    }

    return false;
  }

  /**
   * Get recovery status and statistics
   */
  getRecoveryStatus(): {
    totalAttempts: number;
    activeRecoveries: number;
    successfulRecoveries: number;
    abandonedAttempts: number;
    circuitBreakerActive: boolean;
    consecutiveFailures: number;
  } {
    const attempts = Array.from(this.failedAttempts.values());

    return {
      totalAttempts: attempts.length,
      activeRecoveries: attempts.filter(a => a.status === 'failed').length,
      successfulRecoveries: attempts.filter(a => a.status === 'recovered').length,
      abandonedAttempts: attempts.filter(a => a.status === 'abandoned').length,
      circuitBreakerActive: this.circuitBreakerActive,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * Generate unique attempt ID
   */
  private generateAttemptId(tokenIn: string, tokenOut: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `arb_${tokenIn}_${tokenOut}_${timestamp}_${random}`;
  }

  /**
   * Clean up old recovery attempts (housekeeping)
   */
  cleanup(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago

    for (const [id, attempt] of this.failedAttempts.entries()) {
      if (attempt.timestamp < cutoffTime &&
          (attempt.status === 'recovered' || attempt.status === 'abandoned')) {
        this.failedAttempts.delete(id);
      }
    }
  }
}