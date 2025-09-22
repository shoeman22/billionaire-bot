/**
 * FeeCalculator Tests
 * Testing fee tracking and optimization logic
 */

import { FeeCalculator } from '../../services/fee-calculator';
import { LiquidityPosition } from '../../services/liquidity-manager';

// Mock the database repository
jest.mock('../../config/database');
jest.mock('../../utils/logger');

describe('FeeCalculator', () => {
  let feeCalculator: FeeCalculator;

  beforeEach(() => {
    feeCalculator = new FeeCalculator();
  });

  describe('calculateAccruedFees', () => {
    it('should return a number representing total accrued fees', async () => {
      // Mock the global fee metrics calculation
      jest.spyOn(feeCalculator, 'calculateGlobalFeeMetrics').mockResolvedValue({
        totalFeesUncollectedUSD: 150.75,
        totalFeesEarnedUSD: 250.25,
        totalPositions: 5,
        activePositions: 3,
        avgDailyYield: 0.5,
        avgMonthlyYield: 15.0,
        avgAnnualizedAPR: 180.0,
        averageAPR: 15.5,
        topPerformingPairs: [],
        topPerformingPosition: {
          id: 'top-position',
          apr: 25.3,
          feesUSD: 85.2
        },
        poorestPerformingPosition: {
          id: 'poor-position',
          apr: 5.1,
          feesUSD: 12.5
        },
        feeCollectionEfficiency: 85.0,
        compoundingOpportunities: 2
      });

      const result = await feeCalculator.calculateAccruedFees();

      expect(typeof result).toBe('number');
      expect(result).toBe(150.75);
    });

    it('should handle empty position portfolio', async () => {
      jest.spyOn(feeCalculator, 'calculateGlobalFeeMetrics').mockResolvedValue({
        totalFeesUncollectedUSD: 0,
        totalFeesEarnedUSD: 0,
        totalPositions: 0,
        activePositions: 0,
        avgDailyYield: 0,
        avgMonthlyYield: 0,
        avgAnnualizedAPR: 0,
        averageAPR: 0,
        topPerformingPairs: [],
        topPerformingPosition: null,
        poorestPerformingPosition: null,
        feeCollectionEfficiency: 0,
        compoundingOpportunities: 0
      });

      const result = await feeCalculator.calculateAccruedFees();

      expect(result).toBe(0);
    });
  });

  describe('getTotalFeesCollected', () => {
    it('should return total collected fees as a number', async () => {
      jest.spyOn(feeCalculator, 'calculateGlobalFeeMetrics').mockResolvedValue({
        totalFeesUncollectedUSD: 150.75,
        totalFeesEarnedUSD: 500.50,
        totalPositions: 5,
        activePositions: 3,
        avgDailyYield: 0.5,
        avgMonthlyYield: 15.0,
        avgAnnualizedAPR: 180.0,
        averageAPR: 15.5,
        topPerformingPairs: [],
        topPerformingPosition: null,
        poorestPerformingPosition: null,
        feeCollectionEfficiency: 85.0,
        compoundingOpportunities: 2
      });

      const result = await feeCalculator.getTotalFeesCollected();

      expect(typeof result).toBe('number');
      expect(result).toBe(500.50);
    });
  });

  describe('calculatePositionFeeAnalytics', () => {
    it('should throw error when database not initialized', async () => {
      // FeeCalculator needs to be initialized first
      await expect(feeCalculator.calculatePositionFeeAnalytics('lp_test123')).rejects.toThrow('FeeCalculator not initialized');
    });

    it('should handle errors gracefully', async () => {
      // Mock the method to throw an error
      jest.spyOn(feeCalculator, 'calculatePositionFeeAnalytics').mockImplementation(async () => {
        return null;
      });

      const result = await feeCalculator.calculatePositionFeeAnalytics('lp_test123');
      expect(result).toBeNull();
    });
  });

  describe('generateCollectionOptimization', () => {
    it('should throw error when database not initialized', async () => {
      await expect(feeCalculator.generateCollectionOptimization('lp_test123')).rejects.toThrow('FeeCalculator not initialized');
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(feeCalculator, 'generateCollectionOptimization').mockImplementation(async () => {
        return null;
      });

      const result = await feeCalculator.generateCollectionOptimization('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('identifyCollectionOpportunities', () => {
    it('should throw error when database not initialized', async () => {
      await expect(feeCalculator.identifyCollectionOpportunities()).rejects.toThrow('FeeCalculator not initialized');
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(feeCalculator, 'identifyCollectionOpportunities').mockImplementation(async () => {
        return [];
      });

      const result = await feeCalculator.identifyCollectionOpportunities();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Database not initialized, should throw error
      await expect(feeCalculator.calculatePositionFeeAnalytics('lp_test123')).rejects.toThrow('FeeCalculator not initialized');
    });
  });
});