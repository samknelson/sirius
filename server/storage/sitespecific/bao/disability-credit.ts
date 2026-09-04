/**
 * Disability Credit (DC) storage — component-owned persistence for the DC
 * case workflow (cases + lifecycle, case months, denial letters, documents
 * with supersession, and the idempotent DC event log).
 *
 * Integrity model:
 * - One non-removed case month per worker/work-month (partial unique index);
 *   concurrent writers are serialized by a per-worker advisory lock so the
 *   violating writer gets a coded error instead of a raw 23505.
 * - A SECOND open case per worker is allowed only with an explicit duplicate
 *   confirmation (`allowDuplicate`), enforced under the same advisory lock.
 * - Case lifecycle transitions follow the shared transition map; terminal
 *   transitions (denied/withdrawn/void) REQUIRE a reason — coded errors
 *   here, CHECK constraints in the schema. `expectedStatus` gives callers a
 *   compare-and-set guard against stale concurrent actions.
 * - Month selection is FULL-SET replace, validated in-transaction under the
 *   worker's lock by the caller-supplied validator (the DC workflow service
 *   runs the shared coverage-axis validator over its month map), so
 *   concurrent cases cannot over-allocate the same worker/month or year.
 * - Documents are never deleted; superseding marks them. Case history lives
 *   in the typed event log (bounce reasons ride the case_status_changed
 *   payload) — the bespoke DC notes table was retired in migration 014.
 * - Every lifecycle write records a typed row in sitespecific_bao_dc_events
 *   keyed by a deterministic dedupe key, INSERT .. ON CONFLICT DO NOTHING
 *   RETURNING. Only the insert that CLAIMS the row schedules a bus emission
 *   (after commit), so repeating an operation never double-emits.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  sql,
  getTableName,
} from "drizzle-orm";
import { getClient, runInTransaction, onAfterCommit } from "../../transaction-context";
import { eventBus, EventType } from "../../../services/event-bus";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  optionsEmploymentStatus,
  workerHours,
  trustWmb,
  files,
  employers,
  workers,
  contacts,
  BAO_DC_FUND_EMPLOYER_SIRIUS_ID,
  BAO_DC_FUND_EMPLOYER_NAME,
  BAO_DC_EMPLOYMENT_STATUS_CODE,
  BAO_DC_EMPLOYMENT_STATUS_NAME,
  sitespecificBaoDcCases,
  sitespecificBaoDcCaseMonths,
  sitespecificBaoDcDenialLetters,
  sitespecificBaoDcDocuments,
  sitespecificBaoDcEvents,
  BAO_DC_TERMINAL_CASE_STATUSES,
  BAO_DC_OPEN_CASE_STATUSES,
  type BaoDcAttestations,
  type BaoDcCase,
  type BaoDcCaseMonth,
  type BaoDcCaseStatus,
  type BaoDcMonthStatus,
  type BaoDcDenialLetter,
  type BaoDcDocument,
  type BaoDcDocumentType,
  type BaoDcEvent,
  type BaoDcEventType,
  type BaoDcIntakeChannel,
  type BaoDcQualifyingBasis,
  type File,
  type InsertBaoDcDenialLetter,
  type InsertBaoDcDocument,
  type InsertFile,
} from "@shared/schema";
import {
  isDcTransitionAllowed,
  type DcSelectionValidation,
} from "@shared/sitespecific/bao/dc-workflow";
import { isRetiredDisabilityStatusOption } from "@shared/sitespecific/bao/dc-eligibility";

const casesTable = sitespecificBaoDcCases;
const monthsTable = sitespecificBaoDcCaseMonths;
const lettersTable = sitespecificBaoDcDenialLetters;
const documentsTable = sitespecificBaoDcDocuments;
const eventsTable = sitespecificBaoDcEvents;

const TERMINAL: readonly string[] = BAO_DC_TERMINAL_CASE_STATUSES;
const OPEN: readonly string[] = BAO_DC_OPEN_CASE_STATUSES;

export interface OpenDcCaseInput {
  /**
   * Optional caller-supplied id (crypto.randomUUID()). Used by member intake
   * to pre-resolve the file-storage path for the case before the row exists,
   * so the bytes-then-rows upload pattern stays atomic per case id.
   */
  id?: string;
  workerId: string;
  openedYmd: string;
  qualifyingBasis: BaoDcQualifyingBasis;
  intakeChannel?: BaoDcIntakeChannel;
  createdByUserId?: string | null;
  /**
   * A second open case for the same worker is refused
   * (Error("DUPLICATE_OPEN_CASE")) unless the caller passes the explicit
   * confirmation flag — the UI warns first, then confirms.
   */
  allowDuplicate?: boolean;
  data?: unknown;
}

export interface TransitionDcCaseInput {
  to: BaoDcCaseStatus;
  actorUserId: string;
  /** Required for terminal targets (denied/withdrawn/void). */
  reason?: string;
  terminalYmd?: string;
  /** Compare-and-set guard: mismatch throws Error("STALE_CASE_STATE"). */
  expectedStatus?: BaoDcCaseStatus;
}

/** Thrown when a month-selection replace fails validation; carries details. */
export class DcSelectionInvalidError extends Error {
  constructor(public readonly validation: DcSelectionValidation) {
    super("MONTH_SELECTION_INVALID");
    this.name = "DcSelectionInvalidError";
  }
}

/**
 * What a month-selection validator resolved, handed back to the replace so
 * the events it records carry the coverage month AS VALIDATED. The case log
 * is the spec's immutable record: a later plan-lag or rule change must never
 * move a historical entry, so storage stamps the snapshot into every
 * selection/deselection event instead of leaving readers to re-derive it.
 */
export interface DcValidatedSelection {
  /**
   * Coverage month per work month, covering the target AND the currently
   * active months (a deselected month's void needs one too); `null` = the
   * validator could not resolve that month's lag right now.
   */
  coverageByWorkMonth: ReadonlyMap<string, string | null>;
}

/** The coverage month a queued/granted month row was stamped with, if any. */
function stampedCoverageMonthOf(data: unknown): string | null {
  const v = (data as { coverageMonthYmd?: unknown } | null)?.coverageMonthYmd;
  return typeof v === "string" && /^\d{4}-\d{2}-01$/.test(v) ? v : null;
}

export interface BaoDcDocumentWithFile extends BaoDcDocument {
  file: File | null;
}

export interface BaoDisabilityCreditStorage {
  tableExists(): Promise<boolean>;

  /**
   * Run `fn` inside a transaction holding the case's per-worker DC advisory
   * lock. ALL readiness-affecting sequences (read evidence → decide →
   * transition, or mutate evidence → recompute → maybe bounce) MUST run under
   * this serialization so a concurrent supersede/reclassify cannot land
   * between an approval's readiness read and its status transition. Nested
   * storage calls join the same transaction (transaction-context ALS); the
   * advisory lock is re-entrant within the session.
   */
  withCaseSerialization<T>(caseId: string, fn: () => Promise<T>): Promise<T>;

  // Cases -----------------------------------------------------------------
  getCase(id: string): Promise<BaoDcCase | undefined>;
  listOpenCasesForWorker(workerId: string): Promise<BaoDcCase[]>;
  listCasesForWorker(workerId: string): Promise<BaoDcCase[]>;
  /** Oldest-first cases in the given status (approval queue read). */
  listCasesByStatus(status: BaoDcCaseStatus): Promise<BaoDcCase[]>;
  openCase(input: OpenDcCaseInput): Promise<BaoDcCase>;
  /**
   * Lifecycle transition following the shared transition map
   * (Error("INVALID_TRANSITION")). Repeating a transition whose target the
   * case already holds is an idempotent no-op. Terminal targets require a
   * reason (Error("TERMINAL_REASON_REQUIRED")). `approved` records the
   * approver. Emits `case_status_changed` at-most-once per hop.
   */
  transitionCase(id: string, input: TransitionDcCaseInput): Promise<BaoDcCase>;
  /** Replace attestations (idempotent when content-identical). */
  updateCaseAttestations(
    id: string,
    attestations: BaoDcAttestations,
    actorUserId: string,
  ): Promise<BaoDcCase>;

