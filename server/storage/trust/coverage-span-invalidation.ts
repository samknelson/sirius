import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  coverageReadinessWork,
  denorm,
  pluginConfigs,
  workerRelations,
  trustWmbScanQueue,
} from "@shared/schema";
import { COVERAGE_SPAN_PLUGIN } from "@shared/coverage-span";
import { getClient } from "../transaction-context";
import { enqueueDenormInvalidations } from "../system/denorm-invalidation";
import { tableExists } from "../utils";

export const COVERAGE_READINESS_OPERATIONS = [
  "role_history_source_change",
  "termination_evidence_change",
  "scan_month_reset",
  "scan_worker_requeue",
  "scan_worker_reset",
  "scan_worker_bulk_reset",
  "scan_completion_inferred_evidence",
  "wmb_scan_completion_handoff",
  "migration_termination_reconciliation",
  "employer_classification_change",
] as const;

export type CoverageReadinessOperation = typeof COVERAGE_READINESS_OPERATIONS[number];

/** Increment the one aggregate counter for a config/operation pair. */
export async function recordCoverageReadinessWork(
  configId: string,
  operation: CoverageReadinessOperation,
  affectedCount: number,
): Promise<void> {
  if (affectedCount <= 0) return;
  const db = getClient();
  await db.insert(coverageReadinessWork).values({
    configId,
    operation,
    callCount: 1,
    affectedCount,
    lastAffectedCount: affectedCount,
    lastAt: new Date(),
  }).onConflictDoUpdate({
    target: [coverageReadinessWork.configId, coverageReadinessWork.operation],
    set: {
      callCount: sql`${coverageReadinessWork.callCount} + 1`,
      affectedCount: sql`${coverageReadinessWork.affectedCount} + excluded.affected_count`,
      lastAffectedCount: sql`excluded.last_affected_count`,
      lastAt: sql`excluded.last_at`,
    },
  });
}

/** Capture before reset/deletion, with row locks held through invalidation. */
export async function captureCoverageScanReceivers(where: SQL): Promise<string[]> {
  const rows = await getClient().select({
    workerId: trustWmbScanQueue.workerId, resultSummary: trustWmbScanQueue.resultSummary,
  }).from(trustWmbScanQueue).where(where).for("update");
  const receivers = new Set<string>();
  for (const row of rows) {
    receivers.add(row.workerId);
    const summary = row.resultSummary as { people?: unknown; actions?: unknown } | null;
    for (const entries of [summary?.people, summary?.actions]) if (Array.isArray(entries)) {
      for (const person of entries)
        if (person && typeof person.workerId === "string" && person.workerId) receivers.add(person.workerId);
    }
  }
  return [...receivers].sort();
}

/** Same source transaction; disabled processing still retains invalidations. */
export async function enqueueCoverageSpanInvalidations(
  workerIds: string[],
  operation: CoverageReadinessOperation,
): Promise<void> {
  const ids = [...new Set(workerIds.filter(Boolean))];
  if (!ids.length) return;
  const db = getClient();
  const configs = await db.select({ id: pluginConfigs.id }).from(pluginConfigs)
    .where(and(eq(pluginConfigs.pluginKind, "denorm"), eq(pluginConfigs.pluginId, COVERAGE_SPAN_PLUGIN)));
  if (!configs.length) return; // Initial population is authoritative backfill.
  // A subscriber's correction also changes every dependent's family evidence.
  const dependents = await tableExists("worker_relations")
    ? await db.select({ id: workerRelations.worker2 }).from(workerRelations)
      .where(inArray(workerRelations.worker1, ids))
    : [];
  const receivers = [...new Set([...ids, ...dependents.map(r => r.id)])].sort();
  for (const config of configs) {
    const affected = await enqueueDenormInvalidations(receivers.map(entityId => ({
      entityId,
      entityType: "worker",
      configId: config.id,
    })));
    await recordCoverageReadinessWork(config.id, operation, affected);
  }
}

/** Delete the status spine in the source deletion transaction; payloads cascade. */
export async function deleteCoverageSpansForWorkers(workerIds: string[]): Promise<void> {
  if (!workerIds.length) return;
  const db = getClient();
  await db.delete(denorm).where(and(inArray(denorm.entityId, workerIds),
    inArray(denorm.configId, db.select({ id: pluginConfigs.id }).from(pluginConfigs)
      .where(and(eq(pluginConfigs.pluginKind, "denorm"), eq(pluginConfigs.pluginId, COVERAGE_SPAN_PLUGIN))))));
}
