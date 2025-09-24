/**
 * Debug script to test balance retrieval with different methods
 */

import dotenv from 'dotenv';
import { GSwap, PrivateKeySigner } from './src/services/gswap-simple';

// Load environment variables
dotenv.config();

async function testBalanceRetrieval() {
  console.log('🔍 Testing balance retrieval methods...');

  const privateKey = process.env.WALLET_PRIVATE_KEY;
  const walletAddress = process.env.WALLET_ADDRESS;
  const baseUrl = process.env.GALASWAP_API_URL;

  if (!privateKey || !walletAddress || !baseUrl) {
    console.error('❌ Missing required environment variables');
    return;
  }

  console.log('📋 Configuration:');
  console.log(`  Wallet: ${walletAddress}`);
  console.log(`  API URL: ${baseUrl}`);
  console.log(`  Private Key: ${privateKey ? '[PRESENT]' : '[MISSING]'}`);

  try {
    const gswap = new GSwap({
      signer: new PrivateKeySigner(privateKey),
      baseUrl: baseUrl
    });

    console.log('\n🧪 Test 1: Direct getUserAssets call');
    try {
      const assets = await gswap.assets.getUserAssets(walletAddress, 1, 20);
      console.log('✅ Success:', assets);
    } catch (error) {
      console.log('❌ Failed:', error);
    }

    console.log('\n🧪 Test 2: Try with smaller limit');
    try {
      const assets = await gswap.assets.getUserAssets(walletAddress, 1, 5);
      console.log('✅ Success:', assets);
    } catch (error) {
      console.log('❌ Failed:', error);
    }

    console.log('\n🧪 Test 3: Test different URL encoding');
    try {
      const encodedAddress = encodeURIComponent(walletAddress);
      console.log(`  Encoded address: ${encodedAddress}`);
      const assets = await gswap.assets.getUserAssets(encodedAddress, 1, 10);
      console.log('✅ Success:', assets);
    } catch (error) {
      console.log('❌ Failed:', error);
    }

    console.log('\n🧪 Test 4: Raw HTTP request to assets endpoint');
    try {
      const url = `${baseUrl}/user/assets?address=${encodeURIComponent(walletAddress)}&page=1&limit=5`;
      console.log(`  URL: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      });

      const responseText = await response.text();
      console.log(`  Status: ${response.status}`);
      console.log(`  Response: ${responseText}`);

      if (response.ok) {
        const data = JSON.parse(responseText);
        console.log('✅ Raw HTTP Success:', data);
      } else {
        console.log('❌ Raw HTTP Failed');
      }
    } catch (error) {
      console.log('❌ Raw HTTP Error:', error);
    }

  } catch (error) {
    console.error('❌ Setup error:', error);
  }
}

testBalanceRetrieval().catch(console.error);