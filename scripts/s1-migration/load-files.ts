/**
 * B1–B10: S1 attachment reconciliation. See docs/s1-migration/plan-v2.md.
 * Deliberately never initializes app environment overrides or contacts S1.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { logger } from "../../server/logger";
import { getClient, runInTransaction } from "../../server/storage/transaction-context";
import { registerEntityFileContexts } from "../../server/modules/entity-files-contexts";
import { isComponentEnabled } from "../../server/modules/components";
import { getEntityFileContext } from "../../server/services/entity-files/registry";
import { resolveUsableContextConfig, expandDirectoryTemplate, isExtensionAllowed } from "../../server/services/entity-files/config";
import { fileSystemService, getFileSystemConfig, listFileSystemConfigs } from "../../server/services/files";
import { withNotificationsSuppressed, withChargePluginsSuppressed } from "../../server/middleware/request-context";
import { assertMigrationTimeZone } from "./lib/timezone-contract";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getAllMappings, getMappings, putMapping, deleteMapping, clearFingerprints, advanceFingerprints } from "./lib/idmap";
import { RejectLog, throttleStorageOpLogs, LOADER_LOG_SAMPLE_EVERY } from "./lib/loader-utils";
import { buildLoaderResult, emitLoaderResult, loaderExitCode, emptySummary, contentHashOf, type SyncFinding } from "./lib/sync";
import { getEnvironmentVariable } from "./lib/script-env";
import { ensureRawFileTable } from "./lib/file-staging";
import { loadFileSource } from "./lib/file-source";
import { ensureFileTypes } from "./lib/file-options";
import { LocalArchive, S3Archive, archiveKey } from "./lib/file-archive";
import { D7_CATEGORIES, type Candidate, type FileContext } from "./lib/file-candidates";
import { makeProgressLogger } from "./lib/progress";

const LOADER = "s1-files";
const LOGIC_VERSION = 1;
const contexts: FileContext[] = ["worker", "employer", "ledger_payment"];
let releaseLoaderLock: (() => Promise<void>) | undefined;
function parseArgs(argv: string[]) {
  const flags = new Set(["--dry-run", "--migration-mode", "--force-reconcile"]);
  const values = new Set(["--allow-rejects", "--allow-findings", "--max-bytes", "--limit", "--archive-directory", "--missing-file-list"]);
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (flags.has(argv[i])) args[argv[i]] = true;
    else if (values.has(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith("--")) args[argv[i]] = argv[++i];
    else throw new Error("invalid_argument");
  }
  const number = (key: string, fallback: number) => {
    const value = args[key] === undefined ? fallback : Number(args[key]);
    if (!Number.isSafeInteger(value) || value < 0 || (key === "--max-bytes" && value === 0)) throw new Error("invalid_limit");
    return value;
  };
  return { dry: !!args["--dry-run"], migration: !!args["--migration-mode"], force: !!args["--force-reconcile"],
    max: number("--max-bytes", 104857600), limit: number("--limit", Number.MAX_SAFE_INTEGER),
    rejects: String(args["--allow-rejects"] ?? "").split(",").filter(Boolean),
    findings: String(args["--allow-findings"] ?? "").split(",").filter(Boolean),
    directory: args["--archive-directory"] as string | undefined,
    missingList: args["--missing-file-list"] as string | undefined };
}
type Target = { file_id: string; attachment_id: string | null; context_id: string | null; entity_id: string | null; fid: string; status?: string; file_context?: string; file_owner_id?: string; file_size?: number };
const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = new Date();
  // Names/paths in provider failures and deferred removal warnings are sensitive.
  // Suppress the console-only app logger for this standalone process as well.
  logger.silent = true;
  if (LOADER_LOG_SAMPLE_EVERY !== 0 || getEnvironmentVariable("S1_MIGRATION_DEBUG")) throw new Error("unsafe_logging_configuration");
  await assertMigrationTimeZone();
  await throttleStorageOpLogs();
  const lockClient = await pool.connect();
  const locked = await lockClient.query("SELECT pg_try_advisory_lock(hashtext('s1-files')) AS locked");
  if (!locked.rows[0]?.locked) { lockClient.release(); throw new Error("file_loader_already_running"); }
  releaseLoaderLock = async () => {
    try { await lockClient.query("SELECT pg_advisory_unlock(hashtext('s1-files'))"); }
    finally { lockClient.release(); }
  };
  registerEntityFileContexts();
  const configs = new Map<FileContext, { file_system: string; directory: string; allowed?: string[] }>();
  for (const context of contexts) {
    const usable = await resolveUsableContextConfig(context);
    if (!usable.config || fileSystemService.isPublic(usable.config.file_system)) throw new Error("file_area_unusable");
    expandDirectoryTemplate(usable.config.directory, "preflight");
    if (args.directory && getFileSystemConfig(usable.config.file_system).provider !== "local") throw new Error("synthetic_requires_local_destination");
    configs.set(context, usable.config);
  }
  // Check the real stored component state, without app boot/override initialization.
  if (!(await isComponentEnabled("ledger"))) throw new Error("ledger_component_required");
  const bucket = getEnvironmentVariable("S1_FILES_ARCHIVE_BUCKET");
  if (!args.directory && !bucket) throw new Error("archive_bucket_required");
  if (bucket && listFileSystemConfigs().some(c => c.provider === "s3" && c.settings.bucket === bucket)) throw new Error("archive_must_not_be_a_filesystem");
  const archive = args.directory ? new LocalArchive(args.directory) : new S3Archive(bucket!);
  const prefix = getEnvironmentVariable("S1_FILES_ARCHIVE_PREFIX") ?? "private/";
  archiveKey("private://preflight", prefix);
  // Dry runs cannot initialize even scratch tables.
  const evidence = rows<{ row_count: string }>(await db.execute(sql`SELECT row_count FROM s1_staging.file_inventory_evidence`));
  const count = rows<{ n: string }>(await db.execute(sql`SELECT count(*) AS n FROM s1_staging.raw_file_managed`));
  if (evidence.length !== 1 || Number(evidence[0].row_count) !== Number(count[0].n)) throw new Error("file_inventory_unverified");
  const source = await loadFileSource();
  // Validate every resolved owner via the actual context API before any file/type write.
  for (const c of source.candidates) if (!c.reason && !c.archiveOnly && c.context && c.ownerId) {
    if (!(await getEntityFileContext(c.context)!.entityExists(c.ownerId))) throw new Error("owner_prerequisite_missing");
  }
  if (!args.dry) { await ensureStagingSchema(); await ensureIdMap(); await ensureRawFileTable(); }
  const typeIds = await ensureFileTypes(args.dry);
  const maps = await getAllMappings("file");
  const scoped = new Set(rows<{ s1_id: string }>(await db.execute(sql`SELECT s1_id FROM s1_staging.id_map WHERE entity='file' AND loader=${LOADER}`)).map(r => Number(r.s1_id)));
  const targets = rows<Target>(await db.execute(sql`SELECT f.id AS file_id,e.id AS attachment_id,e.context_id,e.entity_id,f.status,
    f.entity_type AS file_context,f.entity_id AS file_owner_id,f.size AS file_size,
    f.metadata->'s1'->>'fid' AS fid FROM files f LEFT JOIN entity_files e ON e.file_id=f.id
    WHERE f.metadata->'s1'->>'fid' IS NOT NULL OR EXISTS
      (SELECT 1 FROM s1_staging.id_map m WHERE m.entity='file' AND m.s2_id=f.id AND m.loader=${LOADER})`));
  const byFile = new Map(targets.map(t => [t.file_id, t]));
  const byFid = new Map<number, Target[]>();
  for (const t of targets) byFid.set(Number(t.fid), [...(byFid.get(Number(t.fid)) ?? []), t]);
  const rejects = new RejectLog(); const summary = emptySummary(); const findings: SyncFinding[] = [];
  const missing: { fid: number; sourceNid: number }[] = [];
  const current = new Set(source.candidates.filter(c => !c.archiveOnly).map(c => c.fid));
  const sweep = [...maps].filter(([fid]) => scoped.has(fid) && !current.has(fid));
  const overLimit = sweep.length > 50;
  if (overLimit) findings.push({ kind: "sweep_over_limit", entity: "file", s1Id: 0, detail: { count: sweep.length } });
  const totals = { archive_only: 0, bytes_pending: 0, limited: 0, archiveHeads: 0, archiveGets: 0, metadataUpdates: 0 };
  const categoryCounts = Object.fromEntries(D7_CATEGORIES.map(c => [c, 0]));
  const contextCounts: Record<string, number> = {}; const typeCounts: Record<string, number> = {};
  const progress = makeProgressLogger(LOADER, source.candidates.length);
  let verifyFailures = 0; let newWrites = 0;
  const scope = <T>(fn: () => Promise<T>) => args.migration
    ? withChargePluginsSuppressed(() => withNotificationsSuppressed(fn)) : withNotificationsSuppressed(fn);
  const remove = async (target: Target) => {
    if (target.attachment_id && target.context_id && target.entity_id) await scope(() =>
      storage.entityFiles.deleteWithFile(target.context_id!, target.entity_id!, target.attachment_id!));
    else throw new Error("target_incomplete");
  };
  const reject = (reason: string, c: Candidate) => {
    rejects.add(reason, { fid: c.fid, sourceNid: c.sourceNid }, c.fid);
    if (reason === "bytes_missing") missing.push({ fid: c.fid, sourceNid: c.sourceNid });
  };
  try {
    for (const c of source.candidates) {
      progress.add(1);
      if (c.archiveOnly) { totals.archive_only++; continue; }
      if (c.context) contextCounts[c.context] = (contextCounts[c.context] ?? 0) + 1;
      if (c.typeKey) typeCounts[c.typeKey] = (typeCounts[c.typeKey] ?? 0) + 1;
      if (c.typeKey === "note-attachment") categoryCounts[c.category]++;
      if (c.reason) { reject(c.reason, c); continue; }
      if (!c.context || !c.ownerId || !c.typeKey) { reject("owner_unresolved", c); continue; }
      const raw = source.rawFiles.get(c.fid);
      if (!raw) { reject("file_row_missing", c); continue; }
      if (!Number.isSafeInteger(raw.timestamp) || raw.timestamp < 0 || raw.timestamp > 4102444800) { reject("timestamp_invalid", c); continue; }
      const config = configs.get(c.context)!;
      if (!isExtensionAllowed(raw.filename, config.allowed)) { reject("extension_disallowed", c); continue; }
      const name = (c.title || raw.filename).slice(0, 255);
      const data = { s1Fid: c.fid, s1SourceNid: c.sourceNid, s1NoteId: source.notes.get(c.sourceNid)?.s2Id ?? null,
        ...(c.materialType !== undefined ? { s1MaterialType: c.materialType, s1MaterialSummary: c.summary } : {}),
        ...(c.relationshipNid ? { s1RelationshipNid: c.relationshipNid } : {}),
        ...(c.wizardStatus !== undefined ? { s1WizardStatus: c.wizardStatus } : {}) };
      const metadata = { s1: { fid: c.fid, uri: raw.uri, uid: raw.uid,
        sourceNid: c.sourceNid, sourceBundle: c.sourceBundle, sourceField: c.sourceField, category: c.category, type: c.type } };
      const fp = contentHashOf({ raw: raw.content_hash, context: c.context, owner: c.ownerId, type: c.typeKey,
        sourceNid: c.sourceNid, name, data, metadata, uploader: source.uploader(raw.uid) });
      const mapping = maps.get(c.fid);
      if (mapping && !scoped.has(c.fid)) { reject("mapping_foreign", c); continue; }
      let target = mapping ? byFile.get(mapping.s2Id) : undefined;
      if (target && Number(target.fid) !== c.fid) { reject("mapping_provenance_conflict", c); continue; }
      if (mapping && !target?.attachment_id) {
        findings.push({ kind: "mapping_dangling", entity: "file", s1Id: c.fid, s2Id: mapping.s2Id });
        if (target && !args.dry) {
          // A manually removed join row can leave the underlying file behind.
          // Retire only this proven, loader-mapped orphan before recreating.
          const orphan = await storage.files.getById(target.file_id);
          if (orphan) {
            await scope(() => storage.files.delete(orphan.id));
            try { await fileSystemService.remove(orphan.fileSystemId, orphan.storagePath); }
            catch { /* Destination consistency sweep may remove the orphan bytes. */ }
          }
        }
        target = undefined;
        if (!args.dry) await deleteMapping("file", c.fid);
      }
      if (!target) {
        const matches = (byFid.get(c.fid) ?? []).filter(t => t.attachment_id);
        if (matches.length > 1) { reject("provenance_ambiguous", c); continue; }
        target = matches[0];
        if (target) {
          findings.push({ kind: "mapping_repaired", entity: "file", s1Id: c.fid, s2Id: target.file_id });
          if (!args.dry) await putMapping("file", c.fid, target.file_id, { stub: false, loader: LOADER });
        }
      }
      const moved = target && (target.context_id !== c.context || target.entity_id !== c.ownerId);
      if (target && !moved && !args.dry && target.file_size !== undefined && target.file_size !== raw.filesize) {
        findings.push({ kind: "size_differs", entity: "file", s1Id: c.fid,
          detail: { stagedSize: raw.filesize, objectSize: target.file_size } });
      }
      if (target && target.status === "live" && target.file_context === `entity-files:${c.context}` &&
          target.file_owner_id === c.ownerId && !moved && mapping?.consumedFingerprint === fp &&
          mapping.logicVersion === LOGIC_VERSION && !args.force && !args.dry) {
        summary.unchanged++; continue;
      }
      let expectedSize: number | undefined;
      // A failed forced verification must not leave an old successful fingerprint
      // eligible for the next ordinary fast path.
      if (!args.dry && mapping) await clearFingerprints("file", [c.fid]);
      if (!target || moved || args.dry) {
        const key = archiveKey(raw.uri, prefix);
        if (!key) { reject("bytes_missing", c); continue; }
        let size: number | null;
        try { totals.archiveHeads++; size = await archive.head(key); }
        catch { reject("archive_head_failed", c); continue; }
        if (size === null) {
          if (Date.now() / 1000 - raw.timestamp < 48 * 3600) { totals.bytes_pending++; continue; }
          reject("bytes_missing", c); continue;
        }
        if (size > args.max) { reject("too_large", c); continue; }
        expectedSize = size;
        if (size !== raw.filesize) findings.push({ kind: "size_differs", entity: "file", s1Id: c.fid, detail: { stagedSize: raw.filesize, objectSize: size } });
        if ((!target || moved) && newWrites >= args.limit) { totals.limited++; continue; }
        if (args.dry) { if (target) summary.updated++; else summary.created++; continue; }
        let bytes: Buffer;
        try { totals.archiveGets++; bytes = await archive.get(key, args.max); if (bytes.length !== size) throw new Error(); }
        catch { reject("archive_get_failed", c); continue; }
        const safeName = (raw.filename.split(/[/\\]/).pop() || "file").replace(/[^\w.\-]+/g, "_").slice(0, 200);
        const directory = expandDirectoryTemplate(config.directory, c.ownerId);
        const path = `${directory ? directory + "/" : ""}${randomUUID()}-${safeName}`;
        let uploaded = false;
        try {
          const result = await fileSystemService.upload({ fileSystemId: config.file_system, fileName: raw.filename,
            fileContent: bytes, mimeType: raw.filemime.toLowerCase(), customPath: path });
          uploaded = true;
          if (result.size !== bytes.length || (await fileSystemService.stat(config.file_system, path))?.size !== bytes.length) throw new Error();
        } catch {
          try { await fileSystemService.remove(config.file_system, path); } catch {}
          reject("upload_failed", c); continue;
        }
        try {
          const created = await scope(() => runInTransaction(async () => {
            if (moved && target) await remove(target);
            const record = await storage.entityFiles.createWithFile(c.context!, c.ownerId!, {
              fileName: raw.filename, storagePath: path, mimeType: raw.filemime.toLowerCase(), size: bytes.length,
              uploadedBy: source.uploader(raw.uid), entityType: `entity-files:${c.context}`, entityId: c.ownerId!,
              fileSystemId: config.file_system, metadata,
            }, name, typeIds.get(c.typeKey!));
            // Match files.uploadedAt's Drizzle Date codec (UTC-naive storage),
            // not pg's session-local now() default. Epoch is an instant.
            await getClient().execute(sql`UPDATE files SET uploaded_at=to_timestamp(${raw.timestamp}) AT TIME ZONE 'UTC' WHERE id=${record.file.id}`);
            await storage.entityFiles.update(c.context!, c.ownerId!, record.id, { data });
            return record;
          }));
          target = { file_id: created.file.id, attachment_id: created.id, context_id: c.context, entity_id: c.ownerId, fid: String(c.fid) };
          if (moved) await deleteMapping("file", c.fid);
          await putMapping("file", c.fid, created.file.id, { stub: false, loader: LOADER });
          newWrites++; if (moved) summary.updated++; else summary.created++;
        } catch {
          // A mapping failure after commit must leave the committed object's bytes
          // for provenance adoption, not remove bytes beneath a durable row.
          const exists = rows<{ id: string }>(await db.execute(sql`SELECT id FROM files WHERE storage_path=${path} AND file_system_id=${config.file_system}`));
          if (uploaded && !exists.length) { try { await fileSystemService.remove(config.file_system, path); } catch {} }
          reject("create_failed", c); continue;
        }
      } else {
        try {
          const previous = await storage.entityFiles.get(c.context, c.ownerId, target.attachment_id!);
          if (!previous) throw new Error();
          expectedSize = previous.file.size;
          const attachmentChanged = previous.name !== name || previous.typeId !== typeIds.get(c.typeKey) || contentHashOf(previous.data) !== contentHashOf(data);
          const fileChanged = previous.file.fileName !== raw.filename || previous.file.mimeType !== raw.filemime.toLowerCase() ||
            previous.file.uploadedBy !== source.uploader(raw.uid) || contentHashOf(previous.file.metadata) !== contentHashOf(metadata);
          const dateMatches = rows<{ ok: boolean }>(await db.execute(sql`SELECT uploaded_at =
            (to_timestamp(${raw.timestamp}) AT TIME ZONE 'UTC') AS ok FROM files WHERE id=${previous.file.id}`))[0]?.ok;
          if (attachmentChanged || fileChanged || !dateMatches) {
            await scope(() => runInTransaction(async () => {
              if (attachmentChanged) await storage.entityFiles.update(c.context!, c.ownerId!, target!.attachment_id!, { name, typeId: typeIds.get(c.typeKey!), data });
              if (fileChanged) await storage.files.update(previous.file.id, {
                fileName: raw.filename, mimeType: raw.filemime.toLowerCase(), uploadedBy: source.uploader(raw.uid), metadata,
              });
              if (!dateMatches) await getClient().execute(sql`UPDATE files SET uploaded_at =
                to_timestamp(${raw.timestamp}) AT TIME ZONE 'UTC' WHERE id=${previous.file.id}`);
            }));
            summary.updated++; totals.metadataUpdates++;
          } else summary.unchanged++;
        } catch { reject("update_failed", c); continue; }
      }
      try {
        const verified = await storage.entityFiles.get(c.context, c.ownerId, target!.attachment_id!);
        const mappingNow = (await getMappings("file", [c.fid])).get(c.fid);
        // Prove both the persisted UTC-naive value and the application codec.
        const dateMatches = rows<{ ok: boolean }>(await db.execute(sql`SELECT
          uploaded_at = (to_timestamp(${raw.timestamp}) AT TIME ZONE 'UTC') AS ok
          FROM files WHERE id=${target!.file_id}`))[0]?.ok;
        if (!verified || mappingNow?.s2Id !== verified.file.id || verified.file.status !== "live" ||
            verified.file.entityType !== `entity-files:${c.context}` || verified.file.entityId !== c.ownerId ||
            verified.file.size !== expectedSize || !dateMatches || verified.file.uploadedAt.getTime() !== raw.timestamp * 1000 ||
            verified.file.fileName !== raw.filename || verified.file.mimeType !== raw.filemime.toLowerCase() ||
            verified.file.uploadedBy !== source.uploader(raw.uid) || contentHashOf(verified.file.metadata) !== contentHashOf(metadata) ||
            verified.name !== name || verified.typeId !== typeIds.get(c.typeKey) ||
            contentHashOf(verified.data) !== contentHashOf(data) ||
            (await fileSystemService.stat(verified.file.fileSystemId, verified.file.storagePath))?.size !== expectedSize) throw new Error();
        await advanceFingerprints("file", [{ s1Id: c.fid, fingerprint: fp }], LOGIC_VERSION);
      } catch { verifyFailures++; }
    }
    if (!overLimit || args.findings.includes("sweep_over_limit")) for (const [fid, mapping] of sweep) {
      try {
        const target = byFile.get(mapping.s2Id);
        if (target && Number(target.fid) !== fid) throw new Error("sweep_provenance_conflict");
        if (!args.dry) {
          if (target) await remove(target);
          await deleteMapping("file", fid);
        }
        summary.deleted++;
      } catch { rejects.add("delete_failed", { fid }, fid); }
    }
  } finally { progress.stop(); }
  const result = buildLoaderResult({ loader: LOADER, logicVersion: LOGIC_VERSION, dryRun: args.dry,
    forceReconcile: args.force, summary, rejects, allowedRejects: args.rejects, verifyFailures,
    findings, allowedFindings: args.findings,
    detail: { ...totals, contextCounts, typeCounts, categoryCounts, missingFiles: missing, rejectSamples: rejects.samples } });
  emitLoaderResult(result);
  if (args.missingList) await writeFile(args.missingList, JSON.stringify(missing), { mode: 0o600 });
  if (!args.dry) await recordRun(start, { loader: LOADER }, result as unknown as Record<string, unknown>);
  return loaderExitCode(result);
}

main().then(code => { process.exitCode = code; }).catch(() => {
  console.error("s1-files failed: sanitized operational failure; no raw error details emitted");
  process.exitCode = 1;
}).finally(async () => {
  try {
    const { drainStorageSideEffects } = await import("../../server/storage/drain-storage-side-effects");
    await drainStorageSideEffects();
  } finally { await releaseLoaderLock?.(); await pool.end(); }
}).catch(() => {
  console.error("s1-files shutdown failed; diagnostic details suppressed");
  process.exitCode = 1;
});
