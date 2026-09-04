/**
 * JSON export / import for the unified options registry.
 *
 * Both tools are written once against `optionsMetadata`, so every options
 * type gets them for free. The planner and the applier are the same code
 * path (a `dryRun` flag decides whether it writes), so a clean preview and
 * the apply that follows can never disagree.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import {
  optionsImportHasWrites,
  summarizeOptionsImport,
  type OptionsExportEnvelope,
  type OptionsExportRecord,
  type OptionsImportOptions,
  type OptionsImportPlanItem,
  type OptionsImportProblem,
  type OptionsImportResult,
  type OptionsRecordReference,
} from "@shared/optionsTransfer";
import { getOptionsStorage, getOptionsType, type OptionsTypeConfig } from "./options-registry";
import { optionsMetadata, type OptionsTypeName } from "../storage/unified-options";
import { isComponentEnabled } from "./components";
import { requireAccess } from "../services/access-policy-evaluator";
import { runInTransaction } from "../storage/transaction-context";
import { logger } from "../logger";
import {
  buildOptionCreateData,
  buildOptionUpdateData,
  checkOptionDeleteGuard,
  optionDbErrorMessage,
  validateOptionTypeSpecificData,
} from "./options-write-rules";

// ---------------------------------------------------------------------------
// Metadata-derived shape
// ---------------------------------------------------------------------------

/**
 * Names of fields whose `requiredComponent` is currently disabled. These are
 * stripped from the definition served to the form, from exported records, and
 * ignored on import, so a disabled component's fields stay invisible and
 * untouchable everywhere.
 */
export async function getDisabledOptionFieldNames(
  type: OptionsTypeName,
): Promise<Set<string>> {
  const disabled = new Set<string>();
  const metadata = optionsMetadata[type];
  if (!metadata) return disabled;

  const gatedComponents = Array.from(
    new Set(
      metadata.fields
        .map((f) => f.requiredComponent)
        .filter((c): c is string => typeof c === "string"),
    ),
  );
  if (gatedComponents.length === 0) return disabled;

  const disabledComponents = new Set<string>();
  for (const componentId of gatedComponents) {
    if (!(await isComponentEnabled(componentId))) {
      disabledComponents.add(componentId);
    }
  }
  for (const field of metadata.fields) {
    if (field.requiredComponent && disabledComponents.has(field.requiredComponent)) {
      disabled.add(field.name);
    }
  }
  return disabled;
}

/** The type's writable top-level columns (JSONB `data` is handled separately). */
function writableColumns(type: OptionsTypeName): string[] {
  const metadata = optionsMetadata[type];
  const all = [...metadata.requiredFields, ...metadata.optionalFields];
  return Array.from(new Set(all)).filter((name) => name !== "data");
}

function hasDataColumn(type: OptionsTypeName): boolean {
  return optionsMetadata[type].optionalFields.includes("data");
}

function hasSiriusIdColumn(type: OptionsTypeName): boolean {
  return writableColumns(type).includes("siriusId");
}

/** A field that points at another options record (or at this same type). */
interface ReferenceField {
  name: string;
  /** Lives inside the JSONB `data` column rather than a top-level column. */
  dataField: boolean;
  targetType: OptionsTypeName;
  /** True when the target is this same type (a parent-style self reference). */
  self: boolean;
}

