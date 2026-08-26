/**
 * Disability Credit (DC) storage — component-owned persistence for the DC
 * foundation (cases, case months, denial letters, documents, append-only
 * case notes, and the idempotent DC event log).
 *
 * Integrity model:
 * - One live (open) case per worker and one LIVE case month per
 *   worker/work-month are partial unique indexes; concurrent writers are
 *   additionally serialized by a per-worker advisory lock so the violating
 *   writer gets a coded error instead of a raw 23505 where practical.
 * - Terminal transitions (close/void case, void month) REQUIRE a reason —
 *   coded errors here, CHECK constraints in the schema.
 * - Case notes are append-only: there is deliberately NO update or delete.
 *   A correction is a new note that links the note it corrects; the linked
 *   note must belong to the same case.
 * - Every lifecycle write records a typed row in sitespecific_bao_dc_events
 *   keyed by a deterministic dedupe key, INSERT .. ON CONFLICT DO NOTHING
 *   RETURNING. Only the insert that CLAIMS the row schedules a bus emission
 *   (after commit), so repeating an operation never double-emits.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, getTableName } from "drizzle-orm";
import { getClient, runInTransaction, onAfterCommit } from "../../transaction-context";
import { eventBus, EventType } from "../../../services/event-bus";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  optionsEmploymentStatus,
  workerHours,
  sitespecificBaoDcCases,
  sitespecificBaoDcCaseMonths,
  sitespecificBaoDcDenialLetters,
  sitespecificBaoDcDocuments,
  sitespecificBaoDcCaseNotes,
  sitespecificBaoDcEvents,
  type BaoDcCase,
  type BaoDcCaseMonth,
  type BaoDcCaseNote,
  type BaoDcDenialLetter,
  type BaoDcDocument,
  type BaoDcEvent,
  type BaoDcEventType,
  type BaoDcQualifyingBasis,
  type InsertBaoDcDenialLetter,
  type InsertBaoDcDocument,
} from "@shared/schema";

const casesTable = sitespecificBaoDcCases;
const monthsTable = sitespecificBaoDcCaseMonths;
const lettersTable = sitespecificBaoDcDenialLetters;
const documentsTable = sitespecificBaoDcDocuments;
const notesTable = sitespecificBaoDcCaseNotes;
const eventsTable = sitespecificBaoDcEvents;

export interface OpenDcCaseInput {
  workerId: string;
  openedYmd: string;
  qualifyingBasis: BaoDcQualifyingBasis;
  data?: unknown;
}

export interface BaoDisabilityCreditStorage {
  tableExists(): Promise<boolean>;

  // Cases -----------------------------------------------------------------
  getCase(id: string): Promise<BaoDcCase | undefined>;
  getLiveCaseForWorker(workerId: string): Promise<BaoDcCase | undefined>;
  listCasesForWorker(workerId: string): Promise<BaoDcCase[]>;
  /**
   * Open a case with the qualifying-basis snapshot recorded at open. The
   * basis must name at least one qualifying condition. Enforces at most one
   * live case per worker (throws Error("LIVE_CASE_EXISTS")). Idempotent
   * emission: bao.dc case_opened, dedupe-keyed on the created case id.
   */
  openCase(input: OpenDcCaseInput): Promise<BaoDcCase>;
  /**
   * Move an OPEN case to a terminal status; a non-empty reason is required
   * (Error("TERMINAL_REASON_REQUIRED")). Idempotent: re-closing an already
   * terminal case with the same status is a no-op returning the case.
   */
  terminateCase(
    id: string,
    status: "closed" | "void",
    reason: string,
    terminalYmd: string,
  ): Promise<BaoDcCase>;

  // Case months -------------------------------------------------------------
  listCaseMonths(caseId: string): Promise<BaoDcCaseMonth[]>;
  /**
   * Add a LIVE month to an open case. One live month per worker/work-month
   * across all cases (Error("LIVE_MONTH_EXISTS")); the work month must be a
   * first-of-month Ymd. Repeating the identical call is idempotent (returns
   * the existing live row, no second event).
   */
  addCaseMonth(caseId: string, workMonthYmd: string, data?: unknown): Promise<BaoDcCaseMonth>;
  /** Void a live month; requires a reason (Error("VOID_REASON_REQUIRED")). Idempotent. */
  voidCaseMonth(id: string, reason: string): Promise<BaoDcCaseMonth>;
  /** LIVE months for a calendar year — derived annual usage, never a stored counter. */
  countLiveMonthsForWorkerYear(workerId: string, year: number): Promise<number>;

  // Denial letters ----------------------------------------------------------
  getDenialLetter(id: string): Promise<BaoDcDenialLetter | undefined>;
  listDenialLettersForWorker(workerId: string): Promise<BaoDcDenialLetter[]>;
  createDenialLetter(entry: InsertBaoDcDenialLetter): Promise<BaoDcDenialLetter>;
  /** Void a letter; requires a reason (Error("VOID_REASON_REQUIRED")). Idempotent. */
  voidDenialLetter(id: string, reason: string, voidedYmd: string): Promise<BaoDcDenialLetter>;

  // Documents ---------------------------------------------------------------
  addDocument(entry: InsertBaoDcDocument): Promise<BaoDcDocument>;
  listDocumentsForCase(caseId: string): Promise<BaoDcDocument[]>;
  listDocumentsForDenialLetter(denialLetterId: string): Promise<BaoDcDocument[]>;

  // Append-only case notes ----------------------------------------------------
  /**
   * Append a note. `correctsNoteId`, when given, must reference a note on
   * the SAME case (Error("CORRECTED_NOTE_NOT_ON_CASE")). There is no update
   * or delete — corrections are new notes.
   */
  addCaseNote(input: {
    caseId: string;
    authorUserId: string;
    body: string;
    correctsNoteId?: string | null;
  }): Promise<BaoDcCaseNote>;
  listCaseNotes(caseId: string): Promise<BaoDcCaseNote[]>;

  // Event log ----------------------------------------------------------------
  listEventsForWorker(workerId: string): Promise<BaoDcEvent[]>;

  // Eligibility inputs (canonical reads used by the DC eligibility service) --
  /**
   * DISTINCT first-of-month Ymds with positive FMLA-status hours for the
   * worker within [fromMonthYmd, toMonthYmd] (inclusive, first-of-month
   * bounds). Only statuses whose normalized name/code is exactly "fmla"
   * count — LOA never does. A corrected-away month simply stops appearing.
   */
  getFmlaMonthsForWorker(
    workerId: string,
    fromMonthYmd: string,
    toMonthYmd: string,
  ): Promise<string[]>;
  /** Non-voided denial letters for a worker (activity is derived by callers). */
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

