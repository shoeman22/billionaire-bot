# Fix Trading Engine Strategy Execution Test

## Problem Overview

The test "should execute strategies based on market conditions" in `TradingEngine.test.ts` is failing because strategies are never executed despite favorable market conditions being mocked. The root cause is that the trading cycle exits early between the `checkLimits()` step and the `analyzeMarket()` step.

## Root Cause Analysis

### Current Execution Flow
The `executeTradingCycle()` method has 9 checkpoint conditions:
1. ✅ Emergency stop check
2. ✅ System health check
3. ✅ Risk assessment (`performRiskCheck` - verified called)
4. ✅ Position limits check (`checkLimits` - verified called)
5. ❌ Market analysis (`analyzeMarket` - **NEVER CALLED**)
6. Portfolio snapshot calculation
7. Emergency condition checks
8. Risk level validation
9. Strategy execution

### Identified Problem
The execution stops between steps 4 and 5, specifically at line 270 in `TradingEngine.ts`:
```typescript
const portfolioSnapshot = await this.getPortfolioSnapshot();
```

This method calls `getPortfolio()` which depends on `liquidityManager.getPositions()` - **this dependency is NOT mocked in the test**.

### Missing Mock Dependencies
```typescript
// MISSING: liquidityManager mock
this.liquidityManager.getPositions() // Called by getPortfolio()
```

## Detailed Implementation Plan

### Step 1: Add Missing liquidityManager Mock

**File:** `src/__tests__/trading/TradingEngine.test.ts`
**Location:** Around line 420 (in the strategy execution test)

```typescript
// Add this mock setup BEFORE engine.start()
const mockLiquidityManager = {
  getPositions: jest.fn().mockResolvedValue([]),
  // Add other required methods as needed
};

// Mock the liquidityManager property
Object.defineProperty(engine, 'liquidityManager', {
  value: mockLiquidityManager,
  writable: true
});
```

### Step 2: Fix Mock Timing and Initialization

**Problem:** Mocks are being set up after engine restart, causing race conditions.

**Solution:** Clear and reset ALL mocks before restarting the engine:

```typescript
it('should execute strategies based on market conditions', async () => {
  // STEP 1: Clear all existing mocks FIRST
  jest.clearAllMocks();

  // STEP 2: Stop engine completely
  await engine.stop();

  // STEP 3: Set up ALL mocks BEFORE restart
  mockMarketAnalysis.analyzeMarket.mockResolvedValue({
    overall: 'bullish',
    confidence: 75,
    volatility: 'low',
    liquidity: 'good'
  });

  mockMarketAnalysis.isFavorableForTrading.mockReturnValue(true);

  mockRiskMonitor.performRiskCheck.mockResolvedValue({
    shouldContinueTrading: true,
    riskLevel: 'low'
  });

  mockPositionLimits.checkLimits.mockResolvedValue({
    canOpenPosition: true,
    availableCapital: 1000
  });

  // NEW: Mock liquidityManager
  const mockLiquidityManager = {
    getPositions: jest.fn().mockResolvedValue([]),
  };
  Object.defineProperty(engine, 'liquidityManager', {
    value: mockLiquidityManager,
    writable: true
  });

  // STEP 4: Restart engine
  await engine.start();

  // STEP 5: Advance timer and flush promises
  jest.advanceTimersByTime(6000);
  await new Promise(setImmediate); // Flush microtasks

  // STEP 6: Verify strategy execution
  expect(mockStrategy.execute).toHaveBeenCalled();
});
```

### Step 3: Handle Async Promise Resolution

**Problem:** Jest fake timers don't automatically resolve pending promises.

**Solution:** Add proper promise flushing:

```typescript
// After advancing timers, flush all pending promises
jest.advanceTimersByTime(6000);

// Method 1: Flush microtasks
await new Promise(setImmediate);

// Method 2: Alternative - run all timers
// jest.runAllTimers();

// Method 3: Wait for specific async operation
// await jest.runOnlyPendingTimersAsync();
```

### Step 4: Add Debug Logging (Temporary)

**Purpose:** Verify exactly where execution stops.

Add console.log statements in `TradingEngine.ts` at each checkpoint:

