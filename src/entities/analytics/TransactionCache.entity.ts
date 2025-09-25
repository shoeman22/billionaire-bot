/**
 * TransactionCache Entity
 *
 * Database-backed caching for transaction history data from /explore/transactions.
 * Improves performance and reduces API calls while maintaining data freshness.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

@Entity('transaction_cache')
@Index(['poolHash', 'createdAt'])
@Index(['userAddress', 'createdAt'])
@Index(['cacheKey'])
@Index(['expiresAt'])
export class TransactionCache {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar', { length: 200, unique: true })
  cacheKey!: string; // Hash of query parameters

  @Column('varchar', { length: 64 })
  poolHash!: string;

  @Column('varchar', { length: 100, nullable: true })
  userAddress?: string; // For user-specific queries

  @Column('json')
  queryParams!: {
    limit?: number;
    offset?: number;
    fromTime?: string;
    toTime?: string;
    minVolume?: number;
    [key: string]: any;
  };

  @Column('json')
  transactionData!: Array<{
    id: number;
    blockNumber: number;
    poolHash: string;
    userAddress: string;
    transactionTime: string;
    token0: string;
    token1: string;
    amount0: number;
    amount1: number;
    volume: number;
    type?: string;
    fee?: number;
    priceImpact?: number;
  }>;

  @Column('integer')
  totalCount!: number; // Total transactions matching query

  @Column('integer')
  returnedCount!: number; // Number of transactions in this cache entry

  @Column('boolean', { default: true })
  isComplete!: boolean; // Whether this represents a complete result set

  @Column('timestamp')
  expiresAt!: Date;

  @Column('bigint')
  apiResponseTime!: number; // Time in milliseconds for API response

  @Column('integer', { default: 1 })
  hitCount!: number; // Number of times this cache entry was used

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column('timestamp')
  lastAccessedAt!: Date;

  /**
   * Check if cache entry is expired
   */
  get isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  /**
   * Check if cache entry is fresh (not expired and recently created)
   */
  get isFresh(): boolean {
    const now = new Date();
    const ageMinutes = (now.getTime() - this.createdAt.getTime()) / (1000 * 60);
    return !this.isExpired && ageMinutes < 5; // Fresh if less than 5 minutes old
  }

  /**
   * Update access tracking
   */
  recordAccess(): void {
    this.hitCount += 1;
    this.lastAccessedAt = new Date();
  }

  /**
   * Get cache efficiency metrics
   */
  get efficiency(): {
    hitRate: number;
    avgResponseTime: number;
    dataFreshness: number;
  } {
    const now = new Date();
    const ageHours = (now.getTime() - this.createdAt.getTime()) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0, 1 - (ageHours / 24)); // Fresh if less than 24h

    return {
      hitRate: this.hitCount,
      avgResponseTime: this.apiResponseTime,
      dataFreshness: freshnessScore
    };
  }

  /**
   * Generate cache key from query parameters
   */
  static generateCacheKey(
    poolHash: string,
    userAddress: string | undefined,
    params: Record<string, any>
  ): string {
    const keyData = {
      poolHash,
      userAddress: userAddress || 'all',
      ...params
    };

    // Create deterministic hash of parameters
    const sortedKeys = Object.keys(keyData).sort();
    const keyString = sortedKeys.map(key => `${key}:${(keyData as any)[key]}`).join('|');

    // Simple hash function (in production, consider using crypto.createHash)
    let hash = 0;
    for (let i = 0; i < keyString.length; i++) {
      const char = keyString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return `tx_cache_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Create cache entry with appropriate expiration
   */
  static create(
    poolHash: string,
    userAddress: string | undefined,
    params: Record<string, any>,
    data: any[],
    totalCount: number,
    responseTime: number,
    ttlMinutes: number = 5
  ): Partial<TransactionCache> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

    return {
      cacheKey: this.generateCacheKey(poolHash, userAddress, params),
      poolHash,
      userAddress,
      queryParams: params,
      transactionData: data,
      totalCount,
      returnedCount: data.length,
      isComplete: data.length === totalCount,
      expiresAt,
      apiResponseTime: responseTime,
      hitCount: 0,
      lastAccessedAt: new Date()
    };
  }
}