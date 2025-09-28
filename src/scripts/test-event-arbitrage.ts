/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Event Arbitrage Strategy Test
 *
 * Test the in-game event arbitrage system:
 * - Game calendar functionality
 * - Event opportunity detection
 * - Position management
 * - Risk controls
 */

import { gameCalendar, EventType, EventCategory, EventImpactLevel } from '../data/game-calendar';
import { EventArbitrageStrategy } from '../trading/strategies/event-arbitrage';
import { GSwap } from '../services/gswap-simple';
import { TradingConfig } from '../config/environment';
import { SwapExecutor } from '../trading/execution/swap-executor';
import { logger } from '../utils/logger';

async function testGameCalendar(): Promise<void> {
  logger.info('\n🗓️ Testing Game Calendar...');

  // Get calendar stats
  const stats = gameCalendar.getStats();
  logger.info('Calendar Stats:', {
    totalEvents: stats.totalEvents,
    upcomingEvents: stats.upcomingEvents,
    averageAccuracy: (stats.averageAccuracy * 100).toFixed(1) + '%'
  });

  // Get upcoming high-impact events
  const highImpactEvents = gameCalendar.getHighImpactEvents(7);
  logger.info(`High Impact Events (next 7 days): ${highImpactEvents.length}`);

  highImpactEvents.forEach(event => {
    logger.info(`  - ${event.name}: ${event.impactLevel} impact, ${(event.confidence * 100).toFixed(1)}% confidence`);
  });

  // Get GALA token events
  const galaEvents = gameCalendar.getTokenEvents('GALA|Unit|none|none', 14);
  logger.info(`GALA Events (next 14 days): ${galaEvents.length}`);

  // Test adding a custom event
  try {
    gameCalendar.addEvent({
      id: 'test-tournament-' + Date.now(),
      name: 'Test Gaming Tournament',
      description: 'Test tournament for verification',
      type: EventType.COMMUNITY_TOURNAMENT,
      category: EventCategory.TOURNAMENT,
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      endDate: new Date(Date.now() + 25 * 60 * 60 * 1000),   // Tomorrow + 1 hour
      timezone: 'UTC',
      game: 'gala',
      relatedGames: [],
      impactTokens: ['GALA|Unit|none|none'],
      secondaryTokens: [],
      expectedImpact: {
        preEventRun: 0.05, // 5% run-up
        preEventDays: 2,
        eventPeak: 0.03, // 3% during event
        postEventDump: -0.04, // -4% dump
        postEventDays: 1,
        recoveryTime: 3,
        volumeIncrease: 1.8,
        volatilityIncrease: 1.4
      },
      impactLevel: EventImpactLevel.LOW,
      confidence: 0.7,
      historicalAccuracy: 0.65,
      dataQuality: 0.8,
      sources: [{
        type: 'community',
        name: 'Test Source',
        reliability: 0.7,
        timestamp: Date.now()
      }],
      lastUpdated: Date.now(),
      verified: false,
      tradingStrategy: {
        approach: 'pre_event',
        entryTiming: -48, // 48 hours before
        exitTiming: 4,    // 4 hours after start
        positionSize: 0.02,
        stopLoss: 0.03,
        takeProfit: 0.06,
        direction: 'long'
      },
      riskLevel: 'low',
      status: 'scheduled'
    });

    logger.info('✅ Successfully added test event');
  } catch (error) {
    logger.error('❌ Failed to add test event:', error);
  }
}

