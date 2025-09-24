#!/usr/bin/env tsx

import { config } from 'dotenv';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { validateEnvironment } from './src/config/environment';
import { logger } from './src/utils/logger';

config();

async function checkBundlerPrototype(): Promise<void> {
  const env = validateEnvironment();
  const signer = new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY!);
  const gSwap = new GSwap({
    signer,
    walletAddress: env.wallet.address
  });

  const bundler = (gSwap as any).bundler;
  if (bundler) {
    logger.info('Bundler prototype methods:');
    const prototype = Object.getPrototypeOf(bundler);
    if (prototype) {
      Object.getOwnPropertyNames(prototype).forEach(prop => {
        if (typeof prototype[prop] === 'function' && prop !== 'constructor') {
          logger.info(`  ${prop}: function`);
        }
      });
    }

    // Check if executeBundle exists on the prototype
    logger.info('executeBundle on bundler:', typeof bundler.executeBundle);
    logger.info('execute on bundler:', typeof bundler.execute);
    logger.info('submit on bundler:', typeof bundler.submit);
  }

  // Also check the original inspection results
  logger.info('\\nFrom previous inspection:');
  Object.getOwnPropertyNames(gSwap).forEach(prop => {
    const service = (gSwap as any)[prop];
    if (service && typeof service === 'object' && prop === 'bundler') {
      logger.info(`\\n🔧 ${prop}:`);
      Object.getOwnPropertyNames(service).forEach(method => {
        if (typeof service[method] === 'function') {
          logger.info(`  • ${method}()`);
        }
      });
    }
  });
}

checkBundlerPrototype().catch(console.error);