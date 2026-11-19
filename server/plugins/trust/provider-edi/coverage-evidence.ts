import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  contacts, employers, optionsTrustBenefitType, trustBenefits, trustWmb, workerRelations, workers,
} from "@shared/schema";
import type { EdiCoverageEntry, EdiCoverageEntryReason } from "@shared/edi-coverage-choices";
import type { TrustProviderEdiContext, TrustProviderEdiPlugin } from "./registry";
import { effectiveBenefitSiriusIds, readAsOfYmd, resolveBenefitIds } from "./base";
import { CoverageBudget, COVERAGE_LIMITS, readBudgetedPages } from "./coverage-budget";
import {
  applyConflictRule, competingSources, correctionRequired, coverageKey, evidenceHashRecords, exclusionDigest, relationCoversMonth,
  type CoverageEvidence, type EvidenceRelation, type EvidenceRow, type ExcludedGroup,
} from "./coverage-conflicts";
import { isEdiCobra } from "./coverage-segments";
import { conflictRuleInForce } from "./coverage-settings";
import { assertCoverageEventsReady, staleStartsError } from "./coverage-readiness";
import { readSegmentConflicts, resolveSegmentStarts } from "./coverage-starts";
import { readTerminationEvidence, type TerminationCandidate } from "./termination-population";
import { monthIndex, monthParts, monthStart, readTerminationPolicy, terminationWindow } from "./termination-policy";
import { coverageDatabaseFailure } from "./coverage-database-error";

export type CoverageProgress = (
  percent: number | null, details?: { phase?: string; processed?: number; total?: number },
) => Promise<void> | void;

const coverageColumns = {
  id: trustWmb.id, workerId: trustWmb.workerId, benefitId: trustWmb.benefitId, year: trustWmb.year,
  month: trustWmb.month, employerId: trustWmb.employerId, sourceRelationId: trustWmb.sourceRelationId,
  employerSiriusId: employers.siriusId,
};
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
function* pages<T>(values: readonly T[]): Generator<T[]> {
  for (let offset = 0; offset < values.length; offset += COVERAGE_LIMITS.page)
    yield values.slice(offset, offset + COVERAGE_LIMITS.page);
}

/**
 * Everything one coverage check or one generation reads about coverage.
 *
 * Bounded by construction: the reporting month; the last covered month of
 * termination candidates inside the termination window; those people's
 * families for those months; supplemental coverage for carriers that declare
 * it; and, for start dates, each person's current coverage run only. Nothing
 * older than a person's run start is read, and no source record is changed.
 */
