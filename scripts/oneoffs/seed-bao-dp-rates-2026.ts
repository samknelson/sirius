/**
 * One-off: seed the BAO Domestic Partner (DP) rate table with the 1/1/2026
 * rates (DP rate history table task).
 *
 * Inserts one row per (benefit, tier transition) effective 2026-01-01.
 * The `family → family with DP` transition has NO confirmed business rule
 * or rate yet: it is seeded as a $0.00 PLACEHOLDER row flagged provisional,
 * never inferred from the other rates.
 *
 * Idempotent: if a row already exists for (benefit, transition, 2026-01-01)
 * it is left untouched (or updated if the rate/provisional flag differs,
 * with a log line). Benefits are matched by exact name; a missing benefit
 * aborts with an error listing what was not found.
 *
 * Usage: npx tsx scripts/oneoffs/seed-bao-dp-rates-2026.ts
 */

import { storage } from "../../server/storage";
import type { BaoDpTierTransition } from "../../shared/schema/sitespecific/bao/schema";

const EFFECTIVE_YMD = "2026-01-01";

/** Placeholder amount for the provisional family → family-with-DP rows. */
const PLACEHOLDER_RATE = "0.00";

/** Benefit name → monthly rate by tier transition. */
const RATES: Record<
  string,
  Record<BaoDpTierTransition, { rate: string; provisional: boolean }>
> = {
  "Kaiser": {
    single_to_2party: { rate: "843.74", provisional: false },
    "2party_to_family": { rate: "698.17", provisional: false },
    single_to_family: { rate: "1541.91", provisional: false },
    family_to_family_dp: { rate: PLACEHOLDER_RATE, provisional: true },
  },
  "Health Net": {
    single_to_2party: { rate: "607.55", provisional: false },
    "2party_to_family": { rate: "430.08", provisional: false },
    single_to_family: { rate: "1037.63", provisional: false },
    family_to_family_dp: { rate: PLACEHOLDER_RATE, provisional: true },
  },
  "MLK": {
    single_to_2party: { rate: "177.52", provisional: false },
    "2party_to_family": { rate: "144.96", provisional: false },
    single_to_family: { rate: "322.49", provisional: false },
    family_to_family_dp: { rate: PLACEHOLDER_RATE, provisional: true },
  },
};

async function main() {
  const benefits = await storage.trustBenefits.getAllTrustBenefits();
  const byName = new Map<string, string>(
    benefits.map((b: any) => [String(b.name).trim(), String(b.id)]),
  );

  const missing = Object.keys(RATES).filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Benefits not found by name: ${missing.join(", ")}. ` +
        `Available: ${benefits.map((b: any) => b.name).join(", ")}`,
    );
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const [name, transitions] of Object.entries(RATES)) {
    const benefitId = byName.get(name)!;
    const existing = await storage.baoDpRates.list({ benefitId });
    for (const [transition, { rate, provisional }] of Object.entries(
      transitions,
    ) as [BaoDpTierTransition, { rate: string; provisional: boolean }][]) {
      const match = existing.find(
        (r) => r.tierTransition === transition && r.effectiveYmd === EFFECTIVE_YMD,
      );
      if (match) {
        if (Number(match.rate) === Number(rate) && match.provisional === provisional) {
          unchanged++;
          continue;
        }
        await storage.baoDpRates.update(match.id, { rate, provisional });
        console.log(
          `Updated ${name} ${transition}: ${match.rate} -> ${rate} (provisional ${provisional})`,
        );
        updated++;
        continue;
      }
      await storage.baoDpRates.create({
        benefitId,
        tierTransition: transition,
        rate,
        effectiveYmd: EFFECTIVE_YMD,
        provisional,
      });
      console.log(`Created ${name} ${transition}: ${rate} (provisional ${provisional})`);
      created++;
    }
  }

  console.log(
    `Done. ${created} created, ${updated} updated, ${unchanged} unchanged (effective ${EFFECTIVE_YMD}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