function referenceFields(type: OptionsTypeName): ReferenceField[] {
  const refs: ReferenceField[] = [];
  for (const field of optionsMetadata[type].fields) {
    if (field.inputType === "select-options" && field.selectOptionsType) {
      refs.push({
        name: field.name,
        dataField: field.dataField === true,
        targetType: field.selectOptionsType,
        self: field.selectOptionsType === type,
      });
    } else if (field.inputType === "select-self") {
      refs.push({
        name: field.name,
        dataField: field.dataField === true,
        targetType: type,
        self: true,
      });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Order rows the way the list screen shows them: hierarchical types put
 * children under their parent, everything else keeps the storage ordering
 * (name or sequence, per the type's metadata).
 */
function orderForDisplay(type: OptionsTypeName, rows: any[]): any[] {
  const metadata = optionsMetadata[type];
  if (!metadata.supportsParent) return rows;

  const useSequence = metadata.supportsSequencing === true;
  const childrenMap = new Map<string | null, any[]>();
  for (const row of rows) {
    const parentKey = row.parent || null;
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(row);
  }
  for (const children of Array.from(childrenMap.values())) {
    if (useSequence) children.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    else children.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  }

  const ordered: any[] = [];
  const seen = new Set<string>();
  const addWithChildren = (row: any) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    ordered.push(row);
    for (const child of childrenMap.get(row.id) || []) addWithChildren(child);
  };
  for (const row of childrenMap.get(null) || []) addWithChildren(row);
  // Orphans (parent points at a row we didn't load) still have to appear.
  for (const row of rows) if (!seen.has(row.id)) { seen.add(row.id); ordered.push(row); }
  return ordered;
}

function toReference(value: unknown, targetRows: any[]): OptionsRecordReference | null {
  if (value === null || value === undefined || value === "") return null;
  const id = String(value);
  const target = targetRows.find((row) => row.id === id);
  if (!target) {
    // Dangling reference — keep the raw id so the file still round-trips.
    return { id, siriusId: null, name: null };
  }
  return {
    id: target.id,
    siriusId: "siriusId" in target ? (target.siriusId ?? null) : null,
    name: target.name ?? null,
  };
}

function toReferenceValue(value: unknown, targetRows: any[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toReference(entry, targetRows));
  }
  return toReference(value, targetRows);
}

export async function buildOptionsExport(
  type: OptionsTypeName,
): Promise<OptionsExportEnvelope> {
  const storage = getOptionsStorage();
  const metadata = optionsMetadata[type];
  const disabled = await getDisabledOptionFieldNames(type);
  const refs = referenceFields(type).filter((ref) => !disabled.has(ref.name));
  const columns = writableColumns(type).filter((name) => !disabled.has(name));

  const rows = orderForDisplay(type, await storage.list(type));

  const targetRows = new Map<OptionsTypeName, any[]>();
  for (const ref of refs) {
    if (!targetRows.has(ref.targetType)) {
      targetRows.set(ref.targetType, ref.targetType === type ? rows : await storage.list(ref.targetType));
    }
  }

  const records: OptionsExportRecord[] = rows.map((row) => {
    const record: OptionsExportRecord = { id: row.id };
    for (const column of columns) {
      if (!(column in row)) continue;
      const ref = refs.find((r) => r.name === column && !r.dataField);
      record[column] = ref
        ? toReferenceValue(row[column], targetRows.get(ref.targetType)!)
        : row[column];
    }
    if (hasDataColumn(type) && "data" in row) {
      const raw = row.data;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        // Verbatim, minus component-gated keys: undeclared keys (e.g. a
        // dispatch job type's bullpen settings) must survive a round trip.
        const data: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (disabled.has(key)) continue;
          const ref = refs.find((r) => r.name === key && r.dataField);
          data[key] = ref ? toReferenceValue(value, targetRows.get(ref.targetType)!) : value;
        }
        record.data = data;
      } else {
        record.data = raw ?? null;
      }
    }
    return record;
  });

  return {
    optionsType: type,
    displayName: metadata.displayName,
    exportedAt: new Date().toISOString(),
    records,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() === new Date(b as any).getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, i) => deepEqual(entry, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as any)[key], (b as any)[key]),
    );
  }
  return false;
}

/** Index of existing rows for id → sirius id → name matching. */
class RecordIndex {
  private byId = new Map<string, any>();
  private bySirius = new Map<string, any[]>();
  private byName = new Map<string, any[]>();

  constructor(rows: any[], private readonly useSirius: boolean) {
    for (const row of rows) {
      this.byId.set(row.id, row);
      const sirius = this.useSirius ? normalizeKey(row.siriusId) : null;
      if (sirius) {
        if (!this.bySirius.has(sirius)) this.bySirius.set(sirius, []);
        this.bySirius.get(sirius)!.push(row);
      }
      const name = normalizeKey(row.name);
      if (name) {
        if (!this.byName.has(name)) this.byName.set(name, []);
        this.byName.get(name)!.push(row);
      }
    }
  }

