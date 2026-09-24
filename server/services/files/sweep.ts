/**
 * File / database consistency sweep engine.
 *
 * For one configured filesystem, reconciles the `files` table with the
 * provider's actual contents:
 *  - Phase 1 (missing + refresh): rows whose object is absent are marked
 *    `missing` (never deleted for that reason); stale `size` / `mime_type`
 *    are refreshed from the object.
 *  - Phase 2 (orphans): objects with no matching row are RECORDED as
 *    `pending_delete` rows — never deleted on first sight.
 *  - Phase 3 (confirmed deletion): `pending_delete` rows older than the
 *    grace period are deleted (row first, then object) — but only when the
 *    caller explicitly enables deletion.
 *
 * Safety rules:
 *  - Unconfigured filesystems are never touched by callers (the cron plugin
 *    only iterates configured ones and reports DB-only ids as skipped).
 *  - Any provider error during phase 1 aborts the phase for that filesystem
 *    (an inaccessible filesystem must never cause rows to be marked missing).
 *  - Providers without list support (replit) skip phase 2 only.
 *  - Dry-run mode counts everything but writes nothing.
 */
import { storage } from "../../storage";
import { logger } from "../../logger";
import { FileSystemOperationError, type FileSystemProvider } from "./base";
import { getFileSystemProvider } from "./registry";

const SERVICE = "file-consistency-sweep";

/** uploadedBy recorded on rows the sweep creates for orphaned objects. */
export const SWEEP_ACTOR = "system:file-sweep";
/** entityType recorded on orphan rows so they are identifiable. */
export const ORPHAN_ENTITY_TYPE = "orphaned_file";

export interface SweepOptions {
  /** Count-only run: nothing is written or deleted. */
  dryRun: boolean;
  /** Whether phase 3 (deleting confirmed orphans) runs at all. */
  deleteOrphans: boolean;
  /** Days a pending_delete row must age before its object is deleted. */
  graceDays: number;
  /** DB / provider page size. */
  pageSize?: number;
}

export interface FileSystemSweepResult {
  fileSystemId: string;
  /** Phase level skips, e.g. "listing unsupported" or "inaccessible". */
  skipped?: string;
  markedMissing: number;
  refreshed: number;
  orphansRecorded: number;
  orphansDeleted: number;
  errors: number;
  notes: string[];
}

function newResult(fileSystemId: string): FileSystemSweepResult {
  return {
    fileSystemId,
    markedMissing: 0,
    refreshed: 0,
    orphansRecorded: 0,
    orphansDeleted: 0,
    errors: 0,
    notes: [],
  };
}

/**
 * Phase 1: walk this filesystem's rows; mark absent objects `missing` and
 * refresh stale size / mime_type. A provider error (as opposed to a clean
 * "object not found") aborts the phase — inaccessibility must never look
 * like missing files.
 */
async function sweepRows(
  provider: FileSystemProvider,
  opts: SweepOptions,
  result: FileSystemSweepResult,
): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await storage.files.listPage(
      { fileSystemId: result.fileSystemId },
      { cursor, limit: opts.pageSize },
    );
    cursor = page.cursor;
    for (const row of page.rows) {
      if (row.status === "pending_delete") continue; // phase 3's business
      const stat = await provider.stat(row.storagePath); // throws on inaccessibility → aborts phase
      if (stat === null) {
        if (row.status !== "missing") {
          if (!opts.dryRun) {
            await storage.files.update(row.id, { status: "missing" });
          }
          result.markedMissing++;
        }
        continue;
      }
      // Object exists; refresh drifted size / mime type on live rows. Rows
      // already `missing` stay missing — recovery is an operator decision.
      if (row.status !== "live") continue;
      const updates: { size?: number; mimeType?: string } = {};
      if (typeof stat.size === "number" && stat.size !== row.size) {
        updates.size = stat.size;
      }
      if (stat.mimeType && stat.mimeType !== row.mimeType) {
        updates.mimeType = stat.mimeType;
      }
      if (Object.keys(updates).length > 0) {
        if (!opts.dryRun) {
          await storage.files.update(row.id, updates);
        }
        result.refreshed++;
      }
    }
  } while (cursor);
}

