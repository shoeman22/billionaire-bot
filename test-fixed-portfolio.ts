/**
 * Test the fixed portfolio calculation with quoteExactInput
 */

import dotenv from 'dotenv';
import { TradingEngine } from './src/trading/TradingEngine';
import { validateEnvironment } from './src/config/environment';
import { logger } from './src/utils/logger';

dotenv.config();

async function testPortfolioCalculation() {
  console.log('🧪 Testing fixed portfolio calculation...');

  try {
    const config = validateEnvironment();
    const tradingEngine = new TradingEngine(config);

    // TradingEngine initializes on construction
    logger.info('✅ TradingEngine ready');

    // Get portfolio
    console.log('📊 Getting portfolio...');
    const portfolio = await tradingEngine.getPortfolio();

    console.log('💰 Portfolio Results:');
    console.log(`   Total Value: $${portfolio.totalValue?.toFixed(2) || '0.00'}`);
    console.log(`   Total PnL: $${portfolio.pnl?.toFixed(2) || '0.00'}`);
    console.log(`   Positions: ${portfolio.positions?.length || 0}`);

    if (portfolio.positions) {
      for (const position of portfolio.positions) {
        console.log(`   - ${position.token}: ${position.amount} tokens = $${position.value?.toFixed(2) || '0.00'}`);
      }
    }

    if (portfolio.totalValue && portfolio.totalValue > 100) {
      console.log('✅ SUCCESS - Portfolio value looks correct! 🎉');
    } else {
      console.log('❌ Portfolio value still low - may need debugging');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testPortfolioCalculation().catch(console.error);