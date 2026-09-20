import { createHash } from "crypto";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { storage } from "../../../../storage";
import { getClient, runInTransaction } from "../../../../storage/transaction-context";
import {
  validate as validateEdlsSheet,
  type CrewInput,
} from "../../../../storage/edls/sheets";
import { wcRequest } from "../../../../services/webclient";
import { logger } from "../../../../logger";
import { getEdlsSettings } from "../../../edls/supervisor-context";
import { recomputeDenormEntity } from "../../../../plugins/system/denorm/registry";
import {
  dispatchJobGroups,
  edlsAssignments,
  edlsCrews,
  edlsSheets,
  optionsClassifications,
  optionsDepartment,
  optionsEdlsShowStatus,
  optionsEdlsTasks,
  optionsEmploymentStatus,
  facilities,
  users,
  workerHours,
  workers,
} from "@shared/schema";
import {
  FREEMAN_EDLS_FETCH_SHEETS_OPERATION,
  FREEMAN_EDLS_MIGRATE_PLUGIN_ID,
} from "../../../../plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate";

export const FREEMAN_MIGRATE_STATUSES = ["draft", "request", "lock", "trash", "reserved"] as const;
export type FreemanMigrateStatus = (typeof FREEMAN_MIGRATE_STATUSES)[number];
export const FREEMAN_MIGRATE_STATUS_VARIABLE = "SITESPECIFIC_FREEMAN_MIGRATE_STATUS";
const EPOCH = "1970-01-01T00:00:00.000Z";
// Freeman runs this through PHP strtotime() and rejects the Unix epoch because
// strtotime("1970-01-01...") is 0, which its legacy truthiness check treats as
// a failure. January 2 still includes all realistic EDLS history.
const INITIAL_START_DATE = "1970-01-02T00:00:00.000Z";

const progressSchema = z.object({
  startDate: z.string(),
  page: z.number().int().nonnegative(),
  sweepStartedAt: z.string().nullable(),
});
export const migrateStateSchema = z.object({
  statuses: z.record(z.enum(FREEMAN_MIGRATE_STATUSES), progressSchema),
}).strict();
export type FreemanMigrateState = z.infer<typeof migrateStateSchema>;

const runSchema = z.object({ limit: z.number().int().min(1).max(100).default(100) }).strict();
export type FreemanMigrateRun = z.infer<typeof runSchema>;

type FreemanMigrateStage =
  | "fetch"
  | "response"
  | "source"
  | "relation_resolution"
  | "validation"
  | "canonical_save"
  | "processing";
type FreemanSheetOutcome =
  | "would_create"
  | "would_update"
  | "created"
  | "updated"
  | "failed";

interface FreemanMigrateError {
  stage: FreemanMigrateStage;
  code: string;
  message: string;
  details?: string;
}

interface FreemanMigrateSheetResult {
  nid?: string;
  sheetId?: string;
  title: string;
  sourceStatus: FreemanMigrateStatus;
  outcome: FreemanSheetOutcome;
  stage?: FreemanMigrateStage;
  message?: string;
  details?: string;
}

export interface FreemanMigrateReport {
  mode: "test" | "live";
  limit: number;
  statuses: Array<{
    status: FreemanMigrateStatus; label: string;
    fetched: number; valid: number; created: number; updated: number; failed: number;
    page: number; nextPage: number; complete: boolean;
    request: {
      status: FreemanMigrateStatus;
      page: number;
      limit: number;
      startDate: string;
      sweepStartedAt: string | null;
    };
    fetch: {
      outcome: "success" | "failed";
      source?: "cache" | "network" | "none";
      responseShape?: "success.data.success.data.sheets";
    };
    error?: FreemanMigrateError;
    sheets: FreemanMigrateSheetResult[];
  }>;
  startedAt: string;
  durationMs: number;
}

class FreemanMigrateReportedError extends Error {
  constructor(
    readonly report: FreemanMigrateError,
    options?: ErrorOptions,
  ) {
    super(report.message, options);
    this.name = "FreemanMigrateReportedError";
  }
}

function reportedError(
  stage: FreemanMigrateStage,
  code: string,
  message: string,
  details?: string,
  cause?: unknown,
): FreemanMigrateReportedError {
  return new FreemanMigrateReportedError(
    { stage, code, message, ...(details ? { details } : {}) },
    cause === undefined ? undefined : { cause },
  );
}

