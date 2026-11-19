import { sql } from "drizzle-orm";
import { denorm, trustWmb } from "@shared/schema";
import type { TrustProviderEdiContext } from "./registry";
import { COVERAGE_LIMITS } from "./coverage-budget";

/**
 * Coverage start dates and endings come from lifecycle events, so a feed may
 * use them only while event maintenance is switched on and has caught up for
 * the people in this run. Anything else refuses with a count: a late event
 * means a wrong date in a carrier file, never a slow one.
 */
const MAINTENANCE = {
  restart: { pluginId: "trust-wmb-restart", label: "coverage start (restart) events" },
  terminate: { pluginId: "trust-wmb-terminate", label: "coverage end (terminate) events" },
} as const;

export class CoverageEventsNotReadyError extends Error {
  constructor(message: string) {
    super(`Coverage lifecycle events are not ready: ${message} No file was generated and no dates were estimated.`);
    this.name = "CoverageEventsNotReadyError";
  }
}

const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/**
 * `firstMonth`..`lastMonth` are month indexes: the reporting month, widened to
 * the termination window when the run reports endings.
 */
export async function assertCoverageEventsReady(
  ctx: TrustProviderEdiContext, benefitIds: readonly string[],
  firstMonth: number, lastMonth: number, terminations: boolean,
): Promise<{ population: number }> {
  const required = terminations ? [MAINTENANCE.restart, MAINTENANCE.terminate] : [MAINTENANCE.restart];
  const configs: { id: string; label: string }[] = [];
  for (const { pluginId, label } of required) {
    const [config] = await ctx.storage.pluginConfigs.getByKindAndPlugin("denorm", pluginId);
    if (!config || !config.enabled) throw new CoverageEventsNotReadyError(
      `maintenance of ${label} is ${config ? "switched off" : "not set up"}. Ask an administrator to enable it under denormalization settings and let it finish, then check again.`);
    // Site-wide status answers the cheapest question first: has it ever run?
    const counts = await ctx.storage.denorm.countByStatusForConfig(config.id);
    if (!counts.total) throw new CoverageEventsNotReadyError(
      `maintenance of ${label} has not processed anyone yet. Wait for it to finish, then check again.`);
    configs.push({ id: config.id, label });
  }
  // Whether THIS run's people are ready is a feed question, so it stays here.
  const benefits = sql.join(benefitIds.map(id => sql`${id}`), sql`, `);
  const configValues = sql.join(configs.map(c => sql`(${c.id})`), sql`, `);
  // Keep the calendar columns bare: arithmetic on year/month forces a history
  // scan even when the deployed WMB unique index starts with (month, year).
  // Exact month values allow bounded index probes, including across New Year.
  const months = [];
  for (let year = Math.floor(firstMonth / 12); year <= Math.floor(lastMonth / 12); year++) {
    const values = [];
    for (let month = Math.max(firstMonth, year * 12); month <= Math.min(lastMonth, year * 12 + 11); month++) {
      values.push(sql`${month % 12 + 1}`);
    }
    months.push(sql`(w.year = ${year} AND w.month IN (${sql.join(values, sql`, `)}))`);
  }
  const window = sql.join(months, sql` OR `);
  const result: unknown = await ctx.storage.readOnly.query(db => db.execute(sql`
    WITH population AS (
      SELECT DISTINCT w.worker_id FROM ${trustWmb} w
      WHERE w.benefit_id IN (${benefits})
        AND (${window})
    )
    SELECT c.config_id,
           count(*)::int AS population,
           (count(*) FILTER (WHERE d.id IS NULL))::int AS missing,
           (count(*) FILTER (WHERE d.status = 'stale'))::int AS pending,
           (count(*) FILTER (WHERE d.status = 'error'))::int AS failed
    FROM population p CROSS JOIN (VALUES ${configValues}) AS c(config_id)
    LEFT JOIN ${denorm} d ON d.entity_id = p.worker_id AND d.config_id = c.config_id
    GROUP BY c.config_id`), { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as
    { config_id: string; population: number; missing: number; pending: number; failed: number }[];
  const problems: string[] = [];
  let population = 0;
  for (const config of configs) {
    const row = rows.find(r => r.config_id === config.id);
    if (!row) continue;
    population = Math.max(population, Number(row.population));
    const parts = [
      Number(row.missing) ? `missing for ${people(Number(row.missing))}` : "",
      Number(row.pending) ? `pending for ${people(Number(row.pending))}` : "",
      Number(row.failed) ? `failed for ${people(Number(row.failed))}` : "",
    ].filter(Boolean);
    if (parts.length) problems.push(`${config.label} are ${parts.join(", ")}`);
  }
  if (problems.length) throw new CoverageEventsNotReadyError(
    `of ${people(population)} in this run, ${problems.join("; ")}. Wait for lifecycle event maintenance to finish (failed records need an administrator to review the denormalization status), then check again.`);
  return { population };
}

/** Events that exist but disagree with the coverage they describe. */
export function staleStartsError(missing: number, inconsistent: number): CoverageEventsNotReadyError {
  const parts = [
    missing ? `${people(missing)} in this run ${missing === 1 ? "has" : "have"} no coverage start event` : "",
    inconsistent ? `${people(inconsistent)} ${inconsistent === 1 ? "has" : "have"} a coverage start event that is behind their coverage records` : "",
  ].filter(Boolean);
  return new CoverageEventsNotReadyError(`${parts.join("; ")}. Wait for lifecycle event maintenance to finish, then check again.`);
}
