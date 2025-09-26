/**
 * Data Collection and Storage Index
 * Centralized exports for historical price data systems
 */

// Price collection system
export { PriceCollector, priceCollector } from './price-collector';
export type {
  CollectorConfig,
  CollectionStats,
  TokenPriceData
} from './price-collector';

// Game calendar and event management
export { GameCalendar, gameCalendar } from './game-calendar';
export type {
  GameEvent,
  EventImpact,
  EventSource,
  TradingStrategy as EventTradingStrategy,
  ActualEventImpact,
  EventSearchFilter,
  CalendarStats
} from './game-calendar';
export { EventType, EventCategory, EventImpactLevel } from './game-calendar';

// Time-series database storage
export { TimeSeriesDB, timeSeriesDB } from './storage/timeseries-db';
export type {
  PricePoint,
  OHLCVData,
  StatisticData,
  PriceQueryOptions,
  OHLCVQueryOptions,
  StatisticsQueryOptions
} from './storage/timeseries-db';

// Re-export entities for convenience
export {
  PriceHistory,
  PriceOHLCV,
  PriceStatistics
} from '../entities/analytics';

export type {
  IntervalType,
  StatisticType,
  StatisticPeriod
} from '../entities/analytics';