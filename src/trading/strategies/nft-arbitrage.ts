/**
 * NFT Floor Price Arbitrage Strategy
 *
 * Advanced gaming NFT arbitrage system that identifies profitable opportunities between:
 * - NFT marketplace floor prices vs token crafting costs
 * - Cross-marketplace price discrepancies
 * - Seasonal demand patterns in gaming ecosystems
 * - Utility-based value arbitrage in play-to-earn economies
 *
 * Strategy Implementation:
 * 1. Monitor gaming NFT collections for floor price changes
 * 2. Calculate real-time crafting costs from DeFi token prices
 * 3. Execute multi-step arbitrage: Buy tokens → Craft NFT → Sell NFT
 * 4. Manage unique risks of illiquid NFT markets
 * 5. Capitalize on predictable gaming ecosystem patterns
 *
 * Risk Management:
 * - Maximum 3% capital per NFT opportunity
 * - Total NFT exposure limited to 10% of capital
 * - 48-hour maximum position duration
 * - Advanced liquidity scoring and market manipulation detection
 * - Integration with existing DeFi risk management systems
 */

import { GSwap } from '../../services/gswap-simple';
import { TradingConfig } from '../../config/environment';
import { logger } from '../../utils/logger';
import { TRADING_CONSTANTS } from '../../config/constants';
import { SwapExecutor } from '../execution/swap-executor';
import { MarketAnalysis } from '../../monitoring/market-analysis';
import { RiskMonitor } from '../risk/risk-monitor';
import { NFTMarketplaceClient, NFTArbitrageOpportunity, NFTSale, CraftingRequirement } from '../../api/nft-marketplace-client';
import { AlertSystem } from '../../monitoring/alerts';
import { poolDiscovery } from '../../services/pool-discovery';
import { safeParseFloat } from '../../utils/safe-parse';

// ===========================================
// NFT ARBITRAGE TYPES & INTERFACES
// ===========================================

export interface NFTPosition {
  id: string;
  contractAddress: string;
  tokenId: string;
  strategy: 'crafting-arbitrage' | 'cross-marketplace' | 'seasonal-play';
  entryType: 'crafted' | 'purchased';

  // Investment details
  totalInvestment: number;
  craftingCosts: CraftingRequirement[];
  marketplaceFees: number;
  gasCosts: number;

  // Position tracking
  currentValue: number;
  unrealizedPnL: number;
  profitTarget: number;
  stopLoss: number;

  // Timing
  openTime: number;
  craftingStartTime?: number;
  craftingCompleteTime?: number;
  maxHoldTime: number;

  // Market data
  entryFloorPrice: number;
  currentFloorPrice: number;
  liquidityScore: number;
  riskScore: number;

  // Status tracking
  status: 'crafting' | 'listing' | 'listed' | 'sold' | 'stopped-out';
  marketplace: string;
  listingPrice?: number;
  listingTime?: number;
}

export interface ArbitrageExecution {
  opportunity: NFTArbitrageOpportunity;
  executionPlan: {
    phase: 'token-acquisition' | 'crafting' | 'listing' | 'sale';
    steps: ArbitrageStep[];
    estimatedDuration: number;
    contingencyPlans: string[];
  };
  riskAssessment: {
    capitalAtRisk: number;
    maxLoss: number;
    probabilityOfSuccess: number;
    keyRiskFactors: string[];
  };
}

export interface ArbitrageStep {
  action: 'buy-tokens' | 'craft-nft' | 'list-nft' | 'monitor-sale';
  description: string;
  estimatedTime: number;
  dependencies: string[];
  riskMitigation: string[];
}

export interface StrategyPerformance {
  totalOpportunities: number;
  executedArbitrages: number;
  successfulArbitrages: number;
  totalProfit: number;
  totalLoss: number;
  avgHoldTime: number;
  avgProfitMargin: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;

  // NFT-specific metrics
  successfulCraftings: number;
  avgCraftingTime: number;
  avgTimeToSale: number;
  marketplaceDistribution: Record<string, number>;
  bestPerformingCollections: Array<{
    contractAddress: string;
    profit: number;
    winRate: number;
  }>;
}

export interface MarketConditionAnalysis {
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  gamingNFTTrend: 'up' | 'down' | 'sideways';
  liquidityCondition: 'healthy' | 'constrained' | 'illiquid';
  seasonalFactor: number; // 0.5-2.0 multiplier
  currentEvents: Array<{
    game: string;
    event: string;
    impact: 'positive' | 'negative' | 'neutral';
    expectedDuration: number;
  }>;
}

// ===========================================
// NFT ARBITRAGE STRATEGY CLASS
// ===========================================

export class NFTArbitrageStrategy {
  private gswap: GSwap;
  private config: TradingConfig;
  private swapExecutor: SwapExecutor;
  private marketAnalysis: MarketAnalysis;
  private riskMonitor: RiskMonitor;
  private nftClient: NFTMarketplaceClient;
  private alertSystem: AlertSystem;

