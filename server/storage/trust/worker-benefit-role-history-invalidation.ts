import { and, eq, inArray } from "drizzle-orm";
import { pluginConfigs, workerRelations } from "@shared/schema";
import { getClient } from "../transaction-context";
import { tableExists } from "../utils";
import { enqueueDenormInvalidations } from "../system/denorm-invalidation";

const PLUGIN_ID = "worker-benefit-role-history";

export interface RoleHistoryWmbSource {
  workerId: string;
  sourceRelationId: string | null;
}

/**
 * Add every receiver and current grantor represented by WMB source rows.
 * Call before a cascading delete: after the source rows are gone, the
 * relationship direction needed to invalidate the grantor is no longer
 * recoverable.
 */
export async function affectedWorkerBenefitRoleHistoryWorkers(
  wmbSources: RoleHistoryWmbSource[],
): Promise<string[]> {
  const workerIds = new Set(wmbSources.map((row) => row.workerId).filter(Boolean));
  const relationIds = Array.from(
    new Set(wmbSources.map((row) => row.sourceRelationId).filter((id): id is string => !!id)),
  );
  if (relationIds.length && await tableExists("worker_relations")) {
    const client = getClient();
    const grantors = await client
      .select({ workerId: workerRelations.worker1 })
      .from(workerRelations)
      .where(inArray(workerRelations.id, relationIds));
    grantors.forEach((row) => workerIds.add(row.workerId));
  }
  return [...workerIds];
}

/**
 * Persist the shared role-history invalidation protocol using the ambient
 * transaction. All WMB, relationship, and cascade producers use this one
 * operation so a new generation also cancels any in-flight recomputation.
 */
export async function enqueueWorkerBenefitRoleHistoryInvalidations(
  workerIds: string[],
): Promise<void> {
  const ids = Array.from(new Set(workerIds.filter(Boolean)));
  if (!ids.length) return;
  const client = getClient();
  const [config] = await client
    .select({ id: pluginConfigs.id })
    .from(pluginConfigs)
    .where(
      and(
        eq(pluginConfigs.pluginKind, "denorm"),
        eq(pluginConfigs.pluginId, PLUGIN_ID),
      ),
    )
    .limit(1);
  // A plugin config is bootstrapped with its singleton registration. If a
  // deployment has not enabled it yet, the retained-source backfill creates
  // the history once it does; no payload write is attempted here.
  if (!config) return;
  await enqueueDenormInvalidations(
    ids.map((entityId) => ({ entityId, entityType: "worker", configId: config.id })),
  );
}