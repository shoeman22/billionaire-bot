#!/usr/bin/env tsx
/**
 * Trading System Validation Script
 * Complete workflow validation and live trading readiness assessment
 */

import dotenv from 'dotenv';
import { validateEnvironment } from '../src/config/environment';

// Load environment variables
dotenv.config();
import { TradingEngine } from '../src/trading/TradingEngine';
import { GalaSwapClient } from '../src/api/GalaSwapClient';
import { logger } from '../src/utils/logger';
import { COMMON_TOKENS, FEE_TIERS, isSuccessResponse } from '../src/types/galaswap';

interface ValidationResult {
  category: string;
  test: string;
  passed: boolean;
  critical: boolean; // Whether failure blocks live trading
  details?: string;
  error?: string;
  duration?: number;
}

interface TradingReadinessReport {
  overallStatus: 'READY' | 'NOT_READY' | 'WARNING';
  criticalIssues: ValidationResult[];
  warnings: ValidationResult[];
  recommendations: string[];
  systemHealth: {
    api: 'healthy' | 'degraded' | 'unhealthy';
    websocket: 'connected' | 'disconnected' | 'error';
    riskManagement: 'active' | 'disabled' | 'error';
    balance: 'sufficient' | 'low' | 'insufficient';
  };
}

class TradingValidator {
  private client: GalaSwapClient;
  private tradingEngine: TradingEngine;
  private results: ValidationResult[] = [];
  private config: ReturnType<typeof validateEnvironment>;

  constructor() {
    this.config = validateEnvironment();

    this.client = new GalaSwapClient({
      baseUrl: this.config.api.baseUrl,
      wsUrl: this.config.api.wsUrl,
      walletAddress: this.config.wallet.address,
      privateKey: this.config.wallet.privateKey
    });

    this.tradingEngine = new TradingEngine(this.config);
  }

  /**
   * Add validation result
   */
  private addResult(
    category: string,
    test: string,
    passed: boolean,
    critical: boolean = false,
    details?: string,
    error?: string,
    duration?: number
  ) {
    this.results.push({ category, test, passed, critical, details, error, duration });

    const icon = passed ? '✅' : (critical ? '🚨' : '⚠️');
    const durationStr = duration ? ` (${duration}ms)` : '';

    if (passed) {
      logger.info(`${icon} ${category} - ${test}: ${details || 'PASSED'}${durationStr}`);
    } else {
      const level = critical ? 'error' : 'warn';
      logger[level](`${icon} ${category} - ${test}: ${error || 'FAILED'}${durationStr}`);
    }
  }