  /**
   * Match with the fixed precedence id → sirius_id → name.
   * `ambiguous` means the key matched more than one existing record.
   */
  match(ref: OptionsRecordReference): { row: any | null; ambiguous: string | null } {
    if (typeof ref.id === "string" && ref.id.trim() !== "") {
      const row = this.byId.get(ref.id.trim());
      if (row) return { row, ambiguous: null };
    }
    const sirius = this.useSirius ? normalizeKey(ref.siriusId) : null;
    if (sirius) {
      const rows = this.bySirius.get(sirius) || [];
      if (rows.length > 1) return { row: null, ambiguous: `Sirius ID "${ref.siriusId}"` };
      if (rows.length === 1) return { row: rows[0], ambiguous: null };
    }
    const name = normalizeKey(ref.name);
    if (name) {
      const rows = this.byName.get(name) || [];
      if (rows.length > 1) return { row: null, ambiguous: `name "${ref.name}"` };
      if (rows.length === 1) return { row: rows[0], ambiguous: null };
    }
    return { row: null, ambiguous: null };
  }
}

/** A raw JSON value coerced into the reference shape. */
function asReference(value: unknown): OptionsRecordReference | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // A bare string may be an id, a sirius id or a name — try all three.
    return { id: trimmed, siriusId: trimmed, name: trimmed };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const ref = value as Record<string, unknown>;
    return {
      id: typeof ref.id === "string" ? ref.id : null,
      siriusId: typeof ref.siriusId === "string" ? ref.siriusId : null,
      name: typeof ref.name === "string" ? ref.name : null,
    };
  }
  return null;
}

function describeReference(ref: OptionsRecordReference): string {
  return ref.name || ref.siriusId || ref.id || "(empty)";
}

/** One record from the pasted file, as the planner works on it. */
interface PlannedRecord {
  position: number;
  name: string;
  existing: any | null;
  errors: string[];
  /** Resolved payload for create / update (top-level columns, plus `data`). */
  payload: Record<string, any>;
  /**
   * Self-reference fields pointing at a record created by this same import;
   * resolved into real ids during the reference-fixup step of the apply.
   */
  pendingSelf: Record<string, number>;
  action: OptionsImportPlanItem["action"];
  changes: OptionsImportPlanItem["changes"];
  note?: string;
}

interface ImportInput {
  type: OptionsTypeName;
  config: OptionsTypeConfig;
  text: string;
  options: OptionsImportOptions;
  dryRun: boolean;
}

function emptyResult(
  type: OptionsTypeName,
  dryRun: boolean,
  errors: OptionsImportProblem[],
): OptionsImportResult {
  return {
    optionsType: type,
    dryRun,
    applied: false,
    items: [],
    errors,
    summary: summarizeOptionsImport([]),
  };
}

/**
 * Plan (and, unless `dryRun`, apply) an import. Nothing is written when the
 * plan has any error, and a write that fails mid-way rolls everything back.
 */
