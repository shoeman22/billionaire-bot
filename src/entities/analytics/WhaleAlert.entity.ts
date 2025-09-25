/**
 * WhaleAlert Entity
 *
 * Persistent storage for whale trading alerts and notifications.
 * Enables historical analysis of whale behavior and alert effectiveness.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { WhaleWatchlist } from './WhaleWatchlist.entity.js';

export type AlertType = 'large_trade' | 'position_change' | 'volume_spike' | 'unusual_activity' | 'copy_signal';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

@Entity('whale_alerts')
@Index(['whaleAddress', 'createdAt'])
@Index(['alertType', 'createdAt'])
@Index(['severity', 'processed'])
export class WhaleAlert {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar', { length: 100 })
  whaleAddress!: string;

  @Column('varchar', { length: 20 })
  alertType!: AlertType;

  @Column('varchar', { length: 10, default: 'info' })
  severity!: AlertSeverity;

  @Column('text')
  message!: string;

  @Column('json', { nullable: true })
  data?: {
    poolHash?: string;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: number;
    amountOut?: number;
    volumeChange?: number;
    priceImpact?: number;
    confidence?: number;
    recommendation?: 'buy' | 'sell' | 'hold' | 'follow';
    [key: string]: any;
  };

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  confidence?: number; // 0.0 - 1.0 confidence in the alert

  @Column('boolean', { default: false })
  processed!: boolean;

  @Column('boolean', { default: false })
  actionTaken!: boolean;

  @Column('text', { nullable: true })
  processingNotes?: string;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  resultingProfit?: number; // If action was taken, track the result

  @CreateDateColumn()
  createdAt!: Date;

  @Column('datetime', { nullable: true })
  processedAt?: Date;

  // Relationship to whale watchlist
  @ManyToOne(() => WhaleWatchlist, { nullable: true })
  @JoinColumn({ name: 'whaleAddress', referencedColumnName: 'whaleAddress' })
  whale?: WhaleWatchlist;

  /**
   * Check if alert is high priority and needs immediate attention
   */
  get isUrgent(): boolean {
    return this.severity === 'critical' && !this.processed;
  }

  /**
   * Check if alert resulted in profitable action
   */
  get wasProfitable(): boolean {
    return this.actionTaken && (this.resultingProfit ?? 0) > 0;
  }

  /**
   * Generate copy trading signal from alert data
   */
  get copyTradingSignal(): {
    action: 'buy' | 'sell' | 'hold';
    confidence: number;
    reasoning: string;
  } | null {
    if (!this.data?.recommendation || this.confidence === undefined) {
      return null;
    }

    return {
      action: this.data.recommendation === 'follow' ? 'buy' : this.data.recommendation,
      confidence: this.confidence,
      reasoning: this.message
    };
  }
}