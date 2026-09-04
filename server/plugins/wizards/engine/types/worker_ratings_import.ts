import {
  FeedWizard,
  filterEmptyColumns,
  normalizeColumnMapping,
  validateMappingDuplicates,
  type FeedConfig,
  type FeedData,
  type FeedField,
  type ProcessError,
  type ProcessResults,
  type RowResult,
  type ValidationError,
  type ValidationResults,
} from '../feed.js';
import {
  createStandardStatuses,
  type LaunchArgument,
  type WizardStatus,
  type WizardStep,
} from '../base.js';
import { storage } from '../../../../storage/index.js';
import { createUnifiedOptionsStorage } from '../../../../storage/unified-options.js';
import { fileSystemService } from '../../../../services/files/index.js';
import { parse as parseCSV } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

/**
 * Worker ratings import (long format: one row per worker + rating type +
 * value).
 *
 * The inherited `FeedWizard` processing path creates and updates workers by
 * SSN, which is not what this wizard does at all, so both the validate pass
 * and the process pass are supplied here. They share ONE resolution routine
 * (`resolveRows`), so validation reports exactly the rows processing will
 * skip.
 *
 * Writes go through `storage.workerRatings.upsert` — the same single-record
 * path the worker's Ratings tab uses — one call per row, so every change is
 * individually audit-logged and attributed to the user running the wizard.
 */

/** Largest rating value the ratings API accepts (`z.number().min(0).max(4)`). */
const MAX_RATING_VALUE = 4;

/** Safety cap on how many per-row errors are persisted onto `wizard.data`. */
const MAX_STORED_ERRORS = 2000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How the file's single identifier column names a worker. Chosen once in the
 * configure step and stored as `workerIdentifierKind` on `wizard.data`:
 * `ssn`, `uuid`, `sirius`, or `id-type:<optionsWorkerIdType id>`.
 */
export type WorkerIdentifierKind =
  | { kind: 'ssn' }
  | { kind: 'uuid' }
  | { kind: 'sirius' }
  | { kind: 'idType'; typeId: string };

export const WORKER_ID_TYPE_PREFIX = 'id-type:';

export function parseWorkerIdentifierKind(
  raw: unknown,
): WorkerIdentifierKind | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === 'ssn' || value === 'uuid' || value === 'sirius') {
    return { kind: value };
  }
  if (value.startsWith(WORKER_ID_TYPE_PREFIX)) {
    const typeId = value.slice(WORKER_ID_TYPE_PREFIX.length).trim();
    return typeId ? { kind: 'idType', typeId } : null;
  }
  return null;
}

interface RowIssue {
  field: string;
  message: string;
  value?: unknown;
}

interface ResolvedRow {
  /** 0-based index among the file's DATA rows (headers excluded). */
  rowIndex: number;
  raw: Record<string, unknown>;
  issues: RowIssue[];
  workerId?: string;
  ratingId?: string;
  ratingLabel?: string;
  /** `null` means "clear this worker's rating for this type". */
  value?: number | null;
}

interface ResolutionRun {
  wizardData: Record<string, unknown>;
  rows: ResolvedRow[];
}

type Resolution<T> = { ok: true; value: T } | { ok: false; message: string };

export interface WorkerRatingsImportResults extends ProcessResults {
  ratingsSet: number;
  ratingsCleared: number;
  ratingsUnchanged: number;
  ratingsSkipped: number;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * A rating cell is either blank ("clear this rating") or a whole number in
 * `0..MAX_RATING_VALUE`, matching what the ratings API already enforces.
 * Spreadsheet cells arrive as numbers, strings, or zero-padded text, so all
 * three shapes are accepted; anything else is a row error.
 */
export function parseRatingValue(raw: unknown): Resolution<number | null> {
  const invalid = {
    ok: false as const,
    message: `Value must be blank or a whole number 0-${MAX_RATING_VALUE}`,
  };

  if (raw === null || raw === undefined) return { ok: true, value: null };

  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_RATING_VALUE) {
      return invalid;
    }
    return { ok: true, value: raw };
  }

  const str = cellToString(raw);
  if (str === '') return { ok: true, value: null };
  // Whole numbers only, but tolerate a spreadsheet's "3.0" and "003".
  if (!/^\d+(\.0+)?$/.test(str)) return invalid;
  const parsed = Number(str);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_RATING_VALUE) {
    return invalid;
  }
  return { ok: true, value: parsed };
}

