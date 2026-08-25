/**
 * Shape of the JSON export/import file for a unified-options type, and of the
 * plan the import preview returns. Shared so the server planner and the
 * Export/Import tabs agree on one vocabulary.
 */

/**
 * A pointer to another options record. Carries all three matching keys so a
 * file round-trips exactly inside one deployment (by id) and still lands
 * correctly on another (by sirius id, then name).
 */
export interface OptionsRecordReference {
  id?: string | null;
  siriusId?: string | null;
  name?: string | null;
}

/** One exported record: the type's writable columns plus its JSONB `data`. */
export type OptionsExportRecord = Record<string, unknown>;

export interface OptionsExportEnvelope {
  optionsType: string;
  displayName: string;
  exportedAt: string;
  records: OptionsExportRecord[];
}

/** Which operations the importer is allowed to perform. */
export interface OptionsImportOptions {
  create: boolean;
  update: boolean;
  delete: boolean;
}

export const DEFAULT_OPTIONS_IMPORT_OPTIONS: OptionsImportOptions = {
  create: true,
  update: true,
  delete: false,
};

export type OptionsImportAction =
  | 'create'
  | 'update'
  | 'unchanged'
  | 'delete'
  /** Would have been created/updated/deleted, but that operation is switched off. */
  | 'skipped';

export interface OptionsImportFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface OptionsImportPlanItem {
  /** 1-based position in the pasted file; null for records only in the database. */
  position: number | null;
  name: string;
  action: OptionsImportAction;
  existingId: string | null;
  changes: OptionsImportFieldChange[];
  /** Why an item was skipped (the operation that is switched off). */
  note?: string;
}

export interface OptionsImportProblem {
  /** 1-based position in the pasted file, when the problem belongs to a record. */
  position: number | null;
  name: string | null;
  message: string;
}

export interface OptionsImportSummary {
  create: number;
  update: number;
  unchanged: number;
  delete: number;
  skipped: number;
}

export interface OptionsImportResult {
  optionsType: string;
  /** True when this run only planned; false when it wrote. */
  dryRun: boolean;
  /** True only when the plan was clean AND this was a real (non-dry) run that committed. */
  applied: boolean;
  items: OptionsImportPlanItem[];
  errors: OptionsImportProblem[];
  summary: OptionsImportSummary;
}

export function summarizeOptionsImport(items: OptionsImportPlanItem[]): OptionsImportSummary {
  const summary: OptionsImportSummary = { create: 0, update: 0, unchanged: 0, delete: 0, skipped: 0 };
  for (const item of items) {
    summary[item.action] += 1;
  }
  return summary;
}

/** Does this plan ask for any database write at all? */
export function optionsImportHasWrites(items: OptionsImportPlanItem[]): boolean {
  return items.some(
    (item) => item.action === 'create' || item.action === 'update' || item.action === 'delete',
  );
}
