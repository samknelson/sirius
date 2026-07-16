import { getClient, runInTransaction, onAfterCommit } from '../transaction-context';
import {
  workerTrustElections,
  workers,
  policies,
  employers,
  contacts,
  trustBenefits,
  optionsTrustBenefitType,
  workerRelations,
  optionsWorkerRelationType,
  createWorkerTrustElectionRequestSchema,
  updateWorkerTrustElectionRequestSchema,
  type WorkerTrustElection,
  type WorkerTrustElectionView,
  type EnrollmentType,
} from '@shared/schema';
import { eq, and, asc, desc, isNull, lt, lte, gte, or, ne, inArray, arrayOverlaps, sql, type SQL } from 'drizzle-orm';
import { defineLoggingConfig, type StorageLoggingConfig } from '../middleware/logging';
import { normalizeToDateOnly, getTodayDateOnly } from '@shared/utils';
import { eventBus, EventType } from '../../services/event-bus';

export interface WorkerTrustElectionSearchParams {
  id?: string;
  workerId?: string;
  policyId?: string;
  enrollmentType?: EnrollmentType;
  activeOnly?: boolean;
  sort?: 'startAsc' | 'startDesc';
  limit?: number;
  offset?: number;
}

/**
 * Emit `TRUST_ELECTION_SAVED` after the current transaction commits so a
 * concurrent read never observes the change before it is durable. The
 * enrollment type is carried on the payload so per-type notifiers can route
 * without re-reading the row (which is already gone for deletes).
 */
function emitTrustElectionSaved(
  electionId: string,
  workerId: string,
  enrollmentType: EnrollmentType | null,
  operation: 'created' | 'updated' | 'deleted',
): void {
  onAfterCommit(() => {
    void eventBus.emit(EventType.TRUST_ELECTION_SAVED, {
      electionId,
      workerId,
      enrollmentType,
      operation,
    });
  });
}

export interface WorkerTrustElectionsStorage {
  search(params: WorkerTrustElectionSearchParams): Promise<WorkerTrustElection[]>;
  getById(id: string): Promise<WorkerTrustElection | undefined>;
  listByWorker(workerId: string): Promise<WorkerTrustElection[]>;
  getActiveByWorker(workerId: string): Promise<WorkerTrustElection | undefined>;
  getActiveByWorkerAsOf(workerId: string, asOfYmd: string): Promise<WorkerTrustElection | undefined>;
  /**
   * True when the worker has any currently-active election (end date not
   * set) that covers a Medical or Dental benefit. First-time enrollment is
   * only offered to workers for whom this is false — baseline AD&D/Life-only
   * workers still qualify because those benefit types are not Medical/Dental.
   */
  hasActiveMedicalOrDentalElection(workerId: string): Promise<boolean>;
  /**
   * Non-throwing preview of `assertNoDualCoverage`: returns the list of
   * dual-coverage conflicts the given election shape would hit, using the
   * same logic as the write-time check but without advisory locks. Used by
   * the enrollment wizards to warn about conflicts at dependent selection
   * time; the write-time assert stays the enforcement backstop.
   */
  checkDualCoverage(input: DualCoverageInput): Promise<DualCoverageConflict[]>;
  searchViews(params: WorkerTrustElectionSearchParams): Promise<WorkerTrustElectionView[]>;
  getViewById(id: string): Promise<WorkerTrustElectionView | undefined>;
  getActiveViewByWorker(workerId: string): Promise<WorkerTrustElectionView | undefined>;
  create(workerId: string, input: unknown): Promise<WorkerTrustElection>;
  update(id: string, input: unknown): Promise<WorkerTrustElection | undefined>;
  delete(id: string): Promise<boolean>;
}

