/**
 * Event Center Hours Purchase (ECHP) pricing.
 *
 * The price a worker pays to buy their targeted month up to threshold is based
 * on how many hours they actually WORKED in that month — not on how many hours
 * are being purchased. The fewer hours worked, the higher the price.
 *
 * Pricing is configured per-policy (see `data.sitespecific.bao.echp`). This is
 * a pure function (no DB access) so a charge plugin and the eligibility
 * evaluator can reuse the exact same ladder rather than duplicating it. The
 * breakpoints are supplied by the caller; there is no hardcoded runtime
 * fallback — an unconfigured policy denies purchasing upstream.
 */

import type { BaoEchpBreakpoint } from "../../../../shared/schema/sitespecific/bao/schema";

/**
 * Maps the number of hours worked in the targeted month to a dollar price using
 * the supplied breakpoint ladder. Breakpoints are sorted ascending by
 * `maxHoursWorked`; the first breakpoint whose `maxHoursWorked` is strictly
 * greater than `hoursWorked` supplies the price. Returns 0 when no breakpoint
 * matches (i.e. enough hours were worked that nothing is owed).
 */
export function computeEchpHoursPrice(
  hoursWorked: number,
  breakpoints: ReadonlyArray<BaoEchpBreakpoint>,
): number {
  const sorted = [...breakpoints].sort(
    (a, b) => a.maxHoursWorked - b.maxHoursWorked,
  );
  for (const tier of sorted) {
    if (hoursWorked < tier.maxHoursWorked) {
      return tier.price;
    }
  }
  return 0;
}
