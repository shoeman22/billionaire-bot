# GalaSwap Wrapper Cleanup - Sonnet Execution Prompt

**REQUIRED MODEL: Latest Sonnet (4+) - Optimal for parallel coordination and efficient implementation**

## Task Overview
Remove 860 lines of custom GalaSwap wrapper code and migrate to native SDK with baseUrl override. This is a proven solution that works perfectly in production.

## Context
The billionaire-bot currently uses a complex custom wrapper (`src/services/gswap-wrapper.ts`) that was created to fix SDK endpoint issues. However, we've discovered that the native SDK supports a `baseUrl` parameter that solves all the problems without any wrapper code:

```typescript
// Working solution - proven in production
const gSwap = new GSwap({
  signer: new PrivateKeySigner(privateKey),
  baseUrl: 'https://dex-backend-prod1.defi.gala.com'
});
```

## File Impact Summary
- **44 total files** import from wrapper (29 in src/, 15 debug scripts)
- **Core files**: TradingEngine.ts, swap-executor.ts, arbitrage.ts, risk-monitor.ts
- **Wrapper to delete**: `src/services/gswap-wrapper.ts` (860 lines)
- **Debug scripts to delete**: 15 root-level test/debug files

## Execution Plan

### Phase 1: Core Engine Update (Priority 1)
1. **Update TradingEngine.ts constructor**:
   - Change import: `'../services/gswap-wrapper'` → `'@gala-chain/gswap-sdk'`
   - Simplify constructor to only use `baseUrl: config.api.baseUrl`
   - Remove `gatewayBaseUrl`, `dexBackendBaseUrl`, `bundlerBaseUrl` parameters

### Phase 2: Batch Import Updates (Priority 1)
**Use TypeScript Language Server for precision:**
2. **Find all wrapper references**: `mcp__typescript-language-server__references("GSwap")`
3. **Update 29 src/ files** - batch import changes:
   ```typescript
   // BEFORE
   import { GSwap, PrivateKeySigner } from '../services/gswap-wrapper';

   // AFTER
   import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
   ```

### Phase 3: Verification (Priority 1)
4. **Run TypeScript diagnostics**: `mcp__typescript-language-server__diagnostics`
5. **Run test suite**: `npm test` (123 tests must pass)
6. **Test production trade**: Execute small trade to verify

### Phase 4: Cleanup (Priority 2)
7. **Delete wrapper**: Remove `src/services/gswap-wrapper.ts`
8. **Delete debug scripts**: Remove 15 root-level debug files
9. **Final verification**: Run tests again

## Key Files to Update

### Core Trading Files (Must Work):
- `/home/andy/dev-gala/billionaire-bot/src/trading/TradingEngine.ts`
- `/home/andy/dev-gala/billionaire-bot/src/trading/execution/swap-executor.ts`
- `/home/andy/dev-gala/billionaire-bot/src/trading/strategies/arbitrage.ts`
- `/home/andy/dev-gala/billionaire-bot/src/trading/risk/risk-monitor.ts`

### Files to Delete:
- `/home/andy/dev-gala/billionaire-bot/src/services/gswap-wrapper.ts`
- All `test-*.ts`, `debug-*.ts`, `execute-*.ts` files in root directory

## Method Compatibility
SDK methods are already compatible (no changes needed):
- ✅ `gSwap.quoting.quoteExactInput()`
- ✅ `gSwap.swaps.swap()`
- ✅ `gSwap.pools.getPoolData()`
- ✅ `gSwap.pools.calculateSpotPrice()`

## Success Criteria
- [ ] All 123 tests pass
- [ ] TypeScript compilation clean
- [ ] Production trade executes successfully
- [ ] Wrapper code deleted
- [ ] Debug scripts removed

## Parallel Coordination Strategy
Launch specialized agents:
1. **@code-reviewer** - Review changes for security (real trading funds at risk)
2. **@backend-developer** - Handle core trading engine updates
3. **@typescript-language-server** - Use for precise refactoring

## Commands to Execute
```bash
# Verify current state
npm test

# After changes
npm run test:integration
npm run test:production

# Cleanup verification
npm run lint
npx tsc --noEmit
```

## Risk Mitigation
- Git history preserves wrapper code
- TypeScript Language Server ensures precision
- 123 existing tests validate behavior
- Small production trade before full deployment

**This is a code simplification task - we're removing complexity, not adding it. The native SDK approach has been proven to work in production testing.**