async function hydrateElections(rows: WorkerTrustElection[]): Promise<WorkerTrustElectionView[]> {
  if (rows.length === 0) return [];
  const client = getClient();

  const policyIdSet = new Set<string>();
  const employerIdSet = new Set<string>();
  const benefitIdSet = new Set<string>();
  const relIdSet = new Set<string>();
  for (const row of rows) {
    if (row.policyId) policyIdSet.add(row.policyId);
    if (row.employerId) employerIdSet.add(row.employerId);
    for (const id of row.benefitIds ?? []) benefitIdSet.add(id);
    for (const id of row.relationshipIds ?? []) relIdSet.add(id);
  }

  const [policyRows, employerRows, benefitRows, relRows] = await Promise.all([
    policyIdSet.size
      ? client
          .select({ id: policies.id, name: policies.name })
          .from(policies)
          .where(inArray(policies.id, Array.from(policyIdSet)))
      : Promise.resolve([] as { id: string; name: string | null }[]),
    employerIdSet.size
      ? client
          .select({ id: employers.id, name: employers.name })
          .from(employers)
          .where(inArray(employers.id, Array.from(employerIdSet)))
      : Promise.resolve([] as { id: string; name: string | null }[]),
    benefitIdSet.size
      ? client
          .select({ id: trustBenefits.id, name: trustBenefits.name })
          .from(trustBenefits)
          .where(inArray(trustBenefits.id, Array.from(benefitIdSet)))
      : Promise.resolve([] as { id: string; name: string | null }[]),
    relIdSet.size
      ? client
          .select({
            id: workerRelations.id,
            worker1: workerRelations.worker1,
            worker2: workerRelations.worker2,
            relationTypeName: optionsWorkerRelationType.name,
          })
          .from(workerRelations)
          .leftJoin(
            optionsWorkerRelationType,
            eq(workerRelations.relationType, optionsWorkerRelationType.id),
          )
          .where(inArray(workerRelations.id, Array.from(relIdSet)))
      : Promise.resolve(
          [] as { id: string; worker1: string; worker2: string; relationTypeName: string | null }[],
        ),
  ]);

  const lookupWorkerIds = new Set<string>();
  for (const r of relRows) {
    lookupWorkerIds.add(r.worker1);
    lookupWorkerIds.add(r.worker2);
  }
  // Also fetch each election's own worker so views can show whose enrollment
  // this is (the staff enrollment queue lists rows across all workers).
  for (const row of rows) {
    if (row.workerId) lookupWorkerIds.add(row.workerId);
  }

  const workerNameRows = lookupWorkerIds.size
    ? await client
        .select({
          id: workers.id,
          displayName: contacts.displayName,
          given: contacts.given,
          family: contacts.family,
        })
        .from(workers)
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(inArray(workers.id, Array.from(lookupWorkerIds)))
    : [];

  const policyMap = new Map(policyRows.map((p) => [p.id, p.name ?? null]));
  const employerMap = new Map(employerRows.map((e) => [e.id, e.name ?? null]));
  const benefitMap = new Map(benefitRows.map((b) => [b.id, b.name ?? b.id]));
  const relMap = new Map(relRows.map((r) => [r.id, r]));
  const workerNameMap = new Map(workerNameRows.map((w) => [w.id, w]));

  return rows.map((election): WorkerTrustElectionView => {
    const benefits = (election.benefitIds ?? []).map((id) => ({
      id,
      name: benefitMap.get(id) ?? 'Unknown benefit',
    }));
    const relationships = (election.relationshipIds ?? []).map((id) => {
      const rel = relMap.get(id);
      if (!rel) return { id, label: 'Unknown relationship' };
      const otherId = rel.worker1 === election.workerId ? rel.worker2 : rel.worker1;
      const w = workerNameMap.get(otherId);
      const name = w
        ? [w.given, w.family].filter(Boolean).join(' ').trim() || w.displayName || 'Unknown worker'
        : 'Unknown worker';
      const type = rel.relationTypeName || 'relation';
      return { id, label: `${name} (${type})` };
    });
    const ownWorker = workerNameMap.get(election.workerId);
    const workerName = ownWorker
      ? [ownWorker.given, ownWorker.family].filter(Boolean).join(' ').trim() ||
        ownWorker.displayName ||
        null
      : null;
    return {
      ...election,
      workerName,
      policyName: policyMap.get(election.policyId) ?? null,
      employerName: employerMap.get(election.employerId) ?? null,
      benefits,
      relationships,
    };
  });
}

