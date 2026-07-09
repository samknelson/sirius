/**
 * One-off smoke test: the bao-hourly charge plugin's rate lookup
 * (storage.baoEmployerRates.getEffectiveRate) must skip INACTIVE rate rows.
 *
 * Scenario (temporary data, cleaned up at the end):
 *   - Old source (start 2024-01-01) and new source (start 2026-01-01), both
 *     for the same employer.
 *   - Rate $9.99 effective 2026-02-01 under the OLD source → INACTIVE
 *     (the new source starts on/before that date and governs the period).
 *   - Rate $6.00 effective 2026-01-01 under the NEW source → ACTIVE.
 *
 * Expectation: getEffectiveRate(employer, account, 2026-03-01) returns the
 * $6.00 row, NOT the later-dated but inactive $9.99 row — exactly what the
 * charge plugin will bill with.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-bao-hourly-active-rate.ts
 */

import { storage } from "../../server/storage";

async function main() {
  const employers = await storage.employers.getAllEmployers();
  const accounts = await storage.ledger.accounts.getAll();
  if (employers.length === 0 || accounts.length === 0) {
    throw new Error("Need at least one employer and one ledger account");
  }
  const emp = employers[0];
  const acct = accounts[0];

  const oldSrc = await storage.baoRateSources.create(
    { name: "__SMOKE old source", type: "contract", startYmd: "2024-01-01" },
    [emp.id],
  );
  const newSrc = await storage.baoRateSources.create(
    { name: "__SMOKE new source", type: "contract", startYmd: "2026-01-01" },
    [emp.id],
  );

  const [inactiveRow, activeRow] = await storage.baoEmployerRates.bulkUpsert([
    {
      employerId: emp.id,
      accountId: acct.id,
      rate: "9.99",
      effectiveYmd: "2026-02-01",
      sourceId: oldSrc.id,
    },
    {
      employerId: emp.id,
      accountId: acct.id,
      rate: "6.00",
      effectiveYmd: "2026-01-01",
      sourceId: newSrc.id,
    },
  ]);

  let failed = false;
  try {
    const effective = await storage.baoEmployerRates.getEffectiveRate(
      emp.id,
      acct.id,
      "2026-03-01",
    );
    if (!effective) {
      console.error("FAIL: no effective rate returned");
      failed = true;
    } else if (effective.id === inactiveRow.id) {
      console.error("FAIL: returned the INACTIVE $9.99 row");
      failed = true;
    } else if (effective.id === activeRow.id) {
      console.log(
        `PASS: getEffectiveRate skipped the inactive $9.99 row and returned the active $${Number(effective.rate).toFixed(2)} row`,
      );
    } else {
      console.error(`FAIL: returned unexpected row ${effective.id}`);
      failed = true;
    }
  } finally {
    await storage.baoEmployerRates.delete(inactiveRow.id);
    await storage.baoEmployerRates.delete(activeRow.id);
    await storage.baoRateSources.delete(oldSrc.id);
    await storage.baoRateSources.delete(newSrc.id);
    console.log("Cleaned up smoke-test data.");
  }
  if (failed) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
