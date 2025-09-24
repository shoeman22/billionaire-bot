#!/usr/bin/env tsx

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

config();

async function testSimpleFix(): Promise<void> {
  const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY!);
  const gSwap = new GSwap({
    signer,
    walletAddress: process.env.WALLET_ADDRESS!
  });

  const baseParams = {
    tokenIn: 'GALA|Unit|none|none',
    tokenOut: 'GUSDC|Unit|none|none',
    recipient: process.env.WALLET_ADDRESS!,
    deadline: Math.floor(Date.now() / 1000) + 1200,
    amountIn: 1,
    amountOutMinimum: 0.01,
    sqrtPriceLimitX96: 0
  };

  // Test simple type variations
  const tests = [
    { name: 'number 500', fee: 500 },
    { name: 'string "500"', fee: "500" },
    { name: 'explicit Number(500)', fee: Number(500) },
    { name: 'parseInt("500")', fee: parseInt("500") },
    { name: 'BigNumber-like', fee: { toString: () => "500", toNumber: () => 500 } }
  ];

  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    try {
      await gSwap.swaps.swap({ ...baseParams, fee: test.fee });
      console.log(`✅ SUCCESS: ${test.name} works!`);
      return;
    } catch (error: any) {
      console.log(`❌ ${test.name}: ${error.message}`);
    }
  }
}

testSimpleFix().catch(console.error);