/**
 * Price Mathematics Utilities
 * Converts between ticks, sqrtPrice, and human-readable prices for V3 AMM
 */

/**
 * Convert sqrtPriceX96 to readable price
 * @param sqrtPriceX96 Square root price scaled by 2^96
 * @returns Human-readable price
 */
export function sqrtPriceX96ToPrice(sqrtPriceX96: string): number {
  try {
    const Q96 = BigInt('79228162514264337593543950336'); // 2^96 as string literal
    const sqrtPrice = BigInt(sqrtPriceX96);

    // Calculate price = (sqrtPrice / 2^96)^2
    const price = Number(sqrtPrice) / Number(Q96);
    const actualPrice = price * price;

    return actualPrice;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error converting sqrtPriceX96 to price:', error);
    return 0;
  }
}

/**
 * Convert price to sqrtPriceX96
 * @param price Human-readable price
 * @returns Square root price scaled by 2^96
 */
export function priceToSqrtPriceX96(price: number): string {
  try {
    const sqrtPrice = Math.sqrt(price);
    const Q96 = BigInt('79228162514264337593543950336'); // 2^96 as string literal
    const sqrtPriceX96 = BigInt(Math.floor(sqrtPrice * Number(Q96)));

    return sqrtPriceX96.toString();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error converting price to sqrtPriceX96:', error);
    return '0';
  }
}

/**
 * Convert tick to price
 * @param tick Tick value
 * @returns Human-readable price
 */
export function tickToPrice(tick: number): number {
  try {
    // price = 1.0001^tick
    return Math.pow(1.0001, tick);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error converting tick to price:', error);
    return 0;
  }
}

/**
 * Convert price to tick
 * @param price Human-readable price
 * @returns Tick value
 */
export function priceToTick(price: number): number {
  try {
    if (price <= 0) return 0;
    // tick = log(price) / log(1.0001)
    return Math.floor(Math.log(price) / Math.log(1.0001));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error converting price to tick:', error);
    return 0;
  }
}

/**
 * Get price from pool data using sqrtPrice
 * @param poolData Pool data containing sqrtPrice
 * @returns Human-readable price
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPriceFromPoolData(poolData: any): number {
  try {
    const sqrtPriceX96 = poolData?.Data?.sqrtPrice || poolData?.sqrtPrice;

    if (!sqrtPriceX96) {
      // eslint-disable-next-line no-console
      console.warn('No sqrtPrice found in pool data');
      return 0;
    }

    return sqrtPriceX96ToPrice(sqrtPriceX96);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error getting price from pool data:', error);
    return 0;
  }
}

/**
 * Calculate price impact for a given trade
 * @param currentPrice Current pool price
 * @param newPrice Price after trade
 * @returns Price impact percentage
 */
export function calculatePriceImpact(currentPrice: number, newPrice: number): number {
  try {
    if (currentPrice === 0) return 0;
    return Math.abs((newPrice - currentPrice) / currentPrice) * 100;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error calculating price impact:', error);
    return 0;
  }
}

/**
 * Calculate the nearest valid tick for a given price and tick spacing
 * @param price Target price
 * @param tickSpacing Tick spacing (e.g., 60 for 0.3% fee tier)
 * @returns Nearest valid tick
 */
export function getNearestValidTick(price: number, tickSpacing: number): number {
  try {
    const tick = priceToTick(price);
    return Math.round(tick / tickSpacing) * tickSpacing;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Error getting nearest valid tick:', error);
    return 0;
  }
}

/**
 * Constants for common tick spacings by fee tier
 */
export const TICK_SPACINGS = {
  500: 10,     // 0.05% fee tier
  3000: 60,    // 0.30% fee tier
  10000: 200   // 1.00% fee tier
} as const;

/**
 * Get tick spacing for a fee tier
 * @param fee Fee tier (500, 3000, 10000)
 * @returns Tick spacing
 */
export function getTickSpacing(fee: number): number {
  return TICK_SPACINGS[fee as keyof typeof TICK_SPACINGS] || 60;
}