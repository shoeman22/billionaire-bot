#!/usr/bin/env tsx

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

config();

async function testFeeParameterNames(): Promise<void> {
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

  const feeTests = [
    { name: 'fee', params: { ...baseParams, fee: 500 } },
    { name: 'feeTier', params: { ...baseParams, feeTier: 500 } },
    { name: 'poolFee', params: { ...baseParams, poolFee: 500 } },
    { name: 'swapFee', params: { ...baseParams, swapFee: 500 } },
    { name: 'tradingFee', params: { ...baseParams, tradingFee: 500 } }
  ];

  for (const test of feeTests) {
    console.log(`Testing parameter: ${test.name}`);
    try {
      await gSwap.swaps.swap(test.params);
      console.log(`✅ ${test.name} works!`);
      return;
    } catch (error: any) {
      console.log(`❌ ${test.name}: ${error.message}`);
    }
  }
}

testFeeParameterNames().catch(console.error);