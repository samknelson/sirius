import { and, eq, gt, or, type SQL, type InferSelectModel } from "drizzle-orm";
import { contacts, employers, trustBenefits, trustWmb, workerRelations, workers } from "@shared/schema";
import type { TrustProviderEdiContext } from "./registry";
import { coverageKey } from "./coverage-choices";
import { CoverageBudget, COVERAGE_LIMITS } from "./coverage-budget";

export type CoverageCoordinate = { workerId: string; benefitId: string; year: number; month: number };
const columns = {
  id: trustWmb.id, workerId: trustWmb.workerId, benefitId: trustWmb.benefitId,
  year: trustWmb.year, month: trustWmb.month, employerId: trustWmb.employerId,
  sourceRelationId: trustWmb.sourceRelationId, employerSiriusId: employers.siriusId,
  employerLabel: employers.name, benefitLabel: trustBenefits.name,
  given: contacts.given, family: contacts.family, workerSiriusId: workers.siriusId,
};
export type CoverageEvidenceRow = InferSelectModel<typeof trustWmb> & {
  employerSiriusId: string | null; employerLabel: string | null;
  benefitLabel: string | null; given: string | null; family: string | null; workerSiriusId: string | null;
};
export const coordinateWhere = (r: CoverageCoordinate, children = false) => and(
  eq(children ? workerRelations.worker1 : trustWmb.workerId, r.workerId),
  eq(trustWmb.benefitId, r.benefitId), eq(trustWmb.year, r.year), eq(trustWmb.month, r.month),
);

/** Loads only requested person/benefit/month groups, never installation history.
 * All conflicting candidates are kept. Pagination bounds each driver result;
 * the budget separately bounds retained evidence, including duplicate sources. */
export function coverageReader(ctx: TrustProviderEdiContext, budget: CoverageBudget) {
  const groups = new Map<string, CoverageEvidenceRow[]>();
  const relationMap = new Map<string, typeof workerRelations.$inferSelect>();
  const loaded = new Set<string>();
  const seen = new Set<string>();
  const childrenLoaded = new Set<string>();
  const children = new Map<string, Set<string>>();
  async function read(where: SQL | undefined) {
    let cursor: string | undefined;
    for (;;) {
      budget.check();
      const started = performance.now();
      budget.log("database-start", "Coverage page");
      const page = await ctx.storage.readOnly.query(db => db.select({
        ...columns, relation: workerRelations,
      }).from(trustWmb)
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
        .leftJoin(workers, eq(trustWmb.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(workerRelations, eq(trustWmb.sourceRelationId, workerRelations.id))
        .where(and(where, cursor ? gt(trustWmb.id, cursor) : undefined))
        .orderBy(trustWmb.id).limit(COVERAGE_LIMITS.page),
      { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
      budget.log("database-end", "Coverage page", { count: page.length, milliseconds: Math.round(performance.now() - started) });
      for (const { relation, ...row } of page) {
        if (seen.has(row.id)) continue;
        budget.retain(row);
        seen.add(row.id);
        const key = coverageKey(row);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
        if (relation) {
          if (!relationMap.has(relation.id)) budget.retain(relation);
          relationMap.set(relation.id, relation);
          const parent = coverageKey({ ...row, workerId: relation.worker1 });
          const childKeys = children.get(parent) ?? new Set<string>();
          childKeys.add(key);
          children.set(parent, childKeys);
        }
      }
      await budget.yield(groups.size);
      if (page.length < COVERAGE_LIMITS.page) break;
      cursor = page[page.length - 1].id;
    }
  }
  async function ensure(coordinates: readonly CoverageCoordinate[], family = false) {
    const cache = family ? childrenLoaded : loaded;
    const fresh = new Map<string, CoverageCoordinate>();
    for (const r of coordinates) if (!cache.has(coverageKey(r))) fresh.set(coverageKey(r), r);
    const pending = [...fresh.values()];
    for (let i = 0; i < pending.length; i += 100) {
      const batch = pending.slice(i, i + 100);
      await read(or(...batch.map(r => coordinateWhere(r, family))));
      for (const r of batch) cache.add(coverageKey(r));
      budget.check(loaded.size + childrenLoaded.size);
    }
  }
  return { groups, relationMap, children, read, ensure };
}
