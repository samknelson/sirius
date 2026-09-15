/**
 * Wet benchmark of the actual per-person corrective-scan write scope.
 *
 * 3,000 isolated workers × 10 benefits produces 30,000 WMB actions per case.
 * Each person receives its own transaction, the request-context invalidation
 * collector, scan-write loop guard, and one SAVEPOINT per WMB action — exactly
 * the production scan's bounded commit shape. It does not use one giant scan
 * transaction or alter any installed plugin configuration.
 *
 * Usage: npx tsx scripts/oneoffs/benchmark-worker-benefit-role-history.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { db, pool as pgPool } from "../../server/storage/db";
import { createTrustWmbStorage } from "../../server/storage/trust/wmb";
import { recomputeStaleDenorm } from "../../server/plugins/system/denorm/recompute";
import "../../server/plugins/system/denorm/plugins/workerBenefitRoleHistory";
import {
  withWmbBenefitRoleHistoryInvalidationBatch,
  withWmbScanWrites,
} from "../../server/middleware/request-context";
import { runInSavepoint, runInTransaction } from "../../server/storage/transaction-context";
import { loadComponentCache } from "../../server/services/component-cache";
import {
  contacts, denorm, employers, pluginConfigs, trustBenefits, trustWmb,
  workerBenefitRoleHistoryDenorm, workers,
} from "@shared/schema";

const PEOPLE = 3_000;
const BENEFITS_PER_PERSON = 10;
const TOTAL_ACTIONS = PEOPLE * BENEFITS_PER_PERSON;
const CONCURRENCY = 12;
const marker = `__worker-benefit-role-history-bench-${Date.now()}-${process.pid}__`;
const wmb = createTrustWmbStorage();

interface SqlCounts { [key: string]: number }
interface Result {
  name: string;
  sourcePayloadBefore: number;
  wmbActions: number;
  affectedWorkers: number;
  statusRows: number;
  generationDelta: number;
  seconds: number;
  perSecond: number;
  sql: SqlCounts;
  drain?: { claimed: number; seconds: number; payloadRows: number; projectionSeconds: number };
}

let workerIds: string[] = [];
let employerId = "";
let benefitIds: string[] = [];
let configId = "";
let createdConfig = false;

function fixtureIds() {
  return sql`
    SELECT w.id FROM workers w
    INNER JOIN contacts c ON c.id = w.contact_id
    WHERE c.display_name LIKE ${marker + "%"}
  `;
}

async function number(query: ReturnType<typeof sql>): Promise<number> {
  const r = await db.execute(query) as unknown as { rows: Array<{ n: number | string }> };
  return Number(r.rows[0]?.n ?? 0);
}

function captureSql(): { counts: SqlCounts; stop: () => void } {
  const counts: SqlCounts = {};
  const proto = Client.prototype as unknown as { query: (...args: any[]) => any };
  const original = proto.query;
  proto.query = function (...args: any[]) {
    const raw = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
    const q = String(raw).replace(/\s+/g, " ").trim().toLowerCase();
    const key =
      q.startsWith("insert into \"trust_wmb\"") ? "wmbInsert" :
      q.includes("insert into \"denorm\"") ? "denormUpsert" :
      q.includes("from \"plugin_configs\"") ? "configSelect" :
      q.startsWith("savepoint") ? "savepoint" :
      q.startsWith("release savepoint") ? "releaseSavepoint" :
      q.startsWith("begin") ? "begin" :
      q.startsWith("commit") ? "commit" : "other";
    counts[key] = (counts[key] ?? 0) + 1;
    return original.apply(this, args);
  };
  return { counts, stop: () => { proto.query = original; } };
}

async function mapPeople(fn: (workerId: string) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const index = next++;
      if (index >= workerIds.length) return;
      await fn(workerIds[index]);
    }
  }));
}

async function writeCase(name: string, registered: boolean, month: number): Promise<Result> {
  const payloadBefore = await number(sql`
    SELECT count(*)::int AS n FROM worker_benefit_role_history_denorm
    WHERE worker_id IN (${fixtureIds()})
  `);
  const wmbBefore = await number(sql`
    SELECT count(*)::int AS n FROM trust_wmb
    WHERE worker_id IN (${fixtureIds()})
  `);
  const beforeGeneration = await number(sql`
    SELECT COALESCE(sum(generation), 0)::int AS n FROM denorm
    WHERE config_id = ${configId} AND entity_id IN (${fixtureIds()})
  `);
  const capture = captureSql();
  const started = performance.now();
  try {
    await mapPeople(async (workerId) => {
      await runInTransaction(() =>
        withWmbBenefitRoleHistoryInvalidationBatch(
          (ids) => wmb.enqueueBenefitRoleHistoryInvalidations(ids),
          () => withWmbScanWrites(async () => {
            for (const benefitId of benefitIds) {
              // This is the same action isolation used by runBenefitsScan:
              // one failed WMB action rolls back only its own savepoint.
              await runInSavepoint(() => wmb.createWorkerBenefit({
                workerId, employerId, benefitId, year: 2092, month,
              }));
            }
          }),
        ),
      );
    });
  } finally {
    capture.stop();
  }
  const seconds = (performance.now() - started) / 1000;
  const statusRows = await number(sql`
    SELECT count(*)::int AS n FROM denorm
    WHERE config_id = ${configId} AND entity_id IN (${fixtureIds()})
  `);
  const generationNow = await number(sql`
    SELECT COALESCE(sum(generation), 0)::int AS n FROM denorm
    WHERE config_id = ${configId} AND entity_id IN (${fixtureIds()})
  `);
  const wmbActions = await number(sql`
    SELECT count(*)::int AS n FROM trust_wmb
    WHERE worker_id IN (${fixtureIds()})
  `) - wmbBefore;
  const expectedStatusRows = registered ? PEOPLE : 0;
  if (wmbActions !== TOTAL_ACTIONS || statusRows !== expectedStatusRows) {
    throw new Error(
      `${name}: expected ${TOTAL_ACTIONS} WMB actions and ${expectedStatusRows} status rows; observed ${wmbActions} and ${statusRows}`,
    );
  }
  return {
    name,
    sourcePayloadBefore: payloadBefore,
    wmbActions,
    affectedWorkers: registered ? PEOPLE : 0,
    statusRows,
    generationDelta: generationNow - beforeGeneration,
    seconds, perSecond: wmbActions / seconds, sql: capture.counts,
  };
}

/** Run the production bounded drainer against this isolated plugin config. */
async function drainBounded(result: Result): Promise<void> {
  const started = performance.now();
  const summary = await recomputeStaleDenorm({
    pluginId: "worker-benefit-role-history",
    limit: 5_000,
  });
  const seconds = (performance.now() - started) / 1000;
  if (summary.totalRecomputed !== PEOPLE) {
    throw new Error(`bounded drain expected ${PEOPLE} rows, recomputed ${summary.totalRecomputed}`);
  }
  const payloadRows = await number(sql`
    SELECT count(*)::int AS n FROM worker_benefit_role_history_denorm
    WHERE worker_id IN (${fixtureIds()})
  `);
  if (payloadRows !== PEOPLE) {
    throw new Error(`bounded drain expected ${PEOPLE} payload rows, found ${payloadRows}`);
  }
  result.drain = {
    claimed: summary.totalRecomputed, seconds,
    payloadRows,
    projectionSeconds: seconds * (30_000 / PEOPLE),
  };
}