/** Rating types indexed by Sirius ID and by name, both matched case-insensitively. */
interface RatingTypeIndex {
  bySiriusId: Map<string, string[]>;
  byName: Map<string, string[]>;
  labels: Map<string, string>;
}

async function buildRatingTypeIndex(): Promise<RatingTypeIndex> {
  const options = createUnifiedOptionsStorage();
  const types = await options.list('worker-rating');
  const index: RatingTypeIndex = {
    bySiriusId: new Map(),
    byName: new Map(),
    labels: new Map(),
  };
  for (const type of types) {
    const id = String(type.id);
    const name = cellToString(type.name);
    const siriusId = cellToString(type.siriusId);
    index.labels.set(id, name || siriusId || id);
    if (siriusId) {
      const key = siriusId.toLowerCase();
      index.bySiriusId.set(key, [...(index.bySiriusId.get(key) ?? []), id]);
    }
    if (name) {
      const key = name.toLowerCase();
      index.byName.set(key, [...(index.byName.get(key) ?? []), id]);
    }
  }
  return index;
}

/** Sirius ID first, then name — names are not unique, so a tie is an error. */
function resolveRatingType(
  index: RatingTypeIndex,
  raw: unknown,
): Resolution<string> {
  const cell = cellToString(raw);
  if (cell === '') {
    return { ok: false, message: 'Rating type is required' };
  }
  const key = cell.toLowerCase();

  const bySirius = index.bySiriusId.get(key);
  if (bySirius && bySirius.length === 1) {
    return { ok: true, value: bySirius[0] };
  }
  if (bySirius && bySirius.length > 1) {
    return {
      ok: false,
      message: `Rating type Sirius ID "${cell}" matches ${bySirius.length} rating types`,
    };
  }

  const byName = index.byName.get(key);
  if (byName && byName.length === 1) {
    return { ok: true, value: byName[0] };
  }
  if (byName && byName.length > 1) {
    return {
      ok: false,
      message: `Rating type name "${cell}" matches ${byName.length} rating types; use its Sirius ID instead`,
    };
  }

  return {
    ok: false,
    message: `Rating type "${cell}" was not found (matched on Sirius ID, then name)`,
  };
}

async function resolveWorker(
  identifier: WorkerIdentifierKind,
  raw: unknown,
): Promise<Resolution<string>> {
  const cell = cellToString(raw);
  if (cell === '') {
    return { ok: false, message: 'Worker identifier is required' };
  }

  switch (identifier.kind) {
    case 'uuid': {
      if (!UUID_RE.test(cell)) {
        return { ok: false, message: `"${cell}" is not a valid worker UUID` };
      }
      const worker = await storage.workers.getWorker(cell);
      if (!worker) {
        return { ok: false, message: `No worker has UUID "${cell}"` };
      }
      return { ok: true, value: worker.id };
    }
    case 'ssn': {
      const worker = await storage.workers.getWorkerBySSN(cell);
      if (!worker) {
        return { ok: false, message: `No worker has SSN "${cell}"` };
      }
      return { ok: true, value: worker.id };
    }
    case 'sirius': {
      if (!/^\d+$/.test(cell)) {
        return { ok: false, message: `Sirius ID "${cell}" is not a number` };
      }
      const found = await storage.workers.searchWorkers(cell, 2);
      const matches = found.workers ?? [];
      if (matches.length === 0) {
        return { ok: false, message: `No worker has Sirius ID "${cell}"` };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          message: `Sirius ID "${cell}" matches ${matches.length} workers`,
        };
      }
      return { ok: true, value: matches[0].id };
    }
    case 'idType': {
      const rows =
        await storage.workerIds.getWorkerIdsByTypeAndValueWithOptionalPrefix(
          identifier.typeId,
          cell,
        );
      // The helper also returns single-letter-prefixed variants; an import
      // must match the value it was given, exactly.
      const exact = rows.filter(
        (row) => cellToString(row.value).toLowerCase() === cell.toLowerCase(),
      );
      const workerIds = Array.from(new Set(exact.map((row) => row.workerId)));
      if (workerIds.length === 0) {
        return { ok: false, message: `No worker has ID "${cell}"` };
      }
      if (workerIds.length > 1) {
        return {
          ok: false,
          message: `ID "${cell}" matches ${workerIds.length} workers`,
        };
      }
      return { ok: true, value: workerIds[0] };
    }
  }
}