export async function runOptionsImport({
  type,
  config,
  text,
  options,
  dryRun,
}: ImportInput): Promise<OptionsImportResult> {
  const metadata = optionsMetadata[type];
  const storage = getOptionsStorage();

  // --- envelope ------------------------------------------------------------
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: any) {
    return emptyResult(type, dryRun, [
      { position: null, name: null, message: `The pasted text is not valid JSON: ${error?.message ?? "parse error"}` },
    ]);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyResult(type, dryRun, [
      { position: null, name: null, message: "Expected a JSON object with an \"optionsType\" and a \"records\" array." },
    ]);
  }

  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.optionsType !== "string" || envelope.optionsType !== type) {
    return emptyResult(type, dryRun, [
      {
        position: null,
        name: null,
        message: `This file is for options type "${envelope.optionsType ?? "(missing)"}", but you are importing into "${type}".`,
      },
    ]);
  }
  if (!Array.isArray(envelope.records)) {
    return emptyResult(type, dryRun, [
      { position: null, name: null, message: "The file has no \"records\" array." },
    ]);
  }

  // --- context -------------------------------------------------------------
  const disabled = await getDisabledOptionFieldNames(type);
  const refs = referenceFields(type).filter((ref) => !disabled.has(ref.name));
  const columns = writableColumns(type).filter((name) => !disabled.has(name));
  const useSirius = hasSiriusIdColumn(type);
  const supportsData = hasDataColumn(type);

  const existingRows = orderForDisplay(type, await storage.list(type));
  const existingIndex = new RecordIndex(existingRows, useSirius);

  const targetIndexes = new Map<OptionsTypeName, RecordIndex>();
  for (const ref of refs) {
    if (targetIndexes.has(ref.targetType)) continue;
    const rows = ref.targetType === type ? existingRows : await storage.list(ref.targetType);
    targetIndexes.set(ref.targetType, new RecordIndex(rows, hasSiriusIdColumn(ref.targetType)));
  }

  const errors: OptionsImportProblem[] = [];
  const records = envelope.records as unknown[];
  const planned: PlannedRecord[] = [];

  // --- duplicate detection inside the file --------------------------------
  const seenNames = new Map<string, number>();
  const seenSirius = new Map<string, number>();
  records.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const record = raw as Record<string, unknown>;
    const name = normalizeKey(record.name);
    if (name) {
      const first = seenNames.get(name);
      if (first !== undefined) {
        errors.push({
          position: i + 1,
          name: String(record.name),
          message: `Two records in the file share the name "${String(record.name).trim()}" (records ${first} and ${i + 1}).`,
        });
      } else {
        seenNames.set(name, i + 1);
      }
    }
    if (useSirius) {
      const sirius = normalizeKey(record.siriusId);
      if (sirius) {
        const first = seenSirius.get(sirius);
        if (first !== undefined) {
          errors.push({
            position: i + 1,
            name: typeof record.name === "string" ? record.name : null,
            message: `Two records in the file share the Sirius ID "${String(record.siriusId).trim()}" (records ${first} and ${i + 1}).`,
          });
        } else {
          seenSirius.set(sirius, i + 1);
        }
      }
    }
  });

  // --- per-record planning -------------------------------------------------
  const matchedExistingIds = new Map<string, number>();
  /** Records in the file, keyed for self-reference resolution. */
  const fileIndexById = new Map<string, number>();
  const fileIndexBySirius = new Map<string, number>();
  const fileIndexByName = new Map<string, number>();
  records.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const record = raw as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.trim() !== "") {
      fileIndexById.set(record.id.trim(), i + 1);
    }
    const sirius = useSirius ? normalizeKey(record.siriusId) : null;
    if (sirius && !fileIndexBySirius.has(sirius)) fileIndexBySirius.set(sirius, i + 1);
    const name = normalizeKey(record.name);
    if (name && !fileIndexByName.has(name)) fileIndexByName.set(name, i + 1);
  });

  for (let i = 0; i < records.length; i += 1) {
    const position = i + 1;
    const raw = records[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({ position, name: null, message: "Record is not a JSON object." });
      continue;
    }
    const record = raw as Record<string, unknown>;
    const displayName = typeof record.name === "string" ? record.name.trim() : "";

    const item: PlannedRecord = {
      position,
      name: displayName || `(record ${position})`,
      existing: null,
      errors: [],
      payload: {},
      pendingSelf: {},
      action: "unchanged",
      changes: [],
    };

    // Match against an existing record: id -> sirius_id -> name.
    const match = existingIndex.match({
      id: typeof record.id === "string" ? record.id : null,
      siriusId: typeof record.siriusId === "string" ? record.siriusId : null,
      name: typeof record.name === "string" ? record.name : null,
    });
    if (match.ambiguous) {
      item.errors.push(`Matches more than one existing record by ${match.ambiguous}.`);
    }
    if (match.row) {
      const firstPosition = matchedExistingIds.get(match.row.id);
      if (firstPosition !== undefined) {
        item.errors.push(
          `Matches the same existing record ("${match.row.name}") as record ${firstPosition}.`,
        );
      } else {
        matchedExistingIds.set(match.row.id, position);
        item.existing = match.row;
      }
    }

    // Resolve a reference value (single or array) to id(s).
    const resolveReferenceValue = (ref: ReferenceField, value: unknown): unknown => {
      const resolveOne = (entry: unknown): string | null => {
        const reference = asReference(entry);
        if (!reference) return null;
        const index = targetIndexes.get(ref.targetType)!;
        const found = index.match(reference);
        if (found.ambiguous) {
          item.errors.push(`${ref.name}: reference matches more than one record by ${found.ambiguous}.`);
          return null;
        }
        if (found.row) return found.row.id;
        if (ref.self) {
          // May point at a record this import is about to create.
          const key =
            (typeof reference.id === "string" && fileIndexById.get(reference.id.trim())) ||
            (useSirius && normalizeKey(reference.siriusId)
              ? fileIndexBySirius.get(normalizeKey(reference.siriusId)!)
              : undefined) ||
            (normalizeKey(reference.name)
              ? fileIndexByName.get(normalizeKey(reference.name)!)
              : undefined);
          if (key !== undefined && key !== position) {
            item.pendingSelf[ref.name] = key;
            return null;
          }
          if (key === position) {
            item.errors.push(`${ref.name}: a record cannot reference itself.`);
            return null;
          }
        }
        item.errors.push(
          `${ref.name}: no ${optionsMetadata[ref.targetType].singularName} matches ${describeReference(reference)}.`,
        );
        return null;
      };

      if (Array.isArray(value)) {
        return value.map(resolveOne).filter((id): id is string => id !== null);
      }
      return resolveOne(value);
    };

    // Top-level columns. Absent keys are left unchanged; component-gated
    // fields are ignored entirely.
    const body: Record<string, any> = {};
    for (const column of columns) {
      if (!(column in record)) continue;
      const ref = refs.find((r) => r.name === column && !r.dataField);
      body[column] = ref ? resolveReferenceValue(ref, record[column]) : record[column];
      if (ref && item.pendingSelf[column] !== undefined) {
        // Resolved later; don't try to write a null over the current value.
        delete body[column];
      }
    }

    // Sequencing: an explicit value wins; otherwise the file's order decides.
    if (metadata.supportsSequencing && columns.includes("sequence")) {
      if (!("sequence" in record)) {
        body.sequence = position;
      } else if (record.sequence !== null && record.sequence !== undefined) {
        const value = record.sequence;
        if (typeof value !== "number" || !Number.isInteger(value)) {
          item.errors.push("sequence must be a whole number.");
        }
      }
    }

    // JSONB `data`: merged key by key so undeclared and component-gated keys
    // survive an import that doesn't mention them.
    if (supportsData && "data" in record) {
      const incoming = record.data;
      if (incoming !== null && typeof incoming === "object" && !Array.isArray(incoming)) {
        const base: Record<string, unknown> =
          item.existing?.data && typeof item.existing.data === "object" && !Array.isArray(item.existing.data)
            ? { ...(item.existing.data as Record<string, unknown>) }
            : {};
        for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
          if (disabled.has(key)) continue;
          const ref = refs.find((r) => r.name === key && r.dataField);
          base[key] = ref ? resolveReferenceValue(ref, value) : value;
        }
        body.data = base;
      } else if (incoming === null) {
        body.data = null;
      } else {
        item.errors.push("data must be a JSON object.");
      }
    }

    // --- classify ----------------------------------------------------------
    if (!item.existing) {
      const built = buildOptionCreateData(config, body);
      if ("error" in built) {
        item.errors.push(built.error);
      } else {
        const validationError = await validateOptionTypeSpecificData(type, built.data.data);
        if (validationError) {
          item.errors.push(validationError);
        }
        item.payload = built.data;
        item.changes = Object.entries(built.data).map(([field, to]) => ({ field, from: null, to }));
        for (const [field, target] of Object.entries(item.pendingSelf)) {
          item.changes.push({ field, from: null, to: `→ record ${target}` });
        }
      }
      item.action = options.create ? "create" : "skipped";
      if (!options.create) item.note = "Creating new records is switched off.";
    } else {
      const built = buildOptionUpdateData(config, body);
      if ("error" in built) {
        item.errors.push(built.error);
      } else {
        const updates = built.updates;
        if (updates.data !== undefined) {
          const validationError = await validateOptionTypeSpecificData(type, updates.data);
          if (validationError) item.errors.push(validationError);
        }
        const changes: OptionsImportPlanItem["changes"] = [];
        for (const [field, to] of Object.entries(updates)) {
          const from = item.existing[field] ?? null;
          if (!deepEqual(from ?? null, to ?? null)) {
            changes.push({ field, from, to });
          } else {
            delete updates[field];
          }
        }
        for (const [field, target] of Object.entries(item.pendingSelf)) {
          changes.push({ field, from: item.existing[field] ?? null, to: `→ record ${target}` });
        }
        item.payload = updates;
        item.changes = changes;
        if (changes.length === 0) {
          item.action = "unchanged";
        } else if (options.update) {
          item.action = "update";
        } else {
          item.action = "skipped";
          item.note = "Updating matched records is switched off.";
        }
      }
    }

    planned.push(item);
  }

  // --- deletes -------------------------------------------------------------
  const deletions: PlannedRecord[] = [];
  if (options.delete) {
    for (const row of existingRows) {
      if (matchedExistingIds.has(row.id)) continue;
      const item: PlannedRecord = {
        position: 0,
        name: row.name ?? row.id,
        existing: row,
        errors: [],
        payload: {},
        pendingSelf: {},
        action: "delete",
        changes: [],
      };
      const blocked = await checkOptionDeleteGuard(type, row.id);
      if (blocked) {
        item.errors.push(blocked.message);
      }
      deletions.push(item);
    }
  }

  // --- parent cycles -------------------------------------------------------
  if (metadata.supportsParent) {
    const parentOf = new Map<string, string | null>();
    const label = new Map<string, string>();
    const deletedIds = new Set(deletions.map((d) => d.existing.id));

    for (const row of existingRows) {
      if (deletedIds.has(row.id)) continue;
      parentOf.set(row.id, row.parent ?? null);
      label.set(row.id, row.name ?? row.id);
    }
    for (const item of planned) {
      const key = item.existing ? item.existing.id : `new:${item.position}`;
      label.set(key, item.name);
      const pending = item.pendingSelf.parent;
      if (pending !== undefined) {
        parentOf.set(key, `new:${pending}`);
      } else if ("parent" in item.payload) {
        parentOf.set(key, item.payload.parent ?? null);
      } else if (item.existing) {
        parentOf.set(key, item.existing.parent ?? null);
      } else {
        parentOf.set(key, null);
      }
    }
    // A "new:<position>" key is only valid if that record is really a create.
    const createKeys = new Set(
      planned.filter((p) => !p.existing).map((p) => `new:${p.position}`),
    );
    for (const item of planned) {
      const key = item.existing ? item.existing.id : `new:${item.position}`;
      const seen = new Set<string>([key]);
      let current = parentOf.get(key) ?? null;
      while (current) {
        if (!parentOf.has(current) && !createKeys.has(current)) break;
        if (seen.has(current)) {
          item.errors.push(
            `Parent chain forms a cycle (via "${label.get(current) ?? current}").`,
          );
          break;
        }
        seen.add(current);
        current = parentOf.get(current) ?? null;
      }
    }
  }

  // --- collect ------------------------------------------------------------
  const items: OptionsImportPlanItem[] = [];
  for (const entry of [...planned, ...deletions]) {
    for (const message of entry.errors) {
      errors.push({
        position: entry.position || null,
        name: entry.name,
        message,
      });
    }
    items.push({
      position: entry.position || null,
      name: entry.name,
      action: entry.action,
      existingId: entry.existing?.id ?? null,
      changes: entry.changes,
      note: entry.note,
    });
  }

  const result: OptionsImportResult = {
    optionsType: type,
    dryRun,
    applied: false,
    items,
    errors,
    summary: summarizeOptionsImport(items),
  };

  if (dryRun || errors.length > 0) {
    return result;
  }

  if (!optionsImportHasWrites(items)) {
    // Nothing to do — an unedited export pasted straight back.
    result.applied = true;
    return result;
  }

  // --- apply ---------------------------------------------------------------
  const creates = planned.filter((p) => p.action === "create");
  const updates = planned.filter((p) => p.action === "update");

  try {
    await runInTransaction(async () => {
      const createdIds = new Map<number, string>();

      for (const item of creates) {
        const row = await config.create(item.payload);
        createdIds.set(item.position, row.id);
      }

      for (const item of updates) {
        const payload = { ...item.payload };
        for (const [field, target] of Object.entries(item.pendingSelf)) {
          payload[field] = createdIds.get(target) ?? null;
        }
        if (Object.keys(payload).length > 0) {
          await config.update(item.existing.id, payload);
        }
      }

      // Reference fixup: self references that pointed at records this import
      // created can only be written once those records have ids.
      for (const item of creates) {
        const fixes: Record<string, any> = {};
        for (const [field, target] of Object.entries(item.pendingSelf)) {
          fixes[field] = createdIds.get(target) ?? null;
        }
        if (Object.keys(fixes).length > 0) {
          await config.update(createdIds.get(item.position)!, fixes);
        }
      }

      for (const item of deletions) {
        await config.delete(item.existing.id);
      }
    });
  } catch (error: any) {
    // A failed statement poisons the surrounding transaction, so the whole
    // import is rolled back rather than reported as a partial success.
    const mapped = optionDbErrorMessage(error);
    logger.error("Options import failed", {
      service: "options-transfer",
      type,
      error: error?.message,
      code: error?.code,
    });
    result.errors.push({
      position: null,
      name: null,
      message: `Import failed and nothing was written: ${mapped?.message ?? error?.message ?? "unknown error"}`,
    });
    return result;
  }

  result.applied = true;
  return result;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function readImportOptions(body: any): OptionsImportOptions {
  const raw = body?.options ?? {};
  return {
    create: raw.create !== false,
    update: raw.update !== false,
    delete: raw.delete === true,
  };
}

