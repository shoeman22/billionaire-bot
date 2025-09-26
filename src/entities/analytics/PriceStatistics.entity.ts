/**
 * Price Statistics Entity
 * Stores calculated statistical metrics for trading strategies
 */

import { Entity, Column, Index, PrimaryColumn, Unique } from 'typeorm';

export type StatisticType = 'volatility' | 'correlation' | 'rsi' | 'sma' | 'ema' | 'bollinger' | 'macd';
export type StatisticPeriod = '1h' | '4h' | '1d' | '7d' | '30d';

@Entity('price_statistics')
@Index(['token', 'statistic_type', 'period', 'timestamp'])
@Unique(['token', 'statistic_type', 'period', 'timestamp'])
export class PriceStatistics {
  @PrimaryColumn('varchar', { length: 50 })
  token!: string; // Token symbol

  @PrimaryColumn('varchar', { length: 20 })
  statistic_type!: StatisticType; // Type of statistic

  @PrimaryColumn('varchar', { length: 5 })
  period!: StatisticPeriod; // Calculation period

  @PrimaryColumn('bigint')
  timestamp!: number; // Calculation timestamp

  @Column('decimal', { precision: 18, scale: 8 })
  value!: string; // Calculated statistic value

  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  secondary_value?: string; // Secondary value (e.g., for Bollinger bands upper/lower)

  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  tertiary_value?: string; // Tertiary value (e.g., for MACD signal line)

  @Column('json', { nullable: true })
  metadata?: Record<string, any>; // Additional metadata (parameters, etc.)

  @Column('datetime', { default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  // Helper methods for type conversion
  getValue(): number {
    return parseFloat(this.value);
  }

  setValue(value: number): void {
    this.value = value.toString();
  }

  getSecondaryValue(): number | null {
    return this.secondary_value ? parseFloat(this.secondary_value) : null;
  }

  setSecondaryValue(value: number | null): void {
    this.secondary_value = value ? value.toString() : undefined;
  }

  getTertiaryValue(): number | null {
    return this.tertiary_value ? parseFloat(this.tertiary_value) : null;
  }

  setTertiaryValue(value: number | null): void {
    this.tertiary_value = value ? value.toString() : undefined;
  }

  // Specific getter methods for common statistics
  getVolatility(): number {
    return this.statistic_type === 'volatility' ? this.getValue() : 0;
  }

  getRSI(): number {
    return this.statistic_type === 'rsi' ? this.getValue() : 50;
  }

  getSMA(): number {
    return this.statistic_type === 'sma' ? this.getValue() : 0;
  }

  getEMA(): number {
    return this.statistic_type === 'ema' ? this.getValue() : 0;
  }

  // For Bollinger Bands: value = middle, secondary = upper, tertiary = lower
  getBollingerBands(): { middle: number; upper: number | null; lower: number | null } {
    if (this.statistic_type !== 'bollinger') {
      return { middle: 0, upper: null, lower: null };
    }
    return {
      middle: this.getValue(),
      upper: this.getSecondaryValue(),
      lower: this.getTertiaryValue()
    };
  }

  // For MACD: value = MACD line, secondary = signal line, tertiary = histogram
  getMACD(): { macd: number; signal: number | null; histogram: number | null } {
    if (this.statistic_type !== 'macd') {
      return { macd: 0, signal: null, histogram: null };
    }
    return {
      macd: this.getValue(),
      signal: this.getSecondaryValue(),
      histogram: this.getTertiaryValue()
    };
  }

  // Check if statistic indicates bullish trend
  isBullish(): boolean {
    switch (this.statistic_type) {
      case 'rsi':
        return this.getValue() > 50 && this.getValue() < 70; // Not overbought but bullish
      case 'macd':
        const macd = this.getMACD();
        return macd.macd > (macd.signal || 0);
      default:
        return false;
    }
  }

  // Check if statistic indicates bearish trend
  isBearish(): boolean {
    switch (this.statistic_type) {
      case 'rsi':
        return this.getValue() < 50 && this.getValue() > 30; // Not oversold but bearish
      case 'macd':
        const macd = this.getMACD();
        return macd.macd < (macd.signal || 0);
      default:
        return false;
    }
  }
}