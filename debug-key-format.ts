/**
 * Debug script to check private key formats
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function debugKeyFormat() {
  console.log('🔍 Debugging private key format...');

  const privateKey = process.env.WALLET_PRIVATE_KEY;

  console.log(`Raw private key: ${privateKey}`);
  console.log(`Key length: ${privateKey?.length}`);
  console.log(`Starts with 0x: ${privateKey?.startsWith('0x')}`);

  if (privateKey) {
    // Test if it's valid base64
    try {
      const base64Test = Buffer.from(privateKey, 'base64');
      console.log(`✅ Valid base64 (decoded length: ${base64Test.length})`);
    } catch (error) {
      console.log(`❌ Invalid base64:`, error);
    }

    // Test if it's hex (with 0x prefix)
    if (privateKey.startsWith('0x')) {
      try {
        const hexTest = Buffer.from(privateKey.slice(2), 'hex');
        console.log(`✅ Valid hex (decoded length: ${hexTest.length})`);

        // Convert to base64
        const base64Key = hexTest.toString('base64');
        console.log(`Base64 equivalent: ${base64Key}`);
      } catch (error) {
        console.log(`❌ Invalid hex:`, error);
      }
    }
  }
}

debugKeyFormat().catch(console.error);