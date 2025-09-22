/**
 * Trading CLI - Command Line Interface for Billionaire Bot
 * Provides command-line access to trading operations
 */

import { program } from 'commander';
import { TradingEngine } from '../trading/TradingEngine';
import { validateEnvironment } from '../config/environment';
import { logger } from '../utils/logger';
// safeParseFloat removed - not used in CLI anymore
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Initialize trading engine for CLI commands
 */
async function initializeTradingEngine(): Promise<TradingEngine> {
  const config = validateEnvironment();
  const tradingEngine = new TradingEngine(config);
  await tradingEngine.start();
  return tradingEngine;
}

/**
 * Auto-trade command - Start automated trading
 */
program
  .command('auto-trade')
  .description('Start automated trading with all strategies')
  .option('-d, --duration <duration>', 'Trading duration in minutes', '60')
  .option('-s, --strategies <strategies>', 'Comma-separated list of strategies', 'arbitrage')
  .action(async (options) => {
    try {
      logger.info('🤖 Starting auto-trade mode...');

      const tradingEngine = await initializeTradingEngine();
      const duration = parseInt(options.duration) * 60 * 1000; // Convert to milliseconds
      const strategies = options.strategies.split(',');

      logger.info(`Auto-trading for ${options.duration} minutes with strategies: ${strategies.join(', ')}`);

      // Enable specified strategies
      if (strategies.includes('arbitrage')) {
        await tradingEngine.enableArbitrageStrategy();
      }

      // Run for specified duration
      setTimeout(async () => {
        logger.info('⏰ Auto-trade duration completed, stopping...');
        await tradingEngine.stop();
        process.exit(0);
      }, duration);

      // Handle manual interruption
      process.on('SIGINT', async () => {
        logger.info('🛑 Auto-trade interrupted, stopping...');
        await tradingEngine.stop();
        process.exit(0);
      });

      logger.info('✅ Auto-trade mode started successfully');

    } catch (error) {
      logger.error('❌ Auto-trade failed:', error);
      process.exit(1);
    }
  });

/**
 * Backtest command - REMOVED: No historical data available yet
 * Note: Will be implemented in future versions when historical price data becomes available
 */
// Backtest command removed - requires historical data not yet available in SDK v0.0.7

/**
 * Export command - Export trading data and reports
 */
program
  .command('export')
  .description('Export trading data and performance reports')
  .option('-t, --type <type>', 'Export type (trades, performance, positions)', 'trades')
  .option('-f, --format <format>', 'Export format (json, csv)', 'csv')
  .option('-o, --output <output>', 'Output file path', './export.csv')
  .action(async (options) => {
    try {
      logger.info('📤 Starting data export...');

      const tradingEngine = await initializeTradingEngine();
      const exportType = options.type;
      const format = options.format;
      const outputPath = options.output;

      logger.info(`Exporting ${exportType} data in ${format} format to ${outputPath}`);

      const exportData = await generateRealExportData(tradingEngine, exportType);
      await saveExportData(exportData, format, outputPath);

      logger.info(`✅ Export completed: ${outputPath}`);

      await tradingEngine.stop();
      process.exit(0);

    } catch (error) {
      logger.error('❌ Export failed:', error);
      process.exit(1);
    }
  });

/**
 * Status command - Get current bot status
 */
program
  .command('status')
  .description('Get current trading bot status')
  .action(async () => {
    try {
      const tradingEngine = await initializeTradingEngine();
      const status = tradingEngine.getStatus();

      logger.info('🤖 Billionaire Bot Status:');
      logger.info(`Running: ${status.isRunning ? '✅' : '❌'}`);
      logger.info(`Uptime: ${Math.floor(status.uptime / 60)} minutes`);
      logger.info(`API Health: ${status.apiHealth ? '✅' : '❌'}`);
      logger.info(`Active Strategies: ${Object.keys(status.strategies).filter(s => status.strategies[s].isActive).join(', ')}`);
      logger.info(`Total Portfolio Value: $${status.positions.totalValue || 0}`);
      logger.info(`Daily P&L: $${status.risk.dailyPnL || 0}`);

      await tradingEngine.stop();
      process.exit(0);

    } catch (error) {
      logger.error('❌ Status check failed:', error);
      process.exit(1);
    }
  });

// Backtest function removed - mock implementations not allowed

/**
 * Helper function to generate real export data from TradingEngine
 */
async function generateRealExportData(tradingEngine: TradingEngine, exportType: string): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const status = tradingEngine.getStatus();
  const portfolio = await tradingEngine.getPortfolio();

  switch (exportType) {
    case 'trades':
      // Note: Trade history tracking will be implemented in future versions
      // For now, return empty array as no mock data is allowed
      logger.warn('Trade export not yet implemented - no trade history tracking in current TradingEngine');
      return [];

    case 'performance':
      return [
        {
          date: new Date().toISOString(),
          portfolio_value: portfolio.totalValue || 0,
          daily_pnl: portfolio.pnl || 0,
          total_pnl: portfolio.pnl || 0, // Use pnl field (totalPnL doesn't exist)
          uptime_minutes: Math.floor((status.uptime || 0) / 60),
          api_health: status.apiHealth ? 'healthy' : 'unhealthy',
          active_strategies: Object.keys(status.strategies || {}).filter(s => status.strategies[s]?.isActive).join(',')
        }
      ];

    case 'positions':
      // Use real portfolio positions if available
      if (portfolio.positions && portfolio.positions.length > 0) {
        return portfolio.positions.map((position: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
          token: position.token || position.symbol || 'unknown',
          amount: position.amount || position.balance || 0,
          value_usd: position.valueUsd || position.value || 0
        }));
      } else if (portfolio.balances && portfolio.balances.length > 0) {
        return portfolio.balances.map((balance: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
          token: balance.token || balance.symbol || 'unknown',
          amount: balance.amount || balance.balance || 0,
          value_usd: balance.valueUsd || balance.value || 0
        }));
      } else {
        logger.warn('No position data available - portfolio may be empty');
        return [];
      }

    default:
      throw new Error(`Unknown export type: ${exportType}`);
  }
}

/**
 * Helper function to save export data
 */
async function saveExportData(data: any[], format: string, outputPath: string): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const fs = await import('fs');

  if (format === 'json') {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  } else if (format === 'csv') {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).join(','));
    const csv = [headers, ...rows].join('\n');

    fs.writeFileSync(outputPath, csv);
  } else {
    throw new Error(`Unknown format: ${format}`);
  }
}

// Configure program
program
  .name('billionaire-bot')
  .description('Command Line Interface for Billionaire Bot trading operations')
  .version('1.0.0');

// Parse command line arguments (ESM compatible)
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { program };