export class WorkerTrustElectionValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'WorkerTrustElectionValidationError';
  }
}

function toYmd(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = normalizeToDateOnly(value);
  if (!d) return null;
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function ymdMinusOneDay(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

interface ValidationInput {
  workerId?: string | null;
  employerId?: string | null;
  policyId?: string | null;
  startYmd?: Date | string | null;
  endYmd?: Date | string | null;
}

async function validateElection(
  data: ValidationInput,
  existing?: WorkerTrustElection,
): Promise<{ workerId: string; employerId: string; policyId: string; startYmd: string; endYmd: string | null }> {
  const workerId = data.workerId ?? existing?.workerId ?? undefined;
  const employerId = data.employerId ?? existing?.employerId ?? undefined;
  const policyId = data.policyId ?? existing?.policyId ?? undefined;
  const startSource = data.startYmd !== undefined ? data.startYmd : existing?.startYmd ?? null;
  const endSource = data.endYmd !== undefined ? data.endYmd : existing?.endYmd ?? null;
  const startYmd = toYmd(startSource);
  const endYmd = toYmd(endSource);

  if (!workerId) throw new WorkerTrustElectionValidationError('workerId', 'workerId is required');
  if (!employerId) throw new WorkerTrustElectionValidationError('employerId', 'employerId is required');
  if (!policyId) throw new WorkerTrustElectionValidationError('policyId', 'policyId is required');
  if (!startYmd) throw new WorkerTrustElectionValidationError('startYmd', 'startYmd is required');

  // Future start dates are allowed: enrollment effective dates are
  // legitimately "first of next month" when posted after the 15th
  // (benefit election enrollment wizard rule).
  if (endYmd && endYmd <= startYmd) {
    throw new WorkerTrustElectionValidationError('endYmd', 'endYmd must be strictly after startYmd');
  }

  const client = getClient();
  const [foundWorker] = await client.select({ id: workers.id }).from(workers).where(eq(workers.id, workerId));
  if (!foundWorker) throw new WorkerTrustElectionValidationError('workerId', 'worker does not exist');
  const [foundEmployer] = await client.select({ id: employers.id }).from(employers).where(eq(employers.id, employerId));
  if (!foundEmployer) throw new WorkerTrustElectionValidationError('employerId', 'employer does not exist');
  const [foundPolicy] = await client.select({ id: policies.id }).from(policies).where(eq(policies.id, policyId));
  if (!foundPolicy) throw new WorkerTrustElectionValidationError('policyId', 'policy does not exist');

  return { workerId, employerId, policyId, startYmd, endYmd };
}

async function getWorkerFullName(
  client: ReturnType<typeof getClient>,
  workerId: string,
): Promise<string> {
  const [w] = await client
    .select({
      displayName: contacts.displayName,
      given: contacts.given,
      family: contacts.family,
    })
    .from(workers)
    .leftJoin(contacts, eq(workers.contactId, contacts.id))
    .where(eq(workers.id, workerId));
  if (!w) return 'Unknown worker';
  return (
    [w.given, w.family].filter(Boolean).join(' ').trim() ||
    w.displayName ||
    'Unknown worker'
  );
}

function describeConflictWindow(e: WorkerTrustElection): string {
  return e.endYmd
    ? `election from ${e.startYmd} to ${e.endYmd}`
    : `election starting ${e.startYmd}`;
}

export interface DualCoverageInput {
  subscriberId: string;
  relationshipIds: string[] | null | undefined;
  startYmd: string;
  endYmd: string | null;
  excludeElectionId?: string;
}

export interface DualCoverageConflict {
  field: 'workerId' | 'relationshipIds';
  /** The person who would be double-covered. */
  workerId: string;
  /** The relationship (on the election being checked) that carries the conflicted person, when applicable. */
  relationshipId: string | null;
  message: string;
}

/**
 * Cross-subscriber "no dual coverage" rule: no person — the subscriber or any
 * dependent — may be covered by two date-overlapping elections belonging to
 * DIFFERENT subscribers. Same-subscriber overlap is handled separately by
 * endDatePreviousActive (a new active election auto-ends the prior one), so
 * this check deliberately ignores the subscriber's own other elections; that
 * also keeps open-enrollment renewals and life-event carry-forward working.
 *
 * The lookup is targeted: it is keyed to just the handful of people on the
 * election being saved (subscriber + dependents), never a scan of all
 * elections. It must query live data at write time — a cached "covered" flag
 * could go stale between simultaneous submissions and coverage is a
 * date-range property, not a boolean.
 */
async function collectDualCoverageConflicts(
  client: ReturnType<typeof getClient>,
  input: DualCoverageInput,
  opts: { lock: boolean },
): Promise<DualCoverageConflict[]> {
  const { subscriberId, startYmd, endYmd, excludeElectionId } = input;
  const relationshipIds = (input.relationshipIds ?? []).filter(Boolean);

  // People covered by the election being saved: the subscriber plus the
  // non-subscriber side of each dependent relationship. Track which of the
  // election's OWN relationships carries each person so a conflict can be
  // reported against the exact dependent row the caller selected.
  const coveredIds = new Set<string>([subscriberId]);
  const ownRelIdByWorker = new Map<string, string>();
  if (relationshipIds.length > 0) {
    const ownRels = await client
      .select({
        id: workerRelations.id,
        worker1: workerRelations.worker1,
        worker2: workerRelations.worker2,
      })
      .from(workerRelations)
      .where(inArray(workerRelations.id, relationshipIds));
    for (const r of ownRels) {
      const other = r.worker1 === subscriberId ? r.worker2 : r.worker1;
      coveredIds.add(other);
      if (!ownRelIdByWorker.has(other)) ownRelIdByWorker.set(other, r.id);
    }
  }
  const coveredList = Array.from(coveredIds);

  // Serialize concurrent writes that touch the same people. Under READ
  // COMMITTED, two simultaneous submissions covering the same person could
  // each pass the check before the other commits (write skew). Taking a
  // transaction-scoped advisory lock per covered worker (sorted to avoid
  // deadlocks) makes the second writer wait and then see the first's
  // committed row. Locks release automatically at commit/rollback.
  // Read-only "check" callers skip locking — they are advisory previews and
  // the write-time assert remains the real enforcement point.
  if (opts.lock) {
    for (const workerId of [...coveredList].sort()) {
      await client.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${'trust-election-coverage:' + workerId}, 0))`,
      );
    }
  }

  // Any other subscriber's election covering one of our people as a
  // dependent must reference a relationship row that touches that person.
  const candidateRels = await client
    .select({
      id: workerRelations.id,
      worker1: workerRelations.worker1,
      worker2: workerRelations.worker2,
    })
    .from(workerRelations)
    .where(
      or(
        inArray(workerRelations.worker1, coveredList),
        inArray(workerRelations.worker2, coveredList),
      ),
    );
  const candidateRelMap = new Map(candidateRels.map((r) => [r.id, r]));

  const conds: SQL[] = [
    ne(workerTrustElections.workerId, subscriberId),
    // Date-range overlap: the other election has not ended before ours
    // starts, and (when ours has an end) it starts no later than our end.
    or(
      isNull(workerTrustElections.endYmd),
      gte(workerTrustElections.endYmd, startYmd),
    )!,
  ];
  if (endYmd) conds.push(lte(workerTrustElections.startYmd, endYmd));
  if (excludeElectionId) conds.push(ne(workerTrustElections.id, excludeElectionId));
  const coverageConds: SQL[] = [inArray(workerTrustElections.workerId, coveredList)];
  if (candidateRelMap.size > 0) {
    coverageConds.push(
      arrayOverlaps(
        workerTrustElections.relationshipIds,
        Array.from(candidateRelMap.keys()),
      ),
    );
  }
  conds.push(or(...coverageConds)!);

  const overlapping = await client
    .select()
    .from(workerTrustElections)
    .where(and(...conds));
  if (overlapping.length === 0) return [];

  const conflicts: DualCoverageConflict[] = [];
  const seen = new Set<string>();
  const push = (c: DualCoverageConflict) => {
    const key = `${c.workerId}:${c.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push(c);
  };

  for (const e of overlapping) {
    // One of our covered people is the subscriber of the other election.
    if (coveredIds.has(e.workerId)) {
      const personName = await getWorkerFullName(client, e.workerId);
      push({
        field: 'relationshipIds',
        workerId: e.workerId,
        relationshipId: ownRelIdByWorker.get(e.workerId) ?? null,
        message: `${personName} already has their own ${describeConflictWindow(e)} and cannot also be covered here for an overlapping period. A person cannot be covered by two elections at the same time.`,
      });
    }
    // One of our covered people is a dependent on the other election.
    for (const relId of e.relationshipIds ?? []) {
      const rel = candidateRelMap.get(relId);
      if (!rel) continue;
      for (const side of [rel.worker1, rel.worker2]) {
        if (side === e.workerId || !coveredIds.has(side)) continue;
        const [personName, otherSubscriberName] = await Promise.all([
          getWorkerFullName(client, side),
          getWorkerFullName(client, e.workerId),
        ]);
        push({
          field: side === subscriberId ? 'workerId' : 'relationshipIds',
          workerId: side,
          relationshipId:
            side === subscriberId ? null : (ownRelIdByWorker.get(side) ?? null),
          message: `${personName} is already covered under ${otherSubscriberName}'s ${describeConflictWindow(e)}. A person cannot be covered by two elections at the same time.`,
        });
      }
    }
  }
  return conflicts;
}

async function assertNoDualCoverage(
  client: ReturnType<typeof getClient>,
  input: DualCoverageInput,
): Promise<void> {
  const conflicts = await collectDualCoverageConflicts(client, input, {
    lock: true,
  });
  if (conflicts.length > 0) {
    throw new WorkerTrustElectionValidationError(
      conflicts[0].field,
      conflicts[0].message,
    );
  }
}

interface ElectionBeforeState {
  election: WorkerTrustElection | undefined;
}

async function describeElection(
  workerId: string | null | undefined,
  startYmd: string | null | undefined,
): Promise<string> {
  const startPart = startYmd ? ` (start ${startYmd})` : '';
  if (!workerId) return `unknown worker${startPart}`;
  const { storage } = await import('../index');
  const name = await storage.workers.getWorkerDisplayName(workerId);
  return `${name}${startPart}`;
}

export const workerTrustElectionsLoggingConfig = defineLoggingConfig<WorkerTrustElectionsStorage>({
  module: 'worker-trust-elections',
  state: { key: 'election' },
  getter: 'getById',
  hostEntityId: (args, result, before) =>
    (before as ElectionBeforeState | undefined)?.election?.workerId
    ?? result?.workerId
    ?? args[0],
  methods: {
    create: {
      getEntityId: (_args, result) => result?.id || 'new election',
      getDescription: async (_args, result) =>
        `Created trust election for ${await describeElection(result?.workerId, result?.startYmd)}`,
    },
    update: {
      getDescription: async (_args, result, beforeState) => {
        const r = result || (beforeState as ElectionBeforeState | undefined)?.election;
        return `Updated trust election for ${await describeElection(r?.workerId, r?.startYmd)}`;
      },
    },
    delete: {
      getDescription: async (_args, _result, beforeState) => {
        const r = (beforeState as ElectionBeforeState | undefined)?.election;
        if (!r) return 'Deleted trust election';
        return `Deleted trust election for ${await describeElection(r.workerId, r.startYmd)}`;
      },
    },
  },
});

export function createWorkerTrustElectionsStorage(): WorkerTrustElectionsStorage {
  const storage: WorkerTrustElectionsStorage = {
    async search(params): Promise<WorkerTrustElection[]> {
      const client = getClient();
      const conds: SQL[] = [];
      if (params.id) conds.push(eq(workerTrustElections.id, params.id));
      if (params.workerId) conds.push(eq(workerTrustElections.workerId, params.workerId));
      if (params.policyId) conds.push(eq(workerTrustElections.policyId, params.policyId));
      if (params.enrollmentType) conds.push(eq(workerTrustElections.enrollmentType, params.enrollmentType));
      if (params.activeOnly) {
        conds.push(isNull(workerTrustElections.endYmd));
      }
      const where = conds.length > 0 ? and(...conds) : undefined;
      const order = params.sort === 'startAsc'
        ? asc(workerTrustElections.startYmd)
        : desc(workerTrustElections.startYmd);
      const base = client.select().from(workerTrustElections).$dynamic();
      const filtered = where ? base.where(where) : base;
      const ordered = filtered.orderBy(order);
      const limited = params.limit !== undefined ? ordered.limit(params.limit) : ordered;
      const final = params.offset !== undefined ? limited.offset(params.offset) : limited;
      return await final;
    },

    async getById(id) {
      const rows = await storage.search({ id, limit: 1 });
      return rows[0];
    },

    async listByWorker(workerId) {
      return await storage.search({ workerId, sort: 'startDesc' });
    },

    async getActiveByWorker(workerId) {
      const rows = await storage.search({ workerId, activeOnly: true, sort: 'startDesc', limit: 1 });
      return rows[0];
    },

    async getActiveByWorkerAsOf(workerId, asOfYmd) {
      const client = getClient();
      const rows = await client
        .select()
        .from(workerTrustElections)
        .where(
          and(
            eq(workerTrustElections.workerId, workerId),
            lte(workerTrustElections.startYmd, asOfYmd),
            or(
              isNull(workerTrustElections.endYmd),
              gte(workerTrustElections.endYmd, asOfYmd),
            ),
          ),
        )
        .orderBy(desc(workerTrustElections.startYmd))
        .limit(1);
      return rows[0];
    },

    async hasActiveMedicalOrDentalElection(workerId) {
      const active = await storage.search({ workerId, activeOnly: true });
      const benefitIds = new Set<string>();
      for (const e of active) {
        for (const id of e.benefitIds ?? []) benefitIds.add(id);
      }
      if (benefitIds.size === 0) return false;
      const client = getClient();
      const rows = await client
        .select({ typeName: optionsTrustBenefitType.name })
        .from(trustBenefits)
        .leftJoin(
          optionsTrustBenefitType,
          eq(trustBenefits.benefitType, optionsTrustBenefitType.id),
        )
        .where(inArray(trustBenefits.id, Array.from(benefitIds)));
      return rows.some((r) => {
        const name = (r.typeName ?? '').trim().toLowerCase();
        return name === 'medical' || name === 'dental';
      });
    },

    async checkDualCoverage(input) {
      const client = getClient();
      return await collectDualCoverageConflicts(client, input, { lock: false });
    },

    async searchViews(params) {
      const rows = await storage.search(params);
      return await hydrateElections(rows);
    },

    async getViewById(id) {
      const row = await storage.getById(id);
      if (!row) return undefined;
      const [view] = await hydrateElections([row]);
      return view;
    },

    async getActiveViewByWorker(workerId) {
      const row = await storage.getActiveByWorker(workerId);
      if (!row) return undefined;
      const [view] = await hydrateElections([row]);
      return view;
    },

    async create(workerId, input) {
      const parsed = createWorkerTrustElectionRequestSchema.parse(input);
      const validated = await validateElection({ workerId, ...parsed });
      return await runInTransaction(async () => {
        const client = getClient();
        await assertNoDualCoverage(client, {
          subscriberId: validated.workerId,
          relationshipIds: parsed.relationshipIds,
          startYmd: validated.startYmd,
          endYmd: validated.endYmd,
        });
        if (!validated.endYmd) {
          await endDatePreviousActive(client, validated.workerId, validated.startYmd, undefined);
        }
        const [created] = await client
          .insert(workerTrustElections)
          .values({
            workerId: validated.workerId,
            employerId: validated.employerId,
            policyId: validated.policyId,
            startYmd: validated.startYmd,
            endYmd: validated.endYmd,
            benefitIds: parsed.benefitIds ?? null,
            relationshipIds: parsed.relationshipIds ?? null,
            enrollmentType: parsed.enrollmentType ?? null,
            data: (parsed.data ?? null) as WorkerTrustElection['data'],
          })
          .returning();
        emitTrustElectionSaved(
          created.id,
          created.workerId,
          (created.enrollmentType ?? null) as EnrollmentType | null,
          'created',
        );
        return created;
      });
    },

    async update(id, input) {
      const parsed = updateWorkerTrustElectionRequestSchema.parse(input);
      return await runInTransaction(async () => {
        const client = getClient();
        const [existing] = await client
          .select()
          .from(workerTrustElections)
          .where(eq(workerTrustElections.id, id));
        if (!existing) return undefined;

        const validated = await validateElection(parsed, existing);

        // Re-check dual coverage only when the update could EXPAND coverage
        // (dependents changed, start date changed, or end date removed /
        // pushed later). Pure shrinks — ending or shortening an election —
        // must always succeed so staff can clean up pre-existing conflicts.
        const nextRels =
          parsed.relationshipIds !== undefined
            ? parsed.relationshipIds ?? []
            : existing.relationshipIds ?? [];
        const prevRels = existing.relationshipIds ?? [];
        const relsChanged =
          parsed.relationshipIds !== undefined &&
          (nextRels.length !== prevRels.length ||
            nextRels.some((r) => !prevRels.includes(r)));
        const startChanged = validated.startYmd !== existing.startYmd;
        const endExtended =
          existing.endYmd !== null &&
          (validated.endYmd === null || validated.endYmd > existing.endYmd);
        if (relsChanged || startChanged || endExtended) {
          await assertNoDualCoverage(client, {
            subscriberId: existing.workerId,
            relationshipIds: nextRels,
            startYmd: validated.startYmd,
            endYmd: validated.endYmd,
            excludeElectionId: id,
          });
        }

        if (!validated.endYmd) {
          await endDatePreviousActive(client, existing.workerId, validated.startYmd, id);
        }

        const updateValues: Record<string, unknown> = {
          employerId: validated.employerId,
          policyId: validated.policyId,
          startYmd: validated.startYmd,
          endYmd: validated.endYmd,
        };
        if (parsed.benefitIds !== undefined) updateValues.benefitIds = parsed.benefitIds;
        if (parsed.relationshipIds !== undefined) updateValues.relationshipIds = parsed.relationshipIds;
        if (parsed.enrollmentType !== undefined) updateValues.enrollmentType = parsed.enrollmentType;
        if (parsed.data !== undefined) updateValues.data = parsed.data;

        const [updated] = await client
          .update(workerTrustElections)
          .set(updateValues)
          .where(eq(workerTrustElections.id, id))
          .returning();
        emitTrustElectionSaved(
          updated.id,
          updated.workerId,
          (updated.enrollmentType ?? null) as EnrollmentType | null,
          'updated',
        );
        return updated;
      });
    },

    async delete(id) {
      const client = getClient();
      const [deleted] = await client
        .delete(workerTrustElections)
        .where(eq(workerTrustElections.id, id))
        .returning();
      if (deleted) {
        emitTrustElectionSaved(
          deleted.id,
          deleted.workerId,
          (deleted.enrollmentType ?? null) as EnrollmentType | null,
          'deleted',
        );
      }
      return !!deleted;
    },
  };
  return storage;
}

async function endDatePreviousActive(
  client: ReturnType<typeof getClient>,
  workerId: string,
  newStartYmd: string,
  excludeId: string | undefined,
): Promise<void> {
  const conds: SQL[] = [
    eq(workerTrustElections.workerId, workerId),
    isNull(workerTrustElections.endYmd),
  ];
  if (excludeId) conds.push(ne(workerTrustElections.id, excludeId));
  const others = await client
    .select()
    .from(workerTrustElections)
    .where(and(...conds));
  const newEnd = ymdMinusOneDay(newStartYmd);
  for (const prior of others) {
    if (prior.startYmd && prior.startYmd > newEnd) {
      throw new WorkerTrustElectionValidationError(
        'startYmd',
        `Cannot create an active election starting ${newStartYmd}: an existing active election starts on ${prior.startYmd} (after the new end-date of ${newEnd}).`,
      );
    }
    await client
      .update(workerTrustElections)
      .set({ endYmd: newEnd })
      .where(eq(workerTrustElections.id, prior.id));
  }
}
