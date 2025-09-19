/**
 * Security Remediations Test
 * Tests for the critical placeholder implementations that were remediated
 */

import { RiskMonitor } from '../../../trading/risk/risk-monitor';
import { EmergencyControls } from '../../../trading/risk/emergency-controls';
import { GalaSwapClient } from '../../../api/GalaSwapClient';
import { SwapExecutor } from '../../../trading/execution/swap-executor';
import { LiquidityManager } from '../../../trading/execution/liquidity-manager';
import TestHelpers from '../../utils/test-helpers';

// Mock external dependencies
jest.mock('../../../utils/logger');
jest.mock('axios');

describe('Security Remediations', () => {
  let riskMonitor: RiskMonitor;
  let emergencyControls: EmergencyControls;
  let galaSwapClient: GalaSwapClient;
  let swapExecutor: SwapExecutor;
  let liquidityManager: LiquidityManager;
  let config: any;

  beforeEach(() => {
    jest.clearAllMocks();
    config = TestHelpers.createTestBotConfig();

    // Mock GalaSwapClient
    galaSwapClient = {
      getUserPositions: jest.fn(),
      getPrice: jest.fn(),
      getWalletAddress: jest.fn().mockReturnValue('eth|0x1234567890123456789012345678901234567890'),
    } as any;

    // Mock SwapExecutor
    swapExecutor = {
      executeSwap: jest.fn(),
    } as any;

    // Mock LiquidityManager
    liquidityManager = {} as any;

    riskMonitor = new RiskMonitor(config.trading, galaSwapClient);
    emergencyControls = new EmergencyControls(
      config.trading,
      galaSwapClient,
      swapExecutor,
      liquidityManager
    );
  });

  describe('RiskMonitor Real Balance Fetching', () => {
    it('should fetch real user balances from GalaSwap API', async () => {
      const mockPositions = {
        error: false,
        data: {
          Status: 200,
          Data: {
            nextBookMark: '',
            positions: [
              {
                fee: 3000,
                liquidity: '3001000',
                tickLower: -200,
                tickUpper: 200,
                token0ClassKey: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
                token1ClassKey: { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' },
                tokensOwed0: '0',
                tokensOwed1: '0',
                token0Symbol: 'GALA',
                token1Symbol: 'GUSDC'
              },
              {
                fee: 3000,
                liquidity: '1501000',
                tickLower: -200,
                tickUpper: 200,
                token0ClassKey: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
                token1ClassKey: { collection: 'ETIME', category: 'Unit', type: 'none', additionalKey: 'none' },
                tokensOwed0: '0',
                tokensOwed1: '0',
                token0Symbol: 'GALA',
                token1Symbol: 'ETIME'
              }
            ]
          }
        }
      };

      (galaSwapClient.getUserPositions as jest.Mock).mockResolvedValue(mockPositions);

      // Use reflection to access private method for testing
      const getTokenBalances = (riskMonitor as any).getTokenBalances;
      const balances = await getTokenBalances.call(riskMonitor, 'eth|0x1234567890123456789012345678901234567890');

      expect(galaSwapClient.getUserPositions).toHaveBeenCalledWith('eth|0x1234567890123456789012345678901234567890');
      expect(balances).toEqual([
        { token: 'GALA', amount: 2251000 }, // (3001000 + 1501000) / 2
        { token: 'GUSDC', amount: 1500500 }, // 3001000 / 2
        { token: 'ETIME', amount: 750500 } // 1501000 / 2
      ]);
    });

    it('should handle API failure gracefully', async () => {
      (galaSwapClient.getUserPositions as jest.Mock).mockResolvedValue({
        error: true,
        message: 'API Error'
      });

      const getTokenBalances = (riskMonitor as any).getTokenBalances;
      const balances = await getTokenBalances.call(riskMonitor, 'eth|0x1234567890123456789012345678901234567890');

      expect(balances).toEqual([]);
    });
  });

  describe('RiskMonitor Real Price Fetching', () => {
    it('should fetch real token prices from GalaSwap API', async () => {
      const mockPrices: Record<string, any> = {
        'GALA': { error: false, data: { priceUsd: '0.045', price: '0.045' } },
        'GUSDC': { error: false, data: { priceUsd: '1.000', price: '1.000' } }
      };

      (galaSwapClient.getPrice as jest.Mock).mockImplementation((token: string) => {
        const symbol = token.split('$')[0];
        return Promise.resolve(mockPrices[symbol]);
      });

      const getCurrentPrices = (riskMonitor as any).getCurrentPrices;
      const prices = await getCurrentPrices.call(riskMonitor, ['GALA', 'GUSDC']);

      expect(galaSwapClient.getPrice).toHaveBeenCalledTimes(2);
      expect(prices).toEqual({
        'GALA': 0.045,
        'GUSDC': 1.000
      });
    });

    it('should handle price fetch failures', async () => {
      (galaSwapClient.getPrice as jest.Mock).mockResolvedValue({
        error: true,
        message: 'Price not available'
      });

      const getCurrentPrices = (riskMonitor as any).getCurrentPrices;
      const prices = await getCurrentPrices.call(riskMonitor, ['GALA']);

      expect(prices).toEqual({ 'GALA': 0 });
    });
  });

  describe('RiskMonitor Market Anomaly Detection', () => {
    it('should detect volatility spikes', async () => {
      // Set up portfolio snapshots with volatility spike
      const snapshots = [
        { timestamp: Date.now() - 10000, totalValue: 1000, riskMetrics: { volatilityScore: 0.01, maxConcentration: 0.3, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 9000, totalValue: 1050, riskMetrics: { volatilityScore: 0.02, maxConcentration: 0.3, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 8000, totalValue: 1100, riskMetrics: { volatilityScore: 0.03, maxConcentration: 0.3, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 7000, totalValue: 1150, riskMetrics: { volatilityScore: 0.04, maxConcentration: 0.3, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 6000, totalValue: 1200, riskMetrics: { volatilityScore: 0.05, maxConcentration: 0.3, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now(), totalValue: 1000, riskMetrics: { volatilityScore: 0.15, maxConcentration: 0.3, drawdown: 0.05, liquidityScore: 80 } }
      ];

      (riskMonitor as any).portfolioSnapshots = snapshots;

      const detectMarketAnomalies = (riskMonitor as any).detectMarketAnomalies;
      const anomalies = await detectMarketAnomalies.call(riskMonitor);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some((a: any) => a.type === 'volatility_spike')).toBe(true);
    });

    it('should detect concentration risk', async () => {
      const snapshots = [
        { timestamp: Date.now() - 10000, totalValue: 1000, riskMetrics: { volatilityScore: 0.01, maxConcentration: 0.3, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 9000, totalValue: 1050, riskMetrics: { volatilityScore: 0.02, maxConcentration: 0.4, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 8000, totalValue: 1100, riskMetrics: { volatilityScore: 0.03, maxConcentration: 0.5, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 7000, totalValue: 1150, riskMetrics: { volatilityScore: 0.04, maxConcentration: 0.6, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now() - 6000, totalValue: 1200, riskMetrics: { volatilityScore: 0.05, maxConcentration: 0.7, drawdown: 0.05, liquidityScore: 80 } },
        { timestamp: Date.now(), totalValue: 1000, riskMetrics: { volatilityScore: 0.01, maxConcentration: 0.9, drawdown: 0.05, liquidityScore: 80 } }
      ];

      (riskMonitor as any).portfolioSnapshots = snapshots;

      const detectMarketAnomalies = (riskMonitor as any).detectMarketAnomalies;
      const anomalies = await detectMarketAnomalies.call(riskMonitor);

      expect(anomalies.some((a: any) => a.type === 'liquidity_drop' && a.data.concentration === 0.9)).toBe(true);
    });
  });

  describe('EmergencyControls Parameter Fix', () => {
    it('should use correct wallet address for emergency swaps', async () => {
      (swapExecutor.executeSwap as jest.Mock).mockResolvedValue({
        success: true,
        transactionId: 'tx123'
      });

      const plan = {
        token: 'GALA',
        amount: 1000,
        estimatedValue: 50,
        liquidationMethod: 'EMERGENCY_SWAP' as const,
        maxSlippage: 0.10
      };

      const executeEmergencySwap = (emergencyControls as any).executeEmergencySwap;
      await executeEmergencySwap.call(emergencyControls, plan);

      expect(swapExecutor.executeSwap).toHaveBeenCalledWith({
        tokenIn: 'GALA',
        tokenOut: 'USDC',
        amountIn: '1000',
        userAddress: 'eth|0x1234567890123456789012345678901234567890', // Correct wallet address
        slippageTolerance: 0.10,
        urgency: 'high'
      });
    });
  });

  describe('EmergencyControls Position Fetching', () => {
    it('should fetch real positions for emergency liquidation', async () => {
      const mockPositions = {
        error: false,
        data: {
          Status: 200,
          Data: {
            nextBookMark: '',
            positions: [
              {
                fee: 3000,
                liquidity: '3001000',
                tickLower: -200,
                tickUpper: 200,
                token0ClassKey: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
                token1ClassKey: { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' },
                tokensOwed0: '0',
                tokensOwed1: '0',
                token0Symbol: 'GALA',
                token1Symbol: 'GUSDC'
              }
            ]
          }
        }
      };

      (galaSwapClient.getUserPositions as jest.Mock).mockResolvedValue(mockPositions);

      const getCurrentPositions = (emergencyControls as any).getCurrentPositions;
      const positions = await getCurrentPositions.call(emergencyControls);

      expect(positions).toHaveLength(2); // token0 and token1
      expect(positions[0]).toMatchObject({
        token: 'GALA',
        amount: 1500500, // 3001000 / 2
        isLiquidityPosition: true
      });
      expect(positions[1]).toMatchObject({
        token: 'GUSDC',
        amount: 1500500, // 3001000 / 2
        isLiquidityPosition: true
      });
    });
  });

  describe('Daily Volume Calculation', () => {
    it('should calculate daily volume from portfolio snapshots', () => {
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const snapshots = [
        { timestamp: oneDayAgo + 1000, totalValue: 1000 },
        { timestamp: oneDayAgo + 2000, totalValue: 1100 },
        { timestamp: oneDayAgo + 3000, totalValue: 1050 },
        { timestamp: Date.now(), totalValue: 1200 }
      ];

      (riskMonitor as any).portfolioSnapshots = snapshots;

      const calculateDailyVolume = (riskMonitor as any).calculateDailyVolume;
      const volume = calculateDailyVolume.call(riskMonitor, 'test-address');

      // Total volume = |1100-1000| + |1050-1100| + |1200-1050| = 100 + 50 + 150 = 300
      expect(volume).toBe(300);
    });
  });
});