  // Strategy state
  private isActive: boolean = false;
  private activePositions: Map<string, NFTPosition> = new Map();
  private monitoredCollections: string[] = [];
  private lastScanTime: number = 0;
  private scanInterval: number = 300000; // 5 minutes

  // Performance tracking
  private performance: StrategyPerformance = {
    totalOpportunities: 0,
    executedArbitrages: 0,
    successfulArbitrages: 0,
    totalProfit: 0,
    totalLoss: 0,
    avgHoldTime: 0,
    avgProfitMargin: 0,
    winRate: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    successfulCraftings: 0,
    avgCraftingTime: 0,
    avgTimeToSale: 0,
    marketplaceDistribution: {},
    bestPerformingCollections: []
  };

  // Risk management
  private readonly MAX_CAPITAL_PER_POSITION = 0.03; // 3% max per NFT
  private readonly MAX_TOTAL_NFT_EXPOSURE = 0.10; // 10% total NFT exposure
  private readonly MAX_POSITION_DURATION = 48 * 60 * 60 * 1000; // 48 hours
  private readonly MIN_PROFIT_THRESHOLD = 0.10; // 10% minimum profit
  private readonly MIN_LIQUIDITY_SCORE = 0.3; // Minimum liquidity for execution
  private readonly MAX_CONCURRENT_POSITIONS = 3; // Max simultaneous NFT positions

  // Market timing
  private marketCondition: MarketConditionAnalysis = {
    overallSentiment: 'neutral',
    gamingNFTTrend: 'sideways',
    liquidityCondition: 'healthy',
    seasonalFactor: 1.0,
    currentEvents: []
  };

  constructor(
    gswap: GSwap,
    config: TradingConfig,
    swapExecutor: SwapExecutor,
    marketAnalysis: MarketAnalysis,
    riskMonitor: RiskMonitor
  ) {
    this.gswap = gswap;
    this.config = config;
    this.swapExecutor = swapExecutor;
    this.marketAnalysis = marketAnalysis;
    this.riskMonitor = riskMonitor;
    this.nftClient = new NFTMarketplaceClient();
    this.alertSystem = new AlertSystem();

    // Initialize monitored gaming NFT collections
    this.initializeMonitoredCollections();

    logger.info('NFT Arbitrage Strategy initialized', {
      maxCapitalPerPosition: this.MAX_CAPITAL_PER_POSITION * 100 + '%',
      maxTotalExposure: this.MAX_TOTAL_NFT_EXPOSURE * 100 + '%',
      maxPositionDuration: this.MAX_POSITION_DURATION / (60 * 60 * 1000) + 'h',
      monitoredCollections: this.monitoredCollections.length
    });
  }

  /**
   * Initialize monitored gaming NFT collections
   */
  private initializeMonitoredCollections(): void {
    // These would be configured based on active gaming ecosystems
    this.monitoredCollections = [
      '0x123...town', // Town Crush buildings
      '0x456...legacy', // Legacy characters
      '0x789...spider', // Spider Tanks
      '0xabc...eternal', // Eternal Time resources
      '0xdef...superior' // Superior collectibles
    ];
  }

  /**
   * Start the NFT arbitrage strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('NFT Arbitrage Strategy already running');
      return;
    }

    this.isActive = true;
    logger.info('🎮 Starting NFT Arbitrage Strategy...');

    try {
      // Initialize pool discovery for token pricing
      await poolDiscovery.fetchAllPools();

      // Start market condition monitoring
      this.startMarketAnalysis();

      // Start opportunity scanning
      this.startOpportunityScanning();

      // Start position monitoring
      this.startPositionMonitoring();

      // Setup price monitoring for NFT collections
      this.startNFTPriceMonitoring();

      logger.info('✅ NFT Arbitrage Strategy started successfully', {
        monitoredCollections: this.monitoredCollections.length,
        scanInterval: this.scanInterval / 1000 + 's'
      });

    } catch (error) {
      logger.error('Failed to start NFT Arbitrage Strategy', {
        error: error instanceof Error ? error.message : String(error)
      });
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the NFT arbitrage strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    this.isActive = false;
    logger.info('🛑 Stopping NFT Arbitrage Strategy...');

    // Close all active positions if possible
    for (const [positionId, position] of this.activePositions.entries()) {
      try {
        if (position.status === 'listed') {
          // Attempt emergency liquidation at current floor price
          await this.emergencyLiquidation(positionId);
        }
      } catch (error) {
        logger.error(`Failed to close position ${positionId}`, { error });
      }
    }

    logger.info('NFT Arbitrage Strategy stopped', {
      finalStats: this.getPerformanceStats(),
      activePositions: this.activePositions.size
    });
  }

  /**
   * Get strategy status and performance
   */
  getStatus(): {
    isActive: boolean;
    performance: StrategyPerformance;
    activePositions: number;
    totalCapitalDeployed: number;
    currentExposure: number;
    marketCondition: MarketConditionAnalysis;
  } {
    const totalDeployed = Array.from(this.activePositions.values())
      .reduce((sum, pos) => sum + pos.totalInvestment, 0);

    const currentExposure = totalDeployed / (50000);

    return {
      isActive: this.isActive,
      performance: this.performance,
      activePositions: this.activePositions.size,
      totalCapitalDeployed: totalDeployed,
      currentExposure,
      marketCondition: this.marketCondition
    };
  }

