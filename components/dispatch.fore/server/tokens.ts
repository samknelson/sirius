import { workers, dispatchJobs } from "@shared/schema";
import { dispatchJobFore } from "../shared/schema/dispatch/fore-schema";
import { WORKER_EXTRA_FIELDS } from "../../../server/storage/bulk/tokens";
import { WORKER_DEFAULT_LEAF } from "../../../server/plugins/tokens/plugins/worker";
import { registerTokenPlugin } from "../../../server/plugins/tokens/registry";
import { memo, tokenEntityOf, type TokenEntity } from "../../../server/plugins/tokens/types";

const KIND = "dispatch_fore";
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore.dispatch_job", name: "Dispatch job",
    description: "The dispatch job this foreperson record belongs to",
    segmentName: "dispatch_job", inputTypes: [KIND], outputType: "dispatch_job",
    entityTable: dispatchJobs, hiddenFromPicker: true, requiredComponent: "dispatch.fore",
  },
  async resolve(entity, _args, ctx) {
    const jobId = tokenEntityOf(entity, KIND)?.row.jobId;
    if (typeof jobId !== "string") return null;
    const row = await memo(ctx, `dispatch-job-row:${jobId}`, async () => (await ctx.storage.dispatchJobs.get(jobId)) ?? null);
    return row ? { kind: "dispatch_job", row: row as unknown as Record<string, unknown>, table: dispatchJobs } satisfies TokenEntity : null;
  },
});
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore.worker", name: "Worker", description: "The worker named as foreperson",
    segmentName: "worker", inputTypes: [KIND], outputType: "worker", entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS, defaultLeaf: WORKER_DEFAULT_LEAF,
    hiddenFromPicker: true, requiredComponent: "dispatch.fore",
  },
  async resolve(entity, _args, ctx) {
    const workerId = tokenEntityOf(entity, KIND)?.row.workerId;
    if (typeof workerId !== "string") return null;
    const row = await memo(ctx, `worker-row-by-id:${workerId}`, async () => (await ctx.storage.bulkTokens.getWorkerRowById(workerId)) ?? null);
    return row ? { kind: "worker", row, table: workers } satisfies TokenEntity : null;
  },
});
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore", name: "Dispatch foreperson", description: "Descriptor for the dispatch foreperson membership entity kind",
    segmentName: "__dispatch_fore", inputTypes: [], outputType: KIND, entityTable: dispatchJobFore,
    entityFields: ["action", "action_label"], defaultLeaf: "action_label",
    hiddenFromPicker: true, requiredComponent: "dispatch.fore",
    sampleSets: [
      { id: "martian", label: "Martian", values: { job_id: "SAMPLE-J001", action: "added", action_label: "Added" } },
      { id: "historical", label: "Historical", values: { job_id: "SAMPLE-J002", action: "added", action_label: "Added" } },
      { id: "mythological", label: "Mythological", values: { job_id: "SAMPLE-J003", action: "removed", action_label: "Removed" } },
    ],
    entityLocation: { tabEntity: "dispatch_job", idField: "jobId", defaultTab: "foreperson" },
    previewEntity: {
      gate: { scope: "record", policy: "worker.view" },
      async load(storage, id) {
        const row = await storage.dispatchJobFore.get(id);
        if (!row) return null;
        const [workerName, job] = await Promise.all([storage.workers.getWorkerDisplayName(row.workerId), storage.dispatchJobs.get(row.jobId)]);
        return {
          entity: { kind: KIND, row: { ...(row as unknown as Record<string, unknown>), action: "added", actionLabel: "Added" }, table: dispatchJobFore },
          label: [workerName, job?.title || "Untitled job"].filter(Boolean).join(" — "), gateEntityId: row.workerId,
        };
      },
    },
  },
  async resolve() { return null; },
});
