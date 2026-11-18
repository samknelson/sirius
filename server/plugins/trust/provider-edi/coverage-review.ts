import { and, eq, inArray, sql, gt } from "drizzle-orm";
import { optionsTrustBenefitType, trustBenefits, trustWmb, trustWmbEvents } from "@shared/schema";
import type { EdiCoverageCandidate, EdiCoverageDecision } from "@shared/edi-coverage-choices";
import type { TrustProviderEdiContext, TrustProviderEdiPlugin } from "./registry";
import { effectiveBenefitSiriusIds, readAsOfYmd, resolveBenefitIds } from "./base";
import { isEdiCobra } from "./coverage-segments";
import { approveConflict, competingSources, coverageKey, evidenceHash, evidenceHashRecords, reviewConflict, indexCoverageProjection, type CoverageProjection } from "./coverage-choices";
import { monthEnd, monthIndex, monthStart, readTerminationPolicy, terminationWindow } from "./termination-policy";
import { effectiveMedicalPlanGroupMap } from "./plugins/sitespecific-smf-shared";
import { CoverageBudget, COVERAGE_LIMITS } from "./coverage-budget";
import { coverageReader, type CoverageCoordinate } from "./coverage-reader";

let activeDiscovery = false;

/** Shared read-only infrastructure for the wizard's needsReadOnlyDb opt-in. */
export async function discoverCoverage(
  ctx: TrustProviderEdiContext, plugin: TrustProviderEdiPlugin, decisions: readonly EdiCoverageDecision[] = [],
  report: (percent: number | null, details: { phase: string; processed?: number; total?: number }) => Promise<void> = async () => {},
) {
  // Refuse rather than queue evidence in the serving process. This bounds local
  // allocations across wizards; wizard admission separately fences each run.
  if (activeDiscovery) throw new Error("Another coverage evidence check is running on this server. Retry after it finishes.");
  activeDiscovery = true;
  try {
    return await discoverBoundedCoverage(ctx, plugin, decisions, report);
  } finally { activeDiscovery = false; }
}

