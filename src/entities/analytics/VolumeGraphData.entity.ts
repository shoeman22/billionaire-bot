/**
 * VolumeGraphData Entity
 *
 * Persistent storage for time-series volume data from /explore/graph-data endpoint.
 * Enables caching of volume data and historical analysis for pattern recognition.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique
} from 'typeorm';

export type VolumeResolution = '5m' | '1h' | '24h';

@Entity('volume_graph_data')
@Index(['poolHash', 'duration', 'startTime', 'endTime'])
@Index(['poolHash', 'duration', 'createdAt'])
@Unique(['poolHash', 'duration', 'startTime', 'endTime'])
export class VolumeGraphData {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar', { length: 64 })
  poolHash!: string;

  @Column('varchar', { length: 3 })
  duration!: VolumeResolution;

  @Column('bigint')
  startTime!: number;

  @Column('bigint')
  endTime!: number;

  @Column('bigint')
  midTime!: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  volume!: number;

  @Column('integer', { nullable: true })
  transactionCount?: number; // If available from API

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  averageTradeSize?: number;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  priceAtMidTime?: number; // If price data available

  @Column('boolean', { default: true })
  isComplete!: boolean; // Whether this time bucket is complete

  @CreateDateColumn()
  createdAt!: Date;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  fetchedAt!: Date;

  /**
   * Get time bucket duration in milliseconds
   */
  get durationMs(): number {
    return this.endTime - this.startTime;
  }

  /**
   * Get volume per hour for normalization across durations
   */
  get volumePerHour(): number {
    const hoursInBucket = this.durationMs / (1000 * 60 * 60);
    return hoursInBucket > 0 ? this.volume / hoursInBucket : 0;
  }

  /**
   * Check if this data point is from a recent time period
   */
  get isRecent(): boolean {
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const oneDay = 24 * 60 * 60;
    return (nowTimestamp - this.endTime) < oneDay;
  }

  /**
   * Get formatted time range for display
   */
  get timeRange(): string {
    const start = new Date(this.startTime * 1000).toISOString();
    const end = new Date(this.endTime * 1000).toISOString();
    return `${start} - ${end}`;
  }

  /**
   * Check if this is a high volume period compared to average
   */
  isHighVolumePeriod(averageVolume: number, threshold: number = 2.0): boolean {
    return this.volume > (averageVolume * threshold);
  }

  /**
   * Static method to create from API response
   */
  static fromApiResponse(
    poolHash: string,
    duration: VolumeResolution,
    apiData: {
      startTime: number;
      endTime: number;
      midTime: number;
      volume: number;
    }
  ): Partial<VolumeGraphData> {
    return {
      poolHash,
      duration,
      startTime: apiData.startTime,
      endTime: apiData.endTime,
      midTime: apiData.midTime,
      volume: apiData.volume,
      isComplete: true
    };
  }
}