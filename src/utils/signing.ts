/**
 * Payload Signing Utilities for GalaChain Integration
 * Secure transaction signing using @gala-chain/api and fallback implementations
 */

import { createHash } from 'crypto';
import { ec as EC } from 'elliptic';
import { keccak256 } from 'js-sha3';
import stringify from 'json-stringify-deterministic';
import { logger } from './logger';

const ec = new EC('secp256k1');

export interface SigningConfig {
  privateKey: string; // Base64 encoded private key
  userAddress: string; // User's wallet address
}

export interface SignablePayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  uniqueKey?: string;
}

export interface SignedPayload extends SignablePayload {
  signature: string;
  timestamp: number;
}

export class PayloadSigner {
  private privateKey: string;
  private keyPair: EC.KeyPair;
  private userAddress: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private galaChainSdk: any = null; // Will be dynamically loaded

  constructor(config: SigningConfig) {
    this.userAddress = config.userAddress;

    try {
      // Decode base64 private key
      this.privateKey = Buffer.from(config.privateKey, 'base64').toString('hex');

      // Create key pair
      this.keyPair = ec.keyFromPrivate(this.privateKey);

      logger.info('Payload signer initialized for address:',
        config.userAddress.substring(0, 10) + '...'
      );

      // Try to load GalaChain SDK
      this.loadGalaChainSdk();

    } catch (error) {
      logger.error('Failed to initialize payload signer:', error);
      throw new Error('Invalid private key format');
    }
  }

  /**
   * Attempt to load @gala-chain/api SDK
   */
  private async loadGalaChainSdk(): Promise<void> {
    try {
      // Try to dynamically import @gala-chain/api
      const galaApi = await import('@gala-chain/api');
      this.galaChainSdk = galaApi;
      logger.info('GalaChain SDK loaded successfully');
    } catch (error) {
      logger.warn('GalaChain SDK not available, using fallback signing:', (error as Error)?.message || 'Unknown error');
      // Fallback implementation will be used
    }
  }

  /**
   * Sign a payload using GalaChain SDK or fallback implementation
   */
  async signPayload(payload: SignablePayload): Promise<string> {
    try {
      // Ensure payload has a uniqueKey (required for GalaChain)
      if (!payload.uniqueKey) {
        payload.uniqueKey = `galaswap-operation-${this.generateUniqueKey()}`;
      }

      // Try GalaChain SDK first
      if (this.galaChainSdk && this.galaChainSdk.signatures) {
        return await this.signWithGalaChainSdk(payload);
      }

      // Fallback to manual implementation
      return await this.signWithFallback(payload);

    } catch (error) {
      logger.error('Error signing payload:', error);
      throw new Error('Failed to sign payload');
    }
  }

  /**
   * Sign using @gala-chain/api SDK
   */
  private async signWithGalaChainSdk(payload: SignablePayload): Promise<string> {
    try {
      logger.debug('Signing with GalaChain SDK');

      // Convert base64 private key to buffer
      const privateKeyBuffer = Buffer.from(this.privateKey, 'hex');

      // Use GalaChain signatures module
      const signature = this.galaChainSdk.signatures.getSignature(
        payload,
        privateKeyBuffer
      );

      logger.debug('Payload signed with GalaChain SDK');
      return signature;

    } catch (error) {
      logger.warn('GalaChain SDK signing failed, falling back to manual implementation:', error);
      return this.signWithFallback(payload);
    }
  }

  /**
   * Fallback signing implementation based on GalaChain specifications
   */
  private async signWithFallback(payload: SignablePayload): Promise<string> {
    try {
      logger.debug('Signing with fallback implementation');

      // Create canonical payload string (GalaChain method)
      const payloadToSign = this.getPayloadToSign(payload);

      // Create keccak256 hash
      const hash = this.createKeccakHash(payloadToSign);

      // Sign the hash
      const signature = this.signHash(hash);

      logger.debug('Payload signed with fallback implementation');
      return signature;

    } catch (error) {
      logger.error('Fallback signing failed:', error);
      throw new Error('Failed to sign payload with fallback method');
    }
  }

  /**
   * Create payload string for signing (following GalaChain method)
   */
  private getPayloadToSign(payload: SignablePayload): string {
    try {
      // Remove signature and trace fields if present (GalaChain pattern)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      const { signature, trace, ...cleanPayload } = payload as any;

      // Use deterministic JSON stringify
      return stringify(cleanPayload);

    } catch (error) {
      logger.error('Error creating payload string:', error);
      throw new Error('Failed to create payload string');
    }
  }

