/**
 * WhaleWatchlist Entity
 *
 * Persistent storage for whale addresses being tracked for copy trading
 * and portfolio monitoring. Replaces in-memory Map in WhaleTracker.
 */

import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

@Entity('whale_watchlist')
@Index(['priority', 'copyTrading'])
@Index(['addedAt'])
export class WhaleWatchlist {
  @PrimaryColumn('varchar', { length: 100 })
  whaleAddress!: string;

  @Column('text')
  notes!: string;

  @Column('varchar', { length: 20, default: 'medium' })
  priority!: 'low' | 'medium' | 'high' | 'critical';

  @Column('boolean', { default: true })
  copyTrading!: boolean;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  estimatedPortfolioValue?: number;

  @Column('varchar', { length: 50, nullable: true })
  discoveredFrom?: string; // 'transaction analysis', 'manual', etc.

  @Column('integer', { default: 0 })
  successfulTrades!: number;

  @Column('integer', { default: 0 })
  totalTrades!: number;

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  profitabilityScore?: number; // 0.0 - 1.0

  @Column('boolean', { default: true })
  isActive!: boolean;

  @CreateDateColumn()
  addedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Calculate success rate for this whale
   */
  get successRate(): number {
    return this.totalTrades > 0 ? this.successfulTrades / this.totalTrades : 0;
  }

  /**
   * Check if whale should trigger high priority alerts
   */
  get isHighPriority(): boolean {
    return this.priority === 'high' || this.priority === 'critical';
  }
}