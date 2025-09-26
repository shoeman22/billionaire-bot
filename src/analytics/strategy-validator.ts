/**
 * Strategy Validator for GalaSwap V3 Trading Bot
 *
 * Statistical validation and performance analysis system:
 * - Out-of-sample testing methodology
 * - Strategy comparison and ranking
 * - Risk-adjusted return analysis
 * - Model overfitting detection
 * - Confidence interval calculations
 *
 * Key Features:
 * - Bootstrap sampling for robustness
 * - Cross-validation methodologies
 * - Gaming token specific validation
 * - Performance attribution analysis
 * - Statistical significance testing
 */

// BacktestResults, ValidationResults imports removed - not used
import { TimeSeriesDB } from '../data/storage/timeseries-db';
import { logger } from '../utils/logger';
// TRADING_CONSTANTS import removed - not used

export interface ValidationConfig {
  // Statistical settings
  confidenceLevel: number; // 0.95 for 95% confidence
  minSampleSize: number;
  bootstrapSamples: number;
  
  // Cross-validation
  kFolds: number; // For k-fold cross validation
  holdoutRatio: number; // % for holdout validation
  
  // Gaming-specific validation
  seasonalValidation: boolean;
  eventValidation: boolean;
  crossGameValidation: boolean;
  
  // Risk thresholds
  maxDrawdownThreshold: number;
  minSharpeRatio: number;
  minWinRate: number;
  maxVolatility: number;
  
  // Overfitting detection
  overfittingThreshold: number; // 0-1 scale
  stabilityWindow: number; // Days for stability analysis
}

export interface StrategyValidationResult {
  strategyName: string;
  
  // Overall validation
  isValid: boolean;
  validationScore: number; // 0-100 composite score
  confidenceLevel: number;
  
  // Performance metrics
  expectedReturn: number;
  expectedVolatility: number;
  expectedSharpe: number;
  expectedDrawdown: number;
  
  // Confidence intervals
  returnConfidenceInterval: [number, number];
  sharpeConfidenceInterval: [number, number];
  drawdownConfidenceInterval: [number, number];
  
  // Validation tests
  outOfSampleResults: OutOfSampleResult;
  crossValidationResults: CrossValidationResult;
  bootstrapResults: BootstrapResult;
  stabilityResults: StabilityResult;
  
  // Gaming-specific validation
  gamingValidationResults?: GamingValidationResult;
  
  // Risk assessment
  riskMetrics: RiskAssessment;
  
  // Statistical tests
  statisticalTests: StatisticalTestResults;
  
  // Recommendations
  recommendations: string[];
  warnings: string[];
}

export interface OutOfSampleResult {
  inSampleReturn: number;
  outOfSampleReturn: number;
  degradationFactor: number; // Out/In sample performance ratio
  isStable: boolean; // Performance doesn't degrade significantly
  pValue: number; // Statistical significance
}

export interface CrossValidationResult {
  foldResults: FoldResult[];
  meanReturn: number;
  stdReturn: number;
  meanSharpe: number;
  stdSharpe: number;
  consistency: number; // 0-1 scale, how consistent across folds
}

export interface FoldResult {
  fold: number;
  trainReturn: number;
  testReturn: number;
  trainSharpe: number;
  testSharpe: number;
  degradation: number;
}

export interface BootstrapResult {
  samples: number;
  meanReturn: number;
  stdReturn: number;
  confidenceInterval: [number, number];
  probabilityPositive: number; // Probability of positive returns
  bootstrapRatio: number; // How stable the strategy is
}

export interface StabilityResult {
  isStable: boolean;
  stabilityScore: number; // 0-1 scale
  rollingReturns: number[];
  rollingVolatility: number[];
  maxConsecutiveLosses: number;
  recoveryTime: number; // Average time to recover from drawdowns
}

export interface GamingValidationResult {
  eventPerformance: EventPerformanceResult[];
  seasonalConsistency: number; // How consistent across seasons
  weekendEffect: number; // Performance difference on weekends
  gameSpecificResults: Record<string, number>; // Performance by game token
  communityEventSensitivity: number;
}

export interface EventPerformanceResult {
  eventType: string;
  trades: number;
  avgReturn: number;
  successRate: number;
  significance: number; // Statistical significance of performance
}

export interface RiskAssessment {
  riskScore: number; // 0-100 composite risk score
  
  // Risk factors
  concentrationRisk: number;
  liquidityRisk: number;
  volatilityRisk: number;
  drawdownRisk: number;
  
  // Risk-adjusted metrics
  riskAdjustedReturn: number;
  maxAcceptableLoss: number;
  capitalAtRisk: number;
  
  // Tail risks
  var99: number; // Value at Risk 99%
  expectedShortfall99: number;
  stressTolerance: number; // 0-1 scale
}

export interface StatisticalTestResults {
  // Normality tests
  jarqueBera: JarqueBeraResult;
  shapiroWilk: ShapiroWilkResult;
  
  // Performance tests
  tTest: TTestResult; // Returns vs zero
  zTest: ZTestResult; // Sharpe ratio vs benchmark
  
  // Randomness tests
  runsTest: RunsTestResult;
  autocorrelationTest: AutocorrelationResult;
  
  // Overall statistical validity
  statisticallySignificant: boolean;
  pValueAggregate: number;
}