async function testEventArbitrageStrategy(): Promise<void> {
  logger.info('\n🎮 Testing Event Arbitrage Strategy...');

  try {
    // Create mock dependencies
    const mockGSwap = {} as GSwap;
    const mockConfig = {
      walletPrivateKey: 'test-key',
      enableRealTrading: false,
      maxPositionSize: 1000
    } as TradingConfig;
    const mockSwapExecutor = {} as SwapExecutor;
    class MockMarketAnalysis {
      async analyzeMarket() {
        return {
          overall: 'sideways' as const,
          volatility: 'medium' as const,
          liquidity: 'good' as const,
          sentiment: 'neutral' as const,
          confidence: 0.75,
          analysis: {
            trend: { direction: 'sideways' as const, strength: 0.3 },
            support: 0.045,
            resistance: 0.055,
            volume: { current: 1000000, average: 900000 },
            momentum: { rsi: 50, macd: 0.001 }
          }
        };
      }
    }
    const mockMarketAnalysis = new MockMarketAnalysis();

    // Create strategy instance
    const strategy = new EventArbitrageStrategy(
      mockGSwap,
      mockConfig,
      mockSwapExecutor,
      mockMarketAnalysis as any
    );

    // Test strategy initialization
    logger.info('Strategy initialized:', strategy.getIsActive());

    // Get strategy stats (before starting)
    const initialStats = strategy.getStats();
    logger.info('Initial Strategy Stats:', {
      isActive: initialStats.isActive,
      totalPositions: initialStats.positions.total,
      upcomingOpportunities: initialStats.upcomingOpportunities
    });

    // Test opportunity scanning
    logger.info('\n🔍 Scanning for event opportunities...');
    const opportunities = await strategy.scanForEventOpportunities();
    logger.info(`Found ${opportunities.length} opportunities`);

    if (opportunities.length > 0) {
      logger.info('Top Opportunity:', {
        event: opportunities[0].event.name,
        token: opportunities[0].token,
        direction: opportunities[0].direction,
        entryScore: opportunities[0].entryScore.toFixed(1),
        expectedReturn: (opportunities[0].expectedReturn * 100).toFixed(2) + '%',
        recommendedSize: (opportunities[0].recommendedPositionSize * 100).toFixed(2) + '%'
      });
    }

    // Test strategy configuration update
    strategy.updateConfig({
      maxTotalExposure: 0.12, // 12%
      maxPositionSize: 0.03,  // 3%
      minEventConfidence: 0.65 // 65%
    });
    logger.info('✅ Strategy configuration updated');

    // Test capital allocation
    strategy.setTotalCapital(75000); // $75k
    logger.info('✅ Capital allocation updated');

    logger.info('\n📊 Final Strategy Stats:', strategy.getStats());

  } catch (error) {
    logger.error('❌ Error testing Event Arbitrage Strategy:', error);
  }
}

async function testEventImpactPrediction(): Promise<void> {
  logger.info('\n🎯 Testing Event Impact Prediction...');

  // Get upcoming events with their impact predictions
  const upcomingEvents = gameCalendar.getUpcomingEvents(72); // Next 3 days

  logger.info(`Analyzing ${upcomingEvents.length} upcoming events...`);

  upcomingEvents.forEach(event => {
    const hoursUntilEvent = (event.startDate.getTime() - Date.now()) / (1000 * 60 * 60);

    logger.info(`\n📅 ${event.name}`);
    logger.info(`   Time until event: ${hoursUntilEvent.toFixed(1)} hours`);
    logger.info(`   Impact Level: ${event.impactLevel}`);
    logger.info(`   Confidence: ${(event.confidence * 100).toFixed(1)}%`);
    logger.info(`   Expected Pre-Event Run: ${(event.expectedImpact.preEventRun * 100).toFixed(1)}%`);
    logger.info(`   Expected Peak Impact: ${(event.expectedImpact.eventPeak * 100).toFixed(1)}%`);
    logger.info(`   Expected Post-Event Dump: ${(event.expectedImpact.postEventDump * 100).toFixed(1)}%`);
    logger.info(`   Volume Increase: ${(event.expectedImpact.volumeIncrease * 100).toFixed(0)}%`);
    logger.info(`   Trading Strategy: ${event.tradingStrategy.approach} (${event.tradingStrategy.direction})`);
    logger.info(`   Risk Level: ${event.riskLevel}`);
    logger.info(`   Impacted Tokens: ${event.impactTokens.join(', ')}`);
  });
}

