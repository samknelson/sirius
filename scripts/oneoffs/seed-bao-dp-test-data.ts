/**
 * Seed dev-DB test data for the BAO Domestic Partner (DP) feature and run
 * the DP billing charge plugin live so there are real charges to test with.
 *
 * What it does (idempotent — safe to re-run):
 *   1. Ensures a "Domestic Partner" relationship type exists.
 *   2. Ensures the test subscriber (worker sirius_id 2164, MLK-only election
 *      starting 2026-01-01) has a DP dependent: creates a new worker
 *      "Jordan Testpartner" and a Domestic Partner relation starting
 *      2026-05-01 if none exists yet.
 *   3. Adds that DP relation to the subscriber's election.
 *   4. Ensures an enabled global charge config for sitespecific-bao-dp
 *      pointing at the "Health Fund - DP" ledger account.
 *   5. Runs the DP billing plugin (live) — expect charges for May, Jun,
 *      Jul 2026 (Aug is skipped: no subscriber benefit presence yet).
 *
 * Run: npx tsx scripts/oneoffs/seed-bao-dp-test-data.ts
 */

import { storage } from "../../server/storage/database";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import {
  executeChargePlugins,
  TriggerType,
} from "../../server/plugins/ledger/charge";

const SUBSCRIBER_WORKER_ID = "957cee4a-438f-4fcb-bf09-ac93772453e5"; // sirius_id 2164, MLK-only election
const ELECTION_ID = "28847ef8-7dd1-4583-a5a2-eb127b4f863f"; // 2026-01-01 → open, benefit: MLK
const DP_ACCOUNT_ID = "ae9cb315-3a70-4b8e-9c0f-ece5e8fcba4e"; // "Health Fund - DP"
const DP_PLUGIN_ID = "sitespecific-bao-dp";
const DP_RELATION_START = "2026-05-01";
const DP_PARTNER_NAME = "Jordan Testpartner";

async function main() {
  // ---- 1. Domestic Partner relationship type ----
  const options = createUnifiedOptionsStorage();
  const relTypes = await options.list("worker-relation-type");
  let dpType = relTypes.find((t: any) =>
    (t.name ?? "").toLowerCase().includes("domestic partner"),
  );
  if (dpType) {
    console.log(`Relationship type exists: "${dpType.name}" (${dpType.id})`);
  } else {
    dpType = await options.create("worker-relation-type", {
      name: "Domestic Partner",
      description: "Domestic partner (unmarried partner) of the worker",
    });
    console.log(`Created relationship type "Domestic Partner" (${dpType.id})`);
  }

  // ---- 2. DP dependent worker + relation ----
  const election = await storage.workerTrustElections.getById(ELECTION_ID);
  if (!election) throw new Error(`Election ${ELECTION_ID} not found`);
  if (election.workerId !== SUBSCRIBER_WORKER_ID) {
    throw new Error(`Election ${ELECTION_ID} does not belong to expected subscriber`);
  }

  const existingRelIds = election.relationshipIds ?? [];
  const existingRels = existingRelIds.length
    ? await storage.workerRelations.listByIdsWithType(existingRelIds)
    : [];
  let dpRel = existingRels.find((r: any) =>
    (r.relationTypeName ?? "").toLowerCase().includes("domestic partner"),
  );

  if (dpRel) {
    console.log(`Election already covers DP relation ${dpRel.id}`);
  } else {
    const dpWorker = await storage.workers.createWorker(DP_PARTNER_NAME);
    console.log(`Created DP partner worker "${DP_PARTNER_NAME}" (${dpWorker.id})`);

    dpRel = await storage.workerRelations.create({
      worker1: SUBSCRIBER_WORKER_ID,
      worker2: dpWorker.id,
      relationType: dpType.id,
      startYmd: DP_RELATION_START,
    });
    console.log(`Created DP relation ${dpRel.id} (start ${DP_RELATION_START})`);

    // ---- 3. Add the DP relation to the election ----
    const updated = await storage.workerTrustElections.update(ELECTION_ID, {
      relationshipIds: [...existingRelIds, dpRel.id],
    });
    if (!updated) throw new Error("Election update failed");
    console.log(`Election ${ELECTION_ID} now covers relations: ${(updated.relationshipIds ?? []).join(", ")}`);
  }

  // ---- 4. Enabled global charge config -> Health Fund - DP account ----
  const cfgs = await storage.pluginConfigs.getByKindAndPlugin("charge", DP_PLUGIN_ID);
  let cfg = cfgs[0];
  if (cfg) {
    console.log(`Charge config exists (${cfg.id}), enabled=${cfg.enabled}`);
    if (!cfg.enabled) {
      cfg = (await storage.pluginConfigs.update(cfg.id, { enabled: true }))!;
      console.log("Enabled the existing charge config");
    }
  } else {
    cfg = await storage.pluginConfigs.create({
      pluginKind: "charge",
      pluginId: DP_PLUGIN_ID,
      name: "BAO - Domestic Partner Monthly Premium",
      enabled: true,
      data: {},
    });
    console.log(`Created charge config ${cfg.id}`);
  }
  await storage.pluginConfigs.upsertSubsidiary("charge", {
    id: cfg.id,
    scope: "global",
    employerId: null,
    account: DP_ACCOUNT_ID,
  });
  console.log(`Charge config points at Health Fund - DP account (${DP_ACCOUNT_ID})`);

  // ---- 5. Run DP billing live ----
  const result = await executeChargePlugins(
    { trigger: TriggerType.CRON, jobId: "seed-bao-dp-test-data", mode: "live" },
    { onlyPluginIds: [DP_PLUGIN_ID] },
  );
  for (const e of result.executed) {
    console.log(
      `[${e.success ? "OK" : "FAIL"}] ${e.pluginId}: ${e.transactionCount} transaction(s)` +
        (e.message ? ` — ${e.message}` : "") +
        (e.error ? ` — ERROR: ${e.error}` : ""),
    );
  }
  for (const t of result.totalTransactions) {
    console.log(
      `  charge ${t.amount} statement ${t.statementYmd} key=${t.chargePluginKey}`,
    );
  }
  if (result.executed.some((e) => !e.success)) {
    throw new Error("DP billing run reported failures");
  }
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
