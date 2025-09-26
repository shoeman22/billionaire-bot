/**
 * Price OHLCV Entity
 * Stores aggregated OHLCV (Open, High, Low, Close, Volume) data for different time intervals
 */

import { Entity, Column, Index, PrimaryColumn, Unique } from 'typeorm';

export type IntervalType = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

@Entity('price_ohlcv')
@Index(['token', 'interval_start', 'interval_type'])
@Unique(['token', 'interval_start', 'interval_type'])
export class PriceOHLCV {
  @PrimaryColumn('varchar', { length: 50 })
  token!: string; // Token symbol

  @PrimaryColumn('bigint')
  interval_start!: number; // Start of interval (Unix timestamp)

  @PrimaryColumn('varchar', { length: 5 })
  interval_type!: IntervalType; // Interval type (1m, 5m, 1h, etc.)

  @Column('decimal', { precision: 18, scale: 8 })
  open_price!: string; // Opening price

  @Column('decimal', { precision: 18, scale: 8 })
  high_price!: string; // Highest price in interval

  @Column('decimal', { precision: 18, scale: 8 })
  low_price!: string; // Lowest price in interval

  @Column('decimal', { precision: 18, scale: 8 })
  close_price!: string; // Closing price

  @Column('decimal', { precision: 18, scale: 8 })
  volume!: string; // Trading volume in interval

  @Column('integer')
  trade_count!: number; // Number of trades in interval

  @Column('datetime', { default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @Column('datetime', { default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;

  // Helper methods for type conversion
  getOpenPrice(): number {
    return parseFloat(this.open_price);
  }

  setOpenPrice(price: number): void {
    this.open_price = price.toString();
  }

  getHighPrice(): number {
    return parseFloat(this.high_price);
  }

  setHighPrice(price: number): void {
    this.high_price = price.toString();
  }

  getLowPrice(): number {
    return parseFloat(this.low_price);
  }

  setLowPrice(price: number): void {
    this.low_price = price.toString();
  }

  getClosePrice(): number {
    return parseFloat(this.close_price);
  }

  setClosePrice(price: number): void {
    this.close_price = price.toString();
  }

  getVolume(): number {
    return parseFloat(this.volume);
  }

  setVolume(volume: number): void {
    this.volume = volume.toString();
  }

  // Calculate price change percentage for the interval
  getPriceChangePercent(): number {
    const open = this.getOpenPrice();
    const close = this.getClosePrice();
    if (open === 0) return 0;
    return ((close - open) / open) * 100;
  }

  // Check if this is a bullish candle (close > open)
  isBullish(): boolean {
    return this.getClosePrice() > this.getOpenPrice();
  }

  // Get the body size (absolute difference between open and close)
  getBodySize(): number {
    return Math.abs(this.getClosePrice() - this.getOpenPrice());
  }

  // Get the wick size (total range minus body)
  getWickSize(): number {
    const bodySize = this.getBodySize();
    const totalRange = this.getHighPrice() - this.getLowPrice();
    return totalRange - bodySize;
  }

  // Get interval end timestamp
  getIntervalEnd(): number {
    const intervalMs = this.getIntervalDurationMs();
    return this.interval_start + intervalMs;
  }

  // Get interval duration in milliseconds
  private getIntervalDurationMs(): number {
    switch (this.interval_type) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '30m': return 30 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case '1d': return 24 * 60 * 60 * 1000;
      case '1w': return 7 * 24 * 60 * 60 * 1000;
      default: return 60 * 1000; // Default to 1 minute
    }
  }
}