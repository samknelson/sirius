import { workers, employers, dispatchJobs } from "@shared/schema";
import { workerDispatchStatus } from "../../../../shared/schema/dispatch/schema";
import { dispatchJobFore } from "../../../../shared/schema/dispatch/fore-schema";
import { WORKER_EXTRA_FIELDS } from "../../../storage/bulk/tokens";
import { WORKER_DEFAULT_LEAF } from "./worker";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";

/**
 * Named sample dispatch jobs, one per shared persona id. Values are obviously
 * fictional: a preview must never be mistaken for a real dispatch record.
 */
const DISPATCH_JOB_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      title: "Regolith Collection — Sector 7",
      description: "Loading and hauling regolith from the Sector 7 extraction zone",
      // employer_id is a foreign key: against a real row the token renders
      // the employer's NAME, so the sample must be a name too.
      employer_id: "Olympus Mons Freight",
      status: "open",
      start_ymd: "2031-03-14",
      worker_count: "12",
      pay_rate: "45.00",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      title: "Analytical Engine Shift — Menabrea Hall",
      description: "Operating and maintaining the analytical engine during scheduled computation sessions",
      employer_id: "Difference Engine Works",
      status: "open",
      start_ymd: "1843-12-10",
      worker_count: "6",
      pay_rate: "22.50",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      title: "Voyage Crew — Ithaka Fleet",
      description: "Navigation and seamanship duties for the return fleet voyage",
      employer_id: "Ithaka Shipping Company",
      status: "in_progress",
      start_ymd: "1184-03-02",
      worker_count: "20",
      pay_rate: "18.00",
    },
  },
];

// Persona ids match the worker/contact sets, so one pick tells one coherent
// story. Every field the notifier's DEFAULT templates render is named here —
// including the derived `status_label` and the `worker_id` the default link
// path uses — so switching persona visibly changes the preview instead of
// re-rendering the same sentence.
const DISPATCH_WORKER_STATUS_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      worker_id: "SAMPLE-W001",
      status: "available",
      status_label: "Available",
      seniority_date: "January 1, 2028",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      worker_id: "SAMPLE-W002",
      status: "not_available",
      status_label: "Not Available",
      seniority_date: "January 1, 1840",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      worker_id: "SAMPLE-W003",
      status: "available",
      status_label: "Available",
      seniority_date: "January 1, 1180",
    },
  },
];

// Job ids mirror the dispatch-job personas, so a foreperson preview and a
// job preview tell the same story. The job's title and employer are read
// through the job itself, not copied onto the membership.
const DISPATCH_FORE_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      job_id: "SAMPLE-J001",
      action: "added",
      action_label: "Added",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      job_id: "SAMPLE-J002",
      action: "added",
      action_label: "Added",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      job_id: "SAMPLE-J003",
      action: "removed",
      action_label: "Removed",
    },
  },
];

/**
 * Token plugins for the dispatch entity kinds, used by the
 * token-templated dispatch notifiers:
 *   - `dispatch_job` — a dispatch job row (descriptor; the T631
 *     interview relation already outputs this kind, but the descriptor
 *     keeps the kind's field catalog independent of the T631 component).
 *   - `dispatch_worker_status` — a worker's dispatch availability row.
 *   - `dispatch_fore` — a job-foreperson membership; the notifier
 *     merges the event's `action` (added/removed) onto the row.
 */
export const DISPATCH_JOB_ENTITY_KIND = "dispatch_job";
export const DISPATCH_WORKER_STATUS_ENTITY_KIND = "dispatch_worker_status";
export const DISPATCH_FORE_ENTITY_KIND = "dispatch_fore";

const COMPONENT = "dispatch";

