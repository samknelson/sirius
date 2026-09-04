/**
 * BAO case storage: generic cases plus the Benefit Appeal workflow.
 *
 * Benefit Appeal facts and where they come from:
 *   - The appealed benefit is a column on the case row; its name is read
 *     live from `trust_benefits`.
 *   - The denial reason is an FK on the one-per-case appeal details row; its
 *     name is read live from the option (the FK is RESTRICT, so the option
 *     outlives every case that cites it).
 *   - The SPD citation is a SNAPSHOT: `create` copies the reason option's
 *     configured citation text into `sitespecific_bao_appeal_details.data`
 *     at auto-denial time, and every read (`detailSelection`, hence the
 *     detail endpoint, the committed status event and the case token kind)
 *     reads that snapshot, never the option. The citation is member-facing
 *     letter text — what the member was told must stay fixed, so editing
 *     the reason later changes future denials only. A reason with no
 *     citation configured snapshots null and reads back null.
 *   `eligibilityPluginIds` on the reason is behaviour applied at approval
 *   time, not member-facing text; it stays on the option and is not copied.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  comm,
  commEmail,
  commPostal,
  notes,
  optionsBaoCaseResolution,
  optionsBaoCaseStatus,
  optionsBaoCaseType,
  optionsBaoAppealDenialReason,
  sitespecificBaoAppealDetails,
  sitespecificBaoCaseComms,
  sitespecificBaoCaseDocuments,
  files,
  trustBenefits,
  optionsNoteType,
  rolePermissions,
  roles,
  sitespecificBaoCaseNotes,
  sitespecificBaoCases,
  userRoles,
  users,
  BAO_APPEAL_OUTCOME_STEPS,
  type BaoAppealDetails,
  type BaoAppealDetailsData,
  type BaoAppealOutcome,
  type BaoCase,
  type BaoCaseAppealFacts,
  type BaoCaseEntityType,
  type InsertBaoCase,
} from "@shared/schema";
import { getClient, onAfterCommit, runInTransaction } from "../../transaction-context";
import { eventBus, EventType } from "../../../services/event-bus";
import { createNotesStorage, type NoteWithDetails } from "../../notes";
import { assignmentForbidden } from "./case-assignment";
import { createBaoNoteTagsStorage } from "./note-tags";
import { tableExists } from "../../utils";

export interface BaoCaseDetails extends BaoCase, BaoCaseAppealFacts {
  entityName: string | null;
  assigneeName: string;
  statusName: string;
  statusClosed: boolean;
  caseTypeName: string;
  workflowStep: string | null;
  resolutionName: string | null;
  /** Appeal: the denial reason's configured checks — what an approval exempts by default. */
  denialReasonEligibilityPluginIds: string[];
  notes?: NoteWithDetails[];
}

