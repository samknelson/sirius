import { and, eq, inArray } from "drizzle-orm";
import { contacts, employers, optionsTrustBenefitType, trustBenefits, trustWmb, trustWmbEvents, workerRelations, workers } from "@shared/schema";
import type { EdiCoverageCandidate, EdiCoverageDecision } from "@shared/edi-coverage-choices";
import type { TrustProviderEdiContext, TrustProviderEdiPlugin } from "./registry";
import { effectiveBenefitSiriusIds, readAsOfYmd, resolveBenefitIds } from "./base";
import { isEdiCobra } from "./coverage-segments";
import { approveConflict, competingSources, coverageKey, evidenceHash, reviewConflict, type CoverageProjection } from "./coverage-choices";
import { monthEnd, monthIndex, monthStart, readTerminationPolicy, terminationWindow } from "./termination-policy";
import { effectiveMedicalPlanGroupMap } from "./plugins/sitespecific-smf-shared";

/** Shared read-only infrastructure for the wizard's needsReadOnlyDb opt-in. */
export async function discoverCoverage(
  ctx: TrustProviderEdiContext, plugin: TrustProviderEdiPlugin, decisions: readonly EdiCoverageDecision[] = [],
) {
  const benefitIds = await resolveBenefitIds(ctx, effectiveBenefitSiriusIds(ctx, plugin.benefitSiriusIds!));
  const supplemental = plugin.coverageLookup === "medical-groups"
    ? await ctx.storage.readOnly.query(db => db.select({ id: trustBenefits.id }).from(trustBenefits)
      .where(inArray(trustBenefits.siriusId, Object.keys(effectiveMedicalPlanGroupMap(ctx)))))
    : plugin.coverageLookup === "medical-type"
      ? await ctx.storage.readOnly.query(db => db.select({ id: trustBenefits.id }).from(trustBenefits)
        .innerJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id))
        .where(eq(optionsTrustBenefitType.name, String(ctx.configData.medicalBenefitTypeName || "Medical"))))
      : [];
  const allBenefits = [...new Set([...benefitIds, ...supplemental.map(r => r.id)])];
  const rows = await ctx.storage.readOnly.query(db => db.select({
    id: trustWmb.id, workerId: trustWmb.workerId, benefitId: trustWmb.benefitId,
    year: trustWmb.year, month: trustWmb.month, employerId: trustWmb.employerId,
    sourceRelationId: trustWmb.sourceRelationId, employerSiriusId: employers.siriusId,
    employerLabel: employers.name, benefitLabel: trustBenefits.name,
    given: contacts.given, family: contacts.family, workerSiriusId: workers.siriusId,
  }).from(trustWmb).leftJoin(employers, eq(trustWmb.employerId, employers.id))
    .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
    .leftJoin(workers, eq(trustWmb.workerId, workers.id))
    .leftJoin(contacts, eq(workers.contactId, contacts.id))
    .where(inArray(trustWmb.benefitId, allBenefits)));
  const relationIds = [...new Set(rows.flatMap(r => r.sourceRelationId ? [r.sourceRelationId] : []))];
  const relations = relationIds.length ? await ctx.storage.readOnly.query(db =>
    db.select().from(workerRelations).where(inArray(workerRelations.id, relationIds))) : [];
  const relationMap = new Map(relations.map(r => [r.id, r]));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = coverageKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const asOf = readAsOfYmd(ctx);
  const reportMonth = monthIndex(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)));
  const policy = ctx.terminationPolicy ?? readTerminationPolicy(ctx.configData);
  const events = policy.subscribers || policy.dependents
    ? await ctx.storage.readOnly.query(db => db.select().from(trustWmbEvents).where(and(
      inArray(trustWmbEvents.benefitId, benefitIds), eq(trustWmbEvents.eventType, "terminate")))) : [];
  const window = terminationWindow(asOf, policy.months);
  const roots = rows.filter(r => benefitIds.includes(r.benefitId) && monthIndex(r.year, r.month) === reportMonth);
  for (const event of events) {
    const end = monthIndex(event.year, event.month) - 1;
    if (end < window.firstEnd || end > window.lastEnd) continue;
    const history = rows.filter(r => r.workerId === event.workerId && r.benefitId === event.benefitId);
    if (history.some(r => monthIndex(r.year, r.month) > end)) continue; // reinstatement wins
    const previous = history.filter(r => monthIndex(r.year, r.month) === end);
    if (previous.some(r => r.sourceRelationId ? policy.dependents : policy.subscribers)) roots.push(...previous);
  }
  const needed = new Set<string>();
  const childrenByFamily = new Map<string, string[]>();
  for (const row of rows) {
    const relation = row.sourceRelationId && relationMap.get(row.sourceRelationId);
    if (!relation) continue;
    const key = coverageKey({ ...row, workerId: relation.worker1 });
    childrenByFamily.set(key, [...(childrenByFamily.get(key) ?? []), coverageKey(row)]);
  }
  const queue = roots.map(r => ({ key: coverageKey(r), family: true, walk: true }));
  const visited = new Set<string>();
  // Explore all candidate families, not whichever source happens to sort first.
  // Historical segments can extend without a lookback cap; gaps stop traversal.
  for (let i = 0; i < queue.length; i++) {
    const { key, family, walk } = queue[i];
    const visit = `${key}|${family}|${walk}`;
    if (visited.has(visit)) continue;
    visited.add(visit);
    const group = groups.get(key);
    if (!group?.length) continue;
    needed.add(key);
    for (const row of group) {
      const index = monthIndex(row.year, row.month);
      const previous = monthStart(index - 1);
      const previousKey = coverageKey({ ...row, year: +previous.slice(0, 4), month: +previous.slice(5, 7) });
      if (walk) queue.push({ key: previousKey, family: false,
        walk: (groups.get(previousKey) ?? []).some(p => p.sourceRelationId === row.sourceRelationId &&
          isEdiCobra(p.employerSiriusId) === isEdiCobra(row.employerSiriusId)) });
      const relation = row.sourceRelationId && relationMap.get(row.sourceRelationId);
      if (family && relation) queue.push({ key: coverageKey({ ...row, workerId: relation.worker1 }), family: true, walk: true });
      // Family assembly reads all covered children, including historical units.
      if (family) for (const child of childrenByFamily.get(key) ?? [])
        queue.push({ key: child, family: true, walk: true });
      if (family) for (const benefit of supplemental)
        queue.push({ key: coverageKey({ ...row, benefitId: benefit.id }), family: false, walk: false });
    }
  }
  const relevant = rows.filter(r => needed.has(coverageKey(r)));
  const labels = new Map(rows.map(r => [r.workerId, [r.given, r.family].filter(Boolean).join(" ") || r.workerSiriusId || r.workerId]));
  const label = (id: string) => labels.get(id) ?? id;
  const conflicts = [...needed].sort().flatMap(key => {
    const group = groups.get(key)!;
    if (!competingSources(group) && !decisions.some(d => d.key === key)) return [];
    const familyEvidence = group.map(r => {
      const relation = r.sourceRelationId ? relationMap.get(r.sourceRelationId) : null;
      const parents = relation ? groups.get(coverageKey({ ...r, workerId: relation.worker1 })) ?? [] : [];
      return { id: r.id, relation: relation || null, parents: [...parents].sort((a, b) => a.id.localeCompare(b.id)) };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const candidates: EdiCoverageCandidate[] = [...group].sort((a, b) => a.id.localeCompare(b.id)).map(r => {
      const relation = r.sourceRelationId ? relationMap.get(r.sourceRelationId) : null;
      const parents = relation ? groups.get(coverageKey({ ...r, workerId: relation.worker1 })) ?? [] : [];
      const index = monthIndex(r.year, r.month);
      const validFamily = relation && relation.worker2 === r.workerId &&
        (!relation.startYmd || relation.startYmd <= monthEnd(index)) &&
        (!relation.endYmd || relation.endYmd >= monthStart(index)) &&
        parents.some(p => !p.sourceRelationId);
      return { ...r, personLabel: label(r.workerId), benefitLabel: r.benefitLabel || r.benefitId,
        employerLabel: r.employerLabel || r.employerId,
        subscriberWorkerId: r.sourceRelationId ? relation?.worker1 ?? null : r.workerId,
        subscriberLabel: label(r.sourceRelationId ? relation?.worker1 ?? "Missing subscriber" : r.workerId),
        isCobra: isEdiCobra(r.employerSiriusId),
        familyIssue: r.sourceRelationId && !validFamily
          ? `WMB ${r.id}: required family relation or subscriber coverage is missing/inconsistent for this month. Correct source history or select a valid source.` : null };
    });
    return [reviewConflict(candidates, evidenceHash({
      context: { configId: ctx.configId, data: ctx.configData, input: ctx.input, policy },
      candidates, familyEvidence,
    }), decisions)];
  });
  for (const saved of decisions) if (!needed.has(saved.key)) conflicts.push({
    key: saved.key, evidence: evidenceHash({ removed: saved.key }), candidates: [],
    decision: null, stale: true,
  });
  return { conflicts, groups, relationMap, relevant, fingerprint: evidenceHash({
    relevant: [...relevant].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...relations].filter(r => relevant.some(w => w.sourceRelationId === r.id)).sort((a, b) => a.id.localeCompare(b.id)),
    events: [...events].sort((a, b) => a.id.localeCompare(b.id)),
  }) };
}

