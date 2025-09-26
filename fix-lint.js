#!/usr/bin/env node

/**
 * Automatic Lint Fixer
 * Systematically fixes ESLint unused variable errors by prefixing with underscore
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mapping of files and their unused variables to fix
const fixMap = {
  'src/analytics/pairs-correlation.ts': [
    { line: 15, old: "safeParseFloat", new: "_safeParseFloat" },
    { line: 377, old: "pairKey", new: "_pairKey" },
    { line: 577, old: "n", new: "_n" },
    { line: 699, old: "reason", new: "_reason" }
  ],
  'src/analytics/smart-money-tracker.ts': [
    { line: 16, old: "PriceResponse", new: "_PriceResponse" }
  ],
  'src/analytics/strategy-validator.ts': [
    { line: 19, old: "BacktestResults", new: "_BacktestResults" },
    { line: 19, old: "ValidationResults", new: "_ValidationResults" },
    { line: 22, old: "TRADING_CONSTANTS", new: "_TRADING_CONSTANTS" },
    { line: 478, old: "trainConfig1", new: "_trainConfig1" },
    { line: 484, old: "trainConfig2", new: "_trainConfig2" },
    { line: 637, old: "validationConfig", new: "_validationConfig" },
    { line: 647, old: "t", new: "_t" },
    { line: 721, old: "validationConfig", new: "_validationConfig" },
    { line: 794, old: "validationConfig", new: "_validationConfig" },
    { line: 985, old: "degreesOfFreedom", new: "_degreesOfFreedom" },
    { line: 1061, old: "config", new: "_config" },
    { line: 1114, old: "config", new: "_config" },
    { line: 1157, old: "index", new: "_index" }
  ],
  'src/analytics/tvl-analyzer.ts': [
    { line: 12, old: "safeParseFloat", new: "_safeParseFloat" },
    { line: 806, old: "tvlData", new: "_tvlData" }
  ],
  'src/analytics/wallet-analyzer.ts': [
    { line: 12, old: "TRADING_CONSTANTS", new: "_TRADING_CONSTANTS" },
    { line: 868, old: "amountOut", new: "_amountOut" },
    { line: 868, old: "tokenIn", new: "_tokenIn" },
    { line: 868, old: "tokenOut", new: "_tokenOut" }
  ]
};

// Function to remove unused imports
function removeUnusedImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Remove specific unused imports
  const updatedLines = lines.map(line => {
    // Remove unused imports that are clearly not used
    if (line.includes("import { TRADING_CONSTANTS } from '../config/constants';") &&
        !content.includes('TRADING_CONSTANTS.')) {
      return '// TRADING_CONSTANTS import removed - not used';
    }
    if (line.includes("import { safeParseFloat } from '../utils/safe-parse';") &&
        !content.includes('safeParseFloat(')) {
      return '// safeParseFloat import removed - not used';
    }
    return line;
  });

  fs.writeFileSync(filePath, updatedLines.join('\n'));
  console.log(`✅ Cleaned unused imports in ${filePath}`);
}

// Function to prefix unused variables
function prefixUnusedVars(filePath, fixes) {
  let content = fs.readFileSync(filePath, 'utf8');

  fixes.forEach(fix => {
    // Simple string replacement for variable names
    const patterns = [
      new RegExp(`\\b${fix.old}\\b(?=\\s*[=:])|\\b${fix.old}\\b(?=\\s*,)|\\b${fix.old}\\b(?=\\s*\\))`, 'g')
    ];

    patterns.forEach(pattern => {
      content = content.replace(pattern, fix.new);
    });
  });

  fs.writeFileSync(filePath, content);
  console.log(`✅ Fixed unused variables in ${filePath}`);
}

// Apply all fixes
console.log('🔧 Starting systematic lint fixes...\n');

Object.entries(fixMap).forEach(([filePath, fixes]) => {
  const fullPath = path.join(__dirname, filePath);
  if (fs.existsSync(fullPath)) {
    prefixUnusedVars(fullPath, fixes);
    removeUnusedImports(fullPath);
  } else {
    console.log(`⚠️ File not found: ${fullPath}`);
  }
});

console.log('\n✅ All lint fixes applied!');
console.log('🔍 Run `npm run lint` to verify fixes');