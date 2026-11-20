import { sql, type SQL } from "drizzle-orm";
import type { TrustProviderEdiContext } from "../../plugins/trust/provider-edi/registry";
import { COVERAGE_LIMITS } from "../../plugins/trust/provider-edi/coverage-budget";

/** Legacy comparison baseline ONLY. Runtime feeds use maintained readiness. */
export class SourceCoverageEventsNotReadyError extends Error {
  constructor(message: string) {
    super(`Coverage lifecycle events are not ready: ${message} No file was generated and no dates were estimated.`);
    this.name = "SourceCoverageEventsNotReadyError";
  }
}
export async function assertSourceCoverageEventsReady(
  ctx: TrustProviderEdiContext, benefitIds: readonly string[],
  firstMonth: number, lastMonth: number, terminations: boolean,
): Promise<{ population: number }> {
  const required = [{ pluginId: "trust-wmb-restart", label: "coverage start (restart) events" },
    ...(terminations ? [{ pluginId: "trust-wmb-terminate", label: "coverage end (terminate) events" }] : [])];
  const configs: { id: string; label: string }[] = [];
  for (const { pluginId, label } of required) {
    const [config] = await ctx.storage.pluginConfigs.getByKindAndPlugin("denorm", pluginId);
    if (!config?.enabled) throw new SourceCoverageEventsNotReadyError(`maintenance of ${label} is unavailable.`);
    if (!(await ctx.storage.denorm.countByStatusForConfig(config.id)).total)
      throw new SourceCoverageEventsNotReadyError(`maintenance of ${label} has not processed anyone yet.`);
    configs.push({ id: config.id, label });
  }
  const months: SQL[] = [];
  for (let year = Math.floor(firstMonth / 12); year <= Math.floor(lastMonth / 12); year++) {
    const values = [];
    for (let month = Math.max(firstMonth, year * 12); month <= Math.min(lastMonth, year * 12 + 11); month++)
      values.push(sql`${month % 12 + 1}`);
    months.push(sql`(w.year = ${year} AND w.month IN (${sql.join(values, sql`, `)}))`);
  }
  const result = await ctx.storage.readOnly.query(db => db.execute(sql`
    WITH population AS (
      SELECT DISTINCT w.worker_id FROM trust_wmb w
      WHERE w.benefit_id IN (${sql.join(benefitIds.map(id => sql`${id}`), sql`, `)})
        AND (${sql.join(months, sql` OR `)})
    )
    SELECT c.config_id, count(*)::int AS population,
      (count(*) FILTER (WHERE d.id IS NULL))::int AS missing,
      (count(*) FILTER (WHERE d.status = 'stale'))::int AS pending,
      (count(*) FILTER (WHERE d.status = 'error'))::int AS failed
    FROM population p CROSS JOIN (VALUES ${sql.join(configs.map(c => sql`(${c.id})`), sql`, `)}) AS c(config_id)
    LEFT JOIN denorm d ON d.entity_id = p.worker_id AND d.config_id = c.config_id
    GROUP BY c.config_id`), { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
  const rows = result.rows as { config_id: string; population: number; missing: number; pending: number; failed: number }[];
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
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
  if (problems.length) throw new SourceCoverageEventsNotReadyError(`of ${people(population)} in this run, ${problems.join("; ")}.`);
  return { population };
}
