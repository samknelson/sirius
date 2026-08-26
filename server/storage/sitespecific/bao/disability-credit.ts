/**
 * Disability Credit (DC) storage — component-owned persistence for the DC
 * case workflow (cases + lifecycle, case months, denial letters, documents
 * with supersession, append-only case notes, and the idempotent DC event
 * log).
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
 * - Month selection is FULL-SET replace, validated in-transaction against
 *   coverage continuity and annual capacity (shared pure validator), so
 *   concurrent cases cannot over-allocate the same worker/month or year.
 * - Documents are never deleted; superseding marks them. Case notes are
 *   append-only; corrections are new notes linking the corrected one.
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
  sitespecificBaoDcCases,
  sitespecificBaoDcCaseMonths,
  sitespecificBaoDcDenialLetters,
  sitespecificBaoDcDocuments,
  sitespecificBaoDcCaseNotes,
  sitespecificBaoDcEvents,
  BAO_DC_TERMINAL_CASE_STATUSES,
  BAO_DC_OPEN_CASE_STATUSES,
  type BaoDcAttestations,
  type BaoDcCase,
  type BaoDcCaseMonth,
  type BaoDcCaseNote,
  type BaoDcCaseStatus,
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
  validateDcMonthSelection,
  type DcSelectionValidation,
} from "@shared/sitespecific/bao/dc-workflow";

const casesTable = sitespecificBaoDcCases;
const monthsTable = sitespecificBaoDcCaseMonths;
const lettersTable = sitespecificBaoDcDenialLetters;
const documentsTable = sitespecificBaoDcDocuments;
const notesTable = sitespecificBaoDcCaseNotes;
const eventsTable = sitespecificBaoDcEvents;

const TERMINAL: readonly string[] = BAO_DC_TERMINAL_CASE_STATUSES;
const OPEN: readonly string[] = BAO_DC_OPEN_CASE_STATUSES;

export interface OpenDcCaseInput {
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
   * deselected ones (with reason), validated in-transaction for continuity,
   * conflicts and annual capacity (DcSelectionInvalidError on failure).
   */
  replaceCaseMonths(
    caseId: string,
    workMonthYmds: string[],
    opts: { actorUserId: string; removalReason?: string },
  ): Promise<BaoDcCaseMonth[]>;
  /** Read-only validation preview for a proposed full-set selection. */
  validateMonthSelectionForCase(
    caseId: string,
    workMonthYmds: string[],
  ): Promise<DcSelectionValidation>;
  /** Non-removed months for a calendar year — derived usage, never stored. */
  countApplicableMonthsForWorkerYear(workerId: string, year: number): Promise<number>;
  /** All non-removed months across the worker's cases (optionally excluding one case). */
  listApplicableMonthsForWorker(
    workerId: string,
    excludeCaseId?: string,
  ): Promise<BaoDcCaseMonth[]>;
  /**
   * Months the worker already has coverage for: WMB benefit presence plus
   * positive reported hours (first-of-month Ymds, distinct, sorted).
   */
  getCoveredMonthsForWorker(workerId: string): Promise<string[]>;

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

  // Append-only case notes ----------------------------------------------------
  addCaseNote(input: {
    caseId: string;
    authorUserId: string;
    body: string;
    correctsNoteId?: string | null;
  }): Promise<BaoDcCaseNote>;
  listCaseNotes(caseId: string): Promise<BaoDcCaseNote[]>;

  // Event log ----------------------------------------------------------------
  listEventsForWorker(workerId: string): Promise<BaoDcEvent[]>;
  listEventsForCase(caseId: string): Promise<BaoDcEvent[]>;

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
  const requireTables = async (self: BaoDisabilityCreditStorage) => {
    if (!(await self.tableExists())) {
      throw new Error("COMPONENT_TABLE_NOT_FOUND");
    }
  };

  /** Inputs for selection validation, computed with tx-consistent reads. */
  const selectionInputs = async (theCase: BaoDcCase) => {
    const client = getClient();
    const otherRows = await client
      .select()
      .from(monthsTable)
      .where(
        and(
          eq(monthsTable.workerId, theCase.workerId),
          ne(monthsTable.caseId, theCase.id),
          ne(monthsTable.status, "removed"),
        ),
      );
    const covered = await coveredMonths(theCase.workerId);
    return {
      otherCaseMonths: otherRows.map((m) => m.workMonthYmd),
      coveredMonths: covered,
    };
  };

  const coveredMonths = async (workerId: string): Promise<string[]> => {
    const client = getClient();
    const [wmbRows, hourRows] = await Promise.all([
      client
        .selectDistinct({ year: trustWmb.year, month: trustWmb.month })
        .from(trustWmb)
        .where(eq(trustWmb.workerId, workerId)),
      client
        .selectDistinct({ year: workerHours.year, month: workerHours.month })
        .from(workerHours)
        .where(and(eq(workerHours.workerId, workerId), sql`${workerHours.hours} > 0`)),
    ]);
    const set = new Set<string>();
    for (const r of [...wmbRows, ...hourRows]) {
      set.add(`${r.year}-${String(r.month).padStart(2, "0")}-01`);
    }
    return Array.from(set).sort();
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
            ...(isTerminal ? { reason: input.reason!.trim(), terminalYmd: updated.terminalYmd } : {}),
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
      opts: { actorUserId: string; removalReason?: string },
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

        const inputs = await selectionInputs(theCase);
        const validation = validateDcMonthSelection({
          selectedMonths: target,
          ...inputs,
        });
        if (!validation.ok) throw new DcSelectionInvalidError(validation);

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
              reason: removed.voidReason,
              actorUserId: opts.actorUserId,
            },
          });
        }

        for (const ymd of target) {
          if (activeSet.has(ymd)) continue;
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
            payload: { workMonthYmd: ymd, actorUserId: opts.actorUserId },
          });
        }

        return this.listCaseMonths(caseId);
      });
    },

    async validateMonthSelectionForCase(
      caseId: string,
      workMonthYmds: string[],
    ): Promise<DcSelectionValidation> {
      await requireTables(this);
      const theCase = await this.getCase(caseId);
      if (!theCase) throw new Error("CASE_NOT_FOUND");
      const inputs = await selectionInputs(theCase);
      return validateDcMonthSelection({
        selectedMonths: Array.from(new Set(workMonthYmds)).sort(),
        ...inputs,
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

    async getCoveredMonthsForWorker(workerId: string): Promise<string[]> {
      await requireTables(this);
      return coveredMonths(workerId);
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

    async addCaseNote(input: {
      caseId: string;
      authorUserId: string;
      body: string;
      correctsNoteId?: string | null;
    }): Promise<BaoDcCaseNote> {
      await requireTables(this);
      if (!input.body || !input.body.trim()) {
        throw new Error("NOTE_BODY_REQUIRED");
      }
      return runInTransaction(async () => {
        const client = getClient();
        if (input.correctsNoteId) {
          const [corrected] = await client
            .select()
            .from(notesTable)
            .where(eq(notesTable.id, input.correctsNoteId));
          if (!corrected || corrected.caseId !== input.caseId) {
            throw new Error("CORRECTED_NOTE_NOT_ON_CASE");
          }
        }
        const [created] = await client
          .insert(notesTable)
          .values({
            caseId: input.caseId,
            authorUserId: input.authorUserId,
            body: input.body,
            correctsNoteId: input.correctsNoteId ?? null,
          })
          .returning();
        return created;
      });
    },

    async listCaseNotes(caseId: string): Promise<BaoDcCaseNote[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(notesTable)
        .where(eq(notesTable.caseId, caseId))
        .orderBy(asc(notesTable.createdAt), asc(notesTable.id));
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
