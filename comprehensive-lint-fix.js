#!/usr/bin/env node

/**
 * Comprehensive Lint Fixer
 * Fixes remaining variable reference issues and unused imports
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fix specific variable reference issues
function fixVariableReferences() {
  console.log('🔧 Fixing variable reference issues...\n');

  // Fix pairs-correlation.ts issues
  const pairsFile = path.join(__dirname, 'src/analytics/pairs-correlation.ts');
  let pairsContent = fs.readFileSync(pairsFile, 'utf8');

  // Fix variable 'n' references (should use _n)
  pairsContent = pairsContent.replace(/const _n = /g, 'const n = ');
  pairsContent = pairsContent.replace(/\s+n</g, ' _n<');
  pairsContent = pairsContent.replace(/if \(n </g, 'if (_n <');
  pairsContent = pairsContent.replace(/for \(let i = 1; i < n; i\+\+\)/g, 'for (let i = 1; i < _n; i++)');
  pairsContent = pairsContent.replace(/\/ n;/g, '/ _n;');
  pairsContent = pairsContent.replace(/\/ n\)/g, '/ _n)');
  pairsContent = pairsContent.replace(/, n\)/g, ', _n)');
  pairsContent = pairsContent.replace(/if \(_n < 2\) return 0;/g, 'if (n < 2) return 0;');

  // Fix other variable references
  pairsContent = pairsContent.replace(/for \(const \[_pairKey, stats\]/g, 'for (const [pairKey, stats]');
  pairsContent = pairsContent.replace(/logger\.warn\(\`Error generating signal for \$\{pairKey\}\`/g, 'logger.warn(`Error generating signal for ${pairKey}`');

  fs.writeFileSync(pairsFile, pairsContent);
  console.log('✅ Fixed pairs-correlation.ts variable references');
}

// Remove unused imports systematically
function removeUnusedImports() {
  console.log('🔧 Removing unused imports...\n');

  const filesToFix = [
    'src/analytics/game-migration-tracker.ts',
    'src/analytics/smart-money-tracker.ts',
    'src/analytics/strategy-validator.ts',
    'src/analytics/tvl-analyzer.ts',
    'src/analytics/wallet-analyzer.ts',
    'src/testing/backtest-engine.ts'
  ];

  filesToFix.forEach(filePath => {
    const fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️ File not found: ${fullPath}`);
      return;
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    let modified = false;

    // Remove specific unused imports
    const unusedImports = [
      { pattern: /^import \{ TRADING_CONSTANTS \} from [^;]+;$/m, replacement: '// TRADING_CONSTANTS import removed - not used' },
      { pattern: /^import \{ safeParseFloat \} from [^;]+;$/m, replacement: '// safeParseFloat import removed - not used' },
      { pattern: /^import.*BacktestResults.*ValidationResults.*$/m, replacement: '// BacktestResults, ValidationResults imports removed - not used' },
      { pattern: /^import.*PriceResponse.*$/m, replacement: '// PriceResponse import removed - not used' },
      { pattern: /^import.*PricePoint.*OHLCVData.*PriceOHLCV.*IntervalType.*StatisticType.*StatisticPeriod.*$/m, replacement: '// Analytics imports removed - not used in current implementation' }
    ];

    unusedImports.forEach(({ pattern, replacement }) => {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        modified = true;
      }
    });

    if (modified) {
      fs.writeFileSync(fullPath, content);
      console.log(`✅ Fixed imports in ${filePath}`);
    }
  });
}

// Main execution
fixVariableReferences();
removeUnusedImports();

console.log('\n✅ Comprehensive lint fixes applied!');
console.log('🔍 Run `npm run lint` to verify fixes');