```typescript
private async executeTradingCycle(): Promise<void> {
  console.log('🔄 Starting trading cycle');

  if (this.emergencyStop) {
    console.log('❌ Emergency stop active');
    return;
  }
  console.log('✅ Checkpoint 1: Emergency stop passed');

  if (!this.systemHealth.isHealthy()) {
    console.log('❌ System not healthy');
    return;
  }
  console.log('✅ Checkpoint 2: System health passed');

  const riskCheck = await this.riskMonitor.performRiskCheck();
  if (!riskCheck.shouldContinueTrading) {
    console.log('❌ Risk check failed');
    return;
  }
  console.log('✅ Checkpoint 3: Risk check passed');

  const limitsCheck = await this.positionLimits.checkLimits();
  if (!limitsCheck.canOpenPosition) {
    console.log('❌ Position limits exceeded');
    return;
  }
  console.log('✅ Checkpoint 4: Position limits passed');

  console.log('🔍 About to call analyzeMarket...');
  const marketCondition = await this.marketAnalysis.analyzeMarket();
  console.log('✅ Checkpoint 5: Market analysis completed', marketCondition);

  // Continue with remaining checkpoints...
}
```

### Step 5: Mock getPortfolio Dependencies

**Problem:** `getPortfolioSnapshot()` has complex dependencies that aren't mocked.

**Solution:** Mock the entire portfolio calculation chain:

```typescript
// Mock getPortfolio to return a simple valid portfolio
const mockGetPortfolio = jest.fn().mockResolvedValue({
  positions: [],
  totalValue: 1000,
  availableCash: 500,
  unrealizedPnL: 0,
  realizedPnL: 0
});

// Replace the method
Object.defineProperty(engine, 'getPortfolio', {
  value: mockGetPortfolio,
  writable: true
});
```

### Step 6: Simplify Test Setup with Helper Function

Create a reusable mock setup function:

```typescript
async function setupFavorableConditions() {
  jest.clearAllMocks();

  // Market conditions
  mockMarketAnalysis.analyzeMarket.mockResolvedValue({
    overall: 'bullish',
    confidence: 75,
    volatility: 'low',
    liquidity: 'good'
  });

  mockMarketAnalysis.isFavorableForTrading.mockReturnValue(true);

  // Risk monitoring
  mockRiskMonitor.performRiskCheck.mockResolvedValue({
    shouldContinueTrading: true,
    riskLevel: 'low'
  });

  // Position limits
  mockPositionLimits.checkLimits.mockResolvedValue({
    canOpenPosition: true,
    availableCapital: 1000
  });

  // Portfolio/liquidity
  const mockLiquidityManager = {
    getPositions: jest.fn().mockResolvedValue([]),
  };
  Object.defineProperty(engine, 'liquidityManager', {
    value: mockLiquidityManager,
    writable: true
  });

  const mockGetPortfolio = jest.fn().mockResolvedValue({
    positions: [],
    totalValue: 1000,
    availableCash: 500,
    unrealizedPnL: 0,
    realizedPnL: 0
  });
  Object.defineProperty(engine, 'getPortfolio', {
    value: mockGetPortfolio,
    writable: true
  });
}
```

### Step 7: Complete Fixed Test

```typescript
it('should execute strategies based on market conditions', async () => {
  // Stop engine and setup favorable conditions
  await engine.stop();
  await setupFavorableConditions();

  // Restart engine
  await engine.start();

  // Wait for trading cycle
  jest.advanceTimersByTime(6000);
  await new Promise(setImmediate);

  // Verify strategy execution
  expect(mockStrategy.execute).toHaveBeenCalled();
  expect(mockMarketAnalysis.analyzeMarket).toHaveBeenCalled();
});
```

## Verification Steps

1. **Run the specific test:** `npm test -- --testNamePattern="should execute strategies based on market conditions"`
2. **Check debug output:** Verify which checkpoint the execution reaches
3. **Verify mock calls:** Ensure all expected mocks are called in order
4. **Remove debug logging:** Clean up console.log statements after fix
5. **Run full test suite:** Ensure no regressions in other tests

## Expected Outcome

After implementing these fixes:
- ✅ `mockRiskMonitor.performRiskCheck` will be called
- ✅ `mockPositionLimits.checkLimits` will be called
- ✅ `mockMarketAnalysis.analyzeMarket` will be called
- ✅ `mockStrategy.execute` will be called
- ✅ Test will pass consistently

## Potential Issues

1. **WebSocket Mock:** If WebSocket events are required for portfolio updates, ensure `mockWebSocketManager` is properly configured
2. **Emergency Conditions:** Verify no emergency conditions are accidentally triggered
3. **Timing Sensitivity:** The 5000ms interval might need adjustment if execution takes longer than expected
4. **Mock Persistence:** Ensure mocks persist through engine restart cycle

## Files to Modify

1. **Primary:** `src/__tests__/trading/TradingEngine.test.ts` (lines 401-465)
2. **Temporary Debug:** `src/trading/TradingEngine.ts` (add/remove console.log statements)
3. **Optional:** Create helper utilities in test utils if this pattern is reused

---

*This plan addresses the complex async timing and mock dependency issues preventing strategy execution in the trading engine test.*