async function discoverBoundedCoverage(
  ctx: TrustProviderEdiContext, plugin: TrustProviderEdiPlugin, decisions: readonly EdiCoverageDecision[],
  report: (percent: number | null, details: { phase: string; processed?: number; total?: number }) => Promise<void>,
) {
  const budget = new CoverageBudget();
  let stageStart = performance.now();
  let phase = "Resolving benefits";
  const stage = async (next: string) => {
    budget.log("phase-end", phase, { milliseconds: Math.round(performance.now() - stageStart) });
    phase = next;
    stageStart = performance.now();
    budget.log("phase-start", phase);
    budget.log("progress-start", phase);
    await report(null, { phase, processed: 0, total: 0 });
    budget.log("progress-end", phase);
    await budget.yield();
  };
  await stage(phase);
  const benefitIds = await resolveBenefitIds(ctx, effectiveBenefitSiriusIds(ctx, plugin.benefitSiriusIds!));
  const supplemental = plugin.coverageLookup === "medical-groups"
    ? await ctx.storage.readOnly.query(db => db.select({ id: trustBenefits.id }).from(trustBenefits)
      .where(inArray(trustBenefits.siriusId, Object.keys(effectiveMedicalPlanGroupMap(ctx)))),
      { statementTimeoutMs: COVERAGE_LIMITS.queryMs })
    : plugin.coverageLookup === "medical-type"
      ? await ctx.storage.readOnly.query(db => db.select({ id: trustBenefits.id }).from(trustBenefits)
        .innerJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id))
        .where(eq(optionsTrustBenefitType.name, String(ctx.configData.medicalBenefitTypeName || "Medical"))),
        { statementTimeoutMs: COVERAGE_LIMITS.queryMs })
      : [];
  const asOf = readAsOfYmd(ctx);
  const policy = ctx.terminationPolicy ?? readTerminationPolicy(ctx.configData);
  const window = terminationWindow(asOf, policy.months);
  const reader = coverageReader(ctx, budget);
  const { groups, relationMap } = reader;
  await stage("Reading report-month coverage");
  await reader.read(and(inArray(trustWmb.benefitId, benefitIds),
    eq(trustWmb.year, Number(asOf.slice(0, 4))), eq(trustWmb.month, Number(asOf.slice(5, 7)))));
  const roots = [...groups.values()].flatMap(group => group.slice(0, 1));
  await stage("Reading termination evidence");
  const events: (typeof trustWmbEvents.$inferSelect)[] = [];
  if (policy.subscribers || policy.dependents) {
    let cursor: string | undefined;
    for (;;) {
      const page = await ctx.storage.readOnly.query(db => db.select().from(trustWmbEvents).where(and(
        inArray(trustWmbEvents.benefitId, benefitIds), eq(trustWmbEvents.eventType, "terminate"),
        sql`(${trustWmbEvents.year} * 12 + ${trustWmbEvents.month} - 1) BETWEEN ${window.firstEnd + 1} AND ${window.lastEnd + 1}`,
        cursor ? gt(trustWmbEvents.id, cursor) : undefined,
        // Any later authoritative WMB suppresses the ending, even beyond the
        // report month. Projection decisions must never erase reinstatement.
        sql`NOT EXISTS (SELECT 1 FROM ${trustWmb} WHERE ${trustWmb.workerId} = ${trustWmbEvents.workerId}
          AND ${trustWmb.benefitId} = ${trustWmbEvents.benefitId}
          AND (${trustWmb.year} * 12 + ${trustWmb.month} - 1) >=
              (${trustWmbEvents.year} * 12 + ${trustWmbEvents.month} - 1))`,
      )).orderBy(trustWmbEvents.id).limit(COVERAGE_LIMITS.page), { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
      const coordinates = page.map(event => {
        budget.retain(event);
        events.push(event);
        const previous = monthStart(monthIndex(event.year, event.month) - 1);
        return { ...event, year: +previous.slice(0, 4), month: +previous.slice(5, 7) };
      });
      await reader.ensure(coordinates);
      for (const coordinate of coordinates) {
        const previous = groups.get(coverageKey(coordinate)) ?? [];
        if (previous.some(r => r.sourceRelationId ? policy.dependents : policy.subscribers)) roots.push(previous[0]);
      }
      await budget.yield();
      if (page.length < COVERAGE_LIMITS.page) break;
      cursor = page[page.length - 1].id;
    }
  }
  const needed = new Set<string>();
  await stage("Tracing historical families");
  type State = { coordinate: CoverageCoordinate; family: boolean; walk: boolean };
  let queue: State[] = [];
  const scheduled = new Set<string>();
  const schedule = (coordinate: CoverageCoordinate, family: boolean, walk: boolean) => {
    const key = `${coverageKey(coordinate)}|${family}|${walk}`;
    if (scheduled.has(key)) return;
    budget.check(scheduled.size + 1);
    scheduled.add(key);
    queue.push({ coordinate, family, walk });
  };
  for (const root of roots) schedule(root, true, true);
  roots.length = 0;
  // Explore all candidate families, not whichever source happens to sort first.
  // Historical segments can extend without a lookback cap; gaps stop traversal.
  while (queue.length) {
    const batch = queue;
    queue = [];
    await reader.ensure(batch.map(s => s.coordinate));
    await reader.ensure(batch.filter(s => s.family).map(s => s.coordinate), true);
    const previousCoordinates = batch.filter(s => s.walk).map(({ coordinate }) => {
      const previous = monthStart(monthIndex(coordinate.year, coordinate.month) - 1);
      return { ...coordinate, year: +previous.slice(0, 4), month: +previous.slice(5, 7) };
    });
    await reader.ensure(previousCoordinates);
    for (let i = 0; i < batch.length; i++) {
      if (i % 500 === 0) await budget.yield(scheduled.size);
      const { coordinate, family, walk } = batch[i];
      const key = coverageKey(coordinate);
      const group = groups.get(key);
      if (!group?.length) continue;
      needed.add(key);
      if (family) {
        for (const child of reader.children.get(key) ?? []) schedule(groups.get(child)![0], true, true);
        for (const benefit of supplemental) {
          schedule({ ...coordinate, benefitId: benefit.id }, false, false);
          // Supplemental generators ask for report-month medical coverage even
          // when assembling an ended historical family.
          schedule({ ...coordinate, benefitId: benefit.id,
            year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)) }, false, false);
        }
      }
      const previousMonth = monthStart(monthIndex(coordinate.year, coordinate.month) - 1);
      const previousCoordinate = { ...coordinate, year: +previousMonth.slice(0, 4), month: +previousMonth.slice(5, 7) };
      const previousClasses = new Set((groups.get(coverageKey(previousCoordinate)) ?? [])
        .map(row => `${row.sourceRelationId ?? ""}|${isEdiCobra(row.employerSiriusId)}`));
      for (let rowIndex = 0; rowIndex < group.length; rowIndex++) {
      if (rowIndex && rowIndex % 500 === 0) await budget.yield(scheduled.size);
      const row = group[rowIndex];
      const index = monthIndex(row.year, row.month);
      const previous = monthStart(index - 1);
      if (walk) schedule({ ...row, year: +previous.slice(0, 4), month: +previous.slice(5, 7) }, false,
        previousClasses.has(`${row.sourceRelationId ?? ""}|${isEdiCobra(row.employerSiriusId)}`));
      const relation = row.sourceRelationId && relationMap.get(row.sourceRelationId);
      if (relation) schedule({ ...row, workerId: relation.worker1 }, family, family);
      }
    }
  }
  const relevant = [...needed].flatMap(key => groups.get(key)!);
  const labels = new Map(relevant.map(r => [r.workerId, [r.given, r.family].filter(Boolean).join(" ") || r.workerSiriusId || r.workerId]));
  const label = (id: string) => labels.get(id) ?? id;
  await stage("Reviewing competing sources");
  await report(needed.size ? 0 : null, { phase, processed: 0, total: needed.size });
  const decisionsByKey = new Map(decisions.map(d => [d.key, d]));
  const conflicts = [];
  let processed = 0;
  let reviewBytes = 0;
  let lastReport = performance.now();
  for (const key of [...needed].sort()) {
    processed++;
    if (processed % 500 === 0) {
      await budget.yield(scheduled.size);
      if (performance.now() - lastReport > 500) {
        await report(Math.round(processed / needed.size * 100), { phase, processed, total: needed.size });
        lastReport = performance.now();
      }
    }
    const group = groups.get(key)!;
    if (!competingSources(group) && !decisionsByKey.has(key)) continue;
    // Refuse pathological candidate × parent evidence BEFORE allocating copies
    // or canonicalizing them. This is a whole-run refusal, never truncation.
    let evidenceItems = group.length;
    for (const r of group) {
      const relation = r.sourceRelationId && relationMap.get(r.sourceRelationId);
      if (relation) evidenceItems += groups.get(coverageKey({ ...r, workerId: relation.worker1 }))?.length ?? 0;
      if (evidenceItems > 10_000) throw new Error("Coverage conflict evidence is too large to review safely. Correct competing sources before retrying; no partial review was accepted.");
    }
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
    const conflict = reviewConflict(candidates, evidenceHash({
      context: { configId: ctx.configId, data: ctx.configData, input: ctx.input, policy },
      candidates, familyEvidence,
    }), decisionsByKey.has(key) ? [decisionsByKey.get(key)!] : []);
    reviewBytes += Buffer.byteLength(JSON.stringify(conflict));
    if (reviewBytes > 2_000_000) throw new Error("Coverage review is too large to display safely. Correct competing source records and refresh evidence.");
    conflicts.push(conflict);
  }
  for (const saved of decisions) if (!needed.has(saved.key)) conflicts.push({
    key: saved.key, evidence: evidenceHash({ removed: saved.key }), candidates: [],
    decision: null, stale: true,
  });
  await stage("Validating evidence fingerprint");
  const relevantRelations = new Set(relevant.map(r => r.sourceRelationId));
  const fingerprint = await evidenceHashRecords({
    relevant: relevant.sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...relationMap.values()].filter(r => relevantRelations.has(r.id)).sort((a, b) => a.id.localeCompare(b.id)),
    events: events.sort((a, b) => a.id.localeCompare(b.id)),
  });
  await stage("Evidence check finished");
  // Keep every event in the fingerprint, but population may only reuse events
  // whose role has evidence in the closure. Missing evidence must still fail
  // generation; only a demonstrably disabled role can be omitted here.
  const populationEvents = events.filter(event => {
    const previous = monthStart(monthIndex(event.year, event.month) - 1);
    const group = groups.get(coverageKey({ ...event, year: +previous.slice(0, 4), month: +previous.slice(5, 7) })) ?? [];
    return !group.length || group.some(row => row.sourceRelationId ? policy.dependents : policy.subscribers);
  });
  return { conflicts, groups, relationMap, relevant, fingerprint, events: populationEvents };
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
  return indexCoverageProjection({ excludedIds, decisions: review.conflicts.map(c => c.decision!), fingerprint: review.fingerprint },
    review.relevant, review.events, [...review.relationMap.values()]);
}
