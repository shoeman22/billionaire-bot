/**
 * Secure Credential Service
 * Centralized, secure handling of wallet credentials and addresses
 */

import { logger } from '../utils/logger';
import { getConfig, getPrivateKey } from '../config/environment';

export class CredentialService {
  private static instance: CredentialService;
  private cachedAddress: string | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): CredentialService {
    if (!CredentialService.instance) {
      CredentialService.instance = new CredentialService();
    }
    return CredentialService.instance;
  }

  /**
   * Get the wallet address in the required format for API calls
   * Returns in format: 'eth|0x...' without exposing in logs
   */
  public getWalletAddress(): string {
    if (this.cachedAddress) {
      return this.cachedAddress;
    }

    try {
      const config = getConfig();
      const address = config.wallet.address;

      if (!address) {
        throw new Error('Wallet address not configured');
      }

      // Validate address format (eth|HEXADDRESS without 0x)
      // Example: eth|5AD173F004990940b20e7A5C64C72E8b6B91a783
      if (!address.startsWith('eth|') || address.length !== 44) {
        throw new Error(`Invalid wallet address format. Expected 'eth|HEXADDRESS' (44 chars), got: ${address.substring(0, 10)}... (${address.length} chars)`);
      }

      this.cachedAddress = address;

      // Log only the first 10 and last 4 characters for security
      const maskedAddress = `${address.substring(0, 10)}...${address.substring(address.length - 4)}`;
      logger.debug('Wallet address initialized', { maskedAddress });

      return this.cachedAddress;
    } catch (error) {
      logger.error('Failed to resolve wallet address', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Wallet address resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate that credentials are properly configured
   */
  public validateCredentials(): boolean {
    try {
      const config = getConfig();

      if (!config.wallet.address) {
        return false;
      }

      // Validate address format
      if (!config.wallet.address.startsWith('eth|0x')) {
        return false;
      }

      // Validate private key exists securely without storing it
      try {
        const privateKeyBuffer = getPrivateKey();
        if (!privateKeyBuffer || privateKeyBuffer.length === 0) {
          return false;
        }
      } catch {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear cached credentials (for testing or security)
   */
  public clearCache(): void {
    this.cachedAddress = null;
    logger.debug('Credential cache cleared');
  }
}

// Export singleton instance
export const credentialService = CredentialService.getInstance();