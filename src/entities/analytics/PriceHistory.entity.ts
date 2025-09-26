/**
 * Price History Entity
 * Stores historical price data for tokens with efficient time-series querying
 */

import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

@Entity('price_history')
@Index(['token', 'timestamp'])
@Index(['token', 'timestamp', 'source'])
@Unique(['token', 'timestamp', 'source'])
export class PriceHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar', { length: 50 })
  @Index()
  token!: string; // Token symbol (e.g., 'GALA', 'SILK')

  @Column('bigint')
  @Index()
  timestamp!: number; // Unix timestamp in milliseconds

  @Column('decimal', { precision: 18, scale: 8 })
  price_usd!: string; // Price in USD with high precision

  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  volume_24h?: string; // 24h trading volume (if available)

  @Column('decimal', { precision: 18, scale: 2, nullable: true })
  market_cap?: string; // Market cap in USD (if available)

  @Column('varchar', { length: 20, default: 'galaswap_api' })
  source!: string; // Data source identifier

  @Column('decimal', { precision: 8, scale: 4, nullable: true })
  price_change_24h?: string; // 24h price change percentage

  @Column('datetime', { default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  // Helper methods for type conversion
  getPriceUsd(): number {
    return parseFloat(this.price_usd);
  }

  setPriceUsd(price: number): void {
    this.price_usd = price.toString();
  }

  getVolume24h(): number | null {
    return this.volume_24h ? parseFloat(this.volume_24h) : null;
  }

  setVolume24h(volume: number | null): void {
    this.volume_24h = volume ? volume.toString() : undefined;
  }

  getMarketCap(): number | null {
    return this.market_cap ? parseFloat(this.market_cap) : null;
  }

  setMarketCap(cap: number | null): void {
    this.market_cap = cap ? cap.toString() : undefined;
  }

  getPriceChange24h(): number | null {
    return this.price_change_24h ? parseFloat(this.price_change_24h) : null;
  }

  setPriceChange24h(change: number | null): void {
    this.price_change_24h = change ? change.toString() : undefined;
  }
}