export class WorkerRatingsImportWizard extends FeedWizard {
  name = 'worker_ratings_import';
  displayName = 'Worker Ratings Import';
  description =
    'Import worker ratings from a file, one row per worker, rating type and value';
  isFeed = true;
  entityType = undefined;
  requiredComponent = 'worker.ratings';

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload the ratings file' },
      {
        id: 'map',
        name: 'Map Columns',
        description: 'Map file columns to rating fields',
      },
      {
        id: 'configure',
        name: 'Configure',
        description: 'Choose how workers are identified',
      },
      {
        id: 'validate',
        name: 'Validate',
        description: 'Check every row before processing',
      },
      { id: 'process', name: 'Process', description: 'Apply the ratings' },
      { id: 'results', name: 'Results', description: 'Review import results' },
    ];
  }

  getStatuses(): WizardStatus[] {
    return createStandardStatuses();
  }

  getLaunchArguments(): LaunchArgument[] {
    return [];
  }

  getFields(): FeedField[] {
    return [
      {
        id: 'workerIdentifier',
        name: 'Worker Identifier',
        type: 'string',
        required: true,
        description:
          'The column naming the worker. Which kind of identifier it holds is chosen in the Configure step.',
        displayOrder: 1,
      },
      {
        id: 'ratingType',
        name: 'Rating Type',
        type: 'string',
        required: true,
        description:
          'Rating type, matched on its Sirius ID first and then on its name',
        displayOrder: 2,
      },
      {
        id: 'value',
        name: 'Rating Value',
        type: 'string',
        required: true,
        description: `Whole number 0-${MAX_RATING_VALUE}; a blank cell clears the worker's rating for that type`,
        displayOrder: 3,
      },
    ];
  }

  async generateFeed(_config: FeedConfig, _data: unknown): Promise<FeedData> {
    return { recordCount: 0, generatedAt: new Date() };
  }

  /**
   * Read the uploaded file, apply the column mapping, then resolve every row
   * to a worker, a rating type and a value. Used unchanged by BOTH the
   * validate pass (read-only) and the process pass, so the two agree on what
   * is wrong with the file.
   *
   * Rows whose mapped cells are all blank are dropped rather than reported —
   * a spreadsheet's trailing empty rows are not the user's mistake.
   *
   * A file naming the same worker and rating type more than once is applied
   * ONCE: the last such row in the file wins and the earlier ones are skipped
   * with a reason naming the winner. That keeps a re-run of the same file
   * deterministic no matter what order the rows are processed in.
   */
  private async resolveRows(wizardId: string): Promise<ResolutionRun> {
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) {
      throw new Error('Wizard not found');
    }

    const wizardData = ((wizard.data as Record<string, unknown>) ??
      {}) as Record<string, unknown>;
    const fileId = wizardData.uploadedFileId as string | undefined;
    const rawColumnMapping = (wizardData.columnMapping ?? {}) as Record<
      string,
      string
    >;
    const hasHeaders = (wizardData.hasHeaders as boolean | undefined) ?? true;

    if (!fileId) {
      throw new Error('No uploaded file found');
    }
    validateMappingDuplicates(rawColumnMapping);
    const columnMapping = normalizeColumnMapping(rawColumnMapping);

    const identifier = parseWorkerIdentifierKind(
      wizardData.workerIdentifierKind,
    );
    if (!identifier) {
      throw new Error(
        'No worker identifier kind selected. Complete the Configure step first.',
      );
    }

    const file = await storage.files.getById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const buffer = await fileSystemService.download(
      file.fileSystemId,
      file.storagePath,
    );

    let rawRows: any[] = [];
    if (file.mimeType === 'text/csv') {
      rawRows = parseCSV(buffer, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
      });
    } else if (
      file.mimeType?.includes('spreadsheet') ||
      file.mimeType?.includes('excel')
    ) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json(firstSheet, {
        header: 1,
        defval: '',
        blankrows: false,
      });
    } else {
      throw new Error('Unsupported file type');
    }

    rawRows = filterEmptyColumns(rawRows);
    const dataRows = hasHeaders ? rawRows.slice(1) : rawRows;

    const ratingTypes = await buildRatingTypeIndex();
    const workerCache = new Map<string, Resolution<string>>();
    const rows: ResolvedRow[] = [];

    for (const dataRow of dataRows) {
      const mapped: Record<string, unknown> = {};
      for (const [sourceCol, fieldId] of Object.entries(columnMapping)) {
        if (!fieldId || fieldId === '_unmapped') continue;
        const colIndex = parseInt(sourceCol.replace('col_', ''), 10);
        mapped[fieldId] = Array.isArray(dataRow) ? dataRow[colIndex] : undefined;
      }

      const allBlank = Object.values(mapped).every(
        (cell) => cellToString(cell) === '',
      );
      if (allBlank) continue;

      const resolved: ResolvedRow = {
        rowIndex: rows.length,
        raw: mapped,
        issues: [],
      };

      const identifierCell = cellToString(mapped.workerIdentifier);
      const cacheKey = identifierCell.toLowerCase();
      let worker = workerCache.get(cacheKey);
      if (!worker) {
        worker = await resolveWorker(identifier, mapped.workerIdentifier);
        workerCache.set(cacheKey, worker);
      }
      if (worker.ok) {
        resolved.workerId = worker.value;
      } else {
        resolved.issues.push({
          field: 'workerIdentifier',
          message: worker.message,
          value: mapped.workerIdentifier,
        });
      }

      const ratingType = resolveRatingType(ratingTypes, mapped.ratingType);
      if (ratingType.ok) {
        resolved.ratingId = ratingType.value;
        resolved.ratingLabel = ratingTypes.labels.get(ratingType.value);
      } else {
        resolved.issues.push({
          field: 'ratingType',
          message: ratingType.message,
          value: mapped.ratingType,
        });
      }

      const value = parseRatingValue(mapped.value);
      if (value.ok) {
        resolved.value = value.value;
      } else {
        resolved.issues.push({
          field: 'value',
          message: value.message,
          value: mapped.value,
        });
      }

      rows.push(resolved);
    }

    // Same worker + rating type more than once: the LAST row wins.
    const lastByPair = new Map<string, ResolvedRow>();
    for (const row of rows) {
      if (row.issues.length > 0 || !row.workerId || !row.ratingId) continue;
      lastByPair.set(`${row.workerId}|${row.ratingId}`, row);
    }
    for (const row of rows) {
      if (row.issues.length > 0 || !row.workerId || !row.ratingId) continue;
      const winner = lastByPair.get(`${row.workerId}|${row.ratingId}`);
      if (winner && winner !== row) {
        row.issues.push({
          field: 'workerIdentifier',
          message: `Duplicate of row ${winner.rowIndex + 1}, which names the same worker and rating type; the last row in the file is the one applied`,
          value: row.raw.workerIdentifier,
        });
      }
    }

    return { wizardData, rows };
  }

  /**
   * Read-only pass: resolve every row and report each problem by row number.
   * It never blocks processing — the plugin's validate step completes as long
   * as at least one row is applicable, and the invalid rows are simply skipped.
   */
  async validateFeedData(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: {
      processed: number;
      total: number;
      validRows: number;
      invalidRows: number;
    }) => void,
  ): Promise<ValidationResults> {
    const { wizardData, rows } = await this.resolveRows(wizardId);

    const errors: ValidationError[] = [];
    const errorSummary: Record<string, number> = {};
    let validRows = 0;
    let invalidRows = 0;

    for (const row of rows) {
      if (row.issues.length === 0) {
        validRows++;
      } else {
        invalidRows++;
        for (const issue of row.issues) {
          const key = `${issue.field}: ${issue.message}`;
          errorSummary[key] = (errorSummary[key] || 0) + 1;
          if (errors.length < MAX_STORED_ERRORS) {
            errors.push({
              rowIndex: row.rowIndex,
              field: issue.field,
              message: issue.message,
              value: issue.value,
            });
          }
        }
      }
      if (onProgress && (row.rowIndex + 1) % batchSize === 0) {
        onProgress({
          processed: row.rowIndex + 1,
          total: rows.length,
          validRows,
          invalidRows,
        });
      }
    }

    if (onProgress) {
      onProgress({
        processed: rows.length,
        total: rows.length,
        validRows,
        invalidRows,
      });
    }

    const results: ValidationResults = {
      totalRows: rows.length,
      validRows,
      invalidRows,
      errors,
      errorSummary,
      completedAt: new Date(),
    };

    await storage.wizards.update(wizardId, {
      data: { ...wizardData, validationResults: results },
    });

    return results;
  }

  /**
   * Apply each valid row as its own write through
   * `storage.workerRatings.upsert` — the single-record path behind the
   * worker's Ratings tab — so each change carries its own audit-log entry.
   * A row that already holds the value it names is left alone (re-running the
   * same file is a no-op), and one failing row never aborts the run.
   */
  async processFeedData(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: {
      processed: number;
      total: number;
      createdCount: number;
      updatedCount: number;
      successCount: number;
      failureCount: number;
      currentRow?: {
        index: number;
        status: 'success' | 'error';
        error?: string;
      };
    }) => void,
  ): Promise<WorkerRatingsImportResults> {
    const { wizardData, rows } = await this.resolveRows(wizardId);

    let ratingsSet = 0;
    let ratingsCleared = 0;
    let ratingsUnchanged = 0;
    let ratingsSkipped = 0;
    const errors: ProcessError[] = [];
    const rowResults: RowResult[] = [];

    const report = (
      processed: number,
      currentRow?: {
        index: number;
        status: 'success' | 'error';
        error?: string;
      },
    ) => {
      if (!onProgress) return;
      onProgress({
        processed,
        total: rows.length,
        createdCount: ratingsSet,
        updatedCount: ratingsCleared,
        successCount: ratingsSet + ratingsCleared + ratingsUnchanged,
        failureCount: ratingsSkipped,
        currentRow,
      });
    };

    for (const row of rows) {
      const skip = (message: string) => {
        ratingsSkipped++;
        errors.push({
          rowIndex: row.rowIndex,
          message,
          data: row.raw as Record<string, unknown>,
        });
        rowResults.push({
          rowIndex: row.rowIndex,
          status: 'error',
          message,
        });
      };

      if (row.issues.length > 0) {
        skip(row.issues.map((issue) => issue.message).join('; '));
      } else if (!row.workerId || !row.ratingId) {
        skip('Row could not be resolved to a worker and rating type');
      } else {
        const ratingLabel = row.ratingLabel ?? row.ratingId;
        const value = row.value ?? null;
        try {
          const existing = await storage.workerRatings.getByWorkerAndRating(
            row.workerId,
            row.ratingId,
          );
          const current = existing?.value ?? null;
          if (current === value) {
            ratingsUnchanged++;
            rowResults.push({
              rowIndex: row.rowIndex,
              status: 'success',
              message:
                value === null
                  ? `No "${ratingLabel}" rating to clear`
                  : `"${ratingLabel}" already set to ${value}`,
            });
          } else {
            await storage.workerRatings.upsert(
              row.workerId,
              row.ratingId,
              value,
            );
            if (value === null) {
              ratingsCleared++;
              rowResults.push({
                rowIndex: row.rowIndex,
                status: 'success',
                message: `Cleared "${ratingLabel}"`,
              });
            } else {
              ratingsSet++;
              rowResults.push({
                rowIndex: row.rowIndex,
                status: 'success',
                message: `Set "${ratingLabel}" to ${value}`,
              });
            }
          }
        } catch (error) {
          skip(
            error instanceof Error
              ? error.message
              : 'Failed to save the rating',
          );
        }
      }

      const last = rowResults[rowResults.length - 1];
      if ((row.rowIndex + 1) % batchSize === 0) {
        report(row.rowIndex + 1, {
          index: row.rowIndex,
          status: last?.status ?? 'success',
          error: last?.status === 'error' ? last.message : undefined,
        });
      }
    }

    report(rows.length);

    const results: WorkerRatingsImportResults = {
      totalRows: rows.length,
      // The shared feed results view labels these "Created" / "Updated"; for
      // this wizard they are the ratings set and the ratings cleared, spelled
      // out under their own labels in the ratings summary below.
      createdCount: ratingsSet,
      updatedCount: ratingsCleared,
      successCount: ratingsSet + ratingsCleared + ratingsUnchanged,
      failureCount: ratingsSkipped,
      errors,
      rowResults,
      completedAt: new Date(),
      ratingsSet,
      ratingsCleared,
      ratingsUnchanged,
      ratingsSkipped,
    };

    await storage.wizards.update(wizardId, {
      data: { ...wizardData, processResults: results },
      status: ratingsSkipped === 0 ? 'completed' : 'completed_with_errors',
    });

    return results;
  }
}

export const workerRatingsImport = new WorkerRatingsImportWizard();
