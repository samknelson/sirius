import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  notes,
  optionsBaoCaseResolution,
  optionsBaoCaseStatus,
  optionsBaoCaseType,
  optionsNoteType,
  rolePermissions,
  roles,
  sitespecificBaoCaseNotes,
  sitespecificBaoCases,
  userRoles,
  users,
  type BaoCase,
  type BaoCaseEntityType,
  type InsertBaoCase,
} from "@shared/schema";
import { getClient, onAfterCommit, runInTransaction } from "../../transaction-context";
import { eventBus, EventType } from "../../../services/event-bus";
import { createNotesStorage, type NoteWithDetails } from "../../notes";
import { assignmentForbidden } from "./case-assignment";
import { createBaoNoteTagsStorage } from "./note-tags";
import { tableExists } from "../../utils";

export interface BaoCaseDetails extends BaoCase {
  entityName: string | null;
  assigneeName: string;
  statusName: string;
  statusClosed: boolean;
  caseTypeName: string;
  workflowStep: string | null;
  resolutionName: string | null;
  notes?: NoteWithDetails[];
}

export interface BaoCaseListResult {
  items: BaoCaseDetails[];
  page: number;
  pageSize: number;
  total: number;
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

export interface BaoCasesStorage {
  tableExists(): Promise<boolean>;
  isAssignableUser(id: string): Promise<boolean>;
  create(input: CreateBaoCaseInput): Promise<BaoCase>;
  get(id: string, includeNotes?: boolean): Promise<BaoCaseDetails | undefined>;
  updateLifecycle(
    id: string,
    updates: Partial<InsertBaoCase>,
    assignment?: BaoCaseAssignmentContext,
  ): Promise<BaoCase>;
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
  countByStatus(statusId: string): Promise<number>;
  countByResolution(resolutionId: string): Promise<number>;
  countStatusClassificationConflicts(statusId: string, nextClosed: boolean): Promise<number>;
  updateStatusClassificationAtomically(
    statusId: string,
    updates: Partial<typeof optionsBaoCaseStatus.$inferInsert>,
  ): Promise<typeof optionsBaoCaseStatus.$inferSelect | undefined>;
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
};

function detailQuery() {
  return getClient()
    .select(detailSelection)
    .from(cases)
    .innerJoin(users, eq(users.id, cases.assigneeUserId))
    .innerJoin(optionsBaoCaseStatus, eq(optionsBaoCaseStatus.id, cases.statusId))
    .innerJoin(optionsBaoCaseType, eq(optionsBaoCaseType.id, cases.caseTypeId))
    .leftJoin(optionsBaoCaseResolution, eq(optionsBaoCaseResolution.id, cases.resolutionId));
}

function mapDetail(row: any): BaoCaseDetails {
  const full = [row.assigneeFirstName, row.assigneeLastName].filter(Boolean).join(" ");
  return {
    ...row.theCase,
    entityName: row.entityName ?? null,
    assigneeName: full || row.assigneeEmail,
    statusName: row.statusName,
    statusClosed: Boolean(row.statusClosed),
    resolutionName: row.resolutionName ?? null,
  };
}

async function getStatus(statusId: string) {
  const [status] = await getClient()
    .select()
    .from(optionsBaoCaseStatus)
    .where(eq(optionsBaoCaseStatus.id, statusId))
    .limit(1);
  return status;
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
 * display names are captured HERE, inside the writing transaction: a later
 * edit or status rename must not rewrite what this write's notification says.
 */
async function emitCaseStatusSaved(
  row: BaoCase,
  previousStatusId: string | null,
  statusName: string,
  operation: "created" | "updated",
  change: { previousAssigneeUserId: string | null; actorUserId: string | null },
): Promise<void> {
  const [named] = await getClient()
    .select({ entityName })
    .from(cases)
    .where(eq(cases.id, row.id))
    .limit(1);
  // Assignee display name, captured inside the writing transaction like the
  // status name: a later rename must not rewrite what this write says.
  const [assignee] = await getClient()
    .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users)
    .where(eq(users.id, row.assigneeUserId))
    .limit(1);
  const assigneeName = assignee
    ? [assignee.firstName, assignee.lastName].filter(Boolean).join(" ") || assignee.email
    : null;
  const payload = {
    caseId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    row,
    previousStatusId,
    statusId: row.statusId,
    statusName,
    entityName: named?.entityName ?? null,
    previousAssigneeUserId: change.previousAssigneeUserId,
    assigneeUserId: row.assigneeUserId,
    assigneeName,
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
        if (caseType.workflowCode === "benefit_appeal" && status.workflowStep !== "submitted") {
          throw new Error("INVALID_INITIAL_WORKFLOW_STEP");
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
          resolutionId: null,
          resolutionYmd: null,
        }).returning();
        await getClient().insert(sitespecificBaoCaseNotes).values({ caseId: created.id, noteId });
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

    async updateLifecycle(id, updates, assignment) {
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
            const steps = ["submitted", "auto_denied", "trustee_review", "approved", "denied", "no_response"];
            const from = steps.indexOf(previousStatus?.workflowStep ?? "");
            const to = steps.indexOf(status.workflowStep ?? "");
            if (from < 0 || to !== from + 1) throw new Error("INVALID_WORKFLOW_TRANSITION");
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
          if (status.requiresOutreachNote) {
            const [outreach] = await getClient().select({ id: notes.id })
              .from(sitespecificBaoCaseNotes)
              .innerJoin(notes, eq(notes.id, sitespecificBaoCaseNotes.noteId))
              .innerJoin(optionsNoteType, eq(optionsNoteType.id, notes.typeId))
              .where(and(
                eq(sitespecificBaoCaseNotes.caseId, id),
                sql`COALESCE((${optionsNoteType.data}->>'memberOutreach')::boolean, false)`,
              )).limit(1);
            if (!outreach) throw new Error("OUTREACH_NOTE_REQUIRED");
          }
        } else if (!previousStatus?.closed && (nextResolutionId || nextResolutionYmd)) {
          throw new Error("OPEN_CASE_RESOLUTION");
        }
        const normalized = status.closed
          ? { ...updates, resolutionId: nextResolutionId ?? status.defaultResolutionId }
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
  };
}