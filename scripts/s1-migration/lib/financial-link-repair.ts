import { sql } from "drizzle-orm";
import { storage } from "../../../server/storage/database";
import { getClient, runInTransaction } from "../../../server/storage/transaction-context";
import { withChargePluginsSuppressed, withNotificationsSuppressed } from "../../../server/middleware/request-context";
import { inventoryFinancialLinks, publicFinancialInventory, financialFactsSnapshot } from "./financial-link-inventory";
import { sameFinancialCoordinate } from "./financial-identity-plan";

/** Only these deliberate refusal messages are safe to relay to operators. */
export class FinancialRepairRefusal extends Error {}

export async function repairFinancialLinks(options: { wet: boolean; checkpoint: string; approval?: string; stream?: "ar" | "payment" }) {
  const { wet, checkpoint, approval } = options;
  if (!checkpoint.trim()) throw new FinancialRepairRefusal("A common source/staging checkpoint is required");
  if (wet && !/^[a-f0-9]{64}$/.test(approval ?? "")) {
    throw new FinancialRepairRefusal("--wet requires --approve <reviewed dry-run evidenceHash>");
  }
  return runInTransaction(async () => {
    if (!wet) await getClient().execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    else {
      await getClient().execute(sql`SET LOCAL lock_timeout = '5s'`);
      await getClient().execute(sql`SET LOCAL statement_timeout = '120s'`);
      await getClient().execute(sql`LOCK TABLE ledger, ledger_payments, ledger_ea IN SHARE ROW EXCLUSIVE MODE`);
      await getClient().execute(sql`
        LOCK TABLE s1_staging.records, s1_staging.raw_ledger_ar, s1_staging.id_map,
          workers, contacts, employers, ledger_accounts IN SHARE MODE
      `);
    }
    const scope = options.stream ? { streams: [options.stream] } : {};
    const inventory = await inventoryFinancialLinks(checkpoint, scope);
    if (!wet) return { wet, ...publicFinancialInventory(inventory) };
    if (inventory.evidenceHash !== approval) {
      throw new FinancialRepairRefusal("Evidence changed since dry run; nothing applied. Review a fresh dry run");
    }
    if (inventory.blocked) throw new FinancialRepairRefusal("Unsafe identities or target conflicts remain; nothing applied");
    const links: Array<{ stream: "ar" | "payment"; id: string; eaId: string }> = [];
    for (const plan of inventory.rebinds) {
      const ea = await storage.ledger.ea.getOrCreate(plan.entity.entityType, plan.entity.entityId, plan.accountId);
      if (!sameFinancialCoordinate(plan.entity, plan.accountId, ea)) {
        throw new FinancialRepairRefusal("Canonical account ownership disagrees; transaction rolled back");
      }
      links.push({ stream: plan.stream, id: plan.id, eaId: ea.id });
    }
    const approved = {
      ar: new Set(links.filter((l) => l.stream === "ar").map((l) => l.id)),
      payment: new Set(links.filter((l) => l.stream === "payment").map((l) => l.id)),
    };
    const before = await financialFactsSnapshot(approved);
    await withNotificationsSuppressed(() => withChargePluginsSuppressed(async () => {
      for (const link of links) {
        // Link-only patches. Never replay allocation or replace provenance,
        // annotations, payment/hour references or financial facts.
        const row = link.stream === "ar"
          ? await storage.ledger.entries.update(link.id, { eaId: link.eaId })
          : await storage.ledger.payments.updateForMigration(link.id, { ledgerEaId: link.eaId });
        if (!row) throw new FinancialRepairRefusal("Rebind target vanished; transaction rolled back");
      }
    }));
    const after = await financialFactsSnapshot(approved);
    if (before.hash !== after.hash) {
      throw new FinancialRepairRefusal("Financial facts or unrelated activity changed; transaction rolled back");
    }
    const verified = await inventoryFinancialLinks(checkpoint, scope);
    if (verified.blocked || verified.mismatched) {
      throw new FinancialRepairRefusal("Post-repair identity verification failed; transaction rolled back");
    }
    return { wet, ...publicFinancialInventory(verified), rebound: links.length,
      approvedEvidenceHash: approval, financialFactsUnchanged: true, fundTotals: after.totals };
  });
}