  /**
   * Start market condition analysis for NFT markets
   */
  private startMarketAnalysis(): void {
    const analyzeMarket = async () => {
      if (!this.isActive) return;

      try {
        // Analyze overall market conditions
        const defiMarketCondition = await this.marketAnalysis.analyzeMarket();

        // Analyze NFT-specific market conditions
        const nftMarketCondition = await this.analyzeNFTMarketConditions();

        // Update market condition
        this.marketCondition = {
          overallSentiment: this.mapSentimentToNFT(defiMarketCondition.sentiment),
          gamingNFTTrend: nftMarketCondition.trend,
          liquidityCondition: nftMarketCondition.liquidity,
          seasonalFactor: nftMarketCondition.seasonalFactor,
          currentEvents: nftMarketCondition.events
        };

        logger.debug('Updated NFT market conditions', this.marketCondition);

      } catch (error) {
        logger.error('Error analyzing NFT market conditions', { error });
      }

      if (this.isActive) {
        setTimeout(analyzeMarket, 60000); // Update every minute
      }
    };

    analyzeMarket();
  }

  /**
   * Analyze NFT-specific market conditions
   */
  private async analyzeNFTMarketConditions(): Promise<{
    trend: 'up' | 'down' | 'sideways';
    liquidity: 'healthy' | 'constrained' | 'illiquid';
    seasonalFactor: number;
    events: Array<{ game: string; event: string; impact: 'positive' | 'negative' | 'neutral'; expectedDuration: number }>;
  }> {
    let totalVolume24h = 0;
    let totalVolume7d = 0;
    let avgLiquidityScore = 0;

    // Analyze each monitored collection
    for (const contractAddress of this.monitoredCollections) {
      try {
        const analysis = await this.nftClient.getMarketAnalysis(contractAddress);
        if (analysis) {
          totalVolume24h += analysis.collection.volume24h;
          totalVolume7d += analysis.collection.volume7d;
          avgLiquidityScore += analysis.liquidityAnalysis.score;
        }
      } catch (error) {
        logger.warn(`Failed to analyze collection ${contractAddress}`, { error });
      }
    }

    avgLiquidityScore /= this.monitoredCollections.length;

    // Determine trend
    const volumeGrowth = totalVolume7d > 0 ? (totalVolume24h * 7) / totalVolume7d : 1;
    const trend = volumeGrowth > 1.1 ? 'up' : volumeGrowth < 0.9 ? 'down' : 'sideways';

    // Determine liquidity condition
    const liquidity = avgLiquidityScore > 0.7 ? 'healthy' :
                      avgLiquidityScore > 0.4 ? 'constrained' : 'illiquid';

    // Calculate seasonal factor (mock implementation - would integrate with game calendars)
    const seasonalFactor = this.calculateSeasonalFactor();

    // Mock current gaming events (would integrate with game APIs)
    const events = [
      { game: 'Town Crush', event: 'Building Contest', impact: 'positive' as const, expectedDuration: 7 * 24 * 60 * 60 * 1000 },
      { game: 'Legacy', event: 'PvP Tournament', impact: 'positive' as const, expectedDuration: 14 * 24 * 60 * 60 * 1000 }
    ];

    return { trend, liquidity, seasonalFactor, events };
  }

  /**
   * Calculate seasonal demand factor
   */
  private calculateSeasonalFactor(): number {
    const now = new Date();
    const month = now.getMonth();
    const dayOfWeek = now.getDay();

    let factor = 1.0;

    // Holiday seasons (higher demand)
    if (month === 11 || month === 0) factor *= 1.2; // December/January
    if (month === 5 || month === 6) factor *= 1.1; // Summer gaming season

    // Weekend boost
    if (dayOfWeek === 5 || dayOfWeek === 6) factor *= 1.05;

    // Gaming prime time boost (would be more sophisticated in practice)
    const hour = now.getHours();
    if (hour >= 18 && hour <= 23) factor *= 1.05;

    return Math.min(2.0, Math.max(0.5, factor));
  }

  /**
   * Map DeFi sentiment to NFT sentiment
   */
  private mapSentimentToNFT(sentiment: string): 'bullish' | 'bearish' | 'neutral' {
    switch (sentiment) {
      case 'greedy':
      case 'optimistic': return 'bullish';
      case 'fearful':
      case 'cautious': return 'bearish';
      default: return 'neutral';
    }
  }