export function coverageProjection(review: Awaited<ReturnType<typeof discoverCoverage>>): CoverageProjection {
  const unresolved = review.conflicts.filter(c => !c.decision);
  if (unresolved.length) throw new Error(`${unresolved.length} unresolved or stale coverage conflict(s). Open Coverage sources, explicitly select each source and save a reason, then retry generation.`);
  const excludedIds = new Set<string>();
  for (const conflict of review.conflicts) for (const candidate of conflict.candidates)
    if (candidate.id !== conflict.decision!.selectedId) excludedIds.add(candidate.id);
  for (const conflict of review.conflicts) {
    const decision = conflict.decision!;
    approveConflict(conflict, decision as unknown as Record<string, unknown>, decision.decidedBy, decision.decidedAt);
    const chosen = conflict.candidates.find(c => c.id === decision.selectedId)!;
    if (chosen.sourceRelationId) {
      const parents = review.groups.get(coverageKey({ ...chosen, workerId: chosen.subscriberWorkerId! })) ?? [];
      if (!parents.some(p => !p.sourceRelationId && !excludedIds.has(p.id)))
        throw new Error(`WMB ${chosen.id}: selected dependent requires subscriber ${chosen.subscriberWorkerId} for ${chosen.year}-${chosen.month}. Review that family's Coverage sources; subscriber coverage cannot be invented.`);
    }
  }
  // A parent can lose its own subscriber row through another decision even
  // when its child's coverage has only one source and needs no approval.
  for (const row of review.relevant) {
    if (!row.sourceRelationId || excludedIds.has(row.id)) continue;
    const relation = review.relationMap.get(row.sourceRelationId);
    const index = monthIndex(row.year, row.month);
    const parents = relation ? review.groups.get(coverageKey({ ...row, workerId: relation.worker1 })) ?? [] : [];
    if (!relation || relation.worker2 !== row.workerId ||
        (relation.startYmd && relation.startYmd > monthEnd(index)) ||
        (relation.endYmd && relation.endYmd < monthStart(index)) ||
        !parents.some(p => !p.sourceRelationId && !excludedIds.has(p.id))) {
      throw new Error(`WMB ${row.id}: retained dependent ${row.workerId} requires valid subscriber coverage for ${row.year}-${row.month}. Review Coverage sources or correct family history; standalone subscriber coverage cannot be invented.`);
    }
  }
  return { excludedIds, decisions: review.conflicts.map(c => c.decision!), fingerprint: review.fingerprint };
}
