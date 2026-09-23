/**
 * Reviewed historical repair. Preview first:
 *   npx tsx scripts/oneoffs/repair-charge-directed-payments.ts
 * Apply only the exact previewed snapshot:
 *   npx tsx scripts/oneoffs/repair-charge-directed-payments.ts --apply --snapshot=<sha256>
 *
 * Run against the intended database after migration 1203. Nothing is changed
 * without --apply and a matching snapshot. This does not change payment rows,
 * non-payment ledger entries or entries owned by other charge plugins.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { pool } from "../../server/db";
import { storage } from "../../server/storage";
import { getClient, runInTransaction } from "../../server/storage/transaction-context";
import { drainStorageSideEffects } from "../../server/storage/drain-storage-side-effects";
import { triggerPaymentChargePlugins } from "../../server/modules/ledger/payments";
import { storageLogger } from "../../server/logger";
import "../../server/plugins/ledger/charge/plugins/paymentSimpleAllocation";

type Candidate = { id: string; type_id: string; type_name: string; amount: string; entry_id: string | null; entry_amount: string | null; entry_key: string | null };
const query = sql`
  SELECT p.id, t.id AS type_id, t.name AS type_name, t.direction,
    p.amount, p.ledger_ea_id, p.details, p.memo, p.date_received, p.date_cleared,
    l.id AS entry_id, l.amount AS entry_amount, l.charge_plugin_key AS entry_key,
    l.statement_ymd AS entry_statement_ymd, l.ea_id AS entry_ea_id
  FROM ledger_payments p
  JOIN options_ledger_payment_type t ON t.id = p.payment_type
  LEFT JOIN ledger l ON l.reference_type = 'payment' AND l.reference_id = p.id
    AND l.charge_plugin = 'payment-simple-allocation'
  WHERE p.status = 'cleared' AND t.direction = 'charge'
    AND NOT COALESCE(p.details ? 'baoUploadSource', false)
  ORDER BY p.id, l.id
`;

function fingerprint(rows: Candidate[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function main() {
  const applying = process.argv.includes("--apply");
  const expected = process.argv.find(arg => arg.startsWith("--snapshot="))?.slice("--snapshot=".length);
  if (applying && (!expected || !/^[a-f0-9]{64}$/.test(expected))) {
    throw new Error("Apply requires the exact SHA-256 snapshot from the preview");
  }
  if (!applying && expected) throw new Error("--snapshot requires --apply");

  const audit: Array<{ id: string; entryIds: string[]; amounts: string[] }> = [];
  let appliedSnapshot = "";
  await runInTransaction(async () => {
    const client = getClient();
    // Lock the relevant source rows so a concurrent edit cannot invalidate the
    // reviewed preview between comparison and reconciliation.
    if (applying) {
      await client.execute(sql`
        SELECT id FROM ledger_payments
        WHERE status = 'cleared' AND payment_type IN
          (SELECT id FROM options_ledger_payment_type WHERE direction = 'charge')
        ORDER BY id FOR UPDATE
      `);
      await client.execute(sql`
        SELECT id FROM ledger
        WHERE reference_type = 'payment' AND charge_plugin = 'payment-simple-allocation'
          AND reference_id IN (
            SELECT p.id FROM ledger_payments p JOIN options_ledger_payment_type t ON t.id = p.payment_type
            WHERE p.status = 'cleared' AND t.direction = 'charge'
          )
        ORDER BY id FOR UPDATE
      `);
    }
    const result = await client.execute(query);
    const rows = result.rows as Candidate[];
    const snapshot = fingerprint(rows);
    const ids = [...new Set(rows.map(row => row.id))];
    console.log(JSON.stringify({
      mode: applying ? "apply" : "preview",
      snapshot,
      paymentCount: ids.length,
      entries: rows.filter(row => row.entry_id).length,
      payments: ids.map(id => ({
        id,
        type: rows.find(row => row.id === id)!.type_name,
        amount: rows.find(row => row.id === id)!.amount,
        entries: rows.filter(row => row.id === id && row.entry_id)
          .map(row => ({ id: row.entry_id, amount: row.entry_amount, key: row.entry_key })),
      })),
    }, null, 2));
    if (!applying) return;
    if (snapshot !== expected) throw new Error("Snapshot changed; review a new preview before applying");
    appliedSnapshot = snapshot;

    for (const id of ids) {
      const payment = await storage.ledger.payments.get(id);
      if (!payment || payment.status !== "cleared") throw new Error(`Payment changed: ${id}`);
      // The same allocation reconciler used by manual edits; stable keys
      // upsert in place. Restrict execution to simple allocation, never the
      // bespoke upload-source or any other payment plugin.
      await triggerPaymentChargePlugins(payment, {
        onlyPluginIds: ["payment-simple-allocation"],
        suppressSavedEvent: true,
      });
      const entries = (await storage.ledger.entries.getByReference("payment", id))
        .filter(entry => entry.chargePlugin === "payment-simple-allocation");
      if (entries.length === 0 || entries.some(entry => Number(entry.amount) <= 0) ||
          entries.reduce((sum, entry) => sum + Math.round(Number(entry.amount) * 100), 0) !==
          Math.round(Number(payment.amount) * 100)) {
        throw new Error(`Charge entries not reconciled for ${id}; all changes rolled back`);
      }
      audit.push({ id, entryIds: entries.map(entry => entry.id), amounts: entries.map(entry => entry.amount) });
    }
  });
  for (const { id, entryIds, amounts } of audit) {
    storageLogger.info("Reviewed charge-direction historical correction", {
      module: "ledger.payments", operation: "repairDirection", entity_id: id,
      description: `Reconciled charge-directed payment ${id}`,
      meta: { snapshot: appliedSnapshot, entryIds, amounts },
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await drainStorageSideEffects();
  await pool.end();
});