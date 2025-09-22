#!/usr/bin/env tsx

/**
 * DEV Environment Performance Benchmark
 *
 * SAFETY LEVEL: ZERO RISK
 * - Measures baseline performance metrics
 * - Establishes performance benchmarks for production
 * - No real funds involved
 */

import { config } from 'dotenv';
import { validateEnvironment } from '../config/environment';
import { GSwapWrapper } from '../services/gswap-wrapper';
import { Logger } from '../utils/logger';
import { PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { performance } from 'perf_hooks';
import { checkDatabaseHealth, initializeDatabase } from '../config/database';

config();

const logger = new Logger('DevPerformanceBenchmark');

interface BenchmarkResult {
  name: string;
  operations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  operationsPerSecond: number;
  memoryUsage: {
    before: NodeJS.MemoryUsage;
    after: NodeJS.MemoryUsage;
    peak: number;
  };
  cpuUsage: {
    before: NodeJS.CpuUsage;
    after: NodeJS.CpuUsage;
  };
}

interface SystemMetrics {
  timestamp: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  eventLoopLag: number;
}

class DevPerformanceBenchmark {
  private gswap!: GSwapWrapper;
  private env: any;
  private results: BenchmarkResult[] = [];
  private systemMetrics: SystemMetrics[] = [];
  private metricsInterval?: NodeJS.Timeout;

  async runBenchmarks(): Promise<BenchmarkResult[]> {
    logger.info('📊 Starting DEV Environment Performance Benchmarks...');

    // Initialize components
    await this.initialize();

    // Start system metrics collection
    this.startMetricsCollection();

    try {
      // Benchmark 1: Component Initialization
      await this.benchmarkComponentInitialization();

      // Benchmark 2: Database Operations
      await this.benchmarkDatabaseOperations();

      // Benchmark 3: API Response Times
      await this.benchmarkApiResponseTimes();

      // Benchmark 4: Price Data Processing
      await this.benchmarkPriceDataProcessing();

      // Benchmark 5: Trading Logic Execution
      await this.benchmarkTradingLogic();

      // Benchmark 6: Risk Calculations
      await this.benchmarkRiskCalculations();

      // Benchmark 7: Memory Management
      await this.benchmarkMemoryManagement();

      // Benchmark 8: Concurrent Operations
      await this.benchmarkConcurrentOperations();

    } finally {
      this.stopMetricsCollection();
    }

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

    await initializeDatabase();
    logger.info('✅ Components initialized for benchmarking');
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      const now = performance.now();
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Measure event loop lag
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1e6; // Convert to milliseconds

        this.systemMetrics.push({
          timestamp: now,
          memoryUsage: memUsage,
          cpuUsage,
          eventLoopLag: lag
        });
      });
    }, 1000);
  }

  private stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }

  private async benchmarkComponentInitialization(): Promise<void> {
    logger.info('🔧 Benchmark 1: Component Initialization...');

    const operations = 10;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      // Initialize components
      const { AlertSystem } = await import('../monitoring/alerts');
      const { EmergencyControls } = await import('../trading/risk/emergency-controls');
      const { PositionLimits } = await import('../trading/risk/position-limits');
      const { RiskMonitor } = await import('../trading/risk/risk-monitor');

      const alertSystem = new AlertSystem(false);
      const emergencyControls = new EmergencyControls(alertSystem);
      const positionLimits = new PositionLimits({
        maxPositionSize: 100,
        maxTotalExposure: 500,
        maxPositionsPerToken: 5,
        concentrationLimit: 0.2
      });
      const riskMonitor = new RiskMonitor(alertSystem, emergencyControls);

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }

      // Small delay between operations
      await this.delay(10);
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'Component Initialization',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg initialization time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);
  }

  private async benchmarkDatabaseOperations(): Promise<void> {
    logger.info('🗄️ Benchmark 2: Database Operations...');

    const operations = 100;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      // Perform database health check (lightweight operation)
      await checkDatabaseHealth();

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'Database Operations',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg database query time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);
  }

  private async benchmarkApiResponseTimes(): Promise<void> {
    logger.info('🌐 Benchmark 3: API Response Times...');

    const operations = 50;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      try {
        // Test API endpoint
        await fetch(this.env.api.baseUrl + '/health', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        // Expected in DEV environment
      }

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }

      // Rate limiting
      await this.delay(50);
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'API Response Times',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg API response time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);
  }

  private async benchmarkPriceDataProcessing(): Promise<void> {
    logger.info('💰 Benchmark 4: Price Data Processing...');

    const operations = 50;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    const tokens = [
      'GALA$Unit$none$none',
      'GUSDC$Unit$none$none',
      'ETIME$Unit$none$none',
      'SILK$Unit$none$none'
    ];

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      try {
        const token = tokens[i % tokens.length];
        await this.gswap.getTokenPrice(token);
      } catch (error) {
        // Expected in DEV environment
      }

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }

      await this.delay(100);
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'Price Data Processing',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg price processing time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);
  }

  private async benchmarkTradingLogic(): Promise<void> {
    logger.info('🧠 Benchmark 5: Trading Logic Execution...');

    const operations = 100;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      // Simulate trading logic calculations
      const mockPrice1 = 0.025 + (Math.random() - 0.5) * 0.001;
      const mockPrice2 = 0.026 + (Math.random() - 0.5) * 0.001;

      // Calculate arbitrage opportunity
      const priceDiff = Math.abs(mockPrice1 - mockPrice2);
      const profitPercentage = (priceDiff / mockPrice1) * 100;

      // Simulate position sizing calculation
      const maxPosition = 100;
      const availableCapital = 1000;
      const riskPercentage = 0.02;
      const positionSize = Math.min(maxPosition, availableCapital * riskPercentage);

      // Simulate slippage calculation
      const slippageTolerance = 0.005;
      const minPrice = mockPrice1 * (1 - slippageTolerance);
      const maxPrice = mockPrice1 * (1 + slippageTolerance);

      // Simulate profit/loss calculation
      const expectedProfit = positionSize * (profitPercentage / 100);

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'Trading Logic Execution',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg trading logic time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)}ms`);
  }

  private async benchmarkRiskCalculations(): Promise<void> {
    logger.info('🛡️ Benchmark 6: Risk Calculations...');

    const operations = 200;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      // Simulate risk calculations
      const portfolioValue = 1000 + Math.random() * 500;
      const dailyPnL = (Math.random() - 0.5) * 100;
      const positionSizes = Array.from({ length: 5 }, () => Math.random() * 100);

      // Calculate risk metrics
      const dailyReturnPercent = (dailyPnL / portfolioValue) * 100;
      const portfolioConcentration = Math.max(...positionSizes) / portfolioValue;
      const totalExposure = positionSizes.reduce((sum, size) => sum + size, 0);
      const leverageRatio = totalExposure / portfolioValue;

      // Risk scoring
      let riskScore = 0;
      if (Math.abs(dailyReturnPercent) > 5) riskScore += 3;
      if (portfolioConcentration > 0.3) riskScore += 2;
      if (leverageRatio > 2) riskScore += 3;

      // Volatility calculation
      const priceHistory = Array.from({ length: 20 }, () => 0.025 + (Math.random() - 0.5) * 0.005);
      const returns = priceHistory.slice(1).map((price, i) => (price - priceHistory[i]) / priceHistory[i]);
      const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'Risk Calculations',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg risk calculation time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)}ms`);
  }

  private async benchmarkMemoryManagement(): Promise<void> {
    logger.info('🧠 Benchmark 7: Memory Management...');

    const operations = 50;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      // Create memory pressure
      const data = Array.from({ length: 1000 }, (_, index) => ({
        id: index,
        timestamp: Date.now(),
        data: new Array(100).fill(Math.random()),
        metadata: {
          created: new Date(),
          processed: false
        }
      }));

      // Process data
      data.forEach(item => {
        item.processed = true;
        item.metadata.processed = true;
      });

      // Clear data
      data.length = 0;

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }

      // Force garbage collection if available
      if (global.gc && i % 10 === 0) {
        global.gc();
      }
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'Memory Management',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg memory operation time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);
  }

  private async benchmarkConcurrentOperations(): Promise<void> {
    logger.info('⚡ Benchmark 8: Concurrent Operations...');

    const operations = 20;
    const concurrency = 5;
    const times: number[] = [];
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    let peakMemory = this.getMemoryUsageMB();

    for (let i = 0; i < operations; i++) {
      const startTime = performance.now();

      // Run concurrent operations
      const promises = Array.from({ length: concurrency }, async () => {
        // Simulate API call
        await this.delay(Math.random() * 100);

        // Simulate calculation
        const result = Array.from({ length: 100 }, () => Math.random()).reduce((sum, val) => sum + val, 0);

        return result;
      });

      await Promise.all(promises);

      const endTime = performance.now();
      times.push(endTime - startTime);

      const currentMemory = this.getMemoryUsageMB();
      if (currentMemory > peakMemory) {
        peakMemory = currentMemory;
      }
    }

    const memAfter = process.memoryUsage();
    const cpuAfter = process.cpuUsage(cpuBefore);

    this.results.push({
      name: 'Concurrent Operations',
      operations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      operationsPerSecond: operations / (times.reduce((a, b) => a + b, 0) / 1000),
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        peak: peakMemory
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter
      }
    });

    logger.info(`   ✅ Avg concurrent operation time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getMemoryUsageMB(): number {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  }

  generateReport(results: BenchmarkResult[]): void {
    logger.info('\n📊 DEV Environment Performance Benchmark Results\n');

    results.forEach(result => {
      logger.info(`🔬 ${result.name}:`);
      logger.info(`   Operations: ${result.operations}`);
      logger.info(`   Avg Time: ${result.averageTime.toFixed(2)}ms`);
      logger.info(`   Min Time: ${result.minTime.toFixed(2)}ms`);
      logger.info(`   Max Time: ${result.maxTime.toFixed(2)}ms`);
      logger.info(`   Operations/sec: ${result.operationsPerSecond.toFixed(1)}`);
      logger.info(`   Memory: ${Math.round(result.memoryUsage.before.heapUsed / 1024 / 1024)}MB → ${Math.round(result.memoryUsage.after.heapUsed / 1024 / 1024)}MB (peak: ${result.memoryUsage.peak}MB)`);
      logger.info(`   CPU User: ${result.cpuUsage.after.user - result.cpuUsage.before.user}μs`);
      logger.info(`   CPU System: ${result.cpuUsage.after.system - result.cpuUsage.before.system}μs\n`);
    });

    // Performance summary
    const avgResponseTime = results.reduce((sum, r) => sum + r.averageTime, 0) / results.length;
    const totalOps = results.reduce((sum, r) => sum + r.operations, 0);
    const maxMemoryUsage = Math.max(...results.map(r => r.memoryUsage.peak));

    logger.info('🎯 Performance Summary:');
    logger.info(`   Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
    logger.info(`   Total Operations: ${totalOps}`);
    logger.info(`   Peak Memory Usage: ${maxMemoryUsage}MB`);

    // Performance assessment
    if (avgResponseTime < 100 && maxMemoryUsage < 256) {
      logger.info('   🟢 EXCELLENT - High performance system');
    } else if (avgResponseTime < 250 && maxMemoryUsage < 512) {
      logger.info('   🟡 GOOD - Acceptable performance');
    } else {
      logger.info('   🔴 POOR - Performance optimization needed');
    }

    // System metrics summary
    if (this.systemMetrics.length > 0) {
      const avgEventLoopLag = this.systemMetrics.reduce((sum, m) => sum + m.eventLoopLag, 0) / this.systemMetrics.length;
      logger.info(`   Event Loop Lag: ${avgEventLoopLag.toFixed(2)}ms avg`);
    }
  }

  exportResults(results: BenchmarkResult[]): void {
    const report = {
      timestamp: new Date().toISOString(),
      environment: 'DEV',
      nodeVersion: process.version,
      platform: process.platform,
      results: results.map(r => ({
        name: r.name,
        operations: r.operations,
        averageTime: r.averageTime,
        operationsPerSecond: r.operationsPerSecond,
        peakMemoryMB: r.memoryUsage.peak
      })),
      systemMetrics: this.systemMetrics.slice(-10) // Last 10 metrics
    };

    const fs = require('fs');
    const filename = `performance-benchmark-${Date.now()}.json`;

    try {
      fs.writeFileSync(filename, JSON.stringify(report, null, 2));
      logger.info(`📄 Benchmark results exported to: ${filename}`);
    } catch (error) {
      logger.warn(`⚠️ Could not export results: ${error}`);
    }
  }
}

// Main execution
async function runBenchmark() {
  try {
    const benchmark = new DevPerformanceBenchmark();
    const results = await benchmark.runBenchmarks();
    benchmark.generateReport(results);
    benchmark.exportResults(results);

    const avgResponseTime = results.reduce((sum, r) => sum + r.averageTime, 0) / results.length;
    process.exit(avgResponseTime < 250 ? 0 : 1);

  } catch (error) {
    logger.error('❌ Performance benchmark failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmark();
}

export { DevPerformanceBenchmark, runBenchmark };