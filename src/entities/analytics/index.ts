/**
 * Analytics Entities Index
 *
 * Exports all analytics-related entities for easy importing
 * and database configuration.
 */

export { WhaleWatchlist } from './WhaleWatchlist.entity.js';
export { WhaleAlert } from './WhaleAlert.entity.js';
export { VolumeGraphData } from './VolumeGraphData.entity.js';
export { TransactionCache } from './TransactionCache.entity.js';
export { VolumePattern } from './VolumePattern.entity.js';
export { AnalyticsSnapshot } from './AnalyticsSnapshot.entity.js';

// Price data entities
export { PriceHistory } from './PriceHistory.entity.js';
export { PriceOHLCV } from './PriceOHLCV.entity.js';
export { PriceStatistics } from './PriceStatistics.entity.js';

// Export types for TypeScript usage (only available at compile-time)
export type { AlertType, AlertSeverity } from './WhaleAlert.entity.js';
export type { VolumeResolution } from './VolumeGraphData.entity.js';
export type { PatternType, PatternStatus, MarketRegime } from './VolumePattern.entity.js';
export type { SnapshotType } from './AnalyticsSnapshot.entity.js';

// Price data types
export type { IntervalType } from './PriceOHLCV.entity.js';
export type { StatisticType, StatisticPeriod } from './PriceStatistics.entity.js';

// Import entities for the array
import { WhaleWatchlist } from './WhaleWatchlist.entity.js';
import { WhaleAlert } from './WhaleAlert.entity.js';
import { VolumeGraphData } from './VolumeGraphData.entity.js';
import { TransactionCache } from './TransactionCache.entity.js';
import { VolumePattern } from './VolumePattern.entity.js';
import { AnalyticsSnapshot } from './AnalyticsSnapshot.entity.js';
import { PriceHistory } from './PriceHistory.entity.js';
import { PriceOHLCV } from './PriceOHLCV.entity.js';
import { PriceStatistics } from './PriceStatistics.entity.js';

// Re-export for convenience
export const AnalyticsEntities = [
  WhaleWatchlist,
  WhaleAlert,
  VolumeGraphData,
  TransactionCache,
  VolumePattern,
  AnalyticsSnapshot,
  PriceHistory,
  PriceOHLCV,
  PriceStatistics
];