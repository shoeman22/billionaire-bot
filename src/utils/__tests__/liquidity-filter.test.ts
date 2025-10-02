import { LiquidityFilter } from '../liquidity-filter';

describe('LiquidityFilter', () => {
  let filter: LiquidityFilter;

  beforeEach(() => {
    filter = new LiquidityFilter();
  });

  describe('shouldFilterPair', () => {
    it('should filter known illiquid pairs', () => {
      // Test problematic pairs from production logs
      expect(filter.shouldFilterPair('SILK|Unit|none|none', 'GWBTC|Unit|none|none')).toBe(true);
      expect(filter.shouldFilterPair('SILK|Unit|none|none', 'GWETH|Unit|none|none')).toBe(true);
      expect(filter.shouldFilterPair('GALA|Unit|none|none', 'GTON|Unit|none|none')).toBe(true);
      expect(filter.shouldFilterPair('GUSDC|Unit|none|none', 'GTON|Unit|none|none')).toBe(true);
      expect(filter.shouldFilterPair('GUSDT|Unit|none|none', 'ETIME|Unit|none|none')).toBe(true);
    });

    it('should allow known liquid pairs', () => {
      // Test whitelisted pairs
      expect(filter.shouldFilterPair('GALA|Unit|none|none', 'GUSDC|Unit|none|none')).toBe(false);
      expect(filter.shouldFilterPair('GUSDC|Unit|none|none', 'GALA|Unit|none|none')).toBe(false);
      expect(filter.shouldFilterPair('GALA|Unit|none|none', 'ETIME|Unit|none|none')).toBe(false);
      expect(filter.shouldFilterPair('GALA|Unit|none|none', 'SILK|Unit|none|none')).toBe(false);
    });

    it('should respect whitelist overrides', () => {
      // Whitelisted pairs should never be filtered
      expect(filter.shouldFilterPair('GALA|Unit|none|none', 'GUSDC|Unit|none|none')).toBe(false);
      expect(filter.shouldFilterPair('GUSDC|Unit|none|none', 'GUSDT|Unit|none|none')).toBe(false);
    });

    it('should handle disabled filtering', () => {
      filter.setFilteringEnabled(false);

      // All pairs should be allowed when filtering is disabled
      expect(filter.shouldFilterPair('SILK|Unit|none|none', 'GWBTC|Unit|none|none')).toBe(false);
      expect(filter.shouldFilterPair('GALA|Unit|none|none', 'GTON|Unit|none|none')).toBe(false);
    });
  });

  describe('addToBlacklist', () => {
    it('should add new pairs to dynamic blacklist', () => {
      const tokenIn = 'NEWTOKEN|Unit|none|none';
      const tokenOut = 'ANOTHERTOKEN|Unit|none|none';

      expect(filter.shouldFilterPair(tokenIn, tokenOut)).toBe(false);

      filter.addToBlacklist(tokenIn, tokenOut, 'test_insufficient_liquidity');

      expect(filter.shouldFilterPair(tokenIn, tokenOut)).toBe(true);
    });

    it('should not blacklist whitelisted pairs', () => {
      const tokenIn = 'GALA|Unit|none|none';
      const tokenOut = 'GUSDC|Unit|none|none';

      expect(filter.shouldFilterPair(tokenIn, tokenOut)).toBe(false);

      filter.addToBlacklist(tokenIn, tokenOut, 'test_reason');

      // Should still be allowed (whitelist override)
      expect(filter.shouldFilterPair(tokenIn, tokenOut)).toBe(false);
    });
  });

  describe('getLiquidPairs', () => {
    it('should return only liquid pairs', () => {
      const tokens = [
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        'SILK|Unit|none|none',
        'GWBTC|Unit|none|none'
      ];

      const liquidPairs = filter.getLiquidPairs(tokens);

      // Should include GALA-GUSDC (whitelisted) and GALA-SILK (whitelisted)
      // Should exclude SILK-GWBTC (blacklisted)
      const pairStrings = liquidPairs.map(p => `${p.tokenIn.split('|')[0]}-${p.tokenOut.split('|')[0]}`);

      expect(pairStrings).toContain('GALA-GUSDC');
      expect(pairStrings).toContain('GUSDC-GALA');
      expect(pairStrings).toContain('GALA-SILK');
      expect(pairStrings).toContain('SILK-GALA');
      expect(pairStrings).not.toContain('SILK-GWBTC');
      expect(pairStrings).not.toContain('GWBTC-SILK');
    });
  });

  describe('getHighConfidencePairs', () => {
    it('should return only whitelisted pairs', () => {
      const highConfidencePairs = filter.getHighConfidencePairs();

      expect(highConfidencePairs.length).toBeGreaterThan(0);

      // All returned pairs should be whitelisted
      for (const pair of highConfidencePairs) {
        expect(filter.isPairWhitelisted(pair.tokenIn, pair.tokenOut)).toBe(true);
      }
    });
  });

  describe('statistics', () => {
    it('should track filter statistics', () => {
      const stats = filter.getStatistics();

      expect(stats.staticBlacklistSize).toBeGreaterThan(0);
      expect(stats.whitelistSize).toBeGreaterThan(0);
      expect(stats.filteringEnabled).toBe(true);
      expect(stats.totalFiltered).toBe(0); // No filtering done yet
    });

    it('should update statistics after filtering', () => {
      // Trigger some filtering
      filter.shouldFilterPair('SILK|Unit|none|none', 'GWBTC|Unit|none|none');
      filter.shouldFilterPair('GALA|Unit|none|none', 'GUSDC|Unit|none|none'); // whitelisted

      const stats = filter.getStatistics();

      expect(stats.totalFiltered).toBe(1);
      expect(stats.blacklistHits).toBe(1);
      expect(stats.whitelistOverrides).toBe(1);
    });
  });
});