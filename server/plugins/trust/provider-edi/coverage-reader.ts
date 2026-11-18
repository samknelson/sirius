import { and, eq, gt, inArray, sql, type SQL, type InferSelectModel } from "drizzle-orm";
import { contacts, employers, trustBenefits, trustWmb, workerRelations, workers } from "@shared/schema";
import type { TrustProviderEdiContext } from "./registry";
import { coverageKey, type CoverageRelation } from "./coverage-choices";
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
  const relationMap = new Map<string, CoverageRelation>();
  const relationsLoaded = new Set<string>();
  const loaded = new Set<string>();
  const seen = new Set<string>();
  const childrenLoaded = new Set<string>();
  const children = new Map<string, Set<string>>();
  async function read(where: SQL | undefined, family = false) {
    let cursor: string | undefined;
    for (;;) {
      budget.check();
      const started = performance.now();
      budget.log("database-start", "Coverage page");
      const page = await ctx.storage.readOnly.query(db => db.select(columns).from(trustWmb)
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
        .leftJoin(workers, eq(trustWmb.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(workerRelations, eq(trustWmb.sourceRelationId, workerRelations.id))
        .where(and(where, cursor ? gt(trustWmb.id, cursor) : undefined))
        .orderBy(trustWmb.id).limit(COVERAGE_LIMITS.page),
      { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
      budget.log("database-end", "Coverage page", { count: page.length, milliseconds: Math.round(performance.now() - started) });
      // Relations are shared across many history months. Read/digest each once,
      // including caching missing ids; never transfer arbitrary metadata.
      const relationIds = [...new Set(page.map(r => r.sourceRelationId)
        .filter((id): id is string => !!id && !relationsLoaded.has(id)))];
      if (relationIds.length) {
        budget.log("database-start", "Family relations");
        const relations = await ctx.storage.readOnly.query(db => db.select({
          id: workerRelations.id, worker1: workerRelations.worker1, worker2: workerRelations.worker2,
          relationType: workerRelations.relationType, startYmd: workerRelations.startYmd, endYmd: workerRelations.endYmd,
          dataFingerprint: sql<string>`encode(sha256(convert_to(coalesce(${workerRelations.data}::text, 'null'), 'UTF8')), 'hex')`,
        }).from(workerRelations).where(inArray(workerRelations.id, relationIds)),
        { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
        for (const relation of relations) {
          budget.retain(relation);
          relationMap.set(relation.id, relation);
        }
        for (const id of relationIds) relationsLoaded.add(id);
        budget.log("database-end", "Family relations", { count: relations.length });
      }
      for (const row of page) {
        // Direct queries request complete coordinates (including every source).
        // A family query proves only that parent's children, NOT all sources of
        // a child's coordinate. Do not cache that partial answer as complete.
        if (!family) loaded.add(coverageKey(row));
        if (seen.has(row.id)) continue;
        budget.retain(row);
        seen.add(row.id);
        const key = coverageKey(row);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
        const relation = row.sourceRelationId && relationMap.get(row.sourceRelationId);
        if (relation) {
          const parent = coverageKey({ ...row, workerId: relation.worker1 });
          const childKeys = children.get(parent) ?? new Set<string>();
          childKeys.add(key);
          children.set(parent, childKeys);
        }
      }
      await budget.yield(loaded.size + childrenLoaded.size + groups.size);
      if (page.length < COVERAGE_LIMITS.page) break;
      cursor = page[page.length - 1].id;
    }
  }
  async function ensure(coordinates: readonly CoverageCoordinate[], family = false) {
    const cache = family ? childrenLoaded : loaded;
    const batch = new Map<string, CoverageCoordinate>();
    const flush = async () => {
      // A bounded VALUES relation avoids both one query per tiny batch and a
      // thousand-deep OR expression. Match exact tuples, never a cross product.
      const coordinates = [...batch.values()];
      const values = coordinates.map(r =>
        sql`(${r.workerId}::varchar, ${r.benefitId}::varchar, ${r.year}::int, ${r.month}::int)`);
      await read(and(
        // Expose the selective month/year prefix to PostgreSQL's existing WMB
        // index; tuple semi-joins alone can choose an all-history PK scan.
        inArray(trustWmb.year, [...new Set(coordinates.map(r => r.year))]),
        inArray(trustWmb.month, [...new Set(coordinates.map(r => r.month))]),
        inArray(trustWmb.benefitId, [...new Set(coordinates.map(r => r.benefitId))]),
        sql`(${family ? workerRelations.worker1 : trustWmb.workerId},
        ${trustWmb.benefitId}, ${trustWmb.year}, ${trustWmb.month})
        IN (VALUES ${sql.join(values, sql`, `)})`), family);
      // Empty coordinates are authoritative answers too.
      for (const key of batch.keys()) cache.add(key);
      batch.clear();
      budget.check(loaded.size + childrenLoaded.size + groups.size);
    };
    for (const r of coordinates) {
      const key = coverageKey(r);
      if (cache.has(key)) continue;
      batch.set(key, r);
      if (batch.size === COVERAGE_LIMITS.page) await flush();
    }
    if (batch.size) await flush();
  }
  return { groups, relationMap, children, read, ensure };
}