  /**
   * Create keccak256 hash of payload string
   */
  private createKeccakHash(payloadString: string): Buffer {
    try {
      const payloadBuffer = Buffer.from(payloadString, 'utf8');
      const hash = keccak256(payloadBuffer);
      // keccak256 returns a hex string, convert to buffer
      return Buffer.from(hash, 'hex');

    } catch (error) {
      logger.error('Error creating keccak hash:', error);
      throw new Error('Failed to create keccak hash');
    }
  }

  /**
   * Sign a hash using secp256k1
   */
  private signHash(hash: Buffer): string {
    try {
      if (hash.length !== 32) {
        throw new Error('Hash must be exactly 32 bytes for secp256k1 signing');
      }

      // Sign the hash
      const signature = this.keyPair.sign(hash);

      // Normalize signature (ensure low S value)
      if (signature.s.cmp(ec.curve.n.shrn(1)) > 0) {
        signature.s = ec.curve.n.sub(signature.s);
      }

      // Return as hex string (r + s + recovery)
      const r = signature.r.toString('hex', 32);
      const s = signature.s.toString('hex', 32);
      const recovery = signature.recoveryParam === 1 ? '1c' : '1b';

      return r + s + recovery;

    } catch (error) {
      logger.error('Error signing hash:', error);
      throw new Error('Failed to sign hash');
    }
  }

