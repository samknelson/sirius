import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  trustWmbScanStatus,
  trustWmbScanQueue,
  workers,
  contacts,
  type TrustWmbScanStatus,
  type TrustWmbScanQueue,
} from "@shared/schema";
import { eq, and, sql, gte, inArray, or, desc, asc } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface QueueEntryWithWorker extends TrustWmbScanQueue {
  workerSiriusId: number | null;
  workerDisplayName: string | null;
}

export interface JobResultInfo {
  scanCompleted: boolean;
  completedStatus?: TrustWmbScanStatus;
}

export interface QueueEntriesFilter {
  search?: string;
  outcome?: "started" | "continued" | "terminated" | null;
  status?: string;
}

export interface PagedQueueEntriesResult {
  data: QueueEntryWithWorker[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WmbScanQueueStorage {
  // Status methods
  getMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus | undefined>;
  getStatusById(id: string): Promise<TrustWmbScanStatus | undefined>;
  getAllMonthStatuses(): Promise<TrustWmbScanStatus[]>;
  createMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus>;
  updateMonthStatus(id: string, data: Partial<TrustWmbScanStatus>): Promise<TrustWmbScanStatus | undefined>;
  
  // Queue methods
  getQueuedWorkers(statusId: string): Promise<TrustWmbScanQueue[]>;
  getQueueEntriesWithWorkerInfo(statusId: string): Promise<QueueEntryWithWorker[]>;
  getQueueEntriesPaged(statusId: string, page: number, pageSize: number, filter?: QueueEntriesFilter): Promise<PagedQueueEntriesResult>;
  getWorkerQueueEntry(workerId: string, month: number, year: number): Promise<TrustWmbScanQueue | undefined>;
  
  // Bulk operations
  enqueueMonth(month: number, year: number): Promise<{ statusId: string; queuedCount: number }>;
  enqueueWorker(workerId: string, month: number, year: number, triggerSource: string): Promise<TrustWmbScanQueue>;
  
  // Job processing
  claimNextJob(): Promise<TrustWmbScanQueue | undefined>;
  recordJobResult(queueId: string, success: boolean, resultSummary: any, error?: string): Promise<JobResultInfo>;
  
  // Invalidation
  invalidateWorkerScans(workerId: string): Promise<number>;
  
  // Reporting
  getPendingSummary(): Promise<{ month: number; year: number; pending: number; processing: number; success: number; failed: number; canceled: number }[]>;
  
  // Cancel/Resume
  cancelPendingForStatus(statusId: string): Promise<number>;
  resumeCanceledForStatus(statusId: string): Promise<number>;
}

export function createWmbScanQueueStorage(): WmbScanQueueStorage {
  const storage: WmbScanQueueStorage = {
    async getMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus | undefined> {
      const client = getClient();
      const [status] = await client
        .select()
        .from(trustWmbScanStatus)
        .where(and(eq(trustWmbScanStatus.month, month), eq(trustWmbScanStatus.year, year)));
      return status || undefined;
    },

    async getStatusById(id: string): Promise<TrustWmbScanStatus | undefined> {
      const client = getClient();
      const [status] = await client
        .select()
        .from(trustWmbScanStatus)
        .where(eq(trustWmbScanStatus.id, id));
      return status || undefined;
    },

    async getAllMonthStatuses(): Promise<TrustWmbScanStatus[]> {
      const client = getClient();
      return client
        .select()
        .from(trustWmbScanStatus)
        .orderBy(desc(trustWmbScanStatus.year), desc(trustWmbScanStatus.month));
    },

    async createMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus> {
      validate.validateOrThrow(month);
      const client = getClient();
      const [status] = await client
        .insert(trustWmbScanStatus)
        .values({ month, year, status: "queued" })
        .returning();
      return status;
    },

    async updateMonthStatus(id: string, data: Partial<TrustWmbScanStatus>): Promise<TrustWmbScanStatus | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [updated] = await client
        .update(trustWmbScanStatus)
        .set(data)
        .where(eq(trustWmbScanStatus.id, id))
        .returning();
      return updated || undefined;
    },

    async getQueuedWorkers(statusId: string): Promise<TrustWmbScanQueue[]> {
      const client = getClient();
      return client
        .select()
        .from(trustWmbScanQueue)
        .where(eq(trustWmbScanQueue.statusId, statusId))
        .orderBy(asc(trustWmbScanQueue.status), asc(trustWmbScanQueue.id));
    },

    async getQueueEntriesWithWorkerInfo(statusId: string): Promise<QueueEntryWithWorker[]> {
      const client = getClient();
      const results = await client
        .select({
          id: trustWmbScanQueue.id,
          statusId: trustWmbScanQueue.statusId,
          workerId: trustWmbScanQueue.workerId,
          month: trustWmbScanQueue.month,
          year: trustWmbScanQueue.year,
          status: trustWmbScanQueue.status,
          triggerSource: trustWmbScanQueue.triggerSource,
          resultSummary: trustWmbScanQueue.resultSummary,
          scheduledFor: trustWmbScanQueue.scheduledFor,
          pickedAt: trustWmbScanQueue.pickedAt,
          completedAt: trustWmbScanQueue.completedAt,
          attempts: trustWmbScanQueue.attempts,
          lastError: trustWmbScanQueue.lastError,
          workerSiriusId: workers.siriusId,
          workerDisplayName: contacts.displayName,
        })
        .from(trustWmbScanQueue)
        .leftJoin(workers, eq(trustWmbScanQueue.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(trustWmbScanQueue.statusId, statusId))
        .orderBy(asc(workers.siriusId), asc(trustWmbScanQueue.id));
      return results;
    },

    async getQueueEntriesPaged(statusId: string, page: number, pageSize: number, filter?: QueueEntriesFilter): Promise<PagedQueueEntriesResult> {
      const client = getClient();
      const offset = (page - 1) * pageSize;
      
      // Build WHERE conditions
      const conditions: any[] = [eq(trustWmbScanQueue.statusId, statusId)];
      
      // Search filter on worker name or sirius ID
      if (filter?.search) {
        const searchTerm = `%${filter.search}%`;
        conditions.push(
          or(
            sql`${contacts.displayName} ILIKE ${searchTerm}`,
            sql`CAST(${workers.siriusId} AS TEXT) LIKE ${searchTerm}`
          )
        );
      }
      
      // Status filter
      if (filter?.status) {
        conditions.push(eq(trustWmbScanQueue.status, filter.status));
      }
      
      // Outcome filter - uses JSONB queries with COALESCE to handle null resultSummary
      if (filter?.outcome === "started") {
        // Has at least one action with scanType=start AND eligible=true
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(${trustWmbScanQueue.resultSummary}->'actions', '[]'::jsonb)) AS action
            WHERE action->>'scanType' = 'start' AND (action->>'eligible')::boolean = true
          )`
        );
      } else if (filter?.outcome === "continued") {
        // Has at least one action with scanType=continue AND eligible=true AND action != delete
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(${trustWmbScanQueue.resultSummary}->'actions', '[]'::jsonb)) AS action
            WHERE action->>'scanType' = 'continue' AND (action->>'eligible')::boolean = true AND action->>'action' != 'delete'
          )`
        );
      } else if (filter?.outcome === "terminated") {
        // Has at least one action with scanType=continue AND action=delete
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(${trustWmbScanQueue.resultSummary}->'actions', '[]'::jsonb)) AS action
            WHERE action->>'scanType' = 'continue' AND action->>'action' = 'delete'
          )`
        );
      }
      
      const whereClause = and(...conditions);
      
      // Get total count
      const [countResult] = await client
        .select({ count: sql<number>`count(*)` })
        .from(trustWmbScanQueue)
        .leftJoin(workers, eq(trustWmbScanQueue.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(whereClause);
      
      const total = Number(countResult?.count) || 0;
      
      // Get paged data
      const results = await client
        .select({
          id: trustWmbScanQueue.id,
          statusId: trustWmbScanQueue.statusId,
          workerId: trustWmbScanQueue.workerId,
          month: trustWmbScanQueue.month,
          year: trustWmbScanQueue.year,
          status: trustWmbScanQueue.status,
          triggerSource: trustWmbScanQueue.triggerSource,
          resultSummary: trustWmbScanQueue.resultSummary,
          scheduledFor: trustWmbScanQueue.scheduledFor,
          pickedAt: trustWmbScanQueue.pickedAt,
          completedAt: trustWmbScanQueue.completedAt,
          attempts: trustWmbScanQueue.attempts,
          lastError: trustWmbScanQueue.lastError,
          workerSiriusId: workers.siriusId,
          workerDisplayName: contacts.displayName,
        })
        .from(trustWmbScanQueue)
        .leftJoin(workers, eq(trustWmbScanQueue.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(whereClause)
        .orderBy(asc(workers.siriusId), asc(trustWmbScanQueue.id))
        .offset(offset)
        .limit(pageSize);
      
      return { data: results, page, pageSize, total };
    },

    async getWorkerQueueEntry(workerId: string, month: number, year: number): Promise<TrustWmbScanQueue | undefined> {
      const client = getClient();
      const [entry] = await client
        .select()
        .from(trustWmbScanQueue)
        .where(
          and(
            eq(trustWmbScanQueue.workerId, workerId),
            eq(trustWmbScanQueue.month, month),
            eq(trustWmbScanQueue.year, year)
          )
        );
      return entry || undefined;
    },

    async enqueueMonth(month: number, year: number): Promise<{ statusId: string; queuedCount: number }> {
      const client = getClient();
      return client.transaction(async (tx) => {
        // Get or create status record
        let [status] = await tx
          .select()
          .from(trustWmbScanStatus)
          .where(and(eq(trustWmbScanStatus.month, month), eq(trustWmbScanStatus.year, year)));
        
        if (!status) {
          [status] = await tx
            .insert(trustWmbScanStatus)
            .values({ month, year, status: "queued" })
            .returning();
        } else {
          // Reset status counters for re-queue
          [status] = await tx
            .update(trustWmbScanStatus)
            .set({
              status: "queued",
              totalQueued: 0,
              processedSuccess: 0,
              processedFailed: 0,
              benefitsStarted: 0,
              benefitsContinued: 0,
              benefitsTerminated: 0,
              startedAt: null,
              completedAt: null,
            })
            .where(eq(trustWmbScanStatus.id, status.id))
            .returning();
        }

        // Reset all existing queue entries for this month to pending
        await tx
          .update(trustWmbScanQueue)
          .set({
            status: "pending",
            triggerSource: "monthly_batch",
            attempts: 0,
            lastError: null,
            pickedAt: null,
            completedAt: null,
            resultSummary: null,
          })
          .where(eq(trustWmbScanQueue.statusId, status.id));

        // Get all active workers
        const activeWorkers = await tx
          .select({ id: workers.id })
          .from(workers);

        // Get existing queue entries for this month
        const existingEntries = await tx
          .select({ workerId: trustWmbScanQueue.workerId })
          .from(trustWmbScanQueue)
          .where(eq(trustWmbScanQueue.statusId, status.id));
        
        const existingWorkerIds = new Set(existingEntries.map(e => e.workerId));

        // Insert queue entries only for workers not already in queue
        let newCount = 0;
        for (const worker of activeWorkers) {
          if (!existingWorkerIds.has(worker.id)) {
            await tx
              .insert(trustWmbScanQueue)
              .values({
                statusId: status.id,
                workerId: worker.id,
                month,
                year,
                status: "pending",
                triggerSource: "monthly_batch",
              });
            newCount++;
          }
        }

        // Set totalQueued to actual count of workers in queue
        const totalQueued = existingEntries.length + newCount;
        await tx
          .update(trustWmbScanStatus)
          .set({ totalQueued })
          .where(eq(trustWmbScanStatus.id, status.id));

        return { statusId: status.id, queuedCount: totalQueued };
      });
    },

    async enqueueWorker(workerId: string, month: number, year: number, triggerSource: string): Promise<TrustWmbScanQueue> {
      const client = getClient();
      return client.transaction(async (tx) => {
        // Get or create status record
        let [status] = await tx
          .select()
          .from(trustWmbScanStatus)
          .where(and(eq(trustWmbScanStatus.month, month), eq(trustWmbScanStatus.year, year)));
        
        if (!status) {
          [status] = await tx
            .insert(trustWmbScanStatus)
            .values({ month, year, status: "queued" })
            .returning();
        }

        // Upsert queue entry
        const [existing] = await tx
          .select()
          .from(trustWmbScanQueue)
          .where(
            and(
              eq(trustWmbScanQueue.workerId, workerId),
              eq(trustWmbScanQueue.month, month),
              eq(trustWmbScanQueue.year, year)
            )
          );

        if (existing) {
          const [updated] = await tx
            .update(trustWmbScanQueue)
            .set({
              status: "pending",
              triggerSource,
              attempts: 0,
              lastError: null,
              pickedAt: null,
              completedAt: null,
            })
            .where(eq(trustWmbScanQueue.id, existing.id))
            .returning();
          return updated;
        }

        const [entry] = await tx
          .insert(trustWmbScanQueue)
          .values({
            statusId: status.id,
            workerId,
            month,
            year,
            status: "pending",
            triggerSource,
          })
          .returning();

        // Update status totals
        await tx
          .update(trustWmbScanStatus)
          .set({ totalQueued: sql`${trustWmbScanStatus.totalQueued} + 1` })
          .where(eq(trustWmbScanStatus.id, status.id));

        return entry;
      });
    },

    async claimNextJob(): Promise<TrustWmbScanQueue | undefined> {
      const client = getClient();
      return client.transaction(async (tx) => {
        // Find and claim a pending job atomically with FOR UPDATE SKIP LOCKED
        const [job] = await tx
          .update(trustWmbScanQueue)
          .set({
            status: "processing",
            pickedAt: new Date(),
            attempts: sql`${trustWmbScanQueue.attempts} + 1`,
          })
          .where(
            and(
              eq(trustWmbScanQueue.status, "pending"),
              sql`${trustWmbScanQueue.id} = (
                SELECT id
                FROM trust_wmb_scan_queue
                WHERE status = 'pending'
                ORDER BY scheduled_for ASC NULLS LAST, id ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
              )`
            )
          )
          .returning();

        if (job) {
          // Update month status to running if needed (inside same transaction)
          await tx
            .update(trustWmbScanStatus)
            .set({ 
              status: "running",
              startedAt: sql`COALESCE(${trustWmbScanStatus.startedAt}, now())`,
            })
            .where(and(
              eq(trustWmbScanStatus.id, job.statusId),
              eq(trustWmbScanStatus.status, "queued")
            ));
        }

        return job || undefined;
      });
    },

    async recordJobResult(queueId: string, success: boolean, resultSummary: any, error?: string): Promise<JobResultInfo> {
      const client = getClient();
      return await client.transaction(async (tx) => {
        const [job] = await tx
          .update(trustWmbScanQueue)
          .set({
            status: success ? "success" : "failed",
            completedAt: new Date(),
            resultSummary,
            lastError: error || null,
          })
          .where(eq(trustWmbScanQueue.id, queueId))
          .returning();

        if (!job) return { scanCompleted: false };

        // Parse benefit outcomes from resultSummary
        // Priority: check for termination (delete action) before continuation (eligible)
        let benefitsStarted = 0;
        let benefitsContinued = 0;
        let benefitsTerminated = 0;
        
        if (resultSummary?.actions && Array.isArray(resultSummary.actions)) {
          for (const action of resultSummary.actions) {
            if (action.scanType === "start" && action.eligible) {
              benefitsStarted++;
            } else if (action.scanType === "continue") {
              // Check termination first - a "delete" action means they lost eligibility
              if (action.action === "delete") {
                benefitsTerminated++;
              } else if (action.eligible) {
                benefitsContinued++;
              }
            }
          }
        }

        // Update status counters including benefit counts
        const updateField = success ? "processedSuccess" : "processedFailed";
        await tx
          .update(trustWmbScanStatus)
          .set({
            [updateField]: sql`${trustWmbScanStatus[updateField]} + 1`,
            benefitsStarted: sql`${trustWmbScanStatus.benefitsStarted} + ${benefitsStarted}`,
            benefitsContinued: sql`${trustWmbScanStatus.benefitsContinued} + ${benefitsContinued}`,
            benefitsTerminated: sql`${trustWmbScanStatus.benefitsTerminated} + ${benefitsTerminated}`,
          })
          .where(eq(trustWmbScanStatus.id, job.statusId));

        // Check if all jobs are complete
        const [remaining] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(trustWmbScanQueue)
          .where(
            and(
              eq(trustWmbScanQueue.statusId, job.statusId),
              or(
                eq(trustWmbScanQueue.status, "pending"),
                eq(trustWmbScanQueue.status, "processing")
              )
            )
          );

        if (Number(remaining.count) === 0) {
          const [completedStatus] = await tx
            .update(trustWmbScanStatus)
            .set({
              status: "completed",
              completedAt: new Date(),
            })
            .where(eq(trustWmbScanStatus.id, job.statusId))
            .returning();
          
          return { scanCompleted: true, completedStatus };
        }
        
        return { scanCompleted: false };
      });
    },

    async invalidateWorkerScans(workerId: string): Promise<number> {
      const client = getClient();
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      // Reset all pending/success entries for current and future months to pending
      const result = await client
        .update(trustWmbScanQueue)
        .set({
          status: "pending",
          triggerSource: "worker_update",
          attempts: 0,
          lastError: null,
          pickedAt: null,
          completedAt: null,
          resultSummary: null,
        })
        .where(
          and(
            eq(trustWmbScanQueue.workerId, workerId),
            or(
              sql`${trustWmbScanQueue.year} > ${currentYear}`,
              and(
                sql`${trustWmbScanQueue.year} = ${currentYear}`,
                sql`${trustWmbScanQueue.month} >= ${currentMonth}`
              )
            ),
            or(
              eq(trustWmbScanQueue.status, "success"),
              eq(trustWmbScanQueue.status, "pending")
            )
          )
        )
        .returning();

      // Mark affected months as stale
      if (result.length > 0) {
        const statusIds = Array.from(new Set(result.map(r => r.statusId)));
        await client
          .update(trustWmbScanStatus)
          .set({ status: "stale" })
          .where(
            and(
              inArray(trustWmbScanStatus.id, statusIds),
              eq(trustWmbScanStatus.status, "completed")
            )
          );
      }

      return result.length;
    },

    async getPendingSummary(): Promise<{ month: number; year: number; pending: number; processing: number; success: number; failed: number; canceled: number }[]> {
      const client = getClient();
      const results = await client
        .select({
          month: trustWmbScanQueue.month,
          year: trustWmbScanQueue.year,
          pending: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'pending' THEN 1 ELSE 0 END)`,
          processing: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'processing' THEN 1 ELSE 0 END)`,
          success: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'success' THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'failed' THEN 1 ELSE 0 END)`,
          canceled: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'canceled' THEN 1 ELSE 0 END)`,
        })
        .from(trustWmbScanQueue)
        .groupBy(trustWmbScanQueue.month, trustWmbScanQueue.year)
        .orderBy(desc(trustWmbScanQueue.year), desc(trustWmbScanQueue.month));

      return results.map(r => ({
        month: r.month,
        year: r.year,
        pending: Number(r.pending) || 0,
        processing: Number(r.processing) || 0,
        success: Number(r.success) || 0,
        failed: Number(r.failed) || 0,
        canceled: Number(r.canceled) || 0,
      }));
    },

    async cancelPendingForStatus(statusId: string): Promise<number> {
      const client = getClient();
      const result = await client
        .update(trustWmbScanQueue)
        .set({ status: "canceled" })
        .where(
          and(
            eq(trustWmbScanQueue.statusId, statusId),
            eq(trustWmbScanQueue.status, "pending")
          )
        )
        .returning();
      
      // Update status to reflect cancellation
      if (result.length > 0) {
        await client
          .update(trustWmbScanStatus)
          .set({ status: "canceled" })
          .where(eq(trustWmbScanStatus.id, statusId));
      }
      
      return result.length;
    },

    async resumeCanceledForStatus(statusId: string): Promise<number> {
      const client = getClient();
      const result = await client
        .update(trustWmbScanQueue)
        .set({ status: "pending" })
        .where(
          and(
            eq(trustWmbScanQueue.statusId, statusId),
            eq(trustWmbScanQueue.status, "canceled")
          )
        )
        .returning();
      
      // Update status to queued to resume processing
      if (result.length > 0) {
        await client
          .update(trustWmbScanStatus)
          .set({ status: "queued" })
          .where(eq(trustWmbScanStatus.id, statusId));
      }
      
      return result.length;
    },
  };

  return storage;
}

// No logging config - scan queue operations are high-volume internal state changes
// Actual benefit changes are logged via the benefits-scan service
