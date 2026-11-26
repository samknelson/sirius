import { createHash, randomUUID } from "crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { storage } from "../../../../../../../server/storage";
import { getClient, runInSavepoint, runInTransaction, runOutsideTransaction } from "../../../../../../../server/storage/transaction-context";
import {
  validate as validateEdlsSheet,
  type CrewInput,
} from "../../../../../../edls/server/storage/edls/sheets";
import { wcRequest } from "../../../../../../../server/services/webclient";
import { logger } from "../../../../../../../server/logger";
import { getRequestContext, requestContext } from "../../../../../../../server/middleware/request-context";
import { isMaintenanceActive } from "../../../../../../../server/services/maintenance-flag";
import { isComponentEnabled } from "../../../../../../../server/modules/components";
import { getEdlsSettings } from "../../../../../../edls/server/modules/edls/supervisor-context";
import { recomputeDenormEntity } from "../../../../../../../server/plugins/system/denorm/registry";
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
  optionsWorkerMs,
  facilities,
  users,
  workerIds,
  workerHours,
  workers,
} from "@shared/schema";
import {
  FREEMAN_EDLS_FETCH_SHEETS_OPERATION,
  FREEMAN_EDLS_MIGRATE_PLUGIN_ID,
  FREEMAN_EDLS_MIGRATE_COMPONENT_ID,
} from "../../../../plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate";
import { importedJobNumber } from "./job-number";

export const FREEMAN_MIGRATE_STATUSES = ["draft", "request", "lock", "reserved"] as const;
export type FreemanMigrateStatus = (typeof FREEMAN_MIGRATE_STATUSES)[number];
const LEGACY_FREEMAN_MIGRATE_STATUSES = [...FREEMAN_MIGRATE_STATUSES, "trash"] as const;
export const FREEMAN_MIGRATE_STATUS_VARIABLE = "SITESPECIFIC_FREEMAN_MIGRATE_STATUS";

export const FREEMAN_MIGRATE_RUN_VARIABLE = "SITESPECIFIC_FREEMAN_MIGRATE_RUN";
const FREEMAN_MIGRATE_PROGRESS_VARIABLE = "SITESPECIFIC_FREEMAN_MIGRATE_PROGRESS";
const EPOCH = "1970-01-01T00:00:00.000Z";
// Freeman runs this through PHP strtotime() and rejects the Unix epoch because
// strtotime("1970-01-01...") is 0, which its legacy truthiness check treats as
// a failure. January 2 still includes all realistic EDLS history.
const INITIAL_START_DATE = "1970-01-02T00:00:00.000Z";
const INITIAL_START_YMD = INITIAL_START_DATE.slice(0, 10);

const resetMigrateStateSchema = z.object({
  startDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date in YYYY-MM-DD format.")
    .refine(
      (value) => {
        if (value < INITIAL_START_YMD) return false;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime())
          && parsed.toISOString().slice(0, 10) === value;
      },
      `Choose a real calendar date on or after ${INITIAL_START_YMD}.`,
    ),
}).strict();

const progressSchema = z.object({
  startDate: z.string(),
  page: z.number().int().nonnegative(),
  sweepStartedAt: z.string().nullable(),
});
export const migrateStateSchema = z.object({
  statuses: z.record(z.enum(FREEMAN_MIGRATE_STATUSES), progressSchema),
}).strict();
const legacyMigrateStateSchema = z.object({
  statuses: z.record(z.enum(LEGACY_FREEMAN_MIGRATE_STATUSES), progressSchema),
}).strict();
export type FreemanMigrateState = z.infer<typeof migrateStateSchema>;

const runSchema = z.object({ limit: z.number().int().min(1).max(100).default(100) }).strict();
export type FreemanMigrateRun = z.infer<typeof runSchema>;
const supervisorEmailSchema = z.string().email();

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
  | "unchanged"
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
  records?: FreemanMigrateRecordCounts;
  stage?: FreemanMigrateStage;
  code?: string;
  message?: string;
  details?: string;
  omittedAssignments?: FreemanAssignmentOmission[];
}

interface FreemanAssignmentOmission {
  crewIndex: number;
  assignmentIndex: number;
  stage: FreemanMigrateStage;
  code: string;
  message: string;
  details?: string;
}

interface FreemanMigrateRecordCounts {
  crews: { created: number; updated: number };
  assignments: { created: number; updated: number };
  workers: { created: number; updated: number };
}

