# Quick Fix: Token Format Validation Issues

## Issue
The API validation is rejecting token formats like `GALA$Unit$none$none` due to pattern mismatch.

## Root Cause
The validation pattern in `src/api/endpoints.ts` expects:
```typescript
pattern: /^[A-Z0-9]+\$[A-Z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/
```

But the token format uses lowercase "none":
```typescript
GALA: 'GALA$Unit$none$none'
```

## Fix Options

### Option 1: Update Validation Pattern (Recommended)
Update `src/api/endpoints.ts` line 202-203:
```typescript
// FROM:
tokenIn: { type: 'string', pattern: /^[A-Z0-9]+\$[A-Z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
tokenOut: { type: 'string', pattern: /^[A-Z0-9]+\$[A-Z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },

// TO:
tokenIn: { type: 'string', pattern: /^[A-Z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
tokenOut: { type: 'string', pattern: /^[A-Z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+\$[A-Za-z0-9]+$/ },
```

### Option 2: Use Uppercase Tokens
Update `src/types/galaswap.ts`:
```typescript
export const COMMON_TOKENS = {
  GALA: 'GALA$UNIT$NONE$NONE',
  GUSDC: 'GUSDC$UNIT$NONE$NONE',
  // etc...
} as const;
```

## Implementation
Apply Option 1 and re-run verification:
```bash
tsx scripts/test-payload-signing.ts
```

Then proceed with full verification:
```bash
tsx scripts/run-final-verification.ts
```

## Expected Result
- API token validation will pass
- Quote generation will work
- Payload generation will succeed
- System will be 100% ready for live trading