  /**
   * Generate unique key for operations
   */
  private generateUniqueKey(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${random}`;
  }

  /**
   * Verify a signature (for testing/validation)
   */
  async verifySignature(payload: SignablePayload, signature: string): Promise<boolean> {
    try {
      if (this.galaChainSdk && this.galaChainSdk.signatures) {
        // Use GalaChain SDK verification if available
        return this.verifyWithGalaChainSdk(payload, signature);
      }

      // Fallback verification
      return this.verifyWithFallback(payload, signature);

    } catch (error) {
      logger.error('Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Verify using GalaChain SDK
   */
  private verifyWithGalaChainSdk(payload: SignablePayload, signature: string): boolean {
    try {
      // This would require the verify method from @gala-chain/api
      // Implementation depends on SDK availability
      logger.debug('GalaChain SDK verification not implemented');
      return this.verifyWithFallback(payload, signature);

    } catch (error) {
      logger.warn('GalaChain SDK verification failed:', error);
      return this.verifyWithFallback(payload, signature);
    }
  }

  /**
   * Fallback signature verification
   */
  private verifyWithFallback(payload: SignablePayload, signature: string): boolean {
    try {
      // Recreate the payload hash
      const payloadString = this.getPayloadToSign(payload);
      const hash = this.createKeccakHash(payloadString);

      // Parse signature components
      if (signature.length !== 130) { // 64 + 64 + 2 hex chars
        return false;
      }

      const r = signature.slice(0, 64);
      const s = signature.slice(64, 128);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const recovery = signature.slice(128, 130);

      // Verify with public key
      const sigObj = { r, s };

      return this.keyPair.verify(hash, sigObj);

    } catch (error) {
      logger.error('Error in fallback verification:', error);
      return false;
    }
  }

  /**
   * Sign a message (for authentication)
   */
  async signMessage(message: string): Promise<string> {
    try {
      const messageHash = createHash('sha256').update(message).digest();
      return this.signHash(messageHash);

    } catch (error) {
      logger.error('Error signing message:', error);
      throw new Error('Failed to sign message');
    }
  }

  /**
   * Get public key in hex format
   */
  getPublicKey(): string {
    return this.keyPair.getPublic('hex');
  }

  /**
   * Get wallet address
   */
  getAddress(): string {
    return this.userAddress;
  }

  /**
   * Create complete signed transaction for GalaChain
   */
  async createSignedTransaction(payload: SignablePayload): Promise<SignedPayload> {
    try {
      const signature = await this.signPayload(payload);

      const signedTransaction: SignedPayload = {
        ...payload,
        signature,
        timestamp: Date.now()
      };

      logger.debug('Signed transaction created', {
        uniqueKey: payload.uniqueKey,
        hasSignature: !!signature
      });

      return signedTransaction;

    } catch (error) {
      logger.error('Error creating signed transaction:', error);
      throw new Error('Failed to create signed transaction');
    }
  }

  /**
   * Sign bundle request for GalaSwap execution
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async signBundleRequest(bundlePayload: any, operationType: string): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any;
    signature: string;
    user: string;
    type: string;
  }> {
    try {
      const signature = await this.signPayload(bundlePayload);

      const signedBundle = {
        payload: bundlePayload,
        signature,
        user: this.userAddress,
        type: operationType
      };

      logger.debug('Bundle request signed', {
        type: operationType,
        user: this.userAddress.substring(0, 10) + '...'
      });

      return signedBundle;

    } catch (error) {
      logger.error('Error signing bundle request:', error);
      throw new Error('Failed to sign bundle request');
    }
  }

  /**
   * Security utility - sanitize objects for logging
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sanitizeForLogging(obj: any): any {
    const sanitized = { ...obj };
    const sensitiveKeys = ['privateKey', 'private', 'secret', 'key', 'signature'];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Validate GalaChain address format
   */
  static validateGalaChainAddress(address: string): boolean {
    // GalaChain addresses use format: eth|0x{40 hex chars}
    const galaChainPattern = /^eth\|0x[a-fA-F0-9]{40}$/;
    return galaChainPattern.test(address);
  }

  /**
   * Generate a valid GalaChain operation unique key
   */
  static generateOperationKey(prefix: string = 'galaswap-operation'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const uuid = `${timestamp.toString(36)}-${random}`;
    return `${prefix}-${uuid}`;
  }
}

/**
 * Utility function to validate private key format
 */
export function validatePrivateKey(privateKeyBase64: string): boolean {
  try {
    const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('hex');
    const keyPair = ec.keyFromPrivate(privateKey);

    // Verify we can derive a public key
    const publicKey = keyPair.getPublic('hex');

    return publicKey.length === 130; // 65 bytes * 2 hex chars (uncompressed)

  } catch (error) {
    return false;
  }
}

/**
 * Utility function to derive address from public key
 */
export function deriveAddressFromPublicKey(publicKeyHex: string): string {
  try {
    // Remove '04' prefix if present (uncompressed public key)
    const cleanPublicKey = publicKeyHex.startsWith('04') ? publicKeyHex.slice(2) : publicKeyHex;

    // Create keccak256 hash of public key
    const hashHex = keccak256(Buffer.from(cleanPublicKey, 'hex'));

    // Take last 20 bytes and prepend 'eth|0x'
    const address = 'eth|0x' + hashHex.slice(-40);

    return address;

  } catch (error) {
    throw new Error('Failed to derive address from public key');
  }
}

/**
 * Generate a new random private key (for testing/development)
 * WARNING: Only use for development/testing, never in production
 */
export function generateRandomPrivateKey(): { privateKey: string; address: string; publicKey: string } {
  try {
    const keyPair = ec.genKeyPair();
    const privateKey = keyPair.getPrivate('hex');
    const publicKey = keyPair.getPublic('hex');
    const address = deriveAddressFromPublicKey(publicKey);

    return {
      privateKey: Buffer.from(privateKey, 'hex').toString('base64'),
      address,
      publicKey
    };

  } catch (error) {
    throw new Error('Failed to generate random private key');
  }
}

/**
 * Utility to normalize GalaChain token format
 */
export function normalizeTokenKey(token: string): string {
  // Ensure token follows Collection$Category$Type$AdditionalKey format
  const parts = token.split('$');
  if (parts.length !== 4) {
    throw new Error(`Invalid token format: ${token}. Expected format: Collection$Category$Type$AdditionalKey`);
  }

  return parts.join('$');
}

/**
 * Validate payload structure for GalaChain
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateGalaChainPayload(payload: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required fields
  if (!payload || typeof payload !== 'object') {
    errors.push('Payload must be an object');
    return { isValid: false, errors };
  }

  // Check for uniqueKey (required for GalaChain operations)
  if (!payload.uniqueKey || typeof payload.uniqueKey !== 'string') {
    errors.push('Payload must have a uniqueKey string field');
  }

  // Validate uniqueKey format
  if (payload.uniqueKey && !payload.uniqueKey.includes('-')) {
    errors.push('uniqueKey should follow the pattern: prefix-identifier');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Export signer instance factory
 */
export function createPayloadSigner(config: SigningConfig): PayloadSigner {
  return new PayloadSigner(config);
}