/**
 * Fetching Freeman's legacy EDLS sheets into the staging table.
 *
 * This stage copies, it does not import. Nothing here writes an EDLS sheet,
 * a crew, or an assignment: rows land in `sitespecific_freeman_edls_migrate`
 * exactly as the legacy system returned them, so what came across can be
 * looked at before anything is made of it.
 *
 * The work is two sweeps because the legacy data is stored that way. A sheet
 * is a node row; everything about it — its status, its date, its facility —
 * lives in a separate per-field table keyed by the node id. So the node sweep
 * establishes WHICH nodes are sheets, and the field sweep collects the field
 * rows belonging to those nodes.
 *
 * Both sweeps read everything before they write anything. The legacy service
 * cannot filter, so "which of these rows are sheets" is decided here, and a
 * refusal halfway through a table would otherwise stage a fraction of it as
 * though it were the whole. Reading first means a refused sweep changes
 * nothing and says so.
 */
import { storage } from "../../../../storage";
import { runInTransaction } from "../../../../storage/transaction-context";
import type { StagedNodeInput } from "../../../../storage/sitespecific/freeman/edls-migrate-staging";
import {
  readLegacyTable,
  type LegacyRow,
  type LegacyTableRead,
} from "./paging";

/** The legacy node table, and the column that orders it stably. */
export const FREEMAN_EDLS_NODE_TABLE = "node";
export const FREEMAN_EDLS_NODE_ORDER_COLUMN = "nid";

/** The legacy node type that is an EDLS sheet. */
export const FREEMAN_EDLS_SHEET_NODE_TYPE = "sirius_edls_sheet";

/**
 * The legacy field tables that carry a sheet's data.
 *
 * The names are not guessable from the field's purpose — several sheet fields
 * are named for grievances because the legacy site grew that way — so they are
 * listed explicitly, confirmed against the legacy field configuration.
 *
 * Each table's value column differs (`_value`, `_target_id`, `_tid`, some with
 * a companion `_format`), which is exactly why rows are staged whole rather
 * than mapped now.
 */
export const FREEMAN_EDLS_FIELD_TABLES: ReadonlyArray<{ table: string; label: string }> = [
  { table: "field_data_field_sirius_edls_sheet_status", label: "Sheet status" },
  { table: "field_data_field_grievance_rep_assignee", label: "Rep assignee" },
  { table: "field_data_field_grievance_rep_watching", label: "Rep watching" },
  { table: "field_data_field_sirius_date_start", label: "Start date" },
  { table: "field_data_field_sirius_dispatch_job_group", label: "Job group" },
  { table: "field_data_field_grievance_department_tid", label: "Department" },
  { table: "field_data_field_sirius_job_number", label: "Job number" },
  { table: "field_data_field_sirius_dispatch_facility", label: "Facility" },
  { table: "field_data_field_sirius_count", label: "Count" },
  { table: "field_data_field_sirius_json", label: "Sirius JSON" },
];

/** Field tables are keyed by the node id, and that column orders them. */
export const FREEMAN_EDLS_FIELD_ORDER_COLUMN = "entity_id";

export interface FreemanEdlsSweepReport {
  /** True only when every table was read to its end and the writes were made. */
  complete: boolean;
  /** Why the sweep did not complete. */
  error?: string;
  /** One entry per legacy table this sweep read. */
  reads: LegacyTableRead[];
  /** How long the whole sweep took. */
  durationMs: number;
  timestamp: string;
}

export interface FreemanEdlsNodeSweepReport extends FreemanEdlsSweepReport {
  /** Nodes the legacy system returned, of every type. */
  nodesRead: number;
  /** Of those, the ones that are EDLS sheets. */
  sheetsFound: number;
  /** Staged rows written (inserted or updated). */
  sheetsStaged: number;
  /** Staged rows dropped because the legacy system no longer calls them sheets. */
  sheetsRemoved: number;
}

export interface FreemanEdlsFieldSweepReport extends FreemanEdlsSweepReport {
  /** Staged sheets the field rows were collected for. */
  stagedSheets: number;
  /** Sheets whose field rows were written. */
  sheetsUpdated: number;
  /** Rows kept, per field table. */
  perTable: Array<{ table: string; label: string; rowsRead: number; rowsKept: number; complete: boolean; error?: string }>;
}

function nowStamp(): { started: number; timestamp: string } {
  return { started: Date.now(), timestamp: new Date().toISOString() };
}

/** The legacy system returns every column as a string; ids compare as text. */
function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Sweep the legacy node table and stage every EDLS sheet.
 *
 * The node table holds every node on the legacy site — tens of thousands of
 * rows, of which a few dozen are sheets — and the service cannot filter, so
 * the whole table is walked and the sheets are picked out here.
 */