  /**
   * Start opportunity scanning loop
   */
  private startOpportunityScanning(): void {
    const scanForOpportunities = async () => {
      if (!this.isActive) return;

      try {
        await this.scanForArbitrageOpportunities();
        this.lastScanTime = Date.now();
      } catch (error) {
        logger.error('Error in opportunity scanning', { error });
      }

      if (this.isActive) {
        setTimeout(scanForOpportunities, this.scanInterval);
      }
    };

    scanForOpportunities();
  }

  /**
   * Scan for NFT arbitrage opportunities
   */
  async scanForArbitrageOpportunities(): Promise<void> {
    logger.debug('Scanning for NFT arbitrage opportunities...');

    let totalOpportunities = 0;

    for (const contractAddress of this.monitoredCollections) {
      try {
        // Skip if we're at position limits
        if (this.activePositions.size >= this.MAX_CONCURRENT_POSITIONS) {
          logger.debug('Max concurrent positions reached, skipping new opportunities');
          break;
        }

        // Check capital exposure
        const currentExposure = this.calculateCurrentExposure();
        if (currentExposure >= this.MAX_TOTAL_NFT_EXPOSURE) {
          logger.debug('Max NFT exposure reached, skipping new opportunities', {
            currentExposure: currentExposure * 100 + '%',
            maxExposure: this.MAX_TOTAL_NFT_EXPOSURE * 100 + '%'
          });
          break;
        }

        // Get arbitrage opportunities for this collection
        const opportunities = await this.nftClient.detectArbitrageOpportunities(contractAddress);
        totalOpportunities += opportunities.length;

        for (const opportunity of opportunities) {
          if (await this.evaluateAndExecuteOpportunity(opportunity)) {
            // Successfully executed an opportunity, take a break
            break;
          }
        }

      } catch (error) {
        logger.error(`Error scanning collection ${contractAddress}`, { error });
      }
    }

    this.performance.totalOpportunities += totalOpportunities;

    logger.debug('Opportunity scan complete', {
      opportunitiesFound: totalOpportunities,
      activePositions: this.activePositions.size,
      currentExposure: this.calculateCurrentExposure() * 100 + '%'
    });
  }

  /**
   * Calculate current capital exposure to NFTs
   */
  private calculateCurrentExposure(): number {
    const totalCapital = 50000;
    const totalDeployed = Array.from(this.activePositions.values())
      .reduce((sum, pos) => sum + pos.totalInvestment, 0);
    return totalDeployed / totalCapital;
  }

