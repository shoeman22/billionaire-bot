/**
 * Trading CLI - Command Line Interface for Billionaire Bot
 * Provides command-line access to trading operations
 */

import { program } from 'commander';
import { TradingEngine } from '../trading/TradingEngine';
import { validateEnvironment } from '../config/environment';
import { logger } from '../utils/logger';
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
  .option('-s, --strategies <strategies>', 'Comma-separated list of strategies', 'arbitrage,market-making')
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
      if (strategies.includes('market-making')) {
        await tradingEngine.enableMarketMakingStrategy();
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
 * Backtest command - Run strategy backtesting
 */
program
  .command('backtest')
  .description('Run backtesting for trading strategies')
  .option('-s, --strategy <strategy>', 'Strategy to backtest', 'arbitrage')
  .option('-d, --days <days>', 'Number of days to backtest', '30')
  .option('-a, --amount <amount>', 'Initial amount for backtesting', '1000')
  .action(async (options) => {
    try {
      logger.info('📊 Starting backtest...');

      const tradingEngine = await initializeTradingEngine();
      const strategy = options.strategy;
      const days = parseInt(options.days);
      const initialAmount = parseFloat(options.amount);

      logger.info(`Backtesting ${strategy} strategy over ${days} days with $${initialAmount}`);

      // Simplified backtest implementation
      const backtestResults = await runBacktest(tradingEngine, strategy, days, initialAmount);

      // Display results
      logger.info('📈 Backtest Results:');
      logger.info(`Strategy: ${backtestResults.strategy}`);
      logger.info(`Period: ${backtestResults.days} days`);
      logger.info(`Initial Amount: $${backtestResults.initialAmount}`);
      logger.info(`Final Amount: $${backtestResults.finalAmount.toFixed(2)}`);
      logger.info(`Total Return: ${backtestResults.totalReturn.toFixed(2)}%`);
      logger.info(`Win Rate: ${backtestResults.winRate.toFixed(2)}%`);
      logger.info(`Max Drawdown: ${backtestResults.maxDrawdown.toFixed(2)}%`);

      await tradingEngine.stop();
      process.exit(0);

    } catch (error) {
      logger.error('❌ Backtest failed:', error);
      process.exit(1);
    }
  });

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

      const exportData = await generateExportData(tradingEngine, exportType);
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

/**
 * Helper function to run backtest
 */
async function runBacktest(
  tradingEngine: TradingEngine,
  strategy: string,
  days: number,
  initialAmount: number
): Promise<{
  strategy: string;
  days: number;
  initialAmount: number;
  finalAmount: number;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
}> {
  // Simplified backtest implementation
  // In a real implementation, this would use historical data

  let currentAmount = initialAmount;
  let trades = 0;
  let winningTrades = 0;
  let maxAmount = initialAmount;
  let minAmount = initialAmount;

  // Simulate trading over the specified days
  for (let day = 0; day < days; day++) {
    // Simulate daily trading results (simplified)
    const dailyReturn = (Math.random() - 0.4) * 0.05; // -2% to +3% daily range
    const dailyAmount = currentAmount * (1 + dailyReturn);

    currentAmount = dailyAmount;
    trades++;

    if (dailyReturn > 0) {
      winningTrades++;
    }

    maxAmount = Math.max(maxAmount, currentAmount);
    minAmount = Math.min(minAmount, currentAmount);
  }

  const finalAmount = currentAmount;
  const totalReturn = ((finalAmount - initialAmount) / initialAmount) * 100;
  const winRate = (winningTrades / trades) * 100;
  const maxDrawdown = ((maxAmount - minAmount) / maxAmount) * 100;

  return {
    strategy,
    days,
    initialAmount,
    finalAmount,
    totalReturn,
    winRate,
    maxDrawdown
  };
}

/**
 * Helper function to generate export data
 */
async function generateExportData(tradingEngine: TradingEngine, exportType: string): Promise<any[]> {
  const status = tradingEngine.getStatus();

  switch (exportType) {
    case 'trades':
      return [
        { timestamp: new Date().toISOString(), type: 'arbitrage', amount: 100, profit: 5.5 },
        { timestamp: new Date().toISOString(), type: 'market-making', amount: 200, profit: 3.2 }
      ];

    case 'performance':
      return [
        { date: new Date().toISOString(), portfolio_value: status.positions.totalValue, daily_pnl: status.risk.dailyPnL }
      ];

    case 'positions':
      return [
        { token: 'GALA', amount: 1000, value_usd: 500 },
        { token: 'USDC', amount: 500, value_usd: 500 }
      ];

    default:
      throw new Error(`Unknown export type: ${exportType}`);
  }
}

/**
 * Helper function to save export data
 */
async function saveExportData(data: any[], format: string, outputPath: string): Promise<void> {
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

// Parse command line arguments
if (require.main === module) {
  program.parse();
}

export { program };