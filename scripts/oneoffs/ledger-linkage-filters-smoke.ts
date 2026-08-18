/**
 * Smoke test for the ledger payment-linkage / server-side filter / export
 * fixes (imported-ledger defects surfaced by the S2 rehearsal review):
 *
 *  1. Repair script rewrites s1-import migration-only reference types
 *     (ledger_payment→payment, trust_wmb→wmb) idempotently — second run
 *     updates 0 rows.
 *  2. Payment-referenced entries classify as payments in the EA monthly
 *     account summary regardless of charge plugin; negative non-payment
 *     entries surface as adjustments (nothing drops out of every bucket).
 *  3. Transactions routes filter server-side over the WHOLE scoped dataset
 *     (a match beyond page one is returned; totals reflect the filter) and
 *     report entity-type options from the full scope.
 *  4. Payment transactions route shows the migrated allocations after repair,
 *     with a payment-details reference label.
 *  5. CSV export streams every matching row (no truncation) and honors the
 *     same filters.
 *
 * Run: npx tsx scripts/oneoffs/ledger-linkage-filters-smoke.ts
 * Seeds temp rows in the dev DB and removes them afterwards.
 */
import express from "express";
import { execFileSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { withNotificationsSuppressed, withChargePluginsSuppressed } from "../../server/middleware/request-context";
import { registerLedgerEaRoutes } from "../../server/modules/ledger/ea";
import { registerLedgerAccountRoutes } from "../../server/modules/ledger/accounts";
import { registerLedgerPaymentRoutes } from "../../server/modules/ledger/payments";

const TAG = `smoke328-${Date.now()}`;

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};