async function cleanupAbandoned(): Promise<void> {
  const ids = sql`
    SELECT w.id FROM workers w INNER JOIN contacts c ON c.id = w.contact_id
    WHERE c.display_name LIKE ${"__worker-benefit-role-history-bench-%"}
  `;
  await db.execute(sql`DELETE FROM denorm WHERE entity_id IN (${ids})`);
  await db.execute(sql`DELETE FROM trust_wmb WHERE worker_id IN (${ids})`);
  await db.execute(sql`DELETE FROM workers WHERE id IN (${ids})`);
  await db.execute(sql`DELETE FROM contacts WHERE display_name LIKE ${"__worker-benefit-role-history-bench-%"}`);
  await db.execute(sql`DELETE FROM employers WHERE name LIKE ${"__worker-benefit-role-history-bench-%"}`);
  await db.execute(sql`DELETE FROM trust_benefits WHERE name LIKE ${"__worker-benefit-role-history-bench-%"}`);
  await db.execute(sql`
    DELETE FROM plugin_configs
    WHERE plugin_kind = 'denorm'
      AND plugin_id = 'worker-benefit-role-history'
      AND name LIKE ${"__worker-benefit-role-history-bench-%"}
  `);
}

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM denorm WHERE entity_id IN (${fixtureIds()})`);
  await db.execute(sql`DELETE FROM trust_wmb WHERE worker_id IN (${fixtureIds()})`);
  await db.execute(sql`DELETE FROM workers WHERE id IN (${fixtureIds()})`);
  await db.execute(sql`DELETE FROM contacts WHERE display_name LIKE ${marker + "%"}`);
  if (employerId) await db.delete(employers).where(eq(employers.id, employerId));
  if (benefitIds.length) await db.delete(trustBenefits).where(sql`${trustBenefits.id} IN (${sql.join(benefitIds.map((id) => sql`${id}`), sql`, `)})`);
  if (createdConfig && configId) await db.delete(pluginConfigs).where(eq(pluginConfigs.id, configId));
}

async function main(): Promise<void> {
  await cleanupAbandoned();
  await loadComponentCache();
  const [existing] = await db.select({ id: pluginConfigs.id }).from(pluginConfigs)
    .where(and(eq(pluginConfigs.pluginKind, "denorm"), eq(pluginConfigs.pluginId, "worker-benefit-role-history")))
    .limit(1);
  if (existing) throw new Error("Benchmark requires an isolated DB with no existing worker-benefit-role-history config.");
  const [employer] = await db.insert(employers)
    .values({ name: `${marker} employer`, siriusId: `${marker}-employer`, isActive: true }).returning();
  employerId = employer.id;
  benefitIds = (await db.insert(trustBenefits).values(
    Array.from({ length: BENEFITS_PER_PERSON }, (_, i) => ({
      name: `${marker} benefit ${i + 1}`, siriusId: `${marker}-benefit-${i + 1}`,
    })),
  ).returning()).map((row) => row.id);
  await db.execute(sql`
    WITH c AS (
      INSERT INTO contacts (display_name)
      SELECT ${marker} || gs::text FROM generate_series(1, ${PEOPLE}) gs
      RETURNING id
    ) INSERT INTO workers (contact_id) SELECT id FROM c
  `);
  workerIds = (await db.select({ id: workers.id }).from(workers)
    .innerJoin(contacts, eq(workers.contactId, contacts.id))
    .where(sql`${contacts.displayName} LIKE ${marker + "%"}`)).map((row) => row.id);
  if (workerIds.length !== PEOPLE) throw new Error(`seeded ${workerIds.length}, expected ${PEOPLE}`);

  // Genuine no-config baseline: WMB storage reaches its normal collector
  // flush, which looks for the absent config and does no enqueue.
  const results: Result[] = [];
  results.push(await writeCase("no-config/fresh", false, 1));
  const [created] = await db.insert(pluginConfigs).values({
    pluginKind: "denorm",
    pluginId: "worker-benefit-role-history",
    enabled: true,
    name: `${marker} isolated benchmark config`,
    data: {},
  }).returning();
  configId = created.id;
  createdConfig = true;
  const registeredFresh = await writeCase("registered/fresh", true, 2);
  await drainBounded(registeredFresh);
  results.push(registeredFresh);
  // Regression: a disabled config still captures this real source mutation;
  // after re-enable the production drainer must materialize it.
  await db.update(pluginConfigs).set({ enabled: false }).where(eq(pluginConfigs.id, configId));
  const disabledPopulated = await writeCase("disabled/payload-populated", true, 3);
  await db.update(pluginConfigs).set({ enabled: true }).where(eq(pluginConfigs.id, configId));
  await drainBounded(disabledPopulated);
  results.push(disabledPopulated);
  const registeredPopulated = await writeCase("registered/payload-populated", true, 4);
  // Its payload was already populated before this source mutation; no third
  // drain is needed to establish the populated-path comparison.
  results.push(registeredPopulated);

  const report = [
    "# Worker Benefit Role History Corrective-Scan Benchmark", "",
    `Run: ${new Date().toISOString()}`,
    `Fixture: ${PEOPLE.toLocaleString()} isolated synthetic workers × ${BENEFITS_PER_PERSON} benefits = ${TOTAL_ACTIONS.toLocaleString()} WMB actions/case; ${CONCURRENCY} concurrent per-person scan transactions. Relationship-backed fraction: 0% (own coverage only, to isolate corrective write overhead).`, "",
    "Each person uses the real production scope: `runInTransaction` → `withWmbBenefitRoleHistoryInvalidationBatch` → `withWmbScanWrites` → `runInSavepoint(createWorkerBenefit)` per action. Thus each person commits independently; no case uses an enormous scan transaction. SQL counts are measured by a temporary node-postgres Client.query wrapper during the timed case.", "",
    "| case | payload rows before | WMB actions | affected workers | status rows | generation delta | elapsed | throughput | measured SQL calls | exact bounded drain |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...results.map((r) => `| ${r.name} | ${r.sourcePayloadBefore.toLocaleString()} | ${r.wmbActions.toLocaleString()} | ${r.affectedWorkers.toLocaleString()} | ${r.statusRows.toLocaleString()} | ${r.generationDelta.toLocaleString()} | ${r.seconds.toFixed(2)} s | ${r.perSecond.toFixed(1)}/s | ${Object.entries(r.sql).map(([k, v]) => `${k}=${v}`).join(", ")} | ${r.drain ? `${r.drain.claimed}/5,000 limit in ${r.drain.seconds.toFixed(2)} s; ${r.drain.payloadRows.toLocaleString()} payload rows; ${r.drain.projectionSeconds.toFixed(1)} s compute projection for 30,000 rows` : "not sampled"} |`),
    "",
    "Baseline semantics: the initial `no-config` case runs before the isolated benchmark config exists, so WMB storage executes its production config lookup, finds no config, and does no enqueue. The script refuses to run if an installed role-history config exists; it creates and removes only its uniquely named fixture config. The disabled case intentionally retains its pending markers, then proves re-enable plus the real drainer applies them.",
    "",
    "Drain math: each projection linearly scales one real `recomputeStaleDenorm({ pluginId, limit: 5000 })` run against this isolated 3,000-row config. It does not multiply a multi-pass elapsed time. At a 5,000-row/ten-minute shared tick bound, a 30,000-worker status backlog needs six slots (about 50 minutes until slot six starts), plus its measured final-slice compute time.",
    "",
    "Fixture cleanup deletes source WMB, status, payload, workers, contacts, employer, and benefits in finally. Companion integration tests cover own/grantor/dependent/both/backdated/deleted relation semantics, rollback, claim conflict/recovery, rebuild parity, and FK cascades.", "",
  ].join("\n");
  mkdirSync("reports", { recursive: true });
  writeFileSync(join("reports", "worker-benefit-role-history-benchmark.md"), report);
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try { await cleanup(); } finally { await pgPool.end(); }
});