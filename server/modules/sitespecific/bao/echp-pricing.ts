/**
 * Event Center Hours Purchase (ECHP) pricing.
 *
 * The price a worker pays to buy their targeted month up to threshold is based
 * on how many hours they actually WORKED in that month — not on how many hours
 * are being purchased. The fewer hours worked, the higher the price.
 *
 * This is intentionally a separate, exported, pure function (no DB access) so a
 * future charge plugin and a future configurable-pricing feature can reuse the
 * exact same ladder rather than duplicating it.
 */

interface EchpPriceTier {
  /** Applies when hours worked is strictly less than this value. */
  maxHoursWorked: number;
  /** Dollar price for the tier. */
  price: number;
}

const ECHP_PRICE_LADDER: ReadonlyArray<EchpPriceTier> = [
  { maxHoursWorked: 40, price: 750 },
  { maxHoursWorked: 44, price: 540 },
  { maxHoursWorked: 49, price: 515 },
  { maxHoursWorked: 54, price: 490 },
  { maxHoursWorked: 59, price: 465 },
  { maxHoursWorked: 64, price: 440 },
  { maxHoursWorked: 69, price: 415 },
  { maxHoursWorked: 74, price: 390 },
  { maxHoursWorked: 79, price: 365 },
  { maxHoursWorked: 84, price: 340 },
  { maxHoursWorked: 89, price: 315 },
  { maxHoursWorked: 94, price: 290 },
  { maxHoursWorked: 100, price: 265 },
];

/**
 * Maps the number of hours worked in the targeted month to a dollar price.
 * Returns 0 when 100 or more hours were worked (nothing to charge).
 */
export function computeEchpHoursPrice(hoursWorked: number): number {
  for (const tier of ECHP_PRICE_LADDER) {
    if (hoursWorked < tier.maxHoursWorked) {
      return tier.price;
    }
  }
  return 0;
}