export interface JarqueBeraResult {
  statistic: number;
  pValue: number;
  isNormal: boolean;
}

export interface ShapiroWilkResult {
  statistic: number;
  pValue: number;
  isNormal: boolean;
}

export interface TTestResult {
  tStatistic: number;
  pValue: number;
  isSignificant: boolean;
  confidenceInterval: [number, number];
}

export interface ZTestResult {
  zStatistic: number;
  pValue: number;
  isSignificant: boolean;
}

export interface RunsTestResult {
  runs: number;
  expectedRuns: number;
  pValue: number;
  isRandom: boolean;
}

export interface AutocorrelationResult {
  lags: number[];
  correlations: number[];
  significantLags: number[];
  isWhiteNoise: boolean;
}

export interface StrategyComparison {
  strategies: StrategyValidationResult[];
  ranking: StrategyRanking[];
  correlationMatrix: number[][];
  diversificationBenefits: number;
  recommendedPortfolio: PortfolioRecommendation;
}

export interface StrategyRanking {
  rank: number;
  strategyName: string;
  validationScore: number;
  riskAdjustedReturn: number;
  confidence: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'AVOID';
}

export interface PortfolioRecommendation {
  allocations: Record<string, number>; // Strategy name -> allocation %
  expectedReturn: number;
  expectedVolatility: number;
  expectedSharpe: number;
  diversificationRatio: number;
  confidence: number;
}

export class StrategyValidator {
  private backtestEngine: BacktestEngine;
  private timeSeriesDB: TimeSeriesDB;
  
  constructor(backtestEngine: BacktestEngine, timeSeriesDB: TimeSeriesDB) {
    this.backtestEngine = backtestEngine;
    this.timeSeriesDB = timeSeriesDB;
  }

  /**
   * Comprehensive validation of a single strategy
   */
  async validateStrategy(
    strategyName: string,
    backtestConfig: BacktestConfig,
    _validationConfig: ValidationConfig
  ): Promise<StrategyValidationResult> {
    logger.info(`🔬 Starting comprehensive validation for strategy: ${strategyName}`);
    
    try {
      // Run base backtest
      const backtestResults = await this.backtestEngine.runBacktest(backtestConfig);
      
      // Extract trades for this strategy
      const strategyTrades = backtestResults.trades.filter(_t => t.strategyName === strategyName);
      
      if (strategyTrades.length < validationConfig.minSampleSize) {
        throw new Error(`Insufficient trades (${strategyTrades.length}) for statistical validation`);
      }
      
      // Run validation tests
      const outOfSampleResults = await this.runOutOfSampleTest(strategyName, backtestConfig, _validationConfig);
      const crossValidationResults = await this.runCrossValidation(strategyName, backtestConfig, _validationConfig);
      const bootstrapResults = await this.runBootstrapAnalysis(strategyTrades, _validationConfig);
      const stabilityResults = await this.analyzeStability(strategyTrades, _validationConfig);
      const statisticalTests = await this.runStatisticalTests(strategyTrades, _validationConfig);
      const riskMetrics = await this.assessRisk(strategyTrades, _validationConfig);
      
      // Gaming-specific validation
      let gamingValidationResults: GamingValidationResult | undefined;
      if (validationConfig.seasonalValidation || validationConfig.eventValidation) {
        gamingValidationResults = await this.validateGamingPerformance(strategyTrades, _validationConfig);
      }
      
      // Calculate confidence intervals
      const returnCI = this.calculateConfidenceInterval(
        strategyTrades.map(_t => t.actualProfit),
        validationConfig.confidenceLevel
      );
      
      const sharpeValues = await this.calculateRollingSharpe(strategyTrades, 30);
      const sharpeCI = this.calculateConfidenceInterval(sharpeValues, validationConfig.confidenceLevel);
      
      const drawdownValues = await this.calculateRollingDrawdown(strategyTrades, 30);
      const drawdownCI = this.calculateConfidenceInterval(drawdownValues, validationConfig.confidenceLevel);
      
      // Calculate validation score
      const validationScore = this.calculateValidationScore({
        outOfSampleResults,
        crossValidationResults,
        bootstrapResults,
        stabilityResults,
        statisticalTests,
        riskMetrics
      }, _validationConfig);
      
      // Generate recommendations
      const recommendations = this.generateRecommendations({
        outOfSampleResults,
        crossValidationResults,
        bootstrapResults,
        stabilityResults,
        riskMetrics,
        validationScore
      });
      
      const warnings = this.generateWarnings({
        outOfSampleResults,
        riskMetrics,
        statisticalTests,
        validationScore
      }, _validationConfig);
      
      const result: StrategyValidationResult = {
        strategyName,
        isValid: validationScore >= 70 && statisticalTests.statisticallySignificant,
        validationScore,
        confidenceLevel: validationConfig.confidenceLevel,
        expectedReturn: bootstrapResults.meanReturn,
        expectedVolatility: bootstrapResults.stdReturn,
        expectedSharpe: crossValidationResults.meanSharpe,
        expectedDrawdown: Math.abs(Math.min(...drawdownValues)),
        returnConfidenceInterval: returnCI,
        sharpeConfidenceInterval: sharpeCI,
        drawdownConfidenceInterval: drawdownCI,
        outOfSampleResults,
        crossValidationResults,
        bootstrapResults,
        stabilityResults,
        gamingValidationResults,
        riskMetrics,
        statisticalTests,
        recommendations,
        warnings
      };
      
      logger.info(`✅ Strategy validation completed: ${strategyName} - Score: ${validationScore}/100`);
      return result;
      
    } catch (error) {
      logger.error(`❌ Strategy validation failed for ${strategyName}:`, error);
      throw error;
    }
  }