/** Dispatch job descriptor (FK employer_id auto-renders the employer name). */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_job",
    name: "Dispatch job",
    description: "Descriptor for the dispatch job entity kind",
    segmentName: "__dispatch_job",
    inputTypes: [],
    outputType: DISPATCH_JOB_ENTITY_KIND,
    entityTable: dispatchJobs,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    defaultLeaf: "title",
    sampleSets: DISPATCH_JOB_SAMPLE_SETS,
    // A job has its own page.
    entityLocation: {
      tabEntity: "dispatch_job",
      idField: "id",
      defaultTab: "details",
    },
    // A dispatch job has no entity-scoped view policy: every page that
    // reads one is gated `admin` plus the dispatch component, with no
    // job id passed. Preview enforces exactly that gate — inventing a
    // per-job rule here would make preview disagree with the job pages.
    previewEntity: {
      gate: { scope: "route", policy: "admin" },
      async load(storage, id) {
        const row = await storage.dispatchJobs.get(id);
        if (!row) return null;
        return {
          entity: {
            kind: DISPATCH_JOB_ENTITY_KIND,
            row: row as unknown as Record<string, unknown>,
            table: dispatchJobs,
          },
          label: `${row.title} — ${row.startYmd}`,
        };
      },
    },
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_FORE_ENTITY_KIND);
    const jobId = e?.row.jobId;
    if (typeof jobId !== "string") return null;
    const row = await memo(ctx, `dispatch-job-row:${jobId}`, async () => {
      return (await ctx.storage.dispatchJobs.get(jobId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = {
      kind: DISPATCH_JOB_ENTITY_KIND,
      row: row as unknown as Record<string, unknown>,
      table: dispatchJobs,
    };
    return out;
  },
});
/** {{event.dispatch_job.field(name="…")}} — the fore membership's job. */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore.dispatch_job",
    name: "Dispatch job",
    description: "The dispatch job this foreperson record belongs to",
    segmentName: "dispatch_job",
    inputTypes: [DISPATCH_FORE_ENTITY_KIND],
    outputType: DISPATCH_JOB_ENTITY_KIND,
    entityTable: dispatchJobs,
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_FORE_ENTITY_KIND);
    const jobId = e?.row.jobId;
    if (typeof jobId !== "string") return null;
    const row = await memo(ctx, `dispatch-job-row:${jobId}`, async () => {
      return (await ctx.storage.dispatchJobs.get(jobId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = {
      kind: DISPATCH_JOB_ENTITY_KIND,
      row: row as unknown as Record<string, unknown>,
      table: dispatchJobs,
    };
    return out;
  },
});
/**
 * Dispatch worker status descriptor — a worker's dispatch availability row.
 * `action` is a derived extra the notifier merges onto the row.
 */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_worker_status",
    name: "Dispatch worker status",
    description: "Descriptor for the dispatch worker availability entity kind",
    segmentName: "__dispatch_worker_status",
    inputTypes: [],
    outputType: DISPATCH_WORKER_STATUS_ENTITY_KIND,
    entityTable: workerDispatchStatus,
    // `status_label` is derived, not a column: the notifier merges it onto
    // the row from the event.
    entityFields: ["status_label"],
    // `{{dispatch}}` on its own means the availability's human label —
    // "Available", "Not available" — the phrase that names the row.
    defaultLeaf: "status_label",
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: DISPATCH_WORKER_STATUS_SAMPLE_SETS,
    // No page of its own: the worker's dispatch status tab is where the
    // row is shown, reached through the row's worker FK.
    entityLocation: {
      tabEntity: "worker",
      idField: "workerId",
      defaultTab: "dispatch-status",
    },
    // An availability row is read as a read of its WORKER (`worker.view`
    // on the worker id, plus the dispatch component) — the row has no
    // policy of its own, so the gate subject is the worker, not the row.
    previewEntity: {
      gate: { scope: "record", policy: "worker.view" },
      async load(storage, id) {
        // The notifier owns the derived wording; composing it separately
        // here would drift from what delivery actually sends.
        const [{ dispatchStatusLabel }, { createWorkerDispatchStatusStorage }] =
          await Promise.all([
            import("../../event-notifier/plugins/dispatch-status-notifier"),
            import("../../../storage/dispatch/worker-status"),
          ]);
        const row = await createWorkerDispatchStatusStorage().get(id);
        if (!row) return null;
        const workerName = await storage.workers.getWorkerDisplayName(
          row.workerId,
        );
        return {
          entity: {
            kind: DISPATCH_WORKER_STATUS_ENTITY_KIND,
            row: {
              ...(row as unknown as Record<string, unknown>),
              statusLabel: dispatchStatusLabel(row.status),
            },
            table: workerDispatchStatus,
          },
          label: `${workerName} — ${dispatchStatusLabel(row.status)}`,
          gateEntityId: row.workerId,
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});

/**
 * {{dispatch.worker.…}} — the worker whose availability row this is.
 * Reaches the worker's contact (and from there their address, phone,
 * …), so a status message can name the person it is about.
 */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_worker_status.worker",
    name: "Worker",
    description: "The worker this dispatch status belongs to",
    segmentName: "worker",
    inputTypes: [DISPATCH_WORKER_STATUS_ENTITY_KIND],
    outputType: "worker",
    entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS,
    defaultLeaf: WORKER_DEFAULT_LEAF,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_WORKER_STATUS_ENTITY_KIND);
    const workerId = e?.row.workerId;
    if (typeof workerId !== "string") return null;
    const row = await memo(ctx, `worker-row-by-id:${workerId}`, async () => {
      return (await ctx.storage.bulkTokens.getWorkerRowById(workerId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "worker", row, table: workers };
    return out;
  },
});

/** {{dispatch_fore.worker.…}} — the foreperson the membership is for. */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore.worker",
    name: "Worker",
    description: "The worker named as foreperson",
    segmentName: "worker",
    inputTypes: [DISPATCH_FORE_ENTITY_KIND],
    outputType: "worker",
    entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS,
    defaultLeaf: WORKER_DEFAULT_LEAF,
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_FORE_ENTITY_KIND);
    const workerId = e?.row.workerId;
    if (typeof workerId !== "string") return null;
    const row = await memo(ctx, `worker-row-by-id:${workerId}`, async () => {
      return (await ctx.storage.bulkTokens.getWorkerRowById(workerId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "worker", row, table: workers };
    return out;
  },
});

