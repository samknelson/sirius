import { parse as parseCSV } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { FeedWizard, FeedField } from "../engine/feed";
import { objectStorageService } from "../../../services/objectStorage";
import { getEffectiveUser } from "../../../modules/masquerade";
import type {
  WizardStepHandler,
  WizardStepContext,
  WizardStepResult,
  WizardUpdateContext,
  WizardUpdateResult,
} from "../types";

/**
 * Shared Upload → Map → Validate → Process → Results step builders for the
 * feed/import wizards. Every feed wizard already inherits the storage-safe
 * `FeedWizard` base (CSV/XLSX parse, column mapping, batched validate +
 * process, results CSV via storage). These builders wrap those methods in
 * the fixed dispatcher step shapes so a feed wizard adds ZERO routes:
 *
 *   - upload   → `upload` step: stores the file via storage + object
 *                storage, parses columns/preview into `wizard.data`.
 *   - map      → `custom` step: the flipped mapping UI (fields as rows).
 *                Reads fields+preview via the generic `getData` route and
 *                writes `columnMapping` / `mode` / `hasHeaders` via `submit`.
 *   - validate → `run` step: `feed.validateFeedData` (persists
 *                `validationResults`); read back via `getData`.
 *   - process  → `run` step: `feed.processFeedData` (persists
 *                `processResults` + results CSV + wizard status); read via
 *                `getData`.
 *   - results  → `custom` step: renders `processResults` via `getData`.
 *
 * The canonical stored `columnMapping` is the `{ fieldId: colKey }` shape
 * (a field can only point at one column, and two fields pointing at the
 * same column is representable + detectable — impossible in the legacy
 * `{ col_N: fieldId }` shape, which collides on the key). `FeedWizard`'s
 * `normalizeColumnMapping` accepts EITHER shape, so pre-existing wizards
 * with the legacy shape keep working; the map UI reads either and always
 * submits the `{ fieldId: colKey }` shape.
 */

const ALLOWED_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/** Drop columns that are empty across every row (mirrors FeedWizard). */
function filterEmptyColumns(rows: any[][]): any[][] {
  if (rows.length === 0) return rows;
  const maxCols = Math.max(...rows.map((row) => row.length));
  const keep: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    const hasData = rows.some((row) => {
      const cell = row[c];
      return cell !== null && cell !== undefined && cell !== "";
    });
    if (hasData) keep.push(c);
  }
  return rows.map((row) => keep.map((c) => row[c] ?? ""));
}

function parseFileToRows(buffer: Buffer, mimeType: string): any[][] {
  let rows: any[][] = [];
  if (mimeType === "text/csv") {
    rows = parseCSV(buffer, {
      relax_column_count: true,
      skip_empty_lines: true,
    });
  } else if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(firstSheet, {
      header: 1,
      defval: "",
      blankrows: false,
    }) as any[][];
  } else {
    throw new Error("Unsupported file type");
  }
  return filterEmptyColumns(rows);
}

function isOldMappingFormat(mapping: Record<string, string>): boolean {
  const keys = Object.keys(mapping);
  return keys.length > 0 && keys.every((k) => k.startsWith("col_"));
}

/** The set of feed field ids currently mapped, from either mapping shape. */
function mappedFieldIds(mapping: Record<string, string>): Set<string> {
  const ids = new Set<string>();
  if (isOldMappingFormat(mapping)) {
    for (const v of Object.values(mapping)) {
      if (v && v !== "_unmapped") ids.add(v);
    }
  } else {
    for (const [fieldId, col] of Object.entries(mapping)) {
      if (col && col !== "_unmapped") ids.add(fieldId);
    }
  }
  return ids;
}

function requiredFieldIds(fields: FeedField[], mode: string): string[] {
  return fields
    .filter(
      (f) =>
        f.required ||
        (mode === "create" && f.requiredForCreate) ||
        (mode === "update" && f.requiredForUpdate),
    )
    .map((f) => f.id);
}