/**
 * Phase 2: walk the provider's objects; any object with no matching row is
 * recorded as a `pending_delete` row (first pass of the two-phase delete).
 * The row's own uploaded_at timestamp is the grace-period clock.
 */
async function sweepObjects(
  provider: FileSystemProvider,
  opts: SweepOptions,
  result: FileSystemSweepResult,
): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await provider.list({ cursor, limit: opts.pageSize });
    cursor = page.cursor;
    for (const entry of page.entries) {
      const row = await storage.files.getByStoragePath(entry.path, result.fileSystemId);
      if (row) continue;
      result.orphansRecorded++;
      if (opts.dryRun) continue;
      await storage.files.create({
        fileName: entry.path.split("/").pop() || entry.path,
        storagePath: entry.path,
        size: entry.size,
        uploadedBy: SWEEP_ACTOR,
        entityType: ORPHAN_ENTITY_TYPE,
        fileSystemId: result.fileSystemId,
        status: "pending_delete",
        metadata: { recordedBySweepAt: new Date().toISOString() },
      });
    }
  } while (cursor);
}

/**
 * Phase 3: delete objects whose `pending_delete` row has aged past the grace
 * period. Row first, then object — a failed object delete is re-recorded as
 * an orphan on the next sweep, never a dangling row.
 */
async function deleteConfirmedOrphans(
  provider: FileSystemProvider,
  opts: SweepOptions,
  result: FileSystemSweepResult,
): Promise<void> {
  const cutoff = new Date(Date.now() - opts.graceDays * 24 * 60 * 60 * 1000);
  // No cursor loop: each live iteration deletes the rows it saw, so keep
  // fetching the first page until it comes back empty (dry runs do one page
  // per fetch with a cursor to avoid spinning).
  let cursor: string | undefined;
  for (;;) {
    const page = await storage.files.listPage(
      { fileSystemId: result.fileSystemId, status: "pending_delete", uploadedBefore: cutoff },
      { cursor: opts.dryRun ? cursor : undefined, limit: opts.pageSize },
    );
    for (const row of page.rows) {
      if (opts.dryRun) {
        result.orphansDeleted++;
        continue;
      }
      try {
        await storage.files.delete(row.id);
        await provider.delete(row.storagePath);
        result.orphansDeleted++;
      } catch (error) {
        result.errors++;
        logger.warn(`Failed to delete confirmed orphan "${row.storagePath}"`, {
          service: SERVICE,
          fileSystemId: result.fileSystemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (opts.dryRun) {
      cursor = page.cursor;
      if (!cursor) break;
    } else if (page.rows.length === 0 || result.errors > 0) {
      // Stop on empty page, or after errors so a wedged provider can't loop.
      break;
    }
  }
}

/** Run the full sweep for one CONFIGURED filesystem. */
export async function sweepFileSystem(
  fileSystemId: string,
  opts: SweepOptions,
): Promise<FileSystemSweepResult> {
  const result = newResult(fileSystemId);
  const provider = getFileSystemProvider(fileSystemId);

  // Phase 1 — missing detection + metadata refresh. Abort the whole
  // filesystem on provider errors: inaccessible ≠ missing.
  try {
    await sweepRows(provider, opts, result);
  } catch (error) {
    result.skipped = `inaccessible during row sweep: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn(`Sweep skipped filesystem "${fileSystemId}"`, {
      service: SERVICE,
      fileSystemId,
      reason: result.skipped,
    });
    return result;
  }

  // Phase 2 — orphan recording. Providers without list support skip this
  // phase only (their objects are only ever created through the app).
  try {
    await sweepObjects(provider, opts, result);
  } catch (error) {
    if (error instanceof FileSystemOperationError && /does not support listing/i.test(error.message)) {
      result.notes.push("orphan detection skipped: provider does not support listing");
    } else {
      result.errors++;
      result.notes.push(
        `orphan detection aborted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Phase 3 — confirmed deletion, only when explicitly enabled.
  if (opts.deleteOrphans) {
    await deleteConfirmedOrphans(provider, opts, result);
  } else {
    result.notes.push("orphan deletion disabled (deleteOrphans off)");
  }

  return result;
}