  /**
   * Evaluate and potentially execute an arbitrage opportunity
   */
  private async evaluateAndExecuteOpportunity(opportunity: NFTArbitrageOpportunity): Promise<boolean> {
    try {
      // Apply filters
      if (!this.passesOpportunityFilters(opportunity)) {
        return false;
      }

      // Adjust for market conditions
      const adjustedOpportunity = this.adjustForMarketConditions(opportunity);

      // Final profitability check
      if (adjustedOpportunity.profitMargin < this.MIN_PROFIT_THRESHOLD * 100) {
        logger.debug('Opportunity below minimum profit threshold after adjustments', {
          contractAddress: opportunity.contractAddress,
          originalMargin: opportunity.profitMargin,
          adjustedMargin: adjustedOpportunity.profitMargin,
          minThreshold: this.MIN_PROFIT_THRESHOLD * 100
        });
        return false;
      }

      // Create execution plan
      const execution = await this.createExecutionPlan(adjustedOpportunity);

      // Risk assessment
      const riskCheck = await this.assessExecutionRisk(execution);
      if (!riskCheck.approved) {
        logger.warn('Opportunity failed risk assessment', {
          contractAddress: opportunity.contractAddress,
          reasons: riskCheck.reasons
        });
        return false;
      }

      // Execute the arbitrage
      const success = await this.executeArbitrage(execution);
      if (success) {
        this.performance.executedArbitrages++;
        logger.info('✅ NFT arbitrage opportunity executed', {
          contractAddress: opportunity.contractAddress,
          profitPotential: adjustedOpportunity.netProfit,
          profitMargin: adjustedOpportunity.profitMargin
        });
        return true;
      }

    } catch (error) {
      logger.error('Error evaluating arbitrage opportunity', {
        contractAddress: opportunity.contractAddress,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return false;
  }

  /**
   * Apply opportunity filters
   */
  private passesOpportunityFilters(opportunity: NFTArbitrageOpportunity): boolean {
    // Minimum profit margin
    if (opportunity.profitMargin < this.MIN_PROFIT_THRESHOLD * 100) {
      return false;
    }

    // Minimum liquidity score
    if (opportunity.liquidityScore < this.MIN_LIQUIDITY_SCORE) {
      return false;
    }

    // Risk score threshold
    if (opportunity.riskScore > 0.8) {
      return false;
    }

    // Confidence threshold
    if (opportunity.confidence < 0.6) {
      return false;
    }

    // Capital requirements
    const totalCapital = 50000;
    const positionSize = opportunity.totalCraftingCostUSD + opportunity.gasCosts;
    if (positionSize > totalCapital * this.MAX_CAPITAL_PER_POSITION) {
      return false;
    }

    // Market condition filters
    if (this.marketCondition.liquidityCondition === 'illiquid') {
      return false;
    }

    return true;
  }

  /**
   * Adjust opportunity for current market conditions
   */
  private adjustForMarketConditions(opportunity: NFTArbitrageOpportunity): NFTArbitrageOpportunity {
    const adjusted = { ...opportunity };

    // Apply seasonal factor
    adjusted.nftFloorPriceUSD *= this.marketCondition.seasonalFactor;
    adjusted.nftFloorPrice *= this.marketCondition.seasonalFactor;

    // Adjust for market sentiment
    if (this.marketCondition.overallSentiment === 'bearish') {
      // Require higher profit margins in bearish markets
      adjusted.profitMargin *= 0.8;
    } else if (this.marketCondition.overallSentiment === 'bullish') {
      // Accept slightly lower margins in bullish markets
      adjusted.profitMargin *= 1.1;
    }

    // Adjust for gaming NFT trend
    if (this.marketCondition.gamingNFTTrend === 'up') {
      adjusted.nftFloorPriceUSD *= 1.05; // Expect 5% price appreciation
    } else if (this.marketCondition.gamingNFTTrend === 'down') {
      adjusted.nftFloorPriceUSD *= 0.95; // Expect 5% price depreciation
    }

    // Recalculate profit metrics
    adjusted.netProfit = adjusted.nftFloorPriceUSD - adjusted.totalCraftingCostUSD -
                        adjusted.marketplaceFees - adjusted.gasCosts;
    adjusted.profitMargin = (adjusted.netProfit / adjusted.nftFloorPriceUSD) * 100;
    adjusted.roi = (adjusted.netProfit / adjusted.totalCraftingCostUSD) * 100;

    return adjusted;
  }

  /**
   * Create detailed execution plan
   */
  private async createExecutionPlan(opportunity: NFTArbitrageOpportunity): Promise<ArbitrageExecution> {
    const steps: ArbitrageStep[] = [];

    // Step 1: Token acquisition
    steps.push({
      action: 'buy-tokens',
      description: `Purchase ${opportunity.craftingRequirements.map(r => `${r.amount} ${r.token}`).join(', ')} for crafting`,
      estimatedTime: 300, // 5 minutes
      dependencies: [],
      riskMitigation: ['Check slippage', 'Verify token availability', 'Monitor gas prices']
    });

    // Step 2: NFT crafting
    steps.push({
      action: 'craft-nft',
      description: 'Execute crafting transaction to mint NFT',
      estimatedTime: opportunity.craftingTime,
      dependencies: ['buy-tokens'],
      riskMitigation: ['Verify crafting parameters', 'Monitor transaction status', 'Have contingency plan']
    });

    // Step 3: NFT listing
    steps.push({
      action: 'list-nft',
      description: 'List NFT on optimal marketplace',
      estimatedTime: 600, // 10 minutes
      dependencies: ['craft-nft'],
      riskMitigation: ['Price competitively', 'Choose optimal marketplace', 'Monitor competition']
    });

    // Step 4: Sale monitoring
    steps.push({
      action: 'monitor-sale',
      description: 'Monitor for sale completion or adjust pricing',
      estimatedTime: 24 * 60 * 60, // Up to 24 hours
      dependencies: ['list-nft'],
      riskMitigation: ['Adjust pricing if needed', 'Emergency liquidation plan', 'Stop-loss execution']
    });

    const totalDuration = steps.reduce((sum, step) => sum + step.estimatedTime, 0);

    const execution: ArbitrageExecution = {
      opportunity,
      executionPlan: {
        phase: 'token-acquisition',
        steps,
        estimatedDuration: totalDuration,
        contingencyPlans: [
          'Emergency liquidation at current floor price',
          'Token sell-back if crafting fails',
          'Cross-marketplace listing if primary fails'
        ]
      },
      riskAssessment: {
        capitalAtRisk: opportunity.totalCraftingCostUSD + opportunity.gasCosts,
        maxLoss: opportunity.totalCraftingCostUSD * 0.8, // Assume 80% recovery rate
        probabilityOfSuccess: opportunity.confidence * opportunity.liquidityScore,
        keyRiskFactors: [
          'NFT price volatility during hold period',
          'Failed crafting transaction',
          'Marketplace listing competition',
          'Seasonal demand changes'
        ]
      }
    };

    return execution;
  }

  /**
   * Assess execution risk
   */
  private async assessExecutionRisk(execution: ArbitrageExecution): Promise<{
    approved: boolean;
    reasons: string[];
    riskScore: number;
  }> {
    const reasons: string[] = [];
    let riskScore = 0;

    // Check portfolio risk limits
    const currentExposure = this.calculateCurrentExposure();
    const newExposure = (execution.riskAssessment.capitalAtRisk) / (50000);

    if (currentExposure + newExposure > this.MAX_TOTAL_NFT_EXPOSURE) {
      reasons.push('Would exceed maximum NFT exposure limit');
      riskScore += 0.5;
    }

    // Check position size limits
    if (newExposure > this.MAX_CAPITAL_PER_POSITION) {
      reasons.push('Position size exceeds maximum allowed per NFT');
      riskScore += 0.3;
    }

    // Check market conditions
    if (this.marketCondition.liquidityCondition === 'illiquid') {
      reasons.push('Market liquidity conditions are poor');
      riskScore += 0.2;
    }

    // Check probability of success
    if (execution.riskAssessment.probabilityOfSuccess < 0.6) {
      reasons.push('Low probability of success');
      riskScore += 0.2;
    }

    // Check existing risk monitor
    try {
      const portfolioSnapshot = await (this.riskMonitor as any).getPortfolioSnapshot();
      if (portfolioSnapshot.riskMetrics.riskLevel > 0.7) {
        reasons.push('Overall portfolio risk too high');
        riskScore += 0.3;
      }
    } catch (error) {
      logger.warn('Could not get portfolio risk assessment', { error });
    }

    const approved = riskScore < 0.6 && reasons.length === 0;

    return { approved, reasons, riskScore };
  }

  /**
   * Execute the NFT arbitrage opportunity
   */
  private async executeArbitrage(execution: ArbitrageExecution): Promise<boolean> {
    const positionId = `nft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info('🚀 Executing NFT arbitrage', {
      positionId,
      contractAddress: execution.opportunity.contractAddress,
      netProfit: execution.opportunity.netProfit,
      profitMargin: execution.opportunity.profitMargin
    });

    try {
      // Phase 1: Token Acquisition
      const tokenAcquisition = await this.executeTokenAcquisition(execution.opportunity.craftingRequirements);
      if (!tokenAcquisition.success) {
        logger.error('Token acquisition failed', { error: tokenAcquisition.error });
        return false;
      }

      // Create position tracking
      const position: NFTPosition = {
        id: positionId,
        contractAddress: execution.opportunity.contractAddress,
        tokenId: execution.opportunity.tokenId,
        strategy: 'crafting-arbitrage',
        entryType: 'crafted',
        totalInvestment: execution.riskAssessment.capitalAtRisk,
        craftingCosts: execution.opportunity.craftingRequirements,
        marketplaceFees: execution.opportunity.marketplaceFees,
        gasCosts: execution.opportunity.gasCosts,
        currentValue: execution.opportunity.nftFloorPriceUSD,
        unrealizedPnL: 0,
        profitTarget: execution.opportunity.nftFloorPriceUSD * 0.95, // 5% below floor for quick sale
        stopLoss: execution.opportunity.totalCraftingCostUSD * 0.8, // 20% stop loss
        openTime: Date.now(),
        craftingStartTime: Date.now(),
        maxHoldTime: Date.now() + this.MAX_POSITION_DURATION,
        entryFloorPrice: execution.opportunity.nftFloorPrice,
        currentFloorPrice: execution.opportunity.nftFloorPrice,
        liquidityScore: execution.opportunity.liquidityScore,
        riskScore: execution.opportunity.riskScore,
        status: 'crafting',
        marketplace: 'gala' // Start with Gala Games marketplace
      };

      this.activePositions.set(positionId, position);

      // Phase 2: NFT Crafting (simulated - would integrate with actual game contracts)
      await this.simulateCrafting(position);

      // Phase 3: Marketplace Listing
      await this.listNFTOnMarketplace(position);

      // Set up monitoring
      this.monitorPosition(position);

      return true;

    } catch (error) {
      logger.error('NFT arbitrage execution failed', {
        positionId,
        error: error instanceof Error ? error.message : String(error)
      });

      // Clean up failed position
      this.activePositions.delete(positionId);
      return false;
    }
  }

  /**
   * Execute token acquisition phase
   */
  private async executeTokenAcquisition(requirements: CraftingRequirement[]): Promise<{
    success: boolean;
    error?: string;
    transactions?: string[];
  }> {
    const transactions: string[] = [];

    try {
      for (const requirement of requirements) {
        logger.debug(`Acquiring ${requirement.amount} ${requirement.token}...`);

        // Use existing swap executor for token acquisition
        const swapResult = await this.swapExecutor.executeSwap({
          tokenIn: 'GALA|Unit|none|none', // Base currency
          tokenOut: `${requirement.token}|Unit|none|none`,
          amountIn: (requirement.priceUSD / 0.04).toString(), // Assuming GALA at $0.04
          slippageTolerance: requirement.slippage / 100,
          deadlineMinutes: 5, // 5 minute deadline
          userAddress: this.config.wallet?.address || "test-address"
        });

        if (swapResult.success) {
          transactions.push(swapResult.transactionId || 'pending');
          logger.debug(`✅ Acquired ${requirement.token}`, {
            txHash: swapResult.transactionId,
            amountOut: swapResult.amountOut
          });
        } else {
          throw new Error(`Failed to acquire ${requirement.token}: ${swapResult.error}`);
        }
      }

      return { success: true, transactions };

    } catch (error) {
      logger.error('Token acquisition failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        transactions
      };
    }
  }

  /**
   * Simulate NFT crafting (would integrate with actual game contracts)
   */
  private async simulateCrafting(position: NFTPosition): Promise<void> {
    logger.info('🔨 Simulating NFT crafting...', {
      positionId: position.id,
      contractAddress: position.contractAddress
    });

    // Simulate crafting time
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second simulation

    // Update position status
    position.craftingCompleteTime = Date.now();
    position.status = 'listing';
    position.tokenId = `crafted-${Date.now()}`;

    logger.info('✅ NFT crafting completed', {
      positionId: position.id,
      tokenId: position.tokenId,
      craftingTime: (position.craftingCompleteTime - (position.craftingStartTime || 0)) / 1000 + 's'
    });

    this.performance.successfulCraftings++;
    this.performance.avgCraftingTime = (
      (this.performance.avgCraftingTime * (this.performance.successfulCraftings - 1)) +
      (position.craftingCompleteTime - (position.craftingStartTime || 0))
    ) / this.performance.successfulCraftings;
  }

  /**
   * List NFT on marketplace
   */
  private async listNFTOnMarketplace(position: NFTPosition): Promise<void> {
    logger.info('📋 Listing NFT on marketplace...', {
      positionId: position.id,
      marketplace: position.marketplace,
      targetPrice: position.profitTarget
    });

    // Simulate marketplace listing
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second simulation

    position.status = 'listed';
    position.listingTime = Date.now();
    position.listingPrice = position.profitTarget;

    logger.info('✅ NFT listed successfully', {
      positionId: position.id,
      listingPrice: position.listingPrice,
      marketplace: position.marketplace
    });
  }

  /**
   * Monitor position for sale completion or management actions
   */
  private monitorPosition(position: NFTPosition): void {
    const monitor = async () => {
      if (!this.activePositions.has(position.id)) return;

      try {
        // Update current floor price
        const currentFloorPrice = await this.nftClient.getFloorPrice(
          position.contractAddress,
          position.marketplace
        );

        position.currentFloorPrice = currentFloorPrice;
        position.currentValue = currentFloorPrice;
        position.unrealizedPnL = currentFloorPrice - position.totalInvestment;

        // Check for sale completion (simulated)
        const saleCompleted = Math.random() < 0.1; // 10% chance per check
        if (saleCompleted && position.status === 'listed') {
          await this.completeSale(position);
          return;
        }

        // Check stop loss
        if (position.currentValue <= position.stopLoss) {
          await this.executeStopLoss(position);
          return;
        }

        // Check max hold time
        if (Date.now() > position.maxHoldTime) {
          await this.emergencyLiquidation(position.id);
          return;
        }

        // Adjust listing price if needed
        if (position.status === 'listed' && position.listingTime) {
          const timeSinceListing = Date.now() - position.listingTime;
          if (timeSinceListing > 4 * 60 * 60 * 1000 && position.listingPrice) { // 4 hours
            await this.adjustListingPrice(position);
          }
        }

        // Schedule next check
        if (this.activePositions.has(position.id)) {
          setTimeout(monitor, 30000); // Check every 30 seconds
        }

      } catch (error) {
        logger.error(`Error monitoring position ${position.id}`, { error });
      }
    };

    monitor();
  }

  /**
   * Complete sale and update performance
   */
  private async completeSale(position: NFTPosition): Promise<void> {
    const salePrice = position.listingPrice || position.currentFloorPrice;
    const profit = salePrice - position.totalInvestment;
    const profitMargin = (profit / position.totalInvestment) * 100;

    logger.info('💰 NFT sale completed', {
      positionId: position.id,
      salePrice,
      profit,
      profitMargin: profitMargin.toFixed(2) + '%',
      holdTime: ((Date.now() - position.openTime) / (60 * 60 * 1000)).toFixed(1) + 'h'
    });

    // Update performance
    this.performance.successfulArbitrages++;
    this.performance.totalProfit += profit;
    this.performance.avgProfitMargin = (
      (this.performance.avgProfitMargin * (this.performance.successfulArbitrages - 1)) + profitMargin
    ) / this.performance.successfulArbitrages;

    const holdTime = Date.now() - position.openTime;
    this.performance.avgHoldTime = (
      (this.performance.avgHoldTime * (this.performance.successfulArbitrages - 1)) + holdTime
    ) / this.performance.successfulArbitrages;

    // Update marketplace distribution
    if (!this.performance.marketplaceDistribution[position.marketplace]) {
      this.performance.marketplaceDistribution[position.marketplace] = 0;
    }
    this.performance.marketplaceDistribution[position.marketplace]++;

    // Remove position
    this.activePositions.delete(position.id);

    // Send alert for successful completion
    await this.alertSystem.tradeAlert({ positionId: position.id, profit, profitMargin }, true);
  }

  /**
   * Execute stop loss
   */
  private async executeStopLoss(position: NFTPosition): Promise<void> {
    const loss = position.totalInvestment - position.currentValue;

    logger.warn('🛑 Executing stop loss', {
      positionId: position.id,
      currentValue: position.currentValue,
      stopLoss: position.stopLoss,
      loss
    });

    // Update performance
    this.performance.totalLoss += loss;

    // Simulate emergency sale at current floor price
    position.status = 'stopped-out';
    this.activePositions.delete(position.id);

    // Send alert
    await this.alertSystem.riskAlert("stop_loss", {
      positionId: position.id,
      loss
    });
  }

  /**
   * Emergency liquidation
   */
  private async emergencyLiquidation(positionId: string): Promise<void> {
    const position = this.activePositions.get(positionId);
    if (!position) return;

    logger.warn('⚠️  Emergency liquidation triggered', {
      positionId: position.id,
      reason: 'Maximum hold time exceeded'
    });

    // Attempt to sell at current floor price
    const emergencyPrice = position.currentFloorPrice * 0.9; // 10% below floor for quick sale
    const loss = position.totalInvestment - emergencyPrice;

    this.performance.totalLoss += Math.max(0, loss);
    this.activePositions.delete(positionId);

    await this.alertSystem.riskAlert("emergency_liquidation", {
      positionId,
      emergencyPrice,
      loss
    });
  }

  /**
   * Adjust listing price for better competitiveness
   */
  private async adjustListingPrice(position: NFTPosition): Promise<void> {
    if (!position.listingPrice) return;

    const newPrice = Math.max(
      position.stopLoss,
      position.currentFloorPrice * 0.98 // 2% below current floor
    );

    if (newPrice < position.listingPrice) {
      logger.info('💲 Adjusting listing price', {
        positionId: position.id,
        oldPrice: position.listingPrice,
        newPrice,
        currentFloor: position.currentFloorPrice
      });

      position.listingPrice = newPrice;
      position.listingTime = Date.now(); // Reset listing timer
    }
  }

  /**
   * Start position monitoring loop
   */
  private startPositionMonitoring(): void {
    const monitorPositions = async () => {
      if (!this.isActive) return;

      try {
        // Update win rate and other performance metrics
        const totalExecuted = this.performance.executedArbitrages;
        const successful = this.performance.successfulArbitrages;
        this.performance.winRate = totalExecuted > 0 ? (successful / totalExecuted) * 100 : 0;

        // Update Sharpe ratio (simplified)
        if (this.performance.totalProfit > 0) {
          const avgReturn = this.performance.avgProfitMargin / 100;
          const volatility = 0.2; // Assume 20% volatility for NFTs
          this.performance.sharpeRatio = avgReturn / volatility;
        }

        // Log position summary
        if (this.activePositions.size > 0) {
          logger.debug('Active NFT positions summary', {
            totalPositions: this.activePositions.size,
            totalInvested: Array.from(this.activePositions.values())
              .reduce((sum, pos) => sum + pos.totalInvestment, 0),
            unrealizedPnL: Array.from(this.activePositions.values())
              .reduce((sum, pos) => sum + pos.unrealizedPnL, 0)
          });
        }

      } catch (error) {
        logger.error('Error in position monitoring', { error });
      }

      if (this.isActive) {
        setTimeout(monitorPositions, 60000); // Update every minute
      }
    };

    monitorPositions();
  }

  /**
   * Start NFT price monitoring
   */
  private async startNFTPriceMonitoring(): Promise<void> {
    await this.nftClient.startPriceMonitoring(
      this.monitoredCollections,
      (contractAddress: string, price: number, marketplace: string) => {
        // Update any active positions for this collection
        for (const position of this.activePositions.values()) {
          if (position.contractAddress === contractAddress && position.marketplace === marketplace) {
            position.currentFloorPrice = price;
            position.currentValue = price;
            position.unrealizedPnL = price - position.totalInvestment;
          }
        }

        logger.debug('NFT price update', { contractAddress, price, marketplace });
      }
    );
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): StrategyPerformance {
    return { ...this.performance };
  }

  /**
   * Get detailed position information
   */
  getActivePositions(): NFTPosition[] {
    return Array.from(this.activePositions.values());
  }
}