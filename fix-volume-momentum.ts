// TypeScript fixes for volume-momentum.ts

// Fix 1: Property name case mismatch
// Replace surgeType (lowercase) with uppercase for object keys
const fixes = [
  // Lines with TRAILING_STOPS[surgeType] - need uppercase conversion
  { line: 305, old: 'this.TRAILING_STOPS[volumeSurge.surgeType]', new: 'this.TRAILING_STOPS[volumeSurge.surgeType.toUpperCase() as keyof typeof this.TRAILING_STOPS]' },
  { line: 306, old: 'this.MAX_HOLD_TIMES[volumeSurge.surgeType]', new: 'this.MAX_HOLD_TIMES[volumeSurge.surgeType.toUpperCase() as keyof typeof this.MAX_HOLD_TIMES]' },
  { line: 447, old: 'this.TRAILING_STOPS[position.surgeType]', new: 'this.TRAILING_STOPS[position.surgeType.toUpperCase() as keyof typeof this.TRAILING_STOPS]' },
  { line: 754, old: 'this.POSITION_SIZES[surgeType]', new: 'this.POSITION_SIZES[surgeType.toUpperCase() as keyof typeof this.POSITION_SIZES]' },
  
  // Lines with userAddress - need to use wallet.address
  { line: 580, old: 'this.config.userAddress', new: 'this.config.wallet?.address || ""' },
  { line: 619, old: 'userAddress: this.config.userAddress,', new: 'userAddress: this.config.wallet?.address || "",' },
  { line: 808, old: 'userAddress: this.config.userAddress,', new: 'userAddress: this.config.wallet?.address || "",' }
];

console.log('Fixes to apply:', fixes);
