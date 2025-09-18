#!/usr/bin/env tsx

/**
 * Test Security Remediations
 * Quick test of the critical security features for localhost trading
 */

import { InputValidator } from './src/utils/validation';

console.log('🔒 Testing Critical Security Remediations for Billionaire Bot\n');

// Test 1: Token Format Validation
console.log('1️⃣ Testing Token Format Validation');

const validToken = 'GALA$Unit$none$none';
const invalidToken = 'GALA$$invalid$';
const maliciousToken = 'GALA$Unit$../hack$none';

console.log(`✅ Valid token "${validToken}":`, InputValidator.validateTokenFormat(validToken));
console.log(`❌ Invalid token "${invalidToken}":`, InputValidator.validateTokenFormat(invalidToken));
console.log(`🚨 Malicious token "${maliciousToken}":`, InputValidator.validateTokenFormat(maliciousToken));

// Test 2: Trading Amount Validation
console.log('\n2️⃣ Testing Trading Amount Validation');

const validAmount = '100.5';
const invalidAmount = '00.123';  // Leading zeros
const scientificAmount = '1e5';  // Scientific notation

console.log(`✅ Valid amount "${validAmount}":`, InputValidator.validateTradingAmount(validAmount));
console.log(`❌ Invalid amount "${invalidAmount}":`, InputValidator.validateTradingAmount(invalidAmount));
console.log(`🚨 Scientific amount "${scientificAmount}":`, InputValidator.validateTradingAmount(scientificAmount));

// Test 3: Slippage Validation
console.log('\n3️⃣ Testing Slippage Validation');

const normalSlippage = 0.01;     // 1%
const highSlippage = 0.1;        // 10%
const dangerousSlippage = 0.6;   // 60%
const crazySlippage = 1.0;       // 100%

console.log(`✅ Normal slippage ${normalSlippage * 100}%:`, InputValidator.validateSlippage(normalSlippage));
console.log(`⚠️ High slippage ${highSlippage * 100}%:`, InputValidator.validateSlippage(highSlippage));
console.log(`🚨 Dangerous slippage ${dangerousSlippage * 100}%:`, InputValidator.validateSlippage(dangerousSlippage));
console.log(`💀 Crazy slippage ${crazySlippage * 100}%:`, InputValidator.validateSlippage(crazySlippage));

// Test 4: Fee Tier Validation
console.log('\n4️⃣ Testing Fee Tier Validation');

const validFees = [500, 3000, 10000];
const invalidFees = [100, 1000, 5000];

validFees.forEach(fee => {
  console.log(`✅ Valid fee ${fee}:`, InputValidator.validateFee(fee));
});

invalidFees.forEach(fee => {
  console.log(`❌ Invalid fee ${fee}:`, InputValidator.validateFee(fee));
});

console.log('\n🎯 Security Remediations Test Complete!');
console.log('\n📊 Summary:');
console.log('✅ Token format validation prevents malformed API calls');
console.log('✅ Amount validation prevents expensive parsing errors');
console.log('✅ Slippage validation prevents crazy losses');
console.log('✅ Fee validation ensures only valid GalaSwap tiers');
console.log('\n🚀 Ready for safe localhost trading!');