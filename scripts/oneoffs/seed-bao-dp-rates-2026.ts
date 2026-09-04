/**
 * One-off: seed / correct the BAO Domestic Partner (DP) rate table with the
 * confirmed 1/1/2026 MONTHLY MEMBER CHARGES from Kristin's rate sheet
 * (attached_assets/Domestic_Partner_Rates_2026_*.xlsx).
 *
 * The workbook has two dollar columns per plan/transition:
 *   - "Monthly Member Charge" — what the Fund collects from the member (the
 *     48% tax on imputed income it pays on the member's behalf). THIS is the
 *     rate stored here and billed.
 *   - "Imputed Income (NOT charged to member)" — never stored, never billed.
 *     (An earlier version of this seed mistakenly used this column; rerunning
 *     corrects those rows in place.)
 *
 * "Family → Family" (member already has two or more children and adds a DP,
 * with or without the DP's children) is CONFIRMED NO CHARGE for all plans:
 * seeded as a $0.00 rate flagged provisional=false. Billing posts nothing
 * for those months and the DP payment gate does not require a payment.
 *
 * Idempotent: one row per (benefit, transition, 2026-01-01). Existing rows
 * are updated in place when the rate/provisional flag differs, otherwise
 * left untouched; rerunning never duplicates or churns rows. Benefits are
 * matched by exact name; a missing benefit aborts with an error listing
 * what was not found. The rate table and sync logic live in
 * server/modules/sitespecific/bao/dp-rates-2026.ts (covered by tests).
 *
 * Usage: npx tsx scripts/oneoffs/seed-bao-dp-rates-2026.ts
 */

import { storage } from "../../server/storage";
import {
  DP_RATES_2026_EFFECTIVE_YMD,
  syncDpRates2026,
} from "../../server/modules/sitespecific/bao/dp-rates-2026";

async function main() {
  const result = await syncDpRates2026(storage);
  for (const line of result.changes) console.log(line);
  console.log(
    `Done. ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged (effective ${DP_RATES_2026_EFFECTIVE_YMD}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
