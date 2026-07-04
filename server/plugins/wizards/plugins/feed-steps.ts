import { parse as parseCSV } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { FeedWizard, FeedField } from "../../../wizards/feed";
import { objectStorageService } from "../../../services/objectStorage";
import { getEffectiveUser } from "../../../modules/masquerade";
import type {
  WizardStepHandler,
  WizardStepContext,
  WizardStepResult,
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

/** `run` validate step: batched row validation via the feed base. */
export function buildValidateStep(
  feed: FeedWizard,
  component = "RunView",
  description = "Validate the data before processing",
): WizardStepHandler {
  return {
    id: "validate",
    name: "Validate",
    description,
    kind: "run",
    component,
    getState: runStepState("validate"),
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