export interface FreemanMigrateReport {
  correlationId?: string;
  mode: "test" | "live";
  limit: number;
  stoppedEarly: boolean;
  statuses: Array<{
    status: FreemanMigrateStatus; label: string;
    fetched: number; valid: number; created: number; updated: number; unchanged: number; failed: number;
    records: FreemanMigrateRecordCounts;
    page: number; nextPage: number; complete: boolean;
    stoppedEarly?: boolean;
    interrupted?: boolean;
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

const lifecycleSchema = z.enum(["idle", "starting", "running", "stopping", "stopped", "completed", "failed"]);

interface SheetProgress {
  status: FreemanMigrateStatus;
  page: number;
  phase: "fetching" | "processing" | "finished";
  sheet?: { nid?: string; title: string };
  pageSize?: number;
  result?: FreemanMigrateSheetResult;
}
type ProgressCallback = (progress: SheetProgress) => Promise<void>;
type ImportWrite = <T>(fn: () => Promise<T>) => Promise<T>;

class FreemanRunOwnershipError extends Error {}

function emptyRecordCounts(): FreemanMigrateRecordCounts {
  return {
    crews: { created: 0, updated: 0 },
    assignments: { created: 0, updated: 0 },
    workers: { created: 0, updated: 0 },
  };
}

function addRecordCounts(
  target: FreemanMigrateRecordCounts,
  source: FreemanMigrateRecordCounts,
): void {
  for (const kind of ["crews", "assignments"] as const) {
    target[kind].created += source[kind].created;
    target[kind].updated += source[kind].updated;
  }
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

interface SafeFailureDiagnostic {
  details: string;
  log: {
    causeKind: "domain_validation" | "database" | "storage";
    causeCode?: string;
    constraint?: string;
    table?: string;
    column?: string;
  };
}

interface CursorReport {
  interrupted: boolean;
  complete: boolean;
}

function safeDatabaseIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[A-Za-z0-9_.-]{1,128}$/.test(value) ? value : undefined;
}

function errorChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (
    current
    && typeof current === "object"
    && !seen.has(current)
    && chain.length < 8
  ) {
    seen.add(current);
    const item = current as Record<string, unknown>;
    chain.push(item);
    current = item.cause;
  }
  return chain;
}

function safeCanonicalSaveDiagnostic(error: unknown): SafeFailureDiagnostic {
  const chain = errorChain(error);
  const domainValidation = chain.find((item) =>
    item.name === "DomainValidationError" && Array.isArray(item.errors)
  );
  if (domainValidation) {
    const issues = (domainValidation.errors as unknown[])
      .flatMap((issue) => {
        if (!issue || typeof issue !== "object") return [];
        const item = issue as Record<string, unknown>;
        const field = safeDatabaseIdentifier(item.field) ?? "record";
        const code = safeDatabaseIdentifier(item.code) ?? "validation_failed";
        const explanations: Record<string, string> = {
          WORKER_COUNT_MISMATCH: "The sheet worker count must equal the sum of its crew worker counts.",
        };
        return [`${field} (${code}): ${explanations[code] ?? "The value was rejected."}`];
      })
      .slice(0, 5);
    return {
      details: issues.length
        ? `Storage validation rejected the sheet: ${issues.join("; ")}`
        : "Storage validation rejected the sheet.",
      log: {
        causeKind: "domain_validation",
        causeCode: safeDatabaseIdentifier(
          (domainValidation.errors as Array<Record<string, unknown>>)[0]?.code,
        ),
      },
    };
  }

  const databaseError = chain.find((item) =>
    typeof item.code === "string" && /^[0-9A-Z]{5}$/.test(item.code)
  );
  if (databaseError) {
    const causeCode = databaseError.code as string;
    const constraint = safeDatabaseIdentifier(databaseError.constraint);
    const table = safeDatabaseIdentifier(databaseError.table);
    const column = safeDatabaseIdentifier(databaseError.column);
    const explanation: Record<string, string> = {
      "22001": "A value is longer than the database field allows.",
      "22P02": "A value has an invalid database format.",
      "23502": "A required database field is missing.",
      "23503": "A referenced record no longer exists.",
      "23505": "A database uniqueness rule was violated.",
      "23514": "A database validation rule was violated.",
    };
    const fields = [
      `database code ${causeCode}`,
      ...(constraint ? [`constraint ${constraint}`] : []),
      ...(table ? [`table ${table}`] : []),
      ...(column ? [`column ${column}`] : []),
    ];
    return {
      details: `${explanation[causeCode] ?? "The database rejected the save."} (${fields.join(", ")}).`,
      log: { causeKind: "database", causeCode, constraint, table, column },
    };
  }

  const knownStorageMessage = chain
    .map((item) => item.message)
    .find((message) =>
      message === "Target sheet disappeared during import."
      || message === "The same worker is assigned more than once on this date."
      || message === "A worker already has an assignment on this date."
    );
  return {
    details: typeof knownStorageMessage === "string"
      ? knownStorageMessage
      : "The storage layer rejected the save without a recognized database code. See the server log entry for this sheet.",
    log: { causeKind: "storage" },
  };
}

function nextCursorAfterReport(
  cursor: z.infer<typeof progressSchema>,
  sweepStartedAt: string,
  report: CursorReport,
): z.infer<typeof progressSchema> {
  if (report.interrupted) return cursor;
  return report.complete
    ? { startDate: sweepStartedAt, page: 0, sweepStartedAt: null }
    : { startDate: cursor.startDate, page: cursor.page + 1, sweepStartedAt };
}

function reportHasFatalFailure(report: Pick<FreemanMigrateReport, "statuses">): boolean {
  return report.statuses.some((status) => Boolean(status.error));
}

function sourceIdentity(source: unknown): { nid?: string; title: string } {
  const sheet = record(source);
  return {
    nid: sourceNid(pick(sheet, "nid", "node_id", "nodeId", "id")) ?? undefined,
    title: importedJobNumber(sheet),
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
    "More than one worker matches the normalized Freeman EIN",
    "More than one worker matches the normalized Teamsters 631 ID",
    "More than one migrated worker has the same Freeman source identity",
    "Freeman EIN conflict",
    "No employment status is configured",
    "More than one Freeman crew lead has the same source ID",
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

function assignmentOmission(
  error: unknown,
  crewIndex: number,
  assignmentIndex: number,
  phase: "preparation" | "save",
): FreemanAssignmentOmission {
  if (phase === "save") {
    const diagnostic = safeCanonicalSaveDiagnostic(error);
    return {
      crewIndex,
      assignmentIndex,
      stage: "canonical_save",
      code: "assignment_save_failed",
      message: "The assignment could not be saved and was omitted.",
      details: diagnostic.details,
    };
  }

  const failure = sheetFailure(error);
  const messages: Partial<Record<FreemanMigrateStage, string>> = {
    relation_resolution: "The assignment's worker or classification could not be resolved.",
    validation: "The assignment did not pass EDLS validation.",
  };
  return {
    crewIndex,
    assignmentIndex,
    stage: failure.stage,
    code: "assignment_preparation_failed",
    message: messages[failure.stage]
      ?? "The assignment could not be prepared and was omitted.",
    ...(failure.stage === "validation" && failure.details
      ? { details: failure.details }
      : {}),
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

function initialState(startDate = INITIAL_START_DATE): FreemanMigrateState {
  return { statuses: Object.fromEntries(FREEMAN_MIGRATE_STATUSES.map((status) => [
    status, { startDate, page: 0, sweepStartedAt: null },
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
    // Older runs persisted a cursor for the retired Trash status. Read that
    // shape long enough to preserve the four active cursors, then normalize
    // the value back to the current state contract below.
    const result = legacyMigrateStateSchema.safeParse(parsed);
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
  const sourceValue = name.trim();
  const parsedEmail = supervisorEmailSchema.safeParse(sourceValue);
  if (parsedEmail.success) {
    const normalizedEmail = parsedEmail.data.toLowerCase();
    if (live) {
      await client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedEmail}, 0))`);
    }
    const existing = await storage.users.getUserByEmail(parsedEmail.data);
    if (existing) return existing.id;
    if (!live) return `planned:${normalizedEmail}`;
    const [created] = await client.insert(users).values({
      email: parsedEmail.data,
      firstName: null,
      lastName: null,
      accountStatus: "pending",
      isActive: false,
    }).onConflictDoNothing().returning({ id: users.id });
    if (created) return created.id;
    const conflicting = await storage.users.getUserByEmail(parsedEmail.data);
    return conflicting?.id ?? null;
  }
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
  const existing = await storage.users.getUserByEmail(email);
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

interface ResolvedWorker {
  id: string;
  kind: "created" | "updated";
}

interface FreemanWorkerIdTypes {
  ein: string;
  t631: string;
}

interface FreemanMigratePlanState {
  workers: Map<string, string>;
  workersByName: Map<string, Set<string>>;
  nextWorkerNumber: number;
  assignmentOwners: Map<string, string>;
  replacedSheetIds: Set<string>;
}

function clonePlanState(state: FreemanMigratePlanState): FreemanMigratePlanState {
  return {
    workers: new Map(state.workers),
    workersByName: new Map(
      [...state.workersByName].map(([key, ids]) => [key, new Set(ids)]),
    ),
    nextWorkerNumber: state.nextWorkerNumber,
    assignmentOwners: new Map(state.assignmentOwners),
    replacedSheetIds: new Set(state.replacedSheetIds),
  };
}

function replacePlanState(
  target: FreemanMigratePlanState,
  source: FreemanMigratePlanState,
): void {
  target.workers = source.workers;
  target.workersByName = source.workersByName;
  target.nextWorkerNumber = source.nextWorkerNumber;
  target.assignmentOwners = source.assignmentOwners;
  target.replacedSheetIds = source.replacedSheetIds;
}

function workerNameKey(given: string, family: string): string {
  return `${given.trim().toLowerCase()}\u0000${family.trim().toLowerCase()}`;
}

async function resolveWorker(
  source: Record<string, unknown>,
  live: boolean,
  employerId: string,
  ymd: string,
  idTypes: FreemanWorkerIdTypes,
  planState?: FreemanMigratePlanState,
): Promise<ResolvedWorker | null> {
  const employeeId = text(pick(source, "worker_empid", "employee_id", "employeeId"));
  const normalizedEin = employeeId?.replace(/\D/g, "") || null;
  if (!normalizedEin) {
    throw new Error("The Freeman assignment has no usable employee EIN.");
  }
  if (live) {
    // Normalized identity cannot be protected by the exact-value unique
    // constraint. Block every worker-ID writer until this sheet transaction
    // finishes so lookup followed by creation is atomic even against writers
    // that do not know about Freeman's digits-only matching rule.
    await getClient().execute(sql`LOCK TABLE ${workerIds} IN SHARE ROW EXCLUSIVE MODE`);
  }
  const t631Id = text(pick(source, "worker_id", "workerId"));
  const normalizedT631 = t631Id?.replace(/\D/g, "") || null;
  const einAlias = `freeman_ein:${normalizedEin}`;
  const assertCanAttachEin = async (workerId: string) => {
    const ids = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
    const plannedOtherEin = !live && [...(planState?.workers.entries() ?? [])]
      .some(([alias, owner]) => owner === workerId && alias.startsWith("freeman_ein:") && alias !== einAlias);
    if (ids.some(id => id.typeId === idTypes.ein) || plannedOtherEin) {
      throw new Error("Freeman EIN conflict: matched worker already has a different EIN; identity left unchanged.");
    }
  };

  const matchByDigits = async (
    typeId: string,
    digits: string | null,
    label: string,
  ): Promise<string | null> => {
    if (!digits) return null;
    const matches = await storage.workerIds.getWorkerIdsByTypeAndDigits(typeId, digits);
    const workerIds = [...new Set(matches.map((match) => match.workerId))];
    if (workerIds.length > 1) {
      throw new Error(`More than one worker matches the normalized ${label} ${digits}.`);
    }
    return workerIds[0] ?? null;
  };

  const existingEinWorkerId = await matchByDigits(
    idTypes.ein,
    normalizedEin,
    "Freeman EIN",
  );
  const plannedEinWorkerId = !live ? planState?.workers.get(einAlias) : undefined;
  const einWorkerId = existingEinWorkerId ?? plannedEinWorkerId;
  if (einWorkerId) {
    if (live) await ensureWorkerEmployment(einWorkerId, employerId, ymd);
    return { id: einWorkerId, kind: "updated" };
  }

  const existingT631WorkerId = await matchByDigits(
    idTypes.t631,
    normalizedT631,
    "Teamsters 631 ID",
  );
  const plannedT631WorkerId = !live && normalizedT631
    ? planState?.workers.get(`t631:${normalizedT631}`)
    : undefined;
  const t631WorkerId = existingT631WorkerId ?? plannedT631WorkerId;
  if (t631WorkerId) {
    await assertCanAttachEin(t631WorkerId);
    if (live) {
      // The normalized EIN lookup above found no owner while the worker-ID
      // table is locked, so the fallback worker can safely acquire it.
      await storage.workerIds.createWorkerId({
        workerId: t631WorkerId,
        typeId: idTypes.ein,
        value: normalizedEin,
      });
    } else {
      planState?.workers.set(einAlias, t631WorkerId);
    }
    if (live) await ensureWorkerEmployment(t631WorkerId, employerId, ymd);
    return { id: t631WorkerId, kind: "updated" };
  }

  const parsedName = parseWorkerName(source);
  const { displayName, family, given } = parsedName;
  if (!given || !family) {
    throw new Error(
      "The Freeman assignment did not match a worker by ID and does not have both a first and last name.",
    );
  }
  const nameKey = workerNameKey(given, family);
  const persistedNameMatches = await storage.workers.getWorkerIdsByExactName(given, family);
  const plannedNameMatches = !live
    ? [...(planState?.workersByName.get(nameKey) ?? [])]
    : [];
  const nameMatches = [...new Set([...persistedNameMatches, ...plannedNameMatches])];
  if (nameMatches.length > 1) {
    throw new Error(
      `More than one worker matches the normalized name ${given.trim()} ${family.trim()}.`,
    );
  }
  const nameWorkerId = nameMatches[0];
  if (nameWorkerId) {
    await assertCanAttachEin(nameWorkerId);
    if (live) {
      await storage.workerIds.createWorkerId({
        workerId: nameWorkerId,
        typeId: idTypes.ein,
        value: normalizedEin,
      });
      await ensureWorkerEmployment(nameWorkerId, employerId, ymd);
    } else {
      planState?.workers.set(einAlias, nameWorkerId);
    }
    return {
      id: nameWorkerId,
      kind: nameWorkerId.startsWith("planned-worker:") ? "created" : "updated",
    };
  }

  const memberStatusSiriusId = text(pick(source, "worker_ms"));
  const [memberStatus] = memberStatusSiriusId
    ? await getClient()
      .select({
        id: optionsWorkerMs.id,
        industryId: optionsWorkerMs.industryId,
      })
      .from(optionsWorkerMs)
      .where(eq(optionsWorkerMs.siriusId, memberStatusSiriusId))
      .limit(1)
    : [];

  if (!live) {
    const id = `planned-worker:${einAlias}`;
    if (planState) planState.nextWorkerNumber++;
    planState?.workers.set(einAlias, id);
    if (planState) {
      const ids = planState.workersByName.get(nameKey) ?? new Set<string>();
      ids.add(id);
      planState.workersByName.set(nameKey, ids);
    }
    return { id, kind: "created" };
  }
  const worker = await storage.workers.createWorkerWithNameParts({ given, family, displayName });
  await storage.workerIds.createWorkerId({
    workerId: worker.id,
    typeId: idTypes.ein,
    value: normalizedEin,
  });
  await storage.workerEdls.setActive(worker.id, false);
  if (memberStatus) {
    await storage.workerMsh.createWorkerMsh({
      workerId: worker.id,
      date: ymd,
      msId: memberStatus.id,
      industryId: memberStatus.industryId,
    });
  }
  await ensureWorkerEmployment(worker.id, employerId, ymd);
  return { id: worker.id, kind: "created" };
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
  const values = {
    workerId,
    employerId,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: 1,
    employmentStatusId: employmentStatus.id,
    hours: null,
    home: false,
  };
  const [existingHours] = await client.select({ id: workerHours.id }).from(workerHours).where(and(
    eq(workerHours.workerId, workerId), eq(workerHours.employerId, employerId),
    eq(workerHours.year, values.year), eq(workerHours.month, values.month), eq(workerHours.day, 1),
  ));
  const inserted = existingHours ? [] : await client.insert(workerHours).values(values).onConflictDoNothing({
    target: [
      workerHours.workerId,
      workerHours.employerId,
      workerHours.year,
      workerHours.month,
      workerHours.day,
    ],
  }).returning({ id: workerHours.id });
  // A prior import may have written hours but not the derived relationship.
  // Check actual payloads, rather than trusting the cached source or existence.
  const expected = await storage.workerHours.getCurrentEmployment(workerId);
  const actual = await storage.workerEmploymentDenorm.getByWorker(workerId);
  const canonical = (rows: Array<{ employerId: string; home: boolean; jobTitle: string | null }>) =>
    rows.map(({ employerId, home, jobTitle }) => ({ employerId, home, jobTitle }))
      .sort((a, b) => a.employerId.localeCompare(b.employerId));
  if (inserted.length || !isDeepStrictEqual(canonical(expected), canonical(actual))) {
    await recomputeDenormEntity("worker_employment", workerId);
  }
  return employmentStatus.id;
}

function sourceCrew(sheet: Record<string, unknown>): unknown[] {
  return list(pick(sheet, "crews", "crew", "groups", "crew_groups"));
}
function sourceAssignments(crew: Record<string, unknown>): unknown[] {
  return list(pick(crew, "assignments", "workers", "crew_workers", "crewWorkers"));
}
function sourceCrewIdentity(crew: Record<string, unknown>, index: number): string {
  const sourceId = text(pick(crew, "uuid", "id"));
  return sourceId ? `source:${sourceId}` : `sequence:${index}`;
}
function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
function consumeCount(counts: Map<string, number>, key: string): boolean {
  const remaining = counts.get(key) ?? 0;
  if (remaining <= 0) return false;
  if (remaining === 1) counts.delete(key);
  else counts.set(key, remaining - 1);
  return true;
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
  idTypes: FreemanWorkerIdTypes,
  planState?: FreemanMigratePlanState,
): Promise<{
  kind: "created" | "updated" | "unchanged";
  sheetId?: string;
  records: FreemanMigrateRecordCounts;
  workers: Array<{ id: string; kind: "created" | "updated" }>;
  omittedAssignments: FreemanAssignmentOmission[];
}> {
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
  const title = importedJobNumber(sheet);
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
  const omittedAssignments: FreemanAssignmentOmission[] = [];
  const crewPlans: Array<{
    identity: string;
    input: CrewInput;
    assignments: Array<{
      workerId: string;
      workerKind: "created" | "updated";
      data: Record<string, unknown>;
      sourceIndex: number;
      recordKind?: "created" | "updated";
    }>;
  }> = [];
  for (let index = 0; index < crews.length; index++) {
    const crew = record(crews[index]);
    const assignments = sourceAssignments(crew);
    const crewIdentity = sourceCrewIdentity(crew, index);
    const freemanCrewLeadId = await resolveCrewlead(
      text(pick(crew, "crewlead", "crew_lead", "crewLead")),
      live,
    );
    const workersResolved: Array<{
      workerId: string;
      workerKind: "created" | "updated";
      data: Record<string, unknown>;
      sourceIndex: number;
      recordKind?: "created" | "updated";
    }> = [];
    for (let assignmentIndex = 0; assignmentIndex < assignments.length; assignmentIndex++) {
      const assignment = assignments[assignmentIndex];
      const assignmentRecord = record(assignment);
      const assignmentPlanState = !live && planState
        ? clonePlanState(planState)
        : planState;
      const prepare = async () => {
        const resolvedWorker = await resolveWorker(
          assignmentRecord,
          live,
          employerId,
          ymd,
          idTypes,
          assignmentPlanState,
        );
        const extra = record(assignmentRecord.assignment_extra);
        const classificationId = await resolveNamed(
          optionsClassifications,
          text(pick(extra, "classification")),
          live,
        );
        return { resolvedWorker, extra, classificationId };
      };
      try {
        const prepared = live
          ? await runInSavepoint(prepare)
          : await prepare();
        if (assignmentPlanState && planState && assignmentPlanState !== planState) {
          replacePlanState(planState, assignmentPlanState);
        }
        if (prepared.resolvedWorker) {
          workersResolved.push({
            workerId: prepared.resolvedWorker.id,
            workerKind: prepared.resolvedWorker.kind,
            sourceIndex: assignmentIndex,
            data: {
              startTime: text(pick(prepared.extra, "time")),
              note: text(pick(prepared.extra, "note")),
              classificationId: prepared.classificationId,
              freemanMigration: { source: assignmentRecord },
            },
          });
        }
      } catch (error) {
        omittedAssignments.push(
          assignmentOmission(error, index, assignmentIndex, "preparation"),
        );
      }
    }
    const count = numberValue(pick(crew, "worker_count", "workerCount", "count"), workersResolved.length);
    const taskId = await resolveNamed(optionsEdlsTasks, text(pick(crew, "task", "task_name", "taskName")), live, { departmentId });
    crewPlans.push({
      identity: crewIdentity,
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
  const [existingByNid] = await client.select().from(edlsSheets)
    .where(sql`${edlsSheets.data}->'freemanMigration'->>'nid' = ${nid}`);
  const existing = mapped ?? existingByNid;
  const records = emptyRecordCounts();
  const workerKinds = new Map<string, "created" | "updated">();
  for (const plan of crewPlans) {
    for (const assignment of plan.assignments) {
      const previous = workerKinds.get(assignment.workerId);
      workerKinds.set(
        assignment.workerId,
        previous === "created" || assignment.workerKind === "created"
          ? "created"
          : "updated",
      );
    }
  }
  for (const kind of workerKinds.values()) records.workers[kind]++;

  const existingCrewIdentityCounts = new Map<string, number>();
  const existingCrewIds = new Map<string, string>();
  const desiredCrewIdentities = new Set<string>();
  for (const plan of crewPlans) {
    if (desiredCrewIdentities.has(plan.identity)) {
      throw reportedError("source", "ambiguous_crew_identity", "More than one source crew has the same identity.");
    }
    desiredCrewIdentities.add(plan.identity);
  }
  const existingAssignmentWorkerCounts = new Map<string, number>();
  if (existing) {
    const existingCrews = await storage.edlsCrews.getBySheetId(existing.id);
    for (const existingCrew of existingCrews) {
      const migration = record(record(existingCrew.data).freemanMigration);
      const existingSource = record(migration.source);
      const identity = sourceCrewIdentity(existingSource, existingCrew.sequence);
      if (existingCrewIds.has(identity)) {
        throw reportedError("relation_resolution", "ambiguous_crew_identity", "More than one stored crew matches the same source identity.");
      }
      existingCrewIds.set(identity, existingCrew.id);
      incrementCount(existingCrewIdentityCounts, identity);
      for (const assignment of await storage.edlsAssignments.getByCrewId(existingCrew.id)) {
        incrementCount(existingAssignmentWorkerCounts, assignment.workerId);
      }
    }
  }
  for (const plan of crewPlans) {
    plan.input.id = existingCrewIds.get(plan.identity);
    if (consumeCount(existingCrewIdentityCounts, plan.identity)) records.crews.updated++;
    else records.crews.created++;
    for (const assignment of plan.assignments) {
      if (consumeCount(existingAssignmentWorkerCounts, assignment.workerId)) {
        assignment.recordKind = "updated";
        records.assignments.updated++;
      } else {
        assignment.recordKind = "created";
        records.assignments.created++;
      }
    }
  }
  if (!live) {
    await validateEdlsSheet.validateOrThrow({
      workerCount: finalWorkerCount,
      _crews: crewInputs,
    });
    const seenAssignments = new Set<string>();
    const assignmentKeys: string[] = [];
    const assignmentOwner = existing?.id ?? `planned-sheet:${nid}`;
    for (let crewIndex = 0; crewIndex < crewPlans.length; crewIndex++) {
      const plan = crewPlans[crewIndex];
      const acceptedAssignments: typeof plan.assignments = [];
      for (const assignment of plan.assignments) {
        const key = `${ymd}:${assignment.workerId}`;
        let error: Error | undefined;
        if (seenAssignments.has(key)) {
          error = new Error("The same worker is assigned more than once on this date.");
        }
        const plannedOwner = planState?.assignmentOwners.get(key);
        if (!error && plannedOwner && plannedOwner !== assignmentOwner) {
          error = new Error("A worker already has an assignment on this date.");
        }
        if (!error && !assignment.workerId.startsWith("planned-worker:")) {
          const conflicts = await client.select({
            sheetId: edlsCrews.sheetId,
          }).from(edlsAssignments)
            .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
            .where(and(
              eq(edlsAssignments.ymd, ymd),
              eq(edlsAssignments.workerId, assignment.workerId),
            ));
          if (conflicts.some((conflict) => (
            conflict.sheetId !== existing?.id
            && !planState?.replacedSheetIds.has(conflict.sheetId)
          ))) {
            error = new Error("A worker already has an assignment on this date.");
          }
        }
        if (error) {
          omittedAssignments.push(
            assignmentOmission(error, crewIndex, assignment.sourceIndex, "preparation"),
          );
          if (assignment.recordKind) records.assignments[assignment.recordKind]--;
          continue;
        }
        seenAssignments.add(key);
        assignmentKeys.push(key);
        acceptedAssignments.push(assignment);
      }
      plan.assignments = acceptedAssignments;
    }
    if (planState) {
      for (const [key, owner] of planState.assignmentOwners) {
        if (owner === assignmentOwner) planState.assignmentOwners.delete(key);
      }
      for (const key of assignmentKeys) {
        planState.assignmentOwners.set(key, assignmentOwner);
      }
      if (existing) planState.replacedSheetIds.add(existing.id);
    }
    return {
      kind: existing ? "updated" : "created",
      records,
      workers: Array.from(workerKinds, ([id, kind]) => ({ id, kind })),
      omittedAssignments,
    };
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
    const diagnostic = safeCanonicalSaveDiagnostic(error);
    throw reportedError(
      "canonical_save",
      "canonical_save_failed",
      "The canonical EDLS sheet and its roster could not be saved.",
      diagnostic.details,
      error,
    );
  }
  const targetId = result.sheet.id;
  for (const omission of result.omittedAssignments) {
    const omitted = crewPlans[omission.crewIndex]
      ?.assignments[omission.assignmentIndex];
    const sourceIndex = omitted?.sourceIndex ?? omission.assignmentIndex;
    if (omitted?.recordKind) records.assignments[omitted.recordKind]--;
    omittedAssignments.push(
      assignmentOmission(
        omission.error,
        omission.crewIndex,
        sourceIndex,
        "save",
      ),
    );
  }
  const stagedData = record(staged?.data);
  if (stagedData.targetSheetId !== targetId || !isDeepStrictEqual(stagedData.passportSheet, sheet)) {
    await storage.freemanEdlsMigrateStaging.setTargetSheetId(nid, targetId, sheet);
  }
  return {
    kind: result.kind,
    sheetId: targetId,
    records,
    workers: Array.from(workerKinds, ([id, kind]) => ({ id, kind })),
    omittedAssignments,
  };
}

const STATUS_LABELS: Record<FreemanMigrateStatus, string> = {
  draft: "Draft", request: "Requested", lock: "Scheduled", reserved: "Reserved",
};
async function runStatus(
  status: FreemanMigrateStatus,
  cursor: z.infer<typeof progressSchema>,
  limit: number,
  mode: "test" | "live",
  employerId: string,
  idTypes: FreemanWorkerIdTypes,
  planState: FreemanMigratePlanState,
  shouldStop?: () => Promise<boolean>,
  diagnostics?: { correlationId: string },
  onProgress?: ProgressCallback,
  importWrite: ImportWrite = runInTransaction,
) {
  await onProgress?.({ status, page: cursor.page, phase: "fetching" });
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
  let created = 0; let updated = 0; let unchanged = 0;
  const records = emptyRecordCounts();
  const statusWorkers = new Map<string, "created" | "updated">();
  const sheetResults: FreemanMigrateSheetResult[] = [];
  let stoppedEarly = false;
  for (const sheet of sheets) {
    if (mode === "live" && shouldStop && await shouldStop()) {
      stoppedEarly = true;
      break;
    }
    const identity = sourceIdentity(sheet);
    await onProgress?.({ status, page: cursor.page, phase: "processing", sheet: identity, pageSize: sheets.length });
    try {
      const sheetPlanState = mode === "test"
        ? {
          workers: new Map(planState.workers),
          workersByName: new Map(
            [...planState.workersByName].map(([key, ids]) => [key, new Set(ids)]),
          ),
          nextWorkerNumber: planState.nextWorkerNumber,
          assignmentOwners: new Map(planState.assignmentOwners),
          replacedSheetIds: new Set(planState.replacedSheetIds),
        }
        : undefined;
      const reconciled = mode === "live"
        ? await importWrite(() => reconcileSheet(sheet, status, true, employerId, idTypes))
        : await reconcileSheet(sheet, status, false, employerId, idTypes, sheetPlanState);
      if (sheetPlanState) {
        planState.workers = sheetPlanState.workers;
        planState.workersByName = sheetPlanState.workersByName;
        planState.nextWorkerNumber = sheetPlanState.nextWorkerNumber;
        planState.assignmentOwners = sheetPlanState.assignmentOwners;
        planState.replacedSheetIds = sheetPlanState.replacedSheetIds;
      }
      if (reconciled.kind === "created") created++;
      else if (reconciled.kind === "updated") updated++;
      else unchanged++;
      addRecordCounts(records, reconciled.records);
      for (const worker of reconciled.workers) {
        const previous = statusWorkers.get(worker.id);
        statusWorkers.set(
          worker.id,
          previous === "created" || worker.kind === "created"
            ? "created"
            : "updated",
        );
      }
      sheetResults.push({
        ...identity,
        ...(reconciled.sheetId ? { sheetId: reconciled.sheetId } : {}),
        sourceStatus: status,
        outcome: mode === "test"
          ? reconciled.kind === "created" ? "would_create" : "would_update"
          : reconciled.kind,
        records: reconciled.records,
        ...(reconciled.omittedAssignments.length
          ? { omittedAssignments: reconciled.omittedAssignments }
          : {}),
      });
    } catch (error) {
      if (error instanceof FreemanRunOwnershipError) throw error;
      const failure = sheetFailure(error);
      const diagnostic = error instanceof FreemanMigrateReportedError
        && error.report.code === "canonical_save_failed"
        ? safeCanonicalSaveDiagnostic(error.cause)
        : undefined;
      logger.error("Freeman EDLS sheet import failed", {
        service: "freeman-edls-migrate",
        correlationId: diagnostics?.correlationId,
        mode,
        limit,
        status,
        page: cursor.page,
        nid: identity.nid,
        stage: failure.stage,
        code: failure.code,
        error: error instanceof Error ? error.message : String(error),
        ...(diagnostic?.log ?? {}),
      });
      sheetResults.push({
        ...identity,
        sourceStatus: status,
        outcome: "failed",
        stage: failure.stage,
        code: failure.code,
        message: failure.message,
        details: failure.details,
      });
    }
    // reconcileSheet's transaction has committed (or rolled back) before this
    // callback. Never advertise a successful sheet from inside its transaction.
    await onProgress?.({
      status, page: cursor.page, phase: "processing", sheet: identity,
      pageSize: sheets.length, result: sheetResults[sheetResults.length - 1],
    });
  }
  await onProgress?.({ status, page: cursor.page, phase: "finished", pageSize: sheets.length });
  if (!stoppedEarly && mode === "live" && shouldStop) {
    stoppedEarly = await shouldStop();
  }
  const interrupted = stoppedEarly && sheetResults.length < sheets.length;
  const failed = sheetResults.filter((sheet) => sheet.outcome === "failed").length;
  for (const kind of statusWorkers.values()) records.workers[kind]++;
  return {
    fetched: interrupted ? sheetResults.length : sheets.length,
    valid: sheetResults.length - failed,
    created,
    updated,
    unchanged,
    failed,
    records,
    complete: !interrupted && sheets.length < limit,
    stoppedEarly,
    interrupted,
    fetch: {
      outcome: "success" as const,
      source: result.source,
      responseShape: unwrapped.responseShape,
    },
    sheets: sheetResults,
  };
}

export async function getFreemanMigrateStatus() {
  let run = await readRunControl();
  const stopRequested = await readStopRequest();
  if (stopRequested && isActiveLifecycle(run.lifecycle)) {
    run = { ...run, lifecycle: "stopping", stopRequested: true };
  }
  // A heartbeat is an observation, not authority to interrupt a lock holder.
  const heartbeatStale = isActiveLifecycle(run.lifecycle)
    && (!run.heartbeatAt || Date.now() - new Date(run.heartbeatAt).getTime() > 2 * 60_000);
  const progress = await readBatchProgress();
  return {
    variableName: FREEMAN_MIGRATE_STATUS_VARIABLE,
    statuses: (await readState()).statuses,
    run,
    recovery: {
      enabled: run.recoveryEnabled && !stopRequested && isActiveLifecycle(run.lifecycle),
      heartbeatStale,
      deferredReason: isMaintenanceActive() && run.recoveryEnabled
        ? "Waiting for maintenance mode to end." : run.deferredReason,
      resumedAt: run.resumedAt,
      resumeCount: run.resumeCount,
    },
    currentBatch: progress?.runStartedAt === run.startedAt && progress.batchNumber > run.batchCount
      ? progress : null,
    warning: "Legacy paging uses mutable offsets; records can move during a sweep. Failed sheets do not stop later pages; fix the cause and use Start Over to replay them.",
  };
}
export async function resetFreemanMigrateStatus(raw: unknown) {
  const input = resetMigrateStateSchema.parse(raw);
  const startDate = `${input.startDate}T00:00:00.000Z`;
  const control = await readRunControl();
  if (isActiveLifecycle(control.lifecycle)) {
    throw new FreemanMigrateConflictError("Migration progress cannot be reset while a live run is active.");
  }
  return withFreemanMigrateLock(async () => {
    await assertNoActiveFreemanMigrate();
    const state = initialState(startDate);
    await writeState(state);
    await writeRunControl(emptyRunControl());
    await writeStopRequest(false);
    return getFreemanMigrateStatus();
  });
}

let backgroundRun: Promise<void> | null = null;
async function runFreemanMigrateUnlocked(
  mode: "test" | "live",
  raw: unknown,
  shouldStop?: () => Promise<boolean>,
  diagnostics?: { correlationId: string },
  onProgress?: ProgressCallback,
  importWrite?: ImportWrite,
  saveState: (state: FreemanMigrateState) => Promise<void> = writeState,
): Promise<FreemanMigrateReport> {
  const { limit } = runSchema.parse(raw ?? {});
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const state = await readState();
  const next = structuredClone(state);
  const statuses: FreemanMigrateReport["statuses"] = [];
  const planState: FreemanMigratePlanState = {
    workers: new Map(),
    workersByName: new Map(),
    nextWorkerNumber: 0,
    assignmentOwners: new Map(),
    replacedSheetIds: new Set(),
  };
  let stoppedEarly = false;
  let employerId: string | null = null;
  let workerIdTypes: FreemanWorkerIdTypes | null = null;
  let setupError: FreemanMigrateError | undefined;
  try {
    const [ein, t631] = await Promise.all([
      storage.workerIds.getTypeIdBySiriusId("freeman_ein"),
      storage.workerIds.getTypeIdBySiriusId("t631"),
    ]);
    if (!ein || !t631) {
      setupError = {
        stage: "relation_resolution",
        code: "missing_worker_id_types",
        message: !ein && !t631
          ? "The Freeman EIN and Teamsters 631 worker ID types are not configured."
          : !ein
            ? "The Freeman EIN worker ID type is not configured."
            : "The Teamsters 631 worker ID type is not configured.",
      };
    } else {
      workerIdTypes = { ein, t631 };
    }
    const settings = await getEdlsSettings();
    if (!settings.employer) {
      setupError ??= {
        stage: "relation_resolution",
        code: "missing_edls_employer",
        message: "No employer is configured in EDLS settings.",
      };
    } else {
      const employer = await storage.employers.getEmployer(settings.employer);
      if (employer) employerId = employer.id;
      else {
        setupError ??= {
          stage: "relation_resolution",
          code: "edls_employer_not_found",
          message: "The employer configured in EDLS settings was not found.",
        };
      }
    }
  } catch (error) {
    logger.error("Freeman EDLS migration setup failed", {
      service: "freeman-edls-migrate",
      correlationId: diagnostics?.correlationId,
      mode,
      limit,
      stage: "relation_resolution",
      code: "setup_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    setupError = {
      stage: "relation_resolution",
      code: "setup_failed",
      message: "The local EDLS migration setup could not be read.",
    };
  }
  for (const status of FREEMAN_MIGRATE_STATUSES) {
    if (mode === "live" && shouldStop && await shouldStop()) {
      stoppedEarly = true;
      break;
    }
    const cursor = state.statuses[status] ?? { startDate: INITIAL_START_DATE, page: 0, sweepStartedAt: null };
    const request = {
      status,
      page: cursor.page,
      limit,
      startDate: cursor.startDate,
      sweepStartedAt: cursor.sweepStartedAt,
    };
    if (setupError || !employerId || !workerIdTypes) {
      statuses.push({
        status,
        label: STATUS_LABELS[status],
        fetched: 0,
        valid: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        failed: 0,
        records: emptyRecordCounts(),
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
      const report = await runStatus(
        status,
        activeCursor,
        limit,
        mode,
        employerId,
        workerIdTypes,
        planState,
        shouldStop,
        diagnostics,
        onProgress,
        importWrite,
      );
      const complete = report.complete;
      next.statuses[status] = nextCursorAfterReport(cursor, sweepStartedAt, report);
      statuses.push({
        status, label: STATUS_LABELS[status], ...report,
        page: cursor.page, nextPage: next.statuses[status].page,
        request: { ...request, sweepStartedAt },
      });
      if (report.stoppedEarly) {
        stoppedEarly = true;
        break;
      }
    } catch (error) {
      if (error instanceof FreemanRunOwnershipError) throw error;
      const failure = statusFailure(error);
      logger.error("Freeman EDLS status import failed", {
        service: "freeman-edls-migrate",
        correlationId: diagnostics?.correlationId,
        mode,
        limit,
        status,
        page: cursor.page,
        startDate: cursor.startDate,
        stage: failure.stage,
        code: failure.code,
        error: error instanceof Error ? error.message : String(error),
      });
      statuses.push({
        status, label: STATUS_LABELS[status],
        fetched: 0, valid: 0, created: 0, updated: 0, unchanged: 0, failed: 0,
        records: emptyRecordCounts(),
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
  if (!stoppedEarly && mode === "live" && shouldStop) {
    stoppedEarly = await shouldStop();
  }
  if (mode === "live") await saveState(next);
  return {
    correlationId: diagnostics?.correlationId,
    mode,
    limit,
    stoppedEarly,
    statuses,
    startedAt,
    durationMs: Date.now() - started,
  };
}

export async function runFreemanMigrate(
  mode: "test" | "live",
  raw: unknown,
  diagnostics?: { correlationId: string },
): Promise<FreemanMigrateReport> {
  if (mode === "test") return runFreemanMigrateUnlocked(mode, raw, undefined, diagnostics);
  return withFreemanMigrateLock(async (lock) => {
    await assertNoActiveFreemanMigrate();
    const { limit } = runSchema.parse(raw ?? {});
    const now = new Date().toISOString();
    const control = { ...emptyRunControl(), runId: randomUUID(), lifecycle: "running" as const, startedAt: now, heartbeatAt: now, limit };
    await withControlLock(async () => {
      await writeStopRequest(false);
      await writeRunControl(control);
    });
    const guard = createRunGuard(control.runId, lock);
    try {
      return await runTrackedBatch(limit, control, guard, false, diagnostics);
    } catch (error) {
      if (!(error instanceof FreemanRunOwnershipError)) {
        await guard.assertOwned();
        await changeRun(control.runId, (latest) => ({
          ...latest, lifecycle: "failed", finishedAt: new Date().toISOString(),
          error: "The live batch stopped because of an unexpected local error. Start again to resume.",
        }));
      }
      throw error;
    }
  });
}

export async function withFreemanMigrateLock<T>(
  fn: (lock: FreemanMigrationLock) => Promise<T>,
): Promise<T> {
  const lock = await storage.advisoryLock.tryAcquireSession(
    "freeman-edls-migrate-run",
    { timeoutMs: 0 },
  );
  if (!lock) throw new FreemanMigrateConflictError("A Freeman migration run is already in progress.");
  try {
    return await fn(lock);
  } finally {
    await lock.release();
  }
}

export const FREEMAN_MIGRATE_STOP_VARIABLE = "SITESPECIFIC_FREEMAN_MIGRATE_STOP";

async function readRunControl(): Promise<FreemanMigrateRunControl> {
  const variable = await storage.variables.getByName(FREEMAN_MIGRATE_RUN_VARIABLE);
  if (!variable?.value) return emptyRunControl();
  try {
    const value = typeof variable.value === "string" ? JSON.parse(variable.value) : variable.value;
    return runControlSchema.parse(value);
  } catch {
    return emptyRunControl();
  }
}

function emptyRunControl(): FreemanMigrateRunControl {
  return {
    runId: null, recoveryEnabled: false, actorId: null, originalActorId: null,
    resumedAt: null, resumeCount: 0, deferredReason: null,
    lifecycle: "idle", limit: null, stopRequested: false,
    startedAt: null, finishedAt: null, heartbeatAt: null, batchCount: 0,
    totals: { fetched: 0, valid: 0, created: 0, updated: 0, unchanged: 0, failed: 0, records: emptyRecordCounts() },
    latestBatch: null, error: null,
  };
}

type FreemanMigrationLock = NonNullable<
  Awaited<ReturnType<typeof storage.advisoryLock.tryAcquireSession>>
>;

export type FreemanMigrateRunControl = z.infer<typeof runControlSchema>;

export class FreemanMigrateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreemanMigrateConflictError";
  }
}

async function writeRunControl(state: FreemanMigrateRunControl): Promise<void> {
  const value = JSON.stringify(state);
  const existing = await storage.variables.getByName(FREEMAN_MIGRATE_RUN_VARIABLE);
  if (existing) await storage.variables.update(existing.id, { value });
  else await storage.variables.create({ name: FREEMAN_MIGRATE_RUN_VARIABLE, value });
}

const runControlSchema = z.object({
  runId: z.string().nullable().default(null),
  recoveryEnabled: z.boolean().default(false),
  actorId: z.string().nullable().default(null),
  originalActorId: z.string().nullable().default(null),
  resumedAt: z.string().nullable().default(null),
  resumeCount: z.number().int().nonnegative().default(0),
  deferredReason: z.string().nullable().default(null),
  lifecycle: lifecycleSchema,
  limit: z.number().int().min(1).max(100).nullable(),
  stopRequested: z.boolean(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  heartbeatAt: z.string().nullable(),
  batchCount: z.number().int().nonnegative(),
  totals: z.object({
    fetched: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative().default(0),
    failed: z.number().int().nonnegative(),
    records: z.object({
      crews: z.object({ created: z.number(), updated: z.number() }),
      assignments: z.object({ created: z.number(), updated: z.number() }),
      workers: z.object({ created: z.number(), updated: z.number() }),
    }),
  }),
  latestBatch: z.unknown().nullable(),
  error: z.string().nullable(),
}).strict();

const batchProgressSchema = z.object({
  runStartedAt: z.string(),
  batchNumber: z.number().int().positive(),
  updatedAt: z.string(),
  status: z.enum(FREEMAN_MIGRATE_STATUSES),
  page: z.number().int().nonnegative(),
  phase: z.enum(["fetching", "processing", "finished"]),
  sheet: z.object({ nid: z.string().optional(), title: z.string() }).nullable(),
  pageSize: z.number().int().nonnegative().nullable(),
  completedSheets: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  outcomes: z.array(z.object({
    nid: z.string().optional(),
    sheetId: z.string().optional(),
    title: z.string(),
    sourceStatus: z.enum(FREEMAN_MIGRATE_STATUSES),
    outcome: z.enum(["created", "updated", "unchanged", "failed", "would_create", "would_update"]),
    message: z.string().optional(),
    details: z.string().optional(),
    omittedAssignments: z.array(z.object({
      crewIndex: z.number(), assignmentIndex: z.number(),
      message: z.string(), details: z.string().optional(),
    })).optional(),
  })),
}).strict();
type BatchProgress = z.infer<typeof batchProgressSchema>;

async function readBatchProgress(): Promise<BatchProgress | null> {
  const row = await storage.variables.getByName(FREEMAN_MIGRATE_PROGRESS_VARIABLE);
  if (!row?.value) return null;
  try {
    return batchProgressSchema.parse(typeof row.value === "string" ? JSON.parse(row.value) : row.value);
  } catch {
    return null; // Old/no progress is not evidence that work has completed.
  }
}

async function writeBatchProgress(progress: BatchProgress): Promise<void> {
  const value = JSON.stringify(progress);
  const row = await storage.variables.getByName(FREEMAN_MIGRATE_PROGRESS_VARIABLE);
  if (row) await storage.variables.update(row.id, { value });
  else await storage.variables.create({ name: FREEMAN_MIGRATE_PROGRESS_VARIABLE, value });
}

async function readStopRequest(): Promise<boolean> {
  const variable = await storage.variables.getByName(FREEMAN_MIGRATE_STOP_VARIABLE);
  return variable?.value === true || variable?.value === "true";
}

export async function assertNoActiveFreemanMigrate(): Promise<void> {
  const control = await readRunControl();
  if (isActiveLifecycle(control.lifecycle)) {
    throw new FreemanMigrateConflictError("This action is unavailable while the live Freeman migration is active.");
  }
}

let startReserved = false;

function addReportTotals(control: FreemanMigrateRunControl, report: FreemanMigrateReport): void {
  for (const status of report.statuses) {
    control.totals.fetched += status.fetched;
    control.totals.valid += status.valid;
    control.totals.created += status.created;
    control.totals.updated += status.updated;
    control.totals.unchanged += status.unchanged;
    control.totals.failed += status.failed;
    for (const kind of ["crews", "assignments", "workers"] as const) {
      control.totals.records[kind].created += status.records[kind].created;
      control.totals.records[kind].updated += status.records[kind].updated;
    }
  }
}

function isActiveLifecycle(value: FreemanMigrateRunControl["lifecycle"]): boolean {
  return value === "starting" || value === "running" || value === "stopping";
}

async function writeStopRequest(requested: boolean): Promise<void> {
  const value = requested ? "true" : "false";
  const existing = await storage.variables.getByName(FREEMAN_MIGRATE_STOP_VARIABLE);
  if (existing) await storage.variables.update(existing.id, { value });
  else await storage.variables.create({ name: FREEMAN_MIGRATE_STOP_VARIABLE, value });
}

function withControlLock<T>(fn: () => Promise<T>): Promise<T> {
  return storage.advisoryLock.withTransactionLock("freeman-edls-migrate-control", fn);
}

async function changeRun(
  runId: string,
  change: (current: FreemanMigrateRunControl) => FreemanMigrateRunControl | Promise<FreemanMigrateRunControl>,
): Promise<void> {
  await withControlLock(async () => {
    const current = await readRunControl();
    if (current.runId !== runId) throw new FreemanRunOwnershipError("The migration run has changed.");
    await writeRunControl(await change(current));
  });
}

async function executionEligibility(control: FreemanMigrateRunControl) {
  if (isMaintenanceActive()) return { reason: "Waiting for maintenance mode to end." };
  for (const component of ["edls", "sitespecific.freeman", FREEMAN_EDLS_MIGRATE_COMPONENT_ID]) {
    if (!await isComponentEnabled(component)) return { reason: "Waiting for the required migration components to be enabled." };
  }
  const actor = control.actorId ? await storage.users.getUser(control.actorId) : undefined;
  if (!actor?.isActive || !await storage.users.userHasPermission(actor.id, "admin")) {
    return { reason: "The initiating user is unavailable, inactive, or no longer has admin permission. Stop this run and start again as an authorized administrator." };
  }
  const original = control.originalActorId ? await storage.users.getUser(control.originalActorId) : undefined;
  if (control.originalActorId && !original?.isActive) return { reason: "The original initiating account is unavailable or inactive." };
  return { actor, original, reason: null };
}

function createRunGuard(runId: string, lock: FreemanMigrationLock, background = false) {
  const assertOwned = async () => {
    try {
      await lock.assertHeld();
      if ((await readRunControl()).runId !== runId) throw new Error("Run changed.");
    } catch {
      throw new FreemanRunOwnershipError("The migration no longer owns its execution lock.");
    }
  };
  // This short transaction fence also serializes the last in-flight sheet with
  // a replacement worker after a lock connection dies. Check again BEFORE
  // commit, rolling back the old sheet if ownership was lost during its save.
  const write: ImportWrite = (fn) => storage.advisoryLock.withTransactionLock(
    "freeman-edls-migrate-work",
    async () => {
      await assertOwned();
      const result = await fn();
      await assertOwned();
      return result;
    },
  );
  const shouldStop = async () => {
    await assertOwned();
    const current = await readRunControl();
    if (current.lifecycle === "stopping" || await readStopRequest()) return true;
    if (background) {
      const { reason } = await executionEligibility(current);
      if (reason) {
        await changeRun(runId, (latest) => ({ ...latest, deferredReason: reason }));
        return true;
      }
    }
    return false;
  };
  return { assertOwned, write, shouldStop };
}
type RunGuard = ReturnType<typeof createRunGuard>;

async function runTrackedBatch(
  limit: number,
  control: FreemanMigrateRunControl,
  guard: RunGuard,
  background: boolean,
  diagnostics?: { correlationId: string },
): Promise<FreemanMigrateReport> {
  let heartbeatWrite = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatWrite = heartbeatWrite.then(async () => {
      await guard.assertOwned();
      await changeRun(control.runId!, (latest) => isActiveLifecycle(latest.lifecycle)
        ? { ...latest, heartbeatAt: new Date().toISOString() } : latest);
    }).catch(() => {
      logger.warn("Freeman migration heartbeat could not be persisted", {
        service: "freeman-edls-migrate",
      });
    });
  }, 30_000);
  const progress: BatchProgress = {
    runStartedAt: control.startedAt!,
    batchNumber: control.batchCount + 1,
    updatedAt: new Date().toISOString(), status: "draft", page: 0,
    phase: "fetching", sheet: null, pageSize: null, completedSheets: 0,
    created: 0, updated: 0, unchanged: 0, failed: 0, outcomes: [],
  };
  let nextState: FreemanMigrateState | undefined;
  try {
    const report = await runFreemanMigrateUnlocked("live", { limit }, guard.shouldStop, diagnostics, async (event) => {
      progress.updatedAt = new Date().toISOString();
      progress.status = event.status;
      progress.page = event.page;
      progress.phase = event.phase;
      progress.sheet = event.sheet ?? null;
      progress.pageSize = event.pageSize ?? null;
      if (event.result) {
        progress.completedSheets++;
        if (event.result.outcome === "created") progress.created++;
        else if (event.result.outcome === "updated") progress.updated++;
        else if (event.result.outcome === "unchanged") progress.unchanged++;
        else if (event.result.outcome === "failed") progress.failed++;
        progress.outcomes.push(event.result);
      }
      await guard.write(() => writeBatchProgress(progress));
    }, guard.write, async (state) => { nextState = state; });
    // Cursor and finalized totals are one checkpoint. A crash before commit
    // replays the old page; a crash after commit resumes the next one.
    await guard.write(() => changeRun(control.runId!, async (latest) => {
      const stop = latest.lifecycle === "stopping" || await readStopRequest();
      const deferred = background && !stop && Boolean(latest.deferredReason);
      const failed = reportHasFatalFailure(report);
      const completed = !background || (!report.stoppedEarly
        && report.statuses.length === FREEMAN_MIGRATE_STATUSES.length
        && report.statuses.every((status) => status.complete));
      addReportTotals(latest, report);
      latest.batchCount++;
      latest.latestBatch = report;
      latest.heartbeatAt = new Date().toISOString();
      if (failed || stop || (completed && !deferred)) {
        latest.lifecycle = failed ? "failed" : stop ? "stopped" : "completed";
        latest.finishedAt = new Date().toISOString();
        latest.recoveryEnabled = false;
        latest.stopRequested = false;
        latest.deferredReason = null;
        latest.error = failed ? "The latest batch failed. Review its failure details, then start again to retry." : null;
        await writeStopRequest(false);
      }
      if (nextState) await writeState(nextState);
      return latest;
    }));
    return report;
  } finally {
    clearInterval(heartbeat);
    await heartbeatWrite;
  }
}

async function executeBackgroundRun(runId: string, limit: number, lock: FreemanMigrationLock): Promise<void> {
  const guard = createRunGuard(runId, lock, true);
  try {
    await guard.assertOwned();
    while (true) {
      const control = await readRunControl();
      if (await guard.shouldStop()) {
        await guard.write(() => settleStop(runId));
        return;
      }
      await runTrackedBatch(limit, control, guard, true);
      const latest = await readRunControl();
      if (!isActiveLifecycle(latest.lifecycle) || latest.deferredReason) return;
    }
  } catch (error) {
    if (!(error instanceof FreemanRunOwnershipError)) {
      await guard.assertOwned();
      await changeRun(runId, async (latest) => {
        if (latest.lifecycle === "stopping" || await readStopRequest()) {
          await writeStopRequest(false);
          return { ...latest, lifecycle: "stopped", recoveryEnabled: false, stopRequested: false, finishedAt: new Date().toISOString() };
        }
        // Maintenance can begin during a sheet. Its transaction rolls back;
        // leave durable intent intact and let the next tick retry eligibility.
        if (isMaintenanceActive()) return latest;
        return {
          ...latest, lifecycle: "failed", recoveryEnabled: false,
          finishedAt: new Date().toISOString(),
          error: "The background migration stopped because of an unexpected local error. Start again to resume.",
        };
      });
      logger.error("Freeman background migration failed", { service: "freeman-edls-migrate" });
    }
  } finally {
    await lock.release();
  }
}

async function settleStop(runId: string): Promise<void> {
  await changeRun(runId, async (latest) => {
    if (latest.lifecycle !== "stopping" && !await readStopRequest()) return latest;
    await writeStopRequest(false);
    return {
      ...latest, lifecycle: "stopped", recoveryEnabled: false, stopRequested: false,
      finishedAt: new Date().toISOString(), deferredReason: null,
    };
  });
}

function launchBackground(control: FreemanMigrateRunControl, lock: FreemanMigrationLock) {
  // Neither an HTTP request's transaction nor the cron emitter's actor is the
  // resumed import's context. Reconstruct only its saved, freshly checked actor.
  backgroundRun = runOutsideTransaction(async () => {
    const eligible = await executionEligibility(control);
    if (!eligible.actor || eligible.reason) {
      await lock.release();
      return;
    }
    await requestContext.run({
      userId: eligible.actor.id, userEmail: eligible.actor.email ?? undefined,
      originalUserId: eligible.original?.id, originalUserEmail: eligible.original?.email ?? undefined,
      suppressNotifications: true,
    }, () => executeBackgroundRun(control.runId!, control.limit!, lock));
  }).catch(() => {
    logger.error("Freeman migration worker could not continue", { service: "freeman-edls-migrate" });
  }).finally(async () => { await lock.release(); backgroundRun = null; });
}

export async function startFreemanMigrate(raw: unknown): Promise<ReturnType<typeof getFreemanMigrateStatus>> {
  const { limit } = runSchema.parse(raw ?? {});
  if (startReserved || backgroundRun) {
    throw new FreemanMigrateConflictError("A Freeman migration run is already in progress.");
  }
  startReserved = true;
  let lock: FreemanMigrationLock | null = null;
  try {
    lock = await storage.advisoryLock.tryAcquireSession(
      "freeman-edls-migrate-run",
      { timeoutMs: 0 },
    );
    if (!lock) {
      throw new FreemanMigrateConflictError("A Freeman migration run is already in progress.");
    }
    const context = getRequestContext();
    const control = {
      ...emptyRunControl(), runId: randomUUID(), recoveryEnabled: true,
      actorId: context?.userId ?? null, originalActorId: context?.originalUserId ?? null,
      lifecycle: "running" as const, limit,
      startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(),
    };
    const eligible = await executionEligibility(control);
    if (eligible.reason) throw new FreemanMigrateConflictError(eligible.reason);
    await withControlLock(async () => {
      const existing = await readRunControl();
      // Legacy/foreground orphans may be replaced manually only after acquiring
      // the execution lock AND observing an old heartbeat.
      if (isActiveLifecycle(existing.lifecycle) && (existing.recoveryEnabled
        || (existing.heartbeatAt && Date.now() - Date.parse(existing.heartbeatAt) <= 120_000))) {
        throw new FreemanMigrateConflictError("A Freeman migration run is already in progress. Stop it before starting another.");
      }
      await writeStopRequest(false);
      await writeRunControl(control);
    });
    const runLock = lock;
    lock = null;
    launchBackground(control, runLock);
    return getFreemanMigrateStatus();
  } finally {
    if (lock) await lock.release();
    startReserved = false;
  }
}

export async function stopFreemanMigrate(): Promise<ReturnType<typeof getFreemanMigrateStatus>> {
  await withControlLock(async () => {
    const control = await readRunControl();
    if (!isActiveLifecycle(control.lifecycle)) return;
    await writeStopRequest(true);
    await writeRunControl({ ...control, lifecycle: "stopping", stopRequested: true, recoveryEnabled: false });
  });
  // If the worker died, no one is left to acknowledge the durable stop. The
  // same bounded recovery check settles it, never launching replacement work.
  await recoverFreemanMigrate();
  return getFreemanMigrateStatus();
}

export async function recoverFreemanMigrate(): Promise<void> {
  return runOutsideTransaction(async () => {
    if (startReserved || backgroundRun || isMaintenanceActive()) return;
    startReserved = true;
    let lock: FreemanMigrationLock | null = null;
    try {
      const candidate = await readRunControl();
      if (!isActiveLifecycle(candidate.lifecycle)
        || (!candidate.recoveryEnabled && candidate.lifecycle !== "stopping")) return;
      lock = await storage.advisoryLock.tryAcquireSession("freeman-edls-migrate-run", { timeoutMs: 0 });
      if (!lock) return;
      await lock.assertHeld();
      let launch: FreemanMigrateRunControl | undefined;
      await withControlLock(async () => {
        const current = await readRunControl();
        if (current.runId !== candidate.runId || !isActiveLifecycle(current.lifecycle)) return;
        if (current.lifecycle === "stopping" || await readStopRequest()) {
          await writeStopRequest(false);
          await writeRunControl({ ...current, lifecycle: "stopped", recoveryEnabled: false,
            stopRequested: false, finishedAt: new Date().toISOString(), deferredReason: null });
          return;
        }
        if (!current.recoveryEnabled || !current.runId || !current.limit) return;
        const { reason } = await executionEligibility(current);
        if (reason) {
          await writeRunControl({ ...current, deferredReason: reason });
          return;
        }
        launch = { ...current, lifecycle: "running", deferredReason: null,
          heartbeatAt: new Date().toISOString(), resumedAt: new Date().toISOString(),
          resumeCount: current.resumeCount + 1 };
        await writeRunControl(launch);
      });
      if (launch) {
        const runLock = lock;
        lock = null;
        launchBackground(launch, runLock);
      }
    } finally {
      if (lock) await lock.release();
      startReserved = false;
    }
  });
}