/** `upload` step: store + parse the data file. */
export function buildUploadStep(
  feed: FeedWizard,
  description = "Upload the data file",
): WizardStepHandler {
  return {
    id: "upload",
    name: "Upload",
    description,
    kind: "upload",
    component: "FeedUpload",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      return data.uploadedFileId ? "completed" : "pending";
    },
    submit: async (ctx: WizardStepContext) => {
      const file = ctx.file;
      if (!file) throw new Error("No file uploaded");
      if (file.mimetype && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new Error(
          "Invalid file type. Only CSV and XLSX files are supported.",
        );
      }

      const session = (ctx.req as any).session;
      const user = (ctx.req as any).user;
      const { dbUser } = await getEffectiveUser(session, user);
      if (!dbUser) throw new Error("User not found");

      const customPath = `wizards/${ctx.wizardId}/${Date.now()}_${file.originalname}`;
      const uploadResult = await objectStorageService.uploadFile({
        fileName: file.originalname,
        fileContent: file.buffer,
        mimeType: file.mimetype,
        accessLevel: "private",
        customPath,
      });

      // associateFile creates the file row (via storage) AND writes
      // uploadedFileId onto wizard.data while clearing downstream step data.
      await feed.associateFile(ctx.wizardId, {
        fileName: file.originalname,
        storagePath: uploadResult.storagePath,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: dbUser.id,
        entityType: "wizard",
        entityId: ctx.wizardId,
        accessLevel: "private",
      });

      const rows = parseFileToRows(file.buffer, file.mimetype);
      return {
        data: {
          fileName: file.originalname,
          columnCount: rows[0]?.length ?? 0,
          previewRows: rows.slice(0, 6),
          totalRows: rows.length,
        },
      };
    },
  };
}

/** `custom` map step: flipped mapping UI, driven by getData + submit. */
export function buildMapStep(
  feed: FeedWizard,
  name = "Map Columns",
  description = "Map file columns to fields",
): WizardStepHandler {
  return {
    id: "map",
    name,
    description,
    kind: "custom",
    component: "FeedMap",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      const mapping: Record<string, string> = data.columnMapping || {};
      if (Object.keys(mapping).length === 0) {
        return wizard.currentStep === "map" ? "in_progress" : "pending";
      }
      const mode = data.mode || "create";
      const mapped = mappedFieldIds(mapping);
      const required = requiredFieldIds(feed.getFields?.() ?? [], mode);
      const complete = required.every((id) => mapped.has(id));
      if (complete) return "completed";
      return wizard.currentStep === "map" ? "in_progress" : "pending";
    },
    getData: (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      return {
        fields: feed.getFields?.() ?? [],
        previewRows: data.previewRows ?? [],
        columnCount: data.columnCount ?? 0,
        fileName: data.fileName ?? null,
        columnMapping: data.columnMapping ?? {},
        mode: data.mode ?? "create",
        hasHeaders: data.hasHeaders ?? true,
      };
    },
    submit: (ctx: WizardStepContext) => {
      const input = ctx.input as {
        columnMapping?: Record<string, string>;
        mode?: "create" | "update";
        hasHeaders?: boolean;
      };
      const columnMapping = input.columnMapping ?? {};
      // Format-agnostic duplicate guard (mirrors
      // FeedWizard.validateMappingDuplicates): the values are colKeys for the
      // canonical { fieldId: colKey } shape and fieldIds for the legacy shape;
      // a repeated value means the same column (or field) is used twice.
      const values = Object.values(columnMapping).filter(
        (v) => v && v !== "_unmapped",
      );
      const dups = values.filter((v, i) => values.indexOf(v) !== i);
      if (dups.length > 0) {
        throw new Error(
          `Column mapping contains duplicate assignments: ${Array.from(
            new Set(dups),
          ).join(", ")}. Each field and column may be used only once.`,
        );
      }
      const mode = input.mode ?? "create";
      const required = requiredFieldIds(feed.getFields?.() ?? [], mode);
      const mapped = mappedFieldIds(columnMapping);
      const missing = required.filter((id) => !mapped.has(id));
      if (missing.length > 0) {
        throw new Error(
          `Required fields are not mapped: ${missing.join(", ")}.`,
        );
      }
      return {
        data: {
          columnMapping,
          mode,
          hasHeaders: input.hasHeaders ?? true,
        },
      };
    },
  };
}