export async function readCoverageEvidence(
  ctx: TrustProviderEdiContext, plugin: TrustProviderEdiPlugin, report: CoverageProgress = () => {},
): Promise<CoverageEvidence> {
  const budget = new CoverageBudget(ctx.coverageCorrelation);
  const limit = { statementTimeoutMs: COVERAGE_LIMITS.queryMs };
  const read: TrustProviderEdiContext["storage"]["readOnly"]["query"] = fn => ctx.storage.readOnly.query(fn, limit);
  const rule = conflictRuleInForce();
  const timings: CoverageEvidence["timings"] = [];
  async function phase<T>(name: string, work: () => Promise<T>, extra: () => Record<string, number> = () => ({})): Promise<T> {
    const started = performance.now();
    budget.log("phase-start", name);
    await report(null, { phase: name, processed: 0, total: 0 });
    let result: T;
    try {
      result = await work();
    } catch (error) {
      throw coverageDatabaseFailure(error, name, Math.round(performance.now() - started), ctx.coverageCorrelation);
    }
    const milliseconds = Math.round(performance.now() - started);
    timings.push({ phase: name, milliseconds });
    budget.log("phase-end", name, { milliseconds, ...extra() });
    await budget.yield();
    return result;
  }
  const retain = <T>(rows: T[]) => { for (const row of rows) budget.retain(row); return rows; };

  const asOf = readAsOfYmd(ctx);
  const policy = ctx.terminationPolicy ?? readTerminationPolicy(ctx.configData);
  const terminations = policy.subscribers || policy.dependents;
  const window = terminationWindow(asOf, policy.months);
  const reportMonth = monthParts(window.report);

  const { benefitIds, supplementalIds } = await phase("Resolving benefits", async () => {
    const benefitIds = await resolveBenefitIds(ctx, effectiveBenefitSiriusIds(ctx, plugin.benefitSiriusIds!));
    // The carrier names the other benefits it reads; nothing here knows why.
    const declared = plugin.supplementalCoverage?.(ctx);
    const filters = [
      declared?.benefitSiriusIds?.length ? inArray(trustBenefits.siriusId, [...declared.benefitSiriusIds]) : undefined,
      declared?.benefitTypeName ? eq(optionsTrustBenefitType.name, declared.benefitTypeName) : undefined,
    ].filter((f): f is NonNullable<typeof f> => !!f);
    const supplemental = filters.length ? await read(db => db.select({ id: trustBenefits.id }).from(trustBenefits)
      .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id))
      .where(or(...filters))) : [];
    return { benefitIds, supplementalIds: supplemental.map(b => b.id).filter(id => !benefitIds.includes(id)) };
  });

  const { population } = await phase("Checking lifecycle events",
    () => assertCoverageEventsReady(ctx, benefitIds, terminations ? window.firstEnd : window.report, window.report, terminations));
  budget.check(population);

  const relations = new Map<string, EvidenceRelation>();
  const counts = { reportMonthRecords: 0, terminationEvents: 0, anchors: 0, coverageMonthsRead: 0, monthsBeforeRunStart: 0 };
  const reportRows = await phase("Reading report-month coverage", async () => {
    const rows = await read(db => db.select({
      ...coverageColumns,
      relationId: workerRelations.id, worker1: workerRelations.worker1, worker2: workerRelations.worker2,
      startYmd: workerRelations.startYmd, endYmd: workerRelations.endYmd, relationType: workerRelations.relationType,
    }).from(trustWmb)
      .leftJoin(employers, eq(trustWmb.employerId, employers.id))
      .leftJoin(workerRelations, eq(trustWmb.sourceRelationId, workerRelations.id))
      .where(and(inArray(trustWmb.benefitId, benefitIds), eq(trustWmb.year, reportMonth.year), eq(trustWmb.month, reportMonth.month)))
      .limit(COVERAGE_LIMITS.rows + 1));
    counts.reportMonthRecords = rows.length;
    return retain(rows.map(({ relationId, worker1, worker2, startYmd, endYmd, relationType, ...row }): EvidenceRow => {
      if (relationId && worker1 && worker2) relations.set(relationId, { id: relationId, worker1, worker2, startYmd, endYmd, relationType });
      return row;
    }));
  }, () => ({ reportMonthRecords: counts.reportMonthRecords }));

  const termination = await phase("Reading termination evidence", async () => {
    const evidence = await readTerminationEvidence(ctx, benefitIds,
      (processed, total) => report(null, { phase: "Reading termination evidence", processed, total }), budget);
    for (const relation of evidence.relations) relations.set(relation.id, relation);
    counts.terminationEvents = evidence.events.length;
    return evidence;
  }, () => ({ terminationEvents: counts.terminationEvents }));
  const terminationRow = new Map(termination.coverage.map(r => [r.id, r]));

  // The months a file uses directly.
  const { excludedIds, groups, refused } = applyConflictRule(reportRows, relations);
  if (refused.length) throw correctionRequired(refused);
  for (const group of termination.excluded) {
    groups.push(group);
    for (const row of group.rows) excludedIds.add(row.id);
  }

  // Ended families are rebuilt for their last covered month, so every family
  // member covered that month shapes the ended family's counts and tier.
  const familyMonths = new Map<number, Set<string>>();
  for (const candidate of termination.selected) {
    const family = terminationRow.get(candidate.familyWmbId)!;
    const month = monthIndex(family.year, family.month);
    if (!familyMonths.has(month)) familyMonths.set(month, new Set());
    familyMonths.get(month)!.add(family.workerId);
  }
  const familyRead = await phase("Reading ended families", async () => {
    const complete = new Map<string, EvidenceRow>();
    for (const [month, subscribers] of familyMonths) {
      const { year, month: calendarMonth } = monthParts(month);
      const members = new Set<string>();
      for (const page of pages([...subscribers])) {
        const attached = await read(db => db.select({
          ...coverageColumns,
          relationId: workerRelations.id, worker1: workerRelations.worker1, worker2: workerRelations.worker2,
          startYmd: workerRelations.startYmd, endYmd: workerRelations.endYmd, relationType: workerRelations.relationType,
        }).from(trustWmb)
          .innerJoin(workerRelations, eq(trustWmb.sourceRelationId, workerRelations.id))
          .leftJoin(employers, eq(trustWmb.employerId, employers.id))
          .where(and(inArray(workerRelations.worker1, page), inArray(trustWmb.benefitId, benefitIds),
            eq(trustWmb.year, year), eq(trustWmb.month, calendarMonth)))
          .limit(COVERAGE_LIMITS.rows + 1));
        for (const { relationId, worker1, worker2, startYmd, endYmd, relationType, ...row } of attached) {
          if (relationId && worker1 && worker2) {
            const relation = { id: relationId, worker1, worker2, startYmd, endYmd, relationType };
            budget.retain(relation);
            relations.set(relationId, relation);
          }
          if (!complete.has(row.id)) { complete.set(row.id, row); members.add(row.workerId); budget.retain(row); }
        }
      }
      // A family member's month is judged on EVERY record they hold for it.
      // Their own coverage, or coverage under another subscriber, competes
      // with the record attached to this family and is invisible to the read
      // above, which only follows this family's relationships.
      for (const page of pages([...members])) {
        const held = await read(db => db.select(coverageColumns).from(trustWmb)
          .leftJoin(employers, eq(trustWmb.employerId, employers.id))
          .where(and(inArray(trustWmb.workerId, page), inArray(trustWmb.benefitId, benefitIds),
            eq(trustWmb.year, year), eq(trustWmb.month, calendarMonth)))
          .limit(COVERAGE_LIMITS.rows + 1));
        for (const row of held) if (!complete.has(row.id)) { complete.set(row.id, row); budget.retain(row); }
        await budget.yield();
      }
    }
    return [...complete.values()];
  });
  for (const group of monthGroups(familyRead).values()) {
    if (!competingSources(group)) continue;
    // Already listed when the member is an ended person or a report-month member.
    if (!group.some(row => excludedIds.has(row.id))) groups.push({ reason: "family-member-conflict", rows: [...group].sort(byId) });
    for (const row of group) excludedIds.add(row.id);
  }
  // Every retained historical dependent contributes to the carrier's family
  // counts/tier. Validate its authority even when its month has no conflict,
  // and keep the relationship in `relations` for the final fingerprint.
  for (const row of familyRead) {
    if (!row.sourceRelationId || excludedIds.has(row.id)) continue;
    const relation = relations.get(row.sourceRelationId);
    if (!relationCoversMonth(relation, row) ||
        !familyMonths.get(monthIndex(row.year, row.month))?.has(relation.worker1)) {
      throw correctionRequired([{ reason: "subscriber-missing", rows: [row] }]);
    }
  }
  const familyRows = familyRead.filter(r => !terminationRow.has(r.id));

  const supplementalRows = await phase("Reading supplemental coverage", async () => {
    if (!supplementalIds.length) return [];
    const wanted = new Map<number, Set<string>>([[window.report, new Set(reportRows.map(r => r.workerId))]]);
    for (const [month, subscribers] of familyMonths) {
      if (!wanted.has(month)) wanted.set(month, new Set());
      for (const worker of subscribers) wanted.get(month)!.add(worker);
    }
    const rows: EvidenceRow[] = [];
    for (const [month, people] of wanted) for (const page of pages([...people])) {
      const { year, month: calendarMonth } = monthParts(month);
      rows.push(...await readBudgetedPages(budget, (after, pageSize) => read(db => db.select(coverageColumns).from(trustWmb)
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .where(and(inArray(trustWmb.workerId, page), inArray(trustWmb.benefitId, supplementalIds),
          eq(trustWmb.year, year), eq(trustWmb.month, calendarMonth), after ? gt(trustWmb.id, after) : undefined))
        .orderBy(trustWmb.id).limit(pageSize))));
      await budget.yield();
    }
    return rows;
  });
  for (const group of monthGroups(supplementalRows).values()) if (competingSources(group)) {
    groups.push({ reason: "supplemental-conflict", rows: [...group].sort(byId) });
    for (const row of group) excludedIds.add(row.id);
  }
  if (rule === "refuse-conflicting" && groups.length) throw correctionRequired(groups);

  // Start dates: one row per anchor comes back, never a person's months.
  const retained = reportRows.filter(r => !excludedIds.has(r.id));
  const anchors = [...new Set([
    ...retained.map(r => r.id),
    ...termination.selected.flatMap(c => [c.memberWmbId, c.familyWmbId]),
  ])];
  counts.anchors = anchors.length;
  const unready = { missing: new Set<string>(), inconsistent: new Set<string>() };
  const starts = await phase("Reading coverage start events", async () => {
    const starts = await resolveSegmentStarts(ctx, anchors, async (processed, total, _milliseconds, batch) => {
      // Earlier conflicts arrive as counts. Charging them here, batch by
      // batch, refuses an oversized history before any of it is read.
      budget.reserve(batch.reduce((records, start) => records + start.conflictRecords, 0));
      await report(total ? Math.round(processed / total * 100) : null, { phase: "Reading coverage start events", processed, total });
      await budget.yield();
    });
    for (const id of anchors) {
      const start = starts.get(id);
      if (!start) throw new Error(`WMB ${id}: coverage changed while it was being checked. Check Coverage sources again.`);
      counts.coverageMonthsRead += start.monthsRead;
      counts.monthsBeforeRunStart += start.monthsBeforeRunStart;
      if (start.problem === "missing-event") unready.missing.add(start.workerId);
      if (start.problem === "inconsistent-event") unready.inconsistent.add(start.workerId);
    }
    return starts;
    // The log line that shows nothing older than a run start was read.
  }, () => ({ anchors: counts.anchors, coverageMonthsRead: counts.coverageMonthsRead, monthsBeforeRunStart: counts.monthsBeforeRunStart }));
  if (unready.missing.size || unready.inconsistent.size) throw staleStartsError(unready.missing.size, unready.inconsistent.size);

  const { exclusions, warnings } = await phase("Describing exclusions", async () => {
    // Earlier conflicts in a current run. Their records were counted with the
    // start dates and already fit the budget; each statement is sized by that
    // count, and what it returns is weighed as it arrives.
    const pending = anchors.map(id => starts.get(id)!).filter(start => start.conflictMonths > 0);
    const warningRows = new Map<string, EvidenceRow>();
    for (let offset = 0; offset < pending.length;) {
      const batch: { id: string; coverageStartYmd: string }[] = [];
      for (let records = 0; offset < pending.length && batch.length < COVERAGE_LIMITS.page &&
          (!batch.length || records + pending[offset].conflictRecords <= WARNING_STATEMENT_RECORDS); offset++) {
        records += pending[offset].conflictRecords;
        batch.push({ id: pending[offset].id, coverageStartYmd: pending[offset].coverageStartYmd! });
      }
      for (const row of await read(db => readSegmentConflicts(db, batch))) if (!warningRows.has(row.id)) {
        warningRows.set(row.id, row);
        budget.weigh(row);
      }
      await budget.yield();
    }
    const warningGroups: ExcludedGroup[] = [...monthGroups([...warningRows.values()]).values()]
      .map(rows => ({ reason: "in-run-conflict" as const, rows: [...rows].sort(byId) }));
    // The start date rests on these months, so the strict rule stops for them too.
    if (rule === "refuse-conflicting" && warningGroups.length) throw correctionRequired(warningGroups);
    const describe = await describer(read, [...groups, ...warningGroups], relations);
    // The lists themselves are evidence a run keeps: weigh each entry as it is built.
    const entries = (kind: EdiCoverageEntry["kind"], described: readonly ExcludedGroup[]) => described.map(group => {
      const entry = describe(kind, group);
      budget.weigh(entry);
      return entry;
    }).sort(entryOrder);
    return { exclusions: entries("exclusion", groups), warnings: entries("warning", warningGroups) };
  });

  const terminationCandidates: TerminationCandidate[] | null = terminations
    ? termination.selected.map(({ memberWmbId, ...candidate }) =>
      ({ ...candidate, start: starts.get(memberWmbId)!.coverageStartYmd! }))
    : null;
  const digest = exclusionDigest(rule, exclusions);
  const fingerprint = await phase("Fingerprinting evidence", () => evidenceHashRecords({
    context: [{ configId: ctx.configId, data: ctx.configData, input: ctx.input, policy, rule }],
    coverage: [...retained].sort(byId),
    relations: [...relations.values()].sort(byId),
    terminationEvents: [...termination.events].sort(byId).map(e => ({ id: e.id, workerId: e.workerId,
      benefitId: e.benefitId, year: e.year, month: e.month,
      provenance: (e.data as Record<string, unknown> | null)?.provenance ?? null })),
    terminationCoverage: [...termination.coverage].sort(byId),
    families: familyRows.filter(r => !excludedIds.has(r.id)).sort(byId),
    terminations: terminationCandidates ?? [],
    supplemental: supplementalRows.filter(r => !excludedIds.has(r.id)).sort(byId),
    starts: anchors.sort().map(id => ({ id, start: starts.get(id)!.coverageStartYmd, isCobra: starts.get(id)!.isCobra })),
    exclusions: [digest],
    warnings: warnings.map(w => `${w.workerId}|${w.benefitId}|${w.month}|${w.records.map(r => r.id).join(",")}`),
  }));
  budget.log("complete", "Evidence complete", { population, exclusions: exclusions.length, warnings: warnings.length });
  return { rule, excludedIds, starts, terminationCandidates, exclusions, warnings,
    exclusionDigest: digest, fingerprint, population, timings, budget };
}

