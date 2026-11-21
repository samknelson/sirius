import { sql } from "drizzle-orm";
import { COVERAGE_SPAN_PLUGIN } from "@shared/coverage-span";
import type { TrustProviderEdiContext } from "./registry";
import { COVERAGE_LIMITS } from "./coverage-budget";
import { isComponentEnabledSync } from "../../../services/component-cache";

export class CoverageEventsNotReadyError extends Error {
  constructor(message: string) {
    super(`Coverage spans are not ready: ${message} No file was generated and no dates were estimated.`);
    this.name = "CoverageEventsNotReadyError";
  }
}

/**
 * Workers are the producer's authoritative backfill population. In particular,
 * zero payload rows cannot stand in for an unprocessed or failed worker.
 * Requiring the entire producer population also catches deleted last-source
 * rows and changed subscriber families, which a report-month WMB join misses.
 */
export async function assertCoverageEventsReady(
  ctx: TrustProviderEdiContext, _benefitIds: readonly string[],
  _firstMonth: number, _lastMonth: number, terminations: boolean,
): Promise<{ population: number; revision: string }> {
  if (!isComponentEnabledSync("trust.benefits"))
    throw new CoverageEventsNotReadyError("The benefits component is disabled or unavailable.");
  const required = [COVERAGE_SPAN_PLUGIN, ...(terminations ? ["trust-wmb-terminate"] : [])];
  const revisions: string[] = [];
  let population = 0;
  for (const pluginId of required) {
  const configs = await ctx.storage.pluginConfigs.getByKindAndPlugin("denorm", pluginId);
  if (configs.length !== 1 || !configs[0].enabled)
    throw new CoverageEventsNotReadyError(`Maintenance must have exactly one enabled configuration for ${pluginId}. Ask an administrator to check denormalization settings.`);
  const config = configs[0];
  const result = await ctx.storage.readOnly.query(db => db.execute(sql`
    SELECT count(*)::int AS population,
      count(*) FILTER (WHERE d.id IS NULL)::int AS missing,
      count(*) FILTER (WHERE d.status = 'stale')::int AS stale,
      count(*) FILTER (WHERE d.status = 'error')::int AS failed,
      md5(coalesce(string_agg(w.id || ':' || coalesce(d.generation::text, 'missing'), ',' ORDER BY w.id), '')) AS revision
    FROM workers w LEFT JOIN denorm d ON d.entity_id = w.id
      AND d.entity_type = 'worker' AND d.config_id = ${config.id}
  `), { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
  const row = result.rows[0] as { population: number; missing: number; stale: number; failed: number; revision: string };
  if (row.missing || row.stale || row.failed) {
    throw new CoverageEventsNotReadyError(
      `${pluginId}: ${row.population} people in the maintenance population: ${row.missing} awaiting initial backfill, ${row.stale} stale or processing, ${row.failed} failed. ` +
      "Refresh this configuration's denorm counts. Backfill only missing initial records; recompute stale records (upstream termination events before coverage spans). Failed records need administrator review before retrying.");
  }
  population = Number(row.population);
  revisions.push(`${config.id}:${row.revision}`);
  }
  return { population, revision: revisions.join("|") };
}

export function staleStartsError(missing: number, inconsistent: number): CoverageEventsNotReadyError {
  return new CoverageEventsNotReadyError(
    `${missing} people have missing coverage spans and ${inconsistent} have inconsistent evidence. Rebuild their coverage spans and retry.`);
}