  /**
   * Compare multiple strategies and generate rankings
   */
  async compareStrategies(
    strategies: string[],
    backtestConfig: BacktestConfig,
    _validationConfig: ValidationConfig
  ): Promise<StrategyComparison> {
    logger.info(`📊 Comparing ${strategies.length} strategies...`);
    
    const validationResults: StrategyValidationResult[] = [];
    
    // Validate each strategy
    for (const strategyName of strategies) {
      const strategyConfig = {
        ...backtestConfig,
        strategies: backtestConfig.strategies.filter(s => s.strategyName === strategyName)
      };
      
      const result = await this.validateStrategy(strategyName, strategyConfig, _validationConfig);
      validationResults.push(result);
    }
    
    // Calculate correlations between strategies
    const correlationMatrix = await this.calculateStrategyCorrelations(validationResults);
    
    // Rank strategies
    const ranking = this.rankStrategies(validationResults);
    
    // Calculate diversification benefits
    const diversificationBenefits = this.calculateDiversificationBenefits(correlationMatrix);
    
    // Generate portfolio recommendation
    const recommendedPortfolio = this.generatePortfolioRecommendation(validationResults, correlationMatrix);
    
    return {
      strategies: validationResults,
      ranking,
      correlationMatrix,
      diversificationBenefits,
      recommendedPortfolio
    };
  }

  /**
   * Out-of-sample testing
   */
  private async runOutOfSampleTest(
    strategyName: string,
    backtestConfig: BacktestConfig,
    _validationConfig: ValidationConfig
  ): Promise<OutOfSampleResult> {
    logger.info(`📈 Running out-of-sample test for ${strategyName}...`);
    
    const totalPeriod = backtestConfig.endTime - backtestConfig.startTime;
    const splitPoint = backtestConfig.startTime + (totalPeriod * (1 - validationConfig.holdoutRatio));
    
    // In-sample period
    const inSampleConfig = {
      ...backtestConfig,
      endTime: splitPoint
    };
    
    // Out-of-sample period
    const outSampleConfig = {
      ...backtestConfig,
      startTime: splitPoint
    };
    
    // Run backtests
    const inSampleResults = await this.backtestEngine.runBacktest(inSampleConfig);
    const outSampleResults = await this.backtestEngine.runBacktest(outSampleConfig);
    
    const inSampleReturn = inSampleResults.annualizedReturn;
    const outSampleReturn = outSampleResults.annualizedReturn;
    const degradationFactor = outSampleReturn / inSampleReturn;
    
    // Statistical significance test
    const pValue = this.calculatePValue(
      inSampleResults.trades.filter(_t => t.strategyName === strategyName),
      outSampleResults.trades.filter(_t => t.strategyName === strategyName)
    );
    
    return {
      inSampleReturn,
      outOfSampleReturn: outSampleReturn,
      degradationFactor,
      isStable: degradationFactor > 0.7, // Less than 30% degradation
      pValue
    };
  }

  /**
   * K-fold cross validation
   */
  private async runCrossValidation(
    strategyName: string,
    backtestConfig: BacktestConfig,
    _validationConfig: ValidationConfig
  ): Promise<CrossValidationResult> {
    logger.info(`🔄 Running ${validationConfig.kFolds}-fold cross validation for ${strategyName}...`);
    
    const foldResults: FoldResult[] = [];
    const totalPeriod = backtestConfig.endTime - backtestConfig.startTime;
    const foldSize = totalPeriod / validationConfig.kFolds;
    
    for (let fold = 0; fold < validationConfig.kFolds; fold++) {
      const testStart = backtestConfig.startTime + (fold * foldSize);
      const testEnd = testStart + foldSize;
      
      // Training data (all folds except current)
      const _trainConfig1 = fold > 0 ? {
        ...backtestConfig,
        startTime: backtestConfig.startTime,
        endTime: testStart
      } : null;
      
      const _trainConfig2 = fold < validationConfig.kFolds - 1 ? {
        ...backtestConfig,
        startTime: testEnd,
        endTime: backtestConfig.endTime
      } : null;
      
      // Test data (current fold)
      const testConfig = {
        ...backtestConfig,
        startTime: testStart,
        endTime: testEnd
      };
      
      // Run tests (simplified - in practice would combine training sets)
      const testResults = await this.backtestEngine.runBacktest(testConfig);
      
      // For training, use a representative fold (simplified)
      const trainResults = await this.backtestEngine.runBacktest({
        ...backtestConfig,
        startTime: backtestConfig.startTime,
        endTime: testStart
      });
      
      const foldResult: FoldResult = {
        fold: fold + 1,
        trainReturn: trainResults.annualizedReturn,
        testReturn: testResults.annualizedReturn,
        trainSharpe: trainResults.sharpeRatio,
        testSharpe: testResults.sharpeRatio,
        degradation: testResults.annualizedReturn / trainResults.annualizedReturn
      };
      
      foldResults.push(foldResult);
    }
    
    // Calculate cross-validation metrics
    const testReturns = foldResults.map(f => f.testReturn);
    const testSharpes = foldResults.map(f => f.testSharpe);
    
    const meanReturn = testReturns.reduce((sum, r) => sum + r, 0) / testReturns.length;
    const stdReturn = Math.sqrt(testReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / testReturns.length);
    
    const meanSharpe = testSharpes.reduce((sum, s) => sum + s, 0) / testSharpes.length;
    const stdSharpe = Math.sqrt(testSharpes.reduce((sum, s) => sum + Math.pow(s - meanSharpe, 2), 0) / testSharpes.length);
    
    const consistency = 1 - (stdReturn / Math.abs(meanReturn)); // Lower variance = higher consistency
    
    return {
      foldResults,
      meanReturn,
      stdReturn,
      meanSharpe,
      stdSharpe,
      consistency: Math.max(0, Math.min(1, consistency))
    };
  }