export function createBaoDisabilityCreditStorage(): BaoDisabilityCreditStorage {
  const requireTables = async (self: BaoDisabilityCreditStorage) => {
    if (!(await self.tableExists())) {
      throw new Error("COMPONENT_TABLE_NOT_FOUND");
    }
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

    async getLiveCaseForWorker(workerId: string): Promise<BaoDcCase | undefined> {
      await requireTables(this);
      const rows = await getClient()
        .select()
        .from(casesTable)
        .where(and(eq(casesTable.workerId, workerId), eq(casesTable.status, "open")));
      return rows[0];
    },

    async listCasesForWorker(workerId: string): Promise<BaoDcCase[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(casesTable)
        .where(eq(casesTable.workerId, workerId))
        .orderBy(desc(casesTable.openedYmd), desc(casesTable.id));
    },

    async openCase(input: OpenDcCaseInput): Promise<BaoDcCase> {
      await requireTables(this);
      if (!input.qualifyingBasis?.conditions?.length) {
        throw new Error("QUALIFYING_BASIS_REQUIRED");
      }
      return runInTransaction(async () => {
        await lockWorker(input.workerId);
        const existing = await this.getLiveCaseForWorker(input.workerId);
        if (existing) {
          throw new Error("LIVE_CASE_EXISTS");
        }
        const [created] = await getClient()
          .insert(casesTable)
          .values({
            workerId: input.workerId,
            status: "open",
            openedYmd: input.openedYmd,
            qualifyingBasis: input.qualifyingBasis,
            data: input.data ?? null,
          })
          .returning();
        await recordAndEmitDcEvent({
          eventType: "case_opened",
          workerId: created.workerId,
          caseId: created.id,
          dedupeKey: `case_opened:${created.id}`,
          payload: { openedYmd: created.openedYmd, conditions: input.qualifyingBasis.conditions },
        });
        return created;
      });
    },

    async terminateCase(
      id: string,
      status: "closed" | "void",
      reason: string,
      terminalYmd: string,
    ): Promise<BaoDcCase> {
      await requireTables(this);
      if (!reason || !reason.trim()) {
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
        if (theCase.status !== "open") {
          // Idempotent repeat of the same terminal transition; a DIFFERENT
          // terminal transition on a settled case is refused.
          if (theCase.status === status) return theCase;
          throw new Error("CASE_ALREADY_TERMINAL");
        }
        const [updated] = await client
          .update(casesTable)
          .set({ status, terminalReason: reason.trim(), terminalYmd })
          .where(eq(casesTable.id, id))
          .returning();
        await recordAndEmitDcEvent({
          eventType: status === "closed" ? "case_closed" : "case_voided",
          workerId: updated.workerId,
          caseId: updated.id,
          dedupeKey: `case_${status === "closed" ? "closed" : "voided"}:${updated.id}`,
          payload: { terminalYmd, reason: reason.trim() },
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

    async addCaseMonth(
      caseId: string,
      workMonthYmd: string,
      data?: unknown,
    ): Promise<BaoDcCaseMonth> {
      await requireTables(this);
      if (!/^\d{4}-\d{2}-01$/.test(workMonthYmd)) {
        throw new Error("WORK_MONTH_MUST_BE_FIRST_OF_MONTH");
      }
      return runInTransaction(async () => {
        const client = getClient();
        const [theCase] = await client
          .select()
          .from(casesTable)
          .where(eq(casesTable.id, caseId))
          .for("update");
        if (!theCase) throw new Error("CASE_NOT_FOUND");
        if (theCase.status !== "open") throw new Error("CASE_NOT_OPEN");
        await lockWorker(theCase.workerId);
        const existing = await client
          .select()
          .from(monthsTable)
          .where(
            and(
              eq(monthsTable.workerId, theCase.workerId),
              eq(monthsTable.workMonthYmd, workMonthYmd),
              eq(monthsTable.status, "live"),
            ),
          );
        if (existing[0]) {
          if (existing[0].caseId === caseId) return existing[0]; // idempotent repeat
          throw new Error("LIVE_MONTH_EXISTS");
        }
        const [created] = await client
          .insert(monthsTable)
          .values({
            caseId,
            workerId: theCase.workerId,
            workMonthYmd,
            status: "live",
            data: data ?? null,
          })
          .returning();
        await recordAndEmitDcEvent({
          eventType: "case_month_added",
          workerId: theCase.workerId,
          caseId,
          dedupeKey: `case_month_added:${created.id}`,
          payload: { workMonthYmd },
        });
        return created;
      });
    },

    async voidCaseMonth(id: string, reason: string): Promise<BaoDcCaseMonth> {
      await requireTables(this);
      if (!reason || !reason.trim()) {
        throw new Error("VOID_REASON_REQUIRED");
      }
      return runInTransaction(async () => {
        const client = getClient();
        const rows = await client
          .select()
          .from(monthsTable)
          .where(eq(monthsTable.id, id))
          .for("update");
        const month = rows[0];
        if (!month) throw new Error("MONTH_NOT_FOUND");
        if (month.status === "void") return month; // idempotent repeat
        const [updated] = await client
          .update(monthsTable)
          .set({ status: "void", voidReason: reason.trim() })
          .where(eq(monthsTable.id, id))
          .returning();
        await recordAndEmitDcEvent({
          eventType: "case_month_voided",
          workerId: updated.workerId,
          caseId: updated.caseId,
          dedupeKey: `case_month_voided:${updated.id}`,
          payload: { workMonthYmd: updated.workMonthYmd, reason: reason.trim() },
        });
        return updated;
      });
    },

    async countLiveMonthsForWorkerYear(workerId: string, year: number): Promise<number> {
      await requireTables(this);
      const rows = await getClient()
        .select({ count: sql<number>`count(*)::int` })
        .from(monthsTable)
        .where(
          and(
            eq(monthsTable.workerId, workerId),
            eq(monthsTable.status, "live"),
            sql`EXTRACT(YEAR FROM ${monthsTable.workMonthYmd}) = ${year}`,
          ),
        );
      return rows[0]?.count ?? 0;
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
      const [created] = await getClient().insert(documentsTable).values(entry).returning();
      return created;
    },

    async listDocumentsForCase(caseId: string): Promise<BaoDcDocument[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.caseId, caseId))
        .orderBy(asc(documentsTable.createdAt), asc(documentsTable.id));
    },

    async listDocumentsForDenialLetter(denialLetterId: string): Promise<BaoDcDocument[]> {
      await requireTables(this);
      return getClient()
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.denialLetterId, denialLetterId))
        .orderBy(asc(documentsTable.createdAt), asc(documentsTable.id));
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
