#!/usr/bin/env tsx

/**
 * Secure Trading Example
 * Demonstrates the critical security remediations in action
 */

import { InputValidator } from '../src/utils/validation';
import { SwapExecutor } from '../src/trading/execution/swap-executor';
import { GalaSwapClient } from '../src/api/GalaSwapClient';

console.log('🔒 Secure Trading Example - Critical Security Remediations\n');

// Example 1: Input Validation Before Trading
console.log('1️⃣ Input Validation Example');
console.log('════════════════════════════\n');

function validateTradeInputs(tokenIn: string, tokenOut: string, amount: string, slippage: number, fee: number) {
  console.log(`🔍 Validating trade: ${amount} ${tokenIn} → ${tokenOut}`);
  console.log(`   Slippage: ${slippage * 100}%, Fee: ${fee}`);

  // Validate token formats
  const tokenInValidation = InputValidator.validateTokenFormat(tokenIn);
  const tokenOutValidation = InputValidator.validateTokenFormat(tokenOut);

  // Validate amount
  const amountValidation = InputValidator.validateTradingAmount(amount);

  // Validate slippage
  const slippageValidation = InputValidator.validateSlippage(slippage);

  // Validate fee tier
  const feeValidation = InputValidator.validateFee(fee);

  const allValid = tokenInValidation.isValid &&
                   tokenOutValidation.isValid &&
                   amountValidation.isValid &&
                   slippageValidation.isValid &&
                   feeValidation.isValid;

  if (allValid) {
    console.log('✅ All inputs valid - safe to proceed with trade\n');
    return true;
  } else {
    console.log('❌ VALIDATION FAILED - trade blocked for safety:');

    if (!tokenInValidation.isValid) {
      console.log(`   TokenIn errors: ${tokenInValidation.errors.join(', ')}`);
    }
    if (!tokenOutValidation.isValid) {
      console.log(`   TokenOut errors: ${tokenOutValidation.errors.join(', ')}`);
    }
    if (!amountValidation.isValid) {
      console.log(`   Amount errors: ${amountValidation.errors.join(', ')}`);
    }
    if (!slippageValidation.isValid) {
      console.log(`   Slippage errors: ${slippageValidation.errors.join(', ')}`);
    }
    if (!feeValidation.isValid) {
      console.log(`   Fee errors: ${feeValidation.errors.join(', ')}`);
    }
    console.log('');
    return false;
  }
}

// Safe trade examples
console.log('✅ SAFE TRADES:');
validateTradeInputs('GALA$Unit$none$none', 'GUSDC$Unit$none$none', '100.0', 0.01, 3000);
validateTradeInputs('GUSDC$Unit$none$none', 'GALA$Unit$none$none', '50.5', 0.005, 500);

// Dangerous trade examples
console.log('🚨 DANGEROUS TRADES (blocked by validation):');
validateTradeInputs('GALA$Unit$none$none', 'GUSDC$Unit$none$none', '1e5', 0.5, 1000);  // Scientific notation, high slippage, invalid fee
validateTradeInputs('GALA$$invalid$', 'GUSDC$Unit$none$none', '00.123', 1.0, 500);    // Invalid token, leading zeros, 100% slippage

// Example 2: Transaction Monitoring
console.log('2️⃣ Transaction Monitoring Example');
console.log('══════════════════════════════════\n');

// Simulate transaction monitoring results
const mockTransactionResults = [
  {
    transactionId: 'tx_confirmed_123',
    status: 'CONFIRMED' as const,
    confirmationTime: 5000,
    description: 'Normal successful trade'
  },
  {
    transactionId: 'tx_failed_456',
    status: 'FAILED' as const,
    errorMessage: 'Slippage tolerance exceeded',
    description: 'Trade rejected due to slippage'
  },
  {
    transactionId: 'tx_timeout_789',
    status: 'TIMEOUT' as const,
    description: 'Network issues caused timeout'
  }
];

mockTransactionResults.forEach(result => {
  console.log(`📋 Transaction: ${result.transactionId}`);
  console.log(`   Description: ${result.description}`);

  switch (result.status) {
    case 'CONFIRMED':
      console.log(`   ✅ Status: CONFIRMED (${result.confirmationTime}ms)`);
      console.log('   💡 Action: Trade successful, funds received');
      break;

    case 'FAILED':
      console.log(`   ❌ Status: FAILED`);
      console.log(`   💡 Error: ${result.errorMessage}`);
      console.log('   💡 Action: No funds lost, try with different parameters');
      break;

    case 'TIMEOUT':
      console.log(`   ⏰ Status: TIMEOUT`);
      console.log('   💡 Action: Check transaction status manually, funds may be stuck');
      break;
  }
  console.log('');
});

// Example 3: Error Recovery
console.log('3️⃣ Simple Error Recovery Example');
console.log('════════════════════════════════════\n');

async function simulateAPICall(willFail: boolean, attempt: number): Promise<string> {
  if (willFail && attempt < 3) {
    throw new Error(`Network error (attempt ${attempt})`);
  }
  return `Success on attempt ${attempt}`;
}

async function simpleRetryExample() {
  console.log('🔄 Simulating API call with network hiccups...');

  try {
    // Simulate simple retry logic (3 attempts, 1-second delay)
    let result: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await simulateAPICall(true, attempt);
        console.log(`✅ ${result}`);
        break;
      } catch (error) {
        lastError = error as Error;
        console.log(`❌ Attempt ${attempt}/3 failed: ${lastError.message}`);

        if (attempt < 3) {
          console.log('   ⏳ Waiting 1 second before retry...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    if (!result) {
      console.log('💀 All retries failed - operation aborted');
    }

  } catch (error) {
    console.log(`💀 Critical error: ${error}`);
  }
}

// Run the retry example
simpleRetryExample().then(() => {
  console.log('\n🎯 Secure Trading Example Complete!');
  console.log('\n📊 Key Security Features Demonstrated:');
  console.log('1. ✅ Input validation prevents expensive API failures');
  console.log('2. ✅ Transaction monitoring provides clear success/failure status');
  console.log('3. ✅ Simple retry logic handles basic network hiccups');
  console.log('4. ✅ Clear error messages help diagnose issues');
  console.log('\n🛡️ Your localhost trading is now SAFE from common mistakes!');
});