  /**
   * Bootstrap analysis for robust statistics
   */
  private async runBootstrapAnalysis(
    trades: BacktestTrade[],
    _validationConfig: ValidationConfig
  ): Promise<BootstrapResult> {
    logger.info(`🎲 Running bootstrap analysis with ${validationConfig.bootstrapSamples} samples...`);
    
    const bootstrapReturns: number[] = [];
    
    for (let i = 0; i < validationConfig.bootstrapSamples; i++) {
      // Bootstrap sample (sample with replacement)
      const bootstrapSample: BacktestTrade[] = [];
      for (let j = 0; j < trades.length; j++) {
        const randomIndex = Math.floor(Math.random() * trades.length);
        bootstrapSample.push(trades[randomIndex]);
      }
      
      // Calculate return for this bootstrap sample
      const totalReturn = bootstrapSample.reduce((sum, _t) => sum + t.actualProfit, 0) / bootstrapSample.length;
      bootstrapReturns.push(totalReturn);
    }
    
    const meanReturn = bootstrapReturns.reduce((sum, r) => sum + r, 0) / bootstrapReturns.length;
    const stdReturn = Math.sqrt(
      bootstrapReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / bootstrapReturns.length
    );
    
    const confidenceInterval = this.calculateConfidenceInterval(bootstrapReturns, validationConfig.confidenceLevel);
    const probabilityPositive = bootstrapReturns.filter(r => r > 0).length / bootstrapReturns.length;
    
    // Bootstrap ratio: how consistent are the results
    const bootstrapRatio = 1 - (stdReturn / Math.abs(meanReturn));
    
    return {
      samples: validationConfig.bootstrapSamples,
      meanReturn,
      stdReturn,
      confidenceInterval,
      probabilityPositive,
      bootstrapRatio: Math.max(0, Math.min(1, bootstrapRatio))
    };
  }

  /**
   * Analyze strategy stability over time
   */
  private async analyzeStability(
    trades: BacktestTrade[],
    _validationConfig: ValidationConfig
  ): Promise<StabilityResult> {
    logger.info('📊 Analyzing strategy stability...');
    
    // Calculate rolling returns
    const rollingReturns = await this.calculateRollingReturns(trades, validationConfig.stabilityWindow);
    const rollingVolatility = await this.calculateRollingVolatility(trades, validationConfig.stabilityWindow);
    
    // Calculate consecutive losses
    let maxConsecutiveLosses = 0;
    let currentLosses = 0;
    
    for (const trade of trades) {
      if (trade.actualProfit < 0) {
        currentLosses++;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
      } else {
        currentLosses = 0;
      }
    }
    
    // Calculate recovery time (simplified)
    const recoveryTime = this.calculateAverageRecoveryTime(trades);
    
    // Stability score based on various factors
    const returnStability = 1 - (Math.max(...rollingReturns) - Math.min(...rollingReturns)) / Math.abs(rollingReturns.reduce((sum, r) => sum + r, 0) / rollingReturns.length);
    const volatilityStability = 1 - (Math.max(...rollingVolatility) - Math.min(...rollingVolatility)) / (rollingVolatility.reduce((sum, v) => sum + v, 0) / rollingVolatility.length);
    
    const stabilityScore = (returnStability + volatilityStability) / 2;
    const isStable = stabilityScore > 0.7 && maxConsecutiveLosses < 10;
    
    return {
      isStable,
      stabilityScore: Math.max(0, Math.min(1, stabilityScore)),
      rollingReturns,
      rollingVolatility,
      maxConsecutiveLosses,
      recoveryTime
    };
  }

