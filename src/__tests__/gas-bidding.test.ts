/**
 * Gas Bidding System Tests
 * Validates the priority gas bidding enhancement functionality
 */

import { GasBiddingEngine, OpportunityMetrics } from '../trading/execution/gas-bidding';
import { TRADING_CONSTANTS } from '../config/constants';

describe('Gas Bidding Engine', () => {
  let gasBiddingEngine: GasBiddingEngine;

  beforeEach(() => {
    gasBiddingEngine = new GasBiddingEngine({
      enabled: true,
      maxGasBudgetPercent: 0.15,
      baseGasPremium: 1.0,
      competitiveFactor: 1.5,
      emergencyMultiplier: 3.0,
      marketAnalysisEnabled: true,
      profitProtectionEnabled: true
    });
  });

  describe('Gas Bid Calculations', () => {
    it('should calculate conservative bid for small opportunity', async () => {
      const opportunity: OpportunityMetrics = {
        profitAmountUSD: 5, // $5 opportunity
        profitPercent: 0.01, // 1% profit
        timeToExpiration: 300000, // 5 minutes
        competitiveRisk: 'low',
        marketVolatility: 0.1,
        liquidityDepth: 50000
      };

      const bid = await gasBiddingEngine.calculateGasBid(opportunity);

      expect(['conservative', 'moderate']).toContain(bid.bidStrategy);
      expect(bid.recommendedGasPrice).toBeLessThan(opportunity.profitAmountUSD * 0.15); // Max 15% of profit
      expect(bid.profitProtection.isViable).toBe(true);
      expect(bid.profitProtection.remainingProfitAfterGas).toBeGreaterThan(0);
    });

    it('should calculate aggressive bid for large opportunity with competition', async () => {
      const opportunity: OpportunityMetrics = {
        profitAmountUSD: 1000, // $1000 opportunity
        profitPercent: 0.05, // 5% profit
        timeToExpiration: 60000, // 1 minute urgency
        competitiveRisk: 'high',
        marketVolatility: 0.3,
        liquidityDepth: 500000
      };

      const bid = await gasBiddingEngine.calculateGasBid(opportunity);

      expect(['aggressive', 'emergency']).toContain(bid.bidStrategy);
      expect(bid.recommendedGasPrice).toBeGreaterThan(TRADING_CONSTANTS.GAS_COSTS.BASE_GAS);
      expect(bid.competitiveAdjustment).toBeGreaterThan(1.0);
      expect(bid.profitProtection.isViable).toBe(true);
    });

    it('should protect profit and reject non-viable trades', async () => {
      const opportunity: OpportunityMetrics = {
        profitAmountUSD: 0.5, // Very small $0.50 opportunity
        profitPercent: 0.001, // 0.1% profit
        timeToExpiration: 30000, // 30 seconds urgency
        competitiveRisk: 'high',
        marketVolatility: 0.5,
        liquidityDepth: 10000
      };

      const bid = await gasBiddingEngine.calculateGasBid(opportunity);

      // Should protect profit - either viable with low gas cost or not viable
      if (bid.profitProtection.isViable) {
        expect(bid.recommendedGasPrice).toBeLessThan(opportunity.profitAmountUSD * 0.5);
      } else {
        expect(bid.profitProtection.remainingProfitAfterGas).toBeLessThanOrEqual(0);
      }
    });

    it('should apply emergency multiplier for expiring opportunities', async () => {
      const opportunity: OpportunityMetrics = {
        profitAmountUSD: 100,
        profitPercent: 0.02,
        timeToExpiration: 30000, // 30 seconds - very urgent
        competitiveRisk: 'medium',
        marketVolatility: 0.2,
        liquidityDepth: 100000
      };

      const bid = await gasBiddingEngine.calculateGasBid(opportunity);

      expect(bid.bidStrategy).toBe('emergency');
      expect(bid.priorityMultiplier).toBeGreaterThan(2.0);
      expect(bid.reasoning).toContain('Critical time pressure');
    });
  });

  describe('Profit Protection', () => {
    it('should enforce maximum gas budget percentage', async () => {
      const opportunity: OpportunityMetrics = {
        profitAmountUSD: 10,
        profitPercent: 0.03,
        timeToExpiration: 60000,
        competitiveRisk: 'high',
        marketVolatility: 0.4,
        liquidityDepth: 50000
      };

      const bid = await gasBiddingEngine.calculateGasBid(opportunity);

      // Should never spend more than 15% of profit on gas
      expect(bid.recommendedGasPrice).toBeLessThanOrEqual(opportunity.profitAmountUSD * 0.15);
      expect(bid.profitProtection.maxGasBudget).toBeLessThanOrEqual(opportunity.profitAmountUSD * 0.15);
    });

    it('should maintain minimum viable profit after gas', async () => {
      const opportunity: OpportunityMetrics = {
        profitAmountUSD: 20,
        profitPercent: 0.025,
        timeToExpiration: 120000,
        competitiveRisk: 'medium',
        marketVolatility: 0.25,
        liquidityDepth: 100000
      };

      const bid = await gasBiddingEngine.calculateGasBid(opportunity);

      if (bid.profitProtection.isViable) {
        // Should maintain at least 10% of original profit
        expect(bid.profitProtection.remainingProfitAfterGas).toBeGreaterThanOrEqual(opportunity.profitAmountUSD * 0.1);
      }
    });
  });

  describe('Competitive Adjustments', () => {
    it('should increase gas bid for high competition', async () => {
      const baseOpportunity: OpportunityMetrics = {
        profitAmountUSD: 50,
        profitPercent: 0.02,
        timeToExpiration: 180000,
        competitiveRisk: 'low',
        marketVolatility: 0.1,
        liquidityDepth: 200000
      };

      const competitiveOpportunity: OpportunityMetrics = {
        ...baseOpportunity,
        competitiveRisk: 'high',
        marketVolatility: 0.3
      };

      const baseBid = await gasBiddingEngine.calculateGasBid(baseOpportunity);
      const competitiveBid = await gasBiddingEngine.calculateGasBid(competitiveOpportunity);

      expect(competitiveBid.recommendedGasPrice).toBeGreaterThan(baseBid.recommendedGasPrice);
      expect(competitiveBid.competitiveAdjustment).toBeGreaterThan(baseBid.competitiveAdjustment);
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration correctly', () => {
      const newConfig = {
        maxGasBudgetPercent: 0.20,
        competitiveFactor: 2.0
      };

      gasBiddingEngine.updateConfig(newConfig);
      const updatedConfig = gasBiddingEngine.getConfig();

      expect(updatedConfig.maxGasBudgetPercent).toBe(0.20);
      expect(updatedConfig.competitiveFactor).toBe(2.0);
      expect(updatedConfig.enabled).toBe(true); // Should preserve other settings
    });

    it('should provide bidding statistics', () => {
      const stats = gasBiddingEngine.getBiddingStats();

      expect(stats).toHaveProperty('totalBids');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('averageGasPrice');
      expect(stats).toHaveProperty('averageProfitAmount');
      expect(stats).toHaveProperty('recentPerformance');
    });
  });

  describe('Disabled Gas Bidding', () => {
    it('should return conservative bid when disabled', async () => {
      const disabledEngine = new GasBiddingEngine({ enabled: false });

      const opportunity: OpportunityMetrics = {
        profitAmountUSD: 1000,
        profitPercent: 0.05,
        timeToExpiration: 30000,
        competitiveRisk: 'high',
        marketVolatility: 0.5,
        liquidityDepth: 100000
      };

      const bid = await disabledEngine.calculateGasBid(opportunity);

      expect(bid.bidStrategy).toBe('conservative');
      expect(bid.recommendedGasPrice).toBe(TRADING_CONSTANTS.GAS_COSTS.BASE_GAS);
      expect(bid.reasoning).toContain('disabled');
    });
  });
});