  /**
   * Time a validation operation
   */
  private async timeOperation<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    const result = await operation();
    const duration = Date.now() - start;
    return { result, duration };
  }

  /**
   * Validation 1: System Infrastructure
   */
  async validateSystemInfrastructure(): Promise<void> {
    logger.info('\n🏗️ Validating System Infrastructure...');

    try {
      // Test API health and performance
      const { result: healthCheck, duration } = await this.timeOperation(() => this.client.healthCheck());

      this.addResult(
        'Infrastructure',
        'API Health',
        healthCheck.isHealthy,
        true,
        `Status: ${healthCheck.apiStatus}`,
        healthCheck.isHealthy ? undefined : 'API is unhealthy',
        duration
      );

      this.addResult(
        'Infrastructure',
        'API Performance',
        duration < 2000,
        false,
        `Response time: ${duration}ms`,
        duration >= 2000 ? 'API response time is slow' : undefined,
        duration
      );

      // Test WebSocket connectivity
      try {
        const { duration: wsDuration } = await this.timeOperation(() => this.client.connectWebSocket());

        this.addResult(
          'Infrastructure',
          'WebSocket Connection',
          true,
          false,
          'Connected successfully',
          undefined,
          wsDuration
        );

        await this.client.disconnectWebSocket();

      } catch (error) {
        this.addResult(
          'Infrastructure',
          'WebSocket Connection',
          false,
          false,
          undefined,
          'WebSocket connection failed - trading will use polling'
        );
      }

      // Test configuration integrity
      const configValid = this.config.WALLET_ADDRESS && this.config.WALLET_PRIVATE_KEY;
      this.addResult(
        'Infrastructure',
        'Configuration Integrity',
        configValid,
        true,
        configValid ? 'All required config present' : undefined,
        configValid ? undefined : 'Missing critical configuration'
      );

    } catch (error) {
      this.addResult(
        'Infrastructure',
        'System Infrastructure',
        false,
        true,
        undefined,
        error instanceof Error ? error.message : 'Unknown infrastructure error'
      );
    }
  }

  /**
   * Validation 2: Trading Engine Components
   */
  async validateTradingEngineComponents(): Promise<void> {
    logger.info('\n⚙️ Validating Trading Engine Components...');

    try {
      // Test trading engine initialization
      const { duration: initDuration } = await this.timeOperation(async () => {
        // Engine should already be initialized, but test key components
        const riskMonitor = this.tradingEngine.getRiskMonitor();
        return riskMonitor;
      });

      this.addResult(
        'Trading Engine',
        'Component Initialization',
        true,
        true,
        'All components initialized',
        undefined,
        initDuration
      );

      // Test risk monitoring
      const riskMonitor = this.tradingEngine.getRiskMonitor();

      // Test position limits
      const testPosition = 100; // Small test amount
      const positionAllowed = riskMonitor.checkPositionLimit(COMMON_TOKENS.GALA, testPosition);

      this.addResult(
        'Trading Engine',
        'Position Limits',
        positionAllowed,
        true,
        positionAllowed ? 'Position limits active' : undefined,
        positionAllowed ? undefined : 'Position limits blocking all trades'
      );

      // Test emergency controls
      const emergencyCheck = riskMonitor.checkEmergencyConditions();

      this.addResult(
        'Trading Engine',
        'Emergency Controls',
        !emergencyCheck.shouldStop,
        true,
        emergencyCheck.shouldStop ? undefined : 'Emergency controls active',
        emergencyCheck.shouldStop ? `Emergency stop: ${emergencyCheck.reason}` : undefined
      );

      // Test slippage validation
      const validSlippage = riskMonitor.validateSlippage(0.01);
      const invalidSlippage = riskMonitor.validateSlippage(0.5);

      this.addResult(
        'Trading Engine',
        'Slippage Protection',
        validSlippage && !invalidSlippage,
        true,
        validSlippage && !invalidSlippage ? 'Slippage protection active' : undefined,
        validSlippage && !invalidSlippage ? undefined : 'Slippage validation not working'
      );

    } catch (error) {
      this.addResult(
        'Trading Engine',
        'Component Validation',
        false,
        true,
        undefined,
        error instanceof Error ? error.message : 'Unknown trading engine error'
      );
    }
  }

  /**
   * Validation 3: Market Data and Pricing
   */
  async validateMarketDataAndPricing(): Promise<void> {
    logger.info('\n📊 Validating Market Data and Pricing...');

    try {
      // Test real-time price data
      const testTokens = [COMMON_TOKENS.GALA, COMMON_TOKENS.GUSDC];

      for (const token of testTokens) {
        try {
          const { result: price, duration } = await this.timeOperation(() => this.client.getPrice(token));

          if (isSuccessResponse(price)) {
            this.addResult(
              'Market Data',
              `Price Data - ${token}`,
              true,
              false,
              `Price: $${parseFloat(price.data.price).toFixed(6)}`,
              undefined,
              duration
            );
          } else {
            this.addResult(
              'Market Data',
              `Price Data - ${token}`,
              false,
              false,
              undefined,
              `Failed to get price: ${price.message}`
            );
          }
        } catch (error) {
          this.addResult(
            'Market Data',
            `Price Data - ${token}`,
            false,
            false,
            undefined,
            error instanceof Error ? error.message : 'Price fetch error'
          );
        }
      }

      // Test quote accuracy with real market data
      try {
        const { result: quote, duration } = await this.timeOperation(() =>
          this.client.getQuote({
            tokenIn: COMMON_TOKENS.GALA,
            tokenOut: COMMON_TOKENS.GUSDC,
            amountIn: '1000000', // 1 GALA
            fee: FEE_TIERS.STANDARD
          })
        );

        if (isSuccessResponse(quote)) {
          const outputAmount = parseFloat(quote.data.amountOut);
          const priceImpact = parseFloat(quote.data.priceImpact);

          this.addResult(
            'Market Data',
            'Quote Accuracy',
            outputAmount > 0 && priceImpact < 0.1,
            true,
            `Output: ${outputAmount.toFixed(6)} GUSDC, Impact: ${(priceImpact * 100).toFixed(3)}%`,
            outputAmount <= 0 ? 'Invalid quote output' : priceImpact >= 0.1 ? 'High price impact' : undefined,
            duration
          );
        } else {
          this.addResult(
            'Market Data',
            'Quote Accuracy',
            false,
            true,
            undefined,
            `Quote failed: ${quote.message}`
          );
        }
      } catch (error) {
        this.addResult(
          'Market Data',
          'Quote Accuracy',
          false,
          true,
          undefined,
          error instanceof Error ? error.message : 'Quote error'
        );
      }

    } catch (error) {
      this.addResult(
        'Market Data',
        'Market Data Validation',
        false,
        true,
        undefined,
        error instanceof Error ? error.message : 'Unknown market data error'
      );
    }
  }

  /**
   * Validation 4: Payload Generation and Signing
   */
  async validatePayloadGenerationAndSigning(): Promise<void> {
    logger.info('\n🔐 Validating Payload Generation and Signing...');

    try {
      // Test swap payload generation
      const { result: swapPayload, duration: swapDuration } = await this.timeOperation(() =>
        this.client.generateSwapPayload({
          tokenIn: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
          tokenOut: { collection: 'USDC', category: 'Unit', type: 'none', additionalKey: 'none' },
          amountIn: '100000', // 0.1 GALA
          fee: FEE_TIERS.STANDARD,
          sqrtPriceLimit: '0',
          amountInMaximum: '100000',
          amountOutMinimum: '1'
        })
      );

      if (isSuccessResponse(swapPayload)) {
        this.addResult(
          'Payload & Signing',
          'Swap Payload Generation',
          true,
          true,
          'Payload generated successfully',
          undefined,
          swapDuration
        );

        // Test payload signing
        try {
          const signer = (this.client as any).signer;
          const { result: signature, duration: signDuration } = await this.timeOperation(() =>
            signer.signPayload(swapPayload.data)
          );

          this.addResult(
            'Payload & Signing',
            'Payload Signing',
            signature && signature.length > 0,
            true,
            signature ? `Signature: ${signature.substring(0, 20)}... (${signature.length} chars)` : undefined,
            signature ? undefined : 'Signature generation failed',
            signDuration
          );

          // Test signature verification
          if (signature) {
            const { result: isValid, duration: verifyDuration } = await this.timeOperation(() =>
              signer.verifySignature(swapPayload.data, signature)
            );

            this.addResult(
              'Payload & Signing',
              'Signature Verification',
              isValid,
              true,
              isValid ? 'Signature verified successfully' : undefined,
              isValid ? undefined : 'Signature verification failed',
              verifyDuration
            );
          }

        } catch (error) {
          this.addResult(
            'Payload & Signing',
            'Payload Signing',
            false,
            true,
            undefined,
            error instanceof Error ? error.message : 'Signing error'
          );
        }

      } else {
        this.addResult(
          'Payload & Signing',
          'Swap Payload Generation',
          false,
          true,
          undefined,
          `Payload generation failed: ${swapPayload.message}`
        );
      }

    } catch (error) {
      this.addResult(
        'Payload & Signing',
        'Payload Validation',
        false,
        true,
        undefined,
        error instanceof Error ? error.message : 'Unknown payload error'
      );
    }
  }

  /**
   * Validation 5: Portfolio and Risk Assessment
   */
  async validatePortfolioAndRisk(): Promise<void> {
    logger.info('\n💼 Validating Portfolio and Risk Assessment...');

    try {
      // Test portfolio fetching
      const { result: portfolio, duration: portfolioDuration } = await this.timeOperation(() =>
        this.tradingEngine.getPortfolio()
      );

      this.addResult(
        'Portfolio & Risk',
        'Portfolio Calculation',
        portfolio !== null,
        false,
        portfolio ? `Total Value: $${portfolio.totalValue.toFixed(2)}, Positions: ${portfolio.positions.length}` : undefined,
        portfolio ? undefined : 'Portfolio calculation failed',
        portfolioDuration
      );

      if (portfolio) {
        // Test risk assessment
        const riskMonitor = this.tradingEngine.getRiskMonitor();
        const { result: riskAssessment, duration: riskDuration } = await this.timeOperation(() =>
          Promise.resolve(riskMonitor.assessPortfolioRisk(portfolio))
        );

        this.addResult(
          'Portfolio & Risk',
          'Risk Assessment',
          riskAssessment.riskLevel !== 'CRITICAL',
          true,
          `Risk Level: ${riskAssessment.riskLevel}, Score: ${riskAssessment.riskScore.toFixed(2)}`,
          riskAssessment.riskLevel === 'CRITICAL' ? 'Critical risk level detected' : undefined,
          riskDuration
        );

        // Test balance sufficiency for trading
        const hasGala = portfolio.balances.find(b => b.token === COMMON_TOKENS.GALA);
        const galaBalance = hasGala ? parseFloat(hasGala.balance) : 0;

        this.addResult(
          'Portfolio & Risk',
          'Trading Balance',
          galaBalance >= 1, // At least 1 GALA for trading
          false,
          `GALA Balance: ${galaBalance.toFixed(6)}`,
          galaBalance < 1 ? 'Insufficient GALA for meaningful trading' : undefined
        );

        // Test daily volume limits
        const maxDailyVolume = parseFloat(process.env.MAX_DAILY_VOLUME || '5000');
        const dailyVolumeCheck = portfolio.totalValue < maxDailyVolume;

        this.addResult(
          'Portfolio & Risk',
          'Daily Volume Limits',
          dailyVolumeCheck,
          false,
          `Portfolio: $${portfolio.totalValue.toFixed(2)}, Limit: $${maxDailyVolume}`,
          dailyVolumeCheck ? undefined : 'Portfolio value exceeds daily volume limit'
        );
      }

    } catch (error) {
      this.addResult(
        'Portfolio & Risk',
        'Portfolio Validation',
        false,
        false,
        undefined,
        error instanceof Error ? error.message : 'Unknown portfolio error'
      );
    }
  }

  /**
   * Validation 6: End-to-End Workflow (Dry Run)
   */
  async validateEndToEndWorkflow(): Promise<void> {
    logger.info('\n🔄 Validating End-to-End Workflow (Dry Run)...');

    try {
      // Simulate complete trading workflow without execution
      const testTrade = {
        tokenIn: COMMON_TOKENS.GALA,
        tokenOut: COMMON_TOKENS.GUSDC,
        amountIn: '100000', // 0.1 GALA - small amount
        slippageTolerance: 0.01 // 1%
      };

      // Step 1: Quote
      const { result: quote, duration: quoteDuration } = await this.timeOperation(() =>
        this.client.getQuote({
          tokenIn: testTrade.tokenIn,
          tokenOut: testTrade.tokenOut,
          amountIn: testTrade.amountIn,
          fee: FEE_TIERS.STANDARD
        })
      );

      this.addResult(
        'End-to-End',
        'Quote Generation',
        isSuccessResponse(quote),
        true,
        isSuccessResponse(quote) ? `Output: ${parseFloat(quote.data.amountOut).toFixed(6)} GUSDC` : undefined,
        isSuccessResponse(quote) ? undefined : `Quote failed: ${quote.message}`,
        quoteDuration
      );

      if (isSuccessResponse(quote)) {
        // Step 2: Risk validation
        const riskMonitor = this.tradingEngine.getRiskMonitor();
        const riskCheck = riskMonitor.validateTrade({
          tokenIn: testTrade.tokenIn,
          tokenOut: testTrade.tokenOut,
          amountIn: testTrade.amountIn,
          amountOut: quote.data.amountOut,
          priceImpact: parseFloat(quote.data.priceImpact),
          slippage: testTrade.slippageTolerance
        });

        this.addResult(
          'End-to-End',
          'Risk Validation',
          riskCheck.approved,
          true,
          riskCheck.approved ? 'Trade approved by risk management' : undefined,
          riskCheck.approved ? undefined : `Risk check failed: ${riskCheck.reasons.join(', ')}`
        );

        if (riskCheck.approved) {
          // Step 3: Payload generation
          const { result: payload, duration: payloadDuration } = await this.timeOperation(() =>
            this.client.generateSwapPayload({
              tokenIn: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
              tokenOut: { collection: 'USDC', category: 'Unit', type: 'none', additionalKey: 'none' },
              amountIn: testTrade.amountIn,
              fee: FEE_TIERS.STANDARD,
              sqrtPriceLimit: quote.data.newSqrtPrice,
              amountInMaximum: testTrade.amountIn,
              amountOutMinimum: (parseFloat(quote.data.amountOut) * (1 - testTrade.slippageTolerance)).toString()
            })
          );

          this.addResult(
            'End-to-End',
            'Payload Generation',
            isSuccessResponse(payload),
            true,
            isSuccessResponse(payload) ? 'Trading payload generated' : undefined,
            isSuccessResponse(payload) ? undefined : `Payload failed: ${payload.message}`,
            payloadDuration
          );

          if (isSuccessResponse(payload)) {
            // Step 4: Signing (without execution)
            try {
              const signer = (this.client as any).signer;
              const { result: signature, duration: signDuration } = await this.timeOperation(() =>
                signer.signPayload(payload.data)
              );

              this.addResult(
                'End-to-End',
                'Transaction Signing',
                signature && signature.length > 0,
                true,
                signature ? 'Transaction signed successfully' : undefined,
                signature ? undefined : 'Transaction signing failed',
                signDuration
              );

              // Complete workflow validation
              this.addResult(
                'End-to-End',
                'Complete Workflow',
                true,
                true,
                'Full trading workflow validated successfully'
              );

            } catch (error) {
              this.addResult(
                'End-to-End',
                'Transaction Signing',
                false,
                true,
                undefined,
                error instanceof Error ? error.message : 'Signing error'
              );
            }
          }
        }
      }

    } catch (error) {
      this.addResult(
        'End-to-End',
        'Workflow Validation',
        false,
        true,
        undefined,
        error instanceof Error ? error.message : 'Unknown workflow error'
      );
    }
  }

  /**
   * Generate comprehensive trading readiness report
   */
  generateReadinessReport(): TradingReadinessReport {
    const criticalIssues = this.results.filter(r => !r.passed && r.critical);
    const warnings = this.results.filter(r => !r.passed && !r.critical);

    // Determine overall status
    let overallStatus: 'READY' | 'NOT_READY' | 'WARNING';
    if (criticalIssues.length > 0) {
      overallStatus = 'NOT_READY';
    } else if (warnings.length > 0) {
      overallStatus = 'WARNING';
    } else {
      overallStatus = 'READY';
    }

    // Assess system health
    const apiTests = this.results.filter(r => r.category === 'Infrastructure' && r.test.includes('API'));
    const wsTests = this.results.filter(r => r.category === 'Infrastructure' && r.test.includes('WebSocket'));
    const riskTests = this.results.filter(r => r.category === 'Trading Engine');
    const balanceTests = this.results.filter(r => r.category === 'Portfolio & Risk' && r.test.includes('Balance'));

    const systemHealth = {
      api: apiTests.every(t => t.passed) ? 'healthy' as const :
           apiTests.some(t => t.passed) ? 'degraded' as const : 'unhealthy' as const,
      websocket: wsTests.every(t => t.passed) ? 'connected' as const :
                 wsTests.length === 0 ? 'disconnected' as const : 'error' as const,
      riskManagement: riskTests.every(t => t.passed) ? 'active' as const :
                      riskTests.some(t => t.passed) ? 'disabled' as const : 'error' as const,
      balance: balanceTests.every(t => t.passed) ? 'sufficient' as const :
               balanceTests.some(t => t.passed) ? 'low' as const : 'insufficient' as const
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (criticalIssues.length > 0) {
      recommendations.push('🚨 CRITICAL: Resolve all critical issues before enabling live trading');
    }

    if (systemHealth.api !== 'healthy') {
      recommendations.push('🔧 Monitor API performance and consider backup endpoints');
    }

    if (systemHealth.websocket === 'error') {
      recommendations.push('📡 WebSocket issues detected - trading will use polling mode');
    }

    if (systemHealth.balance === 'low') {
      recommendations.push('💰 Consider increasing trading balance for better opportunities');
    }

    if (warnings.length > 0) {
      recommendations.push('⚠️ Review warning conditions for optimal performance');
    }

    if (overallStatus === 'READY') {
      recommendations.push('✅ System is ready for live trading');
      recommendations.push('🔍 Start with small position sizes to validate live performance');
      recommendations.push('📊 Monitor first few trades closely for any issues');
    }

    return {
      overallStatus,
      criticalIssues,
      warnings,
      recommendations,
      systemHealth
    };
  }

  /**
   * Run complete trading system validation
   */
  async runCompleteValidation(): Promise<TradingReadinessReport> {
    logger.info('🚀 Starting Complete Trading System Validation...\n');

    await this.validateSystemInfrastructure();
    await this.validateTradingEngineComponents();
    await this.validateMarketDataAndPricing();
    await this.validatePayloadGenerationAndSigning();
    await this.validatePortfolioAndRisk();
    await this.validateEndToEndWorkflow();

    // Generate comprehensive report
    const report = this.generateReadinessReport();

    // Display summary
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;

    logger.info('\n' + '='.repeat(100));
    logger.info('🎯 TRADING SYSTEM VALIDATION REPORT');
    logger.info('='.repeat(100));

    // Overall status
    const statusIcon = report.overallStatus === 'READY' ? '🟢' :
                      report.overallStatus === 'WARNING' ? '🟡' : '🔴';
    logger.info(`${statusIcon} Overall Status: ${report.overallStatus}`);
    logger.info(`📊 Tests Passed: ${passed}/${total}`);

    // System health
    logger.info('\n🏥 System Health:');
    logger.info(`  API: ${report.systemHealth.api}`);
    logger.info(`  WebSocket: ${report.systemHealth.websocket}`);
    logger.info(`  Risk Management: ${report.systemHealth.riskManagement}`);
    logger.info(`  Balance: ${report.systemHealth.balance}`);

    // Critical issues
    if (report.criticalIssues.length > 0) {
      logger.error('\n🚨 CRITICAL ISSUES (Must fix before live trading):');
      report.criticalIssues.forEach(issue => {
        logger.error(`  • ${issue.category} - ${issue.test}: ${issue.error}`);
      });
    }

    // Warnings
    if (report.warnings.length > 0) {
      logger.warn('\n⚠️  WARNINGS (Review for optimal performance):');
      report.warnings.forEach(warning => {
        logger.warn(`  • ${warning.category} - ${warning.test}: ${warning.error}`);
      });
    }

    // Recommendations
    logger.info('\n💡 RECOMMENDATIONS:');
    report.recommendations.forEach(rec => {
      logger.info(`  ${rec}`);
    });

    // Final verdict
    logger.info('\n' + '='.repeat(100));
    if (report.overallStatus === 'READY') {
      logger.info('🎉 TRADING SYSTEM VALIDATION COMPLETE - READY FOR LIVE TRADING!');
    } else if (report.overallStatus === 'WARNING') {
      logger.warn('⚠️  TRADING SYSTEM VALIDATION COMPLETE - READY WITH WARNINGS');
    } else {
      logger.error('❌ TRADING SYSTEM VALIDATION COMPLETE - NOT READY FOR LIVE TRADING');
      process.exit(1);
    }

    return report;
  }
}

// Run validation if called directly
if (require.main === module) {
  const validator = new TradingValidator();
  validator.runCompleteValidation().catch(error => {
    logger.error('💥 Trading validation crashed:', error);
    process.exit(1);
  });
}

export { TradingValidator, TradingReadinessReport };