function monthGroups(rows: readonly EvidenceRow[]): Map<string, EvidenceRow[]> {
  const groups = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const key = coverageKey(row);
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return groups;
}

const REASON_ORDER: EdiCoverageEntryReason[] = ["conflicting-coverage", "subscriber-excluded", "termination-conflict",
  "termination-subscriber-excluded", "family-member-conflict", "supplemental-conflict", "in-run-conflict"];
/** Earlier-conflict records one statement may return. */
const WARNING_STATEMENT_RECORDS = 5000;
const entryOrder = (a: EdiCoverageEntry, b: EdiCoverageEntry) =>
  REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason) || a.personLabel.localeCompare(b.personLabel) ||
  a.workerId.localeCompare(b.workerId) || a.month.localeCompare(b.month) || a.benefitId.localeCompare(b.benefitId);

/** Names are read only for the records an entry lists, never for the population. */
async function describer(
  read: TrustProviderEdiContext["storage"]["readOnly"]["query"], groups: readonly ExcludedGroup[],
  relations: Map<string, EvidenceRelation>,
) {
  const rows = groups.flatMap(g => g.rows);
  const unknownRelations = [...new Set(rows.map(r => r.sourceRelationId)
    .filter((id): id is string => !!id && !relations.has(id)))];
  for (const page of pages(unknownRelations)) for (const relation of await read(db => db.select({
    id: workerRelations.id, worker1: workerRelations.worker1, worker2: workerRelations.worker2,
    startYmd: workerRelations.startYmd, endYmd: workerRelations.endYmd, relationType: workerRelations.relationType,
  }).from(workerRelations).where(inArray(workerRelations.id, page)))) relations.set(relation.id, relation);
  const subscriberOf = (row: EvidenceRow) => row.sourceRelationId ? relations.get(row.sourceRelationId)?.worker1 ?? null : row.workerId;
  const names = new Map<string, string>();
  const personIds = [...new Set(rows.flatMap(r => [r.workerId, subscriberOf(r)]).filter((id): id is string => !!id))];
  for (const page of pages(personIds)) for (const person of await read(db => db.select({
    id: workers.id, name: contacts.displayName,
  }).from(workers).innerJoin(contacts, eq(workers.contactId, contacts.id)).where(inArray(workers.id, page))))
    names.set(person.id, person.name);
  const benefits = new Map<string, string>();
  for (const page of pages([...new Set(rows.map(r => r.benefitId))])) for (const benefit of await read(db => db.select({
    id: trustBenefits.id, name: trustBenefits.name }).from(trustBenefits).where(inArray(trustBenefits.id, page))))
    benefits.set(benefit.id, benefit.name);
  const employerNames = new Map<string, string>();
  for (const page of pages([...new Set(rows.map(r => r.employerId))])) for (const employer of await read(db => db.select({
    id: employers.id, name: employers.name }).from(employers).where(inArray(employers.id, page))))
    employerNames.set(employer.id, employer.name);
  return (kind: EdiCoverageEntry["kind"], group: ExcludedGroup): EdiCoverageEntry => {
    const first = group.rows[0];
    return {
      kind, reason: group.reason, workerId: first.workerId, personLabel: names.get(first.workerId) ?? first.workerId,
      benefitId: first.benefitId, benefitLabel: benefits.get(first.benefitId) ?? first.benefitId,
      month: monthStart(monthIndex(first.year, first.month)).slice(0, 7),
      records: group.rows.map(row => {
        const subscriber = subscriberOf(row);
        return {
          id: row.id, employerId: row.employerId, employerLabel: employerNames.get(row.employerId) ?? row.employerId,
          employerSiriusId: row.employerSiriusId, sourceRelationId: row.sourceRelationId,
          subscriberWorkerId: subscriber,
          subscriberLabel: subscriber ? names.get(subscriber) ?? subscriber : "Missing subscriber",
          isCobra: isEdiCobra(row.employerSiriusId),
        };
      }),
    };
  };
}