function runStepState(stepId: string) {
  return (wizard: { data: unknown }) => {
    const data = (wizard.data as any) || {};
    const status = data.progress?.[stepId]?.status;
    if (status === "completed") return "completed" as const;
    if (status === "failed") return "failed" as const;
    if (status === "in_progress") return "in_progress" as const;
    return "pending" as const;
  };
}

/**
 * Result-aware completion predicate over the persisted `validationResults`.
 * The DEFAULT mirrors the legacy `evaluateValidateComplete`: the step only
 * completes when there are no invalid rows AND no unmapped employment
 * statuses. The cardcheck "skip invalid" feed overrides this with the legacy
 * `evaluateValidateCompleteSkipInvalid` rule (`validRows > 0`).
 */
export type ValidateComplete = (vr: any) => boolean;

const defaultValidateComplete: ValidateComplete = (vr) =>
  (vr.invalidRows ?? 0) === 0 &&
  !(vr.unmappedStatuses && vr.unmappedStatuses.length > 0);

/** `run` validate step: batched row validation via the feed base. */
export function buildValidateStep(
  feed: FeedWizard,
  opts?: {
    component?: string;
    description?: string;
    /**
     * Result-aware completion. Defaults to the standard rule (no invalid
     * rows, no unmapped statuses). Gating the step on the validation
     * OUTCOME — not merely on the async run finishing — is what stops a
     * user from advancing past a file that still has invalid rows.
     */
    isComplete?: ValidateComplete;
  },
): WizardStepHandler {
  const component = opts?.component ?? "RunView";
  const description =
    opts?.description ?? "Validate the data before processing";
  const isComplete = opts?.isComplete ?? defaultValidateComplete;
  return {
    id: "validate",
    name: "Validate",
    description,
    kind: "run",
    component,
    getState: (wizard) => {
      const data = (wizard as any).data || {};
      const status = data.progress?.validate?.status;
      if (status === "failed") return "failed";
      if (status === "in_progress") return "in_progress";
      const vr = data.validationResults;
      if (!vr) {
        return (wizard as any).currentStep === "validate"
          ? "in_progress"
          : "pending";
      }
      if (isComplete(vr)) return "completed";
      // Ran, but the outcome doesn't satisfy the gate (invalid rows,
      // unmapped statuses, or zero valid rows) — keep the user on the step.
      return (wizard as any).currentStep === "validate"
        ? "in_progress"
        : "pending";
    },
    run: async (ctx: WizardStepContext) => {
      await feed.validateFeedData(ctx.wizardId, 100, (p) => {
        const pct =
          p.total > 0
            ? Math.min(99, Math.round((p.processed / p.total) * 100))
            : 0;
        void ctx.reportProgress(pct);
      });
      // validationResults persisted by the base method; nothing to merge.
    },
    getData: (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      return { validationResults: data.validationResults ?? null };
    },
  };
}

/** `run` process step: batched create/update via the feed base. */
export function buildProcessStep(
  feed: FeedWizard,
  component = "RunView",
  description = "Process the validated records",
): WizardStepHandler {
  return {
    id: "process",
    name: "Process",
    description,
    kind: "run",
    component,
    getState: runStepState("process"),
    run: async (ctx: WizardStepContext) => {
      await feed.processFeedData(ctx.wizardId, 100, (p) => {
        const pct =
          p.total > 0
            ? Math.min(99, Math.round((p.processed / p.total) * 100))
            : 0;
        void ctx.reportProgress(pct);
      });
      // processResults + wizard status persisted by the base method.
    },
    getData: (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      return {
        processResults: data.processResults ?? null,
        validationResults: data.validationResults ?? null,
      };
    },
  };
}

/**
 * `custom` results/review step: read-only view of processResults. When a
 * wizard exposes a bespoke "reprocess"/"rescan" action, pass `run` — it is
 * driven through the SAME fixed `run` route (POST .../dispatch/:stepId/run)
 * so no wizard-specific route is added. `getData` surfaces the step's own
 * progress so the client can poll the async action to completion.
 */
