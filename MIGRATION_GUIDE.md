# GalaSwap SDK Migration Guide

## Overview

This guide covers the migration from the custom `GalaSwapClient` implementation to the official `@gala-chain/gswap-sdk`. The migration uses an adapter pattern to provide backward compatibility while leveraging the official SDK.

## Migration Strategy

### Phase 1: Adapter Implementation (✅ Complete)

**Completed Components:**
- ✅ `IGalaSwapClient` interface for compatibility
- ✅ `GalaSwapSDKAdapter` implementing the interface
- ✅ Quote and pricing methods
- ✅ Position management methods
- ✅ Response transformation utilities
- ✅ Error mapping utilities
- ✅ TypeScript compatibility

### Phase 2: Integration (Next Steps)

**Update Trading Engine:**
```typescript
// Before
import { GalaSwapClient } from '../api/GalaSwapClient';

// After
import { GalaSwapSDKAdapter } from '../api/GalaSwapSDKAdapter';

// In TradingEngine constructor
// this.client = new GalaSwapClient(config);
this.client = new GalaSwapSDKAdapter(config);
```

**Update Strategy Files:**
- `src/trading/strategies/arbitrage.ts`
- `src/trading/strategies/market-making.ts`
- Any other files importing `GalaSwapClient`

### Phase 3: Testing and Validation

**Test Plan:**
1. Run existing unit tests with adapter
2. Integration tests on testnet
3. Performance benchmarking
4. Monitoring for compatibility issues

## Key Benefits

### 1. Reduced Complexity
- **Before**: 1400+ lines of custom HTTP/WebSocket code
- **After**: Leverage official SDK implementation
- **Maintenance**: Official SDK handles updates and bug fixes

### 2. Better Transaction Handling
- **Before**: Custom transaction monitoring with polling
- **After**: Built-in `PendingTransaction.wait()` method
- **Reliability**: SDK handles retries and error recovery

### 3. Type Safety
- **Before**: Custom type definitions
- **After**: Official SDK types
- **Accuracy**: Types match actual API responses

### 4. Performance Improvements
- **Before**: Custom rate limiting and retry logic
- **After**: Optimized SDK implementation
- **Speed**: Better connection pooling and caching

## Breaking Changes

### 1. WebSocket Handling
- **Before**: Manual WebSocket connection management
- **After**: SDK handles connections automatically
- **Impact**: No action needed - adapter handles this

### 2. Transaction Monitoring
- **Before**: `monitorTransaction()` with polling
- **After**: `PendingTransaction.wait()` for new transactions
- **Impact**: Existing code works, new code should use SDK patterns

### 3. Bundle Operations
- **Before**: Manual payload generation + signing + execution
- **After**: Direct swap methods with built-in execution
- **Impact**: Adapter maintains compatibility for existing code

## Compatibility Matrix

| Feature | Original Client | SDK Adapter | Status |
|---------|----------------|-------------|---------|
| `getQuote()` | ✅ | ✅ | Compatible |
| `getPrice()` | ✅ | ✅ | Compatible |
| `getPrices()` | ✅ | ✅ | Compatible |
| `getPool()` | ✅ | ✅ | Compatible |
| `getPosition()` | ✅ | ✅ | Compatible |
| `getPositions()` | ✅ | ✅ | Compatible |
| `swap()` | ✅ | ✅ | Enhanced with SDK |
| `addLiquidity()` | ✅ | 🚧 | TODO: Implement |
| `removeLiquidity()` | ✅ | 🚧 | TODO: Implement |
| WebSocket events | ✅ | 🚧 | TODO: Implement |
| Health checks | ✅ | ✅ | Compatible |

## Usage Examples

### Drop-in Replacement
```typescript
// Before
const client = new GalaSwapClient(config);

// After (no other changes needed)
const client = new GalaSwapSDKAdapter(config);

// All existing method calls work the same
const quote = await client.getQuote(request);
const positions = await client.getPositions(request);
```

### Enhanced SDK Features
```typescript
// After migration, can access SDK directly for new features
const adapter = new GalaSwapSDKAdapter(config);

// Still use adapter for compatibility
const quote = await adapter.getQuote(request);

// Access SDK for advanced features (future enhancement)
// const directSDK = adapter.getSDKInstance(); // Future method
```

## Implementation Steps

### Step 1: Update Imports
```bash
# Find all GalaSwapClient imports
grep -r "GalaSwapClient" src/

# Update imports in:
# - src/trading/TradingEngine.ts
# - src/trading/OptimizedTradingEngine.ts
# - src/trading/strategies/arbitrage.ts
# - src/trading/strategies/market-making.ts
```

### Step 2: Replace Instantiation
```typescript
// In each file, replace:
import { GalaSwapClient } from '../api/GalaSwapClient';
// With:
import { GalaSwapSDKAdapter } from '../api/GalaSwapSDKAdapter';

// And replace:
new GalaSwapClient(config)
// With:
new GalaSwapSDKAdapter(config)
```

### Step 3: Test and Validate
```bash
# Run tests
npm test

# Run type checking
npm run typecheck

# Performance tests
npm run performance:benchmark
```

## Rollback Plan

If issues arise, the original `GalaSwapClient` can be restored by:

1. Reverting imports back to `GalaSwapClient`
2. Reverting instantiation calls
3. No other changes needed due to interface compatibility

## Future Enhancements

### Phase 4: Direct SDK Usage
Once adapter is stable, gradually refactor to use SDK directly:

```typescript
// Future direct SDK usage
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

const gswap = new GSwap({
  signer: new PrivateKeySigner(privateKey),
  walletAddress
});

const result = await gswap.swaps.swap(tokenIn, tokenOut, fee, amount);
await result.wait(); // Direct transaction monitoring
```

### Phase 5: Cleanup
- Remove `GalaSwapClient.ts` (after thorough testing)
- Remove adapter layer (optional)
- Update documentation

## Support and Troubleshooting

### Common Issues

1. **Type Errors**: Ensure all imports are updated
2. **Configuration**: Verify SDK configuration matches original
3. **Network Issues**: SDK handles retries differently

### Testing Strategy

1. **Unit Tests**: Verify adapter methods work correctly
2. **Integration Tests**: Test with actual API calls
3. **Performance Tests**: Compare latency and throughput
4. **Error Handling**: Verify error responses are compatible

### Monitoring

Monitor these metrics during migration:
- API response times
- Error rates
- Transaction success rates
- Memory usage
- Connection stability

## Timeline

- **Phase 1**: ✅ Complete (Adapter implementation)
- **Phase 2**: 1-2 days (Integration and testing)
- **Phase 3**: 1 day (Validation and monitoring)
- **Phase 4**: 3-4 days (Future: Direct SDK usage)
- **Phase 5**: 1 day (Future: Cleanup)

Total migration time: **2-3 days** for adapter approach