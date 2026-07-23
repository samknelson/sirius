/**
 * Remove the BAO Domestic Partner (DP) test data created by
 * scripts/oneoffs/seed-bao-dp-test-data.ts, so the seed script can be
 * run again from a clean slate.
 *
 * What it does (idempotent — safe to re-run):
 *   1. Deletes all DP charge ledger entries on the Health Fund - DP account.
 *   2. Deletes the subscriber's entity account on that DP account.
 *   3. Deletes the sitespecific-bao-dp charge config.
 *   4. Removes DP relations from the test subscriber's election.
 *   5. Deletes the DP relation and the "Jordan Testpartner" worker.
 *   6. Deletes the "Domestic Partner" relationship type (if unused).
 *
 * Run: npx tsx scripts/oneoffs/cleanup-bao-dp-test-data.ts
 */

import { storage } from "../../server/storage/database";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";

const SUBSCRIBER_WORKER_ID = "957cee4a-438f-4fcb-bf09-ac93772453e5"; // sirius_id 2164
const ELECTION_ID = "28847ef8-7dd1-4583-a5a2-eb127b4f863f";
const DP_ACCOUNT_ID = "ae9cb315-3a70-4b8e-9c0f-ece5e8fcba4e"; // "Health Fund - DP"
const DP_PLUGIN_ID = "sitespecific-bao-dp";
const DP_PARTNER_NAME = "Jordan Testpartner";

async function main() {
  // ---- 1. Delete DP charge ledger entries on the DP account ----
  const deletedEntries = await storage.ledger.entries.deleteOrphansByChargePluginAndKnownKeys(
    DP_PLUGIN_ID,
    DP_ACCOUNT_ID,
    new Set<string>(),
  );
  console.log(`Deleted ${deletedEntries} DP charge ledger entr${deletedEntries === 1 ? "y" : "ies"}`);

  // ---- 2. Delete the subscriber's entity account on the DP account ----
  const eas = await storage.ledger.ea.getByEntity("worker", SUBSCRIBER_WORKER_ID);
  const dpEa = eas.find((e) => e.accountId === DP_ACCOUNT_ID);
  if (dpEa) {
    await storage.ledger.ea.delete(dpEa.id);
    console.log(`Deleted entity account ${dpEa.id} on Health Fund - DP`);
  } else {
    console.log("No entity account on Health Fund - DP (already clean)");
  }

  // ---- 3. Delete the DP charge config ----
  const cfgs = await storage.pluginConfigs.getByKindAndPlugin("charge", DP_PLUGIN_ID);
  for (const cfg of cfgs) {
    await storage.pluginConfigs.delete(cfg.id);
    console.log(`Deleted charge config ${cfg.id} ("${cfg.name}")`);
  }
  if (cfgs.length === 0) console.log("No DP charge config (already clean)");

  // ---- 4. Remove DP relations from the election ----
  const election = await storage.workerTrustElections.getById(ELECTION_ID);
  if (!election) throw new Error(`Election ${ELECTION_ID} not found`);
  const relIds = election.relationshipIds ?? [];
  const rels = relIds.length
    ? await storage.workerRelations.listByIdsWithType(relIds)
    : [];
  const dpRels = rels.filter((r: any) =>
    (r.relationTypeName ?? "").toLowerCase().includes("domestic partner"),
  );
  if (dpRels.length > 0) {
    const keep = relIds.filter((id) => !dpRels.some((r: any) => r.id === id));
    await storage.workerTrustElections.update(ELECTION_ID, { relationshipIds: keep });
    console.log(`Removed ${dpRels.length} DP relation(s) from election ${ELECTION_ID}`);
  } else {
    console.log("Election has no DP relations (already clean)");
  }

  // ---- 5. Delete the DP relation(s) and the test partner worker(s) ----
  for (const rel of dpRels as any[]) {
    const otherWorkerId =
      rel.worker1 === SUBSCRIBER_WORKER_ID ? rel.worker2 : rel.worker1;
    await storage.workerRelations.delete(rel.id);
    console.log(`Deleted DP relation ${rel.id}`);

    const other = otherWorkerId
      ? await storage.workers.getWorker(otherWorkerId)
      : undefined;
    const contact = other?.contactId
      ? await storage.contacts.getContact(other.contactId)
      : undefined;
    const otherName =
      contact?.name ||
      [contact?.given, contact?.family].filter(Boolean).join(" ");
    if (other && otherName === DP_PARTNER_NAME) {
      await storage.workers.deleteWorker(otherWorkerId);
      console.log(`Deleted test partner worker "${DP_PARTNER_NAME}" (${otherWorkerId})`);
    } else if (other) {
      console.log(`Kept worker ${otherWorkerId} ("${otherName}" is not the test partner)`);
    }
  }

  // ---- 6. Delete the "Domestic Partner" relationship type ----
  const options = createUnifiedOptionsStorage();
  const relTypes = await options.list("worker-relation-type");
  const dpType = relTypes.find((t: any) =>
    (t.name ?? "").toLowerCase().includes("domestic partner"),
  );
  if (dpType) {
    try {
      await options.delete("worker-relation-type", dpType.id);
      console.log(`Deleted relationship type "${dpType.name}" (${dpType.id})`);
    } catch (err) {
      console.log(
        `Kept relationship type "${dpType.name}" — still in use elsewhere (${err instanceof Error ? err.message : err})`,
      );
    }
  } else {
    console.log("No Domestic Partner relationship type (already clean)");
  }

  console.log("Cleanup done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
