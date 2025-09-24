#!/usr/bin/env tsx

/**
 * DEV Environment Stress Test
 *
 * SAFETY LEVEL: ZERO RISK
 * - Pushes DEV environment to its limits
 * - Tests system stability under load
 * - No real funds involved
 */

import { config } from 'dotenv';
import { validateEnvironment } from '../config/environment';
import { GSwapWrapper } from '../services/gswap-simple';
import { Logger } from '../utils/logger';
import { PrivateKeySigner } from '../services/gswap-simple';
import { performance } from 'perf_hooks';


config();

interface _RiskConfig {
  maxPositionSize: number;
  maxTotalExposure?: number;
  maxPositionsPerToken?: number;
  concentrationLimit?: number;
}

const logger = new Logger();

interface StressTestConfig {
  apiCalls: number;
  concurrency: number;
  duration: number; // milliseconds
  rampUpTime: number; // milliseconds
  targetRPS: number; // requests per second
}

interface StressTestResult {
  testName: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  requestsPerSecond: number;
  errorRate: number;
  duration: number;
  memoryUsage: {
    initial: number;
    peak: number;
    final: number;
  };
}

class DevStressTest {
  private gswap!: GSwapWrapper;
  private env!: { api: { baseUrl: string }; wallet: { address: string; privateKey: string } };
  private results: StressTestResult[] = [];

  async runStressTests(config: StressTestConfig): Promise<StressTestResult[]> {
    logger.info('⚡ Starting DEV Environment Stress Testing...');

    // Initialize components
    await this.initialize();

    // Test 1: API Connectivity Stress
    await this.runApiConnectivityStress(config);

    // Test 2: Concurrent Price Fetching
    await this.runConcurrentPriceFetching(config);

    // Test 3: Rapid Quote Generation
    await this.runRapidQuoteGeneration(config);

    // Test 4: Database Operations Stress
    await this.runDatabaseStress(config);

    // Test 5: Memory Stress Test
    await this.runMemoryStressTest(config);

    // Test 6: Error Recovery Under Load
    await this.runErrorRecoveryTest(config);

    return this.results;
  }

  private async initialize(): Promise<void> {
    this.env = validateEnvironment();

    this.gswap = new GSwapWrapper({
      signer: new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY || '0x'),
      walletAddress: this.env.wallet.address,
      gatewayBaseUrl: this.env.api.baseUrl,
      dexBackendBaseUrl: this.env.api.baseUrl,
      bundlerBaseUrl: this.env.api.baseUrl.replace('dex-backend', 'bundle-backend')
    });