export async function runFreemanEdlsNodeSweep(): Promise<FreemanEdlsNodeSweepReport> {
  const { started, timestamp } = nowStamp();
  const sheets: StagedNodeInput[] = [];

  const read = await readLegacyTable({
    table: FREEMAN_EDLS_NODE_TABLE,
    orderColumn: FREEMAN_EDLS_NODE_ORDER_COLUMN,
    onRows: (rows: LegacyRow[]) => {
      let kept = 0;
      for (const row of rows) {
        if (text(row.type) !== FREEMAN_EDLS_SHEET_NODE_TYPE) continue;
        const nid = text(row.nid);
        if (!nid) continue;
        sheets.push({ nid, type: text(row.type), node: row });
        kept += 1;
      }
      return kept;
    },
  });

  const base = {
    reads: [read],
    nodesRead: read.rowsRead,
    sheetsFound: sheets.length,
    timestamp,
  };

  if (!read.complete) {
    // A partial walk of the node table is not a set of sheets. Nothing is
    // staged, so the staging table still reflects the last sweep that finished.
    return {
      ...base,
      complete: false,
      error: read.error ?? "The legacy node table could not be read in full.",
      sheetsStaged: 0,
      sheetsRemoved: 0,
      durationMs: Date.now() - started,
    };
  }

  // One transaction: the sheets are written in chunks, and a failure partway
  // through would otherwise leave the staging table holding part of a sweep.
  //
  // The whole node table was read, so this IS the set of sheets — a staged row
  // the sweep did not find again is not a sheet any more (retyped, deleted, or
  // wrongly staged by an earlier run) and goes, field rows and all. Otherwise
  // the staging table would be the union of every sweep ever run, and the
  // field sweep would keep fetching rows for nodes that are no longer sheets.
  const { sheetsStaged, sheetsRemoved } = await runInTransaction(async () => {
    const written = await storage.freemanEdlsMigrateStaging.upsertNodes(sheets);
    const removed = await storage.freemanEdlsMigrateStaging.deleteNidsNotIn(
      sheets.map((sheet) => sheet.nid),
    );
    return { sheetsStaged: written, sheetsRemoved: removed };
  });

  return {
    ...base,
    complete: true,
    sheetsStaged,
    sheetsRemoved,
    durationMs: Date.now() - started,
  };
}

/**
 * Sweep the legacy field tables and attach their rows to the staged sheets.
 *
 * Every field table is read in full first. A field table that was refused
 * cannot be told apart from a field nobody filled in once the rows are stored,
 * so a refusal anywhere aborts the whole sweep before a single write.
 */
export async function runFreemanEdlsFieldSweep(): Promise<FreemanEdlsFieldSweepReport> {
  const { started, timestamp } = nowStamp();

  const stagedNids = await storage.freemanEdlsMigrateStaging.listNids();
  const wanted = new Set(stagedNids);

  const reads: LegacyTableRead[] = [];
  const perTable: FreemanEdlsFieldSweepReport["perTable"] = [];
  /** nid -> field table -> its rows for that node, deltas and all. */
  const collected = new Map<string, Record<string, LegacyRow[]>>();

  if (wanted.size === 0) {
    return {
      complete: false,
      error: "No sheets are staged yet. Run the node sweep first.",
      reads,
      perTable,
      stagedSheets: 0,
      sheetsUpdated: 0,
      durationMs: Date.now() - started,
      timestamp,
    };
  }

  for (const { table, label } of FREEMAN_EDLS_FIELD_TABLES) {
    const read = await readLegacyTable({
      table,
      orderColumn: FREEMAN_EDLS_FIELD_ORDER_COLUMN,
      onRows: (rows: LegacyRow[]) => {
        let kept = 0;
        for (const row of rows) {
          // These tables hold rows for other entity types too (users, for
          // one), and deleted field rows stay behind in them.
          if (text(row.entity_type) !== "node") continue;
          if (text(row.deleted) !== "0") continue;
          const nid = text(row.entity_id);
          if (!wanted.has(nid)) continue;
          let forNode = collected.get(nid);
          if (!forNode) {
            forNode = {};
            collected.set(nid, forNode);
          }
          // A multi-valued field returns one row per delta; all are kept.
          (forNode[table] ??= []).push(row);
          kept += 1;
        }
        return kept;
      },
    });

    reads.push(read);
    perTable.push({
      table,
      label,
      rowsRead: read.rowsRead,
      rowsKept: read.rowsKept,
      complete: read.complete,
      error: read.error,
    });

    if (!read.complete) {
      return {
        complete: false,
        error: `${label} (${table}): ${read.error ?? "could not be read in full."}`,
        reads,
        perTable,
        stagedSheets: wanted.size,
        sheetsUpdated: 0,
        durationMs: Date.now() - started,
        timestamp,
      };
    }
  }

  // Every staged sheet is written, including the ones no field table had a row
  // for: their field set is genuinely empty, and writing it clears whatever a
  // previous sweep left behind.
  //
  // One transaction for the lot: a sweep that failed partway through would
  // otherwise leave some sheets holding this sweep's field rows and the rest
  // holding the previous sweep's, with nothing to say which is which.
  const sheetsUpdated = await runInTransaction(async () => {
    let updatedCount = 0;
    for (const nid of stagedNids) {
      const updated = await storage.freemanEdlsMigrateStaging.setFieldRows(
        nid,
        collected.get(nid) ?? {},
      );
      if (updated) updatedCount += 1;
    }
    return updatedCount;
  });

  return {
    complete: true,
    reads,
    perTable,
    stagedSheets: wanted.size,
    sheetsUpdated,
    durationMs: Date.now() - started,
    timestamp,
  };
}