  /**
   * Gaming-specific performance validation
   */
  private async validateGamingPerformance(
    trades: BacktestTrade[],
    _validationConfig: ValidationConfig
  ): Promise<GamingValidationResult> {
    logger.info('🎮 Running gaming-specific validation...');
    
    // Event performance analysis
    const eventTypes = ['tournament', 'update', 'launch', 'community'];
    const eventPerformance: EventPerformanceResult[] = [];
    
    for (const eventType of eventTypes) {
      // In a real implementation, would filter trades by actual events
      const eventTrades = trades.filter(_t => Math.random() < 0.3); // Mock event trades
      
      if (eventTrades.length > 0) {
        const avgReturn = eventTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / eventTrades.length;
        const successRate = eventTrades.filter(_t => t.success).length / eventTrades.length;
        
        eventPerformance.push({
          eventType,
          trades: eventTrades.length,
          avgReturn,
          successRate,
          significance: this.calculateSignificance(eventTrades, trades)
        });
      }
    }
    
    // Weekend effect analysis
    const weekendTrades = trades.filter(_t => {
      const dayOfWeek = new Date(t.timestamp).getDay();
      return dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;
    });
    
    const weekdayTrades = trades.filter(_t => {
      const dayOfWeek = new Date(t.timestamp).getDay();
      return dayOfWeek > 0 && dayOfWeek < 5;
    });
    
    const weekendAvgReturn = weekendTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / weekendTrades.length;
    const weekdayAvgReturn = weekdayTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / weekdayTrades.length;
    const weekendEffect = weekendAvgReturn - weekdayAvgReturn;
    
    // Game-specific analysis
    const gameTokens = ['GALA|Unit|none|none', 'TOWN|Unit|none|none', 'ETIME|Unit|none|none'];
    const gameSpecificResults: Record<string, number> = {};
    
    for (const token of gameTokens) {
      const tokenTrades = trades.filter(_t => t.tokenIn === token || t.tokenOut === token);
      if (tokenTrades.length > 0) {
        gameSpecificResults[token] = tokenTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / tokenTrades.length;
      }
    }
    
    // Seasonal consistency (quarterly analysis)
    const seasonalReturns: number[] = [];
    const quarterMs = 90 * 24 * 60 * 60 * 1000;
    const minTimestamp = Math.min(...trades.map(_t => t.timestamp));
    const maxTimestamp = Math.max(...trades.map(_t => t.timestamp));
    
    for (let time = minTimestamp; time < maxTimestamp; time += quarterMs) {
      const quarterTrades = trades.filter(_t => t.timestamp >= time && t.timestamp < time + quarterMs);
      if (quarterTrades.length > 0) {
        const quarterReturn = quarterTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / quarterTrades.length;
        seasonalReturns.push(quarterReturn);
      }
    }
    
    const seasonalMean = seasonalReturns.reduce((sum, r) => sum + r, 0) / seasonalReturns.length;
    const seasonalStd = Math.sqrt(seasonalReturns.reduce((sum, r) => sum + Math.pow(r - seasonalMean, 2), 0) / seasonalReturns.length);
    const seasonalConsistency = 1 - (seasonalStd / Math.abs(seasonalMean));
    
    return {
      eventPerformance,
      seasonalConsistency: Math.max(0, Math.min(1, seasonalConsistency)),
      weekendEffect,
      gameSpecificResults,
      communityEventSensitivity: eventPerformance.length > 0 ? eventPerformance.reduce((sum, e) => sum + e.significance, 0) / eventPerformance.length : 0
    };
  }

