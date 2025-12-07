import { db } from "../db";
import {
  trustWmbScanStatus,
  trustWmbScanQueue,
  workers,
  type TrustWmbScanStatus,
  type TrustWmbScanQueue,
} from "@shared/schema";
import { eq, and, sql, gte, inArray, or, desc, asc } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export interface WmbScanQueueStorage {
  // Status methods
  getMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus | undefined>;
  getAllMonthStatuses(): Promise<TrustWmbScanStatus[]>;
  createMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus>;
  updateMonthStatus(id: string, data: Partial<TrustWmbScanStatus>): Promise<TrustWmbScanStatus | undefined>;
  
  // Queue methods
  getQueuedWorkers(statusId: string): Promise<TrustWmbScanQueue[]>;
  getWorkerQueueEntry(workerId: string, month: number, year: number): Promise<TrustWmbScanQueue | undefined>;
  
  // Bulk operations
  enqueueMonth(month: number, year: number): Promise<{ statusId: string; queuedCount: number }>;
  enqueueWorker(workerId: string, month: number, year: number, triggerSource: string): Promise<TrustWmbScanQueue>;
  
  // Job processing
  claimNextJob(): Promise<TrustWmbScanQueue | undefined>;
  recordJobResult(queueId: string, success: boolean, resultSummary: any, error?: string): Promise<void>;
  
  // Invalidation
  invalidateWorkerScans(workerId: string): Promise<number>;
  
  // Reporting
  getPendingSummary(): Promise<{ month: number; year: number; pending: number; processing: number; success: number; failed: number }[]>;
}

export function createWmbScanQueueStorage(): WmbScanQueueStorage {
  const storage: WmbScanQueueStorage = {
    async getMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus | undefined> {
      const [status] = await db
        .select()
        .from(trustWmbScanStatus)
        .where(and(eq(trustWmbScanStatus.month, month), eq(trustWmbScanStatus.year, year)));
      return status || undefined;
    },

    async getAllMonthStatuses(): Promise<TrustWmbScanStatus[]> {
      return db
        .select()
        .from(trustWmbScanStatus)
        .orderBy(desc(trustWmbScanStatus.year), desc(trustWmbScanStatus.month));
    },

    async createMonthStatus(month: number, year: number): Promise<TrustWmbScanStatus> {
      const [status] = await db
        .insert(trustWmbScanStatus)
        .values({ month, year, status: "queued" })
        .returning();
      return status;
    },

    async updateMonthStatus(id: string, data: Partial<TrustWmbScanStatus>): Promise<TrustWmbScanStatus | undefined> {
      const [updated] = await db
        .update(trustWmbScanStatus)
        .set(data)
        .where(eq(trustWmbScanStatus.id, id))
        .returning();
      return updated || undefined;
    },

    async getQueuedWorkers(statusId: string): Promise<TrustWmbScanQueue[]> {
      return db
        .select()
        .from(trustWmbScanQueue)
        .where(eq(trustWmbScanQueue.statusId, statusId))
        .orderBy(asc(trustWmbScanQueue.status), asc(trustWmbScanQueue.id));
    },

    async getWorkerQueueEntry(workerId: string, month: number, year: number): Promise<TrustWmbScanQueue | undefined> {
      const [entry] = await db
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
      return db.transaction(async (tx) => {
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

        // Get all active workers
        const activeWorkers = await tx
          .select({ id: workers.id })
          .from(workers);

        // Insert queue entries for each worker (upsert to handle existing entries)
        let queuedCount = 0;
        for (const worker of activeWorkers) {
          const [existing] = await tx
            .select()
            .from(trustWmbScanQueue)
            .where(
              and(
                eq(trustWmbScanQueue.workerId, worker.id),
                eq(trustWmbScanQueue.month, month),
                eq(trustWmbScanQueue.year, year)
              )
            );

          if (existing) {
            // Reset to pending if not already completed
            if (existing.status !== "success") {
              await tx
                .update(trustWmbScanQueue)
                .set({
                  status: "pending",
                  triggerSource: "monthly_batch",
                  attempts: 0,
                  lastError: null,
                  pickedAt: null,
                  completedAt: null,
                })
                .where(eq(trustWmbScanQueue.id, existing.id));
              queuedCount++;
            }
          } else {
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
            queuedCount++;
          }
        }

        // Update status totals
        await tx
          .update(trustWmbScanStatus)
          .set({
            totalQueued: sql`${trustWmbScanStatus.totalQueued} + ${queuedCount}`,
            status: "queued",
          })
          .where(eq(trustWmbScanStatus.id, status.id));

        return { statusId: status.id, queuedCount };
      });
    },

    async enqueueWorker(workerId: string, month: number, year: number, triggerSource: string): Promise<TrustWmbScanQueue> {
      return db.transaction(async (tx) => {
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
      return db.transaction(async (tx) => {
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

    async recordJobResult(queueId: string, success: boolean, resultSummary: any, error?: string): Promise<void> {
      await db.transaction(async (tx) => {
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

        if (!job) return;

        // Update status counters
        const updateField = success ? "processedSuccess" : "processedFailed";
        await tx
          .update(trustWmbScanStatus)
          .set({
            [updateField]: sql`${trustWmbScanStatus[updateField]} + 1`,
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

        if (remaining.count === 0) {
          await tx
            .update(trustWmbScanStatus)
            .set({
              status: "completed",
              completedAt: new Date(),
            })
            .where(eq(trustWmbScanStatus.id, job.statusId));
        }
      });
    },

    async invalidateWorkerScans(workerId: string): Promise<number> {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      // Reset all pending/success entries for current and future months to pending
      const result = await db
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
        await db
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

    async getPendingSummary(): Promise<{ month: number; year: number; pending: number; processing: number; success: number; failed: number }[]> {
      const results = await db
        .select({
          month: trustWmbScanQueue.month,
          year: trustWmbScanQueue.year,
          pending: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'pending' THEN 1 ELSE 0 END)`,
          processing: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'processing' THEN 1 ELSE 0 END)`,
          success: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'success' THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN ${trustWmbScanQueue.status} = 'failed' THEN 1 ELSE 0 END)`,
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
      }));
    },
  };

  return storage;
}

export const wmbScanQueueLoggingConfig: StorageLoggingConfig<WmbScanQueueStorage> = {
  module: 'wmb-scan-queue',
  methods: {
    enqueueMonth: {
      enabled: true,
      getEntityId: (args, result) => result?.statusId || 'new',
      getDescription: async (args) => `Queued WMB scan for ${args[0]}/${args[1]}`,
    },
    enqueueWorker: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new',
      getHostEntityId: (args) => args[0],
      getDescription: async (args) => `Queued worker ${args[0]} for WMB scan ${args[1]}/${args[2]}`,
    },
    invalidateWorkerScans: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result) => `Invalidated ${result} WMB scan entries for worker`,
    },
  },
};
