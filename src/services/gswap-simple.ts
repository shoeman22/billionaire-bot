/**
 * Simple GSwap SDK Wrapper
 * Minimal wrapper that just provides baseUrl override for native SDK
 */

import { GSwap as SDKGSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

interface SimpleGSwapOptions {
  signer?: PrivateKeySigner;
  baseUrl?: string;
  gatewayBaseUrl?: string;
  dexBackendBaseUrl?: string;
  bundlerBaseUrl?: string;
  walletAddress?: string;
  privateKey?: string;
}

/**
 * Simple wrapper that uses native SDK with URL override
 */
export class GSwap extends SDKGSwap {
  constructor(options: SimpleGSwapOptions) {
    // Use baseUrl if provided, otherwise fall back to gatewayBaseUrl
    const gatewayUrl = options.baseUrl || options.gatewayBaseUrl || 'https://dex-backend-prod1.defi.gala.com';

    super({
      signer: options.signer,
      gatewayBaseUrl: gatewayUrl,
      walletAddress: options.walletAddress
    });

    // Add stub methods for dev scripts compatibility
    (this as any).getQuote = async (_token0: string, _token1: string, _amount: string, _fee?: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      throw new Error('getQuote is a stub method for dev scripts - not implemented in SDK');
    };

    (this as any).getTokenPrice = async (_token: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      throw new Error('getTokenPrice is a stub method for dev scripts - not implemented in SDK');
    };

    (this as any).getAvailablePools = async () => { // eslint-disable-line @typescript-eslint/no-explicit-any
      throw new Error('getAvailablePools is a stub method for dev scripts - not implemented in SDK');
    };
  }
}

// Re-export everything else from the SDK
export { PrivateKeySigner } from '@gala-chain/gswap-sdk';

// Alias for compatibility with dev scripts
export { GSwap as GSwapWrapper };

// Export TradingEngine for dev scripts
export { TradingEngine } from '../trading/TradingEngine';

// Add stub methods for dev scripts compatibility
declare module '@gala-chain/gswap-sdk' {
  interface GSwap {
    getQuote: (token0: string, token1: string, amount: string, fee?: number) => Promise<{ outAmount: string; impact: number }>;
    getTokenPrice: (token: string) => Promise<number>;
    getAvailablePools: () => Promise<Array<{ token0: string; token1: string; fee: number }>>;
  }
}