/**
 * Registered BEFORE `/api/options/:type/:id` so `export` and `import/...`
 * are not swallowed as record ids.
 */
export function registerOptionsTransferRoutes(app: Express, componentGate: RequestHandler) {
  app.get(
    "/api/options/:type/export",
    requireAccess("admin"),
    componentGate,
    async (req: Request, res: Response) => {
      try {
        const { type } = req.params;
        if (!getOptionsType(type)) {
          return res.status(404).json({ message: `Unknown options type: ${type}` });
        }
        res.json(await buildOptionsExport(type as OptionsTypeName));
      } catch (error: any) {
        logger.error("Failed to export options", {
          service: "options-transfer",
          type: req.params.type,
          error: error?.message,
        });
        res.status(500).json({ message: "Failed to export options" });
      }
    },
  );

  const handleImport = (dryRun: boolean) =>
    async (req: Request, res: Response) => {
      try {
        const { type } = req.params;
        const config = getOptionsType(type);
        if (!config) {
          return res.status(404).json({ message: `Unknown options type: ${type}` });
        }
        const text = typeof req.body?.text === "string" ? req.body.text : "";
        if (text.trim() === "") {
          return res.status(400).json({ message: "Paste the JSON to import first." });
        }
        const result = await runOptionsImport({
          type: type as OptionsTypeName,
          config,
          text,
          options: readImportOptions(req.body),
          dryRun,
        });
        res.json(result);
      } catch (error: any) {
        logger.error("Failed to run options import", {
          service: "options-transfer",
          type: req.params.type,
          dryRun,
          error: error?.message,
        });
        res.status(500).json({ message: `Failed to ${dryRun ? "preview" : "apply"} the import` });
      }
    };

  app.post(
    "/api/options/:type/import/preview",
    requireAccess("admin"),
    componentGate,
    handleImport(true),
  );

  app.post(
    "/api/options/:type/import/apply",
    requireAccess("admin"),
    componentGate,
    handleImport(false),
  );
}