  // Case months -------------------------------------------------------------
  listCaseMonths(caseId: string): Promise<BaoDcCaseMonth[]>;
  /**
   * FULL-SET month replace for a draft case: adds missing months, removes
   * deselected ones (with reason). The caller's `validate` runs INSIDE the
   * transaction, after the case row and the worker's DC lock are held, with
   * the de-duplicated sorted target and the currently active months — it
   * must throw (DcSelectionInvalidError / DcGrantError) to refuse, and
   * returns the coverage months it validated with so the `case_month_added`
   * / `case_month_voided` events record that snapshot. The DC workflow
   * service supplies the coverage-axis validator; storage never resolves
   * plan lag or minimums. A target month the validator left unresolved is a
   * contract violation and throws Error("SELECTION_COVERAGE_UNRESOLVED").
   */
  replaceCaseMonths(
    caseId: string,
    workMonthYmds: string[],
    opts: {
      actorUserId: string;
      removalReason?: string;
      validate: (
        theCase: BaoDcCase,
        targetWorkMonthYmds: string[],
        activeWorkMonthYmds: string[],
      ) => Promise<DcValidatedSelection>;
    },
  ): Promise<BaoDcCaseMonth[]>;
  /** Non-removed months for a calendar year — derived usage, never stored. */
  countApplicableMonthsForWorkerYear(workerId: string, year: number): Promise<number>;
  /** All non-removed months across the worker's cases (optionally excluding one case). */
  listApplicableMonthsForWorker(
    workerId: string,
    excludeCaseId?: string,
  ): Promise<BaoDcCaseMonth[]>;
  /**
   * COVERAGE months WMB shows the worker as covered for (first-of-month
   * Ymds, distinct, sorted). One half of the coverage-axis covered set; the
   * other half (work months already at the plan minimum) needs the plan
   * minimum and is derived by the DC month map service.
   */
  getWmbMonthsForWorker(workerId: string): Promise<string[]>;
  /**
   * Qualifying (employed or FMLA status) hours per work month for the
   * worker, excluding `excludeEmployerId` (the Fund/DC pseudo-employer) —
   * the SAME filters as `getQualifyingHoursForWorkerMonth`, in bulk. Map
   * key is the first-of-month Ymd; months with no qualifying hours are absent.
   */
  listQualifyingHoursByMonthForWorker(
    workerId: string,
    excludeEmployerId: string | null,
  ): Promise<Map<string, number>>;

  // Denial letters ----------------------------------------------------------
  getDenialLetter(id: string): Promise<BaoDcDenialLetter | undefined>;
  listDenialLettersForWorker(workerId: string): Promise<BaoDcDenialLetter[]>;
  createDenialLetter(entry: InsertBaoDcDenialLetter): Promise<BaoDcDenialLetter>;
  voidDenialLetter(id: string, reason: string, voidedYmd: string): Promise<BaoDcDenialLetter>;

  // Documents (never deleted — superseded instead) ---------------------------
  addDocument(entry: InsertBaoDcDocument): Promise<BaoDcDocument>;
  /** Insert the files row AND the dc_documents row in ONE transaction. */
  attachCaseDocumentWithFile(
    caseId: string,
    file: InsertFile,
    name: string,
    opts: { uploadedByUserId: string; docType?: BaoDcDocumentType },
  ): Promise<BaoDcDocumentWithFile>;
  listDocumentsForCase(caseId: string): Promise<BaoDcDocument[]>;
  listCaseDocumentsWithFiles(caseId: string): Promise<BaoDcDocumentWithFile[]>;
  getCaseDocument(caseId: string, documentId: string): Promise<BaoDcDocumentWithFile | undefined>;
  getCaseDocumentByFileId(caseId: string, fileId: string): Promise<BaoDcDocumentWithFile | undefined>;
  updateCaseDocument(
    caseId: string,
    documentId: string,
    updates: { name?: string; data?: unknown; docType?: BaoDcDocumentType },
  ): Promise<BaoDcDocumentWithFile | undefined>;
  listDocumentsForDenialLetter(denialLetterId: string): Promise<BaoDcDocument[]>;
  /** Mark superseded (idempotent). Documents can never be deleted. */
  supersedeDocument(documentId: string, actorUserId: string): Promise<BaoDcDocument>;

  /**
   * Open an EXTENSION case linked to an approved parent case. The parent
   * must be `approved` and stays approved; the extension is a new draft case
   * carrying the parent's qualifying basis, the required reason and the link
   * in `data`, plus a durable `case_extension_requested` event on the parent.
   * Duplicate-open-case confirmation applies as for openCase.
   */
  openCaseExtension(
    parentCaseId: string,
    input: {
      reason: string;
      actorUserId: string;
      openedYmd?: string;
      allowDuplicate?: boolean;
    },
  ): Promise<BaoDcCase>;

  // Event log ----------------------------------------------------------------
  listEventsForWorker(workerId: string): Promise<BaoDcEvent[]>;
  listEventsForCase(caseId: string): Promise<BaoDcEvent[]>;

