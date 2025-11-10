import { db } from "../db";
import { workerEmphist, workers, contacts, optionsEmploymentStatus, type WorkerEmphist, type InsertWorkerEmphist } from "@shared/schema";
import { eq, and, desc, isNotNull, inArray, sql } from "drizzle-orm";

export interface WorkerEmphistStorage {
  getWorkerEmphistByWorkerId(workerId: string): Promise<WorkerEmphist[]>;
  getByEmployerId(employerId: string, employmentStatusId?: string): Promise<WorkerEmphist[]>;
  getWorkerEmphist(id: string): Promise<WorkerEmphist | undefined>;
  createWorkerEmphist(emphist: InsertWorkerEmphist): Promise<WorkerEmphist>;
  updateWorkerEmphist(id: string, emphist: Partial<InsertWorkerEmphist>): Promise<WorkerEmphist | undefined>;
  deleteWorkerEmphist(id: string): Promise<boolean>;
}

async function updateWorkerDenormalizedFieldsInTransaction(tx: any, workerId: string): Promise<void> {
  const emphist = await tx
    .select({
      id: workerEmphist.id,
      employerId: workerEmphist.employerId,
      home: workerEmphist.home,
      date: workerEmphist.date,
      employmentStatus: workerEmphist.employmentStatus,
      employed: optionsEmploymentStatus.employed,
    })
    .from(workerEmphist)
    .leftJoin(optionsEmploymentStatus, eq(workerEmphist.employmentStatus, optionsEmploymentStatus.id))
    .where(eq(workerEmphist.workerId, workerId))
    .orderBy(desc(workerEmphist.date));

  let denormHomeEmployerId: string | null = null;
  const denormEmployerIds: string[] = [];
  const employerIdSet = new Set<string>();

  for (const record of emphist) {
    if (record.home && !denormHomeEmployerId) {
      denormHomeEmployerId = record.employerId;
    }

    if (record.employed && record.employerId && !employerIdSet.has(record.employerId)) {
      employerIdSet.add(record.employerId);
      denormEmployerIds.push(record.employerId);
    }
  }

  await tx
    .update(workers)
    .set({
      denormHomeEmployerId,
      denormEmployerIds: denormEmployerIds.length > 0 ? denormEmployerIds : null,
    })
    .where(eq(workers.id, workerId));
}

export function createWorkerEmphistStorage(): WorkerEmphistStorage {
  return {
    async getWorkerEmphistByWorkerId(workerId: string): Promise<WorkerEmphist[]> {
      return db
        .select()
        .from(workerEmphist)
        .where(eq(workerEmphist.workerId, workerId))
        .orderBy(desc(workerEmphist.date));
    },

    async getByEmployerId(employerId: string, employmentStatusId?: string): Promise<any[]> {
      const mostRecentSubquery = db
        .select({
          workerId: workerEmphist.workerId,
          maxDate: sql<string>`MAX(${workerEmphist.date})`.as('max_date'),
        })
        .from(workerEmphist)
        .where(eq(workerEmphist.employerId, employerId))
        .groupBy(workerEmphist.workerId)
        .as('most_recent');

      const query = db
        .select({
          id: workerEmphist.id,
          workerId: workerEmphist.workerId,
          workerSiriusId: workers.siriusId,
          contactId: workers.contactId,
          contactName: contacts.displayName,
          employerId: workerEmphist.employerId,
          date: workerEmphist.date,
          employmentStatus: workerEmphist.employmentStatus,
          employmentStatusName: optionsEmploymentStatus.name,
          position: workerEmphist.position,
          home: workerEmphist.home,
          note: workerEmphist.note,
        })
        .from(workerEmphist)
        .leftJoin(optionsEmploymentStatus, eq(workerEmphist.employmentStatus, optionsEmploymentStatus.id))
        .leftJoin(workers, eq(workerEmphist.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .innerJoin(
          mostRecentSubquery,
          and(
            eq(workerEmphist.workerId, mostRecentSubquery.workerId),
            sql`${workerEmphist.date} = ${mostRecentSubquery.maxDate}`
          )
        )
        .where(
          and(
            eq(workerEmphist.employerId, employerId),
            employmentStatusId ? eq(workerEmphist.employmentStatus, employmentStatusId) : undefined
          )
        );

      return query;
    },

    async getWorkerEmphist(id: string): Promise<WorkerEmphist | undefined> {
      const [emphist] = await db
        .select()
        .from(workerEmphist)
        .where(eq(workerEmphist.id, id));
      return emphist || undefined;
    },

    async createWorkerEmphist(insertEmphist: InsertWorkerEmphist): Promise<WorkerEmphist> {
      return await db.transaction(async (tx) => {
        const [emphist] = await tx
          .insert(workerEmphist)
          .values(insertEmphist)
          .returning();
        
        await updateWorkerDenormalizedFieldsInTransaction(tx, insertEmphist.workerId);
        
        return emphist;
      });
    },

    async updateWorkerEmphist(id: string, emphistUpdate: Partial<InsertWorkerEmphist>): Promise<WorkerEmphist | undefined> {
      return await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(workerEmphist)
          .where(eq(workerEmphist.id, id))
          .then(rows => rows[0]);
        
        if (!existing) return undefined;
        
        const [emphist] = await tx
          .update(workerEmphist)
          .set(emphistUpdate)
          .where(eq(workerEmphist.id, id))
          .returning();
        
        if (!emphist) return undefined;
        
        await updateWorkerDenormalizedFieldsInTransaction(tx, emphist.workerId);
        
        if (emphist.workerId !== existing.workerId) {
          await updateWorkerDenormalizedFieldsInTransaction(tx, existing.workerId);
        }
        
        return emphist;
      });
    },

    async deleteWorkerEmphist(id: string): Promise<boolean> {
      return await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(workerEmphist)
          .where(eq(workerEmphist.id, id))
          .then(rows => rows[0]);
        
        if (!existing) return false;
        
        const result = await tx
          .delete(workerEmphist)
          .where(eq(workerEmphist.id, id))
          .returning();
        
        if (result.length > 0) {
          await updateWorkerDenormalizedFieldsInTransaction(tx, existing.workerId);
          return true;
        }
        
        return false;
      });
    }
  };
}
