/**
 * VolumePattern Entity
 *
 * Persistent storage for identified volume patterns and trading signals.
 * Enables pattern tracking, validation, and machine learning improvement.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

export type PatternType = 'accumulation' | 'distribution' | 'breakout' | 'reversal' | 'consolidation' | 'spike';
export type PatternStatus = 'detected' | 'confirmed' | 'invalidated' | 'completed';
export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'quiet';

@Entity('volume_patterns')
@Index(['poolHash', 'patternType', 'detectedAt'])
@Index(['patternType', 'status', 'confidence'])
@Index(['predictedCompletionTime'])
export class VolumePattern {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar', { length: 64 })
  poolHash!: string;

  @Column('varchar', { length: 20 })
  patternType!: PatternType;

  @Column('varchar', { length: 15, default: 'detected' })
  status!: PatternStatus;

  @Column('decimal', { precision: 10, scale: 4 })
  confidence!: number; // 0.0 - 1.0

  @Column('decimal', { precision: 10, scale: 4 })
  strength!: number; // Pattern strength indicator

  @Column('varchar', { length: 20 })
  marketRegime!: MarketRegime;

  @Column('bigint')
  detectedAtTimestamp!: number;

  @Column('bigint', { nullable: true })
  confirmedAtTimestamp?: number;

  @Column('bigint', { nullable: true })
  predictedCompletionTime?: number;

  @Column('bigint', { nullable: true })
  actualCompletionTime?: number;

  @Column('json')
  patternData!: {
    startTime: number;
    endTime: number;
    baselineVolume: number;
    peakVolume: number;
    volumeRatio: number;
    duration: number;
    timeframe: string;
    supportingIndicators: string[];
    [key: string]: any;
  };

  @Column('json', { nullable: true })
  tradingSignal?: {
    action: 'buy' | 'sell' | 'hold';
    targetPrice?: number;
    stopLoss?: number;
    timeHorizon: string;
    riskLevel: 'low' | 'medium' | 'high';
    reasoning: string;
  };

  @Column('json', { nullable: true })
  predictionAccuracy?: {
    priceTarget?: {
      predicted: number;
      actual?: number;
      accuracy?: number;
    };
    timeTarget?: {
      predicted: number;
      actual?: number;
      accuracy?: number;
    };
    signalEffectiveness?: number; // 0.0 - 1.0
  };

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  resultingProfitLoss?: number;

  @Column('text', { nullable: true })
  analysisNotes?: string;

  @CreateDateColumn()
  detectedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column('timestamp', { nullable: true })
  completedAt?: Date;

  /**
   * Check if pattern is currently active
   */
  get isActive(): boolean {
    return this.status === 'detected' || this.status === 'confirmed';
  }

  /**
   * Check if pattern prediction was accurate
   */
  get wasAccurate(): boolean {
    if (!this.predictionAccuracy) return false;

    const priceAccuracy = this.predictionAccuracy.priceTarget?.accuracy ?? 0;
    const timeAccuracy = this.predictionAccuracy.timeTarget?.accuracy ?? 0;
    const signalEffectiveness = this.predictionAccuracy.signalEffectiveness ?? 0;

    // Consider accurate if at least 2 out of 3 metrics are above 70%
    const accurateMetrics = [
      priceAccuracy > 0.7,
      timeAccuracy > 0.7,
      signalEffectiveness > 0.7
    ].filter(Boolean).length;

    return accurateMetrics >= 2;
  }

  /**
   * Get overall pattern quality score
   */
  get qualityScore(): number {
    let score = this.confidence * 0.4; // Base confidence weight
    score += this.strength * 0.3; // Pattern strength weight

    // Add accuracy bonus if pattern completed
    if (this.predictionAccuracy) {
      const avgAccuracy = [
        this.predictionAccuracy.priceTarget?.accuracy ?? 0,
        this.predictionAccuracy.timeTarget?.accuracy ?? 0,
        this.predictionAccuracy.signalEffectiveness ?? 0
      ].reduce((sum, acc) => sum + acc, 0) / 3;

      score += avgAccuracy * 0.3; // Accuracy weight
    }

    return Math.min(1.0, score);
  }

  /**
   * Generate trading recommendation based on pattern
   */
  getTradingRecommendation(): {
    action: 'buy' | 'sell' | 'hold';
    confidence: number;
    reasoning: string;
    riskLevel: 'low' | 'medium' | 'high';
  } {
    if (this.tradingSignal) {
      return {
        action: this.tradingSignal.action,
        confidence: this.confidence,
        reasoning: this.tradingSignal.reasoning,
        riskLevel: this.tradingSignal.riskLevel
      };
    }

    // Default recommendation based on pattern type
    const recommendations = {
      accumulation: { action: 'buy' as const, reasoning: 'Accumulation pattern suggests building positions' },
      breakout: { action: 'buy' as const, reasoning: 'Breakout pattern indicates strong momentum' },
      distribution: { action: 'sell' as const, reasoning: 'Distribution pattern suggests selling pressure' },
      reversal: { action: 'hold' as const, reasoning: 'Reversal pattern requires confirmation' },
      consolidation: { action: 'hold' as const, reasoning: 'Consolidation pattern suggests waiting' },
      spike: { action: 'hold' as const, reasoning: 'Volume spike requires pattern confirmation' }
    };

    const rec = recommendations[this.patternType];
    return {
      ...rec,
      confidence: this.confidence,
      riskLevel: this.confidence > 0.8 ? 'low' : this.confidence > 0.6 ? 'medium' : 'high'
    };
  }

  /**
   * Update pattern with new data
   */
  updatePattern(
    newData: Partial<VolumePattern['patternData']>,
    newStatus?: PatternStatus,
    notes?: string
  ): void {
    this.patternData = { ...this.patternData, ...newData };

    if (newStatus) {
      this.status = newStatus;

      if (newStatus === 'confirmed' && !this.confirmedAtTimestamp) {
        this.confirmedAtTimestamp = Math.floor(Date.now() / 1000);
      }

      if (newStatus === 'completed' && !this.actualCompletionTime) {
        this.actualCompletionTime = Math.floor(Date.now() / 1000);
        this.completedAt = new Date();
      }
    }

    if (notes) {
      this.analysisNotes = this.analysisNotes
        ? `${this.analysisNotes}\n${new Date().toISOString()}: ${notes}`
        : notes;
    }
  }
}