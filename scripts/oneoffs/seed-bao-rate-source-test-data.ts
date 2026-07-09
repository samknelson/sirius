/**
 * One-off: seed BAO benefit rate source test data (Task #41 validation).
 *
 * Creates, via the storage layer:
 *   - 3 rate sources:
 *       "2024-2026 CBA"        (contract,    start 2024-01-01) — employers A + B
 *       "2026-2028 CBA"        (contract,    start 2026-01-01) — employer A only
 *       "Rate Letter Mar 2026" (rate_letter, start 2026-03-01) — employer B only
 *   - Rate entries against the first two ledger accounts:
 *       Employer A: 2024 rates under old CBA (should become INACTIVE — superseded
 *                   by the 2026 CBA), 2026 rates under new CBA (ACTIVE),
 *                   plus one sourceless row (always ACTIVE).
 *       Employer B: 2024 rates under old CBA (INACTIVE — superseded by the rate
 *                   letter), 2026-03 rates under the rate letter (ACTIVE).
 *
 * Expected result on the pages:
 *   - Rate Sources page: "2024-2026 CBA" shows Superseded (both employers
 *     superseded), the other two show Active.
 *   - Employer Rates page: old-CBA rows show Inactive, everything else Active;
 *     the Active view hides the Inactive rows.
 *
 * Idempotent-ish: skips creation when a source with the same name already exists.
 *
 * Usage: npx tsx scripts/oneoffs/seed-bao-rate-source-test-data.ts
 */

import { storage } from "../../server/storage";

async function main() {
  const employers = await storage.employers.getAllEmployers();
  if (employers.length < 2) {
    throw new Error("Need at least 2 employers to seed test data");
  }
  const [empA, empB] = employers;

  const accounts = (await storage.ledger.accounts.getAll()).filter((a: any) => a.isActive !== false);
  if (accounts.length < 1) {
    throw new Error("Need at least 1 ledger account to seed test data");
  }
  const useAccounts = accounts.slice(0, 2);

  console.log(`Employer A: ${empA.name} (${empA.id})`);
  console.log(`Employer B: ${empB.name} (${empB.id})`);
  console.log(`Accounts: ${useAccounts.map((a: any) => a.name).join(", ")}`);

  const existing = await storage.baoRateSources.list();
  const byName = new Map(existing.map((s) => [s.name, s]));

  async function ensureSource(
    name: string,
    type: "contract" | "rate_letter",
    startYmd: string,
    employerIds: string[],
  ) {
    const found = byName.get(name);
    if (found) {
      console.log(`Source already exists, skipping: ${name}`);
      return found;
    }
    const created = await storage.baoRateSources.create({ name, type, startYmd }, employerIds);
    console.log(`Created source: ${name} (${type}, ${startYmd})`);
    return created;
  }

  const oldCba = await ensureSource("2024-2026 CBA", "contract", "2024-01-01", [empA.id, empB.id]);
  const newCba = await ensureSource("2026-2028 CBA", "contract", "2026-01-01", [empA.id]);
  const rateLetter = await ensureSource("Rate Letter Mar 2026", "rate_letter", "2026-03-01", [
    empB.id,
  ]);

  const entries: {
    employerId: string;
    accountId: string;
    rate: string;
    effectiveYmd: string;
    sourceId: string | null;
  }[] = [];

  for (const [i, acct] of useAccounts.entries()) {
    // Employer A
    entries.push({
      employerId: empA.id,
      accountId: acct.id,
      rate: (5 + i).toFixed(2),
      effectiveYmd: "2024-01-01",
      sourceId: oldCba.id, // superseded by newCba (start 2026-01-01 <= 2026 rows? no — <= this row's effectiveYmd? 2026-01-01 > 2024-01-01... see note)
    });
    entries.push({
      employerId: empA.id,
      accountId: acct.id,
      rate: (6 + i).toFixed(2),
      effectiveYmd: "2026-01-01",
      sourceId: newCba.id, // active
    });
    // Employer B
    entries.push({
      employerId: empB.id,
      accountId: acct.id,
      rate: (4.5 + i).toFixed(2),
      effectiveYmd: "2024-01-01",
      sourceId: oldCba.id,
    });
    entries.push({
      employerId: empB.id,
      accountId: acct.id,
      rate: (5.5 + i).toFixed(2),
      effectiveYmd: "2026-03-01",
      sourceId: rateLetter.id, // active
    });
  }

  // One extra old-CBA row dated after the new CBA's start so the
  // "newer source start <= entry effective date" inactivation rule is
  // exercised: this row is INACTIVE for employer A.
  entries.push({
    employerId: empA.id,
    accountId: useAccounts[0].id,
    rate: "5.75",
    effectiveYmd: "2026-02-01",
    sourceId: oldCba.id,
  });

  // Sourceless row — always active.
  entries.push({
    employerId: empA.id,
    accountId: useAccounts[0].id,
    rate: "7.25",
    effectiveYmd: "2026-06-01",
    sourceId: null,
  });

  const results = await storage.baoEmployerRates.bulkUpsert(entries);
  console.log(`Upserted ${results.length} rate entries`);

  // Report calculated statuses for validation.
  const all = await storage.baoEmployerRates.list({ mode: "history" });
  const relevant = all.filter((r) => r.employerId === empA.id || r.employerId === empB.id);
  console.log("\nRate entries (calculated status):");
  for (const r of relevant) {
    const emp = r.employerId === empA.id ? empA.name : empB.name;
    console.log(
      `  ${emp} | eff ${r.effectiveYmd} | $${r.rate} | source=${r.sourceName ?? "(none)"} | ${
        r.isActive ? "ACTIVE" : "INACTIVE"
      }`,
    );
  }

  const sources = await storage.baoRateSources.list();
  console.log("\nSources (calculated status):");
  for (const s of sources) {
    console.log(
      `  ${s.name} (${s.type}, start ${s.startYmd}) — ${s.isActive ? "ACTIVE" : "SUPERSEDED"} — active for ${s.activeForEmployerIds.length}/${s.employers.length} employer(s)`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
