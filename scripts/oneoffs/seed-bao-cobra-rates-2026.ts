/**
 * One-off: seed the BAO COBRA rate table from the Rael & Letson 1/1/2026
 * rate sheet (Task: Load 1/1/2026 COBRA rates).
 *
 * Inserts one row per (benefit, covered-lives tier) effective 2026-01-01.
 * Rates are the PRE-FEE monthly premiums — the 2% COBRA administration fee
 * is applied at calculation time (charge plugin, wizard pricing, worker
 * COBRA page), never baked into the stored rates.
 *
 * Idempotent: if a row already exists for (benefit, tier, 2026-01-01) it is
 * left untouched (or updated if the rate differs, with a log line).
 * Benefits are matched by exact name; a missing benefit aborts with an
 * error listing what was not found.
 *
 * Usage: npx tsx scripts/oneoffs/seed-bao-cobra-rates-2026.ts
 */

import { storage } from "../../server/storage";
import type { BaoCobraCoveredLivesTier } from "../../shared/schema/sitespecific/bao/schema";

const EFFECTIVE_YMD = "2026-01-01";

/** Benefit name → pre-fee monthly rate by covered-lives tier. */
const RATES: Record<string, Record<BaoCobraCoveredLivesTier, string>> = {
  "Kaiser": { "1": "855.53", "2": "1698.24", "3+": "2395.15" },
  "Health Net": { "1": "549.38", "2": "1155.90", "3+": "1584.72" },
  "MLK": { "1": "262.11", "2": "438.60", "3+": "582.30" },
  "Liberty": { "1": "20.93", "2": "20.93", "3+": "20.93" },
  "Delta": { "1": "71.79", "2": "71.79", "3+": "71.79" },
  "Unite Here Dental Center": { "1": "62.15", "2": "62.15", "3+": "62.15" },
  "VSP": { "1": "1.04", "2": "2.06", "3+": "3.33" },
  "VSP MLK": { "1": "1.04", "2": "2.06", "3+": "3.33" },
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

  for (const [name, tiers] of Object.entries(RATES)) {
    const benefitId = byName.get(name)!;
    const existing = await storage.baoCobraRates.list({ benefitId });
    for (const [tier, rate] of Object.entries(tiers) as [
      BaoCobraCoveredLivesTier,
      string,
    ][]) {
      const match = existing.find(
        (r) => r.coveredLivesTier === tier && r.effectiveYmd === EFFECTIVE_YMD,
      );
      if (match) {
        if (Number(match.rate) === Number(rate)) {
          unchanged++;
          continue;
        }
        await storage.baoCobraRates.update(match.id, { rate });
        console.log(`Updated ${name} tier ${tier}: ${match.rate} -> ${rate}`);
        updated++;
        continue;
      }
      await storage.baoCobraRates.create({
        benefitId,
        coveredLivesTier: tier,
        rate,
        effectiveYmd: EFFECTIVE_YMD,
      });
      console.log(`Created ${name} tier ${tier}: ${rate}`);
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
