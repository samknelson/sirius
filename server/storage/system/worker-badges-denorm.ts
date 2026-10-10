import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { denorm, entityNotes, optionsNoteType, optionsWorkerBadgeTypes, workers,
  workerBadgesDenorm, type EntityNote } from "@shared/schema";
import { getClient } from "../transaction-context";

export interface NoteBadgeRule {
  noteTypeId: string;
  badgeTypeId: string;
}
export interface NoteBadgeGrant {
  workerId: string;
  badgeTypeId: string;
  grantedTimestamp: Date;
}

export interface WorkerBadgeOriginRow {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  active: boolean | null;
  grantedTimestamp: Date | null;
  revokedTimestamp: Date | null;
  origin: { entityType: string; entityId: string } | null;
}

/** Payload writes are exclusively owned by denorm plugins, never routes. */
export interface WorkerBadgesDenormStorage {
  getByWorker(workerId: string): Promise<WorkerBadgeOriginRow[]>;
  validateNoteRule(rule: NoteBadgeRule): Promise<string[]>;
  getQualifyingNote(noteId: string, rule: NoteBadgeRule): Promise<EntityNote | undefined>;
  findNoteCandidates(rule: NoteBadgeRule, limit: number): Promise<string[]>;
  findNoteWidows(configId: string, rule: NoteBadgeRule, limit: number): Promise<string[]>;
  insertGrant(denormId: string, grant: NoteBadgeGrant): Promise<void>;
}

function qualifies(rule: NoteBadgeRule) {
  return and(
    eq(entityNotes.contextId, "worker"),
    eq(entityNotes.typeId, rule.noteTypeId),
    sql`exists (select 1 from ${workers} where ${workers.id} = ${entityNotes.entityId})`,
    sql`exists (select 1 from ${optionsNoteType}
      where ${optionsNoteType.id} = ${entityNotes.typeId}
      and coalesce(${optionsNoteType.data}->'contextIds', '[]'::jsonb) ? 'worker')`,
    sql`exists (select 1 from ${optionsWorkerBadgeTypes}
      where ${optionsWorkerBadgeTypes.id} = ${rule.badgeTypeId})`,
  )!;
}

export function createWorkerBadgesDenormStorage(): WorkerBadgesDenormStorage {
  return {
    async getByWorker(workerId) {
      // ALL persisted awards, including inactive/error/stale ones. No data JSON.
      return getClient().select({
        id: workerBadgesDenorm.id, name: optionsWorkerBadgeTypes.name,
        icon: optionsWorkerBadgeTypes.icon, description: optionsWorkerBadgeTypes.description,
        active: workerBadgesDenorm.active,
        grantedTimestamp: workerBadgesDenorm.grantedTimestamp,
        revokedTimestamp: workerBadgesDenorm.revokedTimestamp,
        origin: { entityType: denorm.entityType, entityId: denorm.entityId },
      }).from(workerBadgesDenorm)
        .innerJoin(optionsWorkerBadgeTypes, eq(optionsWorkerBadgeTypes.id, workerBadgesDenorm.badgeTypeId))
        .leftJoin(denorm, eq(denorm.id, workerBadgesDenorm.denormId))
        .where(eq(workerBadgesDenorm.workerId, workerId))
        .orderBy(sql`${workerBadgesDenorm.grantedTimestamp} asc nulls last`, asc(workerBadgesDenorm.id));
    },
    async validateNoteRule(rule) {
      const client = getClient();
      const [noteType] = await client.select().from(optionsNoteType)
        .where(eq(optionsNoteType.id, rule.noteTypeId));
      const [badgeType] = await client.select({ id: optionsWorkerBadgeTypes.id })
        .from(optionsWorkerBadgeTypes).where(eq(optionsWorkerBadgeTypes.id, rule.badgeTypeId));
      const errors: string[] = [];
      if (!noteType) errors.push("The selected note type does not exist.");
      else if (!(noteType.data as { contextIds?: string[] } | null)?.contextIds?.includes("worker")) {
        errors.push("The selected note type must apply to Workers.");
      }
      if (!badgeType) errors.push("The selected badge type does not exist.");
      return errors;
    },
    async getQualifyingNote(noteId, rule) {
      const [note] = await getClient().select().from(entityNotes)
        .where(and(eq(entityNotes.id, noteId), qualifies(rule)));
      return note;
    },
    async findNoteCandidates(rule, limit) {
      // Award absence, NOT status absence: a losing note may already have an
      // OK status when the badge belonging to a different note disappears.
      const rows = await getClient().selectDistinctOn([entityNotes.entityId], { id: entityNotes.id })
        .from(entityNotes)
        .where(and(qualifies(rule), sql`not exists (select 1 from ${workerBadgesDenorm}
          where ${workerBadgesDenorm.workerId} = ${entityNotes.entityId}
          and ${workerBadgesDenorm.badgeTypeId} = ${rule.badgeTypeId})`))
        .orderBy(asc(entityNotes.entityId), asc(entityNotes.timestamp), asc(entityNotes.id))
        .limit(limit);
      return rows.map(row => row.id);
    },
    async findNoteWidows(configId, rule, limit) {
      const rows = await getClient().select({ id: denorm.entityId }).from(denorm)
        .leftJoin(entityNotes, eq(entityNotes.id, denorm.entityId))
        .leftJoin(workerBadgesDenorm, eq(workerBadgesDenorm.denormId, denorm.id))
        .where(and(eq(denorm.configId, configId), or(
          sql`not coalesce((${qualifies(rule)}), false)`,
          and(isNotNull(workerBadgesDenorm.id), sql`(
            ${workerBadgesDenorm.workerId} is distinct from ${entityNotes.entityId}
            or ${workerBadgesDenorm.badgeTypeId} is distinct from ${rule.badgeTypeId}
            or ${workerBadgesDenorm.grantedTimestamp} is distinct from ${entityNotes.timestamp}
            or ${workerBadgesDenorm.active} is distinct from true
            or ${workerBadgesDenorm.revokedTimestamp} is not null
          )`),
        )))
        .orderBy(asc(denorm.entityId)).limit(limit);
      return rows.map(row => row.id);
    },
    async insertGrant(denormId, grant) {
      // Never overwrite an existing award's ownership. The unique pair is the
      // claim, and DO NOTHING is safe even inside the framework transaction.
      await getClient().insert(workerBadgesDenorm).values({
        ...grant, denormId, active: true, revokedTimestamp: null,
      }).onConflictDoNothing();
    },
  };
}