export interface BaoCaseListResult {
  items: BaoCaseDetails[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * An appeal's details row with the display values a member letter needs,
 * read together so the three always describe the same appeal: the benefit
 * appealed (off the case), the denial reason's name, and the SPD citation
 * snapshotted onto the appeal at auto-denial (see the header — never the
 * option's current text). Null where the appeal has no such value — a
 * template then renders the token's default, never a stale or borrowed value.
 */
export interface BaoAppealSnapshot extends BaoAppealDetails {
  benefitName: string | null;
  denialReasonName: string | null;
  spdCitation: string | null;
}
export interface CreateBaoCaseInput {
  entityType: BaoCaseEntityType;
  entityId: string;
  deadlineYmd: string;
  statusId: string;
  caseTypeId?: string;
  assigneeUserId: string;
  noteId?: string;
  initialNote?: {
    typeId: string;
    subject: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
    tagIds?: string[];
  };
  actorUserId: string;
  benefitId?: string;
  denialReasonId?: string;
}

/**
 * Actor context for the self-vs-other assignment rule. When supplied,
 * updateLifecycle applies the rule INSIDE its row-locked transaction, so a
 * concurrent reassignment cannot turn an "unchanged assignee" echo into an
 * unauthorized reassignment.
 */
export interface BaoCaseAssignmentContext {
  actorUserId: string;
  canAssignOthers: boolean;
}

/** The locked appeal an approval grants its exemption for. */
export interface BaoAppealExemptionSubject {
  caseId: string;
  subscriberWorkerId: string;
  benefitId: string;
  benefitName: string | null;
  createdAt: Date;
}

export interface BaoAppealOutcomeInput {
  outcome: BaoAppealOutcome;
  actorUserId: string;
  /** Resolution for the outcome's status; that status's configured default when omitted. */
  resolutionId?: string | null;
  /** Resolution date (YYYY-MM-DD); today when omitted. */
  resolutionYmd?: string | null;
  /** Deny: an optional closing note, linked to the case before the outreach-note rule runs. */
  note?: CreateBaoCaseInput["initialNote"] | null;
  /**
   * Approve (required then): grants the exemption INSIDE the outcome's
   * transaction — after the state checks, before the status write — for the
   * ROW-LOCKED case's worker and benefit, so the grant and the close commit
   * or roll back together and can never target another pair. The returned id
   * is linked on the appeal details.
   */
  grantExemption?: (subject: BaoAppealExemptionSubject) => Promise<{ exemptionId: string; created: boolean }>;
}

export interface BaoAppealOutcomeResult {
  case: BaoCase;
  /** Approve: the exemption granted or reused; null on deny. */
  exemptionId: string | null;
  /** Approve: false when an equivalent exemption already existed; null on deny. */
  exemptionCreated: boolean | null;
}

export interface BaoCasesStorage {
  tableExists(): Promise<boolean>;
  isAssignableUser(id: string): Promise<boolean>;
  create(input: CreateBaoCaseInput): Promise<BaoCase>;
  get(id: string, includeNotes?: boolean): Promise<BaoCaseDetails | undefined>;
  updateLifecycle(
    id: string,
    updates: Partial<InsertBaoCase>,
    assignment?: BaoCaseAssignmentContext,
    options?: { systemClose?: boolean },
  ): Promise<BaoCase>;
  listLapsedOpenCases(todayYmd: string): Promise<Array<{ id: string; deadlineYmd: string; statusId: string; lapseStatusId: string }>>;
  addNote(caseId: string, input: CreateBaoCaseInput["initialNote"], actorUserId: string): Promise<NoteWithDetails>;
  list(input: {
    entityType?: BaoCaseEntityType;
    entityId?: string;
    assigneeUserId?: string;
    caseTypeId?: string;
    closed: boolean;
    page: number;
    pageSize: number;
    sort: "created" | "deadline";
    direction: "asc" | "desc";
  }): Promise<BaoCaseListResult>;
  getByNoteId(noteId: string): Promise<{ caseId: string } | undefined>;
  getByNoteIds(noteIds: string[]): Promise<Map<string, string>>;
  /** The appeal behind a case (by case id) or an appeal row by its own id. */
  getAppeal(ref: { caseId: string } | { id: string }): Promise<BaoAppealSnapshot | undefined>;
  /**
   * Record a comm as sent about a case for a status entry. Idempotent per
   * comm: a comm is about exactly one case, so a repeat link is a no-op.
   */
  linkComm(input: {
    caseId: string;
    commId: string;
    statusId: string | null;
    statusName: string | null;
  }): Promise<void>;
  /** The case's letters, newest first. */
  listLetters(caseId: string): Promise<BaoCaseLetter[]>;
  /**
   * Does the case's worker have an active postal address? Answers the
   * "no letter went out" question on case detail; false for non-worker cases.
   */
  hasMailingAddress(caseId: string): Promise<boolean>;
  countByStatus(statusId: string): Promise<number>;
  countByResolution(resolutionId: string): Promise<number>;
  countStatusClassificationConflicts(statusId: string, nextClosed: boolean): Promise<number>;
  updateStatusClassificationAtomically(
    statusId: string,
    updates: Partial<typeof optionsBaoCaseStatus.$inferInsert>,
  ): Promise<typeof optionsBaoCaseStatus.$inferSelect | undefined>;
  listCaseDocuments(caseId: string): Promise<any[]>;
  attachCaseDocument(caseId: string, file: any, uploadedByUserId: string, documentType?: string): Promise<any>;
  recordMemberLetter(caseId: string, fileId: string, note: CreateBaoCaseInput["initialNote"], actorUserId: string): Promise<BaoCase>;
  /**
   * Record the trustees' outcome on a Benefit Appeal in Trustee Review: move
   * it to the Approved or Closed–Denied status in one transaction with the
   * approval's exemption grant and the denial's closing note, under the same
   * closed-status rules as a lifecycle edit (resolution pairing, outreach
   * note, deadline from the status) and the same status-saved event. An
   * outcome status configured as open is refused (OUTCOME_STATUS_OPEN)
   * before any side effect. The ONLY way into an outcome step —
   * `updateLifecycle` refuses them.
   */
  recordAppealOutcome(caseId: string, input: BaoAppealOutcomeInput): Promise<BaoAppealOutcomeResult>;
}

const cases = sitespecificBaoCases;
const noteStorage = createNotesStorage();
const tagStorage = createBaoNoteTagsStorage();

const entityName = sql<string | null>`CASE
  WHEN ${cases.entityType} = 'worker' THEN (
    SELECT c.display_name FROM workers w JOIN contacts c ON c.id = w.contact_id
    WHERE w.id = ${cases.entityId}
  )
  WHEN ${cases.entityType} = 'employer' THEN (
    SELECT e.name FROM employers e WHERE e.id = ${cases.entityId}
  )
  WHEN ${cases.entityType} = 'trust_provider' THEN (
    SELECT p.name FROM trust_providers p WHERE p.id = ${cases.entityId}
  )
  ELSE NULL END`;

const detailSelection = {
  theCase: cases,
  entityName,
  assigneeFirstName: users.firstName,
  assigneeLastName: users.lastName,
  assigneeEmail: users.email,
  statusName: optionsBaoCaseStatus.name,
  statusClosed: optionsBaoCaseStatus.closed,
  caseTypeName: optionsBaoCaseType.name,
  workflowStep: optionsBaoCaseStatus.workflowStep,
  resolutionName: optionsBaoCaseResolution.name,
  benefitName: trustBenefits.name,
  denialReasonName: optionsBaoAppealDenialReason.name,
  // The citation snapshotted at auto-denial (see the header), not the option's.
  spdCitation: sql<string | null>`${sitespecificBaoAppealDetails.data}->>'spdCitation'`,
  // Behaviour, not member-facing text: read LIVE from the reason (see the header).
  denialReasonEligibilityPluginIds: sql<unknown>`${optionsBaoAppealDenialReason.data}->'eligibilityPluginIds'`,
};

/** The reason's configured check ids as stored by the options UI; anything else → none. */
function pluginIdsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

/**
 * The citation text a denial reason option carries, as stored by the
 * options UI in `data.spdCitation`. Blank, absent or non-text → null.
 */
function citationOf(reasonData: unknown): string | null {
  const raw =
    reasonData && typeof reasonData === "object"
      ? (reasonData as Record<string, unknown>).spdCitation
      : undefined;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text.length > 0 ? text : null;
}

/** What the appeal details row snapshots for a denial under this reason. */
function appealDetailsDataFor(reason: { data: unknown }): BaoAppealDetailsData {
  return { spdCitation: citationOf(reason.data) };
}

function detailQuery() {
  return getClient()
    .select(detailSelection)
    .from(cases)
    .innerJoin(users, eq(users.id, cases.assigneeUserId))
    .innerJoin(optionsBaoCaseStatus, eq(optionsBaoCaseStatus.id, cases.statusId))
    .innerJoin(optionsBaoCaseType, eq(optionsBaoCaseType.id, cases.caseTypeId))
    .leftJoin(optionsBaoCaseResolution, eq(optionsBaoCaseResolution.id, cases.resolutionId))
    .leftJoin(trustBenefits, eq(trustBenefits.id, cases.benefitId))
    .leftJoin(sitespecificBaoAppealDetails, eq(sitespecificBaoAppealDetails.caseId, cases.id))
    .leftJoin(optionsBaoAppealDenialReason, eq(optionsBaoAppealDenialReason.id, sitespecificBaoAppealDetails.denialReasonId));
}

type DetailRow = Awaited<ReturnType<typeof detailQuery>>[number];

/** The one mapping from a `detailQuery()` row to what every reader of a case sees. */
function mapDetail(row: DetailRow): BaoCaseDetails {
  const full = [row.assigneeFirstName, row.assigneeLastName].filter(Boolean).join(" ");
  return {
    ...row.theCase,
    entityName: row.entityName ?? null,
    assigneeName: full || row.assigneeEmail,
    statusName: row.statusName,
    statusClosed: Boolean(row.statusClosed),
    caseTypeName: row.caseTypeName,
    workflowStep: row.workflowStep ?? null,
    resolutionName: row.resolutionName ?? null,
    benefitName: row.benefitName ?? null,
    denialReasonName: row.denialReasonName ?? null,
    spdCitation: row.spdCitation ?? null,
    denialReasonEligibilityPluginIds: pluginIdsOf(row.denialReasonEligibilityPluginIds),
  };
}

/** Appeal details with the letter-facing display values (see BaoAppealSnapshot). */
function appealQuery() {
  return getClient()
    .select({
      appeal: sitespecificBaoAppealDetails,
      benefitName: trustBenefits.name,
      denialReasonName: optionsBaoAppealDenialReason.name,
      // The citation snapshotted at auto-denial (see the header), not the option's.
      spdCitation: sql<string | null>`NULLIF(${sitespecificBaoAppealDetails.data}->>'spdCitation', '')`,
    })
    .from(sitespecificBaoAppealDetails)
    .innerJoin(cases, eq(cases.id, sitespecificBaoAppealDetails.caseId))
    .leftJoin(trustBenefits, eq(trustBenefits.id, cases.benefitId))
    .leftJoin(
      optionsBaoAppealDenialReason,
      eq(optionsBaoAppealDenialReason.id, sitespecificBaoAppealDetails.denialReasonId),
    );
}
async function getStatus(statusId: string) {
  const [status] = await getClient()
    .select()
    .from(optionsBaoCaseStatus)
    .where(eq(optionsBaoCaseStatus.id, statusId))
    .limit(1);
  return status;
}

async function getDenialReason(reasonId: string) {
  const [reason] = await getClient()
    .select()
    .from(optionsBaoAppealDenialReason)
    .where(eq(optionsBaoAppealDenialReason.id, reasonId))
    .limit(1);
  return reason ?? null;
}

/** Shared/exclusive row locks serialize case writes with status reclassification. */
async function lockStatuses(statusIds: string[], mode: "SHARE" | "UPDATE"): Promise<void> {
  const ids = [...new Set(statusIds)].sort();
  for (const id of ids) {
    await getClient().execute(
      sql`SELECT id FROM options_bao_case_status WHERE id = ${id} FOR ${sql.raw(mode)}`,
    );
  }
}

/**
 * Defer a BAO_CASE_STATUS_SAVED emit until the surrounding transaction
 * commits, so listeners never see uncommitted (or rolled-back) state. The
 * display names and appeal facts are captured HERE, inside the writing
 * transaction and through the same `detailQuery()` the detail endpoint
 * reads, so a notification says exactly what the detail screen showed at
 * this write: a later edit or rename must not rewrite it.
 */
async function emitCaseStatusSaved(
  row: BaoCase,
  previousStatusId: string | null,
  statusName: string,
  operation: "created" | "updated",
  change: { previousAssigneeUserId: string | null; actorUserId: string | null },
): Promise<void> {
  const [detailRow] = await detailQuery().where(eq(cases.id, row.id)).limit(1);
  const detail = detailRow ? mapDetail(detailRow) : null;
  const payload = {
    caseId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    row,
    previousStatusId,
    statusId: row.statusId,
    statusName,
    entityName: detail?.entityName ?? null,
    previousAssigneeUserId: change.previousAssigneeUserId,
    assigneeUserId: row.assigneeUserId,
    assigneeName: detail?.assigneeName ?? null,
    benefitName: detail?.benefitName ?? null,
    denialReasonName: detail?.denialReasonName ?? null,
    spdCitation: detail?.spdCitation ?? null,
    actorUserId: change.actorUserId,
    operation,
  };
  onAfterCommit(() => {
    void eventBus.emit(EventType.BAO_CASE_STATUS_SAVED, payload);
  });
}

async function assertNoteType(typeId: string, entityType: string): Promise<void> {
  const [type] = await getClient().select().from(optionsNoteType).where(eq(optionsNoteType.id, typeId));
  if (!type || !Array.isArray((type.data as any)?.entityTypes) || !(type.data as any).entityTypes.includes(entityType)) {
    throw new Error("INVALID_NOTE_TYPE");
  }
}

/**
 * A status that requires member outreach can only be entered once the case
 * carries a note whose type is flagged `memberOutreach`.
 */
async function assertOutreachNote(caseId: string): Promise<void> {
  const [outreach] = await getClient().select({ id: notes.id })
    .from(sitespecificBaoCaseNotes)
    .innerJoin(notes, eq(notes.id, sitespecificBaoCaseNotes.noteId))
    .innerJoin(optionsNoteType, eq(optionsNoteType.id, notes.typeId))
    .where(and(
      eq(sitespecificBaoCaseNotes.caseId, caseId),
      sql`COALESCE((${optionsNoteType.data}->>'memberOutreach')::boolean, false)`,
    )).limit(1);
  if (!outreach) throw new Error("OUTREACH_NOTE_REQUIRED");
}

/** Create a note on the case's entity and link it to the case (with its tags). */
async function addLinkedNote(
  theCase: Pick<BaoCase, "id" | "entityType" | "entityId">,
  input: NonNullable<CreateBaoCaseInput["initialNote"]>,
  actorUserId: string,
) {
  await assertNoteType(input.typeId, theCase.entityType);
  const note = await noteStorage.create({
    entityType: theCase.entityType,
    entityId: theCase.entityId,
    typeId: input.typeId,
    subject: input.subject,
    body: input.body ?? null,
    data: input.data ?? null,
    userId: actorUserId,
  });
  await getClient().insert(sitespecificBaoCaseNotes).values({ caseId: theCase.id, noteId: note.id });
  if (input.tagIds?.length) await tagStorage.setForNote(note.id, Array.from(new Set(input.tagIds)));
  return note;
}

export function createBaoCasesStorage(): BaoCasesStorage {
  return {
    async tableExists() {
      return tableExists("sitespecific_bao_cases");
    },

    async isAssignableUser(id) {
      const rows = await getClient()
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(and(eq(users.id, id), eq(users.isActive, true), sql`${rolePermissions.permissionKey} IN ('staff', 'admin')`))
        .limit(1);
      return rows.length > 0;
    },

    async create(input) {
      return runInTransaction(async () => {
        if (!(await noteStorage.entityExists(input.entityType, input.entityId))) {
          throw new Error("ENTITY_NOT_FOUND");
        }
        if (!(await this.isAssignableUser(input.assigneeUserId))) {
          throw new Error("INVALID_ASSIGNEE");
        }
        await lockStatuses([input.statusId], "SHARE");
        const status = await getStatus(input.statusId);
        if (!status) throw new Error("INVALID_STATUS");
        if (status.closed) throw new Error("INITIAL_STATUS_CLOSED");
        const [caseType] = await getClient().select().from(optionsBaoCaseType)
          .where(eq(optionsBaoCaseType.id, input.caseTypeId ?? status.caseTypeId));
        if (!caseType || status.caseTypeId !== caseType.id) throw new Error("CASE_TYPE_STATUS_MISMATCH");
        if (caseType.workflowCode === "benefit_appeal" && input.entityType !== "worker") throw new Error("APPEAL_WORKER_REQUIRED");
        if (caseType.workflowCode === "benefit_appeal" && (!input.benefitId || !input.denialReasonId)) throw new Error("APPEAL_DETAILS_REQUIRED");
        if (caseType.workflowCode === "benefit_appeal" && status.workflowStep !== "submitted") {
          throw new Error("INVALID_INITIAL_WORKFLOW_STEP");
        }
        // Non-null exactly when this is a Benefit Appeal (checked above to
        // carry a reason id); the reason drives the auto-denial below.
        const appealReason = caseType.workflowCode === "benefit_appeal" && input.denialReasonId
          ? await getDenialReason(input.denialReasonId)
          : null;
        if (caseType.workflowCode === "benefit_appeal" && !appealReason) throw new Error("INVALID_APPEAL_DENIAL_REASON");
        if (input.benefitId) {
          const [benefit] = await getClient().select({ id: trustBenefits.id }).from(trustBenefits).where(and(eq(trustBenefits.id, input.benefitId), eq(trustBenefits.isActive, true)));
          if (!benefit) throw new Error("INVALID_APPEAL_BENEFIT");
        }

        let noteId = input.noteId;
        if (noteId) {
          const note = await noteStorage.get(noteId);
          if (!note) throw new Error("NOTE_NOT_FOUND");
          if (note.entityType !== input.entityType || note.entityId !== input.entityId) {
            throw new Error("NOTE_ENTITY_MISMATCH");
          }
        } else if (input.initialNote) {
          await assertNoteType(input.initialNote.typeId, input.entityType);
          const note = await noteStorage.create({
            entityType: input.entityType,
            entityId: input.entityId,
            typeId: input.initialNote.typeId,
            subject: input.initialNote.subject,
            body: input.initialNote.body ?? null,
            data: input.initialNote.data ?? null,
            userId: input.actorUserId,
          });
          noteId = note.id;
          if (input.initialNote.tagIds?.length) {
            await tagStorage.setForNote(note.id, Array.from(new Set(input.initialNote.tagIds)));
          }
        }
        if (!noteId) throw new Error("INITIAL_NOTE_REQUIRED");

        const [created] = await getClient().insert(cases).values({
          entityType: input.entityType,
          entityId: input.entityId,
          deadlineYmd: status.durationDays == null ? input.deadlineYmd : sql`CURRENT_DATE + ${status.durationDays}::int`,
          statusId: input.statusId,
          caseTypeId: caseType.id,
          assigneeUserId: input.assigneeUserId,
          benefitId: input.benefitId ?? null,
          resolutionId: null,
          resolutionYmd: null,
        }).returning();
        await getClient().insert(sitespecificBaoCaseNotes).values({ caseId: created.id, noteId });
        if (appealReason) {
          // Snapshot the reason's citation with the denial (see the header):
          // the letter quotes what the member was told, not the option's
          // current text.
          await getClient().insert(sitespecificBaoAppealDetails).values({
            caseId: created.id,
            denialReasonId: appealReason.id,
            data: appealDetailsDataFor(appealReason),
          });
          const [autoDenied] = await getClient().select().from(optionsBaoCaseStatus)
            .where(and(eq(optionsBaoCaseStatus.caseTypeId, caseType.id), eq(optionsBaoCaseStatus.workflowStep, "auto_denied"))).limit(1);
          if (!autoDenied) throw new Error("APPEAL_AUTO_DENIED_STATUS_MISSING");
          await lockStatuses([autoDenied.id], "SHARE");
          const [denied] = await getClient().update(cases).set({
            statusId: autoDenied.id,
            deadlineYmd: autoDenied.durationDays == null ? created.deadlineYmd : sql`CURRENT_DATE + ${autoDenied.durationDays}::int`,
          }).where(eq(cases.id, created.id)).returning();
          await emitCaseStatusSaved(denied, created.statusId, autoDenied.name, "updated", { previousAssigneeUserId: created.assigneeUserId, actorUserId: input.actorUserId });
          return denied;
        }
        await emitCaseStatusSaved(created, null, status.name, "created", {
          previousAssigneeUserId: null,
          actorUserId: input.actorUserId ?? null,
        });
        return created;
      });
    },

    async get(id, includeNotes = false) {
      const [row] = await detailQuery().where(eq(cases.id, id)).limit(1);
      if (!row) return undefined;
      const result = mapDetail(row);
      if (includeNotes) {
        const linked = await getClient()
          .select({ note: notes, typeName: optionsNoteType.name, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(sitespecificBaoCaseNotes)
          .innerJoin(notes, eq(notes.id, sitespecificBaoCaseNotes.noteId))
          .leftJoin(optionsNoteType, eq(optionsNoteType.id, notes.typeId))
          .leftJoin(users, eq(users.id, notes.userId))
          .where(eq(sitespecificBaoCaseNotes.caseId, id))
          .orderBy(asc(notes.timestamp), asc(notes.id));
        result.notes = linked.map((row) => ({
          ...row.note,
          typeName: row.typeName ?? null,
          authorName: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || null,
        }));
      }
      return result;
    },

    async updateLifecycle(id, updates, assignment, options) {
      return runInTransaction(async () => {
        // Serialize every mutation of this case before deriving merged state.
        // Status-row locks alone only coordinate status classification; without
        // this row lock two lifecycle writers can both derive from stale state.
        const [existing] = await getClient()
          .select()
          .from(cases)
          .where(eq(cases.id, id))
          .for("update");
        if (!existing) throw new Error("CASE_NOT_FOUND");
        // Self-vs-other assignment rule, evaluated against the ROW-LOCKED
        // assignee: an earlier pre-transaction read cannot make a stale
        // "unchanged assignee" echo pass once someone else reassigned first.
        if (assignment && assignmentForbidden({
          requestedAssigneeId: updates.assigneeUserId,
          actorUserId: assignment.actorUserId,
          existingAssigneeId: existing.assigneeUserId,
          canAssignOthers: assignment.canAssignOthers,
        })) {
          throw new Error("ASSIGN_OTHERS_FORBIDDEN");
        }
        const nextStatusId = updates.statusId ?? existing.statusId;
        await lockStatuses([existing.statusId, nextStatusId], "SHARE");
        const status = await getStatus(nextStatusId);
        if (!status) throw new Error("INVALID_STATUS");
        const previousStatus = await getStatus(existing.statusId);
        if (status.caseTypeId !== existing.caseTypeId) throw new Error("CASE_TYPE_STATUS_MISMATCH");
        if (updates.statusId && updates.statusId !== existing.statusId) {
          const [caseType] = await getClient().select().from(optionsBaoCaseType)
            .where(eq(optionsBaoCaseType.id, existing.caseTypeId));
          if (caseType?.workflowCode === "benefit_appeal") {
            // The trustee outcomes are reached only through recordAppealOutcome,
            // which grants the exemption / takes the closing note in the same
            // transaction; a bare status edit would skip both. The one
            // exception is a deadline lapse auto-closing into denied — there
            // is nothing for it to skip — never into approved, which without
            // its exemption would be a lie.
            if ((BAO_APPEAL_OUTCOME_STEPS as readonly string[]).includes(status.workflowStep ?? "")
              && !(options?.systemClose && status.workflowStep === "denied")) {
              throw new Error("OUTCOME_ACTION_REQUIRED");
            }
            const steps = ["submitted", "auto_denied", "trustee_review", "approved", "denied", "no_response"];
            const from = steps.indexOf(previousStatus?.workflowStep ?? "");
            const to = steps.indexOf(status.workflowStep ?? "");
            if (from < 0 || to !== from + 1 && !options?.systemClose) throw new Error("INVALID_WORKFLOW_TRANSITION");
          }
        }
        const assignee = updates.assigneeUserId ?? existing.assigneeUserId;
        if (!(await this.isAssignableUser(assignee))) throw new Error("INVALID_ASSIGNEE");

        const nextResolutionId = updates.resolutionId !== undefined ? updates.resolutionId : existing.resolutionId;
        const nextResolutionYmd = updates.resolutionYmd !== undefined ? updates.resolutionYmd : existing.resolutionYmd;
        if (status.closed) {
          const resolutionId = nextResolutionId ?? status.defaultResolutionId;
          if (!resolutionId || !nextResolutionYmd) throw new Error("RESOLUTION_REQUIRED");
          const [resolution] = await getClient().select({ id: optionsBaoCaseResolution.id })
            .from(optionsBaoCaseResolution).where(eq(optionsBaoCaseResolution.id, resolutionId));
          if (!resolution) throw new Error("INVALID_RESOLUTION");
          if (status.requiresOutreachNote && !options?.systemClose) await assertOutreachNote(id);
        } else if (!previousStatus?.closed && (nextResolutionId || nextResolutionYmd)) {
          throw new Error("OPEN_CASE_RESOLUTION");
        }
        const normalized = status.closed
          ? {
              ...updates,
              resolutionId: nextResolutionId ?? status.defaultResolutionId,
              ...(options?.systemClose ? {
                resolutionYmd: nextResolutionYmd ?? sql`CURRENT_DATE`,
                data: { ...(existing.data as Record<string, unknown> | null ?? {}), autoClosedReason: "deadline_lapsed" },
              } : {}),
            }
          : { ...updates, resolutionId: null, resolutionYmd: null };
        if (status.durationDays != null && updates.statusId && updates.statusId !== existing.statusId) {
          (normalized as any).deadlineYmd = sql`CURRENT_DATE + ${status.durationDays}::int`;
        }
        const [updated] = await getClient().update(cases).set(normalized).where(eq(cases.id, id)).returning();
        await emitCaseStatusSaved(updated, existing.statusId, status.name, "updated", {
          previousAssigneeUserId: existing.assigneeUserId,
          actorUserId: assignment?.actorUserId ?? null,
        });
        return updated;
      });
    },

    async listLapsedOpenCases(todayYmd) {
      const rows = await getClient().select({
        id: cases.id,
        deadlineYmd: cases.deadlineYmd,
        statusId: cases.statusId,
        lapseStatusId: optionsBaoCaseStatus.lapseStatusId,
      }).from(cases)
        .innerJoin(optionsBaoCaseStatus, eq(optionsBaoCaseStatus.id, cases.statusId))
        .where(and(
          eq(optionsBaoCaseStatus.closed, false),
          sql`${cases.deadlineYmd} < ${todayYmd}::date`,
          sql`${optionsBaoCaseStatus.lapseStatusId} IS NOT NULL`,
        ));
      return rows.filter((row): row is typeof row & { lapseStatusId: string } => Boolean(row.lapseStatusId));
    },

    async addNote(caseId, input, actorUserId) {
      if (!input) throw new Error("NOTE_REQUIRED");
      return runInTransaction(async () => {
        const theCase = await this.get(caseId);
        if (!theCase) throw new Error("CASE_NOT_FOUND");
        await assertNoteType(input.typeId, theCase.entityType);
        const note = await noteStorage.create({
          entityType: theCase.entityType,
          entityId: theCase.entityId,
          typeId: input.typeId,
          subject: input.subject,
          body: input.body ?? null,
          data: input.data ?? null,
          userId: actorUserId,
        });
        await getClient().insert(sitespecificBaoCaseNotes).values({ caseId, noteId: note.id });
        if (input.tagIds?.length) await tagStorage.setForNote(note.id, Array.from(new Set(input.tagIds)));
        return { ...note, typeName: null, authorName: null };
      });
    },

    async list(input) {
      const conditions: any[] = [eq(optionsBaoCaseStatus.closed, input.closed)];
      if (input.entityType) conditions.push(eq(cases.entityType, input.entityType));
      if (input.entityId) conditions.push(eq(cases.entityId, input.entityId));
      if (input.assigneeUserId) conditions.push(eq(cases.assigneeUserId, input.assigneeUserId));
      if (input.caseTypeId) conditions.push(eq(cases.caseTypeId, input.caseTypeId));
      const where = and(...conditions);
      const [{ count }] = await getClient().select({ count: sql<number>`count(*)::int` })
        .from(cases).innerJoin(optionsBaoCaseStatus, eq(optionsBaoCaseStatus.id, cases.statusId)).where(where);
      const column = input.sort === "created" ? cases.createdAt : cases.deadlineYmd;
      const order = input.direction === "desc" ? desc : asc;
      const rows = await detailQuery().where(where)
        .orderBy(order(column), order(cases.createdAt), order(cases.id))
        .limit(input.pageSize).offset((input.page - 1) * input.pageSize);
      return { items: rows.map(mapDetail), page: input.page, pageSize: input.pageSize, total: Number(count ?? 0) };
    },

    async getByNoteId(noteId) {
      const [row] = await getClient().select({ caseId: sitespecificBaoCaseNotes.caseId })
        .from(sitespecificBaoCaseNotes).where(eq(sitespecificBaoCaseNotes.noteId, noteId));
      return row;
    },
    async getByNoteIds(noteIds) {
      if (noteIds.length === 0) return new Map();
      const rows = await getClient()
        .select({ noteId: sitespecificBaoCaseNotes.noteId, caseId: sitespecificBaoCaseNotes.caseId })
        .from(sitespecificBaoCaseNotes)
        .where(inArray(sitespecificBaoCaseNotes.noteId, noteIds));
      return new Map(rows.map((row) => [row.noteId, row.caseId]));
    },

    async getAppeal(ref) {
      const where =
        "caseId" in ref
          ? eq(sitespecificBaoAppealDetails.caseId, ref.caseId)
          : eq(sitespecificBaoAppealDetails.id, ref.id);
      const [row] = await appealQuery().where(where).limit(1);
      if (!row) return undefined;
      return {
        ...row.appeal,
        benefitName: row.benefitName ?? null,
        denialReasonName: row.denialReasonName ?? null,
        spdCitation: row.spdCitation ?? null,
      };
    },

    async linkComm(input) {
      await getClient()
        .insert(sitespecificBaoCaseComms)
        .values({
          caseId: input.caseId,
          commId: input.commId,
          statusId: input.statusId,
          statusName: input.statusName,
        })
        .onConflictDoNothing({ target: sitespecificBaoCaseComms.commId });
    },

    async listLetters(caseId) {
      const rows = await getClient()
        .select({
          link: sitespecificBaoCaseComms,
          medium: comm.medium,
          commStatus: comm.status,
          sent: comm.sent,
          postalDescription: commPostal.description,
          emailSubject: commEmail.subject,
        })
        .from(sitespecificBaoCaseComms)
        .innerJoin(comm, eq(comm.id, sitespecificBaoCaseComms.commId))
        .leftJoin(commPostal, eq(commPostal.commId, comm.id))
        .leftJoin(commEmail, eq(commEmail.commId, comm.id))
        .where(eq(sitespecificBaoCaseComms.caseId, caseId))
        .orderBy(desc(sitespecificBaoCaseComms.createdAt), desc(sitespecificBaoCaseComms.id));
      return rows.map((row) => ({
        id: row.link.id,
        commId: row.link.commId,
        medium: row.medium,
        commStatus: row.commStatus,
        sent: row.sent ?? null,
        statusId: row.link.statusId ?? null,
        statusName: row.link.statusName ?? null,
        description: (row.medium === "email" ? row.emailSubject : row.postalDescription) ?? null,
        createdAt: row.link.createdAt,
      }));
    },

    async hasMailingAddress(caseId) {
      // Same address set postal delivery draws from: the worker's contact's
      // ACTIVE postal addresses (delivery picks the primary among them).
      const [row] = await getClient()
        .select({
          onFile: sql<boolean>`EXISTS (
            SELECT 1 FROM workers w
            JOIN contact_postal p ON p.contact_id = w.contact_id AND p.is_active
            WHERE ${cases.entityType} = 'worker' AND w.id = ${cases.entityId}
          )`,
        })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      return Boolean(row?.onFile);
    },

    async countByStatus(statusId) {
      const [row] = await getClient().select({ count: sql<number>`count(*)::int` }).from(cases).where(eq(cases.statusId, statusId));
      return Number(row?.count ?? 0);
    },
    async countByResolution(resolutionId) {
      const [row] = await getClient().select({ count: sql<number>`count(*)::int` }).from(cases).where(eq(cases.resolutionId, resolutionId));
      return Number(row?.count ?? 0);
    },
    async countStatusClassificationConflicts(statusId, nextClosed) {
      const condition = nextClosed
        ? and(eq(cases.statusId, statusId), sql`(${cases.resolutionId} IS NULL OR ${cases.resolutionYmd} IS NULL)`)
        : and(eq(cases.statusId, statusId), sql`(${cases.resolutionId} IS NOT NULL OR ${cases.resolutionYmd} IS NOT NULL)`);
      const [row] = await getClient().select({ count: sql<number>`count(*)::int` }).from(cases).where(condition);
      return Number(row?.count ?? 0);
    },
    async updateStatusClassificationAtomically(statusId, updates) {
      return runInTransaction(async () => {
        // UPDATE lock blocks all case create/lifecycle writes which take SHARE.
        await lockStatuses([statusId], "UPDATE");
        const [existing] = await getClient().select().from(optionsBaoCaseStatus)
          .where(eq(optionsBaoCaseStatus.id, statusId));
        if (!existing) return undefined;
        const nextClosed = updates.closed ?? existing.closed;
        if (nextClosed !== existing.closed) {
          const conflicts = await this.countStatusClassificationConflicts(statusId, nextClosed);
          if (conflicts > 0) throw new Error("STATUS_CLASSIFICATION_CONFLICT");
        }
        const [updated] = await getClient().update(optionsBaoCaseStatus)
          .set(updates)
          .where(eq(optionsBaoCaseStatus.id, statusId))
          .returning();
        return updated;
      });
    },
    async listCaseDocuments(caseId) {
      return getClient().select({ document: sitespecificBaoCaseDocuments, file: files })
        .from(sitespecificBaoCaseDocuments).innerJoin(files, eq(files.id, sitespecificBaoCaseDocuments.fileId))
        .where(eq(sitespecificBaoCaseDocuments.caseId, caseId))
        .orderBy(asc(sitespecificBaoCaseDocuments.createdAt));
    },
    async attachCaseDocument(caseId, file, uploadedByUserId, documentType = "other") {
      const [row] = await getClient().insert(sitespecificBaoCaseDocuments).values({ caseId, fileId: file.id, uploadedByUserId, documentType }).returning();
      return row;
    },
    async recordMemberLetter(caseId, fileId, noteInput, actorUserId) {
      return runInTransaction(async () => {
        const [existing] = await getClient().select().from(cases).where(eq(cases.id, caseId)).for("update");
        if (!existing) throw new Error("CASE_NOT_FOUND");
        const [appealType] = await getClient().select().from(optionsBaoCaseType).where(eq(optionsBaoCaseType.id, existing.caseTypeId));
        const [current] = await getClient().select().from(optionsBaoCaseStatus).where(eq(optionsBaoCaseStatus.id, existing.statusId));
        if (appealType?.workflowCode !== "benefit_appeal" || current?.workflowStep !== "auto_denied") throw new Error("LETTER_WRONG_STATE");
        const prior = await getClient().select({ id: sitespecificBaoCaseDocuments.id }).from(sitespecificBaoCaseDocuments).where(and(eq(sitespecificBaoCaseDocuments.caseId, caseId), eq(sitespecificBaoCaseDocuments.documentType, "member_letter"))).limit(1);
        if (prior.length) throw new Error("MEMBER_LETTER_ALREADY_RECORDED");
        if (!noteInput) throw new Error("INITIAL_NOTE_REQUIRED");
        await assertNoteType(noteInput.typeId, existing.entityType);
        const note = await noteStorage.create({ entityType: existing.entityType, entityId: existing.entityId, typeId: noteInput.typeId, subject: noteInput.subject, body: noteInput.body ?? null, data: noteInput.data ?? null, userId: actorUserId });
        await getClient().insert(sitespecificBaoCaseNotes).values({ caseId, noteId: note.id });
        const [document] = await getClient().update(sitespecificBaoCaseDocuments).set({ documentType: "member_letter" }).where(and(eq(sitespecificBaoCaseDocuments.caseId, caseId), eq(sitespecificBaoCaseDocuments.fileId, fileId))).returning();
        if (!document) throw new Error("CASE_DOCUMENT_NOT_FOUND");
        const [next] = await getClient().select().from(optionsBaoCaseStatus).where(and(eq(optionsBaoCaseStatus.caseTypeId, existing.caseTypeId), eq(optionsBaoCaseStatus.workflowStep, "trustee_review"))).limit(1);
        if (!next) throw new Error("TRUSTEE_REVIEW_STATUS_MISSING");
        await lockStatuses([existing.statusId, next.id], "SHARE");
        const [updated] = await getClient().update(cases).set({ statusId: next.id, deadlineYmd: next.durationDays == null ? existing.deadlineYmd : sql`CURRENT_DATE + ${next.durationDays}::int` }).where(eq(cases.id, caseId)).returning();
        await emitCaseStatusSaved(updated, existing.statusId, next.name, "updated", { previousAssigneeUserId: existing.assigneeUserId, actorUserId });
        return updated;
      });
    },

    async recordAppealOutcome(caseId, input) {
      return runInTransaction(async () => {
        // Row lock first: the state check, the grant/note and the status
        // write all derive from this one locked row.
        const [existing] = await getClient().select().from(cases).where(eq(cases.id, caseId)).for("update");
        if (!existing) throw new Error("CASE_NOT_FOUND");
        const [caseType] = await getClient().select().from(optionsBaoCaseType)
          .where(eq(optionsBaoCaseType.id, existing.caseTypeId));
        const current = await getStatus(existing.statusId);
        if (caseType?.workflowCode !== "benefit_appeal" || current?.workflowStep !== "trustee_review") {
          throw new Error("OUTCOME_WRONG_STATE");
        }
        const [target] = await getClient().select().from(optionsBaoCaseStatus)
          .where(and(
            eq(optionsBaoCaseStatus.caseTypeId, existing.caseTypeId),
            eq(optionsBaoCaseStatus.workflowStep, input.outcome),
          )).limit(1);
        if (!target) throw new Error("OUTCOME_STATUS_MISSING");
        // An outcome CLOSES the appeal. The seeded outcome statuses are closed,
        // but an administrator can reclassify any status through the options
        // API; landing an approval on an open status would grant the exemption
        // and leave the case open without a resolution. Refuse the
        // configuration before any side effect instead.
        if (!target.closed) throw new Error("OUTCOME_STATUS_OPEN");
        await lockStatuses([existing.statusId, target.id], "SHARE");

        // The same closed-status rules a lifecycle edit enforces, resolved
        // before the note or the grant so a configuration gap refuses cleanly.
        const resolutionId = input.resolutionId ?? target.defaultResolutionId ?? null;
        if (!resolutionId) throw new Error("RESOLUTION_REQUIRED");
        const [resolution] = await getClient().select({ id: optionsBaoCaseResolution.id })
          .from(optionsBaoCaseResolution).where(eq(optionsBaoCaseResolution.id, resolutionId));
        if (!resolution) throw new Error("INVALID_RESOLUTION");
        const resolutionYmd: string | SQL = input.resolutionYmd ?? sql`CURRENT_DATE`;

        // Deny: the closing note joins the conversation BEFORE the outreach
        // rule is checked, so it can be the note that satisfies it.
        if (input.outcome === "denied" && input.note) {
          await addLinkedNote(existing, input.note, input.actorUserId);
        }
        if (target.requiresOutreachNote) await assertOutreachNote(caseId);

        // Approve: the exemption, granted for the locked row's worker and
        // benefit and linked on the appeal details. The grant is idempotent
        // (see exemptions storage), so a retried approval never duplicates.
        let exemptionId: string | null = null;
        let exemptionCreated: boolean | null = null;
        if (input.outcome === "approved") {
          if (!input.grantExemption) throw new Error("EXEMPTION_GRANT_REQUIRED");
          if (existing.entityType !== "worker") throw new Error("APPEAL_WORKER_REQUIRED");
          const [details] = await getClient().select().from(sitespecificBaoAppealDetails)
            .where(eq(sitespecificBaoAppealDetails.caseId, caseId)).limit(1);
          if (!existing.benefitId || !details) throw new Error("APPEAL_DETAILS_REQUIRED");
          const [benefit] = await getClient().select({ name: trustBenefits.name }).from(trustBenefits)
            .where(eq(trustBenefits.id, existing.benefitId)).limit(1);
          const granted = await input.grantExemption({
            caseId,
            subscriberWorkerId: existing.entityId,
            benefitId: existing.benefitId,
            benefitName: benefit?.name ?? null,
            createdAt: existing.createdAt,
          });
          exemptionId = granted.exemptionId;
          exemptionCreated = granted.created;
          const data: BaoAppealDetailsData = { ...(details.data ?? { spdCitation: null }), exemptionId };
          await getClient().update(sitespecificBaoAppealDetails).set({ data })
            .where(eq(sitespecificBaoAppealDetails.id, details.id));
        }

        const [updated] = await getClient().update(cases).set({
          statusId: target.id,
          resolutionId,
          resolutionYmd,
          deadlineYmd: target.durationDays == null ? existing.deadlineYmd : sql`CURRENT_DATE + ${target.durationDays}::int`,
        }).where(eq(cases.id, caseId)).returning();
        await emitCaseStatusSaved(updated, existing.statusId, target.name, "updated", {
          previousAssigneeUserId: existing.assigneeUserId,
          actorUserId: input.actorUserId,
        });
        return { case: updated, exemptionId, exemptionCreated };
      });
    },
  };
}

/** One sent (or failed) member communication about a case: the letter record. */
export interface BaoCaseLetter {
  id: string;
  commId: string;
  medium: string;
  /** The comm's own delivery status (`sending`, `sent`, `failed`, …). */
  commStatus: string;
  sent: Date | null;
  /** The case status entry this was sent for, as named at send time. */
  statusId: string | null;
  statusName: string | null;
  /** Postal: the mailing description; email: the subject. */
  description: string | null;
  createdAt: Date;
}