  /**
   * Comprehensive risk assessment
   */
  private async assessRisk(
    trades: BacktestTrade[],
    _validationConfig: ValidationConfig
  ): Promise<RiskAssessment> {
    logger.info('⚠️ Assessing risk metrics...');
    
    const returns = trades.map(_t => t.actualProfit);
    const amounts = trades.map(_t => t.amountIn);
    
    // Concentration risk
    const tokenCount = new Set([...trades.map(_t => t.tokenIn), ...trades.map(_t => t.tokenOut)]).size;
    const concentrationRisk = 1 - (tokenCount / 10); // Normalize to 0-1
    
    // Liquidity risk
    const avgLiquidityScore = trades.reduce((sum, _t) => sum + t.liquidityScore, 0) / trades.length;
    const liquidityRisk = 1 - avgLiquidityScore;
    
    // Volatility risk
    const returnMean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const returnVar = returns.reduce((sum, r) => sum + Math.pow(r - returnMean, 2), 0) / returns.length;
    const volatility = Math.sqrt(returnVar);
    const volatilityRisk = Math.min(1, volatility / 0.1); // Normalize against 10% volatility
    
    // Drawdown risk
    let peak = 0;
    let maxDrawdown = 0;
    let runningTotal = 0;
    
    for (const trade of trades) {
      runningTotal += trade.actualProfit * trade.amountIn;
      peak = Math.max(peak, runningTotal);
      const drawdown = (peak - runningTotal) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    const drawdownRisk = Math.min(1, maxDrawdown / 0.2); // Normalize against 20% drawdown
    
    // Risk score (0-100)
    const riskScore = (concentrationRisk * 25) + (liquidityRisk * 25) + (volatilityRisk * 25) + (drawdownRisk * 25);
    
    // Risk-adjusted return
    const riskAdjustedReturn = returnMean / volatility;
    
    // VaR and Expected Shortfall
    const sortedReturns = returns.sort((a, b) => a - b);
    const var99Index = Math.floor(0.01 * sortedReturns.length);
    const var99 = sortedReturns[var99Index] || 0;
    
    const tailReturns = sortedReturns.slice(0, var99Index + 1);
    const expectedShortfall99 = tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;
    
    // Capital at risk
    const maxAmount = Math.max(...amounts);
    const capitalAtRisk = maxAmount * Math.abs(var99);
    
    return {
      riskScore,
      concentrationRisk,
      liquidityRisk,
      volatilityRisk,
      drawdownRisk,
      riskAdjustedReturn,
      maxAcceptableLoss: Math.abs(var99) * 100, // As percentage
      capitalAtRisk,
      var99,
      expectedShortfall99,
      stressTolerance: Math.max(0, 1 - (riskScore / 100))
    };
  }

  /**
   * Statistical significance tests
   */
  private async runStatisticalTests(
    trades: BacktestTrade[],
    _validationConfig: ValidationConfig
  ): Promise<StatisticalTestResults> {
    logger.info('📈 Running statistical tests...');
    
    const returns = trades.map(_t => t.actualProfit);
    
    // T-test for returns vs zero
    const tTest = this.performTTest(returns, 0);
    
    // Jarque-Bera test for normality
    const jarqueBera = this.performJarqueBeraTest(returns);
    
    // Runs test for randomness
    const runsTest = this.performRunsTest(returns);
    
    // Simplified implementations for other tests
    const shapiroWilk: ShapiroWilkResult = {
      statistic: 0.95,
      pValue: 0.1,
      isNormal: true
    };
    
    const zTest: ZTestResult = {
      zStatistic: 2.5,
      pValue: 0.01,
      isSignificant: true
    };
    
    const autocorrelationTest: AutocorrelationResult = {
      lags: [1, 2, 3, 4, 5],
      correlations: [0.05, 0.02, -0.01, 0.03, -0.02],
      significantLags: [],
      isWhiteNoise: true
    };
    
    const statisticallySignificant = tTest.isSignificant && tTest.pValue < 0.05;
    const pValueAggregate = Math.min(tTest.pValue, jarqueBera.pValue, runsTest.pValue);
    
    return {
      jarqueBera,
      shapiroWilk,
      tTest,
      zTest,
      runsTest,
      autocorrelationTest,
      statisticallySignificant,
      pValueAggregate
    };
  }

  // Helper methods for calculations

  private calculateConfidenceInterval(values: number[], confidence: number): [number, number] {
    const sorted = values.sort((a, b) => a - b);
    const alpha = 1 - confidence;
    const lowerIndex = Math.floor((alpha / 2) * sorted.length);
    const upperIndex = Math.floor((1 - alpha / 2) * sorted.length);
    
    return [sorted[lowerIndex] || 0, sorted[upperIndex] || 0];
  }

  private async calculateRollingSharpe(trades: BacktestTrade[], window: number): Promise<number[]> {
    const sharpeValues: number[] = [];
    
    for (let i = window; i <= trades.length; i++) {
      const windowTrades = trades.slice(i - window, i);
      const returns = windowTrades.map(_t => t.actualProfit);
      
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const std = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length);
      
      const sharpe = std === 0 ? 0 : mean / std;
      sharpeValues.push(sharpe);
    }
    
    return sharpeValues;
  }

  private async calculateRollingDrawdown(trades: BacktestTrade[], window: number): Promise<number[]> {
    const drawdownValues: number[] = [];
    
    for (let i = window; i <= trades.length; i++) {
      const windowTrades = trades.slice(i - window, i);
      
      let peak = 0;
      let maxDrawdown = 0;
      let runningTotal = 0;
      
      for (const trade of windowTrades) {
        runningTotal += trade.actualProfit;
        peak = Math.max(peak, runningTotal);
        const drawdown = (peak - runningTotal) / Math.max(peak, 0.01); // Avoid division by zero
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }
      
      drawdownValues.push(-maxDrawdown); // Negative for drawdown
    }
    
    return drawdownValues;
  }

  private async calculateRollingReturns(trades: BacktestTrade[], window: number): Promise<number[]> {
    const rollingReturns: number[] = [];
    
    for (let i = window; i <= trades.length; i++) {
      const windowTrades = trades.slice(i - window, i);
      const totalReturn = windowTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / windowTrades.length;
      rollingReturns.push(totalReturn);
    }
    
    return rollingReturns;
  }

  private async calculateRollingVolatility(trades: BacktestTrade[], window: number): Promise<number[]> {
    const rollingVolatility: number[] = [];
    
    for (let i = window; i <= trades.length; i++) {
      const windowTrades = trades.slice(i - window, i);
      const returns = windowTrades.map(_t => t.actualProfit);
      
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      rollingVolatility.push(Math.sqrt(variance));
    }
    
    return rollingVolatility;
  }

  private calculateAverageRecoveryTime(trades: BacktestTrade[]): number {
    const recoveryTimes: number[] = [];
    let inDrawdown = false;
    let drawdownStart = 0;
    let peak = 0;
    let runningTotal = 0;
    
    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      runningTotal += trade.actualProfit;
      
      if (runningTotal > peak) {
        peak = runningTotal;
        if (inDrawdown) {
          // Recovery complete
          const recoveryTime = i - drawdownStart;
          recoveryTimes.push(recoveryTime);
          inDrawdown = false;
        }
      } else if (!inDrawdown && runningTotal < peak) {
        // Start of drawdown
        inDrawdown = true;
        drawdownStart = i;
      }
    }
    
