#!/usr/bin/env tsx
/**
 * Reset Emergency Stop
 * Deactivates emergency stop to resume trading
 */

import dotenv from 'dotenv';
dotenv.config();

import { validateEnvironment } from '../src/config/environment';
import { TradingEngine } from '../src/trading/TradingEngine';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    logger.info('🔧 Resetting emergency stop...');

    // Initialize trading engine to access emergency controls
    const config = validateEnvironment();
    const tradingEngine = new TradingEngine(config);

    // Access emergency controls through the trading engine
    const emergencyControls = (tradingEngine as any).emergencyControls;

    // Deactivate emergency stop
    await emergencyControls.deactivateEmergencyStop('Manual reset via CLI script');

    logger.info('✅ Emergency stop deactivated - trading can resume');
    logger.info('💡 Restart the bot to begin trading');

    process.exit(0);
  } catch (error) {
    logger.error('❌ Failed to reset emergency stop:', error);
    process.exit(1);
  }
}

main();