export function buildFeedResultsStep(opts?: {
  id?: string;
  name?: string;
  description?: string;
  component?: string;
  run?: (
    ctx: WizardStepContext,
  ) => Promise<WizardStepResult | void> | WizardStepResult | void;
}): WizardStepHandler {
  const id = opts?.id ?? "results";
  const handler: WizardStepHandler = {
    id,
    name: opts?.name ?? "Results",
    description: opts?.description ?? "Review import results",
    kind: "custom",
    component: opts?.component ?? "FeedResults",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      return data.processResults ? "completed" : "pending";
    },
    getData: (ctx: WizardStepContext) => {
      const data = (ctx.wizard.data as any) || {};
      return {
        processResults: data.processResults ?? null,
        validationResults: data.validationResults ?? null,
        progress: data.progress?.[id] ?? null,
      };
    },
  };
  if (opts?.run) handler.run = opts.run;
  return handler;
}

/**
 * Feed wizards' `prepareUpdate` hook for the generic `PATCH /api/wizards/:id`
 * route. It validates an incoming column mapping (rejecting duplicate
 * assignments in either the canonical `{ fieldId: colKey }` shape or the
 * legacy `{ col_N: fieldId }` shape) and clears downstream step data when the
 * upstream input changes: a new upload clears map/validate/process/review; a
 * changed mapping / header flag / mode clears validate/process/review. This
 * keeps the feed reset behavior with the feed wizards instead of the route.
 */
export function prepareFeedDataUpdate(
  ctx: WizardUpdateContext,
): WizardUpdateResult {
  const existingData = (ctx.existing.data || {}) as any;
  const incomingData = ctx.incoming as any;
  const mergedData: any = { ...ctx.merged };

  if (incomingData.columnMapping) {
    const cmKeys = Object.keys(incomingData.columnMapping);
    const isOldFormat =
      cmKeys.length > 0 && cmKeys.every((k: string) => k.startsWith("col_"));
    if (isOldFormat) {
      const fieldIds = Object.values(incomingData.columnMapping).filter(
        (id: any) => id && id !== "_unmapped",
      );
      const duplicates = fieldIds.filter(
        (id: any, index: number) => fieldIds.indexOf(id) !== index,
      );
      if (duplicates.length > 0) {
        const uniqueDuplicates = Array.from(new Set(duplicates));
        return {
          error: `Duplicate field mappings detected: ${uniqueDuplicates.join(
            ", ",
          )}. Each field can only be mapped once.`,
          status: 400,
        };
      }
    } else {
      const colValues = Object.values(incomingData.columnMapping).filter(
        (v: any) => v && v !== "_unmapped",
      );
      const duplicates = colValues.filter(
        (v: any, index: number) => colValues.indexOf(v) !== index,
      );
      if (duplicates.length > 0) {
        const uniqueDuplicates = Array.from(new Set(duplicates));
        return {
          error: `Duplicate column mappings detected: ${uniqueDuplicates.join(
            ", ",
          )}. Each column can only be mapped once.`,
          status: 400,
        };
      }
    }
  }

  // A new upload invalidates everything downstream of it.
  if (
    incomingData.uploadedFileId &&
    incomingData.uploadedFileId !== existingData.uploadedFileId
  ) {
    delete mergedData.columnMapping;
    delete mergedData.hasHeaders;
    delete mergedData.validationResults;
    if (mergedData.progress) {
      delete mergedData.progress.map;
      delete mergedData.progress.validate;
      delete mergedData.progress.process;
      delete mergedData.progress.review;
    }
  }
  // A changed mapping / header flag / mode invalidates validate onward.
  else if (
    (incomingData.columnMapping &&
      JSON.stringify(incomingData.columnMapping) !==
        JSON.stringify(existingData.columnMapping)) ||
    (incomingData.hasHeaders !== undefined &&
      incomingData.hasHeaders !== existingData.hasHeaders) ||
    (incomingData.mode && incomingData.mode !== existingData.mode)
  ) {
    delete mergedData.validationResults;
    if (mergedData.progress) {
      delete mergedData.progress.validate;
      delete mergedData.progress.process;
      delete mergedData.progress.review;
    }
  }

  return { data: mergedData };
}
