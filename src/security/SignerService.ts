/**
 * Secure Signer Service
 * Handles private key operations without exposing the raw key
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { PayloadSigner, SignablePayload, SignedPayload } from '../utils/signing';

export interface SignerConfig {
  walletAddress: string;
}

/**
 * Secure service for handling signing operations without exposing private keys
 */
export class SignerService {
  private signer: PayloadSigner;
  private walletAddress: string;
  private isInitialized: boolean = false;

  constructor(config: SignerConfig) {
    this.walletAddress = config.walletAddress;
    this.signer = this.initializeSigner();
    this.isInitialized = true;

    logger.info('SignerService initialized for address:',
      config.walletAddress.substring(0, 10) + '...'
    );
  }

  /**
   * Initialize the signer from environment variables
   */
  private initializeSigner(): PayloadSigner {
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('WALLET_PRIVATE_KEY environment variable is required');
    }

    // Validate private key format
    try {
      Buffer.from(privateKey, 'base64');
    } catch (error) {
      throw new Error('WALLET_PRIVATE_KEY must be a valid base64 encoded key');
    }

    // Create signer without storing the private key
    return new PayloadSigner({
      privateKey,
      userAddress: this.walletAddress
    });
  }

  /**
   * Sign a payload using the secure signer
   */
  async signPayload(payload: SignablePayload): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('SignerService not initialized');
    }

    try {
      return await this.signer.signPayload(payload);
    } catch (error) {
      logger.error('Error signing payload:', error);
      throw new Error('Failed to sign payload');
    }
  }

  /**
   * Create a signed transaction
   */
  async createSignedTransaction(payload: SignablePayload): Promise<SignedPayload> {
    if (!this.isInitialized) {
      throw new Error('SignerService not initialized');
    }

    try {
      return await this.signer.createSignedTransaction(payload);
    } catch (error) {
      logger.error('Error creating signed transaction:', error);
      throw new Error('Failed to create signed transaction');
    }
  }

  /**
   * Sign a bundle request for GalaSwap
   */
  async signBundleRequest(bundlePayload: SignablePayload, operationType: string): Promise<{ payload: SignablePayload; signature: string }> {
    if (!this.isInitialized) {
      throw new Error('SignerService not initialized');
    }

    try {
      return await this.signer.signBundleRequest(bundlePayload, operationType);
    } catch (error) {
      logger.error('Error signing bundle request:', error);
      throw new Error('Failed to sign bundle request');
    }
  }

  /**
   * Sign a message (for authentication)
   */
  async signMessage(message: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('SignerService not initialized');
    }

    try {
      return await this.signer.signMessage(message);
    } catch (error) {
      logger.error('Error signing message:', error);
      throw new Error('Failed to sign message');
    }
  }

  /**
   * Get the wallet address (safe to expose)
   */
  getWalletAddress(): string {
    return this.walletAddress;
  }

  /**
   * Get public key (safe to expose)
   */
  getPublicKey(): string {
    if (!this.isInitialized) {
      throw new Error('SignerService not initialized');
    }

    return this.signer.getPublicKey();
  }

  /**
   * Verify a signature
   */
  async verifySignature(payload: SignablePayload, signature: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('SignerService not initialized');
    }

    try {
      return await this.signer.verifySignature(payload, signature);
    } catch (error) {
      logger.error('Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Security utility - check if signer is properly initialized
   */
  isReady(): boolean {
    return this.isInitialized && !!this.signer;
  }

  /**
   * Generate operation key for transactions
   */
  generateOperationKey(prefix: string = 'trading-operation'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const hash = createHash('sha256')
      .update(`${this.walletAddress}-${timestamp}-${random}`)
      .digest('hex')
      .substring(0, 8);

    return `${prefix}-${timestamp.toString(36)}-${hash}`;
  }

  /**
   * Clean shutdown - clear sensitive data
   */
  destroy(): void {
    // Clear any cached data
    this.isInitialized = false;
    logger.info('SignerService destroyed');
  }
}

/**
 * Factory function to create signer service
 */
export function createSignerService(walletAddress: string): SignerService {
  return new SignerService({ walletAddress });
}