describe('Gas Bidding Integration Examples', () => {
  it('should handle realistic arbitrage scenarios', async () => {
    const gasBiddingEngine = new GasBiddingEngine();

    // Example: $10 arbitrage opportunity with 30 seconds left
    const smallOpportunity: OpportunityMetrics = {
      profitAmountUSD: 10,
      profitPercent: 0.015, // 1.5% profit margin
      timeToExpiration: 30000, // 30 seconds
      competitiveRisk: 'medium',
      marketVolatility: 0.2,
      liquidityDepth: 75000
    };

    const smallBid = await gasBiddingEngine.calculateGasBid(smallOpportunity);

    // Should bid around $1 for $10 opportunity (roughly 10% of profit)
    expect(smallBid.recommendedGasPrice).toBeLessThanOrEqual(1.5); // Max 15% of $10
    expect(smallBid.profitProtection.remainingProfitAfterGas).toBeGreaterThan(8.5); // Keep 85%+ profit

    // Example: $1000 arbitrage opportunity with high competition
    const largeOpportunity: OpportunityMetrics = {
      profitAmountUSD: 1000,
      profitPercent: 0.025, // 2.5% profit margin
      timeToExpiration: 60000, // 1 minute
      competitiveRisk: 'high',
      marketVolatility: 0.35,
      liquidityDepth: 500000
    };

    const largeBid = await gasBiddingEngine.calculateGasBid(largeOpportunity);

    // Should bid around $50 for $1000 opportunity (roughly 5% of profit)
    expect(largeBid.recommendedGasPrice).toBeLessThanOrEqual(150); // Max 15% of $1000
    expect(largeBid.bidStrategy).toMatch(/aggressive|emergency/);
    expect(largeBid.profitProtection.remainingProfitAfterGas).toBeGreaterThan(850); // Keep 85%+ profit
  });
});