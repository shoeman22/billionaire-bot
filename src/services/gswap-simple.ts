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
      gatewayBaseUrl: gatewayUrl
    });
  }
}

// Re-export everything else from the SDK
export { PrivateKeySigner } from '@gala-chain/gswap-sdk';