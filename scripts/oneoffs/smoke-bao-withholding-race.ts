/**
 * Real-database concurrency smoke test for BAO withholding allocations.
 *
 * Exercises the ACTUAL Postgres advisory-lock + conditional-write guards in
 * server/storage/sitespecific/bao/withholding-allocations.ts by racing, on
 * the dev database:
 *   1. a re-upload amount change (upsert) against payment consumption
 *   2. a re-upload NEW-worker insert against payment consumption
 *   3. two payments consuming the same upload concurrently
 * and asserting the payment-immutability invariant after every race: the set
 * consume() returned is exactly what remains in the DB (a consumed upload's
 * allocations can never change underneath a payment), and at most one
 * payment ever wins.
 *
 * All fixture rows are created up front and deleted afterwards.
 *
 * Run: npx tsx scripts/oneoffs/smoke-bao-withholding-race.ts
 */

import { db } from "../../server/db";
import {
  contacts,
  workers,
  employers,
  wizards,
  wizardEmployerMonthly,
  ledgerAccounts,
  ledgerEa,
  ledgerPayments,
  optionsLedgerPaymentType,
  sitespecificBaoWithholdingAllocations,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import {
  WITHHOLDING_CONSUMED,
  UPLOAD_ALREADY_CONSUMED,
} from "../../server/storage/sitespecific/bao/withholding-allocations";

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` :: ${JSON.stringify(extra)}`}`);
  if (!ok) failures++;
}

const allocStore = storage.baoWithholdingAllocations;

async function main() {
  if (!(await allocStore.tableExists())) {
    console.error("sitespecific_bao_withholding_allocations table missing; enable the BAO component first.");
    process.exit(1);
  }

  // ---------- Fixtures ----------
  const tag = `race-test-${Date.now()}`;
  const [account] = await db.insert(ledgerAccounts).values({ name: `BAO ${tag}` }).returning();
  const [employer] = await db.insert(employers).values({ name: `Employer ${tag}` }).returning();
  const contactRows = await db
    .insert(contacts)
    .values([{ displayName: `W1 ${tag}` }, { displayName: `W2 ${tag}` }, { displayName: `W3 ${tag}` }])
    .returning();
  const workerRows = await db
    .insert(workers)
    .values(contactRows.map((c) => ({ contactId: c.id })))
    .returning();
  const [wizard] = await db
    .insert(wizards)
    .values({ type: "bao_monthly_hours", status: "completed" })
    .returning();
  await db.insert(wizardEmployerMonthly).values({
    wizardId: wizard.id,
    employerId: employer.id,
    year: 2026,
    month: 1,
  });
  const eaRows = await db
    .insert(ledgerEa)
    .values([
      { accountId: account.id, entityType: "employer", entityId: employer.id },
      ...workerRows.map((w) => ({ accountId: account.id, entityType: "worker", entityId: w.id })),
    ])
    .returning();
  const employerEa = eaRows[0];
  const workerEas = eaRows.slice(1);
  const [payType] = await db
    .insert(optionsLedgerPaymentType)
    .values({ name: `Withholding ${tag}` })
    .returning();
  const paymentRows = await db
    .insert(ledgerPayments)
    .values([
      { status: "cleared" as const, amount: "30.00", paymentType: payType.id, ledgerEaId: employerEa.id },
      { status: "cleared" as const, amount: "30.00", paymentType: payType.id, ledgerEaId: employerEa.id },
    ])
    .returning();
  const [payA, payB] = paymentRows;

  const baseAlloc = (workerIdx: number, amount: string) => ({
    wizardId: wizard.id,
    employerId: employer.id,
    year: 2026,
    month: 1,
    workerId: workerRows[workerIdx].id,
    workerEaId: workerEas[workerIdx].id,
    amount,
    data: null,
  });

  const readDbRows = () =>
    db
      .select()
      .from(sitespecificBaoWithholdingAllocations)
      .where(eq(sitespecificBaoWithholdingAllocations.wizardId, wizard.id));

  const snapshotMatchesDb = async (snapshot: Array<{ workerId: string; amount: string }>) => {
    const rows = await readDbRows();
    if (rows.length !== snapshot.length) return false;
    const byWorker = new Map(rows.map((r) => [r.workerId, r.amount]));
    return snapshot.every((s) => byWorker.get(s.workerId) === s.amount);
  };

  const releaseAll = async () => {
    await allocStore.release(payA.id);
    await allocStore.release(payB.id);
  };

  try {
    // ---------- Race 1: amount change vs consume, many iterations ----------
    let race1Violations = 0;
    for (let i = 0; i < 10; i++) {
      await releaseAll();
      // reset to two workers @ 10/20
      await db
        .delete(sitespecificBaoWithholdingAllocations)
        .where(eq(sitespecificBaoWithholdingAllocations.wizardId, wizard.id));
      await db
        .insert(sitespecificBaoWithholdingAllocations)
        .values([baseAlloc(0, "10.00"), baseAlloc(1, "20.00")]);

      const [consumeOutcome, upsertOutcome] = await Promise.allSettled([
        allocStore.consume([wizard.id], payA.id),
        allocStore.upsert(baseAlloc(0, "99.00")),
      ]);

      if (consumeOutcome.status !== "fulfilled") {
        race1Violations++;
        continue;
      }
      const snapshot = consumeOutcome.value.map((r) => ({ workerId: r.workerId, amount: r.amount }));
      // Invariant: DB rows now equal exactly what consume credited, and the
      // upsert either happened BEFORE consume (snapshot has 99.00) or threw.
      const dbMatches = await snapshotMatchesDb(snapshot);
      const upsertRan = snapshot.some((s) => s.amount === "99.00");
      const upsertBlocked =
        upsertOutcome.status === "rejected" &&
        (upsertOutcome.reason as Error).message === WITHHOLDING_CONSUMED;
      if (!dbMatches || !(upsertRan ? upsertOutcome.status === "fulfilled" : upsertBlocked)) {
        race1Violations++;
        console.log("race1 detail", { snapshot, upsertOutcome, dbMatches });
      }
    }
    check("race 1: consumed set immutable under concurrent amount change (10 iterations)", race1Violations === 0, race1Violations);

    // ---------- Race 2: new-worker insert vs consume ----------
    let race2Violations = 0;
    for (let i = 0; i < 10; i++) {
      await releaseAll();
      await db
        .delete(sitespecificBaoWithholdingAllocations)
        .where(eq(sitespecificBaoWithholdingAllocations.wizardId, wizard.id));
      await db
        .insert(sitespecificBaoWithholdingAllocations)
        .values([baseAlloc(0, "10.00"), baseAlloc(1, "20.00")]);

      const [consumeOutcome, insertOutcome] = await Promise.allSettled([
        allocStore.consume([wizard.id], payA.id),
        allocStore.upsert(baseAlloc(2, "5.00")),
      ]);
      if (consumeOutcome.status !== "fulfilled") {
        race2Violations++;
        continue;
      }
      const snapshot = consumeOutcome.value.map((r) => ({ workerId: r.workerId, amount: r.amount }));
      const dbMatches = await snapshotMatchesDb(snapshot);
      const insertRan = snapshot.some((s) => s.workerId === workerRows[2].id);
      const insertBlocked =
        insertOutcome.status === "rejected" &&
        (insertOutcome.reason as Error).message === WITHHOLDING_CONSUMED;
      if (!dbMatches || !(insertRan ? insertOutcome.status === "fulfilled" : insertBlocked)) {
        race2Violations++;
        console.log("race2 detail", { snapshot, insertOutcome, dbMatches });
      }
    }
    check("race 2: consumed set immutable under concurrent new-worker insert (10 iterations)", race2Violations === 0, race2Violations);

    // ---------- Race 3: two payments consume the same upload ----------
    let race3Violations = 0;
    for (let i = 0; i < 10; i++) {
      await releaseAll();
      const outcomes = await Promise.allSettled([
        allocStore.consume([wizard.id], payA.id),
        allocStore.consume([wizard.id], payB.id),
      ]);
      const wins = outcomes.filter((o) => o.status === "fulfilled").length;
      const losses = outcomes.filter(
        (o) => o.status === "rejected" && (o.reason as Error).message === UPLOAD_ALREADY_CONSUMED,
      ).length;
      const rows = await readDbRows();
      const holders = new Set(rows.map((r) => r.consumedByPaymentId));
      if (!(wins === 1 && losses === 1 && holders.size === 1 && !holders.has(null))) {
        race3Violations++;
        console.log("race3 detail", { outcomes, holders: [...holders] });
      }
    }
    check("race 3: exactly one payment wins concurrent consumption (10 iterations)", race3Violations === 0, race3Violations);
  } finally {
    // ---------- Cleanup ----------
    await db
      .delete(sitespecificBaoWithholdingAllocations)
      .where(eq(sitespecificBaoWithholdingAllocations.wizardId, wizard.id));
    await db.delete(ledgerPayments).where(inArray(ledgerPayments.id, paymentRows.map((p) => p.id)));
    await db.delete(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, payType.id));
    await db.delete(ledgerEa).where(inArray(ledgerEa.id, eaRows.map((e) => e.id)));
    await db.delete(wizards).where(eq(wizards.id, wizard.id)); // cascades wizardEmployerMonthly
    await db.delete(workers).where(inArray(workers.id, workerRows.map((w) => w.id)));
    await db.delete(contacts).where(inArray(contacts.id, contactRows.map((c) => c.id)));
    await db.delete(employers).where(eq(employers.id, employer.id));
    await db.delete(ledgerAccounts).where(eq(ledgerAccounts.id, account.id));
  }

  console.log(failures === 0 ? "\nAll race checks passed." : `\n${failures} race check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Race smoke test crashed:", err);
  process.exit(1);
});
