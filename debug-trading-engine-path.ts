/**
 * Debug script to test the exact same code path as TradingEngine
 */

import dotenv from 'dotenv';
import { GSwap, PrivateKeySigner } from './src/services/gswap-simple';
import { validateEnvironment } from './src/config/environment';

// Load environment variables
dotenv.config();

async function testTradingEnginePath() {
  console.log('🔍 Testing exact TradingEngine initialization path...');

  try {
    // Use the EXACT same validation as TradingEngine
    console.log('1. Validating environment (same as TradingEngine)...');
    const config = validateEnvironment();

    console.log('2. Getting private key from environment (same as TradingEngine)...');
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('WALLET_PRIVATE_KEY environment variable is required');
    }

    console.log(`   Private key: ${privateKey.substring(0, 10)}...`);
    console.log(`   Config API baseUrl: ${config.api.baseUrl}`);
    console.log(`   Config wallet address: ${config.wallet.address}`);

    console.log('3. Creating GSwap instance (same as TradingEngine)...');
    const gswap = new GSwap({
      signer: new PrivateKeySigner(privateKey),
      baseUrl: config.api.baseUrl
    });

    console.log('4. Testing getUserAssets call (same as TradingEngine)...');
    try {
      const assetsResponse = await gswap.assets.getUserAssets(config.wallet.address, 1, 20);
      console.log('✅ SUCCESS - TradingEngine path works!');
      console.log('   Tokens found:', assetsResponse?.tokens?.length || 0);
      if (assetsResponse?.tokens) {
        for (const token of assetsResponse.tokens) {
          console.log(`   - ${token.symbol}: ${token.quantity}`);
        }
      }
    } catch (error) {
      console.log('❌ FAILED - TradingEngine path error:', error);
    }

  } catch (error) {
    console.error('❌ Setup error:', error);
  }
}

testTradingEnginePath().catch(console.error);