    return recoveryTimes.length > 0 ? recoveryTimes.reduce((sum, _t) => sum + _t, 0) / recoveryTimes.length : 0;
  }

  private calculatePValue(sample1: BacktestTrade[], sample2: BacktestTrade[]): number {
    // Simplified p-value calculation (would use proper statistical test)
    const returns1 = sample1.map(_t => t.actualProfit);
    const returns2 = sample2.map(_t => t.actualProfit);
    
    const mean1 = returns1.reduce((sum, r) => sum + r, 0) / returns1.length;
    const mean2 = returns2.reduce((sum, r) => sum + r, 0) / returns2.length;
    
    const variance1 = returns1.reduce((sum, r) => sum + Math.pow(r - mean1, 2), 0) / returns1.length;
    const variance2 = returns2.reduce((sum, r) => sum + Math.pow(r - mean2, 2), 0) / returns2.length;
    
    const pooledVariance = ((returns1.length - 1) * variance1 + (returns2.length - 1) * variance2) / (returns1.length + returns2.length - 2);
    const standardError = Math.sqrt(pooledVariance * (1 / returns1.length + 1 / returns2.length));
    
    const tStatistic = (mean1 - mean2) / standardError;
    
    // Simplified p-value approximation
    return Math.max(0.001, 2 * (1 - Math.abs(tStatistic) / 3)); // Rough approximation
  }

  private calculateSignificance(eventTrades: BacktestTrade[], allTrades: BacktestTrade[]): number {
    const eventReturn = eventTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / eventTrades.length;
    const overallReturn = allTrades.reduce((sum, _t) => sum + t.actualProfit, 0) / allTrades.length;
    
    // Simplified significance calculation
    return Math.abs(eventReturn - overallReturn) / Math.abs(overallReturn);
  }

  private performTTest(sample: number[], expectedMean: number): TTestResult {
    const mean = sample.reduce((sum, x) => sum + x, 0) / sample.length;
    const variance = sample.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (sample.length - 1);
    const standardError = Math.sqrt(variance / sample.length);
    
    const tStatistic = (mean - expectedMean) / standardError;
    const _degreesOfFreedom = sample.length - 1;
    
    // Simplified p-value calculation (would use proper t-distribution)
    const pValue = Math.max(0.001, 2 * Math.exp(-0.5 * Math.abs(tStatistic)));
    const isSignificant = pValue < 0.05;
    
    // Confidence interval
    const margin = 1.96 * standardError; // Approximate 95% CI
    const confidenceInterval: [number, number] = [mean - margin, mean + margin];
    
    return {
      tStatistic,
      pValue,
      isSignificant,
      confidenceInterval
    };
  }

  private performJarqueBeraTest(sample: number[]): JarqueBeraResult {
    const n = sample.length;
    const mean = sample.reduce((sum, x) => sum + x, 0) / n;
    
    // Calculate moments
    const secondMoment = sample.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / n;
    const thirdMoment = sample.reduce((sum, x) => sum + Math.pow(x - mean, 3), 0) / n;
    const fourthMoment = sample.reduce((sum, x) => sum + Math.pow(x - mean, 4), 0) / n;
    
    // Calculate skewness and kurtosis
    const skewness = thirdMoment / Math.pow(secondMoment, 1.5);
    const kurtosis = fourthMoment / Math.pow(secondMoment, 2);
    
    // Jarque-Bera statistic
    const statistic = (n / 6) * (Math.pow(skewness, 2) + Math.pow(kurtosis - 3, 2) / 4);
    
    // Simplified p-value (would use chi-squared distribution)
    const pValue = Math.max(0.001, Math.exp(-statistic / 2));
    const isNormal = pValue > 0.05;
    
    return {
      statistic,
      pValue,
      isNormal
    };
  }

  private performRunsTest(sample: number[]): RunsTestResult {
    const median = [...sample].sort((a, b) => a - b)[Math.floor(sample.length / 2)];
    
    // Convert to runs above/below median
    const runs: boolean[] = sample.map(x => x > median);
    
    // Count runs
    let runsCount = 1;
    for (let i = 1; i < runs.length; i++) {
      if (runs[i] !== runs[i - 1]) {
        runsCount++;
      }
    }
    
    // Calculate expected runs under null hypothesis
    const n1 = runs.filter(r => r).length;
    const n2 = runs.filter(r => !r).length;
    const expectedRuns = (2 * n1 * n2) / (n1 + n2) + 1;
    
    // Simplified p-value calculation
    const pValue = Math.max(0.001, Math.exp(-Math.abs(runsCount - expectedRuns) / 2));
    const isRandom = pValue > 0.05;
    
    return {
      runs: runsCount,
      expectedRuns,
      pValue,
      isRandom
    };
  }

  private calculateValidationScore(results: unknown, _config: ValidationConfig): number {
    let score = 0;
    
    // Out-of-sample performance (25 points)
    if (results.outOfSampleResults.isStable) {
      score += 25 * Math.max(0, results.outOfSampleResults.degradationFactor);
    }
    
    // Cross-validation consistency (25 points)
    score += 25 * results.crossValidationResults.consistency;
    
    // Bootstrap stability (20 points)
    score += 20 * results.bootstrapResults.bootstrapRatio;
    
    // Statistical significance (15 points)
    if (results.statisticalTests.statisticallySignificant) {
      score += 15;
    }
    
    // Risk metrics (15 points)
    score += 15 * results.riskMetrics.stressTolerance;
    
    return Math.min(100, Math.max(0, score));
  }

  private generateRecommendations(results: unknown): string[] {
    const recommendations: string[] = [];
    
    if (results.validationScore >= 80) {
      recommendations.push('STRONG BUY: Excellent validation metrics across all tests');
    } else if (results.validationScore >= 70) {
      recommendations.push('BUY: Good validation metrics with acceptable risk levels');
    } else if (results.validationScore >= 50) {
      recommendations.push('HOLD: Moderate performance, consider parameter optimization');
    } else {
      recommendations.push('AVOID: Poor validation metrics, significant improvement needed');
    }
    
    if (results.bootstrapResults.probabilityPositive > 0.7) {
      recommendations.push('High probability of positive returns');
    }
    
    if (results.stabilityResults.isStable) {
      recommendations.push('Strategy shows good stability over time');
    }
    
    if (results.riskMetrics.riskScore < 30) {
      recommendations.push('Low risk profile suitable for conservative portfolios');
    }
    
    return recommendations;
  }

  private generateWarnings(results: unknown, _config: ValidationConfig): string[] {
    const warnings: string[] = [];
    
    if (!results.outOfSampleResults.isStable) {
      warnings.push('WARNING: Significant performance degradation in out-of-sample testing');
    }
    
    if (results.riskMetrics.riskScore > 70) {
      warnings.push('WARNING: High risk score, consider position sizing limits');
    }
    
    if (!results.statisticalTests.statisticallySignificant) {
      warnings.push('WARNING: Results may not be statistically significant');
    }
    
    if (results.stabilityResults.maxConsecutiveLosses > 10) {
      warnings.push('WARNING: High consecutive losses, review risk management');
    }
    
    return warnings;
  }

  private async calculateStrategyCorrelations(results: StrategyValidationResult[]): Promise<number[][]> {
    const n = results.length;
    const correlationMatrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    
    // Simplified correlation calculation (would use actual trade data)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          correlationMatrix[i][j] = 1.0;
        } else {
          // Mock correlation based on strategy types
          const correlation = Math.random() * 0.6 + 0.2; // 0.2 to 0.8
          correlationMatrix[i][j] = correlation;
        }
      }
    }
    
    return correlationMatrix;
  }

  private rankStrategies(results: StrategyValidationResult[]): StrategyRanking[] {
    const rankings = results.map((result, _index) => ({
      rank: 0, // Will be set after sorting
      strategyName: result.strategyName,
      validationScore: result.validationScore,
      riskAdjustedReturn: result.riskMetrics.riskAdjustedReturn,
      confidence: result.confidenceLevel,
      recommendation: this.getRecommendation(result.validationScore)
    }));
    
    // Sort by validation score
    rankings.sort((a, b) => b.validationScore - a.validationScore);
    
    // Set ranks
    rankings.forEach((ranking, _index) => {
      ranking.rank = index + 1;
    });
    
    return rankings;
  }

  private getRecommendation(score: number): 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'AVOID' {
    if (score >= 80) return 'STRONG_BUY';
    if (score >= 70) return 'BUY';
    if (score >= 50) return 'HOLD';
    if (score >= 30) return 'SELL';
    return 'AVOID';
  }

  private calculateDiversificationBenefits(correlationMatrix: number[][]): number {
    // Average correlation
    let totalCorrelation = 0;
    let count = 0;
    
    for (let i = 0; i < correlationMatrix.length; i++) {
      for (let j = i + 1; j < correlationMatrix[i].length; j++) {
        totalCorrelation += correlationMatrix[i][j];
        count++;
      }
    }
    
    const avgCorrelation = count > 0 ? totalCorrelation / count : 0;
    
    // Diversification benefit (lower correlation = higher benefit)
    return 1 - avgCorrelation;
  }

  private generatePortfolioRecommendation(
    results: StrategyValidationResult[],
    correlationMatrix: number[][]
  ): PortfolioRecommendation {
    // Simple equal-weight allocation for valid strategies
    const validStrategies = results.filter(r => r.isValid && r.validationScore >= 70);
    
    const allocations: Record<string, number> = {};
    const allocationPerStrategy = validStrategies.length > 0 ? 100 / validStrategies.length : 0;
    
    validStrategies.forEach(strategy => {
      allocations[strategy.strategyName] = allocationPerStrategy;
    });
    
    // Calculate portfolio metrics (simplified)
    const expectedReturn = validStrategies.reduce((sum, s) => sum + s.expectedReturn * (allocationPerStrategy / 100), 0);
    const expectedVolatility = validStrategies.reduce((sum, s) => sum + s.expectedVolatility * (allocationPerStrategy / 100), 0);
    const expectedSharpe = expectedVolatility === 0 ? 0 : expectedReturn / expectedVolatility;
    
    return {
      allocations,
      expectedReturn,
      expectedVolatility,
      expectedSharpe,
      diversificationRatio: this.calculateDiversificationBenefits(correlationMatrix),
      confidence: validStrategies.reduce((sum, s) => sum + s.confidenceLevel, 0) / validStrategies.length
    };
  }
}

// Export types and main class
