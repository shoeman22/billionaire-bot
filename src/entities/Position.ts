/**
 * Position Entity
 * Database schema for persisting liquidity positions
 */

import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('positions')
@Index(['walletAddress', 'isActive'])
@Index(['token0', 'token1', 'fee'])
@Index(['inRange', 'isActive'])
export class Position {
  @PrimaryColumn('varchar', { length: 50 })
  id!: string;

  @Column('varchar', { length: 100 })
  walletAddress!: string;

  @Column('varchar', { length: 100 })
  token0!: string;

  @Column('varchar', { length: 100 })
  token1!: string;

  @Column('varchar', { length: 50 })
  token0Symbol!: string;

  @Column('varchar', { length: 50 })
  token1Symbol!: string;

  @Column('integer')
  fee!: number;

  @Column('integer')
  tickLower!: number;

  @Column('integer')
  tickUpper!: number;

  @Column('decimal', { precision: 20, scale: 8 })
  minPrice!: number;

  @Column('decimal', { precision: 20, scale: 8 })
  maxPrice!: number;

  @Column('varchar', { length: 100 })
  liquidity!: string;

  @Column('varchar', { length: 100 })
  amount0!: string;

  @Column('varchar', { length: 100 })
  amount1!: string;

  @Column('varchar', { length: 100, default: '0' })
  uncollectedFees0!: string;

  @Column('varchar', { length: 100, default: '0' })
  uncollectedFees1!: string;

  @Column('varchar', { length: 100, default: '0' })
  totalFeesCollected0!: string;

  @Column('varchar', { length: 100, default: '0' })
  totalFeesCollected1!: string;

  @Column('boolean', { default: true })
  inRange!: boolean;

  @Column('boolean', { default: true })
  isActive!: boolean;

  @Column('varchar', { length: 50, nullable: true })
  strategy!: string; // 'market_making', 'range_order', 'fee_farming', etc.

  @Column('integer', { default: 0 })
  rebalanceCount!: number;

  @Column('datetime', { nullable: true })
  lastRebalanceAt!: Date;

  @Column('datetime', { nullable: true })
  lastFeeCollectionAt!: Date;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  initialValueUSD!: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  currentValueUSD!: number;

  @Column('decimal', { precision: 10, scale: 6, default: 0 })
  impermanentLoss!: number;

  @Column('decimal', { precision: 10, scale: 6, default: 0 })
  totalAPR!: number;

  @Column('decimal', { precision: 10, scale: 6, default: 0 })
  feeAPR!: number;

  @Column('integer', { default: 0 })
  timeInRangeMs!: number; // Milliseconds spent in range

  @Column('integer', { default: 0 })
  timeOutOfRangeMs!: number; // Milliseconds spent out of range

  @Column('json', { nullable: true })
  metadata!: {
    creationTx?: string;
    lastUpdateTx?: string;
    priceAtCreation?: number;
    notes?: string;
    autoRebalance?: boolean;
    rebalanceThreshold?: number;
    targetAPR?: number;
    riskTolerance?: 'low' | 'medium' | 'high';
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Computed properties for convenience
  get tokenPair(): string {
    return `${this.token0Symbol}/${this.token1Symbol}`;
  }

  get feeTier(): string {
    return `${this.fee / 100}%`;
  }

  get priceRange(): string {
    return `${this.minPrice.toFixed(6)} - ${this.maxPrice.toFixed(6)}`;
  }

  get liquidityUtilization(): number {
    return this.inRange ? 1 : 0;
  }

  get totalTimeTracked(): number {
    return this.timeInRangeMs + this.timeOutOfRangeMs;
  }

  get timeInRangePercent(): number {
    const total = this.totalTimeTracked;
    return total > 0 ? (this.timeInRangeMs / total) * 100 : 0;
  }

  get profitLoss(): number {
    return this.currentValueUSD - this.initialValueUSD;
  }

  get profitLossPercent(): number {
    return this.initialValueUSD > 0 ? (this.profitLoss / this.initialValueUSD) * 100 : 0;
  }

  // Helper methods
  updateInRangeStatus(currentPrice: number, deltaTimeMs: number): void {
    const wasInRange = this.inRange;
    this.inRange = currentPrice >= this.minPrice && currentPrice <= this.maxPrice;

    // Update time tracking
    if (wasInRange) {
      this.timeInRangeMs += deltaTimeMs;
    } else {
      this.timeOutOfRangeMs += deltaTimeMs;
    }
  }

  addCollectedFees(amount0: string, amount1: string): void {
    const fees0 = parseFloat(this.totalFeesCollected0) + parseFloat(amount0);
    const fees1 = parseFloat(this.totalFeesCollected1) + parseFloat(amount1);

    this.totalFeesCollected0 = fees0.toString();
    this.totalFeesCollected1 = fees1.toString();
    this.lastFeeCollectionAt = new Date();
  }

  incrementRebalance(): void {
    this.rebalanceCount++;
    this.lastRebalanceAt = new Date();
  }

  updateValue(newValueUSD: number): void {
    this.currentValueUSD = newValueUSD;

    // Calculate impermanent loss if we have initial value
    if (this.initialValueUSD > 0) {
      this.impermanentLoss = ((newValueUSD - this.initialValueUSD) / this.initialValueUSD) * 100;
    }
  }

  calculateCurrentAPR(): number {
    const ageMs = Date.now() - this.createdAt.getTime();
    const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365);

    if (ageYears > 0 && this.initialValueUSD > 0) {
      const totalReturn = this.profitLoss + parseFloat(this.totalFeesCollected0) + parseFloat(this.totalFeesCollected1);
      return (totalReturn / this.initialValueUSD / ageYears) * 100;
    }

    return 0;
  }

  isStale(maxAgeMs: number = 5 * 60 * 1000): boolean {
    return Date.now() - this.updatedAt.getTime() > maxAgeMs;
  }

  needsRebalance(priceChangeThreshold: number = 0.1): boolean {
    if (!this.metadata?.autoRebalance) return false;

    const threshold = this.metadata.rebalanceThreshold || priceChangeThreshold;
    const _currentRange = this.maxPrice - this.minPrice;
    const priceChange = Math.abs(this.profitLossPercent);

    return priceChange > threshold || !this.inRange;
  }

  toJSON() {
    return {
      id: this.id,
      walletAddress: this.walletAddress,
      tokenPair: this.tokenPair,
      feeTier: this.feeTier,
      priceRange: this.priceRange,
      liquidity: this.liquidity,
      inRange: this.inRange,
      isActive: this.isActive,
      strategy: this.strategy,
      currentValueUSD: this.currentValueUSD,
      profitLoss: this.profitLoss,
      profitLossPercent: this.profitLossPercent,
      totalAPR: this.totalAPR,
      timeInRangePercent: this.timeInRangePercent,
      rebalanceCount: this.rebalanceCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}