async function testRiskManagement(): Promise<void> {
  logger.info('\n🛡️ Testing Risk Management...');

  // Test various risk scenarios
  const scenarios = [
    {
      name: 'High Confidence Galaverse Event',
      confidence: 0.85,
      impactLevel: EventImpactLevel.HIGH,
      expectedReturn: 0.20,
      marketVolatility: 'medium'
    },
    {
      name: 'Low Confidence Tournament',
      confidence: 0.45,
      impactLevel: EventImpactLevel.MEDIUM,
      expectedReturn: 0.08,
      marketVolatility: 'high'
    },
    {
      name: 'Maintenance Window Arbitrage',
      confidence: 0.90,
      impactLevel: EventImpactLevel.LOW,
      expectedReturn: 0.015,
      marketVolatility: 'low'
    }
  ];

  scenarios.forEach(scenario => {
    logger.info(`\n📊 Scenario: ${scenario.name}`);
    logger.info(`   Confidence: ${(scenario.confidence * 100).toFixed(1)}%`);
    logger.info(`   Impact Level: ${scenario.impactLevel}`);
    logger.info(`   Expected Return: ${(scenario.expectedReturn * 100).toFixed(1)}%`);
    logger.info(`   Market Volatility: ${scenario.marketVolatility}`);

    // Simple risk score calculation
    let riskScore = 0.3; // Base risk
    riskScore += (1 - scenario.confidence) * 0.3; // Confidence risk

    if (scenario.marketVolatility === 'high') riskScore += 0.2;
    else if (scenario.marketVolatility === 'medium') riskScore += 0.1;

    const riskAdjustedReturn = scenario.expectedReturn * (1 - riskScore);

    logger.info(`   Risk Score: ${(riskScore * 100).toFixed(1)}%`);
    logger.info(`   Risk-Adjusted Return: ${(riskAdjustedReturn * 100).toFixed(2)}%`);
    logger.info(`   Recommendation: ${riskScore > 0.7 ? '❌ SKIP' : riskAdjustedReturn > 0.03 ? '✅ EXECUTE' : '⚠️ MONITOR'}`);
  });
}

async function main(): Promise<void> {
  try {
    logger.info('🚀 Event Arbitrage Strategy Test Suite\n');
    logger.info('Testing in-game event arbitrage for GalaSwap V3 trading bot');
    logger.info('Current Capital: 34,062 GALA ($541 USD) - REAL FUNDS AT RISK');
    logger.info('=====================================\n');

    await testGameCalendar();
    await testEventArbitrageStrategy();
    await testEventImpactPrediction();
    await testRiskManagement();

    logger.info('\n✅ Event Arbitrage Test Suite Completed Successfully');
    logger.info('\n🎮 Key Gaming Event Categories Supported:');
    logger.info('   • Tournament Events: Esports, community competitions, championships');
    logger.info('   • Development Events: Game updates, season launches, DLC releases');
    logger.info('   • Community Events: Challenges, governance votes, staking events');
    logger.info('   • Economic Events: Node sales, token burns, partnerships');

    logger.info('\n🎯 Event-Driven Trading Features:');
    logger.info('   • Pre-event positioning (48-72 hours before events)');
    logger.info('   • Tournament token trading before competitive events');
    logger.info('   • Meta-game shift positioning for updates');
    logger.info('   • Resource scarcity exploitation during events');
    logger.info('   • Multi-phase trading (pre, during, post-event)');

    logger.info('\n🛡️ Risk Management:');
    logger.info('   • Maximum 4% position per event');
    logger.info('   • Total event arbitrage exposure: 15% of capital');
    logger.info('   • Event confidence minimum: 60%');
    logger.info('   • Maximum hold time: 7 days');
    logger.info('   • Circuit breaker if strategy underperforms 3 months');

  } catch (error) {
    logger.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run the test immediately
main().catch(error => {
  logger.error('❌ Event Arbitrage test failed:', error);
  process.exit(1);
});