async function main() {
  await loadComponentCache();
  initializePermissions();
  initAccessControl(
    {
      getUserPermissions: async (userId: string) => {
        const permissions = await storage.users.getUserPermissions(userId);
        return permissions.map((p) => p.key);
      },
      hasPermission: async (userId: string, permissionKey: string) =>
        storage.users.userHasPermission(userId, permissionKey),
      getUser: async (userId: string) => storage.users.getUser(userId),
    },
    storage,
    async (componentId: string) => isComponentEnabledSync(componentId),
  );

  const allUsers = await storage.users.getAllUsers();
  let adminUser: any = null;
  for (const u of allUsers) {
    if (await storage.users.userHasPermission(u.id, "admin")) { adminUser = u; break; }
  }
  if (!adminUser) {
    console.error("FAIL: no admin user in dev DB; cannot verify");
    process.exit(1);
  }

  // ---- Seed -----------------------------------------------------------
  // Real employer so the entity-name join resolves; second EA gets a
  // different entity type so entity-type options must span the scope.
  const empRow = (await db.execute(sql`SELECT id, name FROM employers ORDER BY name LIMIT 1`)) as unknown as { rows: Array<{ id: string; name: string }> };
  const employer = empRow.rows[0];
  if (!employer) { console.error("FAIL: no employer in dev DB"); process.exit(1); }

  let paymentTypeId: string | null = null;
  let createdPaymentType = false;
  const ptRow = (await db.execute(sql`SELECT id FROM options_ledger_payment_type WHERE category = 'financial' LIMIT 1`)) as unknown as { rows: Array<{ id: string }> };
  if (ptRow.rows[0]) {
    paymentTypeId = ptRow.rows[0].id;
  } else {
    const ins = (await db.execute(sql`INSERT INTO options_ledger_payment_type (name, category) VALUES (${`Smoke Check ${TAG}`}, 'financial') RETURNING id`)) as unknown as { rows: Array<{ id: string }> };
    paymentTypeId = ins.rows[0].id;
    createdPaymentType = true;
  }

  const seeded = await withNotificationsSuppressed(() => withChargePluginsSuppressed(async () => {
    const account = await storage.ledger.accounts.create({ name: `Smoke Account ${TAG}`, currencyCode: "USD" });
    const ea1 = await storage.ledger.ea.create({ accountId: account.id, entityType: "employer", entityId: employer.id });
    const ea2 = await storage.ledger.ea.create({ accountId: account.id, entityType: "trustProvider", entityId: `${TAG}-tp` });

    // 60 filler charges (older months, outside the summary window)
    for (let i = 0; i < 60; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const ymd = `2025-06-${day}`;
      await storage.ledger.entries.create({
        chargePlugin: "s1-import", chargePluginKey: `${TAG}-filler-${i}`,
        amount: "5.00", eaId: ea1.id, referenceType: "s1-unknown", referenceId: `${TAG}-nid-${i}`,
        date: new Date(`${ymd}T12:00:00.000Z`), memo: `SMOKE-FILLER-${i}`, statementYmd: ymd,
      });
    }
    // Needle: older than every filler, so it sorts beyond page one (size 50)
    await storage.ledger.entries.create({
      chargePlugin: "s1-import", chargePluginKey: `${TAG}-needle`,
      amount: "7.77", eaId: ea1.id, referenceType: "s1-unknown", referenceId: `${TAG}-nid-needle`,
      date: new Date("2025-05-15T12:00:00.000Z"), memo: "SMOKE-NEEDLE-328", statementYmd: "2025-05-15",
    });
    // EA2 entry (different entity type in the account scope)
    await storage.ledger.entries.create({
      chargePlugin: "s1-import", chargePluginKey: `${TAG}-ea2`,
      amount: "3.00", eaId: ea2.id, referenceType: "s1-unknown", referenceId: `${TAG}-nid-ea2`,
      date: new Date("2025-06-01T12:00:00.000Z"), memo: "SMOKE-EA2", statementYmd: "2025-06-01",
    });

    // Current-month classification set: a cleared payment + two migrated
    // allocations written with the OLD migration-only reference type, one
    // wmb charge with the old type, one negative non-payment credit.
    const now = new Date();
    const curYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const payment = await storage.ledger.payments.create({
      status: "cleared", amount: "100.00", paymentType: paymentTypeId!, ledgerEaId: ea1.id,
      dateReceived: now, memo: `SMOKE-PAYMENT ${TAG}`,
    });
    for (const n of [1, 2] as const) {
      await storage.ledger.entries.create({
        chargePlugin: "s1-import", chargePluginKey: `${TAG}-alloc-${n}`,
        amount: "-50.00", eaId: ea1.id, referenceType: "ledger_payment", referenceId: payment.id,
        date: now, memo: `SMOKE-ALLOC-${n}`, statementYmd: curYmd,
      });
    }
    await storage.ledger.entries.create({
      chargePlugin: "s1-import", chargePluginKey: `${TAG}-wmb`,
      amount: "20.00", eaId: ea1.id, referenceType: "trust_wmb", referenceId: `${TAG}-wmb-ref`,
      date: now, memo: "SMOKE-WMB", statementYmd: curYmd,
    });
    await storage.ledger.entries.create({
      chargePlugin: "s1-import", chargePluginKey: `${TAG}-adj`,
      amount: "-10.00", eaId: ea1.id, referenceType: "s1-unknown", referenceId: `${TAG}-nid-adj`,
      date: now, memo: "SMOKE-ADJ", statementYmd: curYmd,
    });

    return { account, ea1, ea2, payment };
  }));

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { claims: { sub: adminUser.id }, dbUser: adminUser };
    req.isAuthenticated = () => true;
    next();
  });
  registerLedgerEaRoutes(app);
  registerLedgerAccountRoutes(app);
  registerLedgerPaymentRoutes(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const getJson = async (path: string) => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.json() };
  };

  try {
    // ---- 1. Pre-repair: allocations invisible to payment consumers ----
    const preLink = await getJson(`/api/ledger/payments/${seeded.payment.id}/transactions`);
    check("pre-repair: payment shows no linked transactions", preLink.status === 200 && preLink.body.total === 0, preLink.body.total);

    const preSummary = await getJson(`/api/ledger/ea/${seeded.ea1.id}/account-summary?months=3`);
    check("pre-repair: old-type allocations land in adjustments (not dropped)",
      preSummary.status === 200 && preSummary.body.current?.adjustments === "-110.00",
      preSummary.body.current);

    // ---- 2. Repair script: applies, then idempotent no-op --------------
    const runRepair = () => {
      const out = execFileSync("npx", ["tsx", "scripts/oneoffs/repair-s1-import-reference-types.ts"], { encoding: "utf8", timeout: 280000 });
      return JSON.parse(out.slice(out.indexOf("{")));
    };
    const run1 = runRepair();
    check("repair run 1 updates the seeded rows (>=3)", run1.totalUpdated >= 3, run1.totalUpdated);
    check("repair run 1 reports consistent before/after counts", (run1.renames as any[]).every(r => r.consistent === true), run1.renames);
    const run2 = runRepair();
    check("repair run 2 is a no-op (idempotent)", run2.totalUpdated === 0, run2.totalUpdated);

    // ---- 3. Post-repair: payment linkage + labels ----------------------
    const postLink = await getJson(`/api/ledger/payments/${seeded.payment.id}/transactions`);
    check("post-repair: payment shows its 2 allocation transactions", postLink.body.total === 2, postLink.body.total);
    check("post-repair: allocation reference label shows payment details",
      (postLink.body.data as any[]).every(t => typeof t.referenceName === "string" && t.referenceName.includes("Payment:")),
      (postLink.body.data as any[])[0]?.referenceName);

    // ---- 4. Post-repair: classification (payments vs charges vs adj) ---
    const postSummary = await getJson(`/api/ledger/ea/${seeded.ea1.id}/account-summary?months=3`);
    check("post-repair: allocations classify as payments credited",
      postSummary.body.current?.paymentsCredited === "-100.00", postSummary.body.current);
    check("post-repair: positive wmb row classifies as charges",
      postSummary.body.current?.charges === "20.00", postSummary.body.current?.charges);
    check("post-repair: negative non-payment row classifies as adjustments",
      postSummary.body.current?.adjustments === "-10.00", postSummary.body.current?.adjustments);

    // ---- 5. Server-side filters beyond page one ------------------------
    const page1 = await getJson(`/api/ledger/ea/${seeded.ea1.id}/transactions?limit=50&offset=0`);
    check("unfiltered page 1 does not contain the needle",
      page1.body.total === 65 && !(page1.body.data as any[]).some(t => t.memo === "SMOKE-NEEDLE-328"),
      { total: page1.body.total });
    const memoFiltered = await getJson(`/api/ledger/ea/${seeded.ea1.id}/transactions?limit=50&offset=0&memo=SMOKE-NEEDLE`);
    check("memo filter finds the beyond-page-one match with correct total",
      memoFiltered.body.total === 1 && (memoFiltered.body.data as any[])[0]?.memo === "SMOKE-NEEDLE-328",
      { total: memoFiltered.body.total });
    const amountFiltered = await getJson(`/api/ledger/ea/${seeded.ea1.id}/transactions?amountMin=7&amountMax=8`);
    check("amount range filter matches only the needle", amountFiltered.body.total === 1, amountFiltered.body.total);
    const dateFiltered = await getJson(`/api/ledger/ea/${seeded.ea1.id}/transactions?dateFrom=2025-05-01&dateTo=2025-05-31`);
    check("date range filter matches only the needle", dateFiltered.body.total === 1, dateFiltered.body.total);
    const nameFiltered = await getJson(`/api/ledger/accounts/${seeded.account.id}/transactions?entityName=${encodeURIComponent(employer.name.slice(0, 8))}`);
    check("entity name filter matches employer-EA rows across the account", nameFiltered.body.total === 65, nameFiltered.body.total);
    const typeFiltered = await getJson(`/api/ledger/accounts/${seeded.account.id}/transactions?entityType=trustProvider`);
    check("entity type filter scopes to the trustProvider EA", typeFiltered.body.total === 1, typeFiltered.body.total);

    // ---- 6. Entity-type options come from the whole scope --------------
    const acctPage1 = await getJson(`/api/ledger/accounts/${seeded.account.id}/transactions?limit=5&offset=0`);
    check("entityTypes options cover the full scope (not just the page)",
      Array.isArray(acctPage1.body.entityTypes) &&
      acctPage1.body.entityTypes.includes("employer") && acctPage1.body.entityTypes.includes("trustProvider"),
      acctPage1.body.entityTypes);

    // ---- 7. CSV export: complete + filtered -----------------------------
    const csvRes = await fetch(`${base}/api/ledger/accounts/${seeded.account.id}/transactions?format=csv`);
    const csvText = await csvRes.text();
    const csvLines = csvText.trim().split("\n");
    check("CSV export includes every row (header + 66 data rows)",
      csvRes.status === 200 && csvRes.headers.get("content-type")?.includes("text/csv") === true && csvLines.length === 67,
      { lines: csvLines.length });
    check("CSV header matches expected columns", csvLines[0].startsWith("Date,Statement,Amount,Entity Type,Entity Name,Memo,Reference Type,Reference,EA Account,Transaction ID"), csvLines[0]);
    const csvFilteredRes = await fetch(`${base}/api/ledger/ea/${seeded.ea1.id}/transactions?format=csv&memo=SMOKE-NEEDLE`);
    const csvFilteredLines = (await csvFilteredRes.text()).trim().split("\n");
    check("filtered CSV export contains only the matching row", csvFilteredLines.length === 2 && csvFilteredLines[1].includes("SMOKE-NEEDLE-328"), { lines: csvFilteredLines.length });
  } finally {
    server.close();
    // ---- Cleanup (order: entries -> payment -> EAs -> account) ---------
    await db.execute(sql`DELETE FROM ledger WHERE ea_id IN (${seeded.ea1.id}, ${seeded.ea2.id})`);
    await db.execute(sql`DELETE FROM ledger_payments WHERE id = ${seeded.payment.id}`);
    await db.execute(sql`DELETE FROM ledger_ea WHERE id IN (${seeded.ea1.id}, ${seeded.ea2.id})`);
    await db.execute(sql`DELETE FROM ledger_accounts WHERE id = ${seeded.account.id}`);
    if (createdPaymentType && paymentTypeId) {
      await db.execute(sql`DELETE FROM options_ledger_payment_type WHERE id = ${paymentTypeId}`);
    }
    await pgPool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