  // Grant / reconcile primitives (used by the DC grant service) -------------
  /**
   * Run `fn` inside a transaction holding the worker's DC advisory lock —
   * the same lock withCaseSerialization takes, for callers that start from a
   * worker (reconciliation, queued release) instead of a case.
   */
  withWorkerSerialization<T>(workerId: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Get-or-create the Fund/DC pseudo-employer (by reserved sirius id,
   * isActive=false) and the Disability Credit employment-status option
   * (employed=false). Serialized by a global advisory lock so concurrent
   * first grants cannot create duplicates.
   */
  ensureDcFundIdentities(): Promise<{ employerId: string; employmentStatusId: string }>;
  /**
   * Sum of the worker's qualifying hours for a work month: hours > 0 whose
   * employment status is employed OR FMLA, excluding the given employer
   * (the DC pseudo-employer — DC hours never count toward their own
   * shortfall). The DC status itself is employed=false and non-FMLA, so DC
   * rows are excluded twice over.
   */
  getQualifyingHoursForWorkerMonth(
    workerId: string,
    year: number,
    month: number,
    excludeEmployerId: string,
  ): Promise<number>;
  /** Single (worker, employer, month) hours row — id + hours (day 1 rows). */
  getHoursRowsForWorkerEmployerMonth(
    workerId: string,
    employerId: string,
    year: number,
    month: number,
  ): Promise<Array<{ id: string; day: number; hours: number | null }>>;
  getMonthById(monthId: string): Promise<BaoDcCaseMonth | undefined>;
  /** The single non-removed month row for worker + work month, if any. */
  getApplicableMonthForWorkerMonth(
    workerId: string,
    workMonthYmd: string,
  ): Promise<BaoDcCaseMonth | undefined>;
  /** All queued months across workers, oldest work month first. */
  listQueuedMonths(): Promise<BaoDcCaseMonth[]>;
  /**
   * Apply a grant-lifecycle month transition (status/void-reason/data merge)
   * and durably record its typed event under the given dedupe key — one
   * transactional write, at-most-once emission per key.
   */
  applyMonthGrantTransition(
    monthId: string,
    input: {
      status?: BaoDcMonthStatus;
      voidReason?: string | null;
      data?: Record<string, unknown>;
      event: {
        type: BaoDcEventType;
        dedupeKey: string;
        payload: Record<string, unknown>;
      };
    },
  ): Promise<BaoDcCaseMonth>;

  // Reporting reads (live dashboards + exports — never persisted counters) --
  /** All non-removed month rows in the given statuses, oldest first. */
  listMonthsByStatuses(statuses: BaoDcMonthStatus[]): Promise<BaoDcCaseMonth[]>;
  /** Derived usage per (worker, calendar year) over non-removed months. */
  listApplicableMonthCountsByWorkerYear(): Promise<
    Array<{ workerId: string; year: number; used: number }>
  >;
  /** Distinct (worker, month) FMLA rows fund-wide in the ordinal window. */
  listFmlaMonthRows(
    fromMonthYmd: string,
    toMonthYmd: string,
  ): Promise<Array<{ workerId: string; monthYmd: string }>>;
  /** Every non-voided denial letter, fund-wide. */
  listAllNonVoidedDenialLetters(): Promise<BaoDcDenialLetter[]>;
  /** Hours rows reported under the RETIRED Disability employer status. */
  listRetiredDisabilityHoursRows(fromMonthYmd: string): Promise<
    Array<{
      workerId: string;
      employerId: string;
      employerName: string;
      year: number;
      month: number;
      hours: number | null;
      statusName: string;
    }>
  >;
  /** Grant-lifecycle events (granted/released/reconciled), oldest first. */
  listGrantActivityEvents(): Promise<BaoDcEvent[]>;
  /** Currently-granted month rows counted per work month. */
  listGrantedMonthCountsByWorkMonth(): Promise<
    Array<{ workMonthYmd: string; count: number }>
  >;
  /** Distinct months with ANY reported hours rows, per listed worker. */
  listReportedHoursMonthsForWorkers(
    workerIds: string[],
  ): Promise<Array<{ workerId: string; monthYmd: string }>>;
  /** Display references (sirius id + name) for the given workers. */
  getWorkerRefs(
    workerIds: string[],
  ): Promise<Array<{ workerId: string; siriusId: number; name: string }>>;
  /** Most recent DC event per listed worker (latest-activity context). */
  getLatestEventPerWorker(
    workerIds: string[],
  ): Promise<Array<{ workerId: string; eventType: BaoDcEventType; createdAt: Date }>>;

  // Eligibility inputs (canonical reads used by the DC eligibility service) --
  getFmlaMonthsForWorker(
    workerId: string,
    fromMonthYmd: string,
    toMonthYmd: string,
  ): Promise<string[]>;
  listNonVoidedDenialLettersForWorker(
    workerId: string,
  ): Promise<Array<Pick<BaoDcDenialLetter, "id" | "letterYmd" | "voidedYmd">>>;
}

function normalizeStatusText(value: string): string {
  return String(value).toLowerCase().replace(/\s+/g, "");
}

/** True when this employment-status option IS the FMLA status. LOA never matches. */
function isFmlaStatusRow(option: { name: string; code: string | null }): boolean {
  return (
    normalizeStatusText(option.name) === "fmla" ||
    normalizeStatusText(option.code || "") === "fmla"
  );
}

/** Transaction-scoped advisory lock serializing DC writers per worker. */
async function lockWorker(workerId: string): Promise<void> {
  const client = getClient();
  await client.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${"bao-dc:" + workerId}, 0))`,
  );
}

/** Canonical stringify with sorted keys — jsonb reorders keys (adopt-compare). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/**
 * Claim-then-emit: durably record the typed DC event keyed by `dedupeKey`;
 * only the INSERT that wins the unique key schedules the bus emission after
 * the surrounding transaction commits. Reruns of the same operation find the
 * key taken and stay silent — at-most-once per dedupe key.
 */
async function recordAndEmitDcEvent(args: {
  eventType: BaoDcEventType;
  workerId: string;
  caseId?: string | null;
  dedupeKey: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const client = getClient();
  const claimed = await client
    .insert(eventsTable)
    .values({
      eventType: args.eventType,
      workerId: args.workerId,
      caseId: args.caseId ?? null,
      dedupeKey: args.dedupeKey,
      payload: args.payload,
    })
    .onConflictDoNothing({ target: eventsTable.dedupeKey })
    .returning({ id: eventsTable.id });
  if (claimed.length === 0) return;

  onAfterCommit(() => {
    if (
      args.eventType === "denial_letter_recorded" ||
      args.eventType === "denial_letter_voided"
    ) {
      void eventBus.emit(EventType.BAO_DC_DENIAL_LETTER_SAVED, {
        denialLetterId: String(args.payload.denialLetterId),
        workerId: args.workerId,
        dcEventType: args.eventType,
        letterYmd: String(args.payload.letterYmd),
      });
    } else {
      void eventBus.emit(EventType.BAO_DC_CASE_SAVED, {
        caseId: String(args.caseId),
        workerId: args.workerId,
        dcEventType: args.eventType,
        workMonthYmd:
          typeof args.payload.workMonthYmd === "string"
            ? args.payload.workMonthYmd
            : null,
      });
    }
  });
}

/** Count prior events of a type on a case — sequence for hop dedupe keys. */
async function countCaseEvents(caseId: string, eventType: BaoDcEventType): Promise<number> {
  const rows = await getClient()
    .select({ count: sql<number>`count(*)::int` })
    .from(eventsTable)
    .where(and(eq(eventsTable.caseId, caseId), eq(eventsTable.eventType, eventType)));
  return rows[0]?.count ?? 0;
}

function docWithFileRow(row: {
  sitespecific_bao_dc_documents: BaoDcDocument;
  files: File | null;
}): BaoDcDocumentWithFile {
  return { ...row.sitespecific_bao_dc_documents, file: row.files ?? null };
}

export function createBaoDisabilityCreditStorage(): BaoDisabilityCreditStorage {
  // tableExists supplies the shared process-lifetime positive cache. Keep
  // this wrapper so the component-specific error contract remains unchanged.
  const requireTables = async (self: BaoDisabilityCreditStorage) => {
    if (!(await self.tableExists())) {
      throw new Error("COMPONENT_TABLE_NOT_FOUND");
    }
  };

  const monthKey = (year: number, month: number): string =>
    `${year}-${String(month).padStart(2, "0")}-01`;

  /** Employment-status ids whose hours qualify: employed, or an FMLA status. */
  const qualifyingStatusIds = async (): Promise<string[]> => {
    const client = getClient();
    const statuses = await client
      .select({
        id: optionsEmploymentStatus.id,
        name: optionsEmploymentStatus.name,
        code: optionsEmploymentStatus.code,
        employed: optionsEmploymentStatus.employed,
      })
      .from(optionsEmploymentStatus);
    return statuses.filter((s) => s.employed || isFmlaStatusRow(s)).map((s) => s.id);
  };

  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(getTableName(casesTable));
    },

    async getCase(id: string): Promise<BaoDcCase | undefined> {
      await requireTables(this);
      const rows = await getClient().select().from(casesTable).where(eq(casesTable.id, id));
      return rows[0];
    },

    async listOpenCasesForWorker(workerId: string): Promise<BaoDcCase[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(casesTable)
        .where(
          and(
            eq(casesTable.workerId, workerId),
            inArray(casesTable.status, [...OPEN] as BaoDcCaseStatus[]),
          ),
        )
        .orderBy(asc(casesTable.createdAt), asc(casesTable.id));
    },

    async listCasesForWorker(workerId: string): Promise<BaoDcCase[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(casesTable)
        .where(eq(casesTable.workerId, workerId))
        .orderBy(desc(casesTable.openedYmd), desc(casesTable.id));
    },

    async listCasesByStatus(status: BaoDcCaseStatus): Promise<BaoDcCase[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(casesTable)
        .where(eq(casesTable.status, status))
        .orderBy(asc(casesTable.createdAt), asc(casesTable.id));
    },

    async withCaseSerialization<T>(caseId: string, fn: () => Promise<T>): Promise<T> {
      await requireTables(this);
      return runInTransaction(async () => {
        const [theCase] = await getClient()
          .select({ workerId: casesTable.workerId })
          .from(casesTable)
          .where(eq(casesTable.id, caseId));
        if (!theCase) throw new Error("CASE_NOT_FOUND");
        await lockWorker(theCase.workerId);
        return fn();
      });
    },

    async openCase(input: OpenDcCaseInput): Promise<BaoDcCase> {
      await requireTables(this);
      if (!input.qualifyingBasis?.conditions?.length) {
        throw new Error("QUALIFYING_BASIS_REQUIRED");
      }
      return runInTransaction(async () => {
        await lockWorker(input.workerId);
        const open = await this.listOpenCasesForWorker(input.workerId);
        if (open.length > 0 && !input.allowDuplicate) {
          throw new Error("DUPLICATE_OPEN_CASE");
        }
        const [created] = await getClient()
          .insert(casesTable)
          .values({
            ...(input.id ? { id: input.id } : {}),
            workerId: input.workerId,
            status: "draft",
            openedYmd: input.openedYmd,
            qualifyingBasis: input.qualifyingBasis,
            intakeChannel: input.intakeChannel ?? "msr",
            createdByUserId: input.createdByUserId ?? null,
            data: input.data ?? null,
          })
          .returning();
        await recordAndEmitDcEvent({
          eventType: "case_opened",
          workerId: created.workerId,
          caseId: created.id,
          dedupeKey: `case_opened:${created.id}`,
          payload: {
            openedYmd: created.openedYmd,
            conditions: input.qualifyingBasis.conditions,
            intakeChannel: created.intakeChannel,
            duplicateConfirmed: open.length > 0,
            // Staff-exception cases carry WHY the exception is being
            // reviewed on the durable event — auditable intake.
            ...(input.qualifyingBasis.exceptionReason
              ? { exceptionReason: input.qualifyingBasis.exceptionReason }
              : {}),
          },
        });
        return created;
      });
    },

    async transitionCase(id: string, input: TransitionDcCaseInput): Promise<BaoDcCase> {
      await requireTables(this);
      const to = input.to;
      const isTerminal = TERMINAL.includes(to);
      if (isTerminal && (!input.reason || !input.reason.trim())) {
        throw new Error("TERMINAL_REASON_REQUIRED");
      }
      return runInTransaction(async () => {
        const client = getClient();
        const rows = await client
          .select()
          .from(casesTable)
          .where(eq(casesTable.id, id))
          .for("update");
        const theCase = rows[0];
        if (!theCase) throw new Error("CASE_NOT_FOUND");
        if (theCase.status === to) return theCase; // idempotent repeat
        if (input.expectedStatus && theCase.status !== input.expectedStatus) {
          throw new Error("STALE_CASE_STATE");
        }
        if (!isDcTransitionAllowed(theCase.status, to)) {
          throw new Error(
            TERMINAL.includes(theCase.status) ? "CASE_ALREADY_TERMINAL" : "INVALID_TRANSITION",
          );
        }
        const [updated] = await client
          .update(casesTable)
          .set({
            status: to,
            terminalReason: isTerminal ? input.reason!.trim() : null,
            terminalYmd: isTerminal
              ? input.terminalYmd ?? new Date().toISOString().slice(0, 10)
              : null,
            ...(to === "approved" ? { approvedByUserId: input.actorUserId } : {}),
          })
          .where(eq(casesTable.id, id))
          .returning();
        const seq = await countCaseEvents(id, "case_status_changed");
        await recordAndEmitDcEvent({
          eventType: "case_status_changed",
          workerId: updated.workerId,
          caseId: updated.id,
          dedupeKey: `case_status_changed:${id}:${seq}:${theCase.status}->${to}`,
          payload: {
            from: theCase.status,
            to,
            actorUserId: input.actorUserId,
            // Non-terminal transitions may carry a reason too (e.g. bounce
            // back to draft) — history lives in the event payload, not notes.
            ...(isTerminal
              ? { reason: input.reason!.trim(), terminalYmd: updated.terminalYmd }
              : input.reason?.trim()
                ? { reason: input.reason.trim() }
                : {}),
          },
        });
        return updated;
      });
    },

    async updateCaseAttestations(
      id: string,
      attestations: BaoDcAttestations,
      actorUserId: string,
    ): Promise<BaoDcCase> {
      await requireTables(this);
      return runInTransaction(async () => {
        const client = getClient();
        const rows = await client
          .select()
          .from(casesTable)
          .where(eq(casesTable.id, id))
          .for("update");
        const theCase = rows[0];
        if (!theCase) throw new Error("CASE_NOT_FOUND");
        if (TERMINAL.includes(theCase.status) || theCase.status === "approved") {
          throw new Error("CASE_NOT_EDITABLE");
        }
        // The manual "DC form on file" attestation can only be set while a
        // CURRENT (non-superseded) document is classified as a DC form —
        // upload alone never attests, and a bare flag can't fake the doc.
        if (attestations.dcFormOnFile === true) {
          const docRows = await client
            .select({ id: documentsTable.id })
            .from(documentsTable)
            .where(
              and(
                eq(documentsTable.caseId, id),
                eq(documentsTable.docType, "dc_form"),
                isNull(documentsTable.supersededAt),
              ),
            );
          if (docRows.length === 0) {
            throw new Error("DC_FORM_ATTESTATION_REQUIRES_FORM");
          }
        }
        const strip = ({ updatedAt, updatedByUserId, ...rest }: BaoDcAttestations) => rest;
        if (canonicalJson(strip(theCase.attestations ?? {})) === canonicalJson(strip(attestations))) {
          return theCase; // idempotent repeat — no event
        }
        const stamped: BaoDcAttestations = {
          ...strip(attestations),
          updatedByUserId: actorUserId,
          updatedAt: new Date().toISOString(),
        };
        const [updated] = await client
          .update(casesTable)
          .set({ attestations: stamped })
          .where(eq(casesTable.id, id))
          .returning();
        const seq = await countCaseEvents(id, "attestations_updated");
        await recordAndEmitDcEvent({
          eventType: "attestations_updated",
          workerId: updated.workerId,
          caseId: id,
          dedupeKey: `attestations_updated:${id}:${seq}`,
          payload: { actorUserId, attestations: strip(stamped) },
        });
        return updated;
      });
    },

    async listCaseMonths(caseId: string): Promise<BaoDcCaseMonth[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(monthsTable)
        .where(eq(monthsTable.caseId, caseId))
        .orderBy(asc(monthsTable.workMonthYmd), asc(monthsTable.id));
    },

    async replaceCaseMonths(
      caseId: string,
      workMonthYmds: string[],
      opts: {
        actorUserId: string;
        removalReason?: string;
        validate: (
          theCase: BaoDcCase,
          targetWorkMonthYmds: string[],
          activeWorkMonthYmds: string[],
        ) => Promise<DcValidatedSelection>;
      },
    ): Promise<BaoDcCaseMonth[]> {
      await requireTables(this);
      const target = Array.from(new Set(workMonthYmds)).sort();
      return runInTransaction(async () => {
        const client = getClient();
        const [theCase] = await client
          .select()
          .from(casesTable)
          .where(eq(casesTable.id, caseId))
          .for("update");
        if (!theCase) throw new Error("CASE_NOT_FOUND");
        if (theCase.status !== "draft") throw new Error("MONTHS_ONLY_IN_DRAFT");
        await lockWorker(theCase.workerId);

        const current = await this.listCaseMonths(caseId);
        const active = current.filter((m) => m.status !== "removed");
        const notEditable = active.filter((m) => m.status !== "selected");
        if (notEditable.length > 0) throw new Error("MONTH_NOT_EDITABLE");

        // Coverage-axis validation, under the same lock and in this tx so the
        // other-case / hours / WMB reads it makes are consistent with the
        // writes below. Throws to refuse; returns the coverage snapshot the
        // events below are stamped with.
        const validated = await opts.validate(
          theCase,
          target,
          active.map((m) => m.workMonthYmd),
        );

        const activeSet = new Set(active.map((m) => m.workMonthYmd));
        const targetSet = new Set(target);

        for (const month of active) {
          if (targetSet.has(month.workMonthYmd)) continue;
          const [removed] = await client
            .update(monthsTable)
            .set({
              status: "removed",
              voidReason: opts.removalReason?.trim() || "deselected",
            })
            .where(eq(monthsTable.id, month.id))
            .returning();
          await recordAndEmitDcEvent({
            eventType: "case_month_voided",
            workerId: removed.workerId,
            caseId,
            dedupeKey: `case_month_voided:${removed.id}`,
            payload: {
              workMonthYmd: removed.workMonthYmd,
              // A selected month carries no grant stamp, so the validator's
              // snapshot is the record; null = unresolvable at this moment,
              // which the log shows as such rather than re-deriving later.
              coverageMonthYmd:
                stampedCoverageMonthOf(removed.data) ??
                validated.coverageByWorkMonth.get(removed.workMonthYmd) ??
                null,
              reason: removed.voidReason,
              actorUserId: opts.actorUserId,
            },
          });
        }

        for (const ymd of target) {
          if (activeSet.has(ymd)) continue;
          const coverageMonthYmd = validated.coverageByWorkMonth.get(ymd) ?? null;
          if (!coverageMonthYmd) {
            // The validator accepted a month it did not resolve — refuse
            // rather than record a selection entry with no coverage month.
            throw new Error(`SELECTION_COVERAGE_UNRESOLVED:${ymd}`);
          }
          const [created] = await client
            .insert(monthsTable)
            .values({
              caseId,
              workerId: theCase.workerId,
              workMonthYmd: ymd,
              status: "selected",
              data: null,
            })
            .returning();
          await recordAndEmitDcEvent({
            eventType: "case_month_added",
            workerId: theCase.workerId,
            caseId,
            dedupeKey: `case_month_added:${created.id}`,
            payload: { workMonthYmd: ymd, coverageMonthYmd, actorUserId: opts.actorUserId },
          });
        }

        return this.listCaseMonths(caseId);
      });
    },

    async countApplicableMonthsForWorkerYear(workerId: string, year: number): Promise<number> {
      await requireTables(this);
      const rows = await getClient()
        .select({ count: sql<number>`count(*)::int` })
        .from(monthsTable)
        .where(
          and(
            eq(monthsTable.workerId, workerId),
            ne(monthsTable.status, "removed"),
            sql`EXTRACT(YEAR FROM ${monthsTable.workMonthYmd}) = ${year}`,
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async listApplicableMonthsForWorker(
      workerId: string,
      excludeCaseId?: string,
    ): Promise<BaoDcCaseMonth[]> {
      await requireTables(this);
      const conditions = [
        eq(monthsTable.workerId, workerId),
        ne(monthsTable.status, "removed"),
      ];
      if (excludeCaseId) conditions.push(ne(monthsTable.caseId, excludeCaseId));
      return getClient()
        .select()
        .from(monthsTable)
        .where(and(...conditions))
        .orderBy(asc(monthsTable.workMonthYmd), asc(monthsTable.id));
    },

    async getWmbMonthsForWorker(workerId: string): Promise<string[]> {
      await requireTables(this);
      const rows = await getClient()
        .selectDistinct({ year: trustWmb.year, month: trustWmb.month })
        .from(trustWmb)
        .where(eq(trustWmb.workerId, workerId));
      return rows.map((r) => monthKey(r.year, r.month)).sort();
    },

    async listQualifyingHoursByMonthForWorker(
      workerId: string,
      excludeEmployerId: string | null,
    ): Promise<Map<string, number>> {
      await requireTables(this);
      const statusIds = await qualifyingStatusIds();
      const byMonth = new Map<string, number>();
      if (statusIds.length === 0) return byMonth;
      const conditions = [
        eq(workerHours.workerId, workerId),
        sql`${workerHours.hours} > 0`,
        inArray(workerHours.employmentStatusId, statusIds),
      ];
      if (excludeEmployerId) conditions.push(ne(workerHours.employerId, excludeEmployerId));
      const rows = await getClient()
        .select({
          year: workerHours.year,
          month: workerHours.month,
          hours: sql<number>`coalesce(sum(${workerHours.hours}), 0)::float`,
        })
        .from(workerHours)
        .where(and(...conditions))
        .groupBy(workerHours.year, workerHours.month);
      for (const r of rows) byMonth.set(monthKey(r.year, r.month), Number(r.hours) || 0);
      return byMonth;
    },

    async getDenialLetter(id: string): Promise<BaoDcDenialLetter | undefined> {
      await requireTables(this);
      const rows = await getClient()
        .select()
        .from(lettersTable)
        .where(eq(lettersTable.id, id));
      return rows[0];
    },

    async listDenialLettersForWorker(workerId: string): Promise<BaoDcDenialLetter[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(lettersTable)
        .where(eq(lettersTable.workerId, workerId))
        .orderBy(desc(lettersTable.letterYmd), desc(lettersTable.id));
    },

    async createDenialLetter(entry: InsertBaoDcDenialLetter): Promise<BaoDcDenialLetter> {
      await requireTables(this);
      return runInTransaction(async () => {
        const [created] = await getClient().insert(lettersTable).values(entry).returning();
        await recordAndEmitDcEvent({
          eventType: "denial_letter_recorded",
          workerId: created.workerId,
          dedupeKey: `denial_letter_recorded:${created.id}`,
          payload: { denialLetterId: created.id, letterYmd: created.letterYmd },
        });
        return created;
      });
    },

    async voidDenialLetter(
      id: string,
      reason: string,
      voidedYmd: string,
    ): Promise<BaoDcDenialLetter> {
      await requireTables(this);
      if (!reason || !reason.trim()) {
        throw new Error("VOID_REASON_REQUIRED");
      }
      return runInTransaction(async () => {
        const client = getClient();
        const rows = await client
          .select()
          .from(lettersTable)
          .where(eq(lettersTable.id, id))
          .for("update");
        const letter = rows[0];
        if (!letter) throw new Error("DENIAL_LETTER_NOT_FOUND");
        if (letter.voidedYmd) return letter; // idempotent repeat
        const [updated] = await client
          .update(lettersTable)
          .set({ voidedYmd, voidReason: reason.trim() })
          .where(eq(lettersTable.id, id))
          .returning();
        await recordAndEmitDcEvent({
          eventType: "denial_letter_voided",
          workerId: updated.workerId,
          dedupeKey: `denial_letter_voided:${updated.id}`,
          payload: { denialLetterId: updated.id, letterYmd: updated.letterYmd },
        });
        return updated;
      });
    },

    async addDocument(entry: InsertBaoDcDocument): Promise<BaoDcDocument> {
      await requireTables(this);
      return runInTransaction(async () => {
        const [created] = await getClient().insert(documentsTable).values(entry).returning();
        if (created.caseId) {
          const theCase = await this.getCase(created.caseId);
          if (theCase) {
            await recordAndEmitDcEvent({
              eventType: "document_uploaded",
              workerId: theCase.workerId,
              caseId: created.caseId,
              dedupeKey: `document_uploaded:${created.id}`,
              payload: {
                documentId: created.id,
                docType: created.docType,
                uploadedByUserId: created.uploadedByUserId,
              },
            });
          }
        }
        return created;
      });
    },

    async attachCaseDocumentWithFile(
      caseId: string,
      file: InsertFile,
      name: string,
      opts: { uploadedByUserId: string; docType?: BaoDcDocumentType },
    ): Promise<BaoDcDocumentWithFile> {
      await requireTables(this);
      return runInTransaction(async () => {
        const client = getClient();
        const theCase = await this.getCase(caseId);
        if (!theCase) throw new Error("CASE_NOT_FOUND");
        const [fileRow] = await client.insert(files).values(file).returning();
        const [created] = await client
          .insert(documentsTable)
          .values({
            caseId,
            parentKind: "case",
            fileId: fileRow.id,
            name,
            contentType: fileRow.mimeType ?? null,
            uploadedByUserId: opts.uploadedByUserId,
            docType: opts.docType ?? "other",
          })
          .returning();
        await recordAndEmitDcEvent({
          eventType: "document_uploaded",
          workerId: theCase.workerId,
          caseId,
          dedupeKey: `document_uploaded:${created.id}`,
          payload: {
            documentId: created.id,
            docType: created.docType,
            uploadedByUserId: created.uploadedByUserId,
          },
        });
        return { ...created, file: fileRow };
      });
    },

    async listDocumentsForCase(caseId: string): Promise<BaoDcDocument[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.caseId, caseId))
        .orderBy(asc(documentsTable.createdAt), asc(documentsTable.id));
    },

    async listCaseDocumentsWithFiles(caseId: string): Promise<BaoDcDocumentWithFile[]> {
      await requireTables(this);
      const rows = await getClient()
        .select()
        .from(documentsTable)
        .leftJoin(files, eq(documentsTable.fileId, files.id))
        .where(eq(documentsTable.caseId, caseId))
        .orderBy(asc(documentsTable.createdAt), asc(documentsTable.id));
      return rows.map(docWithFileRow);
    },

    async getCaseDocument(
      caseId: string,
      documentId: string,
    ): Promise<BaoDcDocumentWithFile | undefined> {
      await requireTables(this);
      const rows = await getClient()
        .select()
        .from(documentsTable)
        .leftJoin(files, eq(documentsTable.fileId, files.id))
        .where(and(eq(documentsTable.caseId, caseId), eq(documentsTable.id, documentId)));
      return rows[0] ? docWithFileRow(rows[0]) : undefined;
    },

    async getCaseDocumentByFileId(
      caseId: string,
      fileId: string,
    ): Promise<BaoDcDocumentWithFile | undefined> {
      await requireTables(this);
      const rows = await getClient()
        .select()
        .from(documentsTable)
        .leftJoin(files, eq(documentsTable.fileId, files.id))
        .where(and(eq(documentsTable.caseId, caseId), eq(documentsTable.fileId, fileId)));
      return rows[0] ? docWithFileRow(rows[0]) : undefined;
    },

    async updateCaseDocument(
      caseId: string,
      documentId: string,
      updates: { name?: string; data?: unknown; docType?: BaoDcDocumentType },
    ): Promise<BaoDcDocumentWithFile | undefined> {
      await requireTables(this);
      const set: Record<string, unknown> = {};
      if (updates.name !== undefined) set.name = updates.name;
      if (updates.data !== undefined) set.data = updates.data;
      if (updates.docType !== undefined) set.docType = updates.docType;
      if (Object.keys(set).length === 0) {
        return this.getCaseDocument(caseId, documentId);
      }
      const [updated] = await getClient()
        .update(documentsTable)
        .set(set)
        .where(and(eq(documentsTable.caseId, caseId), eq(documentsTable.id, documentId)))
        .returning();
      if (!updated) return undefined;
      return this.getCaseDocument(caseId, documentId);
    },

    async listDocumentsForDenialLetter(denialLetterId: string): Promise<BaoDcDocument[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.denialLetterId, denialLetterId))
        .orderBy(asc(documentsTable.createdAt), asc(documentsTable.id));
    },

    async supersedeDocument(documentId: string, actorUserId: string): Promise<BaoDcDocument> {
      await requireTables(this);
      return runInTransaction(async () => {
        const client = getClient();
        const rows = await client
          .select()
          .from(documentsTable)
          .where(eq(documentsTable.id, documentId))
          .for("update");
        const doc = rows[0];
        if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
        if (doc.supersededAt) return doc; // idempotent repeat
        const [updated] = await client
          .update(documentsTable)
          .set({ supersededAt: new Date(), supersededByUserId: actorUserId })
          .where(eq(documentsTable.id, documentId))
          .returning();
        // Resolve the worker for the event via whichever parent exists.
        let workerId: string | undefined;
        let caseId: string | null = updated.caseId;
        if (updated.caseId) {
          workerId = (await this.getCase(updated.caseId))?.workerId;
        } else if (updated.denialLetterId) {
          workerId = (await this.getDenialLetter(updated.denialLetterId))?.workerId;
        }
        if (workerId) {
          await recordAndEmitDcEvent({
            eventType: "document_superseded",
            workerId,
            caseId,
            dedupeKey: `document_superseded:${updated.id}`,
            payload: { documentId: updated.id, docType: updated.docType, actorUserId },
          });
        }
        return updated;
      });
    },

    async openCaseExtension(
      parentCaseId: string,
      input: {
        reason: string;
        actorUserId: string;
        openedYmd?: string;
        allowDuplicate?: boolean;
      },
    ): Promise<BaoDcCase> {
      await requireTables(this);
      if (!input.reason || !input.reason.trim()) {
        throw new Error("EXTENSION_REASON_REQUIRED");
      }
      return runInTransaction(async () => {
        const client = getClient();
        const [parent] = await client
          .select()
          .from(casesTable)
          .where(eq(casesTable.id, parentCaseId))
          .for("update");
        if (!parent) throw new Error("CASE_NOT_FOUND");
        await lockWorker(parent.workerId);
        if (parent.status !== "approved") {
          throw new Error("EXTENSION_PARENT_NOT_APPROVED");
        }
        const open = await this.listOpenCasesForWorker(parent.workerId);
        if (open.length > 0 && !input.allowDuplicate) {
          throw new Error("DUPLICATE_OPEN_CASE");
        }
        const reason = input.reason.trim();
        const [created] = await client
          .insert(casesTable)
          .values({
            workerId: parent.workerId,
            status: "draft",
            openedYmd: input.openedYmd ?? new Date().toISOString().slice(0, 10),
            // The extension inherits the parent's qualifying snapshot — the
            // original qualification, not a recomputation, backs it.
            qualifyingBasis: parent.qualifyingBasis,
            intakeChannel: "msr",
            createdByUserId: input.actorUserId,
            data: { extensionOfCaseId: parent.id, extensionReason: reason },
          })
          .returning();
        // The request is recorded against the PARENT case; the parent itself
        // never leaves `approved`.
        await recordAndEmitDcEvent({
          eventType: "case_extension_requested",
          workerId: parent.workerId,
          caseId: parent.id,
          dedupeKey: `case_extension_requested:${created.id}`,
          payload: {
            extensionCaseId: created.id,
            reason,
            actorUserId: input.actorUserId,
          },
        });
        await recordAndEmitDcEvent({
          eventType: "case_opened",
          workerId: created.workerId,
          caseId: created.id,
          dedupeKey: `case_opened:${created.id}`,
          payload: {
            openedYmd: created.openedYmd,
            conditions: parent.qualifyingBasis.conditions,
            intakeChannel: created.intakeChannel,
            duplicateConfirmed: open.length > 0,
            extensionOfCaseId: parent.id,
          },
        });
        return created;
      });
    },

    async listEventsForWorker(workerId: string): Promise<BaoDcEvent[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.workerId, workerId))
        .orderBy(asc(eventsTable.createdAt), asc(eventsTable.id));
    },

    async listEventsForCase(caseId: string): Promise<BaoDcEvent[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.caseId, caseId))
        .orderBy(asc(eventsTable.createdAt), asc(eventsTable.id));
    },

    async withWorkerSerialization<T>(workerId: string, fn: () => Promise<T>): Promise<T> {
      await requireTables(this);
      return runInTransaction(async () => {
        await lockWorker(workerId);
        return fn();
      });
    },

    async ensureDcFundIdentities(): Promise<{ employerId: string; employmentStatusId: string }> {
      const client = getClient();
      const findEmployer = async () => {
        const rows = await client
          .select({ id: employers.id })
          .from(employers)
          .where(eq(employers.siriusId, BAO_DC_FUND_EMPLOYER_SIRIUS_ID));
        return rows[0]?.id;
      };
      const isDcStatusRow = (o: { name: string; code: string | null }) =>
        normalizeStatusText(o.code || "") === normalizeStatusText(BAO_DC_EMPLOYMENT_STATUS_CODE) ||
        normalizeStatusText(o.name) === normalizeStatusText(BAO_DC_EMPLOYMENT_STATUS_NAME);
      const findStatus = async () => {
        const rows = await client
          .select({
            id: optionsEmploymentStatus.id,
            name: optionsEmploymentStatus.name,
            code: optionsEmploymentStatus.code,
          })
          .from(optionsEmploymentStatus);
        return rows.find(isDcStatusRow)?.id;
      };

      let employerId = await findEmployer();
      let employmentStatusId = await findStatus();
      if (employerId && employmentStatusId) return { employerId, employmentStatusId };

      // Create missing identities under a global advisory lock so concurrent
      // first grants (different workers → different worker locks) cannot
      // race duplicate rows; the options table has no unique code index.
      return runInTransaction(async () => {
        await client.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('bao-dc-fund-identities', 0))`,
        );
        employerId = await findEmployer();
        if (!employerId) {
          const [created] = await client
            .insert(employers)
            .values({
              name: BAO_DC_FUND_EMPLOYER_NAME,
              siriusId: BAO_DC_FUND_EMPLOYER_SIRIUS_ID,
              // Never an active employer: keeps the pseudo-employer out of
              // active-employer pickers and employer-facing surfaces.
              isActive: false,
            })
            .onConflictDoNothing({ target: employers.siriusId })
            .returning({ id: employers.id });
          employerId = created?.id ?? (await findEmployer());
        }
        employmentStatusId = await findStatus();
        if (!employmentStatusId) {
          const [created] = await client
            .insert(optionsEmploymentStatus)
            .values({
              name: BAO_DC_EMPLOYMENT_STATUS_NAME,
              code: BAO_DC_EMPLOYMENT_STATUS_CODE,
              // employed=false: DC hours must never count as qualifying
              // employer hours (and never make the pseudo-employer look
              // like an "active employer" to threshold resolution).
              employed: false,
              description:
                "System status for Fund-attributed Disability Credit grant hours",
            })
            .returning({ id: optionsEmploymentStatus.id });
          employmentStatusId = created.id;
        }
        if (!employerId || !employmentStatusId) {
          throw new Error("DC_FUND_IDENTITY_PROVISIONING_FAILED");
        }
        return { employerId, employmentStatusId };
      });
    },

    async getQualifyingHoursForWorkerMonth(
      workerId: string,
      year: number,
      month: number,
      excludeEmployerId: string,
    ): Promise<number> {
      const client = getClient();
      const qualifyingIds = await qualifyingStatusIds();
      if (qualifyingIds.length === 0) return 0;
      const rows = await client
        .select({ total: sql<string>`COALESCE(SUM(${workerHours.hours}), 0)` })
        .from(workerHours)
        .where(
          and(
            eq(workerHours.workerId, workerId),
            eq(workerHours.year, year),
            eq(workerHours.month, month),
            ne(workerHours.employerId, excludeEmployerId),
            inArray(workerHours.employmentStatusId, qualifyingIds),
            sql`${workerHours.hours} > 0`,
          ),
        );
      return Number(rows[0]?.total ?? 0);
    },

    async getHoursRowsForWorkerEmployerMonth(
      workerId: string,
      employerId: string,
      year: number,
      month: number,
    ): Promise<Array<{ id: string; day: number; hours: number | null }>> {
      return getClient()
        .select({ id: workerHours.id, day: workerHours.day, hours: workerHours.hours })
        .from(workerHours)
        .where(
          and(
            eq(workerHours.workerId, workerId),
            eq(workerHours.employerId, employerId),
            eq(workerHours.year, year),
            eq(workerHours.month, month),
          ),
        )
        .orderBy(asc(workerHours.day));
    },

    async getMonthById(monthId: string): Promise<BaoDcCaseMonth | undefined> {
      await requireTables(this);
      const rows = await getClient()
        .select()
        .from(monthsTable)
        .where(eq(monthsTable.id, monthId));
      return rows[0];
    },

    async getApplicableMonthForWorkerMonth(
      workerId: string,
      workMonthYmd: string,
    ): Promise<BaoDcCaseMonth | undefined> {
      await requireTables(this);
      const rows = await getClient()
        .select()
        .from(monthsTable)
        .where(
          and(
            eq(monthsTable.workerId, workerId),
            eq(monthsTable.workMonthYmd, workMonthYmd),
            ne(monthsTable.status, "removed"),
          ),
        );
      return rows[0];
    },

    async listQueuedMonths(): Promise<BaoDcCaseMonth[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(monthsTable)
        .where(eq(monthsTable.status, "queued"))
        .orderBy(asc(monthsTable.workMonthYmd), asc(monthsTable.createdAt), asc(monthsTable.id));
    },

    async applyMonthGrantTransition(
      monthId: string,
      input: {
        status?: BaoDcMonthStatus;
        voidReason?: string | null;
        data?: Record<string, unknown>;
        event: {
          type: BaoDcEventType;
          dedupeKey: string;
          payload: Record<string, unknown>;
        };
      },
    ): Promise<BaoDcCaseMonth> {
      await requireTables(this);
      return runInTransaction(async () => {
        const [existing] = await getClient()
          .select()
          .from(monthsTable)
          .where(eq(monthsTable.id, monthId));
        if (!existing) throw new Error("MONTH_NOT_FOUND");
        await lockWorker(existing.workerId);
        const updates: Record<string, unknown> = {};
        if (input.status !== undefined) updates.status = input.status;
        if (input.voidReason !== undefined) updates.voidReason = input.voidReason;
        if (input.data !== undefined) {
          const prior =
            existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
              ? (existing.data as Record<string, unknown>)
              : {};
          updates.data = { ...prior, ...input.data };
        }
        let updated = existing;
        if (Object.keys(updates).length > 0) {
          const rows = await getClient()
            .update(monthsTable)
            .set(updates)
            .where(eq(monthsTable.id, monthId))
            .returning();
          updated = rows[0];
        }
        // Every grant-path event names its month on both axes: the caller's
        // payload wins, else the coverage month the row was stamped with at
        // grant/queue (reconcile events), so the log never needs re-deriving.
        const stampedCoverage = stampedCoverageMonthOf(existing.data);
        await recordAndEmitDcEvent({
          eventType: input.event.type,
          workerId: existing.workerId,
          caseId: existing.caseId,
          dedupeKey: input.event.dedupeKey,
          payload: {
            workMonthYmd: existing.workMonthYmd,
            monthId: existing.id,
            ...(stampedCoverage ? { coverageMonthYmd: stampedCoverage } : {}),
            ...input.event.payload,
          },
        });
        return updated;
      });
    },

    async listMonthsByStatuses(statuses: BaoDcMonthStatus[]): Promise<BaoDcCaseMonth[]> {
      await requireTables(this);
      if (statuses.length === 0) return [];
      return getClient()
        .select()
        .from(monthsTable)
        .where(inArray(monthsTable.status, statuses))
        .orderBy(asc(monthsTable.workMonthYmd), asc(monthsTable.id));
    },

    async listApplicableMonthCountsByWorkerYear(): Promise<
      Array<{ workerId: string; year: number; used: number }>
    > {
      await requireTables(this);
      return getClient()
        .select({
          workerId: monthsTable.workerId,
          year: sql<number>`EXTRACT(YEAR FROM ${monthsTable.workMonthYmd})::int`,
          used: sql<number>`count(*)::int`,
        })
        .from(monthsTable)
        .where(ne(monthsTable.status, "removed"))
        .groupBy(
          monthsTable.workerId,
          sql`EXTRACT(YEAR FROM ${monthsTable.workMonthYmd})`,
        );
    },

    async listFmlaMonthRows(
      fromMonthYmd: string,
      toMonthYmd: string,
    ): Promise<Array<{ workerId: string; monthYmd: string }>> {
      const client = getClient();
      const statuses = await client
        .select({
          id: optionsEmploymentStatus.id,
          name: optionsEmploymentStatus.name,
          code: optionsEmploymentStatus.code,
        })
        .from(optionsEmploymentStatus);
      const fmlaStatusIds = statuses.filter(isFmlaStatusRow).map((s) => s.id);
      if (fmlaStatusIds.length === 0) return [];

      const [fromYear, fromMonth] = fromMonthYmd.split("-").map(Number);
      const [toYear, toMonth] = toMonthYmd.split("-").map(Number);
      const fromOrdinal = fromYear * 12 + (fromMonth - 1);
      const toOrdinal = toYear * 12 + (toMonth - 1);

      const rows = await client
        .selectDistinct({
          workerId: workerHours.workerId,
          year: workerHours.year,
          month: workerHours.month,
        })
        .from(workerHours)
        .where(
          and(
            inArray(workerHours.employmentStatusId, fmlaStatusIds),
            sql`${workerHours.hours} > 0`,
            gte(sql`${workerHours.year} * 12 + (${workerHours.month} - 1)`, fromOrdinal),
            lte(sql`${workerHours.year} * 12 + (${workerHours.month} - 1)`, toOrdinal),
          ),
        );
      return rows.map((r) => ({
        workerId: r.workerId,
        monthYmd: `${r.year}-${String(r.month).padStart(2, "0")}-01`,
      }));
    },

    async listAllNonVoidedDenialLetters(): Promise<BaoDcDenialLetter[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(lettersTable)
        .where(isNull(lettersTable.voidedYmd))
        .orderBy(asc(lettersTable.letterYmd), asc(lettersTable.id));
    },

    async listRetiredDisabilityHoursRows(fromMonthYmd: string): Promise<
      Array<{
        workerId: string;
        employerId: string;
        employerName: string;
        year: number;
        month: number;
        hours: number | null;
        statusName: string;
      }>
    > {
      const client = getClient();
      const statuses = await client
        .select({
          id: optionsEmploymentStatus.id,
          name: optionsEmploymentStatus.name,
          code: optionsEmploymentStatus.code,
        })
        .from(optionsEmploymentStatus);
      const retired = statuses.filter((s) =>
        isRetiredDisabilityStatusOption({ name: s.name, code: s.code }),
      );
      if (retired.length === 0) return [];
      const nameById = new Map(retired.map((s) => [s.id, s.name]));
      const [fromYear, fromMonth] = fromMonthYmd.split("-").map(Number);
      const fromOrdinal = fromYear * 12 + (fromMonth - 1);
      const rows = await client
        .select({
          workerId: workerHours.workerId,
          employerId: workerHours.employerId,
          employerName: employers.name,
          year: workerHours.year,
          month: workerHours.month,
          hours: workerHours.hours,
          employmentStatusId: workerHours.employmentStatusId,
        })
        .from(workerHours)
        .innerJoin(employers, eq(workerHours.employerId, employers.id))
        .where(
          and(
            inArray(
              workerHours.employmentStatusId,
              retired.map((s) => s.id),
            ),
            gte(sql`${workerHours.year} * 12 + (${workerHours.month} - 1)`, fromOrdinal),
          ),
        )
        .orderBy(asc(workerHours.year), asc(workerHours.month));
      return rows.map((r) => ({
        workerId: r.workerId,
        employerId: r.employerId,
        employerName: r.employerName,
        year: r.year,
        month: r.month,
        hours: r.hours,
        statusName: nameById.get(r.employmentStatusId ?? "") ?? "Disability",
      }));
    },

    async listGrantActivityEvents(): Promise<BaoDcEvent[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(eventsTable)
        .where(
          inArray(eventsTable.eventType, [
            "case_month_granted",
            "case_month_released",
            "case_month_reconciled",
          ]),
        )
        .orderBy(asc(eventsTable.createdAt), asc(eventsTable.id));
    },

    async listGrantedMonthCountsByWorkMonth(): Promise<
      Array<{ workMonthYmd: string; count: number }>
    > {
      await requireTables(this);
      return getClient()
        .select({
          workMonthYmd: monthsTable.workMonthYmd,
          count: sql<number>`count(*)::int`,
        })
        .from(monthsTable)
        .where(eq(monthsTable.status, "granted"))
        .groupBy(monthsTable.workMonthYmd)
        .orderBy(asc(monthsTable.workMonthYmd));
    },

    async listReportedHoursMonthsForWorkers(
      workerIds: string[],
    ): Promise<Array<{ workerId: string; monthYmd: string }>> {
      if (workerIds.length === 0) return [];
      const rows = await getClient()
        .selectDistinct({
          workerId: workerHours.workerId,
          year: workerHours.year,
          month: workerHours.month,
        })
        .from(workerHours)
        .where(inArray(workerHours.workerId, workerIds));
      return rows.map((r) => ({
        workerId: r.workerId,
        monthYmd: `${r.year}-${String(r.month).padStart(2, "0")}-01`,
      }));
    },

    async getWorkerRefs(
      workerIds: string[],
    ): Promise<Array<{ workerId: string; siriusId: number; name: string }>> {
      if (workerIds.length === 0) return [];
      const rows = await getClient()
        .select({
          workerId: workers.id,
          siriusId: workers.siriusId,
          name: contacts.displayName,
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(inArray(workers.id, Array.from(new Set(workerIds))));
      return rows;
    },

    async getLatestEventPerWorker(
      workerIds: string[],
    ): Promise<Array<{ workerId: string; eventType: BaoDcEventType; createdAt: Date }>> {
      await requireTables(this);
      if (workerIds.length === 0) return [];
      const rows = await getClient()
        .selectDistinctOn([eventsTable.workerId], {
          workerId: eventsTable.workerId,
          eventType: eventsTable.eventType,
          createdAt: eventsTable.createdAt,
        })
        .from(eventsTable)
        .where(inArray(eventsTable.workerId, Array.from(new Set(workerIds))))
        .orderBy(
          eventsTable.workerId,
          desc(eventsTable.createdAt),
          desc(eventsTable.id),
        );
      return rows;
    },

    async getFmlaMonthsForWorker(
      workerId: string,
      fromMonthYmd: string,
      toMonthYmd: string,
    ): Promise<string[]> {
      const client = getClient();
      const statuses = await client
        .select({
          id: optionsEmploymentStatus.id,
          name: optionsEmploymentStatus.name,
          code: optionsEmploymentStatus.code,
        })
        .from(optionsEmploymentStatus);
      const fmlaStatusIds = statuses.filter(isFmlaStatusRow).map((s) => s.id);
      if (fmlaStatusIds.length === 0) return [];

      const [fromYear, fromMonth] = fromMonthYmd.split("-").map(Number);
      const [toYear, toMonth] = toMonthYmd.split("-").map(Number);
      const fromOrdinal = fromYear * 12 + (fromMonth - 1);
      const toOrdinal = toYear * 12 + (toMonth - 1);

      const rows = await client
        .selectDistinct({ year: workerHours.year, month: workerHours.month })
        .from(workerHours)
        .where(
          and(
            eq(workerHours.workerId, workerId),
            inArray(workerHours.employmentStatusId, fmlaStatusIds),
            sql`${workerHours.hours} > 0`,
            gte(sql`${workerHours.year} * 12 + (${workerHours.month} - 1)`, fromOrdinal),
            lte(sql`${workerHours.year} * 12 + (${workerHours.month} - 1)`, toOrdinal),
          ),
        );
      return rows
        .map((r) => `${r.year}-${String(r.month).padStart(2, "0")}-01`)
        .sort();
    },

    async listNonVoidedDenialLettersForWorker(
      workerId: string,
    ): Promise<Array<Pick<BaoDcDenialLetter, "id" | "letterYmd" | "voidedYmd">>> {
      await requireTables(this);
      return getClient()
        .select({
          id: lettersTable.id,
          letterYmd: lettersTable.letterYmd,
          voidedYmd: lettersTable.voidedYmd,
        })
        .from(lettersTable)
        .where(and(eq(lettersTable.workerId, workerId), isNull(lettersTable.voidedYmd)));
    },
  };
}
