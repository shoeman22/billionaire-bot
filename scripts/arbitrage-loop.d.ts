#!/usr/bin/env tsx
/**
 * SMART ARBITRAGE LOOP CONTROLLER 🔄
 *
 * Controlled looping execution of arbitrage strategies with:
 * - Rate limit detection and exponential backoff
 * - Configurable delays between runs
 * - Clean shutdown handling
 * - Basic profit tracking
 * - Support for both single-pair and multi-pair modes
 */
interface LoopConfig {
    mode: 'full' | 'multi' | 'triangular' | 'cross-pair' | 'exotic-hunt';
    delayBetweenRuns: number;
    maxConsecutiveErrors: number;
    exponentialBackoffBase: number;
    maxBackoffDelay: number;
    maxRunDuration?: number;
}
declare class ArbitrageLoopController {
    private config;
    private stats;
    private isRunning;
    private shouldStop;
    private signalCount;
    constructor(config?: Partial<LoopConfig>);
    private setupSignalHandlers;
    start(): Promise<void>;
    private executeArbitrageRun;
    private isRateLimitError;
    private calculateDelay;
    private logStats;
    private logFinalStats;
    private sleep;
    stop(): void;
}
export { ArbitrageLoopController };
//# sourceMappingURL=arbitrage-loop.d.ts.map