/**
 * Dispatch fore descriptor — a job-foreperson membership row. `action`
 * (added/removed) is a derived extra the notifier merges onto the row.
 */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore",
    name: "Dispatch foreperson",
    description: "Descriptor for the dispatch foreperson membership entity kind",
    segmentName: "__dispatch_fore",
    inputTypes: [],
    outputType: DISPATCH_FORE_ENTITY_KIND,
    entityTable: dispatchJobFore,
    // Derived extras, not columns: whoever builds a membership merges
    // these on (the notifier, from the event). The job's title and the
    // employer's name are NOT here — they belong to the job, and templates
    // reach them through it.
    entityFields: ["action", "action_label"],
    // `{{fore}}` on its own means what happened to the membership —
    // "Added"/"Removed" — the phrase that names the row (worker and job
    // are their own records, reached through relations).
    defaultLeaf: "action_label",
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
    sampleSets: DISPATCH_FORE_SAMPLE_SETS,
    // No page of its own: the job's foreperson tab lists the membership,
    // reached through the row's job FK.
    entityLocation: {
      tabEntity: "dispatch_job",
      idField: "jobId",
      defaultTab: "foreperson",
    },
    // A membership row is read as a read of the WORKER named as
    // foreperson (`worker.view` on the worker id, plus the fore
    // component).
    previewEntity: {
      gate: { scope: "record", policy: "worker.view" },
      async load(storage, id) {
        const row = await storage.dispatchJobFore.get(id);
        if (!row) return null;
        const [workerName, job] = await Promise.all([
          storage.workers.getWorkerDisplayName(row.workerId),
          storage.dispatchJobs.get(row.jobId),
        ]);
        return {
          entity: {
            kind: DISPATCH_FORE_ENTITY_KIND,
            row: {
              ...(row as unknown as Record<string, unknown>),
              // The membership exists, so the event it stands for is the
              // one that added it — the same wording the picker has
              // always shown for a record that is currently in place.
              action: "added",
              actionLabel: "Added",
            },
            table: dispatchJobFore,
          },
          label: [workerName, job?.title || "Untitled job"]
            .filter(Boolean)
            .join(" — "),
          gateEntityId: row.workerId,
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});
