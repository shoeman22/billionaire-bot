import { config } from 'dotenv';
config();

import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { getConfig } from '../../src/config/environment';

async function inspectSDKServices() {
  try {
    console.log('🔍 INSPECTING GSWAP SDK SERVICES...');

    const botConfig = getConfig();
    const privateKey = process.env.WALLET_PRIVATE_KEY!;

    // Create original SDK instance
    const originalSDK = new GSwap({
      signer: new PrivateKeySigner(privateKey),
      walletAddress: botConfig.wallet.address,
      gatewayBaseUrl: botConfig.api.baseUrl,
      dexBackendBaseUrl: botConfig.api.baseUrl,
      bundlerBaseUrl: process.env.GALASWAP_BUNDLE_URL || 'https://bundle-backend-prod1.defi.gala.com'
    });

    console.log('\n📋 AVAILABLE SDK SERVICES:');
    Object.getOwnPropertyNames(originalSDK).forEach(prop => {
      const service = (originalSDK as any)[prop];
      if (service && typeof service === 'object') {
        console.log(`\n🔧 ${prop}:`);
        Object.getOwnPropertyNames(service).forEach(method => {
          if (typeof service[method] === 'function') {
            console.log(`  • ${method}()`);
          }
        });
      }
    });

    // Check specifically for swaps service
    if ((originalSDK as any).swaps) {
      console.log('\n🎯 FOUND SWAPS SERVICE!');
      const swapsService = (originalSDK as any).swaps;

      console.log('\n📋 SWAPS SERVICE METHODS:');
      Object.getOwnPropertyNames(swapsService).forEach(method => {
        if (typeof swapsService[method] === 'function') {
          console.log(`  • swaps.${method}()`);
        }
      });

      // Also check prototype methods
      const prototype = Object.getPrototypeOf(swapsService);
      if (prototype) {
        console.log('\n🔧 SWAPS PROTOTYPE METHODS:');
        Object.getOwnPropertyNames(prototype).forEach(method => {
          if (typeof prototype[method] === 'function' && method !== 'constructor') {
            console.log(`  • swaps.${method}()`);
          }
        });
      }

      // Check constructor methods
      if (swapsService.constructor && swapsService.constructor.prototype) {
        console.log('\n⚙️ SWAPS CONSTRUCTOR PROTOTYPE:');
        Object.getOwnPropertyNames(swapsService.constructor.prototype).forEach(method => {
          if (typeof swapsService.constructor.prototype[method] === 'function' && method !== 'constructor') {
            console.log(`  • swaps.${method}()`);
          }
        });
      }

      // Try to inspect the swap method signature
      if (swapsService.swap) {
        console.log('\n🔍 SWAP METHOD DETAILS:');
        console.log('  • Method exists:', typeof swapsService.swap);
        console.log('  • Method toString:', swapsService.swap.toString().substring(0, 200) + '...');
      }
    } else {
      console.log('\n❌ No swaps service found');
    }

  } catch (error) {
    console.error('❌ SDK inspection error:', error);
  }
}

inspectSDKServices().catch(console.error);