function sourceIdentity(source: unknown): { nid?: string; title: string } {
  const sheet = record(source);
  return {
    nid: sourceNid(pick(sheet, "nid", "node_id", "nodeId", "id")) ?? undefined,
    title: text(pick(sheet, "title", "name", "job_number", "jobNumber")) ?? "Untitled sheet",
  };
}

function sheetFailure(error: unknown): FreemanMigrateError {
  if (error instanceof FreemanMigrateReportedError) return error.report;
  if (error instanceof z.ZodError) {
    return {
      stage: "validation",
      code: "validation_failed",
      message: "The sheet did not pass EDLS validation.",
      details: error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }
  const message = error instanceof Error ? error.message : "";
  const relationPrefixes = [
    "Ambiguous facility value",
    "Ambiguous lookup value",
    "No department could be resolved",
    "The Freeman employee ID type is not configured",
    "Freeman worker ID and employee ID resolve to different workers",
    "More than one migrated worker has the same Freeman source identity",
    "No employment status is configured",
    "More than one Freeman crew lead has the same source ID",
    "Staging target mapping points to a missing canonical sheet",
  ];
  if (relationPrefixes.some((prefix) => message.startsWith(prefix))) {
    return {
      stage: "relation_resolution",
      code: "relation_resolution_failed",
      message,
    };
  }
  const validationMessages = new Set([
    "The same worker is assigned more than once on this date.",
    "A worker already has an assignment on this date.",
  ]);
  if (validationMessages.has(message)) {
    return { stage: "validation", code: "validation_failed", message };
  }
  return {
    stage: "processing",
    code: "unexpected_sheet_error",
    message: "The sheet could not be processed because of an unexpected local error.",
  };
}

function statusFailure(error: unknown): FreemanMigrateError {
  if (error instanceof FreemanMigrateReportedError) return error.report;
  return {
    stage: "processing",
    code: "unexpected_status_error",
    message: "This status could not be processed because of an unexpected local error.",
  };
}

function initialState(): FreemanMigrateState {
  return { statuses: Object.fromEntries(FREEMAN_MIGRATE_STATUSES.map((status) => [
    status, { startDate: INITIAL_START_DATE, page: 0, sweepStartedAt: null },
  ])) as FreemanMigrateState["statuses"] };
}

function normalize(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}
function sourceNid(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function parseDate(value: unknown): string {
  const source = text(value);
  if (!source) return EPOCH.slice(0, 10);
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? (source.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? EPOCH.slice(0, 10)) : date.toISOString().slice(0, 10);
}
function parseTime(value: unknown): string {
  const source = text(value);
  if (!source) return "00:00:00";
  const match = source.match(/(?:T|\s)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return "00:00:00";
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}
function numberValue(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

const fetchedPageSuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    success: z.literal(true),
    data: z.object({
      // Identity and field validation are deliberately per-sheet. One malformed
      // row must not suppress the report for every other row on the page.
      sheets: z.array(z.record(z.unknown())),
      paging: z.unknown().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const fetchedPageFailureSchema = z.object({
  success: z.literal(true),
  data: z.object({
    success: z.literal(false),
    msg: z.string().optional(),
  }).passthrough(),
}).passthrough();

function remoteRefusalReason(message: string | undefined): string | undefined {
  const normalized = normalize(message);
  if (!normalized) return undefined;
  if (normalized.includes("start date") && normalized.includes("strtotime")) {
    return "Freeman rejected the requested start date as invalid.";
  }
  if (normalized.includes("token") || normalized.includes("credential")) {
    return "Freeman rejected the configured connection credentials.";
  }
  if (normalized.includes("status")) {
    return "Freeman rejected the requested sheet status.";
  }
  return undefined;
}

function structuralShape(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Array.isArray(value) ? "array" : typeof value;
  }
  const root = value as Record<string, unknown>;
  const rootKeys = Object.keys(root).sort().slice(0, 12);
  const data = record(root.data);
  const dataKeys = Object.keys(data).sort().slice(0, 12);
  return [
    `root keys: ${rootKeys.join(", ") || "(none)"}`,
    `data keys: ${dataKeys.join(", ") || "(none)"}`,
  ].join("; ");
}

function unwrapSheets(value: unknown): {
  sheets: Array<Record<string, unknown>>;
  responseShape: "success.data.success.data.sheets";
} {
  const remoteFailure = fetchedPageFailureSchema.safeParse(value);
  if (remoteFailure.success) {
    throw reportedError(
      "fetch",
      "remote_failure",
      "Freeman rejected the sheet-page request.",
      remoteRefusalReason(remoteFailure.data.data.msg),
    );
  }
  const parsed = fetchedPageSuccessSchema.safeParse(value);
  if (!parsed.success) {
    const issuePaths = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw reportedError(
      "response",
      "malformed_response",
      "Freeman returned JSON, but it did not match the sheet-page response contract.",
      `${issuePaths}. ${structuralShape(value)}`,
    );
  }
  return {
    sheets: parsed.data.data.data.sheets,
    responseShape: "success.data.success.data.sheets",
  };
}

async function readState(): Promise<FreemanMigrateState> {
  const variable = await storage.variables.getByName(FREEMAN_MIGRATE_STATUS_VARIABLE);
  if (!variable?.value) return initialState();
  try {
    const parsed = typeof variable.value === "string" ? JSON.parse(variable.value) : variable.value;
    const result = migrateStateSchema.safeParse(parsed);
    if (!result.success) return initialState();
    return {
      statuses: Object.fromEntries(
        FREEMAN_MIGRATE_STATUSES.map((status) => {
          const cursor = result.data.statuses[status] ?? {
            startDate: INITIAL_START_DATE,
            page: 0,
            sweepStartedAt: null,
          };
          return [
            status,
            cursor.startDate === EPOCH
              ? { ...cursor, startDate: INITIAL_START_DATE }
              : cursor,
          ];
        }),
      ) as FreemanMigrateState["statuses"],
    };
  } catch { return initialState(); }
}
async function writeState(state: FreemanMigrateState): Promise<void> {
  const value = JSON.stringify(state);
  const existing = await storage.variables.getByName(FREEMAN_MIGRATE_STATUS_VARIABLE);
  if (existing) await storage.variables.update(existing.id, { value });
  else await storage.variables.create({ name: FREEMAN_MIGRATE_STATUS_VARIABLE, value });
}

async function resolveNamed(
  table: any,
  name: string | null,
  create: boolean,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  if (!name) return null;
  const client = getClient();
  const rows = await client.select().from(table).orderBy(asc((table as any).name));
  const matches = rows.filter((row: any) =>
    normalize(row.name) === normalize(name) &&
    Object.entries(extra).every(([key, value]) =>
      value === undefined || value === null || String(row[key] ?? "") === String(value),
    ),
  );
  if (matches.length > 1) throw new Error(`Ambiguous lookup value "${name}".`);
  if (matches.length === 1) return matches[0].id;
  if (!create) return `planned:${normalize(name)}`;
  const [created] = await client.insert(table).values({ name, ...extra } as any).returning({ id: (table as any).id });
  return created?.id ?? null;
}

async function resolveOptionalExistingNamed(
  table: any,
  name: string | null,
  label: string,
): Promise<string | null> {
  if (!name) return null;
  const rows = await getClient().select().from(table).orderBy(asc((table as any).name));
  const matches = rows.filter((row: any) => normalize(row.name) === normalize(name));
  if (matches.length > 1) throw new Error(`Ambiguous ${label} value "${name}".`);
  return matches[0]?.id ?? null;
}

async function resolveSupervisor(name: string | null, live: boolean): Promise<string | null> {
  if (!name) return null;
  const client = getClient();
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? name;
  const lastName = parts.slice(1).join(" ") || null;
  const rows = await client.select().from(users);
  const matches = rows.filter((u) => normalize(`${u.firstName ?? ""} ${u.lastName ?? ""}`) === normalize(name));
  if (matches.length > 1) {
    throw reportedError(
      "relation_resolution",
      "ambiguous_supervisor",
      "More than one existing user matches this sheet's supervisor name.",
    );
  }
  if (matches.length === 1) return matches[0].id;
  if (!live) return `planned:${normalize(name)}`;
  const normalizedName = normalize(name);
  const key = normalizedName.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  const digest = createHash("sha256").update(normalizedName).digest("hex").slice(0, 16);
  const email = `freeman-migration-${key.slice(0, 40)}-${digest}@invalid.example`;
  const [created] = await client.insert(users).values({
    email, firstName, lastName, accountStatus: "pending", isActive: false,
    data: {
      freemanMigration: {
        placeholder: true,
        sourceDisplayName: name,
      },
    },
  }).onConflictDoNothing().returning({ id: users.id });
  if (created) return created.id;
  const [existing] = await client.select({ id: users.id }).from(users).where(eq(users.email, email));
  return existing?.id ?? null;
}

function parseWorkerName(source: Record<string, unknown>): { displayName: string; given: string | null; family: string | null } {
  const given = text(pick(source, "given", "first_name", "firstName"));
  const family = text(pick(source, "family", "last_name", "lastName"));
  const raw = text(pick(source, "worker_name", "display_name", "displayName", "name")) ?? "Freeman migration worker";
  if (!given && !family && raw.includes(",")) {
    const [familyPart, givenPart] = raw.split(",", 2);
    return { displayName: raw, given: text(givenPart), family: text(familyPart) };
  }
  return { displayName: raw, given, family };
}

async function resolveWorker(
  source: Record<string, unknown>,
  live: boolean,
  employerId: string,
  ymd: string,
  fallbackKey: string,
): Promise<string | null> {
  const sourceId = text(pick(source, "worker_id", "workerId", "sirius_id", "siriusId", "id"));
  const employeeId = text(pick(source, "worker_empid", "employee_id", "employeeId"));
  const client = getClient();
  const einTypeId = employeeId
    ? await storage.workerIds.getTypeIdBySiriusId("freeman_ein")
    : null;
  if (employeeId && !einTypeId) {
    throw new Error("The Freeman employee ID type is not configured.");
  }
  const existingEin = employeeId && einTypeId
    ? await storage.workerIds.getWorkerIdByTypeAndValue(einTypeId, employeeId)
    : undefined;
  if (sourceId && /^\d+$/.test(sourceId)) {
    const [found] = await client.select({ id: workers.id }).from(workers).where(eq(workers.siriusId, Number(sourceId)));
    if (found) {
      if (existingEin && existingEin.workerId !== found.id) {
        throw new Error("Freeman worker ID and employee ID resolve to different workers.");
      }
      if (live && employeeId && einTypeId && !existingEin) {
        await storage.workerIds.createWorkerId({ workerId: found.id, typeId: einTypeId, value: employeeId });
      }
      if (live) await ensureWorkerEmployment(found.id, employerId, ymd);
      return found.id;
    }
  }
  if (existingEin) {
    if (live) await ensureWorkerEmployment(existingEin.workerId, employerId, ymd);
    return existingEin.workerId;
  }
  const parsedName = parseWorkerName(source);
  const sourceKey = sourceId
    ? `worker-id:${sourceId}`
    : employeeId
      ? `employee-id:${employeeId}`
      : `assignment:${fallbackKey}`;
  const existingPlaceholders = await client.select({ id: workers.id }).from(workers)
    .where(sql`${workers.data}->'freemanMigration'->>'sourceKey' = ${sourceKey}`);
  if (existingPlaceholders.length > 1) {
    throw new Error("More than one migrated worker has the same Freeman source identity.");
  }
  if (existingPlaceholders[0]) {
    if (live) await ensureWorkerEmployment(existingPlaceholders[0].id, employerId, ymd);
    return existingPlaceholders[0].id;
  }
  if (!live) return `planned-worker:${sourceKey}`;
  const { displayName, family, given } = parsedName;
  const worker = await storage.workers.createWorkerWithNameParts({ given, family, displayName });
  if (employeeId && einTypeId) {
    await storage.workerIds.createWorkerId({ workerId: worker.id, typeId: einTypeId, value: employeeId });
  }
  const employmentStatusId = await ensureWorkerEmployment(worker.id, employerId, ymd);
  const [updated] = await client.update(workers).set({
    data: {
      freemanMigration: {
        sourceKey,
        sourceId,
        employeeId,
        employerId,
        source,
        employmentStatusId,
      },
    },
  }).where(eq(workers.id, worker.id)).returning({ id: workers.id });
  return updated?.id ?? worker.id;
}

async function ensureWorkerEmployment(
  workerId: string,
  employerId: string,
  ymd: string,
): Promise<string> {
  const client = getClient();
  await storage.workerEdls.ensure(workerId);
  const statuses = await getClient().select().from(optionsEmploymentStatus);
  const employmentStatus = statuses.find((status) => status.employed) ?? statuses[0];
  if (!employmentStatus) throw new Error("No employment status is configured for worker association.");
  const date = new Date(`${ymd}T00:00:00Z`);
  await client.insert(workerHours).values({
    workerId,
    employerId,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: 1,
    employmentStatusId: employmentStatus.id,
    hours: null,
    home: false,
  }).onConflictDoNothing({
    target: [
      workerHours.workerId,
      workerHours.employerId,
      workerHours.year,
      workerHours.month,
      workerHours.day,
    ],
  });
  await recomputeDenormEntity("worker_employment", workerId);
  return employmentStatus.id;
}

function sourceCrew(sheet: Record<string, unknown>): unknown[] {
  return list(pick(sheet, "crews", "crew", "groups", "crew_groups"));
}
function sourceAssignments(crew: Record<string, unknown>): unknown[] {
  return list(pick(crew, "assignments", "workers", "crew_workers", "crewWorkers"));
}

async function resolveCrewlead(
  siriusId: string | null,
  live: boolean,
): Promise<string | null> {
  if (!siriusId) return null;
  const matches = (await storage.freemanCrewleads.getAll())
    .filter((crewlead) => crewlead.siriusId === siriusId);
  if (matches.length > 1) throw new Error("More than one Freeman crew lead has the same source ID.");
  if (matches[0]) return matches[0].id;
  if (!live) return `planned-crewlead:${siriusId}`;
  const created = await storage.freemanCrewleads.create({
    siriusId,
    name: `Freeman crew lead ${siriusId}`,
    data: { freemanMigration: { placeholder: true, sourceSiriusId: siriusId } },
  });
  return created.id;
}

async function reconcileSheet(
  source: unknown,
  status: FreemanMigrateStatus,
  live: boolean,
  employerId: string,
): Promise<{ kind: "created" | "updated"; sheetId?: string }> {
  const sheet = record(source);
  const nid = sourceNid(pick(sheet, "nid", "node_id", "nodeId", "id"));
  if (!nid) {
    throw reportedError(
      "source",
      "invalid_nid",
      "Freeman returned a sheet without a valid source nid.",
    );
  }
  const client = getClient();
  if (live) {
    await client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"freeman-edls:" + nid}, 0))`);
  }
  const title = text(pick(sheet, "title", "name", "job_number", "jobNumber")) ?? `Freeman ${nid}`;
  const ymd = parseDate(pick(sheet, "ymd", "date", "start_date", "startDate"));
  const departmentName = text(pick(sheet, "dept", "department", "department_name", "departmentName"));
  const departmentId = await resolveNamed(optionsDepartment, departmentName, live) ?? (await resolveNamed(optionsDepartment, "Freeman Migration", live));
  if (!departmentId) throw new Error("No department could be resolved.");
  const supervisor = await resolveSupervisor(text(pick(sheet, "supervisor", "supervisor_name", "supervisorName")), live);
  const showStatusId = await resolveNamed(optionsEdlsShowStatus, text(pick(sheet, "event_status", "show_status", "showStatus", "show_status_name")), live);
  const facilityId = await resolveOptionalExistingNamed(
    facilities,
    text(pick(sheet, "facility", "facility_name", "facilityName")),
    "facility",
  );
  const jobGroupId = await resolveNamed(dispatchJobGroups, text(pick(sheet, "event", "job_group", "jobGroup", "job_group_name")), live, {
    startYmd: ymd, endYmd: ymd,
  });
  const crews = sourceCrew(sheet);
  const crewPlans: Array<{
    input: CrewInput;
    assignments: Array<{ workerId: string; data: Record<string, unknown> }>;
  }> = [];
  for (let index = 0; index < crews.length; index++) {
    const crew = record(crews[index]);
    const assignments = sourceAssignments(crew);
    const crewIdentity = text(pick(crew, "uuid", "id")) ?? String(index);
    const freemanCrewLeadId = await resolveCrewlead(
      text(pick(crew, "crewlead", "crew_lead", "crewLead")),
      live,
    );
    const workersResolved: Array<{ workerId: string; data: Record<string, unknown> }> = [];
    for (let assignmentIndex = 0; assignmentIndex < assignments.length; assignmentIndex++) {
      const assignment = assignments[assignmentIndex];
      const assignmentRecord = record(assignment);
      const workerId = await resolveWorker(
        assignmentRecord,
        live,
        employerId,
        ymd,
        `${nid}:${crewIdentity}:${assignmentIndex}`,
      );
      const extra = record(assignmentRecord.assignment_extra);
      const classificationId = await resolveNamed(
        optionsClassifications,
        text(pick(extra, "classification")),
        live,
      );
      if (workerId) {
        workersResolved.push({
          workerId,
          data: {
            startTime: text(pick(extra, "time")),
            note: text(pick(extra, "note")),
            classificationId,
            freemanMigration: { source: assignmentRecord },
          },
        });
      }
    }
    const count = numberValue(pick(crew, "worker_count", "workerCount", "count"), workersResolved.length);
    const taskId = await resolveNamed(optionsEdlsTasks, text(pick(crew, "task", "task_name", "taskName")), live, { departmentId });
    crewPlans.push({
      input: {
        title: text(pick(crew, "title", "name")) ?? `Freeman crew ${index + 1}`,
        workerCount: Math.max(count, workersResolved.length),
        location: text(pick(crew, "checkin_location", "location", "venue")),
        startTime: parseTime(pick(crew, "start_time", "startTime", "start")),
        endTime: parseTime(pick(crew, "end_time", "endTime", "end")),
        supervisor: await resolveSupervisor(text(pick(crew, "supervisor", "supervisor_name", "supervisorName")), live) ?? supervisor,
        taskId,
        data: {
          freemanCrewLeadId,
          freemanMigration: { source: crew },
        },
      },
      assignments: workersResolved,
    });
  }
  const crewInputs = crewPlans.map((plan) => plan.input);
  const finalWorkerCount = crewInputs.reduce(
    (sum, crew) => sum + Number(crew.workerCount ?? 0),
    0,
  );
  const staged = await storage.freemanEdlsMigrateStaging.getByNid(nid);
  const mappedTarget = text(record(staged?.data).targetSheetId);
  const [mapped] = mappedTarget
    ? await client.select().from(edlsSheets).where(eq(edlsSheets.id, mappedTarget))
    : [];
  if (mappedTarget && !mapped) throw new Error("Staging target mapping points to a missing canonical sheet.");
  const [existingByNid] = await client.select().from(edlsSheets)
    .where(sql`${edlsSheets.data}->'freemanMigration'->>'nid' = ${nid}`);
  const existing = mapped ?? existingByNid;
  if (!live) {
    await validateEdlsSheet.validateOrThrow({
      workerCount: finalWorkerCount,
      _crews: crewInputs,
    });
    const seenAssignments = new Set<string>();
    for (const plan of crewPlans) {
      for (const assignment of plan.assignments) {
        const key = `${ymd}:${assignment.workerId}`;
        if (seenAssignments.has(key)) {
          throw new Error("The same worker is assigned more than once on this date.");
        }
        seenAssignments.add(key);
        if (assignment.workerId.startsWith("planned-worker:")) continue;
        const conflicts = await client.select({
          sheetId: edlsCrews.sheetId,
        }).from(edlsAssignments)
          .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
          .where(and(
            eq(edlsAssignments.ymd, ymd),
            eq(edlsAssignments.workerId, assignment.workerId),
          ));
        if (conflicts.some((conflict) => conflict.sheetId !== existing?.id)) {
          throw new Error("A worker already has an assignment on this date.");
        }
      }
    }
    return { kind: existing ? "updated" : "created" };
  }
  const data = {
    freemanMigration: {
      nid,
      status,
      source: sheet,
      sourceWorkerCount: numberValue(pick(sheet, "worker_count", "workerCount", "count")),
    },
  };
  let result: Awaited<ReturnType<typeof storage.edlsSheets.replaceFromImport>>;
  try {
    result = await storage.edlsSheets.replaceFromImport(existing?.id, {
      employerId, departmentId, title, ymd, status, supervisor, assignee: supervisor,
      jobGroupId, facilityId, showStatusId, workerCount: finalWorkerCount,
      notes: text(pick(sheet, "notes")), data,
      notificationsEnabled: false,
    }, crewPlans.map((plan) => ({
      crew: plan.input,
      assignments: plan.assignments.map((assignment) => ({
        ymd,
        workerId: assignment.workerId,
        data: assignment.data,
      })),
    })));
  } catch (error) {
    throw reportedError(
      "canonical_save",
      "canonical_save_failed",
      "The canonical EDLS sheet and its roster could not be saved.",
      undefined,
      error,
    );
  }
  const targetId = result.sheet.id;
  await storage.freemanEdlsMigrateStaging.setTargetSheetId(nid, targetId, sheet);
  return { kind: result.kind, sheetId: targetId };
}

const STATUS_LABELS: Record<FreemanMigrateStatus, string> = {
  draft: "Draft", request: "Requested", lock: "Scheduled", trash: "Discarded", reserved: "Reserved",
};
async function runStatus(status: FreemanMigrateStatus, cursor: z.infer<typeof progressSchema>, limit: number, mode: "test" | "live", employerId: string) {
  const result = await wcRequest({
    vendor: { pluginId: FREEMAN_EDLS_MIGRATE_PLUGIN_ID },
    operation: FREEMAN_EDLS_FETCH_SHEETS_OPERATION,
    args: { start_date: cursor.startDate, page: cursor.page, limit, status },
    mode: "force",
  });
  if (result.outcome !== "success" || !result.value) {
    throw reportedError(
      "fetch",
      "request_failed",
      "The request to Freeman could not be completed.",
    );
  }
  if (!result.value.success) {
    const outcomeMessages: Record<string, string> = {
      network_error: "The Freeman service did not answer the request.",
      http_error: "The Freeman service returned an HTTP error.",
      remote_failure: "Freeman reported that the request failed.",
      unrecognized_response: "Freeman returned an unrecognized response.",
    };
    const responseStatus = result.value.response?.status;
    throw reportedError(
      "fetch",
      result.value.outcome,
      outcomeMessages[result.value.outcome] ??
        "Freeman answered, but did not return a successful sheet page.",
      responseStatus ? `HTTP status ${responseStatus}.` : undefined,
    );
  }
  const unwrapped = unwrapSheets(result.value.data);
  const sheets = unwrapped.sheets;
  let created = 0; let updated = 0;
  const sheetResults: FreemanMigrateSheetResult[] = [];
  for (const sheet of sheets) {
    const identity = sourceIdentity(sheet);
    try {
      const reconciled = mode === "live"
        ? await runInTransaction(() => reconcileSheet(sheet, status, true, employerId))
        : await reconcileSheet(sheet, status, false, employerId);
      if (reconciled.kind === "created") created++;
      else if (reconciled.kind === "updated") updated++;
      sheetResults.push({
        ...identity,
        ...(reconciled.sheetId ? { sheetId: reconciled.sheetId } : {}),
        sourceStatus: status,
        outcome: mode === "test"
          ? reconciled.kind === "created" ? "would_create" : "would_update"
          : reconciled.kind,
      });
    } catch (error) {
      const failure = sheetFailure(error);
      logger.error("Freeman EDLS sheet import failed", {
        service: "freeman-edls-migrate",
        status,
        nid: identity.nid,
        stage: failure.stage,
        code: failure.code,
        error: error instanceof Error ? error.message : String(error),
      });
      sheetResults.push({
        ...identity,
        sourceStatus: status,
        outcome: "failed",
        stage: failure.stage,
        message: failure.message,
        details: failure.details,
      });
    }
  }
  const failed = sheetResults.filter((sheet) => sheet.outcome === "failed").length;
  return {
    fetched: sheets.length,
    valid: sheets.length - failed,
    created,
    updated,
    failed,
    complete: sheets.length < limit && failed === 0,
    fetch: {
      outcome: "success" as const,
      source: result.source,
      responseShape: unwrapped.responseShape,
    },
    sheets: sheetResults,
  };
}

export async function getFreemanMigrateStatus() {
  return {
    variableName: FREEMAN_MIGRATE_STATUS_VARIABLE,
    statuses: (await readState()).statuses,
    warning: "Legacy paging uses mutable offsets; records can move during a sweep. Use Start Over for an idempotent replay.",
  };
}
export async function resetFreemanMigrateStatus() {
  return withFreemanMigrateLock(async () => {
    const state = initialState();
    await writeState(state);
    return {
      variableName: FREEMAN_MIGRATE_STATUS_VARIABLE,
      statuses: state.statuses,
      warning: "Legacy paging uses mutable offsets; records can move during a sweep. Use Start Over for an idempotent replay.",
    };
  });
}
async function runFreemanMigrateUnlocked(
  mode: "test" | "live",
  raw: unknown,
): Promise<FreemanMigrateReport> {
  const { limit } = runSchema.parse(raw ?? {});
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const state = await readState();
  const next = structuredClone(state);
  const statuses: FreemanMigrateReport["statuses"] = [];
  let employerId: string | null = null;
  let setupError: FreemanMigrateError | undefined;
  try {
    const settings = await getEdlsSettings();
    if (!settings.employer) {
      setupError = {
        stage: "relation_resolution",
        code: "missing_edls_employer",
        message: "No employer is configured in EDLS settings.",
      };
    } else {
      const employer = await storage.employers.getEmployer(settings.employer);
      if (employer) employerId = employer.id;
      else {
        setupError = {
          stage: "relation_resolution",
          code: "edls_employer_not_found",
          message: "The employer configured in EDLS settings was not found.",
        };
      }
    }
  } catch (error) {
    logger.error("Freeman EDLS migration setup failed", {
      service: "freeman-edls-migrate",
      error: error instanceof Error ? error.message : String(error),
    });
    setupError = {
      stage: "relation_resolution",
      code: "setup_failed",
      message: "The local EDLS migration setup could not be read.",
    };
  }
  for (const status of FREEMAN_MIGRATE_STATUSES) {
    const cursor = state.statuses[status] ?? { startDate: INITIAL_START_DATE, page: 0, sweepStartedAt: null };
    const request = {
      status,
      page: cursor.page,
      limit,
      startDate: cursor.startDate,
      sweepStartedAt: cursor.sweepStartedAt,
    };
    if (setupError || !employerId) {
      statuses.push({
        status,
        label: STATUS_LABELS[status],
        fetched: 0,
        valid: 0,
        created: 0,
        updated: 0,
        failed: 0,
        page: cursor.page,
        nextPage: cursor.page,
        complete: false,
        request,
        fetch: { outcome: "failed" },
        error: setupError ?? {
          stage: "relation_resolution",
          code: "setup_failed",
          message: "The local EDLS migration setup is incomplete.",
        },
        sheets: [],
      });
      continue;
    }
    try {
      // Capture page-zero's watermark before fetching it. Once the sweep ends,
      // the next one starts here, so changes committed during this fetch cannot
      // fall into the gap between query time and watermark time.
      const sweepStartedAt = cursor.sweepStartedAt ?? new Date().toISOString();
      const activeCursor = { ...cursor, sweepStartedAt };
      const report = await runStatus(status, activeCursor, limit, mode, employerId);
      const complete = report.complete;
      next.statuses[status] = report.failed > 0
        ? cursor
        : complete
          ? { startDate: sweepStartedAt, page: 0, sweepStartedAt: null }
          : { startDate: cursor.startDate, page: cursor.page + 1, sweepStartedAt };
      statuses.push({
        status, label: STATUS_LABELS[status], ...report,
        page: cursor.page, nextPage: next.statuses[status].page,
        request: { ...request, sweepStartedAt },
      });
    } catch (error) {
      const failure = statusFailure(error);
      logger.error("Freeman EDLS status import failed", {
        service: "freeman-edls-migrate",
        status,
        stage: failure.stage,
        code: failure.code,
        error: error instanceof Error ? error.message : String(error),
      });
      statuses.push({
        status, label: STATUS_LABELS[status],
        fetched: 0, valid: 0, created: 0, updated: 0, failed: 0,
        page: cursor.page, nextPage: cursor.page, complete: false,
        request,
        fetch: {
          outcome: "failed",
          ...(error instanceof FreemanMigrateReportedError && error.report.stage === "response"
            ? { source: "network" as const }
            : {}),
        },
        error: failure,
        sheets: [],
      });
    }
  }
  if (mode === "live") await writeState(next);
  return { mode, limit, statuses, startedAt, durationMs: Date.now() - started };
}

export async function runFreemanMigrate(
  mode: "test" | "live",
  raw: unknown,
): Promise<FreemanMigrateReport> {
  if (mode === "test") return runFreemanMigrateUnlocked(mode, raw);
  return withFreemanMigrateLock(() => runFreemanMigrateUnlocked(mode, raw));
}

export async function withFreemanMigrateLock<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await storage.advisoryLock.tryAcquireSession(
    "freeman-edls-migrate-run",
    { timeoutMs: 0 },
  );
  if (!lock) throw new Error("A Freeman migration run is already in progress.");
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}