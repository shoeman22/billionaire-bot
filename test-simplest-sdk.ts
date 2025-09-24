#!/usr/bin/env tsx

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

config();

async function testSimplestSDK(): Promise<void> {
  const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY!);
  const gSwap = new GSwap({
    signer,
    walletAddress: process.env.WALLET_ADDRESS!
  });

  console.log('Testing swap...');

  const swapParams = {
    tokenIn: 'GALA|Unit|none|none',
    tokenOut: 'GUSDC|Unit|none|none',
    fee: 500,
    recipient: process.env.WALLET_ADDRESS!,
    deadline: Math.floor(Date.now() / 1000) + 1200,
    amountIn: 1,
    amountOutMinimum: 0.01,
    sqrtPriceLimitX96: 0
  };

  try {
    const result = await gSwap.swaps.swap(swapParams);
    console.log('SUCCESS!', typeof result);
  } catch (error: any) {
    console.log('Error:', error.message);
    console.log('Error details:', error.details);
  }
}

testSimplestSDK().catch(console.error);