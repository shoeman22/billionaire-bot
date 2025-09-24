#!/usr/bin/env tsx

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';

config();

async function checkBundleMethods(): Promise<void> {
  const env = validateEnvironment();
  const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY!);
  const gSwap = new GSwap({
    signer,
    walletAddress: env.wallet.address
  });

  logger.info('Checking bundle methods on GSwap instance...');

  // Check all properties on the GSwap instance
  Object.getOwnPropertyNames(gSwap).forEach(prop => {
    const value = (gSwap as any)[prop];
    logger.info(`${prop}: ${typeof value}`);
    if (value && typeof value === 'object' && prop.includes('bundl')) {
      logger.info(`  ${prop} methods:`, Object.getOwnPropertyNames(value));
    }
  });

  // Check if executeBundle exists directly
  logger.info('executeBundle direct:', typeof (gSwap as any).executeBundle);

  // Check for bundler service
  if ((gSwap as any).bundler) {
    logger.info('bundler service methods:', Object.getOwnPropertyNames((gSwap as any).bundler));
  }
}

checkBundleMethods().catch(console.error);