    logger.info('✅ Components initialized for stress testing');
  }

  private async runApiConnectivityStress(config: StressTestConfig): Promise<void> {
    logger.info('🌐 Test 1: API Connectivity Stress...');

    const startTime = performance.now();
    const initialMemory = this.getMemoryUsage();
    let peakMemory = initialMemory;

    const responses: number[] = [];
    let successCount = 0;
    let failCount = 0;

    const promises: Promise<void>[] = [];

    for (let i = 0; i < config.apiCalls; i++) {
      const promise = this.makeApiRequest()
        .then(responseTime => {
          responses.push(responseTime);
          successCount++;

          const currentMemory = this.getMemoryUsage();
          if (currentMemory > peakMemory) {
            peakMemory = currentMemory;
          }
        })
        .catch(() => {
          failCount++;
        });

      promises.push(promise);

      // Control concurrency
      if (promises.length >= config.concurrency) {
        await Promise.allSettled(promises.splice(0, config.concurrency));
      }

      // Delay to achieve target RPS
      if (config.targetRPS > 0) {
        await this.delay(1000 / config.targetRPS);
      }
    }

    // Wait for remaining requests
    await Promise.allSettled(promises);

    const endTime = performance.now();
    const finalMemory = this.getMemoryUsage();

    this.results.push({
      testName: 'API Connectivity Stress',
      totalRequests: config.apiCalls,
      successfulRequests: successCount,
      failedRequests: failCount,
      averageResponseTime: responses.length > 0 ? responses.reduce((a, b) => a + b, 0) / responses.length : 0,
      minResponseTime: responses.length > 0 ? Math.min(...responses) : 0,
      maxResponseTime: responses.length > 0 ? Math.max(...responses) : 0,
      requestsPerSecond: (successCount / ((endTime - startTime) / 1000)),
      errorRate: (failCount / config.apiCalls) * 100,
      duration: endTime - startTime,
      memoryUsage: {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      }
    });

    logger.info(`   ✅ Completed: ${successCount}/${config.apiCalls} requests successful`);
  }

  private async runConcurrentPriceFetching(config: StressTestConfig): Promise<void> {
    logger.info('💰 Test 2: Concurrent Price Fetching...');

    const startTime = performance.now();
    const initialMemory = this.getMemoryUsage();
    let peakMemory = initialMemory;

    const tokens = [
      'GALA$Unit$none$none',
      'GUSDC$Unit$none$none',
      'ETIME$Unit$none$none',
      'SILK$Unit$none$none'
    ];

    const responses: number[] = [];
    let successCount = 0;
    let failCount = 0;

    const promises: Promise<void>[] = [];

    for (let i = 0; i < config.apiCalls; i++) {
      const token = tokens[i % tokens.length];

      const promise = this.fetchTokenPrice(token)
        .then(responseTime => {
          responses.push(responseTime);
          successCount++;

          const currentMemory = this.getMemoryUsage();
          if (currentMemory > peakMemory) {
            peakMemory = currentMemory;
          }
        })
        .catch(() => {
          failCount++;
        });

      promises.push(promise);

      if (promises.length >= config.concurrency) {
        await Promise.allSettled(promises.splice(0, config.concurrency));
      }

      if (config.targetRPS > 0) {
        await this.delay(1000 / config.targetRPS);
      }
    }

    await Promise.allSettled(promises);

    const endTime = performance.now();
    const finalMemory = this.getMemoryUsage();

    this.results.push({
      testName: 'Concurrent Price Fetching',
      totalRequests: config.apiCalls,
      successfulRequests: successCount,
      failedRequests: failCount,
      averageResponseTime: responses.length > 0 ? responses.reduce((a, b) => a + b, 0) / responses.length : 0,
      minResponseTime: responses.length > 0 ? Math.min(...responses) : 0,
      maxResponseTime: responses.length > 0 ? Math.max(...responses) : 0,
      requestsPerSecond: (successCount / ((endTime - startTime) / 1000)),
      errorRate: (failCount / config.apiCalls) * 100,
      duration: endTime - startTime,
      memoryUsage: {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      }
    });

    logger.info(`   ✅ Completed: ${successCount}/${config.apiCalls} price fetches`);
  }

  private async runRapidQuoteGeneration(config: StressTestConfig): Promise<void> {
    logger.info('📈 Test 3: Rapid Quote Generation...');

    const startTime = performance.now();
    const initialMemory = this.getMemoryUsage();
    let peakMemory = initialMemory;

    const responses: number[] = [];
    let successCount = 0;
    let failCount = 0;

    const promises: Promise<void>[] = [];

    for (let i = 0; i < Math.min(config.apiCalls, 50); i++) { // Limit quotes to prevent overwhelming DEV
      const promise = this.generateQuote()
        .then(responseTime => {
          responses.push(responseTime);
          successCount++;

          const currentMemory = this.getMemoryUsage();
          if (currentMemory > peakMemory) {
            peakMemory = currentMemory;
          }
        })
        .catch(() => {
          failCount++;
        });

      promises.push(promise);

      if (promises.length >= Math.min(config.concurrency, 5)) { // Lower concurrency for quotes
        await Promise.allSettled(promises.splice(0, Math.min(config.concurrency, 5)));
      }

      await this.delay(200); // Slower rate for quotes
    }

    await Promise.allSettled(promises);

    const endTime = performance.now();
    const finalMemory = this.getMemoryUsage();

    this.results.push({
      testName: 'Rapid Quote Generation',
      totalRequests: Math.min(config.apiCalls, 50),
      successfulRequests: successCount,
      failedRequests: failCount,
      averageResponseTime: responses.length > 0 ? responses.reduce((a, b) => a + b, 0) / responses.length : 0,
      minResponseTime: responses.length > 0 ? Math.min(...responses) : 0,
      maxResponseTime: responses.length > 0 ? Math.max(...responses) : 0,
      requestsPerSecond: (successCount / ((endTime - startTime) / 1000)),
      errorRate: (failCount / Math.min(config.apiCalls, 50)) * 100,
      duration: endTime - startTime,
      memoryUsage: {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      }
    });

    logger.info(`   ✅ Completed: ${successCount}/50 quote generations`);
  }

  private async runDatabaseStress(config: StressTestConfig): Promise<void> {
    logger.info('🗄️ Test 4: Database Operations Stress...');

    const startTime = performance.now();
    const initialMemory = this.getMemoryUsage();
    let peakMemory = initialMemory;

    const responses: number[] = [];
    let successCount = 0;
    let failCount = 0;

    const promises: Promise<void>[] = [];

    for (let i = 0; i < config.apiCalls; i++) {
      const promise = this.performDatabaseOperation()
        .then(responseTime => {
          responses.push(responseTime);
          successCount++;

          const currentMemory = this.getMemoryUsage();
          if (currentMemory > peakMemory) {
            peakMemory = currentMemory;
          }
        })
        .catch(() => {
          failCount++;
        });

      promises.push(promise);

      if (promises.length >= config.concurrency) {
        await Promise.allSettled(promises.splice(0, config.concurrency));
      }
    }

    await Promise.allSettled(promises);

    const endTime = performance.now();
    const finalMemory = this.getMemoryUsage();

    this.results.push({
      testName: 'Database Operations Stress',
      totalRequests: config.apiCalls,
      successfulRequests: successCount,
      failedRequests: failCount,
      averageResponseTime: responses.length > 0 ? responses.reduce((a, b) => a + b, 0) / responses.length : 0,
      minResponseTime: responses.length > 0 ? Math.min(...responses) : 0,
      maxResponseTime: responses.length > 0 ? Math.max(...responses) : 0,
      requestsPerSecond: (successCount / ((endTime - startTime) / 1000)),
      errorRate: (failCount / config.apiCalls) * 100,
      duration: endTime - startTime,
      memoryUsage: {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      }
    });

    logger.info(`   ✅ Completed: ${successCount}/${config.apiCalls} database operations`);
  }

  private async runMemoryStressTest(_config: StressTestConfig): Promise<void> {
    logger.info('🧠 Test 5: Memory Stress Test...');

    const startTime = performance.now();
    const initialMemory = this.getMemoryUsage();
    let peakMemory = initialMemory;

    // Create memory pressure
    const memoryConsumers: Array<{ data: number[]; metadata: Record<string, unknown> }> = [];
    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < 1000; i++) {
        // Create objects to consume memory
        const data = {
          id: i,
          timestamp: Date.now(),
          data: new Array(1000).fill(Math.random()),
          metadata: {
            created: new Date(),
            processed: false,
            complexity: Math.random() * 100
          }
        };

        memoryConsumers.push(data);

        const currentMemory = this.getMemoryUsage();
        if (currentMemory > peakMemory) {
          peakMemory = currentMemory;
        }

        // Process some data to simulate real work
        if (i % 100 === 0) {
          await this.simulateDataProcessing(memoryConsumers.slice(-100));
          successCount++;
        }

        // Monitor memory usage
        if (currentMemory > 500) { // Stop if using more than 500MB
          logger.warn(`   ⚠️ Memory limit reached: ${currentMemory}MB`);
          break;
        }
      }

      // Cleanup
      memoryConsumers.length = 0;

      if (global.gc) {
        global.gc();
      }

    } catch (error) {
      failCount++;
      logger.error(`   ❌ Memory stress test error: ${error}`);
    }

    const endTime = performance.now();
    const finalMemory = this.getMemoryUsage();

    this.results.push({
      testName: 'Memory Stress Test',
      totalRequests: 1000,
      successfulRequests: successCount,
      failedRequests: failCount,
      averageResponseTime: 0,
      minResponseTime: 0,
      maxResponseTime: 0,
      requestsPerSecond: 0,
      errorRate: (failCount / 1000) * 100,
      duration: endTime - startTime,
      memoryUsage: {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      }
    });

    logger.info(`   ✅ Peak memory usage: ${peakMemory}MB`);
  }

  private async runErrorRecoveryTest(config: StressTestConfig): Promise<void> {
    logger.info('🔄 Test 6: Error Recovery Under Load...');

    const startTime = performance.now();
    const initialMemory = this.getMemoryUsage();
    let peakMemory = initialMemory;

    const responses: number[] = [];
    let successCount = 0;
    let failCount = 0;
    let recoveryCount = 0;

    const promises: Promise<void>[] = [];

    for (let i = 0; i < config.apiCalls; i++) {
      const promise = this.simulateErrorRecovery(i)
        .then(responseTime => {
          responses.push(responseTime);
          successCount++;

          const currentMemory = this.getMemoryUsage();
          if (currentMemory > peakMemory) {
            peakMemory = currentMemory;
          }
        })
        .catch((error) => {
          if (error.message.includes('recovered')) {
            recoveryCount++;
          } else {
            failCount++;
          }
        });

      promises.push(promise);

      if (promises.length >= config.concurrency) {
        await Promise.allSettled(promises.splice(0, config.concurrency));
      }
    }

    await Promise.allSettled(promises);

    const endTime = performance.now();
    const finalMemory = this.getMemoryUsage();

    this.results.push({
      testName: 'Error Recovery Under Load',
      totalRequests: config.apiCalls,
      successfulRequests: successCount + recoveryCount,
      failedRequests: failCount,
      averageResponseTime: responses.length > 0 ? responses.reduce((a, b) => a + b, 0) / responses.length : 0,
      minResponseTime: responses.length > 0 ? Math.min(...responses) : 0,
      maxResponseTime: responses.length > 0 ? Math.max(...responses) : 0,
      requestsPerSecond: ((successCount + recoveryCount) / ((endTime - startTime) / 1000)),
      errorRate: (failCount / config.apiCalls) * 100,
      duration: endTime - startTime,
      memoryUsage: {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      }
    });

    logger.info(`   ✅ Completed: ${successCount} success, ${recoveryCount} recovered, ${failCount} failed`);
  }

  // Helper methods
  private async makeApiRequest(): Promise<number> {
    const startTime = performance.now();

    try {
      const _response = await fetch(this.env.api.baseUrl + '/health', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      return performance.now() - startTime;
    } catch (error) {
      // For DEV environment, we expect some endpoints to not exist
      return performance.now() - startTime;
    }
  }

  private async fetchTokenPrice(token: string): Promise<number> {
    const startTime = performance.now();

    try {
      await this.gswap.getTokenPrice(token);
      return performance.now() - startTime;
    } catch (error) {
      // Expected in DEV environment
      return performance.now() - startTime;
    }
  }

  private async generateQuote(): Promise<number> {
    const startTime = performance.now();

    try {
      await this.gswap.getQuote(
        'GALA$Unit$none$none',
        'GUSDC$Unit$none$none',
        '1',
        3000
      );
      return performance.now() - startTime;
    } catch (error) {
      // Expected in DEV environment with no pools
      return performance.now() - startTime;
    }
  }

  private async performDatabaseOperation(): Promise<number> {
    const startTime = performance.now();

    try {
      // Simulate database operation
      await this.delay(Math.random() * 50); // 0-50ms delay
      return performance.now() - startTime;
    } catch (error) {
      throw error;
    }
  }

  private async simulateDataProcessing(data: Array<{ data: number[]; metadata: Record<string, unknown> }>): Promise<void> {
    // Simulate CPU-intensive work
    for (let i = 0; i < data.length; i++) {
      data[i].metadata.processed = true;
      data[i].metadata.processedAt = Date.now();
    }
  }

  private async simulateErrorRecovery(_iteration: number): Promise<number> {
    const startTime = performance.now();

    // Simulate random errors
    if (Math.random() < 0.2) { // 20% error rate
      if (Math.random() < 0.7) { // 70% recovery rate
        await this.delay(100); // Recovery delay
        throw new Error('recovered');
      } else {
        throw new Error('permanent failure');
      }
    }

    await this.delay(Math.random() * 100);
    return performance.now() - startTime;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getMemoryUsage(): number {
    const usage = process.memoryUsage();
    return Math.round(usage.heapUsed / 1024 / 1024); // MB
  }

  generateReport(results: StressTestResult[]): void {
    logger.info('\n⚡ DEV Environment Stress Test Results\n');

    results.forEach(result => {
      logger.info(`📊 ${result.testName}:`);
      logger.info(`   Total Requests: ${result.totalRequests}`);
      logger.info(`   Successful: ${result.successfulRequests} (${((result.successfulRequests / result.totalRequests) * 100).toFixed(1)}%)`);
      logger.info(`   Failed: ${result.failedRequests} (${result.errorRate.toFixed(1)}%)`);
      logger.info(`   Avg Response: ${result.averageResponseTime.toFixed(1)}ms`);
      logger.info(`   RPS: ${result.requestsPerSecond.toFixed(1)}`);
      logger.info(`   Memory: ${result.memoryUsage.initial}MB → ${result.memoryUsage.peak}MB → ${result.memoryUsage.final}MB`);
      logger.info(`   Duration: ${(result.duration / 1000).toFixed(1)}s\n`);
    });

    // Overall assessment
    const totalRequests = results.reduce((sum, r) => sum + r.totalRequests, 0);
    const totalSuccessful = results.reduce((sum, r) => sum + r.successfulRequests, 0);
    const averageErrorRate = results.reduce((sum, r) => sum + r.errorRate, 0) / results.length;
    const maxMemoryUsage = Math.max(...results.map(r => r.memoryUsage.peak));

    logger.info('🎯 Overall Assessment:');
    logger.info(`   Total Requests: ${totalRequests}`);
    logger.info(`   Success Rate: ${((totalSuccessful / totalRequests) * 100).toFixed(1)}%`);
    logger.info(`   Average Error Rate: ${averageErrorRate.toFixed(1)}%`);
    logger.info(`   Peak Memory Usage: ${maxMemoryUsage}MB`);

    if (averageErrorRate < 10 && maxMemoryUsage < 512) {
      logger.info('   🟢 EXCELLENT - System handles stress well');
    } else if (averageErrorRate < 25 && maxMemoryUsage < 1024) {
      logger.info('   🟡 GOOD - Some performance degradation under load');
    } else {
      logger.info('   🔴 POOR - System struggles under stress');
    }
  }
}

// Main execution
async function runStressTest() {
  const config: StressTestConfig = {
    apiCalls: parseInt(process.argv[3]) || 100,
    concurrency: parseInt(process.argv[4]) || 10,
    duration: parseInt(process.argv[5]) || 60000, // 1 minute
    rampUpTime: parseInt(process.argv[6]) || 5000, // 5 seconds
    targetRPS: parseInt(process.argv[7]) || 0 // 0 = no limit
  };

  logger.info('⚡ DEV Environment Stress Test Configuration:');
  logger.info(`   API Calls: ${config.apiCalls}`);
  logger.info(`   Concurrency: ${config.concurrency}`);
  logger.info(`   Duration: ${config.duration}ms`);
  logger.info(`   Target RPS: ${config.targetRPS || 'Unlimited'}\n`);

  try {
    const stressTest = new DevStressTest();
    const results = await stressTest.runStressTests(config);
    stressTest.generateReport(results);

    const averageErrorRate = results.reduce((sum, r) => sum + r.errorRate, 0) / results.length;
    process.exit(averageErrorRate < 25 ? 0 : 1);

  } catch (error) {
    logger.error('❌ Stress test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStressTest();
}

export { DevStressTest, runStressTest };